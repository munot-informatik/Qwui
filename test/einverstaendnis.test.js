// Einverständnis «E-Mail-Beleg»: Ohne Zustimmung darf eine E-Mail-Adresse
// nirgends dauerhaft liegen — weder beim Kunden noch auf der Quittung.
// Kunden aus Version 1.1 dürfen dabei aber keine Daten verlieren.

import { describe, it, expect } from "vitest";
import {
  hasEmailConsent,
  grantEmailConsent,
  withoutUnconsentedEmail,
  hasLegacyEmailWithoutConsent,
  isValidEmail,
} from "../shared/consent.js";

const kunde = { id: "c1", name: "Sandra Meier", email: "s.meier@example.ch" };

describe("Einverständnis E-Mail-Beleg", () => {
  it("entfernt die Adresse ohne Einverständnis", () => {
    expect(withoutUnconsentedEmail(kunde).email).toBe("");
    expect(withoutUnconsentedEmail({ ...kunde, emailConsent: null }).email).toBe("");
  });

  it("behält die Adresse mit Einverständnis samt Datum", () => {
    const mit = grantEmailConsent(kunde, "2027-02-13");
    expect(hasEmailConsent(mit)).toBe(true);
    expect(mit.emailConsent).toEqual({ given: true, at: "2027-02-13" });
    expect(withoutUnconsentedEmail(mit).email).toBe("s.meier@example.ch");
  });

  it("lässt die übrigen Angaben unverändert", () => {
    const ohne = withoutUnconsentedEmail({ ...kunde, phone: "079 123 45 67", city: "Schaffhausen" });
    expect(ohne).toMatchObject({ id: "c1", name: "Sandra Meier", phone: "079 123 45 67", city: "Schaffhausen" });
  });

  it("erkennt Kunden aus Version 1.1 mit Adresse, aber ohne Einverständnis", () => {
    expect(hasLegacyEmailWithoutConsent(kunde)).toBe(true);
    expect(hasLegacyEmailWithoutConsent(grantEmailConsent(kunde, "2027-01-01"))).toBe(false);
    expect(hasLegacyEmailWithoutConsent({ ...kunde, email: "" })).toBe(false);
  });
});

describe("Adresse prüfen", () => {
  it("erkennt Tippfehler vor dem Versand", () => {
    expect(isValidEmail("s.meier@example.ch")).toBe(true);
    expect(isValidEmail(" s.meier@example.ch ")).toBe(true);
    expect(isValidEmail("kein-gueltige-adresse")).toBe(false);
    expect(isValidEmail("s.meier@example")).toBe(false);
  });
});
