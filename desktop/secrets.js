// Geheimnisse der Desktop-Version (SMTP-Passwort, später API-Token und
// Backup-Passwort). Liegen verschlüsselt in Qwui-Daten\geheim.bin — nie im
// Code, nie in der Datenbank, nie in einem Backup.
//
// Verschlüsselt wird mit Electrons safeStorage, unter Windows also mit DPAPI:
// Der Schlüssel gehört dem angemeldeten Windows-Benutzer. Kopiert jemand den
// Datenordner auf einen anderen PC oder in ein anderes Konto, lassen sich die
// Geheimnisse dort nicht entschlüsseln und müssen neu eingegeben werden —
// das ist gewollt.
//
// Ver- und Entschlüsselung werden übergeben (main.js: safeStorage), damit
// sich die Datei-Logik ohne Electron testen lässt.

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

// crypto: { isAvailable(), encrypt(string) -> Buffer, decrypt(Buffer) -> string }
export function createSecretStore(filePath, crypto) {
  function readAll() {
    if (!existsSync(filePath)) return {};
    try {
      return JSON.parse(crypto.decrypt(readFileSync(filePath)));
    } catch (e) {
      // Anderer PC/anderes Windows-Konto oder beschädigte Datei: so tun, als
      // gäbe es keine Geheimnisse. Sie müssen dann neu eingegeben werden.
      console.error("Geheimnisse konnten nicht entschlüsselt werden", e.message);
      return {};
    }
  }

  function writeAll(all) {
    if (!crypto.isAvailable()) {
      throw new Error("Die Verschlüsselung von Windows ist auf diesem PC nicht verfügbar — Passwörter können nicht gespeichert werden.");
    }
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, crypto.encrypt(JSON.stringify(all)));
    renameSync(tmp, filePath);
  }

  return {
    get(name) {
      const value = readAll()[name];
      return typeof value === "string" ? value : null;
    },
    has(name) {
      return typeof readAll()[name] === "string";
    },
    set(name, value) {
      const all = readAll();
      all[name] = String(value);
      writeAll(all);
    },
    delete(name) {
      const all = readAll();
      if (!(name in all)) return;
      delete all[name];
      writeAll(all);
    },
  };
}
