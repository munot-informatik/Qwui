// Preload-Skript: läuft mit Zugriff auf Node/Electron-Module, aber isoliert
// vom Seiteninhalt (contextIsolation: true). Stellt window.qwuiDesktopStorage
// bereit, das src/electronStorage.js (im Renderer/React-Code) 1:1 aufruft —
// dieselbe Signatur wie window.storage in der Web-App
// (get/set/delete/list mit key + shared-Flag), siehe src/apiStorage.js.
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
