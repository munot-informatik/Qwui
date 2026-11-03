// SMTP-Einstellungen für den direkten E-Mail-Versand (nur Windows-Version,
// Reiter Firma). Gespeichert wird im Electron-Hauptprozess: die Einstellungen
// in der lokalen Datenbank, das Passwort verschlüsselt in geheim.bin. Das
// Passwort kommt nie zurück in die Oberfläche — angezeigt wird nur, ob eines
// hinterlegt ist.

import React, { useEffect, useState } from "react";
import { Check, Mail } from "lucide-react";

const SECURITY_OPTIONS = [
  ["starttls", "STARTTLS (meist Port 587)"],
  ["ssl", "SSL/TLS (meist Port 465)"],
  ["none", "Keine (nur im eigenen Netz)"],
];

const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 };

export default function EmailEinstellungen() {
  const mail = window.qwuiDesktop?.mail;
  const [settings, setSettings] = useState(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [status, setStatus] = useState(null); // { kind: "ok" | "error", text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mail) return;
    mail.getSettings().then(({ settings: s, passwordSet: p }) => {
      setSettings(s);
      setPasswordSet(p);
      setTestTo(s.fromAddress || "");
    });
  }, []);

  if (!mail) return null;
  if (!settings) return null;

  function update(field, value) {
    setSettings((prev) => {
      const next = { ...prev, [field]: value };
      // Beim Wechsel der Verschlüsselung den üblichen Port vorschlagen, sofern
      // noch der Standard der bisherigen Wahl drinsteht.
      if (field === "security" && Number(prev.port) === DEFAULT_PORT[prev.security]) {
        next.port = DEFAULT_PORT[value];
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const pw = removePassword ? "" : password ? password : null;
      const result = await mail.saveSettings(settings, pw);
      if (!result.ok) {
        setStatus({ kind: "error", text: result.errors.join(" ") });
        return false;
      }
      setPasswordSet(result.passwordSet);
      setPassword("");
      setRemovePassword(false);
      setStatus({ kind: "ok", text: "E-Mail-Einstellungen gespeichert." });
      return true;
    } catch (e) {
      setStatus({ kind: "error", text: e.message || String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Speichert zuerst, damit genau die angezeigten Einstellungen geprüft werden.
  async function sendTest() {
    if (!(await save())) return;
    setBusy(true);
    setStatus({ kind: "ok", text: "Sende Test-Mail…" });
    const result = await mail.sendTest(testTo);
    setBusy(false);
    setStatus(
      result.ok
        ? { kind: "ok", text: `Test-Mail an ${testTo} gesendet. Bitte im Posteingang prüfen.` }
        : { kind: "error", text: `Test-Mail fehlgeschlagen: ${result.error}` }
    );
  }

  return (
    <div style={{ marginTop: 32, maxWidth: 420 }}>
      <div style={s.fieldLabel}>E-Mail-Versand (SMTP)</div>
      <div style={s.intro}>
        Quittungen und Rechnungen gehen direkt aus Qwui an den Kunden, mit der PDF als Anhang.
        Die Angaben findest du bei deinem E-Mail-Anbieter (Postausgangsserver). Das Passwort wird
        verschlüsselt auf diesem PC gespeichert.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <input placeholder="SMTP-Server, z. B. mail.example.ch" value={settings.host} onChange={(e) => update("host", e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={settings.security} onChange={(e) => update("security", e.target.value)} style={{ ...s.select, flex: 2 }} aria-label="Verschlüsselung">
            {SECURITY_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Port"
            type="number"
            value={settings.port}
            onChange={(e) => update("port", e.target.value)}
            className="mono"
            style={{ flex: 1, textAlign: "right" }}
            aria-label="Port"
          />
        </div>
        <input placeholder="Benutzer (meist die E-Mail-Adresse)" value={settings.user} onChange={(e) => update("user", e.target.value)} autoComplete="off" />
        <input
          type="password"
          placeholder={passwordSet ? "Passwort gespeichert — nur zum Ändern eingeben" : "Passwort"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setRemovePassword(false);
          }}
          autoComplete="new-password"
          aria-label="Passwort"
        />
        {passwordSet && (
          <label style={s.checkLabel}>
            <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />
            Gespeichertes Passwort entfernen
          </label>
        )}
        <input placeholder="Absender-Name, z. B. Billard Shop Munot" value={settings.fromName} onChange={(e) => update("fromName", e.target.value)} />
        <input placeholder="Absender-Adresse" value={settings.fromAddress} onChange={(e) => update("fromAddress", e.target.value)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={save} disabled={busy} style={s.secondaryBtn}>
            <Check size={14} /> Speichern
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input placeholder="Test-Mail an" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ flex: 1 }} aria-label="Test-Mail an" />
          <button onClick={sendTest} disabled={busy || !testTo.trim()} style={{ ...s.secondaryBtn, opacity: busy || !testTo.trim() ? 0.5 : 1 }}>
            <Mail size={14} /> Test-Mail senden
          </button>
        </div>
        {status && <div style={status.kind === "ok" ? s.ok : s.error}>{status.text}</div>}
      </div>
    </div>
  );
}

const s = {
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#5B5F66", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  intro: { fontSize: 12, color: "#8B8F96", marginBottom: 12 },
  select: { width: "100%", padding: "8px 10px", border: "1px solid #DADDE1", fontSize: 13, background: "#fff" },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B5F66" },
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
};
