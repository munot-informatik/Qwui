// Rechnungspositionen: Art, Menge, Listenpreis, Rabatt und verrechneter
// Betrag. Bis 1.1 standen diese Helfer doppelt in src/App.jsx und
// src/pdfGenerator.js; mit der Menge wären die zwei Kopien bei der nächsten
// Änderung auseinandergelaufen — jetzt rechnen Formular, Beleg und PDF mit
// derselben Funktion.
//
// "amount" ist der Listenpreis PRO STÜCK. Positionen von vor 1.2.0 kennen
// keine Menge und zählen als ein Stück — Betrag und Total bleiben dadurch
// exakt wie bisher.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Heute Produkt oder Dienstleistung. Weitere Arten (Getränk, Tischzeit) kommen
// mit dem Kassenmodus dazu; unbekannte Werte gelten bis dahin als
// Dienstleistung, wie bisher.
export function itemKind(it) {
  return it?.kind === "product" ? "product" : "service";
}

export function itemQuantity(it) {
  const q = Number(it?.quantity);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

export function itemUnitPrice(it) {
  return Number(it?.amount) || 0;
}

// Listenpreis der ganzen Position (Stückpreis × Menge), vor Rabatt.
export function itemListPrice(it) {
  return round2(itemUnitPrice(it) * itemQuantity(it));
}

// Rabatt in Prozent, auf 0–100 begrenzt — ein Tippfehler wie "1000" darf keine
// negative Rechnung erzeugen.
export function itemDiscountPercent(it) {
  const raw = Number(it?.discountPercent);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(100, raw);
}

export function itemDiscountAmount(it) {
  return round2((itemListPrice(it) * itemDiscountPercent(it)) / 100);
}

// Verrechneter Betrag der Position nach Abzug des Rabatts.
export function itemLineTotal(it) {
  return round2(itemListPrice(it) - itemDiscountAmount(it));
}

export function hasDiscount(it) {
  return itemDiscountPercent(it) > 0;
}

// Rabatt-Prozentsatz für die Anzeige: ganze Zahlen ohne Nachkommastellen.
export function formatPercent(p) {
  return Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100);
}

// Menge für die Anzeige ("2 ×"), nur wenn es mehr oder weniger als ein Stück ist.
export function quantityPrefix(it) {
  const q = itemQuantity(it);
  return q === 1 ? "" : `${formatPercent(q)} × `;
}

export function receiptListTotal(receipt) {
  return round2((receipt?.items || []).reduce((s, it) => s + itemListPrice(it), 0));
}

export function receiptDiscountTotal(receipt) {
  return round2((receipt?.items || []).reduce((s, it) => s + itemDiscountAmount(it), 0));
}

export function receiptTotal(items) {
  return round2((items || []).reduce((s, it) => s + itemLineTotal(it), 0));
}
