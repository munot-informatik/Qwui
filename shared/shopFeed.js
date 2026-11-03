// Shop-Feed: was der Online-Shop über Bestand und Preise wissen darf. Pro
// Artikel Artikelnummer, Name, Produktgruppe, Preis, verfügbare Menge und
// Status — bewusst NICHT mehr. Seriennummern und Einkaufspreise bleiben
// ausschliesslich in Qwui; die Felder werden hier einzeln übernommen statt
// den Artikel zu kopieren, damit ein neues internes Feld nie versehentlich
// nach aussen gelangt.

import { productStock } from "./stock.js";

export const FEED_VERSION = 1;
export const FEED_STATUS = { available: "verfügbar", soldOut: "ausverkauft" };

export function buildShopFeed(inventory, units, now = new Date().toISOString()) {
  const items = [...(inventory || [])]
    .sort((a, b) => (a.articleNumber || a.name || "").localeCompare(b.articleNumber || b.name || "", "de-CH"))
    .map((p) => {
      const available = Math.max(0, productStock(p, units));
      return {
        articleNumber: String(p.articleNumber || ""),
        name: String(p.name || ""),
        group: String(p.group || ""),
        price: Math.round((Number(p.price) || 0) * 100) / 100,
        available,
        status: available > 0 ? FEED_STATUS.available : FEED_STATUS.soldOut,
      };
    });
  return { version: FEED_VERSION, generatedAt: now, items };
}

// Inhalt ohne Zeitstempel — zum Erkennen, ob sich seit dem letzten Abgleich
// überhaupt etwas geändert hat.
export function feedFingerprint(feed) {
  return JSON.stringify(feed.items);
}

const CSV_COLUMNS = [
  ["Artikelnummer", "articleNumber"],
  ["Name", "name"],
  ["Produktgruppe", "group"],
  ["Preis", "price"],
  ["Verfügbar", "available"],
  ["Status", "status"],
];

function csvCell(value) {
  const text = typeof value === "number" ? String(value) : String(value ?? "");
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Semikolon als Trennzeichen, wie es Excel mit Schweizer Einstellungen
// erwartet; Preis mit Punkt, damit Shop-Importe ihn als Zahl lesen.
export function shopFeedCsv(feed) {
  const lines = [CSV_COLUMNS.map(([title]) => title).join(";")];
  for (const item of feed.items) {
    lines.push(CSV_COLUMNS.map(([, key]) => csvCell(key === "price" ? item.price.toFixed(2) : item[key])).join(";"));
  }
  return lines.join("\r\n") + "\r\n";
}
