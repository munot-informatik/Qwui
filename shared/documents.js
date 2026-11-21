// Weitere Belegarten neben Quittung und Rechnung: Offerte, Gutschrift und
// Lieferschein. Reine Funktionen — dieselben in Web und Windows und in den Tests.
//
// - Offerte: eigene Liste (quotes-list) und eigene Nummern (O-0001). Bucht
//   nichts. «Als Quittung übernehmen» füllt das Quittungsformular; erst die
//   Quittung bucht das Lager.
// - Gutschrift: eigene Liste (credit-notes-list) und eigene Nummern (G-0001),
//   immer zu einer bestehenden Quittung oder Rechnung. Zurückgenommene
//   Produkte können wieder ins Lager (siehe bookCreditNote in stock.js).
//   Getrennte Listen, damit Umsatz, offene Rechnungen, QR-Rechnung und Mahnung
//   weiterhin nur echte Quittungen sehen.
// - Lieferschein: keine eigenen Daten, nur eine Ansicht einer Quittung ohne
//   Preise (Nummer und Datum der Quittung).

import { itemKind, itemQuantity, itemLineTotal } from "./items.js";

export const DOC_TYPE = { quote: "offerte", creditNote: "gutschrift", deliveryNote: "lieferschein" };

export const QUOTE_PREFIX = "O";
export const CREDIT_NOTE_PREFIX = "G";

export const QUOTE_STATUS = { open: "offen", accepted: "angenommen", declined: "abgelehnt" };
export const QUOTE_STATE_LABEL = {
  offen: "Offen",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  abgelaufen: "Abgelaufen",
};
export const DEFAULT_QUOTE_VALID_DAYS = 30;

// Wie der Betrag einer Gutschrift zum Kunden kommt.
export const REFUND_METHODS = [
  ["bar", "Bar zurückerstattet"],
  ["ueberweisung", "Wird überwiesen"],
  ["verrechnung", "Mit der Rechnung verrechnet"],
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Wort für Titel, Dateinamen und E-Mail («die … Nr. 0007»).
export function docWord(doc) {
  if (doc?.docType === DOC_TYPE.quote) return "Offerte";
  if (doc?.docType === DOC_TYPE.creditNote) return "Gutschrift";
  if (doc?.docType === DOC_TYPE.deliveryNote) return "Lieferschein";
  return doc?.qrBillEnabled ? "Rechnung" : "Quittung";
}

export function isQuote(doc) {
  return doc?.docType === DOC_TYPE.quote;
}

export function isCreditNote(doc) {
  return doc?.docType === DOC_TYPE.creditNote;
}

// Laufende Nummer aus «O-0012» → 12; fremde Formen → 0.
export function docNumberValue(prefix, number) {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(number ?? "").trim());
  return m ? parseInt(m[1], 10) : 0;
}

// Nächste Nummer, höher als alles je Vergebene — auch gelöschte Nummern
// bleiben vergeben (wie bei den Quittungen).
export function nextDocNumber(prefix, list, lastUsed = 0) {
  const highest = (list || []).reduce((max, d) => Math.max(max, docNumberValue(prefix, d.number)), Number(lastUsed) || 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

export function addDaysISO(iso, days) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + (Number(days) || 0));
  return date.toISOString().slice(0, 10);
}

// ---- Offerte ----

// Zustand für Liste und Anzeige: «abgelaufen» ist kein gespeicherter Status,
// sondern eine offene Offerte nach ihrem Gültigkeitsdatum.
export function quoteState(quote, todayISO) {
  const status = quote?.status || QUOTE_STATUS.open;
  if (status !== QUOTE_STATUS.open) return status;
  if (quote?.validUntil && todayISO && quote.validUntil < todayISO) return "abgelaufen";
  return QUOTE_STATUS.open;
}

// Offerte wieder offen, z. B. wenn ihre Quittung gelöscht wurde oder es sie
// nach einem Import nicht mehr gibt — sonst liesse sie sich nie mehr übernehmen.
export function reopenQuote(quote) {
  const { receiptId, receiptNumber, ...rest } = quote;
  return { ...rest, status: QUOTE_STATUS.open, decidedAt: null };
}

// Angenommene Offerten, deren Quittung in receipts fehlt, wieder öffnen.
// Liefert dieselbe Liste (gleiches Objekt), wenn sich nichts ändert.
export function reopenOrphanedQuotes(quotes, receipts) {
  const ids = new Set((receipts || []).map((r) => r.id));
  let changed = false;
  const next = (quotes || []).map((q) => {
    if (q.status !== QUOTE_STATUS.accepted || !q.receiptId || ids.has(q.receiptId)) return q;
    changed = true;
    return reopenQuote(q);
  });
  return changed ? next : quotes;
}

// Positionen einer Offerte fürs Quittungsformular. Seriennummernpflichtige
// Artikel stehen in der Quittung mit einem Exemplar pro Position — aus
// «2 × Queue» werden zwei Positionen, die Exemplare wählt man im Formular.
// deps: { inventory, isSerialTracked, makeItem }
export function quoteToReceiptItems(quote, { inventory, isSerialTracked, makeItem }) {
  const items = [];
  const warnings = [];
  for (const it of quote?.items || []) {
    const base = { ...makeItem(), ...it, id: makeItem().id, unitId: "", serial: "" };
    const product = itemKind(it) === "product" && it.productId ? (inventory || []).find((p) => p.id === it.productId) : null;
    if (itemKind(it) === "product" && it.productId && !product) {
      warnings.push(`«${it.description}» ist nicht mehr im Inventar — die Position bucht kein Lager.`);
    }
    const quantity = itemQuantity(it);
    if (product && isSerialTracked(product)) {
      for (let i = 0; i < quantity; i++) items.push({ ...base, id: makeItem().id, quantity: "1" });
      warnings.push(`«${product.name}»: bitte ${quantity === 1 ? "das Exemplar" : `die ${quantity} Exemplare`} wählen oder scannen.`);
      continue;
    }
    items.push({ ...base, quantity: String(quantity) });
  }
  return { items, warnings };
}

// ---- Gutschrift ----

export function creditNotesFor(creditNotes, receiptId) {
  return (creditNotes || []).filter((c) => c.receiptId === receiptId);
}

// Schon gutgeschriebene Mengen pro Position der Quittung (sourceItemId).
export function creditedQuantities(creditNotes, receiptId) {
  const map = new Map();
  for (const c of creditNotesFor(creditNotes, receiptId)) {
    for (const it of c.items || []) {
      map.set(it.sourceItemId, (map.get(it.sourceItemId) || 0) + itemQuantity(it));
    }
  }
  return map;
}

// Was sich von einer Quittung noch gutschreiben lässt.
export function creditableLines(receipt, creditNotes) {
  const credited = creditedQuantities(creditNotes, receipt?.id);
  return (receipt?.items || []).map((item) => {
    const sold = itemQuantity(item);
    const done = credited.get(item.id) || 0;
    return { item, sold, credited: done, remaining: Math.max(0, sold - done) };
  });
}

export function creditTotalFor(creditNotes, receiptId) {
  return round2(creditNotesFor(creditNotes, receiptId).reduce((s, c) => s + (Number(c.total) || 0), 0));
}

// Noch offener Betrag einer Rechnung nach allen Gutschriften. Quittungen
// (bar bezahlt) und bezahlte Rechnungen sind nie offen.
export function openAmount(receipt, creditNotes) {
  if (!receipt?.qrBillEnabled || receipt.paid) return 0;
  return Math.max(0, round2((Number(receipt.total) || 0) - creditTotalFor(creditNotes, receipt.id)));
}

// Summen eines Zeitraums für «Belege». Quittungen und Gutschriften zählen je
// mit ihrem eigenen Datum. Eine Gutschrift zu einer noch offenen Rechnung
// mindert den offenen Teil, sonst den bezahlten (Rückerstattung). So gehen
// offen + bezahlt immer im Total auf — auch wenn die Rechnung im Oktober und
// die Gutschrift im November steht. allReceipts: alle Quittungen, damit sich
// der Stand der Rechnung einer Gutschrift aus einem anderen Monat findet.
export function periodTotals(periodReceipts, periodCredits, allReceipts = periodReceipts) {
  const isOpen = (r) => !!r?.qrBillEnabled && !r.paid;
  const amount = (d) => Number(d?.total) || 0;
  const byId = new Map((allReceipts || []).map((r) => [r.id, r]));
  const receipts = round2((periodReceipts || []).reduce((s, r) => s + amount(r), 0));
  const credits = round2((periodCredits || []).reduce((s, c) => s + amount(c), 0));
  const openReceipts = (periodReceipts || []).filter(isOpen).reduce((s, r) => s + amount(r), 0);
  const openCredits = (periodCredits || []).filter((c) => isOpen(byId.get(c.receiptId))).reduce((s, c) => s + amount(c), 0);
  const total = round2(receipts - credits);
  const open = round2(openReceipts - openCredits);
  return { receipts, credits, total, open, paid: round2(total - open) };
}

// Baut eine Gutschrift aus einer Auswahl von Positionen der Quittung.
// selection: [{ itemId, quantity, restock }]
// opts: { creditNotes, number, date, refund, note, company, now, newId }
// Ergebnis: { creditNote, errors }
export function buildCreditNote(receipt, selection, opts) {
  const errors = [];
  const lines = new Map(creditableLines(receipt, opts.creditNotes).map((l) => [l.item.id, l]));
  const items = [];
  for (const sel of selection || []) {
    const line = lines.get(sel.itemId);
    if (!line) continue;
    const quantity = Number(sel.quantity);
    if (!quantity) continue;
    const label = line.item.description || "Position";
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push(`«${label}»: bitte eine ganze Menge angeben.`);
      continue;
    }
    if (quantity > line.remaining) {
      errors.push(
        line.remaining === 0
          ? `«${label}» ist schon vollständig gutgeschrieben.`
          : `«${label}»: höchstens ${line.remaining} Stück (verkauft ${line.sold}, schon gutgeschrieben ${line.credited}).`
      );
      continue;
    }
    const isProduct = itemKind(line.item) === "product" && !!line.item.productId;
    items.push({
      ...line.item,
      id: opts.newId(),
      sourceItemId: line.item.id,
      quantity,
      // Nur Produkte aus dem Inventar können zurück ins Lager.
      restock: isProduct ? sel.restock !== false : false,
    });
  }
  if (errors.length) return { creditNote: null, errors };
  if (items.length === 0) return { creditNote: null, errors: ["Bitte mindestens eine Position mit Menge wählen."] };

  const total = round2(items.reduce((s, it) => s + itemLineTotal(it), 0));
  const vatRate = Number(receipt.vatRate) || 0.081;
  const netTotal = receipt.vatEnabled ? round2(total / (1 + vatRate)) : total;
  const refund = REFUND_METHODS.some(([id]) => id === opts.refund) ? opts.refund : "bar";
  return {
    errors: [],
    creditNote: {
      id: opts.newId(),
      docType: DOC_TYPE.creditNote,
      number: opts.number,
      date: opts.date,
      receiptId: receipt.id,
      receiptNumber: receipt.number,
      receiptDate: receipt.date,
      receiptWord: docWord(receipt),
      customer: { ...(receipt.customer || {}) },
      items,
      netTotal,
      vatEnabled: !!receipt.vatEnabled,
      vatRate,
      vatAmount: receipt.vatEnabled ? round2(total - netTotal) : 0,
      total,
      refund,
      note: String(opts.note || "").trim(),
      company: opts.company || receipt.company || {},
      createdAt: opts.now,
    },
  };
}

export function refundLabel(creditNote) {
  return (REFUND_METHODS.find(([id]) => id === creditNote?.refund) || REFUND_METHODS[0])[1];
}

// ---- Texte auf dem Beleg (Bildschirm und PDF gleich) ----

export function formatDateCH(iso) {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-");
  return d ? `${d}.${m}.${y}` : "";
}

export function isDeliveryNote(doc) {
  return doc?.docType === DOC_TYPE.deliveryNote;
}

// Zeile unter dem Titel: «Nr. O-0001», beim Lieferschein der Bezug zur Quittung.
export function docNumberLine(doc) {
  if (isDeliveryNote(doc)) return `zu ${doc.sourceWord || "Quittung"} Nr. ${doc.number}`;
  return `Nr. ${doc?.number ?? ""}`;
}

// Weitere Zeilen im Kopf, unter dem Datum.
export function docMetaLines(doc) {
  if (isQuote(doc)) return doc.validUntil ? [`Gültig bis ${formatDateCH(doc.validUntil)}`] : [];
  if (isCreditNote(doc)) {
    return [`zu ${doc.receiptWord || "Quittung"} Nr. ${doc.receiptNumber}`, ...(doc.receiptDate ? [`vom ${formatDateCH(doc.receiptDate)}`] : [])];
  }
  if (isDeliveryNote(doc) && doc.shopOrder?.number) return [`Online-Bestellung Nr. ${doc.shopOrder.number}`];
  return [];
}

export function recipientLabel(doc) {
  return isDeliveryNote(doc) ? "Lieferadresse" : "Empfänger";
}

export function itemsLabel(doc) {
  if (isDeliveryNote(doc)) return "Ware";
  if (isCreditNote(doc)) return "Gutgeschrieben";
  return "Leistung";
}

export function totalLabel(doc) {
  const base = isCreditNote(doc) ? "Gutschrift total" : "Total";
  return doc?.vatEnabled ? `${base} (inkl. MWST)` : base;
}

// Schlusszeile und Unterschrift der neuen Belegarten; null bei Quittung und
// Rechnung (deren Texte stehen wie bisher in App.jsx und pdfGenerator.js).
export function docClosing(doc, company = {}) {
  if (isQuote(doc)) {
    return {
      text: `Diese Offerte ist gültig bis ${formatDateCH(doc.validUntil)}. Wir freuen uns auf Ihren Auftrag.`,
      signatureLabel: "Unterschrift",
      signer: company.name || "",
    };
  }
  if (isCreditNote(doc)) {
    if (doc.refund === "ueberweisung") {
      return { text: "Der Betrag wird Ihnen überwiesen.", signatureLabel: "Unterschrift", signer: company.name || "" };
    }
    if (doc.refund === "verrechnung") {
      return {
        text: `Der Betrag wird mit der ${doc.receiptWord || "Rechnung"} Nr. ${doc.receiptNumber} verrechnet.`,
        signatureLabel: "Unterschrift",
        signer: company.name || "",
      };
    }
    return {
      text: `Betrag bar zurückerstattet, ${company.zipCity || "___________"}, ${formatDateCH(doc.date)}`,
      // Hier unterschreibt der Kunde, nicht die Firma.
      signatureLabel: "Betrag erhalten (Unterschrift Kunde)",
      signer: "",
    };
  }
  if (isDeliveryNote(doc)) {
    return { text: "Ware vollständig und in einwandfreiem Zustand erhalten:", signatureLabel: "Datum, Unterschrift Empfänger", signer: "" };
  }
  return null;
}

// ---- Lieferschein ----

// Auf den Lieferschein gehört die Ware. Hat die Quittung Produkte, nur diese
// (ohne Versandkosten oder Montage); sonst alle Positionen.
export function deliveryNoteItems(receipt) {
  const items = receipt?.items || [];
  const products = items.filter((it) => itemKind(it) === "product");
  return products.length ? products : items;
}
