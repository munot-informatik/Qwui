// Automatische Sicherung der Windows-Version: stündlich und täglich eine
// verschlüsselte Kopie aller Daten in einen frei wählbaren Ordner — gedacht
// für einen Ordner, den Proton Drive oder OneDrive mit der Cloud abgleicht.
// Qwui selbst lädt nichts hoch.
//
// - Läuft im Hauptprozess per Zeitgeber, unabhängig davon, was in der App
//   gerade offen ist (und nie über den Assistenten).
// - Ohne Backup-Passwort keine Sicherung: unverschlüsselt in die Cloud wäre
//   schlechter als gar nicht.
// - Behalten werden 48 stündliche und 30 tägliche Sicherungen; ältere werden
//   gelöscht — aber nur Dateien, deren Name exakt dem eigenen Muster folgt.
// - Ergebnis und Zeitpunkt jeder Sicherung stehen im Status (App, Assistent).

import { existsSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encryptBackup } from "./backupCrypto.js";

export const KIND = { hourly: "stuendlich", daily: "taeglich" };
export const KEEP = { stuendlich: 48, taeglich: 30 };
const INTERVAL_MS = { stuendlich: 60 * 60 * 1000, taeglich: 24 * 60 * 60 * 1000 };
const EXTENSION = ".qwuibak";
export const BACKUP_PASSWORD_SECRET = "backup-password";

function pad(n) {
  return String(n).padStart(2, "0");
}

// Lokale Zeit im Dateinamen — so, wie man die Datei im Explorer sucht. Die
// Form sortiert alphabetisch zugleich chronologisch.
export function backupFileName(kind, date) {
  const d = date;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Qwui-Backup_${kind}_${stamp}${EXTENSION}`;
}

const NAME_RE = /^Qwui-Backup_(stuendlich|taeglich)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.qwuibak$/;

// Löscht die ältesten Sicherungen einer Art über die Behalte-Grenze hinaus.
export function rotate(dir, kind, keep = KEEP[kind]) {
  const files = readdirSync(dir)
    .filter((f) => NAME_RE.test(f) && f.startsWith(`Qwui-Backup_${kind}_`))
    .sort()
    .reverse();
  const removed = files.slice(keep);
  for (const f of removed) unlinkSync(join(dir, f));
  return removed;
}

export function isDue(kind, status, now) {
  const last = status?.[kind];
  if (!last || !last.lastSuccessAt) return true;
  return now.getTime() - new Date(last.lastSuccessAt).getTime() >= INTERVAL_MS[kind];
}

// Grund, warum nicht gesichert wird — oder null, wenn alles bereit ist.
export function notReadyReason(config, hasPassword) {
  if (!config?.enabled) return "Automatische Sicherung ist ausgeschaltet.";
  if (!config.dir) return "Kein Zielordner gewählt.";
  if (!hasPassword) return "Ohne Backup-Passwort wird nicht gesichert.";
  return null;
}

// deps: { buildPayload: async () => Objekt, getConfig: () => { enabled, dir },
//         getPassword: () => string|null, readStatus, writeStatus, now? }
export function createAutoBackup({ buildPayload, getConfig, getPassword, readStatus, writeStatus, now = () => new Date() }) {
  let running = false;

  function record(kind, entry) {
    const status = readStatus() || {};
    const previous = status[kind] || {};
    const next = {
      ...status,
      [kind]: {
        ...previous,
        ...entry,
        lastSuccessAt: entry.ok ? entry.at : previous.lastSuccessAt || null,
        lastFile: entry.ok ? entry.file : previous.lastFile || null,
      },
    };
    writeStatus(next);
    return next;
  }

  async function runBackup(kind) {
    const config = getConfig() || {};
    const password = getPassword();
    const at = now();
    const reason = notReadyReason(config, !!password);
    if (reason) return record(kind, { at: at.toISOString(), ok: false, error: reason });
    try {
      if (!existsSync(config.dir)) {
        throw new Error(`Der Zielordner ${config.dir} ist nicht erreichbar.`);
      }
      const payload = await buildPayload();
      const file = backupFileName(kind, at);
      const target = join(config.dir, file);
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, encryptBackup(JSON.stringify(payload), password));
      renameSync(tmp, target);
      rotate(config.dir, kind);
      return record(kind, { at: at.toISOString(), ok: true, file, error: null });
    } catch (e) {
      return record(kind, { at: at.toISOString(), ok: false, error: e.message || String(e) });
    }
  }

  // Vom Zeitgeber alle paar Minuten aufgerufen: sichert, was fällig ist.
  async function tick() {
    if (running) return null;
    const config = getConfig() || {};
    if (notReadyReason(config, !!getPassword())) return null;
    running = true;
    try {
      let status = readStatus() || {};
      for (const kind of [KIND.daily, KIND.hourly]) {
        if (isDue(kind, status, now())) status = await runBackup(kind);
      }
      return status;
    } finally {
      running = false;
    }
  }

  return { runBackup, tick };
}
