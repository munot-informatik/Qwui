// Auswertungen für den Assistenten: richtige Zahlen — und keine Personendaten.
// Was hier herausgeht, landet bei Claude; Namen, Adressen, E-Mails und
// Telefonnummern dürfen nie dabei sein, nur Kunden-IDs.

import { describe, it, expect } from "vitest";
import { searchArticles, stockReport, serialReport, salesReport, slowMovers } from "../shared/reports.js";
import { makeGoodsInDraft, makeArticleDraft, draftSummary } from "../shared/drafts.js";

const inventory = [
  { id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 2, serialTracked: true },
  { id: "q2", articleNumber: "PRED-P3", name: "Predator P3", group: "Queues", price: 1290, stock: 0, serialTracked: true },
  { id: "k", articleNumber: "KR-01", name: "Kreide", group: "Zubehör", price: 4, stock: 40 },
  { id: "t", articleNumber: "TU-01", name: "Pomeranze", group: "Zubehör", price: 9, stock: 0 },
];
const units = [
  { id: "u1", productId: "q", serial: "PR-1001", status: "an_lager", receivedAt: "2026-06-01T09:00:00.000Z", purchasePrice: 600 },
  { id: "u2", productId: "q", serial: "PR-1002", status: "verkauft", receivedAt: "2026-06-01T09:00:00.000Z", soldAt: "2027-02-01T15:00:00.000Z", receiptId: "r1", receiptNumber: "0001", customerId: "c1" },
  { id: "u3", productId: "q", serial: "PR-1003", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" },
];
const customer = { id: "c1", name: "Sandra Meier", street: "Vordergasse", houseNumber: "48", city: "Schaffhausen", email: "s.meier@example.ch", phone: "079 123 45 67" };
const receipts = [
  {
    id: "r1", number: "0001", date: "2027-02-01", total: 898, customer,
    items: [
      { kind: "product", productId: "q", articleNumber: "PRED-REVO", description: "Predator Revo", amount: "890", serial: "PR-1002" },
      { kind: "product", productId: "k", articleNumber: "KR-01", description: "Kreide", amount: "4", quantity: 2 },
    ],
  },
  { id: "r2", number: "0002", date: "2027-02-10", total: 45, qrBillEnabled: true, paid: false, customer, items: [{ kind: "service", description: "Queue-Service", amount: "45" }] },
  { id: "r3", number: "0003", date: "2026-12-20", total: 12, customer, items: [{ kind: "product", productId: "k", articleNumber: "KR-01", description: "Kreide", amount: "4", quantity: 3 }] },
];
const movements = [{ type: "verkauf", productId: "k", at: "2027-02-01T15:00:00.000Z", qty: -2 }];

const PERSONENDATEN = ["Sandra", "Meier", "Vordergasse", "Schaffhausen", "s.meier", "079 123"];

function expectNoPersonalData(result) {
  const text = JSON.stringify(result);
  for (const p of PERSONENDATEN) expect(text).not.toContain(p);
}

describe("artikel_suchen", () => {
  it("findet über Name, Nummer und Gruppe", () => {
    expect(searchArticles(inventory, units, { query: "predator" }).map((a) => a.articleNumber)).toEqual(["PRED-P3", "PRED-REVO"]);
    expect(searchArticles(inventory, units, { group: "zubehör" })).toHaveLength(2);
    expect(searchArticles(inventory, units, { query: "revo" })[0]).toEqual({
      articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, serialTracked: true, available: 2,
    });
  });
});

describe("bestand_abfragen", () => {
  it("liefert Menge und Exemplare an Lager", () => {
    const r = stockReport(inventory, units, "PRED-REVO");
    expect(r).toMatchObject({ found: true, available: 2, unitsReserved: 0 });
    expect(r.unitsInStock.map((u) => u.serial)).toEqual(["PR-1001", "PR-1003"]);
  });

  it("schlägt bei unklarer Angabe passende Artikel vor", () => {
    const r = stockReport(inventory, units, "Predator");
    expect(r.found).toBe(false);
    expect(r.candidates.map((c) => c.articleNumber)).toEqual(["PRED-P3", "PRED-REVO"]);
  });
});

describe("seriennummer_suchen", () => {
  it("nennt Status, Quittung und nur die Kunden-ID", () => {
    const r = serialReport(units, inventory, "pr-1002");
    expect(r).toMatchObject({ found: true, status: "verkauft", receiptNumber: "0001", customerId: "c1", articleNumber: "PRED-REVO" });
    expectNoPersonalData(r);
  });

  it("gibt keinen Einkaufspreis heraus", () => {
    expect(JSON.stringify(serialReport(units, inventory, "PR-1001"))).not.toContain("600");
  });
});

describe("umsatz_auswerten", () => {
  it("summiert im Zeitraum und zeigt die Top-Artikel", () => {
    const r = salesReport(receipts, inventory, { from: "2027-02-01", to: "2027-02-28" });
    expect(r).toMatchObject({ receiptCount: 2, total: 943, openInvoices: 45 });
    expect(r.topArticles[0]).toEqual({ articleNumber: "PRED-REVO", name: "Predator Revo", quantity: 1, revenue: 890 });
    expectNoPersonalData(r);
  });

  it("filtert nach Produktgruppe", () => {
    const r = salesReport(receipts, inventory, { from: "2026-01-01", to: "2027-12-31", group: "Zubehör" });
    expect(r).toMatchObject({ receiptCount: 2, total: 20 });
    expect(r.topArticles).toEqual([{ articleNumber: "KR-01", name: "Kreide", quantity: 5, revenue: 20 }]);
  });
});

describe("ladenhueter", () => {
  it("findet lange gelagerte Exemplare und unverkaufte Artikel", () => {
    const r = slowMovers(inventory, units, movements, { days: 90, now: new Date("2027-02-13T10:00:00.000Z") });
    expect(r.units.map((u) => u.serial)).toEqual(["PR-1001"]);
    expect(r.units[0].daysInStock).toBe(257);
    expect(r.articles).toEqual([]); // Kreide wurde verkauft, Pomeranze hat keinen Bestand
    const later = slowMovers(inventory, units, movements, { days: 5, now: new Date("2027-02-13T10:00:00.000Z") });
    expect(later.articles.map((a) => a.articleNumber)).toEqual(["KR-01"]);
  });
});

describe("Entwürfe", () => {
  const ctx = { now: "2027-02-13T10:00:00.000Z", newId: () => "d1" };

  it("legt einen Wareneingang mit Seriennummern als offenen Entwurf an", () => {
    const d = makeGoodsInDraft({ article: "PRED-REVO", serials: ["PR-2001", " PR-2002 ", ""] }, ctx);
    expect(d).toMatchObject({ id: "d1", type: "wareneingang", status: "offen", source: "assistent" });
    expect(d.payload).toMatchObject({ article: "PRED-REVO", serials: ["PR-2001", "PR-2002"], quantity: 2 });
    expect(draftSummary(d)).toMatchObject({ draftId: "d1", quantity: 2 });
  });

  it("verlangt Artikel und Menge", () => {
    expect(() => makeGoodsInDraft({ quantity: 3 }, ctx)).toThrow(/Artikel/);
    expect(() => makeGoodsInDraft({ article: "KR-01", quantity: 0 }, ctx)).toThrow(/Menge/);
  });

  it("legt einen Artikel mit Shop-Text an und prüft den Preis", () => {
    const d = makeArticleDraft({ name: "Predator Ikon", group: "Queues", price: "1490.5", shopText: "Leichtes Queue" }, ctx);
    expect(d.payload).toMatchObject({ name: "Predator Ikon", price: 1490.5, shopText: "Leichtes Queue", serialTracked: false });
    expect(() => makeArticleDraft({ name: "X", price: -1 }, ctx)).toThrow(/Preis/);
  });
});
