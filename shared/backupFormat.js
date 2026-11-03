// Das Backup-Format von Qwui: eine JSON-Datei mit allen Daten. Dieselbe Form
// schreibt der Knopf «Alle Daten exportieren» (App) und die automatische
// Sicherung der Windows-Version (Hauptprozess, dort zusätzlich verschlüsselt).
//
// Version 1 (bis 1.1): Firma, Kunden, Quittungen, Inventar.
// Version 2 (ab 1.2.0): dazu Exemplare (serialUnits), Lagerbewegungen
// (stockMovements, nach Jahres-Schlüssel) und — nur aus der Windows-Version —
// Einstellungen ohne Geheimnisse (settings). Passwörter sind nie enthalten.

export const BACKUP_SCHEMA_VERSION = 2;

export function buildBackupPayload({
  company,
  customers,
  receipts,
  inventory,
  units,
  movementsByKey,
  settings,
  now = new Date().toISOString(),
}) {
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    company: company || {},
    customers: customers || [],
    receipts: receipts || [],
    inventory: inventory || [],
    serialUnits: units || [],
    stockMovements: movementsByKey || {},
  };
  if (settings) payload.settings = settings;
  return payload;
}

// Reicht für die Vorschau vor dem Import; alles Weitere hat Rückfallwerte.
export function looksLikeBackup(parsed) {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    typeof parsed.company === "object" &&
    Array.isArray(parsed.customers) &&
    Array.isArray(parsed.receipts)
  );
}

// Verschlüsselte Sicherungen tragen diese Kennung (siehe desktop/backupCrypto.js).
export const ENCRYPTED_FORMAT = "qwui-backup-verschluesselt";

export function isEncryptedBackup(parsed) {
  return !!parsed && typeof parsed === "object" && parsed.format === ENCRYPTED_FORMAT;
}
