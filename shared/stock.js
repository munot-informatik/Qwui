// Lagerbuchungen: Wareneingang, Verkauf per Quittung, Storno und
// Inventurkorrektur. Reine Funktionen — sie bekommen den aktuellen Stand
// (Inventar + Exemplare) und liefern den neuen Stand samt Lagerbewegungen
// zurück, ohne selbst etwas zu speichern. Gespeichert wird danach in EINEM
// Schritt über storage.setMany(), damit Quittung, Exemplare, Bestand und
// Bewegungen nie auseinanderlaufen.
//
// Was eine Quittung gebucht hat, steht in receipt.stockBooking. Ein Storno
// kehrt genau diese Liste um, statt die Bewegungen nachzuschlagen — die
// liegen pro Jahr in eigenen Schlüsseln (siehe movementsKey). Quittungen von
// vor 1.2.0 haben kein stockBooking: Löschen oder Bearbeiten verändert den
// Bestand dann nicht, sie haben ihn ja auch nie reduziert.
//
// ctx: { now: ISO-Zeitstempel, source: "app" | "assistent", newId: () => string }

import { UNIT_STATUS, isSellable } from "./serials.js";
import { itemQuantity } from "./items.js";

export { itemQuantity };

export const MOVEMENT_TYPE = {
  goodsIn: "wareneingang",
  sale: "verkauf",
  reversal: "storno",
  correction: "inventurkorrektur",
  // Ab 1.5.0: Rücknahme mit Gutschrift (siehe bookCreditNote).
  creditReturn: "retoure",
};

export const MOVEMENT_TYPE_LABEL = {
  wareneingang: "Wareneingang",
  verkauf: "Verkauf",
  storno: "Storno",
  inventurkorrektur: "Inventurkorrektur",
  retoure: "Retoure",
};

export const MOVEMENT_SOURCE = { app: "app", assistant: "assistent" };

export const MOVEMENTS_PREFIX = "stock-movements-";

// Ein Schlüssel pro Kalenderjahr: das Protokoll wächst nur nach hinten, und
// D1 begrenzt die Grösse eines einzelnen Werts.
export function movementsKey(isoTimestamp) {
  return `${MOVEMENTS_PREFIX}${String(isoTimestamp).slice(0, 4)}`;
}

export function isMovementsKey(key) {
  return typeof key === "string" && key.startsWith(MOVEMENTS_PREFIX);
}

export function isSerialTracked(product) {
  return product?.serialTracked === true;
}

export function countInStock(units, productId) {
  return (units || []).filter((u) => u.productId === productId && u.status === UNIT_STATUS.inStock)
    .length;
}

// Verfügbare Menge eines Artikels. Bei Seriennummernpflicht zählt allein die
// Anzahl Exemplare "an Lager", nicht das gespeicherte stock-Feld.
export function productStock(product, units) {
  if (isSerialTracked(product)) return countInStock(units, product.id);
  return Number(product?.stock) || 0;
}

// Hält das stock-Feld seriennummernpflichtiger Artikel mit den Exemplaren in
// Einklang — Lagerwert, Excel-Export und Shop-Feed lesen weiterhin stock.
export function syncSerialStock(inventory, units) {
  return (inventory || []).map((p) => {
    if (!isSerialTracked(p)) return p;
    const stock = countInStock(units, p.id);
    return p.stock === stock ? p : { ...p, stock };
  });
}

function movement(ctx, fields) {
  return {
    id: ctx.newId(),
    at: ctx.now,
    serial: null,
    ref: {},
    source: ctx.source || MOVEMENT_SOURCE.app,
    ...fields,
  };
}

function productMovementFields(product) {
  return { productId: product.id, articleNumber: product.articleNumber || "" };
}

// ---- Verkauf per Quittung ----

// Bucht alle Produktpositionen einer Quittung aus. Liefert errors, wenn die
// Quittung so nicht erstellt werden darf (dann bleibt der Stand unverändert),
// und warnings, die angezeigt werden, den Verkauf aber nicht aufhalten.
export function bookReceipt({ inventory, units }, receipt, ctx) {
  const errors = [];
  const warnings = [];
  const movements = [];
  const booking = [];
  let nextInventory = [...(inventory || [])];
  let nextUnits = [...(units || [])];
  const usedUnitIds = new Set();
  const ref = { receiptId: receipt.id, receiptNumber: receipt.number ?? null };
  const customerId = receipt.customer?.id || null;

  for (const item of receipt.items || []) {
    if (item?.kind !== "product" || !item.productId) continue;
    const product = nextInventory.find((p) => p.id === item.productId);
    if (!product) {
      warnings.push(`«${item.description || "Artikel"}» ist nicht mehr im Inventar — kein Bestand gebucht.`);
      continue;
    }

    if (isSerialTracked(product)) {
      if (itemQuantity(item) !== 1) {
        errors.push(`«${product.name}»: pro Position genau ein Exemplar (Seriennummer).`);
        continue;
      }
      const unit = nextUnits.find((u) => u.id === item.unitId);
      if (!unit) {
        errors.push(`«${product.name}» ist seriennummernpflichtig — bitte ein Exemplar wählen.`);
        continue;
      }
      // Retoure aus dieser Quittung: Die Position bleibt als Beleg stehen, das
      // Exemplar gehört aber nicht mehr zu ihr (evtl. längst weiterverkauft).
      // Beim Bearbeiten nichts neu buchen — sonst liesse sich die Quittung
      // nicht einmal mehr für einen Tippfehler in der Notiz speichern.
      if (unit.receiptId !== receipt.id && unit.returnedFrom?.receiptId === receipt.id) {
        continue;
      }
      if (unit.productId !== product.id) {
        errors.push(`Seriennummer ${unit.serial} gehört nicht zu «${product.name}».`);
        continue;
      }
      if (usedUnitIds.has(unit.id)) {
        errors.push(`Seriennummer ${unit.serial} ist auf dieser Quittung doppelt.`);
        continue;
      }
      if (!isSellable(unit)) {
        errors.push(`Seriennummer ${unit.serial} ist nicht an Lager (Status: ${unit.status}).`);
        continue;
      }
      usedUnitIds.add(unit.id);
      nextUnits = nextUnits.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              status: UNIT_STATUS.sold,
              receiptId: receipt.id,
              receiptNumber: receipt.number ?? null,
              customerId,
              soldAt: ctx.now,
            }
          : u
      );
      // prevStatus: beim Storno zurück auf den Stand davor (z. B. reserviert).
      booking.push({ productId: product.id, unitId: unit.id, serial: unit.serial, qty: 1, prevStatus: unit.status });
      movements.push(
        movement(ctx, {
          ...productMovementFields(product),
          serial: unit.serial,
          qty: -1,
          type: MOVEMENT_TYPE.sale,
          ref,
        })
      );
      continue;
    }

    const qty = itemQuantity(item);
    const stock = (Number(product.stock) || 0) - qty;
    nextInventory = nextInventory.map((p) => (p.id === product.id ? { ...p, stock } : p));
    if (stock < 0) {
      warnings.push(`Bestand von «${product.name}» ist jetzt negativ (${stock}).`);
    }
    booking.push({ productId: product.id, qty });
    movements.push(
      movement(ctx, { ...productMovementFields(product), qty: -qty, type: MOVEMENT_TYPE.sale, ref })
    );
  }

  if (errors.length) {
    return { inventory, units, receipt, movements: [], errors, warnings };
  }

  return {
    inventory: syncSerialStock(nextInventory, nextUnits),
    units: nextUnits,
    receipt: { ...receipt, stockBooking: booking },
    movements,
    errors,
    warnings,
  };
}

// Macht die Buchung einer Quittung rückgängig (Löschen, oder vor dem
// Neubuchen beim Bearbeiten). Storno-Bewegungen statt stillem Überschreiben,
// damit im Protokoll nachvollziehbar bleibt, was passiert ist.
export function reverseReceipt({ inventory, units }, receipt, ctx) {
  const booking = Array.isArray(receipt?.stockBooking) ? receipt.stockBooking : [];
  const movements = [];
  const warnings = [];
  let nextInventory = [...(inventory || [])];
  let nextUnits = [...(units || [])];
  const ref = { receiptId: receipt.id, receiptNumber: receipt.number ?? null, stornoOf: receipt.id };

  for (const line of booking) {
    const product = nextInventory.find((p) => p.id === line.productId);
    const fields = product
      ? productMovementFields(product)
      : { productId: line.productId, articleNumber: "" };

    if (line.unitId) {
      // Nur zurückbuchen, was diese Quittung noch hält. Ein inzwischen als
      // Retoure erfasstes Exemplar ist schon zurück im Lager — ein zweites
      // Storno würde es doppelt zählen.
      const stillSold = nextUnits.some((u) => u.id === line.unitId && u.receiptId === receipt.id);
      if (!stillSold) continue;
      nextUnits = nextUnits.map((u) =>
        u.id === line.unitId
          ? {
              ...u,
              status: line.prevStatus === UNIT_STATUS.reserved ? UNIT_STATUS.reserved : UNIT_STATUS.inStock,
              receiptId: null,
              receiptNumber: null,
              customerId: null,
              soldAt: null,
            }
          : u
      );
      movements.push(
        movement(ctx, { ...fields, serial: line.serial || null, qty: 1, type: MOVEMENT_TYPE.reversal, ref })
      );
      continue;
    }

    // Der Artikel wurde nach dem Verkauf seriennummernpflichtig: Sein Bestand
    // ergibt sich jetzt allein aus den Exemplaren. Eine Bewegung +n stünde im
    // Protokoll, ohne dass sich am Bestand etwas ändert.
    if (isSerialTracked(product)) {
      warnings.push(
        `«${product.name}» ist inzwischen seriennummernpflichtig — ${line.qty} Stück wurden nicht zurückgebucht. Exemplare bitte über den Wareneingang erfassen.`
      );
      continue;
    }

    const qty = Number(line.qty) || 0;
    if (product) {
      nextInventory = nextInventory.map((p) =>
        p.id === product.id ? { ...p, stock: (Number(p.stock) || 0) + qty } : p
      );
    }
    movements.push(movement(ctx, { ...fields, qty, type: MOVEMENT_TYPE.reversal, ref }));
  }

  const { stockBooking, ...rest } = receipt || {};
  return {
    inventory: syncSerialStock(nextInventory, nextUnits),
    units: nextUnits,
    receipt: rest,
    movements,
    warnings,
  };
}

// Bearbeiten = alte Buchung stornieren, neue Fassung buchen. Scheitert die
// neue Buchung, bleibt alles beim Alten (auch das Storno wird verworfen).
export function rebookReceipt(state, oldReceipt, newReceipt, ctx) {
  const reversed = reverseReceipt(state, oldReceipt, ctx);
  const { stockBooking, ...fresh } = newReceipt;
  const booked = bookReceipt(reversed, fresh, ctx);
  if (booked.errors.length) {
    return { ...state, receipt: newReceipt, movements: [], errors: booked.errors, warnings: booked.warnings };
  }
  return {
    ...booked,
    movements: [...reversed.movements, ...booked.movements],
    warnings: [...reversed.warnings, ...booked.warnings],
  };
}

// ---- Gutschrift (Rücknahme) ----
//
// Bucht die zurückgenommenen Produkte einer Gutschrift (shared/documents.js).
// Je Position entscheidet restock:
// - Exemplar mit Seriennummer: zurück «an Lager» oder (defekt, geht an den
//   Lieferanten) «retourniert». Beides ist physisch zurück, deshalb immer +1
//   — wie bei der Retoure von Hand (changeUnitStatus). Der Bezug zur Quittung
//   wandert nach returnedFrom, damit ein Storno der Quittung nicht noch
//   einmal zurückbucht.
// - Menge ohne Seriennummer: mit restock zurück in den Bestand, sonst keine
//   Bewegung (die Ware kommt nicht ins Lager).
export function bookCreditNote({ inventory, units }, creditNote, ctx) {
  const errors = [];
  const movements = [];
  const booking = [];
  let nextInventory = [...(inventory || [])];
  let nextUnits = [...(units || [])];
  const note = `Gutschrift ${creditNote.number}`;
  const ref = {
    receiptId: creditNote.receiptId,
    receiptNumber: creditNote.receiptNumber ?? null,
    creditNoteId: creditNote.id,
    creditNoteNumber: creditNote.number,
    note,
  };

  for (const item of creditNote.items || []) {
    if (item?.kind !== "product" || !item.productId) continue;
    const product = nextInventory.find((p) => p.id === item.productId);

    if (item.unitId) {
      const unit = nextUnits.find((u) => u.id === item.unitId);
      // Schon von Hand als Retoure erfasst (Exemplar-Status): Die Ware ist
      // gebucht, die Gutschrift regelt nur noch das Geld.
      if (unit && unit.returnedFrom?.receiptId === creditNote.receiptId && !unit.returnedFrom.creditNoteId) {
        continue;
      }
      if (!unit || unit.receiptId !== creditNote.receiptId || unit.status !== UNIT_STATUS.sold) {
        errors.push(`Seriennummer ${item.serial || "?"} gehört nicht mehr zu dieser Quittung (schon zurückgenommen?).`);
        continue;
      }
      const status = item.restock ? UNIT_STATUS.inStock : UNIT_STATUS.returned;
      nextUnits = nextUnits.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              status,
              returnedFrom: {
                receiptId: unit.receiptId,
                receiptNumber: unit.receiptNumber,
                customerId: unit.customerId,
                soldAt: unit.soldAt || null,
                at: ctx.now,
                creditNoteId: creditNote.id,
                creditNoteNumber: creditNote.number,
              },
              receiptId: null,
              receiptNumber: null,
              customerId: null,
              soldAt: null,
            }
          : u
      );
      booking.push({ productId: item.productId, unitId: unit.id, serial: unit.serial, qty: 1, status });
      movements.push(
        movement(ctx, {
          productId: item.productId,
          articleNumber: product?.articleNumber || item.articleNumber || "",
          serial: unit.serial,
          qty: 1,
          type: MOVEMENT_TYPE.creditReturn,
          ref,
        })
      );
      continue;
    }

    if (!item.restock) continue;
    if (!product) {
      errors.push(`«${item.description || "Artikel"}» ist nicht mehr im Inventar — bitte ohne «zurück ins Lager» gutschreiben.`);
      continue;
    }
    if (isSerialTracked(product)) {
      errors.push(`«${product.name}» ist inzwischen seriennummernpflichtig — bitte ohne «zurück ins Lager» gutschreiben und das Exemplar im Wareneingang erfassen.`);
      continue;
    }
    const qty = itemQuantity(item);
    nextInventory = nextInventory.map((p) => (p.id === product.id ? { ...p, stock: (Number(p.stock) || 0) + qty } : p));
    booking.push({ productId: product.id, qty });
    movements.push(movement(ctx, { ...productMovementFields(product), qty, type: MOVEMENT_TYPE.creditReturn, ref }));
  }

  if (errors.length) return { inventory, units, creditNote, movements: [], errors };
  return {
    inventory: syncSerialStock(nextInventory, nextUnits),
    units: nextUnits,
    creditNote: { ...creditNote, stockBooking: booking },
    movements,
    errors,
  };
}

// Löschen einer Gutschrift: die Rücknahme umkehren. Ein Exemplar geht nur
// dann zurück an die Quittung, wenn es noch so dasteht, wie die Gutschrift es
// hinterlassen hat — ist es inzwischen weiterverkauft, bleibt die Gutschrift.
export function reverseCreditNote({ inventory, units }, creditNote, ctx) {
  const errors = [];
  const movements = [];
  let nextInventory = [...(inventory || [])];
  let nextUnits = [...(units || [])];
  const ref = {
    receiptId: creditNote.receiptId,
    receiptNumber: creditNote.receiptNumber ?? null,
    creditNoteId: creditNote.id,
    creditNoteNumber: creditNote.number,
    stornoOf: creditNote.id,
    note: `Storno Gutschrift ${creditNote.number}`,
  };

  for (const line of creditNote.stockBooking || []) {
    const product = nextInventory.find((p) => p.id === line.productId);
    const fields = product ? productMovementFields(product) : { productId: line.productId, articleNumber: "" };
    if (line.unitId) {
      const unit = nextUnits.find((u) => u.id === line.unitId);
      const untouched =
        unit &&
        unit.returnedFrom?.creditNoteId === creditNote.id &&
        (unit.status === UNIT_STATUS.inStock || unit.status === UNIT_STATUS.returned || unit.status === UNIT_STATUS.reserved);
      if (!untouched) {
        errors.push(`Seriennummer ${line.serial || "?"} ist inzwischen weiterverkauft oder verändert — die Gutschrift lässt sich nicht mehr löschen.`);
        continue;
      }
      const { returnedFrom, ...rest } = unit;
      nextUnits = nextUnits.map((u) =>
        u.id === unit.id
          ? {
              ...rest,
              status: UNIT_STATUS.sold,
              receiptId: returnedFrom.receiptId,
              receiptNumber: returnedFrom.receiptNumber,
              customerId: returnedFrom.customerId,
              soldAt: returnedFrom.soldAt || returnedFrom.at,
            }
          : u
      );
      movements.push(movement(ctx, { ...fields, serial: line.serial || null, qty: -1, type: MOVEMENT_TYPE.reversal, ref }));
      continue;
    }
    const qty = Number(line.qty) || 0;
    if (product && !isSerialTracked(product)) {
      nextInventory = nextInventory.map((p) => (p.id === product.id ? { ...p, stock: (Number(p.stock) || 0) - qty } : p));
    }
    movements.push(movement(ctx, { ...fields, qty: -qty, type: MOVEMENT_TYPE.reversal, ref }));
  }

  if (errors.length) return { inventory, units, movements: [], errors };
  return { inventory: syncSerialStock(nextInventory, nextUnits), units: nextUnits, movements, errors };
}

// ---- Wareneingang ----

// entry: { productId, quantity?, serials?: string[], purchasePrice?, note?, draftId? }
// Bei Seriennummernpflicht zählen allein die Seriennummern, sonst die Menge.
export function receiveGoods({ inventory, units }, entry, ctx, checkSerials) {
  const product = (inventory || []).find((p) => p.id === entry.productId);
  if (!product) {
    return { inventory, units, movements: [], errors: ["Artikel nicht gefunden."] };
  }
  const note = String(entry.note || "").trim();
  const ref = { ...(entry.draftId ? { draftId: entry.draftId } : {}), ...(note ? { note } : {}) };
  const purchasePrice =
    entry.purchasePrice === "" || entry.purchasePrice == null ? null : Number(entry.purchasePrice);
  // Bei Artikeln ohne Exemplare der einzige Ort für den Einkaufspreis. Das
  // Protokoll geht nie an Shop oder Assistent.
  const priceField = Number.isFinite(purchasePrice) ? { purchasePrice } : {};

  if (isSerialTracked(product)) {
    const serials = (entry.serials || []).map((s) => String(s).trim());
    if (serials.length === 0) {
      return { inventory, units, movements: [], errors: ["Bitte mindestens eine Seriennummer erfassen."] };
    }
    const errors = checkSerials ? checkSerials(serials, units) : [];
    if (errors.length) return { inventory, units, movements: [], errors };

    const newUnits = serials.map((serial) => ({
      id: ctx.newId(),
      serial,
      productId: product.id,
      status: UNIT_STATUS.inStock,
      receivedAt: ctx.now,
      purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : null,
      note: entry.note || "",
      receiptId: null,
      receiptNumber: null,
      customerId: null,
      soldAt: null,
    }));
    const nextUnits = [...(units || []), ...newUnits];
    const movements = newUnits.map((u) =>
      movement(ctx, {
        ...productMovementFields(product),
        serial: u.serial,
        qty: 1,
        type: MOVEMENT_TYPE.goodsIn,
        ref,
        ...priceField,
      })
    );
    return { inventory: syncSerialStock(inventory, nextUnits), units: nextUnits, movements, errors: [] };
  }

  const qty = Number(entry.quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { inventory, units, movements: [], errors: ["Bitte eine ganze Menge grösser als 0 eingeben."] };
  }
  const nextInventory = inventory.map((p) =>
    p.id === product.id ? { ...p, stock: (Number(p.stock) || 0) + qty } : p
  );
  return {
    inventory: nextInventory,
    units,
    movements: [movement(ctx, { ...productMovementFields(product), qty, type: MOVEMENT_TYPE.goodsIn, ref, ...priceField })],
    errors: [],
  };
}

// ---- Status eines Exemplars von Hand ändern ----
//
// - an Lager ↔ reserviert: keine Bewegung. Reservierte zählen nicht zum
//   verfügbaren Bestand, bleiben beim Verkauf aber wählbar.
// - verkauft → retourniert: Das Exemplar ist physisch zurück, deshalb ein
//   Storno +1. Der Bezug zur Quittung wandert nach returnedFrom, damit ein
//   späteres Löschen dieser Quittung nicht noch einmal zurückbucht.
// - retourniert → an Lager: wieder verkäuflich, keine weitere Bewegung.
// - "verkauft" setzt nur eine Quittung.
const ALLOWED_STATUS_CHANGES = {
  an_lager: ["reserviert"],
  reserviert: ["an_lager"],
  verkauft: ["retourniert"],
  retourniert: ["an_lager"],
};

export function changeUnitStatus({ inventory, units }, unitId, status, ctx) {
  const unit = (units || []).find((u) => u.id === unitId);
  if (!unit) return { inventory, units, movements: [], errors: ["Exemplar nicht gefunden."] };
  if (unit.status === status) return { inventory, units, movements: [], errors: [] };
  if (!(ALLOWED_STATUS_CHANGES[unit.status] || []).includes(status)) {
    return {
      inventory,
      units,
      movements: [],
      errors: [`Status «${unit.status}» lässt sich nicht von Hand auf «${status}» ändern.`],
    };
  }

  const movements = [];
  let changed = { ...unit, status };
  if (unit.status === UNIT_STATUS.sold && status === UNIT_STATUS.returned) {
    const product = (inventory || []).find((p) => p.id === unit.productId);
    movements.push(
      movement(ctx, {
        productId: unit.productId,
        articleNumber: product?.articleNumber || "",
        serial: unit.serial,
        qty: 1,
        type: MOVEMENT_TYPE.reversal,
        ref: { receiptId: unit.receiptId, receiptNumber: unit.receiptNumber, note: "Retoure" },
      })
    );
    changed = {
      ...changed,
      returnedFrom: { receiptId: unit.receiptId, receiptNumber: unit.receiptNumber, customerId: unit.customerId, at: ctx.now },
      receiptId: null,
      receiptNumber: null,
      customerId: null,
    };
  }

  const nextUnits = units.map((u) => (u.id === unitId ? changed : u));
  return { inventory: syncSerialStock(inventory, nextUnits), units: nextUnits, movements, errors: [] };
}

// ---- Inventurkorrektur ----

// Neue Zählmenge eines Artikels ohne Seriennummernpflicht. Die Bewegung hält
// die Differenz fest, nicht den neuen Wert.
export function correctStock({ inventory, units }, productId, newStock, ctx, note = "") {
  const product = (inventory || []).find((p) => p.id === productId);
  if (!product || isSerialTracked(product)) return { inventory, units, movements: [] };
  const target = Number(newStock) || 0;
  const diff = target - (Number(product.stock) || 0);
  const nextInventory = inventory.map((p) => (p.id === productId ? { ...p, stock: target } : p));
  if (diff === 0) return { inventory: nextInventory, units, movements: [] };
  return {
    inventory: nextInventory,
    units,
    movements: [
      movement(ctx, {
        ...productMovementFields(product),
        qty: diff,
        type: MOVEMENT_TYPE.correction,
        ref: note ? { note } : {},
      }),
    ],
  };
}

// Bewegungen an die Jahres-Schlüssel anhängen. existing: { [key]: Bewegung[] }
// mit dem bisherigen Inhalt der betroffenen Schlüssel. Liefert dieselbe Form
// mit den angehängten Bewegungen, bereit für storage.setMany().
export function appendMovements(existing, movements) {
  const result = {};
  for (const m of movements || []) {
    const key = movementsKey(m.at);
    if (!result[key]) result[key] = [...(existing?.[key] || [])];
    result[key].push(m);
  }
  return result;
}
