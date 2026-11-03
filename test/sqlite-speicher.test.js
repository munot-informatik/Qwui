// Lokale Datenbank der Windows-Version: muss sich genau wie der Speicher der
// Web-Version verhalten (get/set/setMany/delete/list), sonst verhält sich die
// App unter Windows anders als im Browser.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../desktop/sqliteStore.js";

let dir;
let store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qwui-sqlite-"));
});

afterEach(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Grundfunktionen", () => {
  it("liest zurück, was gespeichert wurde, und null für Unbekanntes", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.set("customers-list", '[{"id":"c1"}]');
    expect(await store.get("customers-list")).toEqual({ key: "customers-list", value: '[{"id":"c1"}]' });
    expect(await store.get("gibt-es-nicht")).toBeNull();
  });

  it("überlebt das Schliessen und erneute Öffnen", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.set("inventory-list", "[]");
    store.close();
    store = openStore(join(dir, "qwui.db"));
    expect((await store.get("inventory-list")).value).toBe("[]");
  });

  it("löscht einen Schlüssel", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.set("receipts-list", "[]");
    await store.delete("receipts-list");
    expect(await store.get("receipts-list")).toBeNull();
  });

  it("listet nach Präfix, ohne Platzhalter falsch zu deuten", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.set("stock-movements-2026", "[]");
    await store.set("stock-movements-2027", "[]");
    await store.set("serial-units", "[]");
    expect((await store.list("stock-movements-")).keys.sort()).toEqual([
      "stock-movements-2026",
      "stock-movements-2027",
    ]);
    expect((await store.list("%")).keys).toEqual([]);
  });
});

describe("Mehrere Schlüssel in einem Schritt", () => {
  it("schreibt alle Einträge", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.setMany([
      { key: "inventory-list", value: "[1]" },
      { key: "serial-units", value: "[2]" },
    ]);
    expect((await store.get("inventory-list")).value).toBe("[1]");
    expect((await store.get("serial-units")).value).toBe("[2]");
  });

  it("schreibt gar nichts, wenn ein Eintrag ungültig ist", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.set("inventory-list", "[alt]");
    await expect(
      store.setMany([
        { key: "inventory-list", value: "[neu]" },
        { key: "serial-units", value: { kein: "String" } },
      ])
    ).rejects.toThrow();
    expect((await store.get("inventory-list")).value).toBe("[alt]");
    expect(await store.get("serial-units")).toBeNull();
  });

  it("hält Meta-Einträge aus der Schlüsselliste heraus", async () => {
    store = openStore(join(dir, "qwui.db"));
    await store.setManyWithMeta([{ key: "customers-list", value: "[]" }], "migration", { at: "x" });
    expect(store.getMeta("migration")).toEqual({ at: "x" });
    expect((await store.list("")).keys).toEqual(["customers-list"]);
  });
});

describe("Logos in Quittungen", () => {
  it("lagert das Logo aus und setzt es beim Lesen wieder ein", async () => {
    const files = new Map();
    store = openStore(join(dir, "qwui.db"), {
      storeLogo: async (dataUrl) => {
        files.set("abc.png", dataUrl);
        return { logoRef: "abc.png", logoMime: "image/png" };
      },
      loadLogo: async (ref) => files.get(ref),
    });
    const logo = "data:image/png;base64,AAAA";
    const receipts = [{ id: "r1", company: { name: "Billard AG", logoDataUrl: logo } }];
    await store.set("receipts-list", JSON.stringify(receipts));

    const restored = JSON.parse((await store.get("receipts-list")).value);
    expect(restored[0].company).toEqual({ name: "Billard AG", logoDataUrl: logo });
  });

  it("liest für Auswertungen ohne Logos (getRaw)", async () => {
    let loads = 0;
    store = openStore(join(dir, "qwui.db"), {
      storeLogo: async () => ({ logoRef: "abc.png", logoMime: "image/png" }),
      loadLogo: async () => {
        loads++;
        return "data:image/png;base64,AAAA";
      },
    });
    await store.set("receipts-list", JSON.stringify([{ id: "r1", company: { logoDataUrl: "data:image/png;base64,AAAA" } }]));
    const raw = JSON.parse(store.getRaw("receipts-list").value);
    expect(raw[0].company).toEqual({ logoRef: "abc.png", logoMime: "image/png" });
    expect(loads).toBe(0);
  });
});
