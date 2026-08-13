// Electron-Hauptprozess der Qwui-Desktop-Version. Lädt den bestehenden
// React/Vite-Build (dist/index.html) unverändert und stellt über IPC eine
// lokale Excel-/JSON-Datenbank bereit — die gesamte UI/Business-Logik bleibt
// dieselbe wie in der Web-App, nur der Speicher-Adapter ist ausgetauscht
// (siehe src/electronStorage.js, src/main.jsx).

import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDataDir, getWorkbookPath } from "./dataDir.js";
import { readCompany, writeCompany } from "./companyStore.js";
import { readCustomersList, writeCustomersList, readReceiptsList, writeReceiptsList } from "./excelStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Verhindert, dass zwei .exe-Instanzen gleichzeitig auf dieselbe Excel-Datei
// schreiben — die zweite Instanz fokussiert nur das bestehende Fenster.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: {
        // .cjs statt .js: preload-Skripte laufen in Electrons heikelstem
        // Modul-Kontext, dort ist CommonJS (require) am zuverlässigsten —
        // unabhängig vom "type":"module" in package.json.
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Ohne diese beiden Handler funktionieren "Per E-Mail senden" und "Per
    // WhatsApp senden" in der Desktop-Version nicht: window.location.href =
    // "mailto:…" würde Chromium im Renderer selbst zu navigieren versuchen
    // (kein Protokoll-Handler -> passiert nichts bzw. die App verschwindet),
    // und window.open("https://wa.me/…") würde ein nacktes Electron-Fenster
    // ohne Adressleiste öffnen statt den Standardbrowser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
      // Die eigene App (file:// bzw. der Dev-Server) darf normal navigieren,
      // alles andere gehört ins Betriebssystem.
      if (isInternalUrl(url)) return;
      event.preventDefault();
      openExternally(url);
    });

    const devServerUrl = process.env.QWUI_DEV_SERVER_URL;
    if (devServerUrl) {
      mainWindow.loadURL(devServerUrl);
    } else {
      mainWindow.loadFile(join(__dirname, "dist", "index.html"));
    }

    buildMenu();
  }

  // Nur Protokolle weiterreichen, die auch wirklich für den Nutzer gedacht
  // sind — kein blindes shell.openExternal() auf beliebige Schemata (z.B.
  // "file:" oder Windows-eigene Handler), das wäre ein bequemer Weg, aus der
  // Seite heraus Programme zu starten.
  const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);

  function isInternalUrl(url) {
    const devServerUrl = process.env.QWUI_DEV_SERVER_URL;
    if (url.startsWith("file://")) return true;
    if (devServerUrl && url.startsWith(devServerUrl)) return true;
    return false;
  }

  function openExternally(url) {
    let protocol;
    try {
      protocol = new URL(url).protocol;
    } catch (e) {
      return;
    }
    if (EXTERNAL_PROTOCOLS.has(protocol)) {
      shell.openExternal(url);
    }
  }

  function buildMenu() {
    const template = [
      {
        label: "Qwui",
        submenu: [
          {
            label: "Datenordner öffnen",
            click: () => shell.openPath(getDataDir()),
          },
          {
            label: "Excel-Datei öffnen",
            click: () => shell.openPath(getWorkbookPath()),
          },
          { type: "separator" },
          { role: "reload" },
          { type: "separator" },
          { role: "quit", label: "Beenden" },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // ---- IPC: spiegelt exakt das window.storage-Interface der Web-App ----
  // (get/set/delete/list, siehe src/apiStorage.js). "shared" wird nur für
  // Signatur-Kompatibilität akzeptiert und ignoriert — die Desktop-Version
  // kennt keine geteilten/privaten Bereiche, alles ist lokal.

  ipcMain.handle("storage:get", async (_event, key, shared) => {
    if (key === "company-info") {
      const company = await readCompany();
      return company ? { key, value: JSON.stringify(company), shared } : null;
    }
    if (key === "customers-list") {
      const list = await readCustomersList();
      return { key, value: JSON.stringify(list), shared };
    }
    if (key === "receipts-list") {
      const list = await readReceiptsList();
      return { key, value: JSON.stringify(list), shared };
    }
    return null;
  });

  ipcMain.handle("storage:set", async (_event, key, value, shared) => {
    if (key === "company-info") {
      await writeCompany(JSON.parse(value));
    } else if (key === "customers-list") {
      await writeCustomersList(JSON.parse(value));
    } else if (key === "receipts-list") {
      await writeReceiptsList(JSON.parse(value));
    }
    return { key, value, shared };
  });

  ipcMain.handle("storage:delete", async (_event, key, shared) => {
    if (key === "customers-list") await writeCustomersList([]);
    else if (key === "receipts-list") await writeReceiptsList([]);
    return { key, deleted: true, shared };
  });

  ipcMain.handle("storage:list", async (_event, prefix, shared) => {
    const keys = ["company-info", "customers-list", "receipts-list"].filter((k) =>
      k.startsWith(prefix || "")
    );
    return { keys, prefix, shared };
  });

  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
