// MCP-Server: Startet mcp/server.js genau so, wie Claude Desktop es tut
// (Kindprozess, stdio), und spricht ihn mit dem offiziellen MCP-Client an.
// Dahinter läuft die echte lokale API mit Testdaten.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createLocalApi } from "../desktop/localApi.js";
import { runAssistantTool, TOOL_NAMES } from "../shared/assistantTools.js";

// Das SDK ist eine Abhängigkeit von mcp/, nicht vom Projekt-Root.
const mcpRequire = createRequire(new URL("../mcp/package.json", import.meta.url));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire("@modelcontextprotocol/sdk/client/stdio.js");

const TOKEN = "mcp-test-token";
const drafts = [];
let api;
let client;

const data = {
  inventory: [
    { id: "q", articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, stock: 3, serialTracked: true },
    { id: "k", articleNumber: "KR-01", name: "Kreide", group: "Zubehör", price: 4, stock: 40 },
  ],
  units: ["PR-1001", "PR-1002", "PR-1003"].map((serial, i) => ({ id: `u${i}`, productId: "q", serial, status: "an_lager", receivedAt: "2027-02-01T09:00:00.000Z" })),
  receipts: [],
  movements: [],
};

beforeAll(async () => {
  api = createLocalApi({
    getToken: () => TOKEN,
    toolNames: TOOL_NAMES,
    log: () => {},
    runTool: (name, args) =>
      runAssistantTool(name, args, {
        readData: async () => data,
        addDraft: async (d) => drafts.push(d),
        getBackupStatus: () => ({ aktiv: false, hinweis: "Ohne Backup-Passwort wird nicht gesichert." }),
        now: () => new Date("2027-02-13T10:00:00.000Z"),
        newId: () => "d1",
      }),
  });
  const port = await api.start(0);
  client = new Client({ name: "qwui-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../mcp/server.js", import.meta.url))],
      env: { ...process.env, QWUI_API_URL: `http://127.0.0.1:${port}`, QWUI_API_TOKEN: TOKEN },
    })
  );
}, 20000);

afterAll(async () => {
  await client?.close();
  await api?.stop();
});

function textOf(result) {
  return result.content.map((c) => c.text).join("");
}

describe("MCP-Server", () => {
  it("meldet alle acht Werkzeuge", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("beantwortet «Wie viele Predator-Queues haben wir an Lager?»", async () => {
    const result = await client.callTool({ name: "artikel_suchen", arguments: { suche: "predator" } });
    const body = JSON.parse(textOf(result));
    expect(body.artikel).toEqual([
      { articleNumber: "PRED-REVO", name: "Predator Revo", group: "Queues", price: 890, serialTracked: true, available: 3 },
    ]);
  });

  it("legt «Erfasse einen Wareneingang …» nur als Entwurf an", async () => {
    const result = await client.callTool({
      name: "wareneingang_vorschlagen",
      arguments: { artikel: "PRED-REVO", seriennummern: ["PR-2001", "PR-2002"], bemerkung: "Lieferung Februar" },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({ draftId: "d1", status: "offen", quantity: 2 });
    expect(drafts).toHaveLength(1);
    expect(data.units).toHaveLength(3);
  });

  it("gibt Fehler von Qwui als Werkzeug-Fehler weiter", async () => {
    const result = await client.callTool({ name: "bestand_abfragen", arguments: { artikel: "" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Artikel fehlt/);
  });
});
