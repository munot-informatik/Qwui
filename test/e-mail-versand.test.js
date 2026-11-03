// E-Mail-Versand der Windows-Version: Die Quittung muss als PDF-Anhang beim
// Kunden ankommen, mit der Firma als Absender. Geprüft gegen einen echten
// SMTP-Server, der nur lokal für den Test läuft.
//
// Dazu der Speicher für Passwörter: Ein SMTP-Passwort darf nie im Klartext
// auf der Platte landen.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMailer, validateSmtpSettings, safeFilename, isValidEmail } from "../desktop/mailer.js";
import { createSecretStore } from "../desktop/secrets.js";

// smtp-server ist eine Entwicklungs-Abhängigkeit von desktop/.
const desktopRequire = createRequire(new URL("../desktop/package.json", import.meta.url));
const { SMTPServer } = desktopRequire("smtp-server");

let server;
let port;
const received = [];

beforeAll(async () => {
  server = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, cb) {
      if (auth.username === "laden" && auth.password === "geheim") return cb(null, { user: "laden" });
      cb(new Error("Falsches Passwort"));
    },
    onData(stream, session, cb) {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        received.push({ from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8") });
        cb();
      });
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received.length = 0;
});

function settings(overrides = {}) {
  return {
    host: "127.0.0.1",
    port,
    security: "none",
    user: "laden",
    fromName: "Billard Shop Munot",
    fromAddress: "laden@example.ch",
    ...overrides,
  };
}

const PDF = new TextEncoder().encode("%PDF-1.7 Testinhalt");

describe("Quittung per E-Mail", () => {
  it("kommt mit PDF-Anhang und Firma als Absender an", async () => {
    const mailer = createMailer({ getSettings: () => settings(), getPassword: () => "geheim" });
    await mailer.sendReceipt({
      to: "s.meier@example.ch",
      subject: "Quittung Nr. 0001 – Billard Shop Munot",
      text: "Guten Tag Sandra Meier",
      filename: "Quittung_0001.pdf",
      pdf: PDF,
    });

    expect(received).toHaveLength(1);
    const mail = received[0];
    expect(mail.from).toBe("laden@example.ch");
    expect(mail.to).toEqual(["s.meier@example.ch"]);
    expect(mail.raw).toMatch(/From: Billard Shop Munot <laden@example\.ch>/);
    expect(mail.raw).toMatch(/Content-Type: application\/pdf; name=Quittung_0001\.pdf/);
    expect(mail.raw).toContain(Buffer.from(PDF).toString("base64"));
  });

  it("meldet ein falsches Passwort verständlich statt still zu scheitern", async () => {
    const mailer = createMailer({ getSettings: () => settings(), getPassword: () => "falsch" });
    await expect(mailer.sendTest("laden@example.ch")).rejects.toThrow(/Invalid login|Falsches Passwort|535/);
    expect(received).toHaveLength(0);
  });

  it("verschickt nichts ohne vollständige Einstellungen", async () => {
    const mailer = createMailer({ getSettings: () => settings({ host: "" }), getPassword: () => "geheim" });
    await expect(mailer.sendTest("laden@example.ch")).rejects.toThrow(/SMTP-Server fehlt/);
  });

  it("lehnt eine ungültige Empfänger-Adresse ab", async () => {
    const mailer = createMailer({ getSettings: () => settings(), getPassword: () => "geheim" });
    await expect(
      mailer.sendReceipt({ to: "kein-at-zeichen", subject: "x", text: "x", filename: "a.pdf", pdf: PDF })
    ).rejects.toThrow(/Empfänger/);
  });

  it("verschickt keine Quittung ohne PDF", async () => {
    const mailer = createMailer({ getSettings: () => settings(), getPassword: () => "geheim" });
    await expect(mailer.sendReceipt({ to: "a@b.ch", subject: "x", text: "x", filename: "a.pdf", pdf: new Uint8Array() })).rejects.toThrow(/PDF fehlt/);
  });
});

describe("Einstellungen", () => {
  it("prüft Server, Port und Absender", () => {
    expect(validateSmtpSettings({ host: "", port: 99999, security: "ssl", fromAddress: "x" })).toEqual([
      "SMTP-Server fehlt.",
      "Port muss eine Zahl zwischen 1 und 65535 sein.",
      "Absender-Adresse ist ungültig.",
    ]);
    expect(validateSmtpSettings({ host: "mail.example.ch", port: 465, security: "ssl", fromAddress: "a@b.ch" })).toEqual([]);
  });

  it("bereinigt den Dateinamen des Anhangs", () => {
    expect(safeFilename("Quittung 0001 / Müller")).toBe("Quittung 0001 _ Müller.pdf");
    expect(safeFilename("")).toBe("Beleg.pdf");
  });

  it("erkennt gültige Adressen", () => {
    expect(isValidEmail("s.meier@example.ch")).toBe(true);
    expect(isValidEmail("s.meier@example")).toBe(false);
    expect(isValidEmail("a b@example.ch")).toBe(false);
  });
});

describe("Passwort-Speicher", () => {
  let dir;
  // Stellvertreter für Windows-DPAPI: umkehrbar, aber nicht Klartext.
  const fakeCrypto = {
    isAvailable: () => true,
    encrypt: (t) => Buffer.from(Buffer.from(t, "utf8").toString("base64").split("").reverse().join("")),
    decrypt: (b) => Buffer.from(b.toString().split("").reverse().join(""), "base64").toString("utf8"),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qwui-secrets-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("speichert das Passwort nicht im Klartext", () => {
    const secrets = createSecretStore(join(dir, "geheim.bin"), fakeCrypto);
    secrets.set("smtp-password", "Sehr-Geheim-123");
    expect(readFileSync(join(dir, "geheim.bin"), "utf8")).not.toContain("Sehr-Geheim-123");
    expect(secrets.get("smtp-password")).toBe("Sehr-Geheim-123");
    expect(secrets.has("smtp-password")).toBe(true);
  });

  it("löscht ein Passwort", () => {
    const secrets = createSecretStore(join(dir, "geheim.bin"), fakeCrypto);
    secrets.set("smtp-password", "x");
    secrets.delete("smtp-password");
    expect(secrets.get("smtp-password")).toBeNull();
  });

  it("verweigert das Speichern ohne Verschlüsselung", () => {
    const secrets = createSecretStore(join(dir, "geheim.bin"), { ...fakeCrypto, isAvailable: () => false });
    expect(() => secrets.set("smtp-password", "x")).toThrow(/Verschlüsselung/);
  });

  it("behandelt eine nicht lesbare Datei (anderer PC) wie leer", () => {
    const secrets = createSecretStore(join(dir, "geheim.bin"), fakeCrypto);
    secrets.set("smtp-password", "x");
    const otherPc = createSecretStore(join(dir, "geheim.bin"), { ...fakeCrypto, decrypt: () => { throw new Error("DPAPI"); } });
    expect(otherPc.get("smtp-password")).toBeNull();
  });
});
