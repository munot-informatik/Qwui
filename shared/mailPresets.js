// Häufige E-Mail-Anbieter mit ihren Postausgangsservern, damit beim
// Einrichten nur Adresse und Passwort nötig sind. Stand November 2026, aus den
// Anleitungen der Anbieter (Bluewin/Swisscom, Hostpoint, Infomaniak, Google,
// GMX). Outlook.com/Hotmail fehlt bewusst: Microsoft lässt seit September 2024
// keine Anmeldung mit Passwort mehr zu, nur noch mit Microsoft-Konto (OAuth).

export const MAIL_PRESETS = [
  { id: "bluewin", label: "Bluewin (Swisscom)", host: "smtpauths.bluewin.ch", security: "ssl", port: 465 },
  { id: "hostpoint", label: "Hostpoint", host: "asmtp.mail.hostpoint.ch", security: "ssl", port: 465 },
  { id: "infomaniak", label: "Infomaniak", host: "mail.infomaniak.com", security: "ssl", port: 465 },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    security: "ssl",
    port: 465,
    note: "Google verlangt ein App-Passwort (Google-Konto → Sicherheit → 2-Faktor-Authentifizierung → App-Passwörter), nicht das normale Passwort.",
  },
  {
    id: "gmx",
    label: "GMX",
    host: "mail.gmx.net",
    security: "starttls",
    port: 587,
    note: "Bei GMX muss der Versand über andere Programme einmal in den GMX-Einstellungen (POP3/IMAP) erlaubt werden.",
  },
];

export const OUTLOOK_NOTE =
  "Outlook.com, Hotmail und Live erlauben keine Anmeldung mit Passwort mehr. Bitte eine Adresse bei einem anderen Anbieter verwenden, z. B. die der Firmen-Domain.";

// Welcher Anbieter passt zum gespeicherten Server? "other", wenn keiner.
export function detectPreset(host) {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return "";
  return MAIL_PRESETS.find((p) => p.host === h)?.id || "other";
}

// Anbieter anhand der Adresse vorschlagen (z. B. «…@bluewin.ch» → Bluewin).
export function suggestPreset(address) {
  const domain = String(address || "").trim().toLowerCase().split("@")[1] || "";
  if (!domain) return "";
  if (domain === "bluewin.ch" || domain === "bluemail.ch") return "bluewin";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain.startsWith("gmx.")) return "gmx";
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return "outlook";
  return "";
}
