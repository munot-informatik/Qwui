// Auswertungen für den Assistenten (lokale API → MCP-Server → Claude).
//
// Datenschutz: Keine dieser Funktionen gibt Personendaten heraus — keine
// Namen, Adressen, E-Mails oder Telefonnummern, nur Kunden-IDs. Die
// Zuordnung ID → Person passiert ausschliesslich in der App. Deshalb werden
// alle Ausgaben Feld für Feld zusammengesetzt, nie durch Kopieren eines
// Kunden oder einer Quittung.

import { productStock, isSerialTracked, MOVEMENT_TYPE } from "./stock.js";
import { UNIT_STATUS, findUnitBySerial, normalizeSerial } from "./serials.js";
import { itemKind, itemQuantity, itemLineTotal } from "./items.js";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function articleSummary(p, units) {
  return {
    articleNumber: p.articleNumber || "",
    name: p.name || "",
    group: p.group || "",
    price: round2(p.price),
    serialTracked: isSerialTracked(p),
    available: productStock(p, units),
  };
}

// artikel_suchen: Suche über Name, Artikelnummer und Gruppe (Teilwörter,
// Gross-/Kleinschreibung egal). Ohne Suchbegriff alle Artikel.
export function searchArticles(inventory, units, { query = "", group = "" } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const wantedGroup = String(group).trim().toLowerCase();
  return (inventory || [])
    .filter((p) => !wantedGroup || (p.group || "").toLowerCase().includes(wantedGroup))
    .filter((p) => {
      const hay = `${p.name || ""} ${p.articleNumber || ""} ${p.group || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de-CH"))
    .map((p) => articleSummary(p, units));
}

// Artikel per Artikelnummer (exakt) oder sonst per Name/Teilwort finden.
export function findArticle(inventory, ref) {
  const wanted = String(ref || "").trim().toLowerCase();
  if (!wanted) return null;
  return (
    (inventory || []).find((p) => (p.articleNumber || "").toLowerCase() === wanted) ||
    (inventory || []).find((p) => (p.name || "").toLowerCase() === wanted) ||
    null
  );
}

// bestand_abfragen: Menge und — bei Seriennummernpflicht — die Exemplare an Lager.
export function stockReport(inventory, units, ref) {
  const p = findArticle(inventory, ref);
  if (!p) {
    const candidates = searchArticles(inventory, units, { query: ref });
    return { found: false, candidates: candidates.slice(0, 10) };
  }
  const result = { found: true, ...articleSummary(p, units) };
  if (isSerialTracked(p)) {
    result.unitsInStock = (units || [])
      .filter((u) => u.productId === p.id && u.status === UNIT_STATUS.inStock)
      .map((u) => ({ serial: u.serial, receivedAt: u.receivedAt }));
    result.unitsReserved = (units || []).filter((u) => u.productId === p.id && u.status === UNIT_STATUS.reserved).length;
  }
  return result;
}

// seriennummer_suchen: Status und Daten eines Exemplars — Kunde nur als ID.
export function serialReport(units, inventory, serial) {
  const u = findUnitBySerial(units, serial);
  if (!u) {
    const q = normalizeSerial(serial);
    const similar = (units || []).filter((x) => q && normalizeSerial(x.serial).includes(q)).map((x) => x.serial);
    return { found: false, similar: similar.slice(0, 10) };
  }
  const p = (inventory || []).find((x) => x.id === u.productId);
  return {
    found: true,
    serial: u.serial,
    articleNumber: p?.articleNumber || "",
    articleName: p?.name || "",
    status: u.status,
    receivedAt: u.receivedAt || null,
    soldAt: u.soldAt || null,
    receiptNumber: u.receiptNumber ?? u.returnedFrom?.receiptNumber ?? null,
    customerId: u.customerId || u.returnedFrom?.customerId || null,
    returned: !!u.returnedFrom,
  };
}

// umsatz_auswerten: Summen, Anzahl und Top-Artikel in einem Zeitraum
// (Quittungsdatum, beide Grenzen inklusive). Mit Produktgruppe zählen nur
// Produktpositionen dieser Gruppe.
export function salesReport(receipts, inventory, { from, to, group = "" } = {}) {
  const wantedGroup = String(group).trim().toLowerCase();
  const byId = new Map((inventory || []).map((p) => [p.id, p]));
  const groupOf = (it) => {
    const p = it.productId ? byId.get(it.productId) : (inventory || []).find((x) => x.articleNumber && x.articleNumber === it.articleNumber);
    return (p?.group || "").toLowerCase();
  };
  const inRange = (r) => (!from || r.date >= from) && (!to || r.date <= to);

  let total = 0;
  let receiptCount = 0;
  let open = 0;
  const top = new Map();
  for (const r of (receipts || []).filter(inRange)) {
    const items = (r.items || []).filter(
      (it) => !wantedGroup || (itemKind(it) === "product" && groupOf(it).includes(wantedGroup))
    );
    if (items.length === 0) continue;
    receiptCount++;
    const sum = wantedGroup ? items.reduce((s, it) => s + itemLineTotal(it), 0) : Number(r.total) || 0;
    total += sum;
    if (r.qrBillEnabled && !r.paid) open += sum;
    for (const it of items) {
      if (itemKind(it) !== "product") continue;
      // Name aus dem Inventar, nie aus dem Beschreibungsfeld: Das ist Freitext
      // und kann Namen oder Telefonnummern enthalten.
      const p = it.productId ? byId.get(it.productId) : (inventory || []).find((x) => x.articleNumber && x.articleNumber === it.articleNumber);
      const articleNumber = p?.articleNumber || "";
      const key = p ? p.id : "(freie Position)";
      const entry = top.get(key) || { articleNumber, name: p ? p.name || "" : "(freie Position)", quantity: 0, revenue: 0 };
      entry.quantity += itemQuantity(it);
      entry.revenue = round2(entry.revenue + itemLineTotal(it));
      top.set(key, entry);
    }
  }
  return {
    from: from || null,
    to: to || null,
    group: group || null,
    receiptCount,
    total: round2(total),
    openInvoices: round2(open),
    topArticles: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

// ladenhueter: Exemplare, die seit mindestens `days` Tagen an Lager liegen,
// und Artikel ohne Seriennummer mit Bestand, die in dieser Zeit nicht
// verkauft wurden.
export function slowMovers(inventory, units, movements, { days = 90, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const productById = new Map((inventory || []).map((p) => [p.id, p]));
  const unitsOld = (units || [])
    .filter((u) => u.status === UNIT_STATUS.inStock && u.receivedAt && u.receivedAt <= cutoff)
    .map((u) => {
      const p = productById.get(u.productId);
      return {
        serial: u.serial,
        articleNumber: p?.articleNumber || "",
        name: p?.name || "",
        receivedAt: u.receivedAt,
        daysInStock: Math.floor((now.getTime() - new Date(u.receivedAt).getTime()) / 86400000),
      };
    })
    .sort((a, b) => b.daysInStock - a.daysInStock);
  // Auch ein frischer Wareneingang ist kein Ladenhüter.
  const activeRecently = new Set(
    (movements || [])
      .filter((m) => (m.type === MOVEMENT_TYPE.sale || m.type === MOVEMENT_TYPE.goodsIn) && m.at >= cutoff)
      .map((m) => m.productId)
  );
  const articles = (inventory || [])
    .filter((p) => !isSerialTracked(p) && (Number(p.stock) || 0) > 0 && !activeRecently.has(p.id))
    .map((p) => ({ articleNumber: p.articleNumber || "", name: p.name || "", available: Number(p.stock) || 0, price: round2(p.price) }));
  return { days, units: unitsOld, articles };
}
