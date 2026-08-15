// Echter, serverseitiger Passwortschutz für Cloudflare Pages.
// Läuft auf Cloudflares Edge-Netzwerk, BEVOR irgendeine Datei ausgeliefert wird.
// Das Passwort steht nirgends im ausgelieferten JavaScript und kann nicht über
// "Seitenquelltext ansehen" ausgelesen werden.
//
// Passwort wird über die Umgebungsvariable SITE_PASSWORD im Cloudflare-Dashboard
// gesetzt (Pages-Projekt → Settings → Environment variables) — steht NIRGENDS im Code.
//
// Cloudflare Pages führt diese Datei automatisch für JEDEN Request aus, da sie unter
// /functions/_middleware.js liegt (Cloudflare-Konvention, kein Import nötig).

// Bewusst hoch angesetzt. Vor dieser Middleware steht Cloudflare Access:
// unangemeldete Anfragen werden schon dort mit einer Weiterleitung abgewiesen
// und erreichen die Passwortprüfung nie. Das Passwort selbst ist 20 Zeichen
// lang — Durchprobieren ist ohnehin aussichtslos. Ein niedriges Limit würde
// deshalb keinen Angreifer aufhalten, sondern nur den rechtmässigen Nutzer
// aussperren (etwa wenn der Browser nach einer Passwortänderung noch das alte
// mitschickt). Bleibt als reine Bremse gegen davonlaufende Schleifen, die
// sonst unbegrenzt Schreibzugriffe auf D1 erzeugen würden.
const MAX_ATTEMPTS = 100;
const WINDOW_MS = 15 * 60 * 1000; // 15 Minuten

function unauthorized() {
  return new Response("Zugriff verweigert", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Qwui", charset="UTF-8"',
      // Verhindert, dass eine 401-Antwort (oder ein Zwischen-Proxy-Cache) die
      // spätere, erfolgreiche Antwort für dieselbe URL verdrängt.
      "Cache-Control": "no-store",
    },
  });
}

function tooManyAttempts(retryAfterSeconds) {
  return new Response("Zu viele fehlgeschlagene Versuche. Bitte später erneut versuchen.", {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

// Vergleicht zwei Strings anhand ihres SHA-256-Hashs statt direkt als Text.
// Dadurch ist die Vergleichszeit unabhängig von Länge/Inhalt des eingegebenen
// Passworts (kein Timing-Seitenkanal, über den sich das echte Passwort
// zeichenweise erraten liesse).
async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

// Rate-Limitierung gegen automatisiertes Passwort-Raten, gespeichert in
// derselben D1-Tabelle wie die App-Daten (kv_store). Zählt fehlgeschlagene
// Versuche pro IP in einem 15-Minuten-Fenster; ab MAX_ATTEMPTS wird die IP für
// den Rest des Fensters abgewiesen — auch dann, wenn das Passwort stimmt.
// Genau darauf kommt es an: würde erst verglichen und nur bei falschem
// Passwort gesperrt, könnte ein Angreifer beliebig weiterraten und beim
// Treffer trotzdem hereinkommen. Das Limit wäre dann reine Dekoration.

function rateLimitKey(ip) {
  return `ratelimit:auth:${ip}`;
}

// Kurzlebiger Cache im Arbeitsspeicher der Worker-Isolate. Der Browser schickt
// die Basic-Auth-Zugangsdaten bei JEDEM Request mit (auch für jedes Bild, JS-
// und CSS-File), und geprüft werden muss vor dem Passwortvergleich — ohne
// diesen Cache wäre das ein D1-Read pro Datei. Gecacht wird nur das negative
// Ergebnis ("nicht gesperrt") und nur für wenige Sekunden: ein Angreifer
// gewinnt dadurch höchstens CACHE_TTL_MS zusätzliche Versuche, ein normaler
// Seitenaufruf kommt mit einem einzigen D1-Read aus.
const CACHE_TTL_MS = 5000;
const notBlockedUntil = new Map();

async function isRateLimited(db, ip) {
  const cached = notBlockedUntil.get(ip);
  const now = Date.now();
  if (cached && cached > now) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  let state = null;
  try {
    const row = await db
      .prepare("SELECT value FROM kv_store WHERE full_key = ?")
      .bind(rateLimitKey(ip))
      .first();
    if (row) state = JSON.parse(row.value);
  } catch (e) {
    // D1 nicht erreichbar oder Eintrag kaputt -> Rate-Limit fällt aus, der
    // Passwortschutz selbst bleibt über den normalen Vergleich bestehen.
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const count = Number(state?.count);
  const windowStart = Number(state?.windowStart);
  const windowActive = Number.isFinite(windowStart) && now - windowStart < WINDOW_MS;

  if (!windowActive || !Number.isFinite(count) || count <= MAX_ATTEMPTS) {
    if (notBlockedUntil.size > 10000) notBlockedUntil.clear(); // Speicher deckeln
    notBlockedUntil.set(ip, now + CACHE_TTL_MS);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000)),
  };
}

// Erhöht den Zähler in EINER SQL-Anweisung. Das frühere Muster
// (SELECT -> in JS rechnen -> UPSERT) war nicht atomar: parallel abgefeuerte
// Versuche lasen alle denselben Stand und schrieben alle dieselbe Zahl zurück,
// womit sich das Limit durch simple Parallelität aushebeln liess.
// COALESCE/CAST fangen zusätzlich einen beschädigten Eintrag ab (CAST eines
// nicht-numerischen Werts ergibt in SQLite 0, nicht NaN).
async function recordFailedAttempt(db, ip) {
  const now = Date.now();
  notBlockedUntil.delete(ip);

  try {
    await db
      .prepare(
        `INSERT INTO kv_store (full_key, value, updated_at)
         VALUES (?1, json_object('count', 1, 'windowStart', ?2), datetime('now'))
         ON CONFLICT(full_key) DO UPDATE SET
           value = CASE
             WHEN ?2 - COALESCE(CAST(json_extract(kv_store.value, '$.windowStart') AS INTEGER), 0) >= ?3
               THEN json_object('count', 1, 'windowStart', ?2)
             ELSE json_object(
               'count', COALESCE(CAST(json_extract(kv_store.value, '$.count') AS INTEGER), 0) + 1,
               'windowStart', COALESCE(CAST(json_extract(kv_store.value, '$.windowStart') AS INTEGER), ?2))
           END,
           updated_at = datetime('now')`
      )
      .bind(rateLimitKey(ip), now, WINDOW_MS)
      .run();
  } catch (e) {
    // Siehe oben: Rate-Limit fällt aus, Passwortschutz bleibt bestehen.
  }

  // Abgelaufene Einträge gelegentlich aufräumen. Ohne das wächst kv_store mit
  // jeder neuen angreifenden IP dauerhaft weiter, da nichts die Zeilen je
  // wieder löscht.
  if (Math.random() < 0.05) {
    try {
      await db
        .prepare(
          `DELETE FROM kv_store
           WHERE full_key LIKE 'ratelimit:auth:%' AND updated_at < datetime('now', '-15 minutes')`
        )
        .run();
    } catch (e) {
      // Aufräumen ist Beiwerk, Fehler hier dürfen den Request nicht betreffen.
    }
  }
}

// Schreibende API-Aufrufe dürfen nur von der eigenen Seite kommen. Ohne diese
// Prüfung könnte eine fremde Seite ein Formular auf /api/storage abschicken:
// Basic-Auth-Zugangsdaten hängt der Browser bei so einer Navigation von sich
// aus an, und request.json() interessiert sich nicht für den Content-Type —
// eine per enctype="text/plain" verschickte Nutzlast reicht also aus, um im
// Namen des eingeloggten Nutzers Kunden oder Quittungen zu überschreiben.
function isCrossSiteWrite(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return false;
  if (request.method === "GET" || request.method === "HEAD") return false;

  // Von modernen Browsern gesetzt; "same-origin" bzw. "none" (direkter Aufruf)
  // sind in Ordnung, "cross-site"/"same-site" nicht.
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  // Fallback für Clients ohne Sec-Fetch-Site: Origin muss passen, wenn gesetzt.
  const origin = request.headers.get("Origin");
  if (origin) return origin !== url.origin;

  return false;
}

function forbidden(message) {
  return new Response(message, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  const password = env.SITE_PASSWORD;

  // Kein Passwort gesetzt -> App sicherheitshalber nicht offen lassen
  if (!password) {
    return unauthorized();
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const authHeader = request.headers.get("Authorization");

  if (authHeader && authHeader.startsWith("Basic ")) {
    // Sperre VOR dem Passwortvergleich prüfen — sonst käme ein Angreifer mit
    // einem Glückstreffer trotz überschrittenem Limit durch (siehe Kommentar
    // bei isRateLimited).
    const limit = await isRateLimited(env.DB, ip);
    if (limit.blocked) {
      return tooManyAttempts(limit.retryAfterSeconds);
    }

    let enteredPassword = null;
    try {
      const decoded = atob(authHeader.slice(6));
      const separatorIndex = decoded.indexOf(":");
      // Ohne ":" ist der Header ungültig — nicht den ganzen String als
      // Passwort durchreichen.
      if (separatorIndex !== -1) {
        enteredPassword = decoded.slice(separatorIndex + 1);
      }
    } catch (e) {
      // Ungültiges Base64 (z.B. von automatisierten Scans) -> wie einen
      // Fehlversuch behandeln statt mit 500 abzustürzen.
      enteredPassword = null;
    }

    if (enteredPassword !== null && (await constantTimeEqual(enteredPassword, password))) {
      if (isCrossSiteWrite(request)) {
        return forbidden("Schreibzugriff nur von der eigenen Seite erlaubt");
      }
      return context.next(); // Zugriff erlaubt, normale Seite ausliefern
    }

    await recordFailedAttempt(env.DB, ip);
    // Direkt nach dem Überschreiten des Limits schon sperren, statt erst beim
    // nächsten Request — auch auf dem Pfad mit kaputtem Header.
    const after = await isRateLimited(env.DB, ip);
    if (after.blocked) {
      return tooManyAttempts(after.retryAfterSeconds);
    }
  }

  return unauthorized();
}
