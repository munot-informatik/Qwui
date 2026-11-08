// Seriennummern aus Fotos: Die Texterkennung liefert alles vom Etikett. Die
// Vorschläge müssen die Seriennummer zuerst nennen und Datum, Jahr oder Preis
// aussortieren. Der Bildpfad darf nie als Befehl ausgeführt werden.

import { describe, it, expect } from "vitest";
import { extractSerialCandidates, confusableChars } from "../shared/serialOcr.js";
import { recognizeText, parseOcrOutput, ocrErrorMessage } from "../desktop/ocr.js";

describe("Vorschläge aus dem Fototext", () => {
  it("nennt die Nummer nach einer Bezeichnung zuerst", () => {
    expect(extractSerialCandidates(["Predator Revo 12.9", "S/N: PR-1002-8B47", "Made in Taiwan 2026"])[0]).toBe("PR-1002-8B47");
  });

  it.each([
    ["SN PR1001"],
    ["S/N PR1001"],
    ["Serial No.: PR1001"],
    ["Serial Number: PR1001"],
    ["Seriennummer: PR1001"],
    ["Seriennr: PR1001"],
  ])("erkennt die Bezeichnung in «%s»", (zeile) => {
    expect(extractSerialCandidates(["Modell X200", zeile])[0]).toBe("PR1001");
  });

  it("hält Wörter wie «Snooker» nicht für eine Bezeichnung", () => {
    const vorschlaege = extractSerialCandidates(["Snooker 147", "Serial: AB1234"]);
    expect(vorschlaege[0]).toBe("AB1234");
    expect(vorschlaege).not.toContain("ooker147");
    // «SN» direkt vor Ziffern bleibt erkannt
    expect(extractSerialCandidates(["SN123456"])).toContain("123456");
  });

  it("findet die Nummer auf der Zeile nach der Bezeichnung", () => {
    expect(extractSerialCandidates(["Modell X200", "Serial Number", "AB12345"])[0]).toBe("AB12345");
  });

  it("schlägt zusammengesetzt vor, was die Erkennung mit Leerzeichen getrennt hat", () => {
    expect(extractSerialCandidates(["S/N: PR 1001"])).toContain("PR1001");
  });

  it("nimmt ohne Bezeichnung Buchstaben-Ziffern-Folgen vor reinen Ziffern", () => {
    expect(extractSerialCandidates(["123456", "AB-998877"])).toEqual(["AB-998877", "123456"]);
  });

  it("sortiert Datum, Jahr, Preis und Wörter aus", () => {
    expect(extractSerialCandidates(["Made in Taiwan 2026", "13.02.2027 2027-02-13", "890.00", "www.example2.ch", "12.9"])).toEqual([]);
  });

  it("nennt dieselbe Nummer nur einmal", () => {
    expect(extractSerialCandidates(["S/N: pr-1001", "PR-1001"])).toEqual(["pr-1001"]);
  });

  it("kommt mit leerer Erkennung zurecht", () => {
    expect(extractSerialCandidates([])).toEqual([]);
    expect(extractSerialCandidates(null)).toEqual([]);
  });
});

describe("Ähnliche Zeichen", () => {
  it("nennt die Stellen, die sich zu prüfen lohnen", () => {
    expect(confusableChars("PR-1002-8B47")).toEqual(["1/I", "0/O", "2/Z", "8/B"]);
    expect(confusableChars("XYZ")).toEqual(["2/Z"]);
    expect(confusableChars("ACD")).toEqual([]);
  });
});

describe("Aufruf der Texterkennung", () => {
  it("übergibt den Pfad nur als Umgebungsvariable, nie im Befehl", async () => {
    const boese = "C:\\Fotos\\a'; Remove-Item -Recurse C:\\ ;'.jpg";
    let args;
    let options;
    const lines = await recognizeText(boese, (_cmd, a, o, cb) => {
      args = a;
      options = o;
      cb(null, '["S/N: X1234"]', "");
    });
    expect(lines).toEqual(["S/N: X1234"]);
    expect(options.env.QWUI_OCR_FILE).toBe(boese);
    const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    expect(script).not.toContain("Remove-Item");
    expect(args.join(" ")).not.toContain("Remove-Item");
    expect(script).toContain("$env:QWUI_OCR_FILE");
  });

  it("liefert verständliche Fehler", async () => {
    await expect(
      recognizeText("x.jpg", (_c, _a, _o, cb) => cb(Object.assign(new Error("failed"), {}), "", "NO_LANGUAGE"))
    ).rejects.toThrow(/keine Sprache/);
    expect(ocrErrorMessage({ killed: true })).toMatch(/zu lange/);
    expect(ocrErrorMessage({ stderr: "TOO_LARGE" })).toMatch(/zu gross/);
    expect(ocrErrorMessage(new Error("irgendwas"))).toMatch(/von Hand/);
  });

  it("liest ein- und mehrzeilige Ausgaben", () => {
    expect(parseOcrOutput('["a","b"]')).toEqual(["a", "b"]);
    expect(parseOcrOutput('"a"')).toEqual(["a"]);
    expect(parseOcrOutput("")).toEqual([]);
    expect(parseOcrOutput("null")).toEqual([]);
  });
});
