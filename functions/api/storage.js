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

import { validateEntries, writeResponse, requireJson } from "./storage-batch.js";

function fullKey(key, shared) {
  return `${shared === "true" || shared === true ? "shared" : "personal"}:${key}`;
}

// Reine Missbrauchsbremse, bewusst WEIT über allem, was D1 selbst noch
// annimmt (D1 begrenzt einen einzelnen Wert auf deutlich weniger). Diese
// Grenze darf niemals diejenige sein, die als erste zuschlägt — sonst würde
// sie Daten ablehnen, die heute funktionieren. Sie soll nur verhindern, dass
// ein einzelner Request unbegrenzt viel in die Datenbank schiebt.
//
// Logos der Quittungen lagert src/webLogoStore.js unter «logo:<hash>» aus,
// grosse Werte zerlegt src/apiStorage.js in Teile — beides hält die einzelnen
// Werte unter der Grenze von D1. Die Grenze hier steht in storage-batch.js
// (validateEntries).

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
    const row = await env.DB.prepare("SELECT value, updated_at FROM kv_store WHERE full_key = ?")
      .bind(fullKey(key, shared))
      .first();

    if (!row) return json(null);

    // version: zum Schutz vor gleichzeitigen Geräten (siehe storage-batch.js).
    return json({ key, value: row.value, shared, version: row.updated_at });
  } catch (e) {
    // Ohne diesen Fang liefert ein D1-Ausfall eine undurchsichtige 500 ohne
    // JSON-Körper — die App zeigt dann nur "storage.get fehlgeschlagen: 500".
    console.error("D1-Lesezugriff fehlgeschlagen", e);
    return json({ error: "Datenbankzugriff fehlgeschlagen" }, 503);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const notJson = requireJson(request);
  if (notJson) return notJson;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungültiges JSON im Request-Body" }, 400);
  }
  const { key, value, shared, expected } = body || {};
  // Gleiche Prüfungen und gleicher Schreibweg wie der Batch — inklusive
  // Versionsprüfung gegen gleichzeitige Geräte.
  const entries = [{ key, value, shared, expected }];
  const invalid = validateEntries(entries);
  if (invalid) return invalid;
  return writeResponse(env.DB, entries);
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
