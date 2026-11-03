// Lokale Datenbank der Desktop-Version ab 1.2.0: eine SQLite-Datei
// (Qwui-Daten\qwui.db) mit derselben kv_store-Tabelle wie Cloudflare D1
// (siehe schema.sql). Dadurch sieht die App unter Windows exakt dieselbe
// get/set/setMany/delete/list-Schnittstelle wie im Web, und die App-Logik
// bleibt für beide Versionen gleich.
//
// Löst die Excel-Datei als Datenbank ab: SQLite verträgt, dass App,
// Shop-Abgleich und lokale API kurz nacheinander schreiben, und scheitert
// nicht daran, dass jemand die Datei in Excel geöffnet hat. Zugriff hat
// trotzdem nur der Electron-Hauptprozess — alle anderen gehen über ihn.
//
// Nutzt das in Electron (Node 24) eingebaute node:sqlite statt eines nativen
// Zusatzmoduls, das für jede Electron-Version neu kompiliert werden müsste.
//
// Logos werden wie bisher aus den Quittungen in eigene Dateien ausgelagert
// (logoCache.js) — sonst wüchse die Quittungsliste um ~100 KB pro Quittung.
// Die Funktionen dafür werden übergeben, damit dieses Modul ohne Electron
// testbar bleibt.

import { DatabaseSync } from "node:sqlite";

const RECEIPTS_KEY = "receipts-list";

// Wie in functions/api/storage.js. Die Desktop-Version kennt keine geteilten
// Bereiche; das Präfix bleibt trotzdem gleich, damit ein späterer Abgleich
// mit D1 dieselben Schlüssel vorfindet.
function fullKey(key) {
  return `personal:${key}`;
}

const SCOPE_PREFIX = "personal:";
// Interne Einträge (z. B. Migrationsstand) liegen ausserhalb von "personal:"
// und tauchen deshalb in list() nie auf.
const META_PREFIX = "meta:";

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function openStore(dbPath, { storeLogo, loadLogo } = {}) {
  const db = new DatabaseSync(dbPath);
  // WAL: Lesen blockiert Schreiben nicht, und ein Absturz mitten im
  // Schreiben hinterlässt eine konsistente Datei.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      full_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kv_store_prefix ON kv_store(full_key);
  `);

  const selectOne = db.prepare("SELECT value FROM kv_store WHERE full_key = ?");
  const upsert = db.prepare(
    `INSERT INTO kv_store (full_key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(full_key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  const remove = db.prepare("DELETE FROM kv_store WHERE full_key = ?");
  const selectKeys = db.prepare("SELECT full_key FROM kv_store WHERE full_key LIKE ? ESCAPE '\\'");

  // Mehrere Schreibvorgänge als eine Transaktion: alles oder nichts.
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  async function slimReceipts(value) {
    if (!storeLogo) return value;
    let receipts;
    try {
      receipts = JSON.parse(value);
    } catch (e) {
      return value;
    }
    if (!Array.isArray(receipts)) return value;
    const slim = [];
    for (const receipt of receipts) {
      let company = receipt?.company;
      if (company && company.logoDataUrl) {
        const stored = await storeLogo(company.logoDataUrl);
        if (stored) {
          company = { ...company, logoRef: stored.logoRef, logoMime: stored.logoMime };
          delete company.logoDataUrl;
        }
      }
      slim.push(company ? { ...receipt, company } : receipt);
    }
    return JSON.stringify(slim);
  }

  async function restoreReceipts(value) {
    if (!loadLogo) return value;
    let receipts;
    try {
      receipts = JSON.parse(value);
    } catch (e) {
      return value; // kaputtes JSON unverändert durchreichen, App.jsx meldet es
    }
    if (!Array.isArray(receipts)) return value;
    const restored = [];
    for (const receipt of receipts) {
      if (receipt?.company?.logoRef) {
        const logoDataUrl = await loadLogo(receipt.company.logoRef, receipt.company.logoMime);
        const company = { ...receipt.company, logoDataUrl };
        delete company.logoRef;
        delete company.logoMime;
        restored.push({ ...receipt, company });
      } else {
        restored.push(receipt);
      }
    }
    return JSON.stringify(restored);
  }

  async function prepareValue(key, value) {
    if (typeof value !== "string") throw new Error(`Wert für ${key} muss ein String sein`);
    return key === RECEIPTS_KEY ? slimReceipts(value) : value;
  }

  return {
    async get(key) {
      const row = selectOne.get(fullKey(key));
      if (!row) return null;
      const value = key === RECEIPTS_KEY ? await restoreReceipts(row.value) : row.value;
      return { key, value };
    },

    // Wie get(), aber ohne die Logos wieder einzusetzen — für Auswertungen
    // (Assistent, Excel), die keine Logos brauchen. Spart das Lesen einer
    // Logo-Datei pro Quittung.
    getRaw(key) {
      const row = selectOne.get(fullKey(key));
      return row ? { key, value: row.value } : null;
    },

    async set(key, value) {
      const prepared = await prepareValue(key, value);
      upsert.run(fullKey(key), prepared);
      return { key, value };
    },

    // entries: [{ key, value }]
    async setMany(entries) {
      const prepared = [];
      for (const { key, value } of entries) {
        prepared.push([fullKey(key), await prepareValue(key, value)]);
      }
      transaction(() => {
        for (const [k, v] of prepared) upsert.run(k, v);
      });
      return { keys: entries.map((e) => e.key) };
    },

    async delete(key) {
      remove.run(fullKey(key));
      return { key, deleted: true };
    },

    async list(prefix = "") {
      const rows = selectKeys.all(`${escapeLike(SCOPE_PREFIX + prefix)}%`);
      return { keys: rows.map((r) => r.full_key.slice(SCOPE_PREFIX.length)), prefix };
    },

    getMeta(name) {
      const row = selectOne.get(META_PREFIX + name);
      return row ? JSON.parse(row.value) : null;
    },

    // Einstellungen der Desktop-Version (z. B. SMTP ohne Passwort). Liegen
    // ausserhalb von "personal:" und damit nicht im Zugriff von
    // window.storage — die App ändert sie nur über eigene IPC-Aufrufe.
    setMeta(name, value) {
      upsert.run(META_PREFIX + name, JSON.stringify(value));
    },

    // Schreibt Daten und Meta-Eintrag in einer Transaktion — z. B. damit eine
    // Migration nur dann als erledigt gilt, wenn wirklich alles drin ist.
    async setManyWithMeta(entries, metaName, metaValue) {
      const prepared = [];
      for (const { key, value } of entries) {
        prepared.push([fullKey(key), await prepareValue(key, value)]);
      }
      transaction(() => {
        for (const [k, v] of prepared) upsert.run(k, v);
        upsert.run(META_PREFIX + metaName, JSON.stringify(metaValue));
      });
    },

    close() {
      db.close();
    },
  };
}
