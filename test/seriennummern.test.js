// Seriennummern: Eine Nummer darf nur einmal existieren, egal wie der Scanner
// sie tippt. Sonst lässt sich im Garantiefall nicht mehr eindeutig sagen,
// welches Exemplar an wen verkauft wurde.

import { describe, it, expect } from "vitest";
import { normalizeSerial, findUnitBySerial, checkNewSerials, isSellable } from "../shared/serials.js";

const UNITS = [
  { id: "u1", serial: "PR-1001", status: "an_lager" },
  { id: "u2", serial: "PR-1002", status: "verkauft" },
];

describe("Vergleich", () => {
  it("ignoriert Gross-/Kleinschreibung und Leerzeichen am Rand", () => {
    expect(normalizeSerial("  pr-1001 ")).toBe("PR-1001");
    expect(findUnitBySerial(UNITS, "pr-1002\t").id).toBe("u2");
  });

  it("findet nichts bei leerer Eingabe", () => {
    expect(findUnitBySerial(UNITS, "   ")).toBeNull();
  });
});

describe("Neue Seriennummern", () => {
  it("meldet Nummern, die es schon gibt", () => {
    expect(checkNewSerials(["PR-1003", "pr-1001"], UNITS)).toEqual(["Seriennummer pr-1001 ist bereits vorhanden."]);
  });

  it("meldet doppelte Scans innerhalb derselben Erfassung", () => {
    expect(checkNewSerials(["PR-2000", "PR-2000 "], UNITS)).toEqual(["Seriennummer PR-2000 ist doppelt erfasst."]);
  });

  it("meldet leere Nummern", () => {
    expect(checkNewSerials([""], UNITS)).toEqual(["Leere Seriennummer."]);
  });

  it("akzeptiert neue, eindeutige Nummern", () => {
    expect(checkNewSerials(["PR-3000", "PR-3001"], UNITS)).toEqual([]);
  });
});

describe("Verkäuflich", () => {
  it("lässt an Lager und reserviert zu, verkauft und retourniert nicht", () => {
    expect(isSellable({ status: "an_lager" })).toBe(true);
    expect(isSellable({ status: "reserviert" })).toBe(true);
    expect(isSellable({ status: "verkauft" })).toBe(false);
    expect(isSellable({ status: "retourniert" })).toBe(false);
  });
});
