// Menge und Seriennummer auf dem Beleg: Der Kunde muss sehen, wie viele Stück
// er bezahlt hat, und im Garantiefall die Seriennummer seines Queues auf der
// Quittung finden — nicht nur in Qwui.

import { describe, it, expect } from "vitest";
import { buildReceiptPdfBytes } from "../src/receiptPdf.js";
import { pdfText } from "./helpers/pdfText.js";
import { makeReceipt } from "./helpers/fixtures.js";
import { itemListPrice, itemLineTotal, receiptTotal, quantityPrefix } from "../shared/items.js";

describe("Menge", () => {
  it("rechnet Stückpreis × Menge, dann Rabatt", () => {
    const it2 = { amount: "4", quantity: 3, discountPercent: 10 };
    expect(itemListPrice(it2)).toBe(12);
    expect(itemLineTotal(it2)).toBe(10.8);
  });

  it("lässt Positionen von vor 1.2.0 unverändert (ein Stück)", () => {
    expect(itemLineTotal({ amount: "250", discountPercent: 20 })).toBe(200);
    expect(receiptTotal([{ amount: "100" }, { amount: "50.5" }])).toBe(150.5);
    expect(quantityPrefix({ amount: "1" })).toBe("");
  });

  it("zeigt Menge und Stückpreis auf der PDF", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(
        makeReceipt({ items: [{ id: "k", kind: "product", description: "Kreide", amount: "4", quantity: 3, articleNumber: "KR-01" }] })
      )
    );
    expect(text).toContain("3 × Kreide");
    expect(text).toContain("à CHF 4.00");
    expect(text).toContain("12.00");
  });
});

describe("Seriennummer", () => {
  it("steht bei der Position auf der PDF", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(
        makeReceipt({
          items: [{ id: "q", kind: "product", description: "Predator Revo", amount: "890", serial: "PR-1001", unitId: "u1" }],
        })
      )
    );
    expect(text).toContain("S/N: PR-1001");
  });

  it("erscheint nicht bei Positionen ohne Exemplar", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt()));
    expect(text).not.toContain("S/N");
  });
});
