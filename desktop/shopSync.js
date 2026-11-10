// Shop-Abgleich der Windows-Version: Nach jeder Lagerbewegung und
// Preisänderung geht der Shop-Feed (shared/shopFeed.js) an die eingerichteten
// Ziele. Nur ausgehend — Qwui nimmt keine Verbindungen aus dem Internet an.
//
// Ziele sind Adapter mit derselben Form { id, label, target, push(feed, csv) }, damit
// sich später weitere Shops anbinden lassen (z. B. WooCommerce), ohne den
// Ablauf hier anzufassen. Heute:
//   - "datei":   JSON und CSV in einen Ordner (den der Shop oder ein
//                Sync-Werkzeug abholt)
//   - "webhook": HTTPS-POST an eine Adresse des Shops
//
// Scheitert ein Ziel, versucht Qwui es nach 1, 5 und 15 Minuten erneut; der
// Status jedes Ziels (letzter Abgleich, Fehler, nächster Versuch) ist in der
// App sichtbar. Unveränderte Feeds werden nicht erneut geschickt — ausser mit
// «Jetzt abgleichen».

import { mkdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
export const SHOP_WEBHOOK_TOKEN_SECRET = "shop-webhook-token";
export const FEED_JSON = "qwui-shop-feed.json";
export const FEED_CSV = "qwui-shop-feed.csv";

export const emptyShopConfig = {
  fileEnabled: false,
  fileDir: "",
  webhookEnabled: false,
  webhookUrl: "",
  ordersEnabled: false,
};

// Nur HTTPS — ausser zum eigenen PC (Test-Shop während der Entwicklung).
export function validateWebhookUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch (e) {
    return "Die Webhook-Adresse ist keine gültige URL.";
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    return "Die Webhook-Adresse muss mit https:// beginnen.";
  }
  if (parsed.username || parsed.password) {
    return "Zugangsdaten gehören nicht in die Adresse — bitte das Token-Feld verwenden.";
  }
  return null;
}

export function fileAdapter(dir) {
  return {
    id: "datei",
    label: "Datei-Feed",
    target: String(dir),
    async push(feed, csv) {
      if (!existsSync(dir)) throw new Error(`Der Ordner ${dir} ist nicht erreichbar.`);
      // Erst vollständig schreiben, dann umbenennen: der Shop liest nie eine
      // halbe Datei.
      for (const [name, content] of [
        [FEED_JSON, JSON.stringify(feed, null, 2)],
        [FEED_CSV, csv],
      ]) {
        const target = join(dir, name);
        writeFileSync(`${target}.tmp`, content, "utf8");
        renameSync(`${target}.tmp`, target);
      }
    },
  };
}

export function webhookAdapter(url, token, fetchImpl = globalThis.fetch) {
  return {
    id: "webhook",
    label: "Webhook",
    target: String(url).trim(),
    async push(feed) {
      const problem = validateWebhookUrl(url);
      if (problem) throw new Error(problem);
      const headers = { "Content-Type": "application/json", "User-Agent": "Qwui-Shop-Feed" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(String(url).trim(), {
        method: "POST",
        headers,
        body: JSON.stringify(feed),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!res.ok) throw new Error(`Der Shop antwortet mit HTTP ${res.status}.`);
    },
  };
}

// deps: { buildFeed: async () => ({ feed, csv, fingerprint }), getConfig, getToken,
//         readStatus, writeStatus, fetch?, setTimer?, clearTimer?, debounceMs?, now? }
export function createShopSync({
  buildFeed,
  getConfig,
  getToken,
  readStatus,
  writeStatus,
  fetch: fetchImpl = globalThis.fetch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = 2000,
  now = () => new Date(),
}) {
  let debounce = null;
  const retryTimers = {};

  function adapters() {
    const config = { ...emptyShopConfig, ...(getConfig() || {}) };
    const list = [];
    if (config.fileEnabled && config.fileDir) list.push(fileAdapter(config.fileDir));
    if (config.webhookEnabled && config.webhookUrl) list.push(webhookAdapter(config.webhookUrl, getToken(), fetchImpl));
    return list;
  }

  function update(id, entry) {
    const status = readStatus() || {};
    const next = { ...status, [id]: { ...(status[id] || {}), ...entry } };
    writeStatus(next);
    return next;
  }

  async function syncAdapter(adapter, built, { force, attempt = 0 }) {
    const previous = (readStatus() || {})[adapter.id];
    // Unverändert = gleicher Inhalt UND gleiches Ziel. Ein neuer Ordner oder
    // eine neue Webhook-Adresse bekommt den Feed sofort, auch ohne Änderung.
    if (!force && previous?.ok && previous.fingerprint === built.fingerprint && previous.target === adapter.target) return;
    if (retryTimers[adapter.id]) {
      clearTimer(retryTimers[adapter.id]);
      delete retryTimers[adapter.id];
    }
    const at = now().toISOString();
    try {
      await adapter.push(built.feed, built.csv);
      update(adapter.id, {
        ok: true,
        at,
        lastSuccessAt: at,
        fingerprint: built.fingerprint,
        target: adapter.target,
        error: null,
        nextRetryAt: null,
        items: built.feed.items.length,
      });
    } catch (e) {
      const delay = RETRY_DELAYS_MS[attempt];
      const nextRetryAt = delay != null ? new Date(now().getTime() + delay).toISOString() : null;
      update(adapter.id, { ok: false, at, error: e.message || String(e), nextRetryAt });
      if (delay != null) {
        retryTimers[adapter.id] = setTimer(async () => {
          delete retryTimers[adapter.id];
          // Mit dem dann aktuellen Stand, nicht dem von vor ein paar Minuten.
          const fresh = await buildFeed();
          const target = adapters().find((a) => a.id === adapter.id);
          if (target) await syncAdapter(target, fresh, { force: true, attempt: attempt + 1 });
        }, delay);
      }
    }
  }

  async function sync(force) {
    const list = adapters();
    if (list.length === 0) return readStatus() || {};
    const built = await buildFeed();
    for (const adapter of list) await syncAdapter(adapter, built, { force });
    return readStatus() || {};
  }

  return {
    // Nach Änderungen: gebündelt, damit zehn schnelle Buchungen einen Abgleich auslösen.
    trigger() {
      if (debounce) clearTimer(debounce);
      debounce = setTimer(() => {
        debounce = null;
        sync(false).catch((e) => console.error("Shop-Abgleich fehlgeschlagen", e));
      }, debounceMs);
    },
    syncNow: () => sync(true),
  };
}
