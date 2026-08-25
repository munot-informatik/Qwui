// Was auf Rechnung und Quittung stehen muss: MWST-Aufschlüsselung, Rabatte,
// Fusszeile, Sonderzeichen. Alles Fälle, die der Kunde am Ende in der Hand
// hält — Fehler hier fallen sonst erst beim Empfänger auf.

import { describe, it, expect } from "vitest";
import { buildReceiptPdfBytes } from "../src/receiptPdf.js";
import { toWinAnsiSafe } from "../src/pdfGenerator.js";
import { pdfText, isPdf } from "./helpers/pdfText.js";
import { makeReceipt, makeCompany, makeCustomer } from "./helpers/fixtures.js";

describe("Sonderzeichen", () => {
  it("lässt Umlaute und Akzente unverändert", () => {
    expect(toWinAnsiSafe("Müller Grüezi Café")).toBe("Müller Grüezi Café");
  });

  it("bildet Zeichen ausserhalb von Latin-1 ab, statt die PDF scheitern zu lassen", () => {
    expect(toWinAnsiSafe("Đorđević")).toBe("Djordjevic");
    expect(toWinAnsiSafe("Łukasz")).toBe("Lukasz");
    expect(toWinAnsiSafe("Nguyễn")).toBe("Nguyen");
  });

  it("erzeugt eine PDF für einen Kunden mit solchen Zeichen", async () => {
    const bytes = await buildReceiptPdfBytes(
      makeReceipt({ customer: makeCustomer({ name: "Ivan Šarić" }) })
    );
    expect(isPdf(bytes)).toBe(true);
    expect(pdfText(bytes)).toMatch(/Ivan .aric/);
  });
});

describe("MWST", () => {
  it("weist Netto, Satz und Betrag aus", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ vatEnabled: true })));
    expect(text).toContain("Netto");
    expect(text).toContain("MWST 8.1 %");
    expect(text).toContain("925.07");
    expect(text).toContain("74.93");
    expect(text).toContain("Total (inkl. MWST)");
  });

  it("nennt die MWST-Nummer der Firma", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ vatEnabled: true })));
    expect(text).toContain("MWST-Nr. CHE-123.456.789 MWST");
  });

  it("lässt die Aufschlüsselung weg, wenn nicht MWST-pflichtig", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ vatEnabled: false })));
    expect(text).not.toContain("MWST 8.1 %");
  });

  it("fällt bei Alt-Belegen ohne vatRate auf 8.1 % zurück statt 0.0 %", async () => {
    const receipt = makeReceipt({ vatEnabled: true });
    delete receipt.vatRate;
    delete receipt.netTotal;
    delete receipt.vatAmount;
    const text = pdfText(await buildReceiptPdfBytes(receipt));
    expect(text).toContain("MWST 8.1 %");
    expect(text).not.toContain("MWST 0.0 %");
  });
});

describe("Rabatt", () => {
  const produkt = { id: "p", description: "Router AX55", amount: 200, kind: "product", discountPercent: 25, articleNumber: "ART-001" };
  const dienstleistung = { id: "d", description: "Installation", amount: 400, kind: "service", discountPercent: 10 };

  it("zeigt beim Produkt Listenpreis, Rabatt und neuen Preis", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ items: [produkt] })));
    expect(text).toContain("CHF 200.00"); // durchgestrichener Listenpreis
    expect(text).toContain("Rabatt 25 %");
    expect(text).toContain("CHF 150.00");
    expect(text).toContain("ART-001");
  });

  it("zeigt bei der Dienstleistung nur Rabatt und neuen Preis", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ items: [dienstleistung] })));
    expect(text).toContain("Rabatt 10 %");
    expect(text).toContain("CHF 360.00");
    // Der Listenpreis darf bei Dienstleistungen nicht als Position erscheinen.
    const vorZwischensumme = text.split("Zwischensumme")[0];
    expect(vorZwischensumme).not.toContain("CHF 400.00");
  });

  it("rechnet die Zwischensumme aus Listenpreisen und Rabatt", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(makeReceipt({ items: [produkt, dienstleistung] }))
    );
    expect(text).toContain("Zwischensumme (Listenpreise)");
    expect(text).toContain("CHF 600.00"); // 200 + 400
    expect(text).toContain("CHF 90.00"); // 50 + 40
    expect(text).toContain("CHF 510.00"); // Total nach Rabatt
  });

  it("lässt Alt-Positionen ohne Rabattfelder unverändert", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(makeReceipt({ items: [{ id: "x", description: "Alte Position", amount: 250 }] }))
    );
    expect(text).toContain("CHF 250.00");
    expect(text).not.toContain("Rabatt");
    expect(text).not.toContain("Zwischensumme");
  });
});

describe("Fusszeile", () => {
  it("führt Adresse, Kontakt mit MWST-Nummer und IBAN", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt()));
    expect(text).toContain("ADRESSE");
    expect(text).toContain("KONTAKT");
    expect(text).toContain("BANKVERBINDUNG");
    expect(text).toContain("Bachstrasse 12");
    expect(text).toContain("info@munot-informatik.ch");
    expect(text).toContain("MWST-Nr.");
    expect(text).toContain("CH93 0076 2011 6238 5295 7");
  });

  it("bleibt weg, wenn keine Firmenangaben hinterlegt sind", async () => {
    const leer = { name: "", address: "", zipCity: "", email: "", phone: "", vatNumber: "", logoDataUrl: "", qrBill: {} };
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ company: leer })));
    expect(text).not.toContain("BANKVERBINDUNG");
  });
});

describe("Dokumentart", () => {
  it("nennt eine QR-Rechnung RECHNUNG und verweist auf den Einzahlungsschein", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: true })));
    expect(text).toContain("RECHNUNG");
    expect(text).toContain("Einzahlungsschein");
  });

  it("nennt eine Direktzahlung QUITTUNG mit Empfangsbestätigung", async () => {
    const text = pdfText(await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: false })));
    expect(text).toContain("QUITTUNG");
    expect(text).toContain("Betrag dankend erhalten");
    expect(text).not.toContain("Empfangsschein");
  });
});
