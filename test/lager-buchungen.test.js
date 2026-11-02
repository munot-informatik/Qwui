// Lagerbuchungen: Bestand, Exemplare und Protokoll müssen nach jedem Schritt
// zusammenpassen. Stimmt hier etwas nicht, zeigt der Shop falsche Mengen an
// oder ein verkauftes Queue gilt weiter als an Lager.

import { describe, it, expect } from "vitest";
import {
  bookReceipt,
  reverseReceipt,
  rebookReceipt,
  receiveGoods,
  correctStock,
  appendMovements,
  movementsKey,
  productStock,
  itemQuantity,
} from "../shared/stock.js";
import { checkNewSerials } from "../shared/serials.js";

function makeCtx() {
  let n = 0;
  return { now: "2027-02-13T10:00:00.000Z", source: "app", newId: () => `id${++n}` };
}

const QUEUE = { id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 0, serialTracked: true };
const KREIDE = { id: "k", articleNumber: "KR-01", name: "Kreide", group: "Zubehör", price: 4, stock: 10 };

function withThreeQueues() {
  const ctx = makeCtx();
  const r = receiveGoods(
    { inventory: [QUEUE, KREIDE], units: [] },
    { productId: "q", serials: ["S-1", "S-2", "S-3"], purchasePrice: 600 },
    ctx,
    checkNewSerials
  );
  return { state: { inventory: r.inventory, units: r.units }, ctx, movements: r.movements };
}

function receiptWith(items, extra = {}) {
  return { id: "r1", number: 7, customer: { id: "c1", name: "Sandra Meier" }, items, ...extra };
}

describe("Wareneingang", () => {
  it("legt pro Seriennummer ein Exemplar an und zählt den Bestand daraus", () => {
    const { state, movements } = withThreeQueues();
    expect(state.units).toHaveLength(3);
    expect(state.units.every((u) => u.status === "an_lager")).toBe(true);
    expect(productStock(state.inventory[0], state.units)).toBe(3);
    expect(state.inventory[0].stock).toBe(3);
    expect(movements.map((m) => [m.type, m.qty, m.serial])).toEqual([
      ["wareneingang", 1, "S-1"],
      ["wareneingang", 1, "S-2"],
      ["wareneingang", 1, "S-3"],
    ]);
  });

  it("weist doppelte Seriennummern ab und bucht dann gar nichts", () => {
    const { state, ctx } = withThreeQueues();
    const r = receiveGoods(state, { productId: "q", serials: ["S-4", " s-2 "] }, ctx, checkNewSerials);
    expect(r.errors).toEqual(["Seriennummer s-2 ist bereits vorhanden."]);
    expect(r.units).toHaveLength(3);
    expect(r.movements).toEqual([]);
  });

  it("erhöht bei Artikeln ohne Seriennummer die Menge", () => {
    const r = receiveGoods({ inventory: [KREIDE], units: [] }, { productId: "k", quantity: 5 }, makeCtx());
    expect(r.inventory[0].stock).toBe(15);
    expect(r.movements[0]).toMatchObject({ type: "wareneingang", qty: 5, serial: null });
  });

  it("lehnt eine Menge von 0 ab", () => {
    const r = receiveGoods({ inventory: [KREIDE], units: [] }, { productId: "k", quantity: 0 }, makeCtx());
    expect(r.errors).toHaveLength(1);
    expect(r.inventory[0].stock).toBe(10);
  });

  it("trägt bei Entwürfen des Assistenten Quelle und Entwurf ein", () => {
    const ctx = { ...makeCtx(), source: "assistent" };
    const r = receiveGoods({ inventory: [KREIDE], units: [] }, { productId: "k", quantity: 1, draftId: "d9" }, ctx);
    expect(r.movements[0]).toMatchObject({ source: "assistent", ref: { draftId: "d9" } });
  });
});

describe("Verkauf per Quittung", () => {
  it("setzt das gewählte Exemplar auf verkauft und senkt den Bestand", () => {
    const { state, ctx } = withThreeQueues();
    const unit = state.units[1];
    const r = bookReceipt(state, receiptWith([{ kind: "product", productId: "q", unitId: unit.id }]), ctx);
    expect(r.errors).toEqual([]);
    const sold = r.units.find((u) => u.id === unit.id);
    expect(sold).toMatchObject({ status: "verkauft", receiptId: "r1", receiptNumber: 7, customerId: "c1" });
    expect(r.inventory[0].stock).toBe(2);
    expect(r.receipt.stockBooking).toEqual([{ productId: "q", unitId: unit.id, serial: "S-2", qty: 1 }]);
    expect(r.movements[0]).toMatchObject({ type: "verkauf", qty: -1, serial: "S-2", ref: { receiptNumber: 7 } });
  });

  it("verlangt bei Seriennummernpflicht ein Exemplar", () => {
    const { state, ctx } = withThreeQueues();
    const r = bookReceipt(state, receiptWith([{ kind: "product", productId: "q", description: "Queue" }]), ctx);
    expect(r.errors[0]).toMatch(/seriennummernpflichtig/);
    expect(r.units).toBe(state.units);
    expect(r.movements).toEqual([]);
  });

  it("lässt dasselbe Exemplar nicht zweimal auf einer Quittung zu", () => {
    const { state, ctx } = withThreeQueues();
    const id = state.units[0].id;
    const r = bookReceipt(
      state,
      receiptWith([
        { kind: "product", productId: "q", unitId: id },
        { kind: "product", productId: "q", unitId: id },
      ]),
      ctx
    );
    expect(r.errors[0]).toMatch(/doppelt/);
  });

  it("verkauft ein bereits verkauftes Exemplar nicht noch einmal", () => {
    const { state, ctx } = withThreeQueues();
    const id = state.units[0].id;
    const first = bookReceipt(state, receiptWith([{ kind: "product", productId: "q", unitId: id }]), ctx);
    const second = bookReceipt(first, receiptWith([{ kind: "product", productId: "q", unitId: id }], { id: "r2" }), ctx);
    expect(second.errors[0]).toMatch(/nicht an Lager/);
  });

  it("zieht die Menge ab und warnt unter 0, ohne zu blockieren", () => {
    const r = bookReceipt(
      { inventory: [KREIDE], units: [] },
      receiptWith([{ kind: "product", productId: "k", quantity: 12 }]),
      makeCtx()
    );
    expect(r.errors).toEqual([]);
    expect(r.inventory[0].stock).toBe(-2);
    expect(r.warnings[0]).toMatch(/negativ/);
  });

  it("bucht Dienstleistungen und Positionen ohne Inventar-Bezug nicht", () => {
    const r = bookReceipt(
      { inventory: [KREIDE], units: [] },
      receiptWith([
        { kind: "service", description: "Queue-Reparatur", amount: "40" },
        { kind: "product", description: "Alter Artikel ohne productId", articleNumber: "KR-01" },
      ]),
      makeCtx()
    );
    expect(r.movements).toEqual([]);
    expect(r.inventory[0].stock).toBe(10);
    expect(r.receipt.stockBooking).toEqual([]);
  });
});

describe("Storno beim Löschen und Bearbeiten", () => {
  it("bringt beim Löschen Bestand und Exemplar zurück (Demo-Ablauf 1–4)", () => {
    const { state, ctx } = withThreeQueues();
    const unit = state.units[0];
    const sold = bookReceipt(state, receiptWith([{ kind: "product", productId: "q", unitId: unit.id }]), ctx);
    expect(sold.inventory[0].stock).toBe(2);

    const back = reverseReceipt(sold, sold.receipt, ctx);
    expect(back.inventory[0].stock).toBe(3);
    expect(back.units.find((u) => u.id === unit.id)).toMatchObject({
      status: "an_lager",
      receiptId: null,
      customerId: null,
    });
    expect(back.movements[0]).toMatchObject({ type: "storno", qty: 1, serial: unit.serial, ref: { stornoOf: "r1" } });
  });

  it("verändert beim Löschen einer Quittung von vor 1.2.0 nichts", () => {
    const old = receiptWith([{ kind: "product", description: "Kreide", amount: "4" }]);
    const r = reverseReceipt({ inventory: [KREIDE], units: [] }, old, makeCtx());
    expect(r.movements).toEqual([]);
    expect(r.inventory[0].stock).toBe(10);
  });

  it("storniert beim Bearbeiten die alte Buchung und bucht die neue", () => {
    const ctx = makeCtx();
    const state = { inventory: [KREIDE], units: [] };
    const first = bookReceipt(state, receiptWith([{ kind: "product", productId: "k", quantity: 2 }]), ctx);
    const edited = rebookReceipt(first, first.receipt, receiptWith([{ kind: "product", productId: "k", quantity: 3 }]), ctx);
    expect(edited.inventory[0].stock).toBe(7);
    expect(edited.movements.map((m) => [m.type, m.qty])).toEqual([
      ["storno", 2],
      ["verkauf", -3],
    ]);
  });

  it("lässt beim Bearbeiten alles unverändert, wenn die neue Fassung ungültig ist", () => {
    const { state, ctx } = withThreeQueues();
    const unit = state.units[0];
    const sold = bookReceipt(state, receiptWith([{ kind: "product", productId: "q", unitId: unit.id }]), ctx);
    const edited = rebookReceipt(sold, sold.receipt, receiptWith([{ kind: "product", productId: "q" }]), ctx);
    expect(edited.errors).toHaveLength(1);
    expect(edited.units).toBe(sold.units);
    expect(edited.movements).toEqual([]);
  });

  it("kann beim Bearbeiten dasselbe Exemplar behalten", () => {
    const { state, ctx } = withThreeQueues();
    const unit = state.units[0];
    const items = [{ kind: "product", productId: "q", unitId: unit.id }];
    const sold = bookReceipt(state, receiptWith(items), ctx);
    const edited = rebookReceipt(sold, sold.receipt, receiptWith(items, { note: "geändert" }), ctx);
    expect(edited.errors).toEqual([]);
    expect(edited.units.find((u) => u.id === unit.id).status).toBe("verkauft");
    expect(edited.inventory[0].stock).toBe(2);
  });
});

describe("Inventurkorrektur", () => {
  it("hält die Differenz fest, nicht den neuen Wert", () => {
    const r = correctStock({ inventory: [KREIDE], units: [] }, "k", 7, makeCtx());
    expect(r.inventory[0].stock).toBe(7);
    expect(r.movements[0]).toMatchObject({ type: "inventurkorrektur", qty: -3 });
  });

  it("erzeugt ohne Änderung keine Bewegung", () => {
    expect(correctStock({ inventory: [KREIDE], units: [] }, "k", 10, makeCtx()).movements).toEqual([]);
  });

  it("lässt seriennummernpflichtige Artikel unberührt", () => {
    const { state, ctx } = withThreeQueues();
    const r = correctStock(state, "q", 99, ctx);
    expect(r.inventory[0].stock).toBe(3);
    expect(r.movements).toEqual([]);
  });
});

describe("Protokoll pro Jahr", () => {
  it("legt Bewegungen im Schlüssel ihres Jahres ab und hängt hinten an", () => {
    const result = appendMovements({ "stock-movements-2026": [{ id: "alt" }] }, [
      { id: "a", at: "2026-12-31T23:00:00.000Z" },
      { id: "b", at: "2027-01-01T08:00:00.000Z" },
    ]);
    expect(result["stock-movements-2026"].map((m) => m.id)).toEqual(["alt", "a"]);
    expect(result["stock-movements-2027"].map((m) => m.id)).toEqual(["b"]);
    expect(movementsKey("2027-02-13T10:00:00.000Z")).toBe("stock-movements-2027");
  });
});

describe("Menge", () => {
  it("zählt Positionen ohne Menge als ein Stück", () => {
    expect(itemQuantity({})).toBe(1);
    expect(itemQuantity({ quantity: "" })).toBe(1);
    expect(itemQuantity({ quantity: "3" })).toBe(3);
  });
});
