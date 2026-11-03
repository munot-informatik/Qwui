// Excel-Auswertung: alle fünf Tabellenblätter, mit den Zahlen, die auch in
// der App stehen. Die Datei geht z. B. an die Treuhand — sie muss ohne Qwui
// verständlich sein.

import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// excelStore.js liest den Datenordner über Electron — hier nicht nötig.
vi.mock("../desktop/dataDir.js", () => ({
  getDataDir: () => tmpdir(),
  getLogosDir: () => tmpdir(),
  getWorkbookPath: () => join(tmpdir(), "nicht-benutzt.xlsx"),
}));

const { writeEvaluation } = await import("../desktop/excelExport.js");
const ExcelJS = createRequire(new URL("../desktop/package.json", import.meta.url))("exceljs");

const data = {
  customers: [{ id: "c1", name: "Sandra Meier", email: "s.meier@example.ch", emailConsent: { given: true, at: "2027-02-01" } }],
  receipts: [
    {
      id: "r1", number: "0001", date: "2027-02-13", total: 898, customer: { id: "c1", name: "Sandra Meier" },
      items: [
        { kind: "product", description: "Predator Revo", amount: "890", serial: "PR-1002" },
        { kind: "product", description: "Kreide", amount: "4", quantity: 2 },
      ],
      emailDelivery: { status: "gesendet", at: "2027-02-13T10:00:00.000Z" },
    },
  ],
  inventory: [
    { id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 2, serialTracked: true },
    { id: "k", articleNumber: "KR-01", name: "Kreide", group: "Zubehör", price: 4, stock: 38 },
  ],
  units: [
    { id: "u1", productId: "q", serial: "PR-1001", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z", purchasePrice: 600 },
    { id: "u2", productId: "q", serial: "PR-1002", status: "verkauft", receivedAt: "2027-02-01T09:00:00.000Z", purchasePrice: 600, receiptId: "r1", receiptNumber: "0001", customerId: "c1", soldAt: "2027-02-13T10:00:00.000Z" },
    { id: "u3", productId: "q", serial: "PR-1003", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" },
  ],
  movements: [
    { id: "m1", at: "2027-02-01T09:00:00.000Z", productId: "q", articleNumber: "PRED-REVO", serial: "PR-1001", qty: 1, type: "wareneingang", ref: { draftId: "d1" }, source: "assistent" },
    { id: "m2", at: "2027-02-13T10:00:00.000Z", productId: "q", articleNumber: "PRED-REVO", serial: "PR-1002", qty: -1, type: "verkauf", ref: { receiptNumber: "0001" }, source: "app" },
  ],
};

async function readBack() {
  const dir = mkdtempSync(join(tmpdir(), "qwui-auswertung-"));
  const path = join(dir, "Auswertung.xlsx");
  await writeEvaluation(path, data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  rmSync(dir, { recursive: true, force: true });
  const rows = (name) => {
    const sheet = wb.getWorksheet(name);
    const out = [];
    sheet.eachRow((row) => out.push(row.values.slice(1)));
    return out;
  };
  return { wb, rows };
}

describe("Excel-Auswertung", () => {
  it("enthält alle fünf Tabellenblätter", async () => {
    const { wb } = await readBack();
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Kunden", "Zahlungen", "Inventar", "Exemplare", "Lagerbewegungen"]);
  });

  it("zeigt Positionen mit Menge, S/N und verrechnetem Betrag", async () => {
    const { rows } = await readBack();
    const [, quittung] = rows("Zahlungen");
    expect(quittung).toContain("Predator Revo (S/N PR-1002): CHF 890.00; 2 × Kreide: CHF 8.00");
    expect(quittung).toContain("Direktzahlung");
    expect(quittung).toContain("gesendet 2027-02-13");
  });

  it("zählt den Bestand aus den Exemplaren", async () => {
    const { rows } = await readBack();
    const revo = rows("Inventar").find((r) => r[0] === "PRED-REVO");
    expect(revo).toEqual(["PRED-REVO", "Predator Revo", "Queues", "ja", 2, 890, 1780]);
  });

  it("listet Exemplare mit Kunde und Lagerbewegungen mit Quelle", async () => {
    const { rows } = await readBack();
    expect(rows("Exemplare").find((r) => r[0] === "PR-1002")).toEqual(
      expect.arrayContaining(["verkauft", "0001", "Sandra Meier", 600])
    );
    const bewegungen = rows("Lagerbewegungen");
    expect(bewegungen[1]).toEqual(expect.arrayContaining(["Wareneingang", "Vorschlag des Assistenten", "Assistent"]));
    expect(bewegungen[2]).toEqual(expect.arrayContaining([-1, "Verkauf", "Quittung 0001", "App"]));
  });
});
