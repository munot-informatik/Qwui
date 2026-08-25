// Zahlungsfrist: muss überall dieselbe sein — auf der Rechnung, in der Mahnung
// und beim daraus berechneten Fälligkeitsdatum. Stimmt eine Stelle nicht,
// mahnt die Buchhaltung zu einem anderen Zeitpunkt als der Beleg ankündigt.

import { describe, it, expect } from "vitest";
import { buildReceiptPdfBytes, buildMahnungPdfBytes } from "../src/receiptPdf.js";
import { pdfText } from "./helpers/pdfText.js";
import { makeReceipt } from "./helpers/fixtures.js";

const OPTIONEN = [10, 14, 20, 30, 60];

describe("Frist auf der Rechnung", () => {
  it.each(OPTIONEN)("nennt %i Tage im Schlusstext", async (tage) => {
    const text = pdfText(
      await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: true, paymentTermDays: tage }))
    );
    expect(text).toContain(`innert ${tage} Tagen`);
    for (const andere of OPTIONEN.filter((d) => d !== tage)) {
      expect(text).not.toContain(`innert ${andere} Tagen`);
    }
  });

  it("schreibt den Singular bei einem Tag", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: true, paymentTermDays: 1 }))
    );
    expect(text).toContain("innert 1 Tag");
    expect(text).not.toContain("innert 1 Tagen");
  });

  it("fällt ohne gesetzte Frist auf 30 Tage zurück", async () => {
    const receipt = makeReceipt({ qrBillEnabled: true });
    delete receipt.paymentTermDays;
    expect(pdfText(await buildReceiptPdfBytes(receipt))).toContain("innert 30 Tagen");
  });

  it("nennt bei einer Quittung gar keine Frist", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(makeReceipt({ qrBillEnabled: false, paymentTermDays: 14 }))
    );
    expect(text).not.toContain("innert");
  });
});

describe("Fälligkeitsdatum in der Mahnung", () => {
  // Rechnungsdatum 01.06.2026 plus Frist
  const erwartet = {
    10: "11.06.2026",
    14: "15.06.2026",
    20: "21.06.2026",
    30: "01.07.2026",
    60: "31.07.2026",
  };

  it.each(OPTIONEN)("rechnet bei %i Tagen korrekt", async (tage) => {
    const text = pdfText(
      await buildMahnungPdfBytes(
        makeReceipt({ qrBillEnabled: true, date: "2026-06-01", paymentTermDays: tage })
      )
    );
    expect(text).toContain(`Zahlungsfrist von ${tage} Tagen`);
    expect(text).toContain(erwartet[tage]);
  });
});
