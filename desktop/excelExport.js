// Excel-Auswertung der Windows-Version (ab 1.2.0). Die Daten selbst liegen in
// SQLite (sqliteStore.js); diese Datei ist nur noch eine Auswertung zum
// Ansehen, Filtern und Weitergeben — z. B. an die Treuhand. Änderungen darin
// fliessen nicht zurück in Qwui.
//
// Tabellenblätter: Kunden, Zahlungen, Inventar, Exemplare, Lagerbewegungen.
// Jedes Blatt mit fixierter Kopfzeile und Filter.

import ExcelJS from "exceljs";
import { statusInfo, paymentTermOf, addDaysISO, documentWord, STATUS_STYLE } from "./excelStore.js";
// Kopie von ../shared (scripts/copy-shared.js).
import { itemLineTotal, quantityPrefix } from "./shared/items.js";
import { UNIT_STATUS_LABEL } from "./shared/serials.js";
import { MOVEMENT_TYPE_LABEL, productStock, isSerialTracked } from "./shared/stock.js";

const SOURCE_LABEL = { app: "App", assistent: "Assistent" };

function chf(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : "";
}

function dateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d;
}

function addSheet(wb, name, columns, rows) {
  const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, width, numFmt]) => ({ header, key, width, style: numFmt ? { numFmt } : {} }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

// data: { customers, receipts, inventory, units, movements }
export function buildEvaluationWorkbook({ customers = [], receipts = [], inventory = [], units = [], movements = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Qwui";
  const productById = new Map(inventory.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const customerName = (id, receiptId) =>
    customerById.get(id)?.name || receiptById.get(receiptId)?.customer?.name || "";

  addSheet(
    wb,
    "Kunden",
    [
      ["Kunden-ID", "id", 12],
      ["Name", "name", 24],
      ["Strasse", "street", 20],
      ["Nr.", "houseNumber", 8],
      ["PLZ", "postalCode", 8],
      ["Ort", "city", 16],
      ["Adresse (Freitext, alt)", "address", 22],
      ["E-Mail", "email", 26],
      ["Telefon", "phone", 16],
      ["Einverständnis E-Mail-Beleg", "consent", 22],
    ],
    [...customers]
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" }))
      .map((c) => ({ ...c, consent: c.emailConsent?.given ? `ja, seit ${c.emailConsent.at}` : "" }))
  );

  const payments = addSheet(
    wb,
    "Zahlungen",
    [
      ["Datum", "date", 12],
      ["Nr.", "number", 8],
      ["Typ", "type", 10],
      ["Kunde", "customer", 22],
      ["Kunden-ID", "customerId", 12],
      ["Positionen", "items", 44],
      ["Betrag (CHF)", "total", 14, "#,##0.00"],
      ["MWST enthalten", "vat", 14],
      ["Zahlungsstatus", "status", 20],
      ["Fällig am", "due", 12],
      ["E-Mail-Versand", "mail", 16],
    ],
    [...receipts]
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.number).localeCompare(String(b.number)))
      .map((r) => ({
        date: r.date || "",
        number: r.number || "",
        type: documentWord(r),
        customer: r.customer?.name || "",
        customerId: r.customer?.id || "",
        items: (r.items || [])
          .map((it) => `${quantityPrefix(it)}${it.description}${it.serial ? ` (S/N ${it.serial})` : ""}: CHF ${chf(itemLineTotal(it)).toFixed(2)}`)
          .join("; "),
        total: chf(r.total),
        vat: r.vatEnabled ? "Ja" : "Nein",
        status: statusInfo(r).label,
        due: r.qrBillEnabled && r.date ? addDaysISO(r.date, paymentTermOf(r)) : "",
        mail: r.emailDelivery ? `${r.emailDelivery.status} ${dateOnly(r.emailDelivery.at)}` : "",
      }))
  );
  // Ampelfarbe wie im bisherigen Sheet "Zahlungen".
  payments.eachRow((row, n) => {
    if (n === 1) return;
    const label = row.getCell("status").value;
    const color = label === "Offen (überfällig)" ? "rot" : label === "Offen" ? "orange" : "gruen";
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_STYLE[color].fill } };
    row.getCell("status").font = { bold: true, color: { argb: STATUS_STYLE[color].font } };
  });

  addSheet(
    wb,
    "Inventar",
    [
      ["Artikelnummer", "articleNumber", 16],
      ["Artikel-Name", "name", 32],
      ["Produktgruppe", "group", 20],
      ["Seriennummernpflichtig", "serial", 22],
      ["Verfügbar", "available", 12],
      ["Preis (CHF)", "price", 12, "#,##0.00"],
      ["Lagerwert (CHF)", "value", 16, "#,##0.00"],
    ],
    [...inventory]
      .sort((a, b) => (a.group || "").localeCompare(b.group || "", "de-CH") || (a.name || "").localeCompare(b.name || "", "de-CH"))
      .map((p) => {
        const available = productStock(p, units);
        return {
          articleNumber: p.articleNumber || "",
          name: p.name || "",
          group: p.group || "",
          serial: isSerialTracked(p) ? "ja" : "nein",
          available,
          price: chf(p.price),
          value: chf(Math.max(0, available) * (Number(p.price) || 0)),
        };
      })
  );

  addSheet(
    wb,
    "Exemplare",
    [
      ["Seriennummer", "serial", 18],
      ["Artikelnummer", "articleNumber", 16],
      ["Artikel", "name", 28],
      ["Status", "status", 14],
      ["Eingang", "receivedAt", 12],
      ["Einkaufspreis (CHF)", "purchasePrice", 18, "#,##0.00"],
      ["Verkauft am", "soldAt", 12],
      ["Quittung", "receipt", 10],
      ["Kunde", "customer", 22],
      ["Bemerkung", "note", 28],
    ],
    [...units]
      .sort((a, b) => (a.serial || "").localeCompare(b.serial || "", "de-CH"))
      .map((u) => {
        const p = productById.get(u.productId);
        const receiptNumber = u.receiptNumber ?? u.returnedFrom?.receiptNumber ?? "";
        return {
          serial: u.serial,
          articleNumber: p?.articleNumber || "",
          name: p?.name || "",
          status: UNIT_STATUS_LABEL[u.status] || u.status,
          receivedAt: dateOnly(u.receivedAt),
          purchasePrice: u.purchasePrice == null ? "" : chf(u.purchasePrice),
          soldAt: dateOnly(u.soldAt),
          receipt: u.returnedFrom && !u.receiptId ? `${receiptNumber} (Retoure)` : receiptNumber,
          customer: customerName(u.customerId || u.returnedFrom?.customerId, u.receiptId || u.returnedFrom?.receiptId),
          note: u.note || "",
        };
      })
  );

  addSheet(
    wb,
    "Lagerbewegungen",
    [
      ["Zeitpunkt", "at", 18, "dd.mm.yyyy hh:mm"],
      ["Artikelnummer", "articleNumber", 16],
      ["Artikel", "name", 28],
      ["Seriennummer", "serial", 18],
      ["Menge", "qty", 8],
      ["Typ", "type", 18],
      ["Referenz", "ref", 26],
      ["Quelle", "source", 12],
    ],
    [...movements]
      .sort((a, b) => (a.at || "").localeCompare(b.at || ""))
      .map((m) => ({
        at: dateTime(m.at),
        articleNumber: m.articleNumber || productById.get(m.productId)?.articleNumber || "",
        name: productById.get(m.productId)?.name || "",
        serial: m.serial || "",
        qty: m.qty,
        type: MOVEMENT_TYPE_LABEL[m.type] || m.type,
        ref: m.ref?.receiptNumber
          ? `Quittung ${m.ref.receiptNumber}${m.ref.note ? ` (${m.ref.note})` : ""}`
          : m.ref?.draftId
            ? "Vorschlag des Assistenten"
            : m.ref?.note || "",
        source: SOURCE_LABEL[m.source] || m.source || "",
      }))
  );

  return wb;
}

export async function writeEvaluation(path, data) {
  await buildEvaluationWorkbook(data).xlsx.writeFile(path);
}
