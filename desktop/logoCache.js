// Lagert Firmenlogos (Base64-data-URLs) aus der Excel-"Rohdaten"-Zelle in
// eigene Dateien aus (logos/<hash>.png), da eine einzelne Excel-Zelle nur
// 32'767 Zeichen fassen darf — ein eingebettetes Logo (Base64, oft
// 100-200k+ Zeichen) würde die Zelle sonst zum Absturz bringen oder
// stillschweigend abgeschnitten werden. Inhalts-Hash als Dateiname: dasselbe
// Logo über mehrere Quittungen hinweg wird nur einmal gespeichert.

import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { getLogosDir } from "./dataDir.js";
import { isStoredLogoRef, logoMimeOf } from "./sqliteStore.js";

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

// Speichert das Logo (falls noch nicht vorhanden) und gibt eine Referenz
// zurück, die anstelle von logoDataUrl in den Rohdaten gespeichert wird.
export async function storeLogo(logoDataUrl) {
  const parsed = parseDataUrl(logoDataUrl);
  if (!parsed) return null;

  const hash = createHash("sha256").update(parsed.base64).digest("hex");
  const ext = parsed.mime === "image/jpeg" || parsed.mime === "image/jpg" ? "jpg" : "png";
  const filename = `${hash}.${ext}`;
  const filePath = join(getLogosDir(), filename);

  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, Buffer.from(parsed.base64, "base64"));
  }

  return { logoRef: filename, logoMime: parsed.mime };
}

// Liest ein per storeLogo() ausgelagertes Logo wieder als vollständige data-URL
// ein, damit App.jsx/receiptPdf.js exakt dieselbe Receipt-Form sehen wie vor
// der Auslagerung.
export async function loadLogo(logoRef, logoMime) {
  if (!logoRef) return "";
  // Nur eigene Dateien im Logo-Ordner — nie einen Pfad aus den Daten.
  if (!isStoredLogoRef(logoRef)) return "";
  try {
    const bytes = await readFile(join(getLogosDir(), logoRef));
    const mime = logoMimeOf(logoMime);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (e) {
    console.error(`Logo ${logoRef} konnte nicht geladen werden`, e);
    return "";
  }
}
