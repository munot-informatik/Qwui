// Verkauf per Scan: Was im Feld «Scannen» der Quittung landet, ist entweder
// eine Seriennummer (Etikett am Stück) oder eine Artikelnummer (Barcode auf
// Verpackung oder Regal). Reine Funktionen ohne Speicherzugriff, damit die
// Regeln getestet werden können.

import { findUnitBySerial, isSellable, UNIT_STATUS_LABEL } from "./serials.js";
import { isSerialTracked } from "./stock.js";

function sameArticleNumber(p, code) {
  return (p.articleNumber || "").trim().toLowerCase() === code.toLowerCase();
}

// Was ist dieser Code? Liefert { type: "unit", product, unit },
// { type: "product", product } oder { error }.
export function resolveSaleScan(rawCode, { inventory = [], units = [], items = [], editingReceiptId = null } = {}) {
  const code = String(rawCode ?? "").trim();
  if (!code) return { error: "" };

  const unit = findUnitBySerial(units, code);
  if (unit) {
    const product = inventory.find((p) => p.id === unit.productId);
    if (!product) return { error: `Seriennummer ${unit.serial} gehört zu keinem Artikel im Inventar.` };
    if (items.some((it) => it.unitId === unit.id)) {
      return { error: `${unit.serial} steht bereits auf dieser Quittung.` };
    }
    const soldByThisReceipt = editingReceiptId && unit.receiptId === editingReceiptId;
    if (!isSellable(unit) && !soldByThisReceipt) {
      if (unit.status === "verkauft") {
        return {
          error: `${unit.serial} ist bereits verkauft${unit.receiptNumber ? ` (Quittung Nr. ${unit.receiptNumber})` : ""}.`,
        };
      }
      return {
        error: `${unit.serial} ist «${UNIT_STATUS_LABEL[unit.status] || unit.status}» — zuerst im Inventar wieder auf «an Lager» setzen.`,
      };
    }
    return { type: "unit", product, unit };
  }

  const product = inventory.find((p) => sameArticleNumber(p, code));
  if (product) return { type: "product", product };

  return { error: `«${code}» ist weder eine Seriennummer noch eine Artikelnummer im Inventar.` };
}

function isBlankItem(it) {
  return !String(it.description ?? "").trim() && !String(it.amount ?? "").trim() && !it.productId;
}

function productFields(product) {
  return {
    kind: "product",
    description: product.name || "",
    amount: String(product.price ?? ""),
    articleNumber: product.articleNumber || "",
    productId: product.id,
    unitId: "",
    serial: "",
    quantity: "1",
  };
}

// Trägt einen erkannten Scan in die Positionen ein. makeItem liefert eine neue,
// leere Position (mit eigener ID). Ergebnis: { items, message, focusItemId }.
//  - Seriennummer: füllt eine Position desselben Artikels, die noch auf ihr
//    Exemplar wartet, sonst eine leere Position, sonst eine neue.
//  - Artikelnummer ohne Seriennummernpflicht: Menge +1, falls der Artikel
//    schon auf der Quittung steht.
//  - Artikelnummer mit Seriennummernpflicht: Position anlegen, das Exemplar
//    wird danach gescannt oder gewählt.
export function applySaleScan(items, scan, makeItem) {
  const { product, unit } = scan;
  const list = [...items];

  if (scan.type === "unit") {
    const waiting = list.findIndex((it) => it.productId === product.id && !it.unitId);
    const unitFields = { unitId: unit.id, serial: unit.serial, quantity: "1" };
    if (waiting >= 0) {
      list[waiting] = { ...list[waiting], ...unitFields };
      return { items: list, message: `${unit.serial} · ${product.name} eingetragen.`, focusItemId: list[waiting].id };
    }
    const blank = list.findIndex(isBlankItem);
    const filled = { ...(blank >= 0 ? list[blank] : makeItem()), ...productFields(product), ...unitFields };
    if (blank >= 0) list[blank] = filled;
    else list.push(filled);
    return { items: list, message: `${unit.serial} · ${product.name} eingetragen.`, focusItemId: filled.id };
  }

  if (!isSerialTracked(product)) {
    const same = list.findIndex((it) => it.productId === product.id);
    if (same >= 0) {
      const quantity = String((Number(list[same].quantity) || 1) + 1);
      list[same] = { ...list[same], quantity };
      return { items: list, message: `${product.name}: Menge ${quantity}.`, focusItemId: list[same].id };
    }
  } else {
    const waiting = list.find((it) => it.productId === product.id && !it.unitId);
    if (waiting) {
      return {
        items: list,
        message: `${product.name} hat Seriennummern — bitte das Etikett am Stück scannen oder das Exemplar wählen.`,
        focusItemId: waiting.id,
      };
    }
  }

  const blank = list.findIndex(isBlankItem);
  const filled = { ...(blank >= 0 ? list[blank] : makeItem()), ...productFields(product) };
  if (blank >= 0) list[blank] = filled;
  else list.push(filled);
  return {
    items: list,
    message: isSerialTracked(product)
      ? `${product.name} eingetragen — bitte noch die Seriennummer scannen oder das Exemplar wählen.`
      : `${product.name} eingetragen.`,
    focusItemId: filled.id,
  };
}
