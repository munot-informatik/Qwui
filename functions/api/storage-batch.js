// API-Endpunkt für mehrere Schlüssel auf einmal: /api/storage-batch
// POST /api/storage-batch  (Body: {entries: [{key, value, shared, expected?}]})
//
// Alles oder nichts: D1 führt einen batch() als eine Transaktion aus. Ein
// Verkauf ändert Quittung, Exemplare, Inventar und Lagerbewegungen zugleich —
// einzeln gespeichert könnte ein Abbruch dazwischen den Bestand verfälschen.
//
// Gleichzeitige Geräte: Jeder Wert hat eine Version (Spalte updated_at). Wer
// schreibt, nennt in «expected» die Version, die er geladen hat ("" = der
// Schlüssel existierte noch nicht). Hat inzwischen ein anderes Gerät oder
// Fenster gespeichert, scheitert der ganze Batch mit 409 — statt dessen
// Quittung stillschweigend zu überschreiben. Ohne «expected» wird nicht
// geprüft (z. B. inhaltsadressierte Logos).
//
// Geschützt durch functions/_middleware.js wie alle anderen Endpunkte.

function fullKey(key, shared) {
  return `${shared === "true" || shared === true ? "shared" : "personal"}:${key}`;
}

// Dieselben Grenzen wie in storage.js (siehe dort zur Begründung).
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 50;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function newVersion() {
  return `${new Date().toISOString()}#${crypto.randomUUID().slice(0, 8)}`;
}

// Prüft die Einträge; liefert eine Fehlerantwort oder null.
export function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return json({ error: "entries fehlt" }, 400);
  if (entries.length > MAX_ENTRIES) return json({ error: "zu viele Einträge" }, 413);
  for (const { key, value, expected } of entries) {
    if (typeof key !== "string" || !key) return json({ error: "key fehlt" }, 400);
    if (typeof value !== "string") return json({ error: "value muss ein String sein" }, 400);
    if (expected !== undefined && expected !== null && typeof expected !== "string") {
      return json({ error: "expected muss ein String sein" }, 400);
    }
    if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) return json({ error: "value ist zu gross" }, 413);
  }
  return null;
}

// Die Versionsprüfung muss in derselben Transaktion laufen wie das Schreiben.
// D1 kennt kein bedingtes Abbrechen eines Batches — deshalb ein Hilfs-INSERT,
// das genau bei einem Konflikt eine Zeile ohne Wert einzufügen versucht. Die
// NOT-NULL-Regel der Tabelle lässt dann den ganzen Batch scheitern.
const GUARD_EXISTS = `INSERT INTO kv_store (full_key, value) SELECT 'qwui:konflikt', NULL WHERE EXISTS (SELECT 1 FROM kv_store WHERE full_key = ?1)`;
const GUARD_VERSION = `INSERT INTO kv_store (full_key, value) SELECT 'qwui:konflikt', NULL WHERE NOT ((SELECT updated_at FROM kv_store WHERE full_key = ?1) IS ?2)`;
const UPSERT = `INSERT INTO kv_store (full_key, value, updated_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(full_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

export function isConflictError(e) {
  return /NOT NULL constraint failed/i.test(String(e?.message || e));
}

// Schreibt alle Einträge in einem Batch. Liefert { versions } oder wirft.
export async function writeEntries(db, entries) {
  const statements = [];
  const versions = {};
  for (const { key, value, shared, expected } of entries) {
    const fk = fullKey(key, shared);
    if (expected === "") statements.push(db.prepare(GUARD_EXISTS).bind(fk));
    else if (typeof expected === "string") statements.push(db.prepare(GUARD_VERSION).bind(fk, expected));
    const version = newVersion();
    versions[key] = version;
    statements.push(db.prepare(UPSERT).bind(fk, value, version));
  }
  await db.batch(statements);
  return { versions };
}

export async function writeResponse(db, entries) {
  try {
    const { versions } = await writeEntries(db, entries);
    return json({ keys: entries.map((e) => e.key), versions });
  } catch (e) {
    if (isConflictError(e)) {
      return json({ error: "konflikt", message: "Die Daten wurden inzwischen an einem anderen Ort geändert." }, 409);
    }
    console.error("D1-Schreibzugriff fehlgeschlagen", e);
    return json({ error: "Speichern in der Datenbank fehlgeschlagen" }, 503);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungültiges JSON im Request-Body" }, 400);
  }
  const entries = body?.entries;
  const invalid = validateEntries(entries);
  if (invalid) return invalid;
  return writeResponse(env.DB, entries);
}
