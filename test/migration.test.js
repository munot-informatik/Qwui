// Übernahme aus Qwui 1.1: Beim ersten Start mit 1.2.0 müssen Firma, Kunden,
// Quittungen und Inventar vollständig in der neuen Datenbank landen — und die
// Excel-Datei muss danach Byte für Byte unverändert als Sicherung daliegen.
//
// Läuft mit der echten Excel-Logik aus desktop/excelStore.js; nur der
// Datenordner (sonst neben der .exe) zeigt auf einen Temp-Ordner.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const paths = vi.hoisted(() => ({ dir: "" }));

vi.mock("../desktop/dataDir.js", () => ({
  getDataDir: () => paths.dir,
  getLogosDir: () => join(paths.dir, "logos"),
  getWorkbookPath: () => join(paths.dir, "Qwui-Daten.xlsx"),
  getCompanyPath: () => join(paths.dir, "firma.json"),
  getDatabasePath: () => join(paths.dir, "qwui.db"),
}));

const excel = await import("../desktop/excelStore.js");
const { readCompany } = await import("../desktop/companyStore.js");
const { storeLogo, loadLogo } = await import("../desktop/logoCache.js");
const { openStore } = await import("../desktop/sqliteStore.js");
const { migrateFromExcel, OPENING_NOTE } = await import("../desktop/migrateExcel.js");
const { movementsKey, MOVEMENT_TYPE } = await import("../shared/stock.js");

let store;
let n = 0;
const ctx = { now: "2027-01-05T09:00:00.000Z", newId: () => `m${++n}` };

function sources() {
  return {
    workbookExists: existsSync(join(paths.dir, "Qwui-Daten.xlsx")),
    companyExists: existsSync(join(paths.dir, "firma.json")),
    readCompany,
    readCustomers: excel.readCustomersList,
    readReceipts: excel.readReceiptsList,
    readInventory: excel.readInventoryList,
  };
}

async function read(key) {
  const row = await store.get(key);
  return row ? JSON.parse(row.value) : null;
}

beforeEach(() => {
  paths.dir = mkdtempSync(join(tmpdir(), "qwui-migration-"));
  mkdirSync(join(paths.dir, "logos"));
  store = openStore(join(paths.dir, "qwui.db"), { storeLogo, loadLogo });
});

afterEach(() => {
  store.close();
  rmSync(paths.dir, { recursive: true, force: true });
});

async function writeVersion11Data() {
  writeFileSync(join(paths.dir, "firma.json"), JSON.stringify({ name: "Billard Shop Munot" }));
  await excel.writeCustomersList([{ id: "c1", name: "Sandra Meier", email: "s@example.ch" }]);
  await excel.writeInventoryList([
    { id: "p1", articleNumber: "KR-01", name: "Kreide", group: "Zubehör", stock: 12, price: 4 },
    { id: "p2", articleNumber: "TU-01", name: "Pomeranze", group: "Zubehör", stock: 0, price: 9 },
  ]);
  await excel.writeReceiptsList([
    {
      id: "r1",
      number: 1,
      date: "2026-09-01",
      customer: { name: "Sandra Meier" },
      items: [{ description: "Kreide", amount: "4" }],
      total: 4,
      company: { name: "Billard Shop Munot", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      createdAt: "2026-09-01T10:00:00.000Z",
    },
  ]);
}

describe("Übernahme aus Qwui-Daten.xlsx", () => {
  it("übernimmt Firma, Kunden, Quittungen und Inventar vollständig", async () => {
    await writeVersion11Data();
    const result = await migrateFromExcel(store, sources(), ctx);

    expect(result.migrated).toBe(true);
    expect(result.meta.counts).toEqual({ customers: 1, receipts: 1, inventory: 2, company: true });
    expect(await read("company-info")).toEqual({ name: "Billard Shop Munot" });
    expect((await read("customers-list"))[0]).toMatchObject({ id: "c1", name: "Sandra Meier", email: "s@example.ch" });
    expect((await read("inventory-list")).map((p) => [p.articleNumber, p.stock])).toEqual([
      ["KR-01", 12],
      ["TU-01", 0],
    ]);
    const [receipt] = await read("receipts-list");
    expect(receipt).toMatchObject({ id: "r1", number: 1, total: 4 });
    expect(receipt.company.logoDataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("belegt den übernommenen Bestand mit einer Inventurkorrektur", async () => {
    await writeVersion11Data();
    await migrateFromExcel(store, sources(), ctx);

    const movements = await read(movementsKey(ctx.now));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: "p1",
      qty: 12,
      type: MOVEMENT_TYPE.correction,
      ref: { note: OPENING_NOTE },
    });
  });

  it("lässt die Excel-Datei unverändert, auch wenn Zeilen ohne ID darin stehen", async () => {
    await writeVersion11Data();
    // Von Hand in Excel ergänzter Kunde ohne ID: früher hätte das Lesen die
    // ID sofort in die Datei zurückgeschrieben.
    // exceljs ist eine Abhängigkeit von desktop/, nicht vom Projekt-Root.
    const ExcelJS = createRequire(new URL("../desktop/package.json", import.meta.url))("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(paths.dir, "Qwui-Daten.xlsx"));
    wb.getWorksheet("Kunden").addRow(["", "Neu von Hand"]);
    await wb.xlsx.writeFile(join(paths.dir, "Qwui-Daten.xlsx"));
    const before = readFileSync(join(paths.dir, "Qwui-Daten.xlsx"));

    await migrateFromExcel(store, sources(), ctx);

    expect(readFileSync(join(paths.dir, "Qwui-Daten.xlsx")).equals(before)).toBe(true);
    const names = (await read("customers-list")).map((c) => c.name);
    expect(names).toContain("Neu von Hand");
  });

  it("übernimmt nur einmal", async () => {
    await writeVersion11Data();
    await migrateFromExcel(store, sources(), ctx);
    await store.set("customers-list", "[]");
    const second = await migrateFromExcel(store, sources(), ctx);
    expect(second.migrated).toBe(false);
    expect(await read("customers-list")).toEqual([]);
  });

  it("startet ohne Altdaten mit leerer Datenbank", async () => {
    const result = await migrateFromExcel(store, sources(), ctx);
    expect(result).toMatchObject({ migrated: false, reason: "keine Altdaten" });
    expect((await store.list("")).keys).toEqual([]);
    expect(store.getMeta("migration")).not.toBeNull();
  });

  it("schreibt bei einem Lesefehler nichts und versucht es beim nächsten Start erneut", async () => {
    await writeVersion11Data();
    const broken = { ...sources(), readReceipts: async () => { throw new Error("Datei beschädigt"); } };
    await expect(migrateFromExcel(store, broken, ctx)).rejects.toThrow("Datei beschädigt");
    expect((await store.list("")).keys).toEqual([]);
    expect(store.getMeta("migration")).toBeNull();

    const retry = await migrateFromExcel(store, sources(), ctx);
    expect(retry.migrated).toBe(true);
  });
});
