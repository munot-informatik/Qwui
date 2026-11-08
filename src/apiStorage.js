// Ersetzt den bisherigen localStorage-Shim durch echte, zentrale Speicherung in
// Cloudflare D1 über die Pages Functions unter /api/storage. Gleiche Signatur wie
// zuvor (get/set/delete/list mit key + shared-Flag) — App.jsx muss dafür nicht
// angepasst werden.
//
// Die Basic-Auth-Anmeldedaten (Passwort) werden vom Browser automatisch bei jedem
// Request an dieselbe Domain mitgeschickt, sobald man einmal eingeloggt ist — die
// API-Endpunkte sind durch dieselbe functions/_middleware.js geschützt wie die Seite.
//
// Zusätzlich werden hier die Firmenlogos aus der Quittungsliste aus- und wieder
// eingepackt (siehe webLogoStore.js) — dasselbe, was desktop/excelStore.js für
// die Desktop-Version tut. Jede Speicherschicht kümmert sich um ihre eigene
// Auslagerung, App.jsx bleibt davon unberührt.

import { externalizeLogos, restoreLogos } from "./webLogoStore.js";

// Schlüssel, dessen Wert eine Liste von Quittungen ist (siehe KEYS in App.jsx).
const RECEIPTS_KEY = "receipts-list";

// Cloudflare D1 nimmt pro Wert höchstens 2 MB an. Alle Quittungen stehen in
// einem einzigen Wert — bei 1–1.5 KB pro Quittung wäre nach ein paar tausend
// Belegen Schluss. Grosse Werte werden deshalb in Teile zerlegt: Der
// Hauptschlüssel enthält nur einen Verweis, die Teile liegen unter
// «<Schlüssel>#teil-1…n». Geschrieben wird alles in einem D1-Batch (alles oder
// nichts), gelesen wird wieder zusammengesetzt. App.jsx merkt davon nichts.
export const CHUNK_MARKER = "__qwuiTeile";
const CHUNK_SEPARATOR = "#teil-";
// Zeichen pro Teil. 400 000 Zeichen sind auch mit lauter 3-Byte-Zeichen
// (z. B. «€») höchstens 1.2 MB — sicher unter der Grenze von D1.
export const CHUNK_CHARS = 400000;
const CHUNK_THRESHOLD_BYTES = 1500000;

export function isChunkKey(key) {
  return String(key).includes(CHUNK_SEPARATOR);
}

// [{ key, value }] → Einträge, wie sie in D1 landen (evtl. mehr als vorher).
export function splitLargeEntries(entries) {
  const out = [];
  for (const { key, value } of entries) {
    if (typeof value !== "string" || new TextEncoder().encode(value).length <= CHUNK_THRESHOLD_BYTES) {
      out.push({ key, value });
      continue;
    }
    const parts = [];
    for (let i = 0; i < value.length; i += CHUNK_CHARS) parts.push(value.slice(i, i + CHUNK_CHARS));
    out.push({ key, value: JSON.stringify({ [CHUNK_MARKER]: parts.length }) });
    parts.forEach((part, i) => out.push({ key: `${key}${CHUNK_SEPARATOR}${i + 1}`, value: part }));
  }
  return out;
}

function chunkCount(value) {
  if (typeof value !== "string" || !value.startsWith(`{"${CHUNK_MARKER}"`)) return 0;
  try {
    const n = JSON.parse(value)[CHUNK_MARKER];
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

// ---- Gleichzeitige Geräte ----
// Bis 1.3.0 überschrieb jedes Speichern den ganzen Wert. Waren zwei Geräte
// oder Fenster offen, löschte das zweite die Quittung des ersten und vergab
// dieselbe Nummer noch einmal. Jetzt merkt sich jedes Fenster die Version, die
// es geladen hat, und der Server lehnt das Speichern ab, wenn sich der Wert
// inzwischen geändert hat (409).
const LOGO_PREFIX = "logo:";
// Schlüssel → zuletzt gesehene Version ("" = existierte nicht).
const versions = new Map();

function rememberVersions(result) {
  for (const [key, version] of Object.entries(result?.versions || {})) versions.set(key, version);
}

export class StorageConflictError extends Error {
  constructor() {
    super(
      "Die Daten wurden inzwischen auf einem anderen Gerät oder in einem anderen Fenster geändert. Bitte neu laden — dieser Stand würde sonst die neueren Daten überschreiben."
    );
    this.conflict = true;
  }
}

// Erwartete Version für einen Schreibzugriff: die geladene, "" für einen
// Schlüssel, den dieses Fenster nie gesehen hat (er darf noch nicht existieren),
// undefined = nicht prüfen (Teile und Logos).
function expectedVersion(versions, key) {
  if (isChunkKey(key) || String(key).startsWith(LOGO_PREFIX)) return undefined;
  if (!versions.has(key)) return "";
  const v = versions.get(key);
  return typeof v === "string" ? v : undefined;
}

// Liest einen Wert und setzt ihn bei Bedarf aus seinen Teilen zusammen.
async function readJoined(key, shared) {
  const data = await rawGetSingle(key, shared);
  const n = data ? chunkCount(data.value) : 0;
  if (!n) return data;
  const parts = await Promise.all(
    Array.from({ length: n }, (_, i) => rawGetSingle(`${key}${CHUNK_SEPARATOR}${i + 1}`, shared))
  );
  if (parts.some((p) => !p || typeof p.value !== "string")) {
    throw new Error(`storage.get: Teil von «${key}» fehlt`);
  }
  return { ...data, value: parts.map((p) => p.value).join("") };
}

async function readRaw(key) {
  const data = await rawGet(key, false);
  return data ? data.value : null;
}

async function rawGet(key, shared) {
  return readJoined(key, shared);
}

async function rawGetSingle(key, shared) {
  const params = new URLSearchParams({ key, shared: String(shared) });
  const res = await fetch(`/api/storage?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`storage.get fehlgeschlagen: ${res.status}`);
  }
  const data = await res.json(); // null oder {key, value, shared, version}
  if (!isChunkKey(key)) versions.set(key, data ? (typeof data.version === "string" ? data.version : null) : "");
  return data;
}

async function rawSet(key, value, shared) {
  const expected = expectedVersion(versions, key);
  const body = JSON.stringify({ key, value, shared, ...(expected !== undefined ? { expected } : {}) });
  const res = await fetch(`/api/storage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // Kleine Werte kommen auch noch an, wenn die Seite gerade geschlossen wird.
    keepalive: body.length < 60000,
  });
  if (res.status === 409) throw new StorageConflictError();
  if (!res.ok) {
    throw new Error(`storage.set fehlgeschlagen: ${res.status}`);
  }
  const result = await res.json();
  rememberVersions(result);
  return result;
}

// Schreibzugriffe dieses Fensters laufen nacheinander. Sonst könnten zwei
// eigene Speichervorgänge desselben Werts (z. B. verzögertes Inventar-Speichern
// und eine Buchung) mit derselben alten Version losgehen — der zweite
// scheiterte dann an der eigenen Änderung. Die erwartete Version wird erst
// beim Absenden bestimmt, nach dem vorherigen Schreibzugriff.
let writeQueue = Promise.resolve();
function queued(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

async function writeBatch(slimmed, shared) {
  const prepared = splitLargeEntries(slimmed).map((e) => {
    const expected = expectedVersion(versions, e.key);
    return { ...e, shared, ...(expected !== undefined ? { expected } : {}) };
  });
  const res = await fetch(`/api/storage-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries: prepared }),
  });
  if (res.status === 409) throw new StorageConflictError();
  if (!res.ok) {
    throw new Error(`storage.setMany fehlgeschlagen: ${res.status}`);
  }
  const result = await res.json();
  rememberVersions(result);
  return result;
}

// Logos einmal separat ablegen und in den Quittungen nur referenzieren —
// sonst wüchse dieser eine Wert um ~100 KB pro Quittung. Die Logos selbst
// werden dabei sofort geschrieben; das ist unkritisch, da sie unter ihrem
// Inhalts-Hash liegen und ein überzähliges Logo nichts kaputt macht.
async function slimValue(key, value) {
  if (key !== RECEIPTS_KEY) return value;
  let receipts;
  try {
    receipts = JSON.parse(value);
  } catch (e) {
    return value;
  }
  const slim = await externalizeLogos(receipts, (logoKey, dataUrl) =>
    rawSet(logoKey, dataUrl, false)
  );
  return JSON.stringify(slim);
}

export const storageShim = {
  async get(key, shared = false) {
    const data = await rawGet(key, shared);
    if (key !== RECEIPTS_KEY || !data || !data.value) return data;

    // Ausgelagerte Logos wieder einsetzen, damit App.jsx und die PDF-Erzeugung
    // dieselbe Quittungsform sehen wie vor der Auslagerung.
    let receipts;
    try {
      receipts = JSON.parse(data.value);
    } catch (e) {
      return data; // kaputtes JSON unverändert durchreichen, App.jsx meldet es
    }
    const restored = await restoreLogos(receipts, readRaw);
    return { ...data, value: JSON.stringify(restored) };
  },

  async set(key, value, shared = false) {
    const slim = await slimValue(key, value);
    const entries = splitLargeEntries([{ key, value: slim }]);
    if (entries.length === 1) return queued(() => rawSet(key, slim, shared));
    await queued(() => writeBatch([{ key, value: slim }], shared));
    return { key, value, shared };
  },

  // Mehrere Schlüssel in einem Schritt (D1-Batch, alles oder nichts) — z. B.
  // Quittung, Exemplare, Inventar und Lagerbewegungen eines Verkaufs.
  // entries: [{ key, value }]
  async setMany(entries, shared = false) {
    const slimmed = [];
    for (const { key, value } of entries) {
      slimmed.push({ key, value: await slimValue(key, value) });
    }
    return queued(() => writeBatch(slimmed, shared));
  },

  async delete(key, shared = false) {
    return queued(() => deleteNow(key, shared));
  },

  async list(prefix = "", shared = false) {
    const params = new URLSearchParams({ prefix, shared: String(shared) });
    const res = await fetch(`/api/storage-list?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`storage.list fehlgeschlagen: ${res.status}`);
    }
    const result = await res.json();
    return { ...result, keys: (result.keys || []).filter((k) => !isChunkKey(k)) };
  },
};

async function deleteNow(key, shared) {
  // Zerlegte Werte: zuerst die Teile entfernen.
  const current = await rawGetSingle(key, shared);
  const n = current ? chunkCount(current.value) : 0;
  for (let i = 1; i <= n; i++) {
    const p = new URLSearchParams({ key: `${key}${CHUNK_SEPARATOR}${i}`, shared: String(shared) });
    await fetch(`/api/storage?${p.toString()}`, { method: "DELETE" });
  }
  const params = new URLSearchParams({ key, shared: String(shared) });
  const res = await fetch(`/api/storage?${params.toString()}`, { method: "DELETE" });
  versions.set(key, "");
  if (!res.ok) {
    throw new Error(`storage.delete fehlgeschlagen: ${res.status}`);
  }
  return res.json();
}

export function installStorageShim() {
  if (typeof window !== "undefined") {
    window.storage = storageShim;
  }
}
