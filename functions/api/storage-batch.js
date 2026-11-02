// API-Endpunkt für mehrere Schlüssel auf einmal: /api/storage-batch
// POST /api/storage-batch  (Body: {entries: [{key, value, shared}]})
//
// Alles oder nichts: D1 führt einen batch() als eine Transaktion aus. Ein
// Verkauf ändert Quittung, Exemplare, Inventar und Lagerbewegungen zugleich —
// einzeln gespeichert könnte ein Abbruch dazwischen den Bestand verfälschen.
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

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungültiges JSON im Request-Body" }, 400);
  }
  const entries = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return json({ error: "entries fehlt" }, 400);
  }
  if (entries.length > MAX_ENTRIES) {
    return json({ error: "zu viele Einträge" }, 413);
  }

  for (const { key, value } of entries) {
    if (typeof key !== "string" || !key) {
      return json({ error: "key fehlt" }, 400);
    }
    if (typeof value !== "string") {
      return json({ error: "value muss ein String sein" }, 400);
    }
    if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
      return json({ error: "value ist zu gross" }, 413);
    }
  }

  const statement = env.DB.prepare(
    `INSERT INTO kv_store (full_key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(full_key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );

  try {
    await env.DB.batch(entries.map(({ key, value, shared }) => statement.bind(fullKey(key, shared), value)));
  } catch (e) {
    console.error("D1-Schreibzugriff (Batch) fehlgeschlagen", e);
    return json({ error: "Speichern in der Datenbank fehlgeschlagen" }, 503);
  }

  return json({ keys: entries.map((e) => e.key) });
}
