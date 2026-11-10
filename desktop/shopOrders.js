// Bestellungen aus dem Online-Shop abholen (nur Desktop). Wie der Shop-Feed
// geht auch das nur von Qwui hinaus: Qwui fragt den Shop regelmässig nach
// bezahlten Bestellungen und legt jede als Vorschlag «Bestellung» an.
// Gebucht wird erst mit «Übernehmen» in der App (als Quittung).
//
// Rückmeldungen an den Shop (abgeholt / gebucht / verworfen) gehen über eine
// Warteschlange: Ist der Shop gerade nicht erreichbar, werden sie beim
// nächsten Abholen nachgeholt — der Shop hält die Ware so lange zurück.
//
// Der Shop gehört zum Qwui-Shop (Ordner shop/): Die Adressen leiten sich von
// der Webhook-Adresse …/api/qwui/feed ab, das Token ist dasselbe.

import { validateWebhookUrl } from "./shopSync.js";
import { makeOrderDraft, DRAFT_TYPE, DRAFT_STATUS } from "./shared/drafts.js";

export const ORDER_POLL_MS = 60 * 1000;
const FEED_PATH = /\/api\/qwui\/feed\/?$/;

// Basisadresse des Shops aus der Webhook-Adresse, oder null.
export function shopBaseUrl(webhookUrl) {
  const url = String(webhookUrl || "").trim();
  if (!FEED_PATH.test(url) || validateWebhookUrl(url)) return null;
  return url.replace(FEED_PATH, "");
}

// deps: { getConfig, getToken, readDrafts, addDraft, readQueue, writeQueue,
//         readStatus, writeStatus, fetch?, now?, newId? }
export function createOrderImport({
  getConfig,
  getToken,
  readDrafts,
  addDraft,
  readQueue,
  writeQueue,
  readStatus,
  writeStatus,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  newId,
}) {
  let running = null;

  function base() {
    const config = getConfig() || {};
    if (!config.ordersEnabled || !config.webhookEnabled) return null;
    return shopBaseUrl(config.webhookUrl);
  }

  function headers() {
    const h = { "User-Agent": "Qwui-Bestellungen", Accept: "application/json" };
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function request(url, options = {}) {
    return fetchImpl(url, { ...options, headers: { ...headers(), ...(options.headers || {}) }, signal: AbortSignal.timeout(15000), redirect: "error" });
  }

  // Rückmeldungen senden. Endgültige Antworten (ok, 404 unbekannt, 409 schon
  // entschieden) entfernen den Eintrag; Netz- und Serverfehler lassen ihn stehen.
  async function flush(shop) {
    const queue = readQueue() || [];
    if (queue.length === 0) return;
    const rest = [];
    for (const entry of queue) {
      try {
        const res = await request(`${shop}/api/qwui/orders/${encodeURIComponent(entry.orderId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: entry.status, bookedAt: entry.bookedAt || undefined }),
        });
        if (!(res.ok || res.status === 404 || res.status === 409)) rest.push(entry);
      } catch {
        rest.push(entry);
      }
    }
    writeQueue(rest);
  }

  function enqueue(orderId, status, bookedAt = null) {
    // Pro Bestellung zählt nur die letzte Meldung.
    const queue = (readQueue() || []).filter((e) => e.orderId !== orderId);
    writeQueue([...queue, { orderId, status, bookedAt }]);
  }

  async function pollOnce() {
    const shop = base();
    if (!shop) return readStatus() || {};
    const at = now().toISOString();
    try {
      await flush(shop);
      const res = await request(`${shop}/api/qwui/orders`);
      if (!res.ok) throw new Error(res.status === 401 ? "Der Shop lehnt das Token ab." : `Der Shop antwortet mit HTTP ${res.status}.`);
      const data = await res.json();
      // Massgebend ist der Vorschlag in Qwui: Listet der Shop eine Bestellung
      // noch, obwohl sie hier schon entschieden ist (Meldung ging verloren),
      // wird die Entscheidung erneut gemeldet.
      const drafts = new Map(readDrafts().filter((d) => d.type === DRAFT_TYPE.order).map((d) => [d.payload.orderId, d]));
      const queued = () => new Set((readQueue() || []).map((e) => e.orderId));
      let added = 0;
      for (const order of Array.isArray(data.orders) ? data.orders : []) {
        const draft = drafts.get(order.id);
        if (!draft) {
          const created = makeOrderDraft(order, { now: now().toISOString(), newId });
          await addDraft(created);
          drafts.set(order.id, created);
          added++;
          if (order.qwuiStatus !== "abgeholt") enqueue(order.id, "abgeholt");
        } else if (draft.status === DRAFT_STATUS.accepted) {
          enqueue(order.id, "gebucht", draft.bookedAt || draft.decidedAt);
        } else if (draft.status === DRAFT_STATUS.rejected) {
          enqueue(order.id, "verworfen");
        } else if (order.qwuiStatus !== "abgeholt" && !queued().has(order.id)) {
          enqueue(order.id, "abgeholt");
        }
      }
      await flush(shop);
      const status = { ok: true, at, lastSuccessAt: at, error: null, added, pending: (readQueue() || []).length };
      writeStatus(status);
      return status;
    } catch (e) {
      const status = { ...(readStatus() || {}), ok: false, at, error: e.message || String(e) };
      writeStatus(status);
      return status;
    }
  }

  return {
    // Nie zwei Abholungen gleichzeitig (Timer und «Jetzt abgleichen»).
    poll() {
      if (!running) running = pollOnce().finally(() => (running = null));
      return running;
    },
    // Aus der App: Bestellung gebucht (als Quittung) oder verworfen.
    async report(orderId, status, bookedAt) {
      enqueue(orderId, status, bookedAt);
      const shop = base();
      if (shop) await flush(shop).catch(() => {});
    },
  };
}
