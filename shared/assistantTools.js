// Die Werkzeuge, die der Assistent über die lokale API aufrufen kann. Name,
// Beschreibung und Parameter stehen hier an einer Stelle; der MCP-Server
// (mcp/server.js) meldet sie Claude, die lokale API (desktop/localApi.js)
// führt sie aus.
//
// Lesend: Auswertungen aus shared/reports.js — ohne Personendaten.
// Schreibend: nur Entwürfe (shared/drafts.js), gebucht wird erst in der App.

import { searchArticles, stockReport, serialReport, salesReport, slowMovers } from "./reports.js";
import { makeGoodsInDraft, makeArticleDraft, draftSummary } from "./drafts.js";

export const TOOL_NAMES = [
  "artikel_suchen",
  "bestand_abfragen",
  "seriennummer_suchen",
  "umsatz_auswerten",
  "ladenhueter",
  "wareneingang_vorschlagen",
  "artikel_vorschlagen",
  "backup_status",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireString(args, key, label) {
  const v = String(args?.[key] ?? "").trim();
  if (!v) throw new Error(`${label} fehlt.`);
  return v;
}

// deps: { readData: async () => ({ inventory, units, receipts, movements }),
//         addDraft: async (draft) => void, getBackupStatus: () => object,
//         now: () => Date, newId: () => string }
export async function runAssistantTool(name, args, deps) {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "artikel_suchen": {
      const { inventory, units } = await deps.readData();
      const results = searchArticles(inventory, units, { query: a.suche || "", group: a.gruppe || "" });
      return { anzahl: results.length, artikel: results.slice(0, 50) };
    }
    case "bestand_abfragen": {
      const { inventory, units } = await deps.readData();
      return stockReport(inventory, units, requireString(a, "artikel", "Artikel"));
    }
    case "seriennummer_suchen": {
      const { inventory, units } = await deps.readData();
      return serialReport(units, inventory, requireString(a, "seriennummer", "Seriennummer"));
    }
    case "umsatz_auswerten": {
      for (const key of ["von", "bis"]) {
        if (a[key] && !ISO_DATE.test(a[key])) throw new Error(`«${key}» bitte als JJJJ-MM-TT angeben.`);
      }
      const { inventory, receipts } = await deps.readData();
      return salesReport(receipts, inventory, { from: a.von, to: a.bis, group: a.gruppe || "" });
    }
    case "ladenhueter": {
      const days = a.tage == null ? 90 : Number(a.tage);
      if (!Number.isFinite(days) || days < 0) throw new Error("«tage» muss eine Zahl ab 0 sein.");
      const { inventory, units, movements } = await deps.readData();
      return slowMovers(inventory, units, movements, { days, now: deps.now() });
    }
    case "wareneingang_vorschlagen": {
      const draft = makeGoodsInDraft(
        { article: a.artikel, quantity: a.menge, serials: a.seriennummern, purchasePrice: a.einkaufspreis, note: a.bemerkung },
        { now: deps.now().toISOString(), newId: deps.newId }
      );
      await deps.addDraft(draft);
      return { ...draftSummary(draft), hinweis: "Entwurf angelegt — gebucht wird erst nach «Übernehmen» in Qwui." };
    }
    case "artikel_vorschlagen": {
      const draft = makeArticleDraft(
        {
          name: a.name,
          articleNumber: a.artikelnummer,
          group: a.gruppe,
          price: a.preis,
          serialTracked: a.seriennummernpflichtig === true,
          shopText: a.shop_text,
        },
        { now: deps.now().toISOString(), newId: deps.newId }
      );
      await deps.addDraft(draft);
      return { ...draftSummary(draft), hinweis: "Entwurf angelegt — der Artikel entsteht erst nach «Übernehmen» in Qwui." };
    }
    case "backup_status":
      return deps.getBackupStatus();
    default:
      throw new Error(`Unbekanntes Werkzeug: ${name}`);
  }
}
