// Interner Aufwand eines Einsatzes vor Ort: gefahrene Kilometer und
// verbrauchtes Material. Nur für die Buchhaltung — steht nie auf Quittung,
// Rechnung, PDF, E-Mail, QR-Rechnung, Shop-Feed oder beim Assistenten.
//
// receipt.internalCosts = { km, kmRate, materials: [{ id, description, amount }] }
//
// Kilometeransatz: Die Wegleitung zum Lohnausweis der ESTV/SSK (gültig ab
// 1. Januar 2026, Rz 52) nennt für die geschäftliche Benutzung des
// Privatfahrzeugs höchstens 75 Rappen pro Kilometer (bis 2025: 70 Rappen).
// Der Ansatz lässt sich unter Firma ändern und wird pro Quittung gespeichert,
// damit ältere Belege ihren damaligen Ansatz behalten.

export const DEFAULT_KM_RATE = 0.75;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nonNegative(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Ansatz aus den Firmendaten, sonst der ESTV-Ansatz.
export function companyKmRate(company) {
  const n = Number(company?.kmRate);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_KM_RATE;
}

// Eingaben aus dem Formular → gespeicherte Form, oder null ohne Inhalt.
export function normalizeCosts({ km, kmRate, materials } = {}) {
  const kmValue = round2(nonNegative(km));
  const rate = nonNegative(kmRate) || DEFAULT_KM_RATE;
  const lines = (materials || [])
    .map((m) => ({ id: m.id, description: String(m.description ?? "").trim(), amount: round2(nonNegative(m.amount)) }))
    .filter((m) => m.description || m.amount > 0);
  if (!kmValue && lines.length === 0) return null;
  return { km: kmValue, kmRate: rate, materials: lines };
}

// Summen eines Belegs. Ohne Aufwand alles 0.
export function costTotals(receipt) {
  const c = receipt?.internalCosts;
  if (!c) return { km: 0, kmRate: 0, travel: 0, material: 0, total: 0 };
  const km = nonNegative(c.km);
  const kmRate = nonNegative(c.kmRate) || DEFAULT_KM_RATE;
  const travel = round2(km * kmRate);
  const material = round2((c.materials || []).reduce((s, m) => s + nonNegative(m.amount), 0));
  return { km, kmRate, travel, material, total: round2(travel + material) };
}

export function hasCosts(receipt) {
  return costTotals(receipt).total > 0 || costTotals(receipt).km > 0;
}

// Summen über mehrere Belege (z. B. einen Monat).
export function sumCosts(receipts) {
  return (receipts || []).reduce(
    (acc, r) => {
      const t = costTotals(r);
      return {
        km: round2(acc.km + t.km),
        travel: round2(acc.travel + t.travel),
        material: round2(acc.material + t.material),
        total: round2(acc.total + t.total),
      };
    },
    { km: 0, travel: 0, material: 0, total: 0 }
  );
}

// Kurztext für Listen: «42 km · Material CHF 18.50 · total CHF 50.00».
export function costSummaryText(receipt) {
  const t = costTotals(receipt);
  if (!t.km && !t.material) return "";
  const parts = [];
  if (t.km) parts.push(`${t.km} km à ${t.kmRate.toFixed(2)} = CHF ${t.travel.toFixed(2)}`);
  if (t.material) parts.push(`Material CHF ${t.material.toFixed(2)}`);
  return `${parts.join(" · ")} · total CHF ${t.total.toFixed(2)}`;
}
