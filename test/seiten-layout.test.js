// Seitenaufteilung und Logo-Platzierung. Beides ist reine Geometrie und fällt
// im Alltag erst auf, wenn ein Beleg schon beim Kunden liegt.

import { describe, it, expect } from "vitest";
import { buildReceiptPdfBytes, buildMahnungPdfBytes } from "../src/receiptPdf.js";
import { pdfPages, isPdf } from "./helpers/pdfText.js";
import { makeReceipt, makeCompany, LOGO_DATA_URL } from "./helpers/fixtures.js";

const mitLogo = (extra = {}) => makeCompany({ logoDataUrl: LOGO_DATA_URL, ...extra });

describe("Fusszeile und Einzahlungsschein", () => {
  it("setzt bei einer QR-Rechnung die Fusszeile auf Seite 1 und den Schein auf Seite 2", async () => {
    const pages = pdfPages(await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: true })));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("RECHNUNG");
    expect(pages[0]).toContain("BANKVERBINDUNG");
    expect(pages[0]).not.toContain("Empfangsschein");
    expect(pages[1]).toContain("Empfangsschein");
    expect(pages[1]).toContain("Zahlteil");
    expect(pages[1]).not.toContain("BANKVERBINDUNG");
  });

  it("hält eine Quittung ohne Schein einseitig", async () => {
    const pages = pdfPages(await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: false })));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("BANKVERBINDUNG");
  });

  it("behandelt die Mahnung nach demselben Schema", async () => {
    const pages = pdfPages(
      await buildMahnungPdfBytes(makeReceipt({ qrBillEnabled: true, date: "2026-06-01", paymentTermDays: 14 }))
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("MAHNUNG");
    expect(pages[0]).toContain("BANKVERBINDUNG");
    expect(pages[1]).toContain("Empfangsschein");
  });

  it("bricht lange Belege um und zeigt die Fusszeile trotzdem genau einmal", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `x${i}`,
      description: `Position ${i + 1} mit einer etwas längeren Beschreibung`,
      amount: 20,
    }));
    const pages = pdfPages(await buildReceiptPdfBytes(makeReceipt({ items, qrBillEnabled: true })));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.filter((p) => p.includes("BANKVERBINDUNG"))).toHaveLength(1);
    expect(pages.some((p) => p.includes("LEISTUNG (Fortsetzung)"))).toBe(true);
    expect(pages.at(-1)).toContain("Empfangsschein");
  });
});

describe("Logo", () => {
  const anordnungen = ["inline", "above"];
  const ausrichtungen = ["left", "center", "right"];
  const groessen = ["small", "medium", "large"];

  it.each(anordnungen.flatMap((l) => ausrichtungen.flatMap((a) => groessen.map((s) => [l, a, s]))))(
    "erzeugt eine gültige PDF für %s / %s / %s",
    async (logoLayout, logoPosition, logoSize) => {
      const bytes = await buildReceiptPdfBytes(
        makeReceipt({ company: mitLogo({ logoLayout, logoPosition, logoSize }) })
      );
      expect(isPdf(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(3000);
    }
  );

  it("behält für Firmendaten ohne logoLayout das bisherige Verhalten", async () => {
    const links = mitLogo({ logoPosition: "left" });
    const mittig = mitLogo({ logoPosition: "center" });
    delete links.logoLayout;
    delete mittig.logoLayout;
    expect(isPdf(await buildReceiptPdfBytes(makeReceipt({ company: links })))).toBe(true);
    expect(isPdf(await buildReceiptPdfBytes(makeReceipt({ company: mittig })))).toBe(true);
  });
});
