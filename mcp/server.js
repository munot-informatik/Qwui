#!/usr/bin/env node
// MCP-Server für Claude Desktop: macht die lokale Schnittstelle der
// Qwui-Windows-Version als Werkzeuge verfügbar. Läuft auf demselben PC wie
// Qwui und spricht nur mit 127.0.0.1 — Qwui bleibt aus dem Internet
// unerreichbar.
//
// Einrichtung siehe README, Abschnitt «Assistent (Claude Desktop)». Kurz:
//   QWUI_API_URL    Adresse der Schnittstelle (Vorgabe http://127.0.0.1:47110)
//   QWUI_API_TOKEN  Token aus Qwui → Assistent
//
// Datenschutz: Qwui gibt über diese Werkzeuge keine Namen, Adressen,
// E-Mails oder Telefonnummern heraus, nur Kunden-IDs. Schreibende Werkzeuge
// legen Entwürfe an, die erst in Qwui mit «Übernehmen» gebucht werden.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.QWUI_API_URL || "http://127.0.0.1:47110").replace(/\/+$/, "");
const API_TOKEN = process.env.QWUI_API_TOKEN || "";

async function callQwui(tool, args) {
  let res;
  try {
    res = await fetch(`${API_URL}/v1/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(
      "Qwui ist nicht erreichbar. Läuft die Windows-App, und ist unter «Assistent» die lokale Schnittstelle eingeschaltet?"
    );
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Qwui lehnt das Token ab. Bitte das aktuelle Token aus Qwui → Assistent eintragen.");
  if (!res.ok || !body.ok) throw new Error(body.error || `Qwui antwortet mit HTTP ${res.status}.`);
  return body.result;
}

function asToolResult(fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: e.message || String(e) }] };
    }
  };
}

const server = new McpServer({ name: "qwui", version: "1.2.0" });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const draft = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

server.registerTool(
  "artikel_suchen",
  {
    title: "Artikel suchen",
    description:
      "Sucht Artikel im Inventar des Billard-Fachgeschäfts nach Name, Artikelnummer oder Produktgruppe. Liefert Artikelnummer, Name, Gruppe, Preis (CHF), Seriennummernpflicht und verfügbare Menge.",
    inputSchema: {
      suche: z.string().optional().describe("Suchbegriff (Teilwörter, z. B. «predator revo»); leer = alle"),
      gruppe: z.string().optional().describe("Produktgruppe, z. B. «Queues»"),
    },
    annotations: readOnly,
  },
  asToolResult((a) => callQwui("artikel_suchen", a))
);

server.registerTool(
  "bestand_abfragen",
  {
    title: "Bestand abfragen",
    description:
      "Bestand eines Artikels: verfügbare Menge und bei seriennummernpflichtigen Artikeln die Exemplare an Lager. Ist der Artikel nicht eindeutig, kommen Kandidaten zurück — dann mit Artikelnummer erneut fragen. Für «wie viele X haben wir» bei mehreren Artikeln besser artikel_suchen verwenden.",
    inputSchema: { artikel: z.string().describe("Artikelnummer (bevorzugt) oder genauer Artikelname") },
    annotations: readOnly,
  },
  asToolResult((a) => callQwui("bestand_abfragen", a))
);

server.registerTool(
  "seriennummer_suchen",
  {
    title: "Seriennummer suchen",
    description:
      "Garantiefall: Status eines Exemplars (an_lager, reserviert, verkauft, retourniert), Eingangs- und Verkaufsdatum, Quittungsnummer und Kunden-ID. Namen und Kontaktdaten des Kunden gibt Qwui bewusst nicht heraus — die Zuordnung der Kunden-ID macht der Laden in Qwui.",
    inputSchema: { seriennummer: z.string().describe("Seriennummer, Gross-/Kleinschreibung egal") },
    annotations: readOnly,
  },
  asToolResult((a) => callQwui("seriennummer_suchen", a))
);

server.registerTool(
  "umsatz_auswerten",
  {
    title: "Umsatz auswerten",
    description:
      "Umsatz in einem Zeitraum (nach Quittungsdatum, Grenzen inklusive): Summe in CHF, Anzahl Quittungen, offene Rechnungen und die zehn umsatzstärksten Artikel. Optional nur eine Produktgruppe.",
    inputSchema: {
      von: z.string().optional().describe("Startdatum JJJJ-MM-TT"),
      bis: z.string().optional().describe("Enddatum JJJJ-MM-TT"),
      gruppe: z.string().optional().describe("Produktgruppe, z. B. «Queues»"),
    },
    annotations: readOnly,
  },
  asToolResult((a) => callQwui("umsatz_auswerten", a))
);

server.registerTool(
  "ladenhueter",
  {
    title: "Ladenhüter finden",
    description:
      "Exemplare, die seit mindestens N Tagen an Lager liegen, und Artikel mit Bestand, die in dieser Zeit nicht verkauft wurden.",
    inputSchema: { tage: z.number().int().min(0).optional().describe("Tage seit Eingang bzw. letztem Verkauf (Vorgabe 90)") },
    annotations: readOnly,
  },
  asToolResult((a) => callQwui("ladenhueter", a))
);

server.registerTool(
  "wareneingang_vorschlagen",
  {
    title: "Wareneingang vorschlagen",
    description:
      "Legt einen ENTWURF für einen Wareneingang an. Gebucht wird erst, wenn jemand im Laden den Vorschlag in Qwui übernimmt — bitte das der Person so sagen. Bei seriennummernpflichtigen Artikeln die Seriennummern angeben, sonst die Menge.",
    inputSchema: {
      artikel: z.string().describe("Artikelnummer oder Artikelname"),
      menge: z.number().positive().optional().describe("Menge (bei Artikeln ohne Seriennummer)"),
      seriennummern: z.array(z.string()).optional().describe("Seriennummern der Exemplare"),
      einkaufspreis: z.number().min(0).optional().describe("Einkaufspreis pro Stück in CHF"),
      bemerkung: z.string().optional().describe("z. B. Lieferschein-Nummer"),
    },
    annotations: draft,
  },
  asToolResult((a) => callQwui("wareneingang_vorschlagen", a))
);

server.registerTool(
  "artikel_vorschlagen",
  {
    title: "Artikel vorschlagen",
    description:
      "Legt einen ENTWURF für einen neuen Artikel an (z. B. mit Text für den Online-Shop). Der Artikel entsteht erst, wenn jemand den Vorschlag in Qwui übernimmt.",
    inputSchema: {
      name: z.string().describe("Artikelname"),
      gruppe: z.string().optional().describe("Produktgruppe"),
      preis: z.number().min(0).describe("Verkaufspreis in CHF"),
      artikelnummer: z.string().optional(),
      seriennummernpflichtig: z.boolean().optional().describe("Einzelstücke mit Seriennummer, z. B. hochpreisige Queues"),
      shop_text: z.string().optional().describe("Beschreibung für den Online-Shop"),
    },
    annotations: draft,
  },
  asToolResult((a) => callQwui("artikel_vorschlagen", a))
);

server.registerTool(
  "backup_status",
  {
    title: "Backup-Status",
    description: "Zeitpunkt und Ergebnis der letzten stündlichen und täglichen Sicherung von Qwui.",
    inputSchema: {},
    annotations: readOnly,
  },
  asToolResult(() => callQwui("backup_status", {}))
);

await server.connect(new StdioServerTransport());
