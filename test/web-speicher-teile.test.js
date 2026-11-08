// Web-Version: Cloudflare D1 nimmt pro Wert höchstens 2 MB an. Grosse Werte
// (vor allem die Quittungsliste) werden deshalb in Teile zerlegt. Hier gegen
// einen nachgebauten Server, der die D1-Grenze durchsetzt.

import { describe, it, expect, beforeEach } from "vitest";
import { storageShim, splitLargeEntries, isChunkKey, CHUNK_CHARS } from "../src/apiStorage.js";

const D1_LIMIT = 2000000;
let db;
let batches;

function fakeFetch(url, init = {}) {
  const u = new URL(url, "http://qwui.test");
  const method = init.method || "GET";
  const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  const full = (key, shared) => `${shared === true || shared === "true" ? "shared" : "personal"}:${key}`;
  const put = (key, value, shared) => {
    if (new TextEncoder().encode(value).length > D1_LIMIT) throw new Error("D1: Wert zu gross");
    db.set(full(key, shared), value);
  };
  if (u.pathname === "/api/storage" && method === "GET") {
    const k = full(u.searchParams.get("key"), u.searchParams.get("shared"));
    return reply(db.has(k) ? { key: u.searchParams.get("key"), value: db.get(k) } : null);
  }
  if (u.pathname === "/api/storage" && method === "POST") {
    const { key, value, shared } = JSON.parse(init.body);
    try {
      put(key, value, shared);
    } catch (e) {
      return reply({ error: e.message }, 503);
    }
    return reply({ key });
  }
  if (u.pathname === "/api/storage" && method === "DELETE") {
    db.delete(full(u.searchParams.get("key"), u.searchParams.get("shared")));
    return reply({ deleted: true });
  }
  if (u.pathname === "/api/storage-batch") {
    const { entries } = JSON.parse(init.body);
    batches.push(entries.map((e) => e.key));
    const before = new Map(db);
    try {
      for (const e of entries) put(e.key, e.value, e.shared);
    } catch (e) {
      db = before; // alles oder nichts
      return reply({ error: e.message }, 503);
    }
    return reply({ keys: entries.map((e) => e.key) });
  }
  if (u.pathname === "/api/storage-list") {
    const scope = u.searchParams.get("shared") === "true" ? "shared:" : "personal:";
    const prefix = scope + (u.searchParams.get("prefix") || "");
    return reply({ keys: [...db.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(scope.length)) });
  }
  return reply({ error: "unbekannt" }, 404);
}

beforeEach(() => {
  db = new Map();
  batches = [];
  globalThis.fetch = fakeFetch;
});

function receipts(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    number: String(i + 1).padStart(4, "0"),
    date: "2027-02-13",
    customer: { name: "Jürg Müller", street: "Vordergasse", houseNumber: "1", postalCode: "8200", city: "Schaffhausen" },
    company: { name: "Billard Shop Munot", address: "Vordergasse 1", zipCity: "8200 Schaffhausen" },
    items: [{ description: "Predator Revo 12.9 – Carbon Shaft", amount: "890", quantity: 1, kind: "product", serial: `PR-${i}` }],
    total: 890,
    note: "€ ".repeat(200),
  }));
}

describe("Grosse Werte in der Web-Version", () => {
  it("speichert eine Quittungsliste über 2 MB in Teilen und liest sie unverändert zurück", async () => {
    const value = JSON.stringify(receipts(4000));
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(4 * D1_LIMIT / 2);
    await storageShim.set("receipts-list", value);
    expect([...db.keys()].filter(isChunkKey).length).toBeGreaterThan(1);
    for (const v of db.values()) expect(new TextEncoder().encode(v).length).toBeLessThanOrEqual(D1_LIMIT);
    const back = await storageShim.get("receipts-list");
    expect(back.value).toBe(value);
  });

  it("schreibt Hauptschlüssel und Teile in einem einzigen Batch", async () => {
    await storageShim.setMany([
      { key: "receipts-list", value: JSON.stringify(receipts(4000)) },
      { key: "receipt-last-number", value: "4000" },
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toContain("receipts-list");
    expect(batches[0]).toContain("receipt-last-number");
    expect(batches[0].some(isChunkKey)).toBe(true);
  });

  it("zeigt die Teile nicht als eigene Schlüssel", async () => {
    await storageShim.set("stock-movements-2027", JSON.stringify(receipts(4000)));
    await storageShim.set("stock-movements-2026", "[]");
    const { keys } = await storageShim.list("stock-movements-");
    expect(keys.sort()).toEqual(["stock-movements-2026", "stock-movements-2027"]);
  });

  it("liest wieder einen normalen Wert, wenn die Liste kleiner wird", async () => {
    await storageShim.set("receipts-list", JSON.stringify(receipts(4000)));
    await storageShim.set("receipts-list", JSON.stringify(receipts(2)));
    expect(JSON.parse((await storageShim.get("receipts-list")).value)).toHaveLength(2);
  });

  it("löscht die Teile mit", async () => {
    await storageShim.set("stock-movements-2027", JSON.stringify(receipts(4000)));
    await storageShim.delete("stock-movements-2027");
    expect([...db.keys()]).toEqual([]);
  });

  it("lässt kleine Werte unverändert", () => {
    expect(splitLargeEntries([{ key: "a", value: "x".repeat(1000) }])).toEqual([{ key: "a", value: "x".repeat(1000) }]);
    const parts = splitLargeEntries([{ key: "a", value: "y".repeat(CHUNK_CHARS * 4 + 1) }]);
    expect(parts.map((p) => p.key)).toEqual(["a", "a#teil-1", "a#teil-2", "a#teil-3", "a#teil-4", "a#teil-5"]);
  });
});
