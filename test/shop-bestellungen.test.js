// Bestellungen aus dem Online-Shop: Vorschlag, Quittungsformular, Abholen
// und Rückmeldung an den Shop (desktop/shopOrders.js).
import { describe, it, expect } from "vitest";
import { makeOrderDraft, DRAFT_STATUS } from "../shared/drafts.js";
import { orderToReceiptForm } from "../shared/shopOrders.js";
import { findArticle } from "../shared/reports.js";
import { isSerialTracked } from "../shared/stock.js";
import { createOrderImport, shopBaseUrl } from "../desktop/shopOrders.js";

const order = {
  id: "8f0c2a4e-0000-4000-8000-000000000001",
  number: 12,
  createdAt: "2027-02-13T09:58:00.000Z",
  paidAt: "2027-02-13T10:00:00.000Z",
  payment: "stripe",
  paymentMethod: "twint",
  qwuiStatus: null,
  delivery: "versand",
  note: "Bitte klingeln",
  customer: { name: "Marco Rossi", email: "marco@example.ch", phone: "", street: "Vordergasse", houseNumber: "12", postalCode: "8200", city: "Schaffhausen", receiptByEmail: true },
  items: [
    { articleNumber: "KR-01", name: "Kreide", quantity: 3, price: 9.5 },
    { articleNumber: "PRED-REVO", name: "Predator Revo", quantity: 2, price: 489 },
    { articleNumber: "ALT-9", name: "Alter Artikel", quantity: 1, price: 5 },
  ],
  shipping: 9,
  total: 1020.5,
};

const inventory = [
  { id: "p1", articleNumber: "KR-01", name: "Kreide blau", price: 9.5 },
  { id: "p2", articleNumber: "PRED-REVO", name: "Predator Revo Schaft", price: 499, serialTracked: true },
];

let n = 0;
const ctx = { now: "2027-02-13T10:01:00.000Z", newId: () => `d${++n}` };

describe("Bestellung als Vorschlag", () => {
  it("übernimmt Kunde, Positionen und Beträge begrenzt", () => {
    const d = makeOrderDraft({ ...order, customer: { ...order.customer, name: "x".repeat(500) } }, ctx);
    expect(d).toMatchObject({ type: "bestellung", status: DRAFT_STATUS.open, source: "shop" });
    expect(d.payload.orderId).toBe(order.id);
    expect(d.payload.customer.name).toHaveLength(120);
    expect(d.payload.items[1]).toEqual({ articleNumber: "PRED-REVO", name: "Predator Revo", quantity: 2, price: 489 });
    expect(d.payload.total).toBe(1020.5);
  });

  it("lehnt Bestellungen ohne ID oder Positionen ab", () => {
    expect(() => makeOrderDraft({ ...order, id: "" }, ctx)).toThrow(/ID/);
    expect(() => makeOrderDraft({ ...order, items: [] }, ctx)).toThrow(/Positionen/);
  });

  it("übernimmt keine Position mit ungültigem Preis oder ungültiger Menge", () => {
    const line = order.items[0];
    for (const bad of [{ price: null }, { price: "abc" }, { price: -1 }, { quantity: 0 }, { quantity: 1.5 }, { quantity: "x" }]) {
      expect(() => makeOrderDraft({ ...order, items: [{ ...line, ...bad }] }, ctx)).toThrow(/ungültig/);
    }
    expect(makeOrderDraft({ ...order, items: [{ ...line, price: 0 }] }, ctx).payload.items[0].price).toBe(0);
  });
});

describe("Bestellung → Quittungsformular", () => {
  let id = 0;
  const form = orderToReceiptForm(makeOrderDraft(order, ctx).payload, {
    inventory,
    findArticle,
    isSerialTracked,
    makeItem: () => ({ id: `i${++id}`, description: "", amount: "", quantity: "1", kind: "service", productId: "", unitId: "", serial: "", articleNumber: "", discountPercent: "" }),
    today: "2027-02-13",
  });

  it("bucht Artikel aus dem Inventar mit dem bezahlten Preis", () => {
    const kreide = form.items.find((it) => it.productId === "p1");
    expect(kreide).toMatchObject({ kind: "product", quantity: "3", amount: "9.5", description: "Kreide blau" });
  });

  it("legt pro Exemplar eine Position an, wenn Seriennummern Pflicht sind", () => {
    const schaft = form.items.filter((it) => it.productId === "p2");
    expect(schaft).toHaveLength(2);
    expect(schaft.every((it) => it.quantity === "1" && it.unitId === "" && it.amount === "489")).toBe(true);
    expect(form.warnings.some((w) => /die 2 Exemplare wählen/.test(w))).toBe(true);
  });

  it("meldet Preisunterschied und unbekannte Artikel", () => {
    expect(form.warnings.some((w) => /bezahlt CHF 489.00, im Inventar CHF 499.00/.test(w))).toBe(true);
    const alt = form.items.find((it) => it.description === "Alter Artikel");
    expect(alt).toMatchObject({ kind: "service", productId: "", amount: "5" });
    expect(form.warnings.some((w) => /nicht im Inventar/.test(w))).toBe(true);
  });

  it("übernimmt Versand, Kunde mit Einverständnis und eine Notiz", () => {
    const total = form.items.reduce((s, it) => s + Number(it.amount) * Number(it.quantity), 0);
    expect(total).toBeCloseTo(order.total, 2);
    expect(form.items.at(-1)).toMatchObject({ description: "Versand", amount: "9", kind: "service" });
    expect(form.customer).toMatchObject({ name: "Marco Rossi", city: "Schaffhausen", emailConsent: { given: true, at: "2027-02-13" } });
    expect(form.deliveryMail).toBe(true);
    expect(form.note).toMatch(/Online-Bestellung Nr. 12 · bezahlt mit TWINT am .* · Versand/);
    expect(form.note).toMatch(/Bemerkung: Bitte klingeln/);
  });

  it("ohne «Quittung per E-Mail» kein Einverständnis", () => {
    const f = orderToReceiptForm(makeOrderDraft({ ...order, customer: { ...order.customer, receiptByEmail: false } }, ctx).payload, {
      inventory,
      findArticle,
      isSerialTracked,
      makeItem: () => ({}),
      today: "2027-02-13",
    });
    expect(f.customer.emailConsent).toBeNull();
    expect(f.deliveryMail).toBe(false);
  });
});

describe("Shop-Adresse", () => {
  it("leitet sich nur aus …/api/qwui/feed ab", () => {
    expect(shopBaseUrl("https://shop.munot-informatik.ch/api/qwui/feed")).toBe("https://shop.munot-informatik.ch");
    expect(shopBaseUrl("http://localhost:8788/api/qwui/feed/")).toBe("http://localhost:8788");
    expect(shopBaseUrl("https://shop.example.ch/qwui-feed")).toBeNull();
    expect(shopBaseUrl("http://shop.example.ch/api/qwui/feed")).toBeNull();
  });
});

// Kleiner Shop im Speicher, der wie shop/functions/api/qwui antwortet.
function fakeShop(orders) {
  const calls = [];
  let down = false;
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body, auth: options.headers?.Authorization });
    if (down) throw new Error("offline");
    const path = new URL(url).pathname;
    if (path === "/api/qwui/orders") {
      return { ok: true, status: 200, json: async () => ({ ok: true, orders: orders.filter((o) => !["gebucht", "verworfen"].includes(o.qwuiStatus)) }) };
    }
    const m = /^\/api\/qwui\/orders\/(.+)$/.exec(path);
    if (m) {
      const o = orders.find((x) => x.id === decodeURIComponent(m[1]));
      if (!o) return { ok: false, status: 404 };
      o.qwuiStatus = JSON.parse(options.body).status;
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 404 };
  };
  return { fetch, calls, setDown: (v) => (down = v) };
}

function setup(orders, config = {}) {
  const shop = fakeShop(orders);
  const state = { drafts: [], queue: [], status: null };
  const imp = createOrderImport({
    getConfig: () => ({ webhookEnabled: true, webhookUrl: "https://shop.example.ch/api/qwui/feed", ordersEnabled: true, ...config }),
    getToken: () => "geheim-geheim-geheim",
    readDrafts: () => state.drafts,
    addDrafts: async (list) => state.drafts.push(...list),
    readQueue: () => state.queue,
    writeQueue: (q) => (state.queue = q),
    readStatus: () => state.status,
    writeStatus: (s) => (state.status = s),
    fetch: shop.fetch,
    now: () => new Date("2027-02-13T10:05:00Z"),
    newId: () => `d${++n}`,
  });
  return { imp, shop, state };
}

describe("Bestellungen abholen", () => {
  it("legt neue Bestellungen einmal als Vorschlag an und meldet «abgeholt»", async () => {
    const orders = [structuredClone(order)];
    const { imp, shop, state } = setup(orders);
    await imp.poll();
    await imp.poll();
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0].payload.number).toBe(12);
    expect(orders[0].qwuiStatus).toBe("abgeholt");
    expect(shop.calls.every((c) => c.auth === "Bearer geheim-geheim-geheim")).toBe(true);
    // «abgeholt» nur einmal, nicht bei jeder Abholung
    expect(shop.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(state.status).toMatchObject({ ok: true, pending: 0 });
  });

  it("meldet «gebucht» mit Zeitpunkt und hält die Meldung bei Netzfehler fest", async () => {
    const orders = [structuredClone(order)];
    const { imp, shop, state } = setup(orders);
    await imp.poll();
    shop.setDown(true);
    state.drafts[0] = { ...state.drafts[0], status: DRAFT_STATUS.accepted, bookedAt: "2027-02-13T10:06:00.000Z" };
    await imp.report(order.id, "gebucht", "2027-02-13T10:06:00.000Z");
    expect(state.queue).toEqual([{ orderId: order.id, status: "gebucht", bookedAt: "2027-02-13T10:06:00.000Z" }]);
    await imp.poll();
    expect(state.status.ok).toBe(false);
    shop.setDown(false);
    await imp.poll();
    expect(orders[0].qwuiStatus).toBe("gebucht");
    expect(state.queue).toEqual([]);
    const last = shop.calls.filter((c) => c.method === "POST").at(-1);
    expect(JSON.parse(last.body)).toEqual({ status: "gebucht", bookedAt: "2027-02-13T10:06:00.000Z" });
  });

  it("meldet eine verlorene Entscheidung erneut, statt «abgeholt» zu schicken", async () => {
    const orders = [structuredClone(order)];
    const { imp, state } = setup(orders);
    await imp.poll();
    // Verworfen, aber die Meldung kam nie an (z. B. Absturz) — Warteschlange leer.
    state.drafts[0] = { ...state.drafts[0], status: DRAFT_STATUS.rejected };
    state.queue = [];
    await imp.poll();
    expect(orders[0].qwuiStatus).toBe("verworfen");
  });

  it("überspringt eine fehlerhafte Bestellung und holt die übrigen trotzdem ab", async () => {
    const bad = { ...structuredClone(order), id: "8f0c2a4e-0000-4000-8000-000000000002", number: 13, items: [] };
    const good = { ...structuredClone(order), id: "8f0c2a4e-0000-4000-8000-000000000003", number: 14 };
    const { imp, state } = setup([bad, good]);
    await imp.poll();
    expect(state.drafts.map((d) => d.payload.number)).toEqual([14]);
    expect(good.qwuiStatus).toBe("abgeholt");
    expect(bad.qwuiStatus).toBe(null);
    expect(state.status).toMatchObject({ ok: true, added: 1 });
    expect(state.status.warning).toMatch(/1 Bestellung\(en\) übersprungen: .*keine Positionen/);
  });

  it("verliert keine Meldung, die während des Sendens dazukommt", async () => {
    const state = { drafts: [], queue: [{ orderId: "a", status: "verworfen", bookedAt: null }], status: null };
    let release;
    const gate = new Promise((r) => (release = r));
    const imp = createOrderImport({
      getConfig: () => ({ webhookEnabled: true, webhookUrl: "https://shop.example.ch/api/qwui/feed", ordersEnabled: true }),
      getToken: () => "geheim-geheim-geheim",
      readDrafts: () => state.drafts,
      addDrafts: async () => {},
      readQueue: () => state.queue,
      writeQueue: (q) => (state.queue = q),
      readStatus: () => state.status,
      writeStatus: (st) => (state.status = st),
      // Der Shop ist nicht erreichbar; die erste Meldung hängt, bis wir sie freigeben.
      fetch: async () => {
        await gate;
        throw new Error("offline");
      },
    });
    const polling = imp.poll();
    const reporting = imp.report("b", "gebucht", "2027-02-13T10:06:00.000Z");
    release();
    await Promise.all([polling, reporting]);
    expect(state.queue.map((e) => e.orderId).sort()).toEqual(["a", "b"]);
  });

  it("tut nichts, wenn das Abholen aus ist oder die Adresse nicht passt", async () => {
    for (const config of [{ ordersEnabled: false }, { webhookUrl: "https://andere.example.ch/feed" }, { webhookEnabled: false }]) {
      const { imp, shop, state } = setup([structuredClone(order)], config);
      await imp.poll();
      expect(shop.calls).toHaveLength(0);
      expect(state.drafts).toHaveLength(0);
    }
  });

  it("meldet ein falsches Token verständlich", async () => {
    const { imp, state } = setup([]);
    const res401 = { ok: false, status: 401 };
    const imp2 = createOrderImport({
      ...{
        getConfig: () => ({ webhookEnabled: true, webhookUrl: "https://shop.example.ch/api/qwui/feed", ordersEnabled: true }),
        getToken: () => "x",
        readDrafts: () => [],
        addDrafts: async () => {},
        readQueue: () => [],
        writeQueue: () => {},
        readStatus: () => state.status,
        writeStatus: (s) => (state.status = s),
        fetch: async () => res401,
      },
    });
    await imp2.poll();
    expect(state.status).toMatchObject({ ok: false, error: "Der Shop lehnt das Token ab." });
    expect(imp).toBeTruthy();
  });
});
