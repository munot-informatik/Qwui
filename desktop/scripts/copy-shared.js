// Kopiert die gemeinsamen Module aus dem Projekt-Root (../shared) nach
// desktop/shared. Der Electron-Hauptprozess braucht sie (Backup-Format, ab
// Meilenstein 5/6 Shop-Feed und Auswertungen), electron-builder packt aber nur
// Dateien unterhalb von desktop/ ein — wie beim Web-Build in copy-dist.js.
// desktop/shared ist eine Kopie und steht deshalb in .gitignore.

import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "..", "..", "shared");
const dest = resolve(__dirname, "..", "shared");

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

cpSync(src, dest, { recursive: true });
console.log(`Gemeinsame Module kopiert: ${src} -> ${dest}`);
