// Shop-Feed: Der Shop muss Bestand und Preis richtig zeigen — und darf nie
// eine Seriennummer oder einen Einkaufspreis zu sehen bekommen.

import { describe, it, expect } from "vitest";
import { buildShopFeed, shopFeedCsv, feedFingerprint } from "../shared/shopFeed.js";

const inventory = [
  { id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 3, serialTracked: true, purchasePrice: 600 },
  { id: "k", articleNumber: "KR-01", name: "Kreide; blau", group: "Zubehör", price: 4.5, stock: 12 },
  { id: "t", articleNumber: "TU-01", name: "Pomeranze", group: "Zubehör", price: 9, stock: -2 },
];
const units = [
  { id: "u1", productId: "q", serial: "PR-1001", status: "an_lager", purchasePrice: 600 },
  { id: "u2", productId: "q", serial: "PR-1002", status: "verkauft", purchasePrice: 600 },
  { id: "u3", productId: "q", serial: "PR-1003", status: "reserviert", purchasePrice: 600 },
];

describe("Shop-Feed", () => {
  const feed = buildShopFeed(inventory, units, "2027-02-13T10:00:00.000Z");

  it("enthält pro Artikel genau die vereinbarten Felder", () => {
    expect(feed.items.find((i) => i.articleNumber === "PRED-REVO")).toEqual({
      articleNumber: "PRED-REVO",
      name: "Predator Revo",
      group: "Queues",
      price: 890,
      available: 1,
      status: "verfügbar",
    });
  });

  it("verrät weder Seriennummern noch Einkaufspreise", () => {
    const text = JSON.stringify(feed) + shopFeedCsv(feed);
    for (const geheim of ["PR-100", "600", "purchase", "serial", "stock", "reserviert"]) {
      expect(text).not.toContain(geheim);
    }
  });

  it("zählt bei Seriennummernpflicht nur Exemplare an Lager", () => {
    expect(feed.items.find((i) => i.articleNumber === "PRED-REVO").available).toBe(1);
  });

  it("meldet negativen Bestand als 0 und ausverkauft", () => {
    expect(feed.items.find((i) => i.articleNumber === "TU-01")).toMatchObject({ available: 0, status: "ausverkauft" });
  });

  it("schreibt eine CSV mit Semikolon und sicher gequoteten Feldern", () => {
    const csv = shopFeedCsv(feed).split("\r\n");
    expect(csv[0]).toBe("Artikelnummer;Name;Produktgruppe;Preis;Verfügbar;Status");
    expect(csv).toContain('KR-01;"Kreide; blau";Zubehör;4.50;12;verfügbar');
  });

  it("erkennt unveränderte Inhalte trotz neuem Zeitstempel", () => {
    const later = buildShopFeed(inventory, units, "2027-02-14T10:00:00.000Z");
    expect(feedFingerprint(later)).toBe(feedFingerprint(feed));
    const sold = buildShopFeed(inventory, units.map((u) => ({ ...u, status: "verkauft" })));
    expect(feedFingerprint(sold)).not.toBe(feedFingerprint(feed));
  });
});
