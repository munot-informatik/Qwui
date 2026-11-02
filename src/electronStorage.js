// Speicher-Adapter für die Windows-Desktop-Version (Electron). Gleiche Signatur
// wie apiStorage.js (get/set/delete/list mit key + shared-Flag) — App.jsx muss
// dafür nicht angepasst werden.
//
// Reiner Passthrough: die eigentliche Excel-/JSON-Logik läuft im
// Electron-Hauptprozess (desktop/excelStore.js, desktop/companyStore.js), da nur
// dort Dateisystemzugriff besteht. window.qwuiDesktopStorage wird vom
// Preload-Skript (desktop/preload.cjs) per contextBridge bereitgestellt.

export const storageShim = {
  async get(key, shared = false) {
    return window.qwuiDesktopStorage.get(key, shared);
  },

  async set(key, value, shared = false) {
    return window.qwuiDesktopStorage.set(key, value, shared);
  },

  // entries: [{ key, value }] — im Hauptprozess eine SQLite-Transaktion.
  async setMany(entries, shared = false) {
    return window.qwuiDesktopStorage.setMany(entries, shared);
  },

  async delete(key, shared = false) {
    return window.qwuiDesktopStorage.delete(key, shared);
  },

  async list(prefix = "", shared = false) {
    return window.qwuiDesktopStorage.list(prefix, shared);
  },
};

export function installStorageShim() {
  if (typeof window !== "undefined") {
    window.storage = storageShim;
  }
}
