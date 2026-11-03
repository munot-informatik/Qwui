// Electron-Hauptprozess der Qwui-Desktop-Version. Lädt den bestehenden
// React/Vite-Build (dist/index.html) unverändert und stellt über IPC eine
// lokale SQLite-Datenbank bereit — die gesamte UI/Business-Logik bleibt
// dieselbe wie in der Web-App, nur der Speicher-Adapter ist ausgetauscht
// (siehe src/electronStorage.js, src/main.jsx).
//
// Bis 1.1 lagen die Daten in Qwui-Daten.xlsx. Beim ersten Start mit 1.2.0
// werden sie einmalig übernommen (migrateExcel.js); die Excel-Datei bleibt
// unverändert als Sicherung liegen.

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getDataDir, getWorkbookPath, getCompanyPath, getDatabasePath, getSecretsPath } from "./dataDir.js";
import { readCompany } from "./companyStore.js";
import { readCustomersList, readReceiptsList, readInventoryList } from "./excelStore.js";
import { storeLogo, loadLogo } from "./logoCache.js";
import { openStore } from "./sqliteStore.js";
import { migrateFromExcel } from "./migrateExcel.js";
import { createSecretStore } from "./secrets.js";
import { createMailer, emptySmtpSettings, validateSmtpSettings, SMTP_PASSWORD_SECRET } from "./mailer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Verhindert, dass zwei .exe-Instanzen gleichzeitig auf dieselbe Datenbank
// schreiben — die zweite Instanz fokussiert nur das bestehende Fenster.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let store = null;

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
          // Nur noch die Sicherung aus Qwui 1.1 — die Daten selbst liegen ab
          // 1.2.0 in qwui.db.
          ...(existsSync(getWorkbookPath())
            ? [
                {
                  label: "Excel-Sicherung aus Version 1.1 öffnen",
                  click: () => shell.openPath(getWorkbookPath()),
                },
              ]
            : []),
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
  // (get/set/setMany/delete/list, siehe src/apiStorage.js). "shared" wird nur
  // für Signatur-Kompatibilität akzeptiert und ignoriert — die
  // Desktop-Version kennt keine geteilten/privaten Bereiche, alles ist lokal.

  ipcMain.handle("storage:get", async (_event, key, shared) => {
    const row = await store.get(key);
    return row ? { ...row, shared } : null;
  });

  ipcMain.handle("storage:set", async (_event, key, value, shared) => {
    await store.set(key, value);
    return { key, value, shared };
  });

  ipcMain.handle("storage:setMany", async (_event, entries, shared) => {
    const result = await store.setMany(entries);
    return { ...result, shared };
  });

  ipcMain.handle("storage:delete", async (_event, key, shared) => {
    const result = await store.delete(key);
    return { ...result, shared };
  });

  ipcMain.handle("storage:list", async (_event, prefix, shared) => {
    const result = await store.list(prefix || "");
    return { ...result, shared };
  });

  // ---- E-Mail-Versand (nur Desktop) ----
  // Das Passwort verlässt den Hauptprozess nie: die App erfährt nur, ob eines
  // gespeichert ist.

  const SMTP_SETTINGS_META = "smtp-settings";
  let secrets = null;
  let mailer = null;

  function readSmtpSettings() {
    return { ...emptySmtpSettings, ...(store.getMeta(SMTP_SETTINGS_META) || {}) };
  }

  ipcMain.handle("mail:getSettings", async () => ({
    settings: readSmtpSettings(),
    passwordSet: secrets.has(SMTP_PASSWORD_SECRET),
  }));

  // password: null = unverändert lassen, "" = löschen, sonst neu setzen.
  ipcMain.handle("mail:saveSettings", async (_event, settings, password) => {
    const next = { ...emptySmtpSettings };
    for (const key of Object.keys(emptySmtpSettings)) {
      if (settings && settings[key] !== undefined) next[key] = settings[key];
    }
    next.port = Number(next.port);
    const errors = validateSmtpSettings(next);
    if (errors.length) return { ok: false, errors };
    store.setMeta(SMTP_SETTINGS_META, next);
    if (password === "") secrets.delete(SMTP_PASSWORD_SECRET);
    else if (typeof password === "string") secrets.set(SMTP_PASSWORD_SECRET, password);
    return { ok: true, passwordSet: secrets.has(SMTP_PASSWORD_SECRET) };
  });

  // Fehler gehen als Text zurück statt als Ausnahme: so kann die App die
  // Meldung des SMTP-Servers anzeigen und an der Quittung festhalten.
  ipcMain.handle("mail:sendTest", async (_event, to) => {
    try {
      await mailer.sendTest(to);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle("mail:sendReceipt", async (_event, payload) => {
    try {
      await mailer.sendReceipt(payload || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  function openSecretsAndMailer() {
    secrets = createSecretStore(getSecretsPath(), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (buffer) => safeStorage.decryptString(buffer),
    });
    mailer = createMailer({
      getSettings: readSmtpSettings,
      getPassword: () => secrets.get(SMTP_PASSWORD_SECRET),
    });
  }

  // Datenbank öffnen und Altdaten übernehmen, BEVOR das Fenster lädt — sonst
  // sähe die App beim ersten Start mit 1.2.0 kurz eine leere Datenbank.
  async function openDatabase() {
    store = openStore(getDatabasePath(), { storeLogo, loadLogo });
    const result = await migrateFromExcel(
      store,
      {
        workbookExists: existsSync(getWorkbookPath()),
        companyExists: existsSync(getCompanyPath()),
        readCompany,
        readCustomers: readCustomersList,
        readReceipts: readReceiptsList,
        readInventory: readInventoryList,
      },
      { now: new Date().toISOString(), newId: () => randomUUID().slice(0, 8) }
    );
    if (result.migrated) {
      console.log("Daten aus Qwui-Daten.xlsx übernommen", result.meta.counts);
    }
    openSecretsAndMailer();
  }

  app.whenReady().then(async () => {
    try {
      await openDatabase();
    } catch (e) {
      // Ohne Datenbank wäre jede Eingabe verloren — lieber klar abbrechen
      // als eine App zeigen, die scheinbar speichert.
      console.error("Datenbank konnte nicht geöffnet werden", e);
      dialog.showErrorBox(
        "Qwui kann die Daten nicht öffnen",
        `Die Datenbank in ${getDataDir()} konnte nicht geöffnet oder die Excel-Datei ` +
          `aus Version 1.1 nicht übernommen werden. Die Excel-Datei ist unverändert.\n\n${e.message}`
      );
      app.quit();
      return;
    }
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    if (store) store.close();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
