// Etiketten mit Strichcode: Der Code muss genau die gespeicherte Seriennummer
// enthalten, sonst findet die Garantie-Suche das Stück nach dem Scannen nicht.
// Die Muster wurden einmalig Zeichen für Zeichen mit JsBarcode verglichen;
// hier stehen feste Beispiele, damit eine Änderung an der Tabelle auffällt.

import { describe, it, expect } from "vitest";
import { canEncode, code128Values, code128Widths, code128Binary, code128Bars, fitsWidth, QUIET_ZONE } from "../shared/code128.js";

describe("Code 128", () => {
  it("berechnet das Prüfzeichen (gewichtete Summe modulo 103)", () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879, 879 mod 103 = 55
    expect(code128Values("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55]);
  });

  it("liefert für eine Seriennummer dasselbe Muster wie JsBarcode", () => {
    expect(code128Binary("PR-1001")).toBe(
      "1101001000011101110110110001011101001101110010011100110100111011001001110110010011100110101100010001100011101011"
    );
  });

  it("nimmt für reine Ziffern gerader Länge den kompakten Zeichensatz C", () => {
    expect(code128Values("123456")).toEqual([105, 12, 34, 56, 44]);
    expect(code128Binary("123456").length).toBeLessThan(code128Binary("12345").length);
  });

  it("hat die richtige Länge: 11 Module je Zeichen, 13 für den Stopp", () => {
    for (const s of ["X1", "PR-1002-8B47", "S/N 9.5"]) {
      const sum = code128Widths(s).reduce((a, b) => a + b, 0);
      expect(sum).toBe(11 * (s.length + 2) + 13);
    }
  });

  it("zeichnet Balken mit Ruhezone links und rechts", () => {
    const { bars, totalWidth } = code128Bars("AB12");
    expect(bars[0].x).toBe(QUIET_ZONE);
    const last = bars.at(-1);
    expect(totalWidth - (last.x + last.width)).toBe(QUIET_ZONE);
  });

  it("lehnt ab, was sich nicht drucken lässt", () => {
    expect(canEncode("PR-1001")).toBe(true);
    expect(canEncode("Müller-1")).toBe(false);
    expect(canEncode("")).toBe(false);
    expect(canEncode("x".repeat(49))).toBe(false);
    expect(() => code128Values("Ä1")).toThrow(/nicht als Strichcode/);
  });

  it("meldet, wenn eine Nummer zu lang für einen lesbaren Strichcode ist", () => {
    // Etikett 62 mm, davon 56 mm für den Strichcode
    expect(fitsWidth("PR-1002-8B47", 56)).toBe(true);
    expect(fitsWidth("X".repeat(30), 56)).toBe(false);
    expect(fitsWidth("Ä1", 56)).toBe(false);
  });
});
