// Kernmodul der Desktop-Datenbank: liest/schreibt die eine Excel-Arbeitsmappe
// (Qwui-Daten.xlsx) mit den zwei Sheets "Kunden" und "Zahlungen".
//
// Beide Sheets leben in derselben physischen Datei, daher laufen ALLE
// Lese-/Schreibzugriffe über eine serielle Warteschlange (withWriteLock) —
// jeder Zugriff liest die Datei frisch von der Platte und schreibt sie danach
// atomar zurück, sodass ein Kunden-Save nie einen kurz zuvor erfolgten
// Quittungs-Save überschreiben kann (und umgekehrt).
//
// statusOf/isOverdue/paymentTermOf sind bewusst als kleine, eigene
// Kopie hier drin (identisch zu src/BuchhaltungTab.jsx) statt über ein
// gemeinsames Modul geteilt — folgt demselben Duplizierungs-Muster, das im
// Projekt schon für kleine Helfer (chf, formatDateDE) an mehreren Stellen
// verwendet wird, und vermeidet Änderungen an der geteilten Web-UI-Datei.

import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { copyFile, rename } from "node:fs/promises";
import { getWorkbookPath } from "./dataDir.js";
import { storeLogo, loadLogo } from "./logoCache.js";

const SHEET_CUSTOMERS = "Kunden";
const SHEET_RECEIPTS = "Zahlungen";
const SHEET_INVENTORY = "Inventar";

const INVENTORY_HEADERS = [
  "ID",
  "Artikelnummer",
  "Artikel-Name",
  "Produktgruppe",
  "Stückzahl verfügbar",
  "Preis (CHF)",
];
const INVENTORY_COLUMN_WIDTHS = [10, 18, 34, 22, 20, 14];

const CUSTOMER_HEADERS = [
  "ID",
  "Name",
  "Strasse",
  "Hausnummer",
  "PLZ",
  "Ort",
  "Adresse (Freitext, alt)",
  "E-Mail",
  "Telefon",
];

const CUSTOMER_COLUMN_WIDTHS = [10, 22, 18, 10, 8, 16, 22, 26, 16];
const RECEIPT_COLUMN_WIDTHS = [22, 12, 8, 10, 36, 14, 14, 20, 12, 12, 12, 40];

const RECEIPT_HEADERS = [
  "Kunde",
  "Datum",
  "Nr.",
  "Typ",
  "Beschreibung",
  "Betrag (CHF)",
  "MWST enthalten",
  "Zahlungsstatus",
  "Fällig am",
  "Erstellt am",
  "Bearbeitet am",
  "Rohdaten (JSON – von Qwui verwaltet, bitte nicht bearbeiten)",
];

// Rückfall-Zahlungsfrist für Belege ohne eigenes paymentTermDays (Alt-Belege).
const DEFAULT_PAYMENT_TERM_DAYS = 30;

// Individuelle Zahlungsfrist einer Rechnung in Tagen (siehe src/App.jsx).
function paymentTermOf(receipt) {
  const d = Number(receipt?.paymentTermDays);
  return Number.isFinite(d) && d >= 0 ? d : DEFAULT_PAYMENT_TERM_DAYS;
}

const STATUS_STYLE = {
  gruen: { fill: "FFEAF6EE", font: "FF155C2C" },
  orange: { fill: "FFFDF3EC", font: "FF8A4B12" },
  rot: { fill: "FFFDEBEC", font: "FF8A1620" },
};

// ---- Kleine Helfer (siehe Kommentar oben zur bewussten Duplizierung) ----

function statusOf(receipt) {
  if (receipt.qrBillEnabled) {
    return receipt.paid ? "bezahlt" : "offen";
  }
  return "direkt";
}

function daysSince(iso) {
  if (!iso) return 0;
  const from = new Date(`${iso}T00:00:00`);
  const now = new Date();
  return Math.floor((now - from) / 86400000);
}

function isOverdue(receipt) {
  return statusOf(receipt) === "offen" && daysSince(receipt.date) > paymentTermOf(receipt);
}

function documentWord(receipt) {
  return receipt.qrBillEnabled ? "Rechnung" : "Quittung";
}

function statusInfo(receipt) {
  const status = statusOf(receipt);
  if (status === "direkt") return { label: "Direktzahlung", color: "gruen" };
  if (status === "bezahlt") return { label: "Bezahlt", color: "gruen" };
  if (isOverdue(receipt)) return { label: "Offen (überfällig)", color: "rot" };
  return { label: "Offen", color: "orange" };
}

// Reine Kalenderdatum-Arithmetik, komplett in UTC verankert (wie in
// src/pdfGenerator.js) — Konstruktion in lokaler Zeit + toISOString()-Ausgabe
// würde das Ergebnis in der Schweiz (UTC+1/+2) systematisch um einen Tag
// verschieben.
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function flattenItems(items) {
  return (items || []).map((it) => `${it.description}: CHF ${chf(it.amount)}`).join("; ");
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function cellText(row, col) {
  const v = row.getCell(col).value;
  return v === null || v === undefined ? "" : String(v);
}

// ---- Serialisierte Schreibwarteschlange ----
// Jeder Zugriff (auch reine Reads, wegen möglichem Self-Heal-Rückschreiben)
// läuft nacheinander, nie parallel — verhindert, dass zwei Saves sich
// gegenseitig überschreiben, da beide Sheets in derselben Datei liegen.

let queue = Promise.resolve();
function withWriteLock(fn) {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

// ---- Workbook laden / atomar speichern ----

function ensureSheet(wb, name, headers, columnWidths) {
  let sheet = wb.getWorksheet(name);
  if (!sheet) {
    sheet = wb.addWorksheet(name);
  }
  if (sheet.rowCount === 0) {
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    if (columnWidths) {
      sheet.columns = columnWidths.map((width) => ({ width }));
    }
  }
  return sheet;
}

// Entfernt ein Sheet komplett und legt es frisch mit Kopfzeile an — genutzt
// beim vollständigen Neuschreiben (writeCustomersList/writeReceiptsList).
// BEWUSST NICHT über worksheet.spliceRows(2, sheet.rowCount - 1): exceljs
// (4.4.0) hat dort einen Bug, wenn genau bis zum letzten Datensatz gelöscht
// wird (der Verschiebe-Loop für "danach folgende" Zeilen läuft dann nicht,
// weil es keine gibt — die zu löschenden Zeilen bleiben dadurch stehen und
// neue Zeilen würden sich bei jedem Save dahinter anhäufen). Ein frisches
// Sheet ist robust und unabhängig von dieser Falle.
function resetSheet(wb, name, headers, columnWidths) {
  wb.removeWorksheet(name);
  const sheet = wb.addWorksheet(name);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = columnWidths.map((width) => ({ width }));
  return sheet;
}

async function loadWorkbook() {
  const wb = new ExcelJS.Workbook();
  const path = getWorkbookPath();
  if (existsSync(path)) {
    await wb.xlsx.readFile(path);
  }
  ensureSheet(wb, SHEET_CUSTOMERS, CUSTOMER_HEADERS, CUSTOMER_COLUMN_WIDTHS);
  ensureSheet(wb, SHEET_RECEIPTS, RECEIPT_HEADERS, RECEIPT_COLUMN_WIDTHS);
  ensureSheet(wb, SHEET_INVENTORY, INVENTORY_HEADERS, INVENTORY_COLUMN_WIDTHS);
  return wb;
}

// Schreibt die Arbeitsmappe atomar: erst in eine .tmp-Datei, Backup der
// bisherigen Version per Kopie (nicht Move — die "echte" Datei bleibt bis zum
// finalen rename() unangetastet vorhanden, falls der Prozess dazwischen
// abstürzt), dann EIN rename() als atomarer Commit. Mit Retry, falls die
// Datei gerade in Excel geöffnet ist (Windows-Dateisperre).
async function saveWorkbookAtomic(wb) {
  const finalPath = getWorkbookPath();
  const tmpPath = `${finalPath}.tmp`;
  const bakPath = `${finalPath}.bak`;

  await wb.xlsx.writeFile(tmpPath);

  if (existsSync(finalPath)) {
    try {
      await copyFile(finalPath, bakPath);
    } catch (e) {
      console.error("Backup der Excel-Datei fehlgeschlagen (nicht kritisch)", e);
    }
  }

  const MAX_RETRIES = 3;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await rename(tmpPath, finalPath);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
  throw new Error(
    `Die Datei Qwui-Daten.xlsx konnte nicht gespeichert werden — vermutlich ist sie gerade in ` +
      `Excel geöffnet. Bitte Excel schliessen und erneut versuchen. (${lastErr.message})`
  );
}

// ---- Logo-Auslagerung in den Rohdaten (siehe logoCache.js) ----

async function serializeReceipt(receipt) {
  let company = receipt.company;
  if (company && company.logoDataUrl) {
    const stored = await storeLogo(company.logoDataUrl);
    if (stored) {
      company = { ...company, logoRef: stored.logoRef, logoMime: stored.logoMime };
      delete company.logoDataUrl;
    }
  }
  return JSON.stringify({ ...receipt, company });
}

async function deserializeReceipt(json) {
  const receipt = JSON.parse(json);
  if (receipt.company && receipt.company.logoRef) {
    const logoDataUrl = await loadLogo(receipt.company.logoRef, receipt.company.logoMime);
    const company = { ...receipt.company, logoDataUrl };
    delete company.logoRef;
    delete company.logoMime;
    receipt.company = company;
  }
  return receipt;
}

// ---- Kunden (Sheet "Kunden") ----

export const readCustomersList = () =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet(SHEET_CUSTOMERS);
    const result = [];
    const seenIds = new Set();
    let changed = false;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;

      let id = cellText(row, 1);
      if (!id || seenIds.has(id)) {
        id = randomId();
        row.getCell(1).value = id;
        changed = true;
      }
      seenIds.add(id);

      result.push({
        id,
        name: cellText(row, 2),
        street: cellText(row, 3),
        houseNumber: cellText(row, 4),
        postalCode: cellText(row, 5),
        city: cellText(row, 6),
        address: cellText(row, 7),
        email: cellText(row, 8),
        phone: cellText(row, 9),
      });
    }

    // Self-Heal (fehlende/doppelte IDs) sofort persistieren, nicht erst beim
    // nächsten unabhängigen Save — sonst würde uid() bei jedem Neustart eine
    // andere ID vergeben und die Zeilen-Identität würde ständig wechseln.
    if (changed) {
      await saveWorkbookAtomic(wb);
    }

    return result;
  });

export const writeCustomersList = (list) =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = resetSheet(wb, SHEET_CUSTOMERS, CUSTOMER_HEADERS, CUSTOMER_COLUMN_WIDTHS);

    const sorted = [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" })
    );

    for (const c of sorted) {
      sheet.addRow([
        c.id || randomId(),
        c.name || "",
        c.street || "",
        c.houseNumber || "",
        c.postalCode || "",
        c.city || "",
        c.address || "",
        c.email || "",
        c.phone || "",
      ]);
    }

    await saveWorkbookAtomic(wb);
  });

// ---- Inventar (Sheet "Inventar") ----
// Direkt als Tabelle lesbar und von Hand pflegbar, wie die Kundenliste.

export const readInventoryList = () =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet(SHEET_INVENTORY);
    const result = [];
    const seenIds = new Set();
    let changed = false;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;

      let id = cellText(row, 1);
      if (!id || seenIds.has(id)) {
        id = randomId();
        row.getCell(1).value = id;
        changed = true;
      }
      seenIds.add(id);

      result.push({
        id,
        articleNumber: cellText(row, 2),
        name: cellText(row, 3),
        group: cellText(row, 4),
        stock: Number(row.getCell(5).value) || 0,
        price: Number(row.getCell(6).value) || 0,
      });
    }

    if (changed) {
      await saveWorkbookAtomic(wb);
    }

    return result;
  });

export const writeInventoryList = (list) =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = resetSheet(wb, SHEET_INVENTORY, INVENTORY_HEADERS, INVENTORY_COLUMN_WIDTHS);

    // Nach Gruppe, dann Name — die Excel-Datei bleibt so von Hand lesbar.
    const sorted = [...list].sort(
      (a, b) =>
        (a.group || "").localeCompare(b.group || "", "de-CH", { sensitivity: "base" }) ||
        (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" })
    );

    for (const p of sorted) {
      const row = sheet.addRow([
        p.id || randomId(),
        p.articleNumber || "",
        p.name || "",
        p.group || "",
        Number(p.stock) || 0,
        Number(p.price) || 0,
      ]);
      row.getCell(6).numFmt = "#,##0.00";
    }

    await saveWorkbookAtomic(wb);
  });

// ---- Zahlungen/Rechnungen (Sheet "Zahlungen") ----

export const readReceiptsList = () =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = wb.getWorksheet(SHEET_RECEIPTS);
    const result = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;

      const rohdaten = cellText(row, 12);
      if (!rohdaten) {
        console.warn(
          `Zeile ${rowNumber} in Sheet "Zahlungen" hat keine lesbaren Rohdaten und wird ` +
            `übersprungen (vermutlich von Hand in Excel hinzugefügt).`
        );
        continue;
      }
      try {
        result.push(await deserializeReceipt(rohdaten));
      } catch (e) {
        console.warn(`Zeile ${rowNumber} in Sheet "Zahlungen" konnte nicht gelesen werden.`, e);
      }
    }

    // Bewusst NICHT in der Datei-Reihenfolge (Kunde-gruppiert) zurückgeben,
    // sondern chronologisch nach Erstellungszeitpunkt — das ist die Reihenfolge,
    // die die restliche App (z.B. der Verlauf-Tab mit seinem eigenen .reverse())
    // erwartet. Die Kunden-Gruppierung ist reine Excel-Präsentation.
    result.sort((a, b) => {
      const ta = a.createdAt || a.date || "";
      const tb = b.createdAt || b.date || "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    return result;
  });

export const writeReceiptsList = (list) =>
  withWriteLock(async () => {
    const wb = await loadWorkbook();
    const sheet = resetSheet(wb, SHEET_RECEIPTS, RECEIPT_HEADERS, RECEIPT_COLUMN_WIDTHS);

    const sorted = [...list].sort((a, b) => {
      const nameCmp = (a.customer?.name || "").localeCompare(
        b.customer?.name || "",
        "de-CH",
        { sensitivity: "base" }
      );
      if (nameCmp !== 0) return nameCmp;
      const ta = a.createdAt || a.date || "";
      const tb = b.createdAt || b.date || "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    for (const receipt of sorted) {
      const info = statusInfo(receipt);
      const dueDate = receipt.qrBillEnabled ? addDaysISO(receipt.date, paymentTermOf(receipt)) : "";
      const rohdaten = await serializeReceipt(receipt);

      const row = sheet.addRow([
        receipt.customer?.name || "",
        receipt.date || "",
        receipt.number || "",
        documentWord(receipt),
        flattenItems(receipt.items),
        Number(receipt.total) || 0,
        receipt.vatEnabled ? "Ja" : "Nein",
        info.label,
        dueDate,
        receipt.createdAt || "",
        receipt.editedAt || "",
        rohdaten,
      ]);

      row.getCell(6).numFmt = "#,##0.00";
      const statusCell = row.getCell(8);
      statusCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: STATUS_STYLE[info.color].fill },
      };
      statusCell.font = { color: { argb: STATUS_STYLE[info.color].font }, bold: true };
    }

    await saveWorkbookAtomic(wb);
  });
