// Lokale Schnittstelle für den Assistenten: Ohne Token kommt niemand an die
// Daten, aus dem Browser schon gar nicht, und jeder Zugriff steht im
// Protokoll. Schreibende Werkzeuge legen nur Entwürfe an.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createLocalApi } from "../desktop/localApi.js";
import { runAssistantTool, TOOL_NAMES } from "../shared/assistantTools.js";

const TOKEN = "test-token-abc";
const log = [];
const drafts = [];
let api;
let base;

const data = {
  inventory: [{ id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 3, serialTracked: true }],
  units: [
    { id: "u1", productId: "q", serial: "PR-1001", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" },
    { id: "u2", productId: "q", serial: "PR-1002", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" },
    { id: "u3", productId: "q", serial: "PR-1003", status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" },
  ],
  receipts: [],
  movements: [],
};

beforeAll(async () => {
  let n = 0;
  api = createLocalApi({
    getToken: () => TOKEN,
    toolNames: TOOL_NAMES,
    log: (e) => log.push(e),
    runTool: (name, args) =>
      runAssistantTool(name, args, {
        readData: async () => data,
        addDraft: async (d) => drafts.push(d),
        getBackupStatus: () => ({ aktiv: true }),
        now: () => new Date("2027-02-13T10:00:00.000Z"),
        newId: () => `d${++n}`,
      }),
  });
  const port = await api.start(0);
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => api.stop());
beforeEach(() => {
  log.length = 0;
  drafts.length = 0;
});

function call(tool, args, headers = {}) {
  return fetch(`${base}/v1/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(args || {}),
  });
}

describe("Zugriff", () => {
  it("beantwortet «Wie viele Predator-Queues haben wir an Lager?»", async () => {
    const res = await call("bestand_abfragen", { artikel: "PRED-REVO" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result).toMatchObject({ found: true, available: 3 });
    expect(log).toEqual([{ at: expect.any(String), tool: "bestand_abfragen", ok: true }]);
  });

  it("weist ohne oder mit falschem Token ab und protokolliert das", async () => {
    expect((await call("artikel_suchen", {}, { Authorization: "" })).status).toBe(401);
    expect((await call("artikel_suchen", {}, { Authorization: "Bearer falsch" })).status).toBe(401);
    expect(log.map((l) => [l.tool, l.ok, l.error])).toEqual([
      ["artikel_suchen", false, "Ungültiges Token"],
      ["artikel_suchen", false, "Ungültiges Token"],
    ]);
  });

  it("weist Anfragen aus dem Browser (Origin) ab", async () => {
    const res = await call("artikel_suchen", {}, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("weist fremde Host-Namen ab (DNS-Rebinding)", async () => {
    const port = new URL(base).port;
    const res = await new Promise((resolve) => {
      import("node:http").then(({ request }) => {
        const req = request({ host: "127.0.0.1", port, path: "/v1/health", headers: { Host: `evil.example:${port}`, Authorization: `Bearer ${TOKEN}` } }, resolve);
        req.end();
      });
    });
    expect(res.statusCode).toBe(403);
  });

  it("kennt nur die festen Werkzeuge", async () => {
    expect((await call("alles_loeschen", {})).status).toBe(404);
  });

  it("meldet Fehler im Werkzeug verständlich", async () => {
    const res = await call("umsatz_auswerten", { von: "13.02.2027" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JJJJ-MM-TT/);
    expect(log[0]).toMatchObject({ tool: "umsatz_auswerten", ok: false });
  });
});

describe("Entwürfe statt Buchungen", () => {
  it("legt einen Wareneingang nur als Entwurf an — der Bestand bleibt", async () => {
    const res = await call("wareneingang_vorschlagen", { artikel: "PRED-REVO", seriennummern: ["PR-2001", "PR-2002"] });
    const body = await res.json();
    expect(body.result).toMatchObject({ draftId: "d1", type: "wareneingang", status: "offen", quantity: 2 });
    expect(drafts).toHaveLength(1);
    expect(data.units).toHaveLength(3);
  });
});
