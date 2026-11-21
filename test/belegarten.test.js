// Offerten, Gutschriften und Lieferscheine (ab 1.5.0). Eine Gutschrift nimmt
// Ware zurück: Bestand und Exemplare müssen danach genau stimmen, auch beim
// Löschen der Gutschrift, und es darf nie mehr gutgeschrieben werden, als
// verkauft wurde.

import { describe, it, expect } from "vitest";
import {
  docWord,
  nextDocNumber,
  quoteState,
  quoteToReceiptItems,
  creditableLines,
  buildCreditNote,
  openAmount,
  deliveryNoteItems,
  addDaysISO,
  QUOTE_PREFIX,
  CREDIT_NOTE_PREFIX,
} from "../shared/documents.js";
import { bookReceipt, bookCreditNote, reverseCreditNote, isSerialTracked, MOVEMENT_TYPE } from "../shared/stock.js";

let n = 0;
const newId = () => `id${++n}`;
const ctx = () => ({ now: "2027-03-01T10:00:00.000Z", source: "app", newId });

const queue = { id: "p1", articleNumber: "PRED-REVO", name: "Predator Revo", price: 890, serialTracked: true, stock: 0 };
const kreide = { id: "p2", articleNumber: "KR-01", name: "Kreide", price: 4, stock: 10 };
const inventory = [queue, kreide];
const units = [
  { id: "u1", serial: "PR-1001", productId: "p1", status: "an_lager" },
  { id: "u2", serial: "PR-1002", productId: "p1", status: "an_lager" },
];

function soldReceipt() {
  const receipt = {
    id: "r1",
    number: "0012",
    date: "2027-02-20",
    customer: { id: "c1", name: "Sandra Meier" },
    vatEnabled: true,
    vatRate: 0.081,
    qrBillEnabled: false,
    paid: true,
    total: 919.8,
    items: [
      { id: "i1", kind: "product", productId: "p1", unitId: "u1", serial: "PR-1001", description: "Predator Revo", amount: "890", quantity: 1 },
      { id: "i2", kind: "product", productId: "p2", description: "Kreide", amount: "4", quantity: 5, discountPercent: "" },
      { id: "i3", kind: "service", description: "Spitze wechseln", amount: "9.80", quantity: 1 },
    ],
  };
  const booked = bookReceipt({ inventory, units }, receipt, ctx());
  expect(booked.errors).toEqual([]);
  return booked;
}

describe("Belegarten", () => {
  it("benennt jede Art", () => {
    expect(docWord({ qrBillEnabled: false })).toBe("Quittung");
    expect(docWord({ qrBillEnabled: true })).toBe("Rechnung");
    expect(docWord({ docType: "offerte" })).toBe("Offerte");
    expect(docWord({ docType: "gutschrift" })).toBe("Gutschrift");
    expect(docWord({ docType: "lieferschein" })).toBe("Lieferschein");
  });

  it("vergibt eigene Nummern und keine gelöschte ein zweites Mal", () => {
    expect(nextDocNumber(QUOTE_PREFIX, [])).toBe("O-0001");
    expect(nextDocNumber(QUOTE_PREFIX, [{ number: "O-0007" }, { number: "O-0003" }])).toBe("O-0008");
    expect(nextDocNumber(CREDIT_NOTE_PREFIX, [{ number: "G-0002" }], 5)).toBe("G-0006");
    // Fremde Formen zählen nicht mit.
    expect(nextDocNumber(CREDIT_NOTE_PREFIX, [{ number: "0099" }, { number: "O-0050" }])).toBe("G-0001");
  });

  it("rechnet Daten über Monats- und Jahresgrenzen", () => {
    expect(addDaysISO("2027-12-15", 30)).toBe("2028-01-14");
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("Offerte", () => {
  it("läuft nach dem Gültigkeitsdatum ab, angenommene nicht", () => {
    const quote = { status: "offen", validUntil: "2027-03-31" };
    expect(quoteState(quote, "2027-03-31")).toBe("offen");
    expect(quoteState(quote, "2027-04-01")).toBe("abgelaufen");
    expect(quoteState({ ...quote, status: "angenommen" }, "2027-05-01")).toBe("angenommen");
  });

  it("teilt Artikel mit Seriennummer für die Quittung in einzelne Positionen", () => {
    const quote = {
      items: [
        { id: "a", kind: "product", productId: "p1", description: "Predator Revo", amount: "890", quantity: 2, unitId: "x", serial: "y" },
        { id: "b", kind: "product", productId: "p2", description: "Kreide", amount: "4", quantity: 3 },
        { id: "c", kind: "product", productId: "weg", description: "Altes Tuch", amount: "120", quantity: 1 },
      ],
    };
    const { items, warnings } = quoteToReceiptItems(quote, { inventory, isSerialTracked, makeItem: () => ({ id: newId(), unitId: "", serial: "" }) });
    expect(items.map((it) => [it.description, it.quantity, it.unitId])).toEqual([
      ["Predator Revo", "1", ""],
      ["Predator Revo", "1", ""],
      ["Kreide", "3", ""],
      ["Altes Tuch", "1", ""],
    ]);
    expect(new Set(items.map((it) => it.id)).size).toBe(4);
    expect(warnings.join(" ")).toMatch(/2 Exemplare/);
    expect(warnings.join(" ")).toMatch(/nicht mehr im Inventar/);
  });
});

describe("Gutschrift", () => {
  const opts = (extra = {}) => ({
    creditNotes: [],
    number: "G-0001",
    date: "2027-03-01",
    refund: "bar",
    company: { name: "Billard Shop" },
    now: "2027-03-01T10:00:00.000Z",
    newId,
    ...extra,
  });

  it("schreibt Positionen mit Rabatt und MWST richtig gut", () => {
    const { receipt } = soldReceipt();
    const { creditNote, errors } = buildCreditNote(
      receipt,
      [
        { itemId: "i2", quantity: 2, restock: true },
        { itemId: "i3", quantity: 1 },
      ],
      opts()
    );
    expect(errors).toEqual([]);
    expect(creditNote).toMatchObject({ docType: "gutschrift", number: "G-0001", receiptNumber: "0012", receiptWord: "Quittung", total: 17.8 });
    expect(creditNote.netTotal).toBe(16.47);
    expect(creditNote.vatAmount).toBe(1.33);
    // Dienstleistungen gehen nie ins Lager.
    expect(creditNote.items.map((it) => [it.sourceItemId, it.quantity, it.restock])).toEqual([
      ["i2", 2, true],
      ["i3", 1, false],
    ]);
  });

  it("lässt nicht mehr gutschreiben, als verkauft und noch nicht gutgeschrieben ist", () => {
    const { receipt } = soldReceipt();
    const first = buildCreditNote(receipt, [{ itemId: "i2", quantity: 4, restock: true }], opts()).creditNote;
    expect(creditableLines(receipt, [first]).find((l) => l.item.id === "i2").remaining).toBe(1);
    const again = buildCreditNote(receipt, [{ itemId: "i2", quantity: 2 }], opts({ creditNotes: [first] }));
    expect(again.creditNote).toBeNull();
    expect(again.errors[0]).toMatch(/höchstens 1 Stück/);
    expect(buildCreditNote(receipt, [{ itemId: "i2", quantity: 1.5 }], opts()).errors[0]).toMatch(/ganze Menge/);
    expect(buildCreditNote(receipt, [], opts()).errors[0]).toMatch(/mindestens eine Position/);
  });

  it("bucht die Rücknahme und macht sie beim Löschen genau rückgängig", () => {
    const sold = soldReceipt();
    const { creditNote } = buildCreditNote(
      sold.receipt,
      [
        { itemId: "i1", quantity: 1, restock: true },
        { itemId: "i2", quantity: 3, restock: true },
      ],
      opts()
    );
    const booked = bookCreditNote({ inventory: sold.inventory, units: sold.units }, creditNote, ctx());
    expect(booked.errors).toEqual([]);
    expect(booked.inventory.find((p) => p.id === "p2").stock).toBe(8); // 10 − 5 + 3
    const unit = booked.units.find((u) => u.id === "u1");
    expect(unit).toMatchObject({ status: "an_lager", receiptId: null });
    expect(unit.returnedFrom).toMatchObject({ receiptId: "r1", creditNoteNumber: "G-0001" });
    expect(booked.inventory.find((p) => p.id === "p1").stock).toBe(2);
    expect(booked.movements.map((m) => [m.type, m.qty, m.ref.note])).toEqual([
      [MOVEMENT_TYPE.creditReturn, 1, "Gutschrift G-0001"],
      [MOVEMENT_TYPE.creditReturn, 3, "Gutschrift G-0001"],
    ]);

    const reversed = reverseCreditNote({ inventory: booked.inventory, units: booked.units }, booked.creditNote, ctx());
    expect(reversed.errors).toEqual([]);
    expect(reversed.inventory.find((p) => p.id === "p2").stock).toBe(5);
    expect(reversed.units.find((u) => u.id === "u1")).toMatchObject({ status: "verkauft", receiptId: "r1", receiptNumber: "0012", customerId: "c1" });
    expect(reversed.units.find((u) => u.id === "u1").returnedFrom).toBeUndefined();
  });

  it("legt defekte Ware nicht zurück ins Lager", () => {
    const sold = soldReceipt();
    const { creditNote } = buildCreditNote(
      sold.receipt,
      [
        { itemId: "i1", quantity: 1, restock: false },
        { itemId: "i2", quantity: 2, restock: false },
      ],
      opts()
    );
    const booked = bookCreditNote({ inventory: sold.inventory, units: sold.units }, creditNote, ctx());
    expect(booked.units.find((u) => u.id === "u1").status).toBe("retourniert");
    expect(booked.inventory.find((p) => p.id === "p2").stock).toBe(5);
    expect(booked.inventory.find((p) => p.id === "p1").stock).toBe(1);
    expect(booked.movements).toHaveLength(1);
  });

  it("nimmt ein Exemplar nicht zweimal zurück und löscht keine Gutschrift für weiterverkaufte Ware", () => {
    const sold = soldReceipt();
    const { creditNote } = buildCreditNote(sold.receipt, [{ itemId: "i1", quantity: 1, restock: true }], opts());
    const booked = bookCreditNote({ inventory: sold.inventory, units: sold.units }, creditNote, ctx());
    // Dasselbe Exemplar ein zweites Mal (z. B. zwei Fenster).
    const twice = bookCreditNote({ inventory: booked.inventory, units: booked.units }, { ...creditNote, id: "cn2", number: "G-0002" }, ctx());
    expect(twice.errors[0]).toMatch(/PR-1001/);
    // Weiterverkauft an jemand anderen: Löschen der Gutschrift geht nicht mehr.
    const resold = bookReceipt(
      { inventory: booked.inventory, units: booked.units },
      { id: "r2", number: "0013", customer: { id: "c2" }, items: [{ id: "x", kind: "product", productId: "p1", unitId: "u1", quantity: 1, amount: "890", description: "Predator Revo" }] },
      ctx()
    );
    expect(resold.errors).toEqual([]);
    const reversed = reverseCreditNote({ inventory: resold.inventory, units: resold.units }, booked.creditNote, ctx());
    expect(reversed.errors[0]).toMatch(/weiterverkauft/);
    expect(reversed.units.find((u) => u.id === "u1").receiptId).toBe("r2");
  });

  it("schreibt ein von Hand retourniertes Exemplar nur noch beim Geld gut", () => {
    const sold = soldReceipt();
    const manual = sold.units.map((u) =>
      u.id === "u1" ? { ...u, status: "retourniert", receiptId: null, returnedFrom: { receiptId: "r1", receiptNumber: "0012" } } : u
    );
    const { creditNote } = buildCreditNote(sold.receipt, [{ itemId: "i1", quantity: 1, restock: true }], opts());
    const booked = bookCreditNote({ inventory: sold.inventory, units: manual }, creditNote, ctx());
    expect(booked.errors).toEqual([]);
    expect(booked.movements).toHaveLength(0);
    expect(booked.creditNote.stockBooking).toEqual([]);
  });

  it("zieht Gutschriften vom offenen Betrag einer Rechnung ab", () => {
    const invoice = { id: "r9", qrBillEnabled: true, paid: false, total: 100 };
    expect(openAmount(invoice, [])).toBe(100);
    expect(openAmount(invoice, [{ receiptId: "r9", total: 30.5 }, { receiptId: "x", total: 50 }])).toBe(69.5);
    expect(openAmount(invoice, [{ receiptId: "r9", total: 120 }])).toBe(0);
    expect(openAmount({ ...invoice, paid: true }, [])).toBe(0);
    expect(openAmount({ ...invoice, qrBillEnabled: false }, [])).toBe(0);
  });
});

describe("Lieferschein", () => {
  it("zeigt nur die Ware, ohne Versand oder Montage", () => {
    const items = [
      { id: "a", kind: "product", description: "Queue" },
      { id: "b", kind: "service", description: "Versand" },
    ];
    expect(deliveryNoteItems({ items }).map((it) => it.id)).toEqual(["a"]);
    expect(deliveryNoteItems({ items: [items[1]] }).map((it) => it.id)).toEqual(["b"]);
  });
});
