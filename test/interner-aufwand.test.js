// Interner Aufwand (Kilometer und Material) für die Buchhaltung: richtig
// gerechnet und NIE auf dem Beleg für den Kunden — weder in der PDF noch in
// der QR-Rechnung, der Mahnung, dem Shop-Feed oder beim Assistenten.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_KM_RATE,
  companyKmRate,
  normalizeCosts,
  costTotals,
  sumCosts,
  costSummaryText,
} from "../shared/internalCosts.js";
import { buildReceiptPdfBytes, buildMahnungPdfBytes } from "../src/receiptPdf.js";
import { buildShopFeed } from "../shared/shopFeed.js";
import { salesReport } from "../shared/reports.js";
import { pdfText } from "./helpers/pdfText.js";
import { makeReceipt, makeCompany } from "./helpers/fixtures.js";

const costs = {
  km: 42,
  kmRate: 0.75,
  materials: [
    { id: "m1", description: "Geheimtuch Simonis 860", amount: 18.5 },
    { id: "m2", description: "Kleber", amount: 6 },
  ],
};

describe("Rechnen", () => {
  it("nimmt den ESTV-Ansatz 2026 als Vorgabe", () => {
    expect(DEFAULT_KM_RATE).toBe(0.75);
    expect(companyKmRate({})).toBe(0.75);
    expect(companyKmRate({ kmRate: "0.7" })).toBe(0.7);
  });

  it("rechnet Fahrkosten, Material und Total", () => {
    expect(costTotals({ internalCosts: costs })).toEqual({ km: 42, kmRate: 0.75, travel: 31.5, material: 24.5, total: 56 });
    expect(costTotals({})).toEqual({ km: 0, kmRate: 0, travel: 0, material: 0, total: 0 });
  });

  it("nimmt Eingaben aus dem Formular entgegen (Komma, leere Zeilen, negative Werte)", () => {
    expect(
      normalizeCosts({
        km: "12,5",
        kmRate: "",
        materials: [
          { id: "a", description: " Leder ", amount: "9.90" },
          { id: "b", description: "", amount: "" },
          { id: "c", description: "Fehler", amount: "-5" },
        ],
      })
    ).toEqual({ km: 12.5, kmRate: 0.75, materials: [{ id: "a", description: "Leder", amount: 9.9 }, { id: "c", description: "Fehler", amount: 0 }] });
    expect(normalizeCosts({ km: "", materials: [{ description: "", amount: "" }] })).toBeNull();
  });

  it("summiert über einen Zeitraum", () => {
    expect(sumCosts([{ internalCosts: costs }, {}, { internalCosts: { km: 10, kmRate: 0.7, materials: [] } }])).toEqual({
      km: 52,
      travel: 38.5,
      material: 24.5,
      total: 63,
    });
  });

  it("fasst für die Liste zusammen", () => {
    expect(costSummaryText({ internalCosts: costs })).toBe("42 km à 0.75 = CHF 31.50 · Material CHF 24.50 · total CHF 56.00");
    expect(costSummaryText({})).toBe("");
  });
});

describe("Nie beim Kunden", () => {
  const receipt = makeReceipt({
    items: [{ id: "a", description: "Queue neu belegen vor Ort", amount: 120 }],
    internalCosts: costs,
    company: { ...makeCompany(), kmRate: 0.75 },
  });

  it("steht nicht auf der Quittung (PDF)", async () => {
    const text = pdfText(await buildReceiptPdfBytes(receipt));
    expect(text).toContain("Queue neu belegen vor Ort");
    for (const secret of ["Geheimtuch", "Kleber", "42 km", "31.50", "24.50", "56.00", "Material", "Kilometer"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("steht nicht auf der QR-Rechnung und nicht auf der Mahnung", async () => {
    const bill = { ...receipt, qrBillEnabled: true, paid: false };
    for (const bytes of [await buildReceiptPdfBytes(bill), await buildMahnungPdfBytes(bill)]) {
      const text = pdfText(bytes);
      expect(text).not.toContain("Geheimtuch");
      expect(text).not.toContain("56.00");
    }
  });

  it("geht weder in den Shop-Feed noch an den Assistenten", () => {
    const feed = JSON.stringify(buildShopFeed([{ id: "p", name: "Kreide", price: 4, stock: 3 }], []));
    expect(feed).not.toContain("Geheimtuch");
    const report = JSON.stringify(salesReport([{ ...receipt, date: "2026-08-24" }], [], {}));
    expect(report).not.toContain("Geheimtuch");
    expect(report).not.toContain("internalCosts");
  });
});
