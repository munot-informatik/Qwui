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
import { randomUUID, randomBytes } from "node:crypto";
import { getDataDir, getWorkbookPath, getCompanyPath, getDatabasePath, getSecretsPath } from "./dataDir.js";
import { readCompany } from "./companyStore.js";
import { readCustomersList, readReceiptsList, readInventoryList } from "./excelStore.js";
import { storeLogo, loadLogo } from "./logoCache.js";
import { openStore } from "./sqliteStore.js";
import { migrateFromExcel } from "./migrateExcel.js";
import { createSecretStore } from "./secrets.js";
import { createMailer, emptySmtpSettings, validateSmtpSettings, SMTP_PASSWORD_SECRET } from "./mailer.js";
import { checkBackupPassword, decryptBackup } from "./backupCrypto.js";
import { createAutoBackup, notReadyReason, KIND, BACKUP_PASSWORD_SECRET } from "./autoBackup.js";
// Kopie von ../shared (scripts/copy-shared.js), damit sie mit eingepackt wird.
import { buildBackupPayload } from "./shared/backupFormat.js";
import { buildShopFeed, shopFeedCsv, feedFingerprint } from "./shared/shopFeed.js";
import { createShopSync, emptyShopConfig, validateWebhookUrl, SHOP_WEBHOOK_TOKEN_SECRET } from "./shopSync.js";
import { runAssistantTool, TOOL_NAMES } from "./shared/assistantTools.js";
import { DRAFT_STATUS } from "./shared/drafts.js";
import { createLocalApi, API_TOKEN_SECRET, DEFAULT_API_PORT } from "./localApi.js";
import { writeEvaluation } from "./excelExport.js";

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
          {
            label: "Excel-Auswertung erstellen…",
            click: () => exportEvaluation().catch((e) => dialog.showErrorBox("Excel-Auswertung", e.message)),
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
  // (get/set/setMany/delete/list, siehe src/apiStorage.js). "shared" wird nur
  // für Signatur-Kompatibilität akzeptiert und ignoriert — die
  // Desktop-Version kennt keine geteilten/privaten Bereiche, alles ist lokal.

  ipcMain.handle("storage:get", async (_event, key, shared) => {
    const row = await store.get(key);
    return row ? { ...row, shared } : null;
  });

  ipcMain.handle("storage:set", async (_event, key, value, shared) => {
    await store.set(key, value);
    afterWrite([key]);
    return { key, value, shared };
  });

  ipcMain.handle("storage:setMany", async (_event, entries, shared) => {
    const result = await store.setMany(entries);
    afterWrite(entries.map((e) => e.key));
    return { ...result, shared };
  });

  // Bestand und Preise stecken in Inventar, Exemplaren und Lagerbewegungen —
  // ändert sich einer davon, geht ein neuer Shop-Feed hinaus.
  function afterWrite(keys) {
    if (shopSync && keys.some((k) => k === "inventory-list" || k === "serial-units" || k.startsWith("stock-movements-"))) {
      shopSync.trigger();
    }
  }

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

  // ---- Automatische Sicherung (nur Desktop) ----

  const BACKUP_CONFIG_META = "backup-config";
  const BACKUP_STATUS_META = "backup-status";
  const BACKUP_CHECK_MS = 5 * 60 * 1000;
  let autoBackup = null;

  function readBackupConfig() {
    return { enabled: false, dir: "", ...(store.getMeta(BACKUP_CONFIG_META) || {}) };
  }

  // Alles, was in eine Sicherung gehört — dieselbe Form wie «Alle Daten
  // exportieren» in der App, dazu die Einstellungen ohne Passwörter.
  async function buildStorePayload() {
    const read = async (key, fallback) => {
      const row = await store.get(key);
      return row ? JSON.parse(row.value) : fallback;
    };
    const movementsByKey = {};
    for (const key of (await store.list("stock-movements-")).keys) {
      movementsByKey[key] = await read(key, []);
    }
    const { dir, enabled } = readBackupConfig();
    return buildBackupPayload({
      company: await read("company-info", {}),
      customers: await read("customers-list", []),
      receipts: await read("receipts-list", []),
      inventory: await read("inventory-list", []),
      units: await read("serial-units", []),
      movementsByKey,
      settings: { smtp: readSmtpSettings(), backup: { dir, enabled } },
    });
  }

  function backupState() {
    const config = readBackupConfig();
    const passwordSet = secrets.has(BACKUP_PASSWORD_SECRET);
    return {
      config,
      passwordSet,
      notReady: notReadyReason(config, passwordSet),
      status: store.getMeta(BACKUP_STATUS_META) || {},
    };
  }

  ipcMain.handle("backup:getState", async () => backupState());

  // password: null = unverändert lassen, sonst neu setzen (mind. 8 Zeichen).
  ipcMain.handle("backup:saveConfig", async (_event, config, password) => {
    if (typeof password === "string") {
      const problem = checkBackupPassword(password);
      if (problem) return { ok: false, error: problem };
      secrets.set(BACKUP_PASSWORD_SECRET, password);
    }
    store.setMeta(BACKUP_CONFIG_META, { enabled: !!config?.enabled, dir: String(config?.dir || "") });
    // Gleich sichern, was fällig ist — nicht erst beim nächsten Zeitgeber —,
    // damit die App den Status der ersten Sicherung sofort anzeigen kann.
    try {
      await autoBackup.tick();
    } catch (e) {
      console.error("Sicherung fehlgeschlagen", e);
    }
    return { ok: true, ...backupState() };
  });

  ipcMain.handle("backup:chooseDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Zielordner für die automatische Sicherung",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("backup:runNow", async () => {
    await autoBackup.runBackup(KIND.hourly);
    return backupState();
  });

  // Entschlüsselt eine gewählte Sicherung für die Import-Vorschau. Das
  // Passwort wird dabei nicht gespeichert — beim Wiederherstellen auf einem
  // neuen PC ist es oft ein anderes Konto oder ein anderes Passwort.
  ipcMain.handle("backup:decrypt", async (_event, fileText, password) => {
    try {
      return { ok: true, json: decryptBackup(fileText, password) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Einstellungen aus einer Sicherung übernehmen (ohne Passwörter, die müssen
  // auf dem neuen PC neu eingegeben werden).
  ipcMain.handle("backup:restoreSettings", async (_event, settings) => {
    if (settings?.smtp && validateSmtpSettings(settings.smtp).length === 0) {
      const next = { ...emptySmtpSettings };
      for (const key of Object.keys(emptySmtpSettings)) {
        if (settings.smtp[key] !== undefined) next[key] = settings.smtp[key];
      }
      store.setMeta(SMTP_SETTINGS_META, next);
    }
    if (settings?.backup) {
      store.setMeta(BACKUP_CONFIG_META, { enabled: !!settings.backup.enabled, dir: String(settings.backup.dir || "") });
    }
    return { ok: true };
  });

  function startAutoBackup() {
    autoBackup = createAutoBackup({
      buildPayload: buildStorePayload,
      getConfig: readBackupConfig,
      getPassword: () => secrets.get(BACKUP_PASSWORD_SECRET),
      readStatus: () => store.getMeta(BACKUP_STATUS_META),
      writeStatus: (status) => store.setMeta(BACKUP_STATUS_META, status),
    });
    const tick = () => autoBackup.tick().catch((e) => console.error("Sicherung fehlgeschlagen", e));
    // Kurz nach dem Start, dann alle fünf Minuten nachsehen, ob etwas fällig ist.
    setTimeout(tick, 30 * 1000);
    setInterval(tick, BACKUP_CHECK_MS);
  }

  // ---- Shop-Abgleich (nur Desktop, nur ausgehend) ----

  const SHOP_CONFIG_META = "shop-config";
  const SHOP_STATUS_META = "shop-status";
  let shopSync = null;

  function readShopConfig() {
    return { ...emptyShopConfig, ...(store.getMeta(SHOP_CONFIG_META) || {}) };
  }

  async function buildCurrentFeed() {
    const read = async (key) => {
      const row = await store.get(key);
      return row ? JSON.parse(row.value) : [];
    };
    const feed = buildShopFeed(await read("inventory-list"), await read("serial-units"));
    return { feed, csv: shopFeedCsv(feed), fingerprint: feedFingerprint(feed) };
  }

  async function shopState() {
    const { feed } = await buildCurrentFeed();
    return {
      config: readShopConfig(),
      tokenSet: secrets.has(SHOP_WEBHOOK_TOKEN_SECRET),
      status: store.getMeta(SHOP_STATUS_META) || {},
      // Vorschau für die App: genau das, was der Shop bekommt.
      feed,
    };
  }

  ipcMain.handle("shop:getState", async () => shopState());

  // token: null = unverändert lassen, "" = löschen, sonst neu setzen.
  ipcMain.handle("shop:saveConfig", async (_event, config, token) => {
    const next = {
      fileEnabled: !!config?.fileEnabled,
      fileDir: String(config?.fileDir || ""),
      webhookEnabled: !!config?.webhookEnabled,
      webhookUrl: String(config?.webhookUrl || "").trim(),
    };
    if (next.fileEnabled && !next.fileDir) return { ok: false, error: "Bitte einen Ordner für den Datei-Feed wählen." };
    if (next.webhookEnabled) {
      const problem = validateWebhookUrl(next.webhookUrl);
      if (problem) return { ok: false, error: problem };
    }
    store.setMeta(SHOP_CONFIG_META, next);
    if (token === "") secrets.delete(SHOP_WEBHOOK_TOKEN_SECRET);
    else if (typeof token === "string") secrets.set(SHOP_WEBHOOK_TOKEN_SECRET, token);
    return { ok: true, ...(await shopState()) };
  });

  ipcMain.handle("shop:chooseDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Ordner für den Shop-Feed",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("shop:syncNow", async () => {
    await shopSync.syncNow();
    return shopState();
  });

  function startShopSync() {
    shopSync = createShopSync({
      buildFeed: buildCurrentFeed,
      getConfig: readShopConfig,
      getToken: () => secrets.get(SHOP_WEBHOOK_TOKEN_SECRET),
      readStatus: () => store.getMeta(SHOP_STATUS_META),
      writeStatus: (status) => store.setMeta(SHOP_STATUS_META, status),
    });
  }

  // ---- Lokale Schnittstelle für den Assistenten (nur Desktop) ----
  // Standardmässig aus. Lesende Werkzeuge geben keine Personendaten heraus,
  // schreibende legen nur Entwürfe an (siehe shared/assistantTools.js).

  const API_CONFIG_META = "api-config";
  const API_LOG_META = "api-log";
  const DRAFTS_META = "assistant-drafts";
  const API_LOG_MAX = 500;
  let localApi = null;
  let apiError = null;

  function readApiConfig() {
    return { enabled: false, port: DEFAULT_API_PORT, ...(store.getMeta(API_CONFIG_META) || {}) };
  }

  function ensureApiToken() {
    if (!secrets.get(API_TOKEN_SECRET)) secrets.set(API_TOKEN_SECRET, randomBytes(24).toString("base64url"));
    return secrets.get(API_TOKEN_SECRET);
  }

  function appendApiLog(entry) {
    const log = store.getMeta(API_LOG_META) || [];
    log.push(entry);
    store.setMeta(API_LOG_META, log.slice(-API_LOG_MAX));
  }

  function readDrafts() {
    return store.getMeta(DRAFTS_META) || [];
  }

  function notifyDraftsChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("drafts:changed");
  }

  async function readAssistantData() {
    const read = async (key, fallback) => {
      const row = await store.get(key);
      return row ? JSON.parse(row.value) : fallback;
    };
    const movements = [];
    for (const key of (await store.list("stock-movements-")).keys) movements.push(...(await read(key, [])));
    return {
      inventory: await read("inventory-list", []),
      units: await read("serial-units", []),
      receipts: await read("receipts-list", []),
      movements,
    };
  }

  // Für backup_status: Zeitpunkte und Ergebnis, ohne Ordnerpfad.
  function backupStatusForAssistant() {
    const { notReady, status } = backupState();
    const brief = (s) => (s ? { zuletztErfolgreich: s.lastSuccessAt || null, letzterVersuch: s.at || null, ok: !!s.ok, fehler: s.ok ? null : s.error || null } : null);
    return { aktiv: !notReady, hinweis: notReady, stuendlich: brief(status.stuendlich), taeglich: brief(status.taeglich) };
  }

  async function applyApiConfig() {
    const config = readApiConfig();
    apiError = null;
    try {
      if (config.enabled) {
        ensureApiToken();
        await localApi.start(Number(config.port) || DEFAULT_API_PORT);
      } else {
        await localApi.stop();
      }
    } catch (e) {
      apiError = e.code === "EADDRINUSE" ? `Port ${config.port} ist bereits belegt — bitte einen anderen wählen.` : e.message;
      await localApi.stop();
    }
  }

  function apiState() {
    const config = readApiConfig();
    return {
      config,
      token: config.enabled ? secrets.get(API_TOKEN_SECRET) : null,
      running: localApi.running,
      error: apiError,
      log: (store.getMeta(API_LOG_META) || []).slice(-100).reverse(),
    };
  }

  ipcMain.handle("api:getState", async () => apiState());

  ipcMain.handle("api:saveConfig", async (_event, config) => {
    const port = Number(config?.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { ok: false, error: "Port muss zwischen 1024 und 65535 liegen." };
    }
    store.setMeta(API_CONFIG_META, { enabled: !!config?.enabled, port });
    await applyApiConfig();
    return { ok: !apiError, error: apiError, ...apiState() };
  });

  // Neues Token: das alte gilt sofort nicht mehr (z. B. wenn es in falsche
  // Hände geraten ist). Claude Desktop muss danach neu eingerichtet werden.
  ipcMain.handle("api:regenerateToken", async () => {
    secrets.set(API_TOKEN_SECRET, randomBytes(24).toString("base64url"));
    return apiState();
  });

  ipcMain.handle("drafts:list", async () => readDrafts());

  // Nur offene Entwürfe lassen sich übernehmen oder verwerfen — ein zweites
  // «Übernehmen» desselben Entwurfs bucht nichts doppelt.
  ipcMain.handle("drafts:setStatus", async (_event, id, status) => {
    if (![DRAFT_STATUS.accepted, DRAFT_STATUS.rejected].includes(status)) return { ok: false, error: "Unbekannter Status." };
    const drafts = readDrafts();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return { ok: false, error: "Entwurf nicht gefunden." };
    if (draft.status !== DRAFT_STATUS.open) return { ok: false, error: `Entwurf ist bereits ${draft.status}.` };
    store.setMeta(
      DRAFTS_META,
      drafts.map((d) => (d.id === id ? { ...d, status, decidedAt: new Date().toISOString() } : d))
    );
    notifyDraftsChanged();
    return { ok: true };
  });

  // ---- Excel-Auswertung (Kunden, Zahlungen, Inventar, Exemplare, Bewegungen) ----
  // Nur noch zum Ansehen und Weitergeben; die Daten selbst liegen in qwui.db.

  async function exportEvaluation() {
    const today = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Excel-Auswertung speichern",
      defaultPath: join(getDataDir(), `Qwui-Auswertung_${today}.xlsx`),
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const data = await readAssistantData();
    const customers = await store.get("customers-list");
    await writeEvaluation(result.filePath, { ...data, customers: customers ? JSON.parse(customers.value) : [] });
    shell.showItemInFolder(result.filePath);
    return { ok: true, path: result.filePath };
  }

  ipcMain.handle("export:evaluation", async () => {
    try {
      return await exportEvaluation();
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  async function startLocalApi() {
    localApi = createLocalApi({
      getToken: () => secrets.get(API_TOKEN_SECRET),
      toolNames: TOOL_NAMES,
      log: appendApiLog,
      runTool: (name, args) =>
        runAssistantTool(name, args, {
          readData: readAssistantData,
          addDraft: async (draft) => {
            // Höchstens 200 Entwürfe behalten; die ältesten erledigten fallen weg.
            const drafts = [...readDrafts(), draft];
            const open = drafts.filter((d) => d.status === DRAFT_STATUS.open);
            const done = drafts.filter((d) => d.status !== DRAFT_STATUS.open);
            store.setMeta(DRAFTS_META, [...done.slice(-Math.max(0, 200 - open.length)), ...open]);
            notifyDraftsChanged();
          },
          getBackupStatus: backupStatusForAssistant,
          now: () => new Date(),
          newId: () => randomUUID().slice(0, 8),
        }),
    });
    await applyApiConfig();
  }

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
    startAutoBackup();
    startShopSync();
    await startLocalApi();
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
    if (localApi) localApi.stop();
    if (store) store.close();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
