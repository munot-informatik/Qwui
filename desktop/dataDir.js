// Ermittelt den lokalen Datenordner für die Desktop-Version und legt ihn beim
// ersten Start an — direkt neben der .exe-Datei, wie gewünscht: eine .exe
// herunterladen, danach entsteht automatisch ein Ordner mit Excel-Datei,
// Firmendaten und Logos direkt daneben.
//
// electron-builders "portable"-Windows-Build entpackt sich beim Start selbst
// in einen Temp-Ordner, um zu laufen — das ist normales, unsichtbares
// Verhalten JEDER Single-Datei-.exe und betrifft nur Electrons eigene
// Laufzeitdateien (Chromium etc.), nicht unsere Daten. Für genau diesen Fall
// setzt der portable Launcher die Umgebungsvariable PORTABLE_EXECUTABLE_DIR
// auf den Ordner, in dem die .exe tatsächlich liegt (nicht den Temp-Ordner) —
// darüber legen wir unseren Datenordner an, sodass er stabil neben der .exe
// bleibt, egal wohin sich die .exe selbst gerade entpackt hat.

import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FOLDER_NAME = "Qwui-Daten";

let cachedDir = null;

function resolveBaseDir() {
  // Override für Tests/Entwicklung (siehe README) — im normalen Betrieb nicht
  // gesetzt. Ist hier bereits der vollständige Zielordner, kein FOLDER_NAME
  // mehr anhängen.
  if (process.env.QWUI_DATA_DIR) {
    return { dir: process.env.QWUI_DATA_DIR, appendFolderName: false };
  }
  // Von der portablen .exe selbst gesetzt: der Ordner, in dem die .exe-Datei
  // liegt (nicht der Temp-Ordner, in den sie sich beim Start entpackt hat).
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return { dir: process.env.PORTABLE_EXECUTABLE_DIR, appendFolderName: true };
  }
  // Fallback (z.B. unpacked-Build ohne portable-Wrapper, oder "npm run dev"):
  // Ordner neben der tatsächlichen .exe.
  return { dir: dirname(app.getPath("exe")), appendFolderName: true };
}

export function getDataDir() {
  if (cachedDir) return cachedDir;
  const { dir: base, appendFolderName } = resolveBaseDir();
  const dir = appendFolderName ? join(base, FOLDER_NAME) : base;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const logosDir = join(dir, "logos");
  if (!existsSync(logosDir)) {
    mkdirSync(logosDir, { recursive: true });
  }
  cachedDir = dir;
  return dir;
}

export function getLogosDir() {
  return join(getDataDir(), "logos");
}

export function getWorkbookPath() {
  return join(getDataDir(), "Qwui-Daten.xlsx");
}

// Ab 1.2.0 die eigentliche Datenbank (siehe sqliteStore.js). Die Excel-Datei
// daneben bleibt aus 1.1 als Sicherung liegen.
export function getDatabasePath() {
  return join(getDataDir(), "qwui.db");
}

export function getCompanyPath() {
  return join(getDataDir(), "firma.json");
}
