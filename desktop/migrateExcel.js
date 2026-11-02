// Einmalige Übernahme der Daten aus Qwui 1.1 (Qwui-Daten.xlsx + firma.json)
// in die SQLite-Datenbank. Läuft beim Start, bevor das Fenster aufgeht.
//
// - Die Excel-Datei und firma.json bleiben unverändert als Sicherung liegen
//   (gelesen wird mit persistFixes: false, siehe excelStore.js).
// - Alles wird in einer Transaktion geschrieben, zusammen mit dem Vermerk
//   "migration". Bricht etwas ab, fehlt der Vermerk, und der nächste Start
//   versucht es von vorn — halbe Übernahmen gibt es nicht.
// - Für jeden Artikel mit Bestand entsteht eine Inventurkorrektur, damit der
//   übernommene Bestand im Protokoll belegt ist.
//
// Die Lesefunktionen werden übergeben, damit sich die Übernahme ohne
// Electron testen lässt (test/migration.test.js).

export const MIGRATION_META = "migration";

// Gleiche Werte wie in shared/stock.js (MOVEMENT_TYPE, movementsKey). Bewusst
// hier dupliziert statt importiert: shared/ liegt ausserhalb von desktop/ und
// wird nicht mit eingepackt. test/migration.test.js prüft die Übereinstimmung.
const MOVEMENT_TYPE_CORRECTION = "inventurkorrektur";
const movementsKey = (iso) => `stock-movements-${String(iso).slice(0, 4)}`;

export const OPENING_NOTE = "Übernahme aus Qwui-Daten.xlsx (Version 1.2.0)";

// sources: { workbookExists, companyExists, readCompany, readCustomers, readReceipts, readInventory }
// ctx: { now, newId }
export async function migrateFromExcel(store, sources, ctx) {
  const done = store.getMeta(MIGRATION_META);
  if (done) return { migrated: false, reason: "bereits übernommen", meta: done };

  if (!sources.workbookExists && !sources.companyExists) {
    const meta = { at: ctx.now, from: null, counts: null };
    await store.setManyWithMeta([], MIGRATION_META, meta);
    return { migrated: false, reason: "keine Altdaten", meta };
  }

  const company = sources.companyExists ? await sources.readCompany() : null;
  const customers = sources.workbookExists ? await sources.readCustomers({ persistFixes: false }) : [];
  const receipts = sources.workbookExists ? await sources.readReceipts() : [];
  const inventory = sources.workbookExists ? await sources.readInventory({ persistFixes: false }) : [];

  const movements = inventory
    .filter((p) => (Number(p.stock) || 0) !== 0)
    .map((p) => ({
      id: ctx.newId(),
      at: ctx.now,
      productId: p.id,
      articleNumber: p.articleNumber || "",
      serial: null,
      qty: Number(p.stock) || 0,
      type: MOVEMENT_TYPE_CORRECTION,
      ref: { note: OPENING_NOTE },
      source: "app",
    }));

  const entries = [
    { key: "customers-list", value: JSON.stringify(customers) },
    { key: "receipts-list", value: JSON.stringify(receipts) },
    { key: "inventory-list", value: JSON.stringify(inventory) },
  ];
  if (company) entries.push({ key: "company-info", value: JSON.stringify(company) });
  if (movements.length) entries.push({ key: movementsKey(ctx.now), value: JSON.stringify(movements) });

  const meta = {
    at: ctx.now,
    from: "Qwui-Daten.xlsx",
    counts: {
      customers: customers.length,
      receipts: receipts.length,
      inventory: inventory.length,
      company: !!company,
    },
  };
  await store.setManyWithMeta(entries, MIGRATION_META, meta);
  return { migrated: true, meta };
}
