// Einstellungen und Status der automatischen Sicherung (nur Windows-Version,
// Reiter Backup). Gesichert wird im Electron-Hauptprozess (desktop/
// autoBackup.js): stündlich und täglich, verschlüsselt, in einen Ordner, den
// ein Cloud-Client abgleicht.

import React, { useEffect, useState } from "react";
import { Check, FolderOpen, RefreshCw } from "lucide-react";

function formatDateTimeDE(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const KIND_LABEL = { stuendlich: "Stündlich", taeglich: "Täglich" };

export default function BackupAutomatik() {
  const api = window.qwuiDesktop?.backup;
  const [state, setState] = useState(null);
  const [dir, setDir] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [message, setMessage] = useState(null); // { kind: "ok" | "error", text }
  const [busy, setBusy] = useState(false);

  function apply(next) {
    setState(next);
    setDir(next.config.dir || "");
    setEnabled(!!next.config.enabled);
  }

  useEffect(() => {
    if (!api) return;
    api.getState().then(apply);
    // Status nachführen, solange der Reiter offen ist (die Sicherung läuft im Hintergrund).
    const timer = setInterval(() => api.getState().then(setState), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!api || !state) return null;

  async function chooseDir() {
    const chosen = await api.chooseDir();
    if (chosen) setDir(chosen);
  }

  async function save() {
    setMessage(null);
    if (password && password !== password2) {
      setMessage({ kind: "error", text: "Die beiden Passwörter stimmen nicht überein." });
      return;
    }
    setBusy(true);
    const result = await api.saveConfig({ enabled, dir }, password || null);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    apply(result);
    setPassword("");
    setPassword2("");
    setMessage({ kind: "ok", text: "Gespeichert." });
  }

  async function runNow() {
    setBusy(true);
    setMessage(null);
    const next = await api.runNow();
    setBusy(false);
    setState(next);
    const last = next.status?.stuendlich;
    setMessage(last?.ok ? { kind: "ok", text: `Gesichert: ${last.file}` } : { kind: "error", text: last?.error || "Sicherung fehlgeschlagen." });
  }

  return (
    <div style={{ marginTop: 32, maxWidth: 520 }}>
      <div style={s.fieldLabel}>Automatische Sicherung</div>
      <div style={s.intro}>
        Stündlich und täglich eine verschlüsselte Sicherung aller Daten in einen Ordner deiner Wahl —
        am besten einen, den Proton Drive oder OneDrive mit der Cloud abgleicht. Qwui selbst lädt nichts
        hoch. Behalten werden 48 stündliche und 30 tägliche Sicherungen. Ohne das Backup-Passwort lassen
        sie sich nicht öffnen: gut aufbewahren, z. B. im Passwort-Manager.
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Automatisch sichern
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Zielordner" style={{ flex: 1 }} aria-label="Zielordner" />
          <button type="button" onClick={chooseDir} style={s.secondaryBtn}>
            <FolderOpen size={14} /> Wählen…
          </button>
        </div>
        <input
          type="password"
          placeholder={state.passwordSet ? "Backup-Passwort gespeichert — nur zum Ändern eingeben" : "Backup-Passwort (mind. 8 Zeichen)"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          aria-label="Backup-Passwort"
        />
        {password && (
          <input
            type="password"
            placeholder="Backup-Passwort wiederholen"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
            aria-label="Backup-Passwort wiederholen"
          />
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={save} disabled={busy} style={s.secondaryBtn}>
            <Check size={14} /> Speichern
          </button>
          <button
            type="button"
            onClick={runNow}
            disabled={busy || !!state.notReady}
            style={{ ...s.secondaryBtn, opacity: busy || state.notReady ? 0.5 : 1 }}
          >
            <RefreshCw size={14} /> Jetzt sichern
          </button>
        </div>
        {message && <div style={message.kind === "ok" ? s.ok : s.error}>{message.text}</div>}
        {state.notReady && <div style={s.error}>Nicht aktiv: {state.notReady}</div>}

        <div style={s.statusBox}>
          {["stuendlich", "taeglich"].map((kind) => {
            const st = state.status?.[kind];
            return (
              <div key={kind} style={s.statusRow}>
                <span style={{ width: 80, fontWeight: 600 }}>{KIND_LABEL[kind]}</span>
                <span style={{ flex: 1 }}>
                  {st?.lastSuccessAt ? `zuletzt ${formatDateTimeDE(st.lastSuccessAt)}` : "noch keine Sicherung"}
                  {st && !st.ok && st.error && (
                    <div style={{ color: "#B5480C" }}>
                      Fehler am {formatDateTimeDE(st.at)}: {st.error}
                    </div>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const s = {
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#5B5F66", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  intro: { fontSize: 12, color: "#8B8F96", marginBottom: 12 },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#16181D" },
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
    width: "fit-content",
  },
  ok: { fontSize: 12, color: "#1D7A3C" },
  error: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px" },
  statusBox: { border: "1px solid #E4E5E7", background: "#fff", padding: "6px 12px", marginTop: 4 },
  statusRow: { display: "flex", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid #F1F1EF" },
};
