// Was auf Offerte, Gutschrift, Lieferschein und auf der Mahnung nach einer
// Gutschrift stehen muss — und was nicht (keine Preise auf dem Lieferschein,
// kein Einzahlungsschein auf Offerte und Gutschrift).

import { describe, it, expect } from "vitest";
import { buildReceiptPdfBytes, buildMahnungPdfBytes } from "../src/receiptPdf.js";
import { pdfText, isPdf } from "./helpers/pdfText.js";
import { makeReceipt } from "./helpers/fixtures.js";
import { buildCreditNote, DOC_TYPE, docWord, deliveryNoteItems } from "../shared/documents.js";

const items = [
  { id: "a", kind: "product", productId: "p1", articleNumber: "Q-100", description: "Testqueue Pro", amount: 450, quantity: 1, serial: "TQ-001" },
  { id: "b", kind: "product", productId: "p2", articleNumber: "KR-01", description: "Kreide blau", amount: 4, quantity: 5 },
  { id: "c", kind: "service", description: "Montage vor Ort", amount: 80, quantity: 1 },
];

describe("Offerte", () => {
  it("hat Titel, eigene Nummer und Gültigkeit, aber keinen Einzahlungsschein", async () => {
    const quote = makeReceipt({ items, docType: DOC_TYPE.quote, number: "O-0007", validUntil: "2026-12-21", qrBillEnabled: false });
    const text = pdfText(await buildReceiptPdfBytes(quote));
    expect(text).toContain("OFFERTE");
    expect(text).toContain("Nr. O-0007");
    expect(text).toContain("Gültig bis 21.12.2026");
    expect(text).toContain("Wir freuen uns auf Ihren Auftrag");
    expect(text).not.toContain("Zahlteil");
    expect(text).not.toContain("Betrag dankend erhalten");
  });
});

describe("Gutschrift", () => {
  it("nennt die Quittung, den Grund und die Rückerstattung", async () => {
    const receipt = makeReceipt({ id: "r1", items, number: "0012", vatEnabled: true });
    const { creditNote } = buildCreditNote(receipt, [{ itemId: "a", quantity: 1, restock: true }], {
      creditNotes: [],
      number: "G-0003",
      date: "2026-11-21",
      refund: "ueberweisung",
      note: "Spitze defekt",
      company: receipt.company,
      now: "2026-11-21T10:00:00.000Z",
      newId: (() => {
        let i = 0;
        return () => `x${++i}`;
      })(),
    });
    const text = pdfText(await buildReceiptPdfBytes(creditNote));
    expect(text).toContain("GUTSCHRIFT");
    expect(text).toContain("Nr. G-0003");
    expect(text).toContain("zu Quittung Nr. 0012");
    expect(text).toContain("Gutschrift total (inkl. MWST)");
    expect(text).toContain("450.00");
    expect(text).toContain("Spitze defekt");
    expect(text).toContain("Der Betrag wird Ihnen überwiesen.");
    expect(text).not.toContain("Zahlteil");
  });
});

describe("Lieferschein", () => {
  it("zeigt Ware mit Seriennummer, aber keine Preise und keine Montage", async () => {
    const receipt = makeReceipt({ items, number: "0012", qrBillEnabled: true, shopOrder: { number: 42 } });
    const delivery = { ...receipt, docType: DOC_TYPE.deliveryNote, sourceWord: docWord(receipt), qrBillEnabled: false, items: deliveryNoteItems(receipt) };
    const bytes = await buildReceiptPdfBytes(delivery);
    expect(isPdf(bytes)).toBe(true);
    const text = pdfText(bytes);
    expect(text).toContain("LIEFERSCHEIN");
    expect(text).toContain("zu Rechnung Nr. 0012");
    expect(text).toContain("Online-Bestellung Nr. 42");
    expect(text).toContain("LIEFERADRESSE");
    expect(text).toContain("Testqueue Pro");
    expect(text).toContain("TQ-001");
    expect(text).toContain("KR-01");
    expect(text).not.toContain("Montage");
    expect(text).not.toContain("CHF");
    expect(text).not.toContain("Zahlteil");
    expect(text).toContain("Datum, Unterschrift Empfänger");
  });
});

describe("Mahnung nach Gutschrift", () => {
  it("verlangt nur noch den Rest und weist die Gutschrift aus", async () => {
    const bill = makeReceipt({ items, number: "0012", qrBillEnabled: true, date: "2026-09-01" });
    const text = pdfText(
      await buildMahnungPdfBytes({ ...bill, total: 70, originalTotal: bill.total, creditedTotal: 480, creditNoteNumbers: ["G-0001"] })
    );
    expect(text).toContain("Rechnungsbetrag");
    expect(text).toContain("Gutschrift G-0001");
    expect(text).toContain("Offener Betrag");
    expect(text).toContain("70.00");
  });
});
