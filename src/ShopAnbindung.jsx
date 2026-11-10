// Reiter «Shop-Anbindung» (nur Windows-Version): wohin der Shop-Feed geht,
// letzter Abgleich je Ziel und eine Vorschau genau dessen, was der Shop
// bekommt. Abgeglichen wird im Electron-Hauptprozess (desktop/shopSync.js),
// automatisch nach jeder Lagerbewegung und Preisänderung.

import React, { useEffect, useState } from "react";
import { Check, FolderOpen, RefreshCw } from "lucide-react";
import { isQwuiShopFeedUrl } from "../shared/shopOrders.js";

function formatDateTimeDE(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function chf(n) {
  return (Number(n) || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TARGETS = [
  ["datei", "Datei-Feed"],
  ["webhook", "Webhook"],
];

export default function ShopAnbindung() {
  const api = window.qwuiDesktop?.shop;
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  function apply(next) {
    setState(next);
    setConfig(next.config);
  }

  useEffect(() => {
    if (!api) return;
    api.getState().then(apply);
    // Abgleiche laufen im Hintergrund — Status regelmässig nachführen.
    const timer = setInterval(() => api.getState().then(setState), 15 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!api || !state || !config) return null;

  async function save() {
    setBusy(true);
    setMessage(null);
    let result;
    try {
      result = await api.saveConfig(config, removeToken ? "" : token || null);
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    apply(result);
    setToken("");
    setRemoveToken(false);
    setMessage({ kind: "ok", text: "Gespeichert." });
  }

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      apply(await api.syncNow());
    } catch (e) {
      setMessage({ kind: "error", text: e.message || String(e) });
    }
    setBusy(false);
  }

  const anyTarget = (state.config.fileEnabled && state.config.fileDir) || (state.config.webhookEnabled && state.config.webhookUrl);
  const items = state.feed.items;

  return (
    <div>
      <div style={s.intro}>
        Nach jeder Lagerbewegung und Preisänderung geht ein aktueller Feed an den Shop: pro Artikel
        Artikelnummer, Name, Produktgruppe, Preis, verfügbare Menge und Status. Seriennummern und
        Einkaufspreise bleiben in Qwui. Die Verbindung geht nur von Qwui hinaus — aus dem Internet
        ist Qwui nicht erreichbar.
      </div>

      <div style={s.section}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={config.fileEnabled} onChange={(e) => setConfig({ ...config, fileEnabled: e.target.checked })} />
          <strong>Datei-Feed</strong> — JSON und CSV in einen Ordner schreiben
        </label>
        {config.fileEnabled && (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={config.fileDir}
              onChange={(e) => setConfig({ ...config, fileDir: e.target.value })}
              placeholder="Ordner"
              style={{ flex: 1 }}
              aria-label="Ordner für den Datei-Feed"
            />
            <button
              type="button"
              style={s.secondaryBtn}
              onClick={async () => {
                const dir = await api.chooseDir();
                if (dir) setConfig({ ...config, fileDir: dir });
              }}
            >
              <FolderOpen size={14} /> Wählen…
            </button>
          </div>
        )}
      </div>

      <div style={s.section}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={config.webhookEnabled} onChange={(e) => setConfig({ ...config, webhookEnabled: e.target.checked })} />
          <strong>Webhook</strong> — Feed per HTTPS an den Shop senden
        </label>
        {config.webhookEnabled && (
          <>
            <input
              value={config.webhookUrl}
              onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
              placeholder="https://shop.example.ch/qwui-feed"
              aria-label="Webhook-Adresse"
            />
            <input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setRemoveToken(false);
              }}
              placeholder={state.tokenSet ? "Token gespeichert — nur zum Ändern eingeben" : "Token (optional, wird als Bearer mitgeschickt)"}
              autoComplete="new-password"
              aria-label="Webhook-Token"
            />
            {state.tokenSet && (
              <label style={s.checkLabel}>
                <input type="checkbox" checked={removeToken} onChange={(e) => setRemoveToken(e.target.checked)} />
                Gespeichertes Token entfernen
              </label>
            )}
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={!!config.ordersEnabled}
                onChange={(e) => setConfig({ ...config, ordersEnabled: e.target.checked })}
              />
              <strong>Bestellungen abholen</strong> — bezahlte Online-Bestellungen erscheinen unter «Vorschläge»
            </label>
            {config.ordersEnabled && !isQwuiShopFeedUrl(config.webhookUrl) && (
              <div style={s.hint}>Nur mit dem Qwui-Shop: Die Webhook-Adresse endet dann auf /api/qwui/feed.</div>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" onClick={save} disabled={busy} style={s.secondaryBtn}>
          <Check size={14} /> Speichern
        </button>
        <button
          type="button"
          onClick={syncNow}
          disabled={busy || !anyTarget}
          style={{ ...s.primaryBtn, opacity: busy || !anyTarget ? 0.4 : 1 }}
        >
          <RefreshCw size={14} /> {busy ? "Gleiche ab…" : "Jetzt abgleichen"}
        </button>
      </div>
      {message && <div style={message.kind === "ok" ? s.ok : s.error}>{message.text}</div>}

      <div style={s.statusBox}>
        {TARGETS.map(([id, label]) => {
          const st = state.status[id];
          const active = id === "datei" ? state.config.fileEnabled : state.config.webhookEnabled;
          return (
            <div key={id} style={s.statusRow}>
              <span style={{ width: 90, fontWeight: 600 }}>{label}</span>
              <span style={{ flex: 1 }}>
                {!active
                  ? "nicht eingerichtet"
                  : st?.lastSuccessAt
                    ? `letzter Abgleich ${formatDateTimeDE(st.lastSuccessAt)} (${st.items} Artikel)`
                    : "noch kein Abgleich"}
                {active && st && !st.ok && (
                  <div style={{ color: "#B5480C" }}>
                    Fehler am {formatDateTimeDE(st.at)}: {st.error}
                    {st.nextRetryAt ? ` — neuer Versuch um ${formatDateTimeDE(st.nextRetryAt).slice(-5)}` : " — keine weiteren Versuche, bitte «Jetzt abgleichen»"}
                  </div>
                )}
              </span>
            </div>
          );
        })}
        {state.config.ordersEnabled && (
          <div style={s.statusRow}>
            <span style={{ width: 90, fontWeight: 600 }}>Bestellungen</span>
            <span style={{ flex: 1 }}>
              {state.orders?.lastSuccessAt
                ? `zuletzt abgeholt ${formatDateTimeDE(state.orders.lastSuccessAt)}${state.orders.pending ? ` — ${state.orders.pending} Rückmeldung(en) an den Shop ausstehend` : ""}`
                : "noch nicht abgeholt"}
              {state.orders?.ok && state.orders.warning && (
                <div style={{ color: "#B5480C" }}>{state.orders.warning} — bitte im Shop unter /admin prüfen.</div>
              )}
              {state.orders && !state.orders.ok && (
                <div style={{ color: "#B5480C" }}>
                  Fehler am {formatDateTimeDE(state.orders.at)}: {state.orders.error} — neuer Versuch in einer Minute
                </div>
              )}
            </span>
          </div>
        )}
      </div>

      <div style={{ ...s.fieldLabel, marginTop: 28 }}>Vorschau: so sieht der Shop den Bestand</div>
      {items.length === 0 ? (
        <div style={s.empty}>Noch keine Artikel im Inventar.</div>
      ) : (
        <div>
          <div style={s.head}>
            <span style={{ width: 130 }}>Artikelnr.</span>
            <span style={{ flex: 1 }}>Name</span>
            <span style={{ width: 120 }}>Gruppe</span>
            <span style={{ width: 90, textAlign: "right" }}>Preis</span>
            <span style={{ width: 70, textAlign: "right" }}>Menge</span>
            <span style={{ width: 100 }}>Status</span>
          </div>
          {items.map((it, i) => (
            <div key={`${it.articleNumber}-${i}`} style={s.row}>
              <span className="mono" style={{ width: 130 }}>{it.articleNumber || "—"}</span>
              <span style={{ flex: 1 }}>{it.name}</span>
              <span style={{ width: 120 }}>{it.group}</span>
              <span className="mono" style={{ width: 90, textAlign: "right" }}>{chf(it.price)}</span>
              <span className="mono" style={{ width: 70, textAlign: "right" }}>{it.available}</span>
              <span style={{ width: 100, color: it.status === "verfügbar" ? "#155C2C" : "#8A1620" }}>{it.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  intro: { fontSize: 13, color: "#5B5F66", marginBottom: 20, maxWidth: 560 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#5B5F66", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  section: { display: "grid", gap: 8, padding: "12px 0", borderBottom: "1px solid #EDEEEF", maxWidth: 560 },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#16181D" },
  hint: { fontSize: 12, color: "#B5480C" },
  secondaryBtn: {
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  primaryBtn: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  ok: { fontSize: 12, color: "#1D7A3C", marginTop: 8 },
  error: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 8, maxWidth: 560 },
  statusBox: { border: "1px solid #E4E5E7", background: "#fff", padding: "6px 12px", marginTop: 16, maxWidth: 560 },
  statusRow: { display: "flex", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid #F1F1EF" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "12px 0" },
  head: {
    display: "flex",
    gap: 8,
    padding: "4px 0",
    fontSize: 11,
    fontWeight: 600,
    color: "#8B8F96",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: "1px solid #E4E5E7",
  },
  row: { display: "flex", gap: 8, padding: "6px 0", fontSize: 13, borderBottom: "1px solid #F1F1EF" },
};
