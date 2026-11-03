// Preload-Skript: läuft mit Zugriff auf Node/Electron-Module, aber isoliert
// vom Seiteninhalt (contextIsolation: true). Stellt window.qwuiDesktopStorage
// bereit, das src/electronStorage.js (im Renderer/React-Code) 1:1 aufruft —
// dieselbe Signatur wie window.storage in der Web-App
// (get/set/setMany/delete/list mit key + shared-Flag), siehe src/apiStorage.js.
//
// Dazu window.qwuiDesktop mit den Funktionen, die es nur unter Windows gibt
// (ab 1.2.0: E-Mail-Versand per SMTP, automatische Sicherung, Shop-Abgleich). Die Web-Version kennt dieses Objekt
// nicht und blendet die zugehörigen Bereiche aus.
//
// Bewusst .cjs (CommonJS/require) statt .js: preload-Skripte laufen in
// Electrons heikelstem Modul-Kontext, dort ist CommonJS am zuverlässigsten,
// unabhängig vom "type":"module" in desktop/package.json.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qwuiDesktopStorage", {
  get: (key, shared = false) => ipcRenderer.invoke("storage:get", key, !!shared),
  set: (key, value, shared = false) => ipcRenderer.invoke("storage:set", key, value, !!shared),
  setMany: (entries, shared = false) => ipcRenderer.invoke("storage:setMany", entries, !!shared),
  delete: (key, shared = false) => ipcRenderer.invoke("storage:delete", key, !!shared),
  list: (prefix = "", shared = false) => ipcRenderer.invoke("storage:list", prefix, !!shared),
});

contextBridge.exposeInMainWorld("qwuiDesktop", {
  mail: {
    getSettings: () => ipcRenderer.invoke("mail:getSettings"),
    // password: null = unverändert, "" = löschen
    saveSettings: (settings, password = null) => ipcRenderer.invoke("mail:saveSettings", settings, password),
    sendTest: (to) => ipcRenderer.invoke("mail:sendTest", to),
    // { to, subject, text, filename, pdf: Uint8Array }
    sendReceipt: (payload) => ipcRenderer.invoke("mail:sendReceipt", payload),
  },
  backup: {
    getState: () => ipcRenderer.invoke("backup:getState"),
    // password: null = unverändert
    saveConfig: (config, password = null) => ipcRenderer.invoke("backup:saveConfig", config, password),
    chooseDir: () => ipcRenderer.invoke("backup:chooseDir"),
    runNow: () => ipcRenderer.invoke("backup:runNow"),
    decrypt: (fileText, password) => ipcRenderer.invoke("backup:decrypt", fileText, password),
    restoreSettings: (settings) => ipcRenderer.invoke("backup:restoreSettings", settings),
  },
  shop: {
    getState: () => ipcRenderer.invoke("shop:getState"),
    // token: null = unverändert, "" = löschen
    saveConfig: (config, token = null) => ipcRenderer.invoke("shop:saveConfig", config, token),
    chooseDir: () => ipcRenderer.invoke("shop:chooseDir"),
    syncNow: () => ipcRenderer.invoke("shop:syncNow"),
  },
});
