// Verschlüsselung der automatischen Sicherungen: AES-256-GCM, der Schlüssel
// wird mit scrypt aus dem Backup-Passwort abgeleitet. Die Backup-Dateien
// landen in einem Cloud-Ordner (Proton Drive, OneDrive) — dort sollen sie
// ohne das Passwort wertlos sein.
//
// Die Datei ist selbst wieder JSON, damit sie sich beim Import erkennen lässt:
// { format, version, kdf: { name, N, r, p, salt }, cipher, iv, tag, data }
// GCM prüft beim Entschlüsseln zugleich, dass nichts verändert wurde — ein
// falsches Passwort und eine beschädigte Datei führen beide zur selben
// verständlichen Meldung statt zu Datenmüll.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

export const ENCRYPTED_FORMAT = "qwui-backup-verschluesselt";

// N = 2^15: auf einem Laden-PC ein Bruchteil einer Sekunde pro Sicherung,
// für Durchprobieren von Passwörtern aber teuer.
const KDF = { name: "scrypt", N: 2 ** 15, r: 8, p: 1 };
const MIN_PASSWORD_LENGTH = 8;

function deriveKey(password, salt, { N, r, p }) {
  return scryptSync(String(password), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 });
}

export function checkBackupPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Das Backup-Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  return null;
}

export function encryptBackup(json, password) {
  const problem = checkBackupPassword(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt, KDF);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(json), "utf8"), cipher.final()]);
  return JSON.stringify({
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: { ...KDF, salt: salt.toString("base64") },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

export function decryptBackup(fileText, password) {
  let envelope;
  try {
    envelope = typeof fileText === "string" ? JSON.parse(fileText) : fileText;
  } catch (e) {
    throw new Error("Die Datei ist keine Qwui-Sicherung.");
  }
  if (!envelope || envelope.format !== ENCRYPTED_FORMAT || envelope.cipher !== "aes-256-gcm") {
    throw new Error("Die Datei ist keine verschlüsselte Qwui-Sicherung.");
  }
  const { N, r, p, salt } = envelope.kdf || {};
  try {
    const key = deriveKey(password, Buffer.from(salt, "base64"), { N, r, p });
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error("Falsches Backup-Passwort oder beschädigte Datei.");
  }
}
