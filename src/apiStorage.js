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

async function readRaw(key) {
  const data = await rawGet(key, false);
  return data ? data.value : null;
}

async function rawGet(key, shared) {
  const params = new URLSearchParams({ key, shared: String(shared) });
  const res = await fetch(`/api/storage?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`storage.get fehlgeschlagen: ${res.status}`);
  }
  return res.json(); // null oder {key, value, shared}
}

async function rawSet(key, value, shared) {
  const res = await fetch(`/api/storage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, shared }),
  });
  if (!res.ok) {
    throw new Error(`storage.set fehlgeschlagen: ${res.status}`);
  }
  return res.json();
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
    if (key !== RECEIPTS_KEY) return rawSet(key, value, shared);

    // Logos einmal separat ablegen und in den Quittungen nur referenzieren —
    // sonst wüchse dieser eine Wert um ~100 KB pro Quittung.
    let receipts;
    try {
      receipts = JSON.parse(value);
    } catch (e) {
      return rawSet(key, value, shared);
    }
    const slim = await externalizeLogos(receipts, (logoKey, dataUrl) =>
      rawSet(logoKey, dataUrl, false)
    );
    return rawSet(key, JSON.stringify(slim), shared);
  },

  async delete(key, shared = false) {
    const params = new URLSearchParams({ key, shared: String(shared) });
    const res = await fetch(`/api/storage?${params.toString()}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`storage.delete fehlgeschlagen: ${res.status}`);
    }
    return res.json();
  },

  async list(prefix = "", shared = false) {
    const params = new URLSearchParams({ prefix, shared: String(shared) });
    const res = await fetch(`/api/storage-list?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`storage.list fehlgeschlagen: ${res.status}`);
    }
    return res.json();
  },
};

export function installStorageShim() {
  if (typeof window !== "undefined") {
    window.storage = storageShim;
  }
}
