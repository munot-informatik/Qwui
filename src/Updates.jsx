// Updates der Windows-Version: Stand, automatische Suche ein/aus, neue Version
// installieren. Die Arbeit macht der Hauptprozess (desktop/updater.js); die
// Web-Version kennt window.qwuiDesktop.updates nicht und zeigt nichts davon.

import React, { useEffect, useState } from "react";
import { Download, RefreshCw, ExternalLink } from "lucide-react";

const api = () => (typeof window !== "undefined" ? window.qwuiDesktop?.updates || null : null);
const DISMISS_KEY = "qwui:updateDismissed";

function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Hinweis oben in der App, sobald eine neue Version bereitsteht.
export function UpdateBanner({ onOpen }) {
  const [latest, setLatest] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const u = api();
    if (!u) return undefined;
    const load = () => u.getState().then((s) => setLatest(s.latest?.available ? s.latest : null)).catch(() => {});
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!latest || dismissed === latest.version) return null;

  function later() {
    setDismissed(latest.version);
    try {
      window.localStorage.setItem(DISMISS_KEY, latest.version);
    } catch {
      // gilt dann nur bis zum Neustart
    }
  }

  return (
    <div className="no-print" style={s.banner} role="status">
      <Download size={14} />
      <span style={{ flex: 1 }}>
        Qwui {latest.version} ist verfügbar.
      </span>
      <button type="button" onClick={onOpen} style={s.bannerBtn}>
        Ansehen
      </button>
      <button type="button" onClick={later} style={s.bannerLink}>
        Später
      </button>
    </div>
  );
}

export default function Updates() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const u = api();
    if (!u) return undefined;
    u.getState().then(setState);
    // Während des Downloads den Fortschritt nachführen.
    const timer = setInterval(() => u.getState().then(setState).catch(() => {}), 1000);
    return () => clearInterval(timer);
  }, []);

  const u = api();
  if (!u || !state) return null;
  const latest = state.latest;

  async function checkNow() {
    setBusy(true);
    setMessage(null);
    try {
      setState(await u.check());
    } finally {
      setBusy(false);
    }
  }

  async function toggle(enabled) {
    setState(await u.setEnabled(enabled));
  }

  async function install() {
    const size = latest?.asset?.size ? ` (${mb(latest.asset.size)})` : "";
    const ok = window.confirm(
      `Qwui lädt Version ${latest.version}${size} herunter, prüft sie und startet danach neu.\n\n` +
        "Noch nicht gespeicherte Eingaben (z. B. eine angefangene Quittung) gehen dabei verloren. Weiter?"
    );
    if (!ok) return;
    setMessage(null);
    const result = await u.install();
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: result.keptName
          ? "Update installiert — Qwui startet neu."
          : `Update installiert als ${result.target} — Qwui startet neu. Verknüpfungen bitte auf die neue Datei ändern.`,
      });
    } else {
      setMessage({ kind: "error", text: result.error });
    }
    setState(await u.getState());
  }

  const progress = state.progress;

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={s.h1}>Updates</h1>
      <div style={s.muted}>
        Installiert ist Qwui <strong className="mono">{state.currentVersion}</strong>.
      </div>

      <label style={s.check}>
        <input type="checkbox" checked={state.enabled} onChange={(e) => toggle(e.target.checked)} />
        Automatisch nach Updates suchen (alle 6 Stunden)
      </label>
      <div style={s.note}>
        Qwui fragt dazu bei GitHub nach der neuesten Versionsnummer. Dabei werden keine Daten aus Qwui übertragen —
        GitHub sieht nur, dass jemand nachfragt (IP-Adresse). Installiert wird nie ohne deine Bestätigung.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        <button type="button" onClick={checkNow} disabled={busy || state.installing} style={s.secondary}>
          <RefreshCw size={14} /> {busy ? "Suche…" : "Jetzt suchen"}
        </button>
        {state.checkedAt && <span style={s.muted}>Zuletzt gesucht: {formatDateTime(state.checkedAt)}</span>}
      </div>
      {state.error && <div style={s.error}>Suche fehlgeschlagen: {state.error}</div>}

      {latest && !latest.available && !state.error && (
        <div style={s.ok}>Qwui ist auf dem neuesten Stand (Version {latest.version}).</div>
      )}

      {latest?.available && (
        <div style={s.box}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Version {latest.version} ist verfügbar</div>
          {latest.publishedAt && <div style={s.muted}>veröffentlicht am {formatDateTime(latest.publishedAt)}</div>}
          {latest.notes && <div style={s.notes}>{latest.notes}</div>}
          {latest.problem && <div style={s.error}>{latest.problem}</div>}
          {!state.canInstall && (
            <div style={s.muted}>
              Diese Qwui-Version läuft nicht als portable .exe — bitte die neue Version von Hand herunterladen.
            </div>
          )}
          {progress && (
            <div style={{ marginTop: 10 }}>
              <div style={s.barOuter}>
                <div style={{ ...s.barInner, width: `${Math.min(100, (progress.received / progress.total) * 100)}%` }} />
              </div>
              <div style={s.muted}>
                {mb(progress.received)} von {mb(progress.total)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {state.canInstall && latest.asset && (
              <button type="button" onClick={install} disabled={state.installing} style={{ ...s.primary, opacity: state.installing ? 0.5 : 1 }}>
                <Download size={14} /> {state.installing ? "Wird installiert…" : "Jetzt aktualisieren"}
              </button>
            )}
            <button type="button" onClick={() => u.openPage()} style={s.secondary}>
              <ExternalLink size={14} /> Auf GitHub ansehen
            </button>
          </div>
        </div>
      )}

      {message && <div style={message.kind === "ok" ? s.ok : s.error}>{message.text}</div>}

      <div style={{ ...s.note, marginTop: 24 }}>
        Beim Update ersetzt Qwui die .exe-Datei und behält ihren Namen, damit Verknüpfungen weiter funktionieren. Die
        Daten im Ordner «Qwui-Daten» daneben bleiben, wie sie sind. Ist die automatische Sicherung eingerichtet, sichert
        Qwui vorher noch einmal.
      </div>
    </div>
  );
}

const s = {
  h1: { fontSize: 22, fontWeight: 700, margin: "0 0 12px 0" },
  muted: { fontSize: 12, color: "#70747C" },
  note: { fontSize: 12, color: "#70747C", marginTop: 6, lineHeight: 1.5 },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 18 },
  box: { border: "1px solid #DADDE1", background: "#fff", padding: 14, marginTop: 16 },
  notes: { whiteSpace: "pre-wrap", fontSize: 12, color: "#3D4048", marginTop: 8, maxHeight: 220, overflowY: "auto", background: "#FAFAF9", padding: 8 },
  ok: { fontSize: 12, color: "#155C2C", background: "#EAF6EE", padding: "8px 10px", marginTop: 12 },
  error: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 12 },
  primary: { background: "#16181D", color: "#fff", border: "none", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  secondary: { background: "#fff", color: "#16181D", border: "1px solid #DADDE1", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  barOuter: { height: 6, background: "#EDEEEF", marginBottom: 4 },
  barInner: { height: 6, background: "#E30613" },
  banner: { display: "flex", alignItems: "center", gap: 10, background: "#EEF3FB", color: "#1F4B8F", fontSize: 13, padding: "8px 16px", borderBottom: "1px solid #D5E0F2" },
  bannerBtn: { background: "#1F4B8F", color: "#fff", border: "none", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  bannerLink: { background: "transparent", border: "none", color: "#1F4B8F", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 },
};
