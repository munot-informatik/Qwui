// API-Endpunkt für einzelne Schlüssel: /api/storage
// GET    /api/storage?key=X&shared=false   -> liest einen Wert
// POST   /api/storage  (Body: {key, value, shared})  -> speichert einen Wert
// DELETE /api/storage?key=X&shared=false   -> löscht einen Wert
//
// Läuft als Cloudflare Pages Function, geschützt durch functions/_middleware.js
// (dieselbe Passwortabfrage wie für die restliche Seite gilt automatisch auch hier).
//
// Braucht ein D1-Datenbank-Binding namens "DB" im Cloudflare-Dashboard
// (Pages-Projekt -> Settings -> Functions -> D1 database bindings).

function fullKey(key, shared) {
  return `${shared === "true" || shared === true ? "shared" : "personal"}:${key}`;
}

// Reine Missbrauchsbremse, bewusst WEIT über allem, was D1 selbst noch
// annimmt (D1 begrenzt einen einzelnen Wert auf deutlich weniger). Diese
// Grenze darf niemals diejenige sein, die als erste zuschlägt — sonst würde
// sie Daten ablehnen, die heute funktionieren. Sie soll nur verhindern, dass
// ein einzelner Request unbegrenzt viel in die Datenbank schiebt.
//
// ACHTUNG, wachsendes Problem unabhängig von dieser Grenze: jede Quittung
// speichert in receipts-list ihre eigene Kopie von company — inklusive
// logoDataUrl. Ein 300px-Logo sind rund 100 KB, macht ~100 KB PRO Quittung.
// Ab ein paar Dutzend Quittungen läuft der Wert damit in das Limit von D1.
// Die Desktop-Version umgeht das bereits (desktop/logoCache.js lagert Logos
// in Dateien aus); die Web-Version braucht denselben Schritt.
const MAX_VALUE_BYTES = 16 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const shared = url.searchParams.get("shared") === "true";

  if (!key) {
    return json({ error: "key fehlt" }, 400);
  }

  try {
    const row = await env.DB.prepare("SELECT value FROM kv_store WHERE full_key = ?")
      .bind(fullKey(key, shared))
      .first();

    if (!row) return json(null);

    return json({ key, value: row.value, shared });
  } catch (e) {
    // Ohne diesen Fang liefert ein D1-Ausfall eine undurchsichtige 500 ohne
    // JSON-Körper — die App zeigt dann nur "storage.get fehlgeschlagen: 500".
    console.error("D1-Lesezugriff fehlgeschlagen", e);
    return json({ error: "Datenbankzugriff fehlgeschlagen" }, 503);
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
  const { key, value, shared } = body;

  if (typeof key !== "string" || !key) {
    return json({ error: "key fehlt" }, 400);
  }
  // Die Spalte ist als TEXT NOT NULL deklariert: null oder ein Objekt liesse
  // den D1-Aufruf mit einer nichtssagenden 500 auflaufen statt mit einer
  // verständlichen 400.
  if (typeof value !== "string") {
    return json({ error: "value muss ein String sein" }, 400);
  }
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
    return json({ error: "value ist zu gross" }, 413);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO kv_store (full_key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(full_key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
      .bind(fullKey(key, shared), value)
      .run();
  } catch (e) {
    console.error("D1-Schreibzugriff fehlgeschlagen", e);
    return json({ error: "Speichern in der Datenbank fehlgeschlagen" }, 503);
  }

  return json({ key, value, shared: !!shared });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const shared = url.searchParams.get("shared") === "true";

  if (!key) {
    return json({ error: "key fehlt" }, 400);
  }

  try {
    await env.DB.prepare("DELETE FROM kv_store WHERE full_key = ?")
      .bind(fullKey(key, shared))
      .run();
  } catch (e) {
    console.error("D1-Löschzugriff fehlgeschlagen", e);
    return json({ error: "Löschen in der Datenbank fehlgeschlagen" }, 503);
  }

  return json({ key, deleted: true, shared });
}
