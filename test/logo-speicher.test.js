// Logo-Auslagerung der Web-Speicherschicht. Ohne sie speichert jede Quittung
// ihr eigenes Firmenlogo (~100 KB), und die gesamte Quittungsliste liegt in
// EINEM Datenbankwert — nach einigen Dutzend Belegen scheitert jedes Speichern
// an der Wertgrösse von D1.

import { describe, it, expect, beforeEach, vi } from "vitest";

// In-Memory-Nachbildung von /api/storage (gleiche Semantik wie
// functions/api/storage.js).
const db = new Map();
let writes = 0;

function installFetchStub() {
  db.clear();
  writes = 0;
  vi.stubGlobal("fetch", async (url, init = {}) => {
    const u = new URL(url, "http://localhost");
    const json = (body, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
    if (init.method === "POST") {
      const { key, value, shared } = JSON.parse(init.body);
      if (typeof value !== "string") return json({ error: "value muss ein String sein" }, 400);
      writes++;
      db.set(`${shared ? "shared" : "personal"}:${key}`, value);
      return json({ key, value, shared: !!shared });
    }
    const key = u.searchParams.get("key");
    const shared = u.searchParams.get("shared") === "true";
    const full = `${shared ? "shared" : "personal"}:${key}`;
    if (!db.has(full)) return json(null);
    return json({ key, value: db.get(full), shared });
  });
}

const LOGO = "data:image/png;base64," + "A".repeat(108 * 1024); // ~108 KB wie ein 300px-Logo
const company = {
  name: "Munot Informatik",
  logoDataUrl: LOGO,
  qrBill: { iban: "CH9300762011623852957", name: "Munot Informatik" },
};
const receipts = Array.from({ length: 50 }, (_, i) => ({
  id: "r" + i,
  number: String(i + 1).padStart(4, "0"),
  date: "2026-08-24",
  customer: { name: "Kunde " + i },
  items: [{ id: "i", description: "Leistung", amount: 100 }],
  total: 100,
  qrBillEnabled: false,
  paid: true,
  company: { ...company },
}));

let storageShim;
beforeEach(async () => {
  installFetchStub();
  vi.resetModules();
  ({ storageShim } = await import("../src/apiStorage.js"));
});

describe("Auslagerung", () => {
  it("legt ein Logo einmal ab, statt es pro Quittung zu wiederholen", async () => {
    const eingebettet = JSON.stringify(receipts).length;
    await storageShim.set("receipts-list", JSON.stringify(receipts), false);

    const liste = db.get("personal:receipts-list");
    const logoZeilen = [...db.keys()].filter((k) => k.startsWith("personal:logo:"));

    expect(logoZeilen).toHaveLength(1);
    expect(liste).not.toContain("logoDataUrl");
    expect(liste).toContain("logoRef");
    // Aus über 5 MB wird ein Bruchteil davon.
    expect(liste.length).toBeLessThan(eingebettet / 20);
  });

  it("stellt die Logos beim Laden vollständig wieder her", async () => {
    await storageShim.set("receipts-list", JSON.stringify(receipts), false);
    const zurueck = JSON.parse((await storageShim.get("receipts-list", false)).value);

    expect(zurueck).toHaveLength(50);
    expect(zurueck.every((r) => r.company.logoDataUrl === LOGO)).toBe(true);
    expect(zurueck.every((r) => !r.company.logoRef)).toBe(true);
    expect(zurueck[7].number).toBe("0008");
  });

  it("lädt dasselbe Logo beim erneuten Speichern nicht noch einmal hoch", async () => {
    await storageShim.set("receipts-list", JSON.stringify(receipts), false);
    const zurueck = JSON.parse((await storageShim.get("receipts-list", false)).value);
    const vorher = writes;
    await storageShim.set("receipts-list", JSON.stringify(zurueck), false);
    expect(writes - vorher).toBe(1); // nur die Liste selbst
  });

  it("gibt jedem unterschiedlichen Logo eine eigene Zeile", async () => {
    await storageShim.set("receipts-list", JSON.stringify(receipts), false);
    const anderes = LOGO.replace("AAAA", "BBBB");
    await storageShim.set(
      "receipts-list",
      JSON.stringify([{ ...receipts[0], company: { ...company, logoDataUrl: anderes } }]),
      false
    );
    expect([...db.keys()].filter((k) => k.startsWith("personal:logo:"))).toHaveLength(2);
    const zurueck = JSON.parse((await storageShim.get("receipts-list", false)).value);
    expect(zurueck[0].company.logoDataUrl).toBe(anderes);
  });
});

describe("Bestandsdaten", () => {
  it("liest Quittungen mit eingebettetem Logo unverändert", async () => {
    db.set("personal:receipts-list", JSON.stringify(receipts.slice(0, 3)));
    const geladen = JSON.parse((await storageShim.get("receipts-list", false)).value);
    expect(geladen).toHaveLength(3);
    expect(geladen[0].company.logoDataUrl).toBe(LOGO);
  });

  it("lagert sie beim nächsten Speichern aus", async () => {
    db.set("personal:receipts-list", JSON.stringify(receipts.slice(0, 3)));
    const geladen = JSON.parse((await storageShim.get("receipts-list", false)).value);
    await storageShim.set("receipts-list", JSON.stringify(geladen), false);
    expect(db.get("personal:receipts-list")).not.toContain("logoDataUrl");
  });

  it("lässt andere Schlüssel unangetastet", async () => {
    await storageShim.set("company-info", JSON.stringify(company), false);
    const zurueck = JSON.parse((await storageShim.get("company-info", false)).value);
    expect(zurueck.logoDataUrl).toBe(LOGO); // Firmendaten behalten das Logo inline
  });
});
