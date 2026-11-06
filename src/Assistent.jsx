// Reiter «Assistent» (nur Windows-Version):
// - Vorschläge des Assistenten: Entwürfe aus Claude, die erst mit
//   «Übernehmen» gebucht werden (die Buchung selbst macht App.jsx).
// - Lokale Schnittstelle: ein/aus, Port, Zugriffstoken und die Zeilen für
//   Claude Desktop.
// - Protokoll: jeder Zugriff des Assistenten mit Zeit, Werkzeug und Ergebnis.

import React, { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";

function formatDateTimeDE(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function chf(n) {
  return (Number(n) || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TOOL_LABEL = {
  artikel_suchen: "Artikel suchen",
  bestand_abfragen: "Bestand abfragen",
  seriennummer_suchen: "Seriennummer suchen",
  umsatz_auswerten: "Umsatz auswerten",
  ladenhueter: "Ladenhüter",
  wareneingang_vorschlagen: "Wareneingang vorschlagen",
  artikel_vorschlagen: "Artikel vorschlagen",
  backup_status: "Backup-Status",
};

function claudeConfig(port, token) {
  return JSON.stringify(
    {
      mcpServers: {
        qwui: {
          command: "node",
          args: ["C:\\Pfad\\zu\\Qwui\\mcp\\server.js"],
          env: { QWUI_API_URL: `http://127.0.0.1:${port}`, QWUI_API_TOKEN: token || "<Token>" },
        },
      },
    },
    null,
    2
  );
}

// drafts: alle Entwürfe; onAccept(draft) bucht und liefert Fehlermeldungen (leer = ok).
export function Vorschlaege({ drafts, describeArticle, onAccept, onReject }) {
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const open = drafts.filter((d) => d.status === "offen").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const done = drafts.filter((d) => d.status !== "offen").sort((a, b) => ((a.decidedAt || "") < (b.decidedAt || "") ? 1 : -1));

  async function accept(d) {
    setBusy(d.id);
    const errs = await onAccept(d);
    setErrors((prev) => ({ ...prev, [d.id]: errs }));
    setBusy(null);
  }

  return (
    <div>
      {open.length === 0 && <div style={s.empty}>Keine offenen Vorschläge.</div>}
      {open.map((d) => (
        <div key={d.id} style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{d.type === "wareneingang" ? "Wareneingang" : "Neuer Artikel"}</div>
              <div style={s.muted}>vom Assistenten, {formatDateTimeDE(d.createdAt)}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <button type="button" onClick={() => accept(d)} disabled={busy === d.id} style={s.primaryBtn}>
                <Check size={14} /> {busy === d.id ? "Buche…" : "Übernehmen"}
              </button>
              <button type="button" onClick={() => onReject(d)} disabled={busy === d.id} style={s.secondaryBtn}>
                <X size={14} /> Verwerfen
              </button>
            </div>
          </div>
          {d.type === "wareneingang" ? (
            <div style={s.grid}>
              <span style={s.muted}>Artikel</span>
              <span>{describeArticle(d.payload.article)}</span>
              {d.payload.serials?.length > 0 ? (
                <>
                  <span style={s.muted}>Seriennummern</span>
                  <span className="mono">{d.payload.serials.join(", ")}</span>
                </>
              ) : (
                <>
                  <span style={s.muted}>Menge</span>
                  <span>{d.payload.quantity}</span>
                </>
              )}
              {d.payload.purchasePrice != null && (
                <>
                  <span style={s.muted}>Einkaufspreis</span>
                  <span>CHF {chf(d.payload.purchasePrice)}</span>
                </>
              )}
              {d.payload.note && (
                <>
                  <span style={s.muted}>Bemerkung</span>
                  <span>{d.payload.note}</span>
                </>
              )}
            </div>
          ) : (
            <div style={s.grid}>
              <span style={s.muted}>Name</span>
              <span>{d.payload.name}</span>
              <span style={s.muted}>Artikelnummer</span>
              <span className="mono">{d.payload.articleNumber || "—"}</span>
              <span style={s.muted}>Gruppe</span>
              <span>{d.payload.group || "—"}</span>
              <span style={s.muted}>Preis</span>
              <span>CHF {chf(d.payload.price)}</span>
              <span style={s.muted}>Seriennummern</span>
              <span>{d.payload.serialTracked ? "pflichtig" : "nein"}</span>
              {d.payload.shopText && (
                <>
                  <span style={s.muted}>Shop-Text</span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{d.payload.shopText}</span>
                </>
              )}
            </div>
          )}
          {errors[d.id]?.length > 0 && (
            <div style={s.error} role="alert">
              {errors[d.id].map((m, i) => (
                <div key={i}>{m}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ ...s.muted, cursor: "pointer" }}>Erledigte Vorschläge ({done.length})</summary>
          {done.slice(0, 50).map((d) => (
            <div key={d.id} style={s.logRow}>
              <span style={{ width: 150 }}>{formatDateTimeDE(d.decidedAt)}</span>
              <span style={{ flex: 1 }}>
                {d.type === "wareneingang" ? `Wareneingang ${d.payload.article} (${d.payload.quantity})` : `Artikel ${d.payload.name}`}
              </span>
              <span style={{ width: 100 }}>{d.status}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function Schnittstelle() {
  const api = window.qwuiDesktop?.assistant;
  const [state, setState] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState("");
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState("");

  function apply(next) {
    setState(next);
    setEnabled(!!next.config.enabled);
    setPort(String(next.config.port));
  }

  useEffect(() => {
    if (!api) return;
    api.getState().then(apply);
    const timer = setInterval(() => api.getState().then(setState), 10 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!api || !state) return null;

  async function save() {
    setMessage(null);
    let result;
    try {
      result = await api.saveConfig({ enabled, port: Number(port) });
    } catch (e) {
      setMessage({ kind: "error", text: e.message || String(e) });
      return;
    }
    if (result.config) apply(result);
    setMessage(result.ok ? { kind: "ok", text: result.running ? "Schnittstelle läuft." : "Schnittstelle ist aus." } : { kind: "error", text: result.error });
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch (e) {
      setMessage({ kind: "error", text: "Kopieren nicht möglich — bitte von Hand markieren." });
    }
  }

  return (
    <div>
      <div style={s.intro}>
        Claude (z. B. Claude Desktop auf diesem PC) kann über eine lokale Schnittstelle Bestand, Seriennummern,
        Umsätze und Ladenhüter abfragen und Wareneingänge oder Artikel <em>vorschlagen</em>. Die Schnittstelle
        lauscht nur auf diesem PC (127.0.0.1) — aus dem Netz und dem Internet ist Qwui nicht erreichbar.
      </div>
      <div style={s.privacy}>
        <strong>Datenschutz:</strong> Qwui gibt dem Assistenten keine Namen, Adressen, E-Mails oder
        Telefonnummern heraus, nur Kunden-IDs. Geschäftszahlen wie Bestand und Umsatz gehen aber an Claude und
        damit an Anthropic. Wer das nicht möchte, lässt die Schnittstelle aus.
      </div>

      <div style={{ display: "grid", gap: 8, maxWidth: 560, marginTop: 16 }}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Lokale Schnittstelle für den Assistenten einschalten
        </label>
        <label style={{ ...s.checkLabel, gap: 8 }}>
          Port
          <input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="mono" style={{ width: 100 }} aria-label="Port" />
        </label>
        <button type="button" onClick={save} style={s.secondaryBtn}>
          <Check size={14} /> Speichern
        </button>
        {message && <div style={message.kind === "ok" ? s.ok : s.error}>{message.text}</div>}
        {state.error && !message && <div style={s.error}>{state.error}</div>}
        <div style={s.muted}>
          Status: {state.running ? `läuft auf 127.0.0.1:${state.config.port}` : "aus"}
        </div>

        {state.token && (
          <>
            <div style={{ ...s.label, marginTop: 12 }}>Zugriffstoken</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={state.token} className="mono" style={{ flex: 1 }} aria-label="Zugriffstoken" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => copy(state.token, "token")} style={s.secondaryBtn}>
                <Copy size={14} /> {copied === "token" ? "Kopiert" : "Kopieren"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    apply(await api.regenerateToken());
                  } catch (e) {
                    setMessage({ kind: "error", text: e.message || String(e) });
                  }
                }}
                style={s.secondaryBtn}
                title="Das alte Token gilt danach nicht mehr"
              >
                <RefreshCw size={14} /> Erneuern
              </button>
            </div>
            <div style={s.muted}>Wer das Token kennt, kann über diesen PC die Daten abfragen — wie ein Passwort behandeln.</div>

            <div style={{ ...s.label, marginTop: 12 }}>Eintrag für Claude Desktop</div>
            <div style={s.muted}>
              In Claude Desktop unter Einstellungen → Entwickler → «Konfiguration bearbeiten» einfügen und den Pfad zu
              mcp\server.js anpassen. Voraussetzung: Node.js (LTS) ist installiert. Danach Claude Desktop neu starten.
            </div>
            <pre style={s.pre}>{claudeConfig(state.config.port, state.token)}</pre>
            <button type="button" onClick={() => copy(claudeConfig(state.config.port, state.token), "config")} style={s.secondaryBtn}>
              <Copy size={14} /> {copied === "config" ? "Kopiert" : "Eintrag kopieren"}
            </button>
          </>
        )}
      </div>

      <div style={{ ...s.label, marginTop: 28 }}>Protokoll (letzte 100 Zugriffe)</div>
      {state.log.length === 0 ? (
        <div style={s.empty}>Noch keine Zugriffe.</div>
      ) : (
        state.log.map((e, i) => (
          <div key={i} style={s.logRow}>
            <span style={{ width: 150 }}>{formatDateTimeDE(e.at)}</span>
            <span style={{ flex: 1 }}>{TOOL_LABEL[e.tool] || e.tool}</span>
            <span style={{ width: 280, color: e.ok ? "#155C2C" : "#B5480C" }}>{e.ok ? "ok" : `Fehler: ${e.error}`}</span>
          </div>
        ))
      )}
    </div>
  );
}

const s = {
  intro: { fontSize: 13, color: "#5B5F66", marginBottom: 12, maxWidth: 560 },
  privacy: { fontSize: 12, color: "#5B5F66", background: "#F1F1EF", padding: "10px 12px", maxWidth: 560 },
  label: { fontSize: 12, fontWeight: 600, color: "#5B5F66", textTransform: "uppercase", letterSpacing: "0.03em" },
  muted: { fontSize: 12, color: "#8B8F96" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "12px 0" },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#16181D" },
  ok: { fontSize: 12, color: "#1D7A3C" },
  error: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 8 },
  card: { border: "1px solid #E4E5E7", background: "#fff", padding: 14, marginTop: 12, maxWidth: 640 },
  grid: { display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 10px", marginTop: 10, fontSize: 13 },
  pre: { background: "#16181D", color: "#EDEEEF", padding: 12, fontSize: 12, overflowX: "auto", margin: "6px 0" },
  logRow: { display: "flex", gap: 8, padding: "5px 0", fontSize: 12, borderBottom: "1px solid #F1F1EF", maxWidth: 640 },
  secondaryBtn: {
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "fit-content",
  },
  primaryBtn: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
};
