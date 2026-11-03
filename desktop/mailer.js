// E-Mail-Versand der Desktop-Version: Quittung/Rechnung direkt per SMTP, mit
// der PDF als Anhang. Ersetzt unter Windows den mailto:-Umweg, bei dem der
// Kunde die PDF von Hand anhängen musste. Die Web-Version bleibt bei mailto:
// und dem Teilen-Dialog.
//
// Die SMTP-Einstellungen (ohne Passwort) liegen in der Datenbank, das
// Passwort verschlüsselt in geheim.bin (siehe secrets.js). Beides wird bei
// jedem Versand frisch gelesen, damit eine Änderung unter Firma sofort gilt.

import nodemailer from "nodemailer";

export const SMTP_PASSWORD_SECRET = "smtp-password";

export const SECURITY = {
  ssl: "ssl", // direkt verschlüsselt, üblich auf Port 465
  starttls: "starttls", // unverschlüsselt verbinden, dann zwingend verschlüsseln, üblich auf Port 587
  none: "none", // nur für Tests oder Server im eigenen Netz
};

export const emptySmtpSettings = {
  host: "",
  port: 587,
  security: SECURITY.starttls,
  user: "",
  fromName: "",
  fromAddress: "",
};

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function isValidEmail(address) {
  return EMAIL_RE.test(String(address || "").trim());
}

// Prüft die Einstellungen, bevor ein Versand überhaupt versucht wird —
// verständliche Meldungen statt kryptischer SMTP-Fehler.
export function validateSmtpSettings(settings) {
  const s = { ...emptySmtpSettings, ...(settings || {}) };
  const errors = [];
  if (!String(s.host).trim()) errors.push("SMTP-Server fehlt.");
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("Port muss eine Zahl zwischen 1 und 65535 sein.");
  if (!Object.values(SECURITY).includes(s.security)) errors.push("Unbekannte Verschlüsselung.");
  if (!isValidEmail(s.fromAddress)) errors.push("Absender-Adresse ist ungültig.");
  return errors;
}

function transportOptions(settings, password) {
  const s = { ...emptySmtpSettings, ...settings };
  return {
    host: String(s.host).trim(),
    port: Number(s.port),
    secure: s.security === SECURITY.ssl,
    requireTLS: s.security === SECURITY.starttls,
    ignoreTLS: s.security === SECURITY.none,
    auth: s.user ? { user: s.user, pass: password || "" } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };
}

function fromHeader(settings) {
  const name = String(settings.fromName || "").replace(/["\r\n]/g, "").trim();
  const address = String(settings.fromAddress).trim();
  return name ? { name, address } : address;
}

// Höchstgrösse eines Anhangs. Eine Quittungs-PDF liegt bei wenigen hundert
// KB; alles darüber deutet auf einen Fehler hin.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

// deps: { getSettings(), getPassword(), createTransport? } — createTransport
// lässt sich in Tests ersetzen.
export function createMailer({ getSettings, getPassword, createTransport = nodemailer.createTransport }) {
  async function send(message) {
    const settings = { ...emptySmtpSettings, ...(getSettings() || {}) };
    const errors = validateSmtpSettings(settings);
    if (errors.length) throw new Error(`E-Mail-Einstellungen unvollständig: ${errors.join(" ")}`);
    if (!isValidEmail(message.to)) throw new Error("Empfänger-Adresse ist ungültig.");

    const transport = createTransport(transportOptions(settings, getPassword()));
    try {
      return await transport.sendMail({ from: fromHeader(settings), ...message, to: String(message.to).trim() });
    } finally {
      transport.close?.();
    }
  }

  return {
    // { to, subject, text, filename, pdf: Uint8Array }
    async sendReceipt({ to, subject, text, filename, pdf }) {
      const bytes = Buffer.from(pdf || []);
      if (bytes.length === 0) throw new Error("Die PDF fehlt.");
      if (bytes.length > MAX_PDF_BYTES) throw new Error("Die PDF ist zu gross für den Versand.");
      const info = await send({
        to,
        subject: String(subject || ""),
        text: String(text || ""),
        attachments: [{ filename: safeFilename(filename), content: bytes, contentType: "application/pdf" }],
      });
      return { messageId: info.messageId };
    },

    async sendTest(to) {
      const info = await send({
        to,
        subject: "Qwui: Test-Mail",
        text:
          "Diese Test-Mail bestätigt, dass Qwui über die eingetragenen SMTP-Einstellungen " +
          "E-Mails versenden kann. Quittungen gehen ab jetzt direkt mit PDF-Anhang hinaus.",
      });
      return { messageId: info.messageId };
    },
  };
}

// Dateiname des Anhangs ohne Pfadteile und Steuerzeichen.
export function safeFilename(name) {
  const base = String(name || "Beleg.pdf").replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim() || "Beleg.pdf";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}
