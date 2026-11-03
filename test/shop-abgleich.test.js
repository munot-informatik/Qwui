// Shop-Abgleich: Der Feed muss bei jedem Ziel ankommen, ein Ausfall des Shops
// darf nichts verlieren (Wiederholung), und unveränderte Bestände sollen den
// Shop nicht bei jeder Kleinigkeit erneut beschäftigen.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShopSync, validateWebhookUrl, RETRY_DELAYS_MS, FEED_JSON, FEED_CSV } from "../desktop/shopSync.js";
import { buildShopFeed, shopFeedCsv, feedFingerprint } from "../shared/shopFeed.js";

let server;
let baseUrl;
const requests = [];
let failNext = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, auth: req.headers.authorization, body: JSON.parse(body || "null") });
      if (failNext > 0) {
        failNext--;
        res.writeHead(503).end();
      } else {
        res.writeHead(204).end();
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}/qwui-feed`;
});
afterAll(() => new Promise((r) => server.close(r)));

let dir;
let status;
let stock;
let timers;

beforeEach(() => {
  requests.length = 0;
  failNext = 0;
  dir = mkdtempSync(join(tmpdir(), "qwui-shop-"));
  status = null;
  stock = 3;
  timers = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function sync(config, overrides = {}) {
  return createShopSync({
    buildFeed: async () => {
      const feed = buildShopFeed([{ id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock }], []);
      return { feed, csv: shopFeedCsv(feed), fingerprint: feedFingerprint(feed) };
    },
    getConfig: () => config,
    getToken: () => "shop-token-123",
    readStatus: () => status,
    writeStatus: (s) => (status = s),
    // Zeitgeber von Hand auslösen statt Minuten zu warten.
    setTimer: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    clearTimer: () => {},
    ...overrides,
  });
}

describe("Datei-Feed", () => {
  it("schreibt JSON und CSV in den Ordner", async () => {
    await sync({ fileEnabled: true, fileDir: dir }).syncNow();
    expect(JSON.parse(readFileSync(join(dir, FEED_JSON), "utf8")).items[0]).toMatchObject({ articleNumber: "PRED-REVO", available: 3 });
    expect(readFileSync(join(dir, FEED_CSV), "utf8")).toContain("PRED-REVO;Predator Revo;Queues;890.00;3;verfügbar");
    expect(status.datei).toMatchObject({ ok: true, items: 1 });
  });

  it("meldet einen fehlenden Ordner", async () => {
    await sync({ fileEnabled: true, fileDir: join(dir, "fehlt") }).syncNow();
    expect(status.datei.ok).toBe(false);
    expect(status.datei.error).toMatch(/nicht erreichbar/);
    expect(existsSync(join(dir, "fehlt"))).toBe(false);
  });
});

describe("Webhook", () => {
  it("sendet den Feed per POST mit Token", async () => {
    await sync({ webhookEnabled: true, webhookUrl: baseUrl }).syncNow();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", auth: "Bearer shop-token-123" });
    expect(requests[0].body.items[0]).toMatchObject({ articleNumber: "PRED-REVO", available: 3 });
    expect(status.webhook).toMatchObject({ ok: true, error: null });
  });

  it("versucht es nach einem Fehler nach 1, 5 und 15 Minuten erneut", async () => {
    failNext = 2;
    const s = sync({ webhookEnabled: true, webhookUrl: baseUrl });
    await s.syncNow();
    expect(status.webhook).toMatchObject({ ok: false, error: "Der Shop antwortet mit HTTP 503." });
    expect(status.webhook.nextRetryAt).not.toBeNull();
    expect(timers.map((t) => t.ms)).toEqual([RETRY_DELAYS_MS[0]]);

    await timers[0].fn();
    expect(timers.map((t) => t.ms)).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    stock = 2; // in der Zwischenzeit verkauft
    await timers[1].fn();
    expect(status.webhook.ok).toBe(true);
    expect(requests.at(-1).body.items[0].available).toBe(2);
  });

  it("gibt nach drei Wiederholungen auf und zeigt den Fehler", async () => {
    failNext = 10;
    const s = sync({ webhookEnabled: true, webhookUrl: baseUrl });
    await s.syncNow();
    for (let i = 0; i < 3; i++) await timers[i].fn();
    expect(timers).toHaveLength(3);
    expect(status.webhook).toMatchObject({ ok: false, nextRetryAt: null });
  });

  it("akzeptiert nur HTTPS (ausser zum eigenen PC)", () => {
    expect(validateWebhookUrl("https://shop.example.ch/qwui")).toBeNull();
    expect(validateWebhookUrl("http://127.0.0.1:8080/feed")).toBeNull();
    expect(validateWebhookUrl("http://shop.example.ch/qwui")).toMatch(/https/);
    expect(validateWebhookUrl("https://user:pw@shop.example.ch")).toMatch(/Zugangsdaten/);
    expect(validateWebhookUrl("kein url")).toMatch(/gültige/);
  });
});

describe("Auslösen nach Änderungen", () => {
  it("bündelt schnelle Änderungen und schickt Unverändertes nicht erneut", async () => {
    const s = sync({ webhookEnabled: true, webhookUrl: baseUrl });
    s.trigger();
    s.trigger();
    s.trigger();
    expect(timers).toHaveLength(3);
    await timers.at(-1).fn();
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(1);

    s.trigger();
    await timers.at(-1).fn();
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(1); // gleicher Bestand → kein zweiter Versand

    stock = 2;
    s.trigger();
    await timers.at(-1).fn();
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(2);
  });

  it("beliefert einen neuen Ordner sofort, auch wenn sich der Bestand nicht geändert hat", async () => {
    const config = { fileEnabled: true, fileDir: dir };
    const s = sync(config);
    await s.syncNow();
    const other = mkdtempSync(join(tmpdir(), "qwui-shop-neu-"));
    try {
      config.fileDir = other;
      s.trigger();
      await timers.at(-1).fn();
      await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(join(other, FEED_JSON))).toBe(true);
      expect(status.datei.target).toBe(other);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("tut nichts, solange kein Ziel eingerichtet ist", async () => {
    await sync({}).syncNow();
    expect(requests).toHaveLength(0);
    expect(status).toBeNull();
  });
});
