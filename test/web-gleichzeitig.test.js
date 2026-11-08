// Web-Version mit zwei Geräten (oder zwei Fenstern): Das zweite darf die
// Quittung des ersten nicht stillschweigend überschreiben. Zwei getrennte
// Kopien von src/apiStorage.js spielen die zwei Geräte, der nachgebaute
// Server prüft die Versionen wie functions/api/storage-batch.js.

import { describe, it, expect, beforeEach, vi } from "vitest";

let db; // full_key → { value, version }
let counter;

function server(url, init = {}) {
  const u = new URL(url, "http://qwui.test");
  const method = init.method || "GET";
  const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  const full = (key) => `personal:${key}`;
  if (u.pathname === "/api/storage" && method === "GET") {
    const row = db.get(full(u.searchParams.get("key")));
    return reply(row ? { key: u.searchParams.get("key"), value: row.value, version: row.version } : null);
  }
  if (u.pathname === "/api/storage" && method === "DELETE") {
    db.delete(full(u.searchParams.get("key")));
    return reply({ deleted: true });
  }
  if (u.pathname === "/api/storage-list") return reply({ keys: [] });
  const entries = u.pathname === "/api/storage-batch" ? JSON.parse(init.body).entries : [JSON.parse(init.body)];
  for (const e of entries) {
    const current = db.get(full(e.key));
    if (e.expected === "" && current) return reply({ error: "konflikt" }, 409);
    if (typeof e.expected === "string" && e.expected !== "" && current?.version !== e.expected) return reply({ error: "konflikt" }, 409);
  }
  const versions = {};
  for (const e of entries) {
    const version = `v${++counter}`;
    db.set(full(e.key), { value: e.value, version });
    versions[e.key] = version;
  }
  return reply({ keys: entries.map((e) => e.key), versions });
}

async function device() {
  vi.resetModules();
  const mod = await import("../src/apiStorage.js");
  return mod.storageShim;
}

beforeEach(() => {
  db = new Map();
  counter = 0;
  globalThis.fetch = server;
});

const add = async (dev, list, text) => {
  const next = [...list, { number: String(list.length + 1).padStart(4, "0"), text }];
  await dev.setMany([{ key: "receipts-list", value: JSON.stringify(next) }]);
  return next;
};

describe("Zwei Geräte gleichzeitig", () => {
  it("lehnt das Speichern mit veraltetem Stand ab, statt die fremde Quittung zu löschen", async () => {
    const a = await device();
    const b = await device();
    // Beide laden den leeren Stand.
    const listA = JSON.parse((await a.get("receipts-list"))?.value || "[]");
    const listB = JSON.parse((await b.get("receipts-list"))?.value || "[]");
    await add(a, listA, "Gerät A");
    await expect(add(b, listB, "Gerät B")).rejects.toMatchObject({ conflict: true });
    const stored = JSON.parse(db.get("personal:receipts-list").value);
    expect(stored.map((r) => r.text)).toEqual(["Gerät A"]);
  });

  it("speichert nach dem Neuladen wieder normal", async () => {
    const a = await device();
    let b = await device();
    await a.get("receipts-list");
    await b.get("receipts-list");
    await add(a, [], "Gerät A");
    await expect(add(b, [], "Gerät B")).rejects.toMatchObject({ conflict: true });
    b = await device(); // neu laden
    const fresh = JSON.parse((await b.get("receipts-list")).value);
    await add(b, fresh, "Gerät B");
    expect(JSON.parse(db.get("personal:receipts-list").value).map((r) => r.text)).toEqual(["Gerät A", "Gerät B"]);
  });

  it("schützt auch Schlüssel, die ein Gerät noch nie gesehen hat (neues Jahr der Lagerbewegungen)", async () => {
    const a = await device();
    const b = await device();
    await a.setMany([{ key: "stock-movements-2028", value: "[1]" }]);
    await expect(b.setMany([{ key: "stock-movements-2028", value: "[2]" }])).rejects.toMatchObject({ conflict: true });
    expect(db.get("personal:stock-movements-2028").value).toBe("[1]");
  });

  it("darf mehrmals hintereinander speichern (Version wird nachgeführt)", async () => {
    const a = await device();
    await a.get("receipts-list");
    let list = [];
    for (let i = 0; i < 3; i++) list = await add(a, list, `Nr ${i}`);
    await a.set("customers-list", "[]");
    await a.set("customers-list", "[1]");
    expect(JSON.parse(db.get("personal:receipts-list").value)).toHaveLength(3);
  });

  it("prüft Logos nicht — zwei Geräte legen dasselbe Logo ab", async () => {
    const a = await device();
    const b = await device();
    const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const withLogo = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: String(i + 1), company: { name: "Munot", logoDataUrl: logo } })));
    await a.get("receipts-list");
    await a.setMany([{ key: "receipts-list", value: withLogo(1) }]);
    // b lädt danach (aktueller Stand) und speichert ebenfalls mit demselben Logo.
    await b.get("receipts-list");
    await b.setMany([{ key: "receipts-list", value: withLogo(2) }]);
    const logoKeys = [...db.keys()].filter((k) => k.startsWith("personal:logo:"));
    expect(logoKeys).toHaveLength(1);
    const back = JSON.parse((await b.get("receipts-list")).value);
    expect(back).toHaveLength(2);
    expect(back[1].company.logoDataUrl).toBe(logo);
  });

  it("blockiert sich nicht selbst, wenn ein Fenster denselben Wert zweimal kurz nacheinander speichert", async () => {
    const a = await device();
    await a.get("inventory-list");
    // Ohne Warteschlange gingen beide mit derselben alten Version los.
    await Promise.all([a.set("inventory-list", "[1]"), a.setMany([{ key: "inventory-list", value: "[1,2]" }])]);
    expect(db.get("personal:inventory-list").value).toBe("[1,2]");
  });
});
