// Automatische Sicherung: Die Dateien landen in einem Cloud-Ordner. Ohne
// Passwort müssen sie wertlos sein, mit Passwort vollständig wiederherstellbar,
// und die Rotation darf nur die eigenen, alten Sicherungen löschen.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptBackup, decryptBackup, checkBackupPassword } from "../desktop/backupCrypto.js";
import { createAutoBackup, backupFileName, rotate, isDue, KEEP } from "../desktop/autoBackup.js";
import { buildBackupPayload, isEncryptedBackup, looksLikeBackup, ENCRYPTED_FORMAT } from "../shared/backupFormat.js";
import { ENCRYPTED_FORMAT as DESKTOP_FORMAT } from "../desktop/backupCrypto.js";

const PASSWORT = "Billard-2027!";

function payload() {
  return buildBackupPayload({
    company: { name: "Billard Shop Munot" },
    customers: [{ id: "c1", name: "Sandra Meier", email: "s.meier@example.ch" }],
    receipts: [{ id: "r1", number: "0001", items: [{ serial: "PR-1001" }] }],
    inventory: [{ id: "q", name: "Predator Revo", stock: 2 }],
    units: [{ id: "u1", serial: "PR-1001", status: "verkauft" }],
    movementsByKey: { "stock-movements-2027": [{ id: "m1", qty: -1 }] },
    settings: { smtp: { host: "mail.example.ch" } },
    now: "2027-02-13T10:00:00.000Z",
  });
}

describe("Verschlüsselung", () => {
  it("lässt nichts im Klartext stehen und stellt alles wieder her", () => {
    const json = JSON.stringify(payload());
    const file = encryptBackup(json, PASSWORT);
    for (const geheim of ["Sandra Meier", "PR-1001", "Billard Shop Munot", "s.meier@example.ch"]) {
      expect(file).not.toContain(geheim);
    }
    expect(JSON.parse(decryptBackup(file, PASSWORT))).toEqual(payload());
  });

  it("weist ein falsches Passwort ab", () => {
    const file = encryptBackup("{}", PASSWORT);
    expect(() => decryptBackup(file, "falsches-passwort")).toThrow("Falsches Backup-Passwort oder beschädigte Datei.");
  });

  it("erkennt eine veränderte Datei", () => {
    const envelope = JSON.parse(encryptBackup(JSON.stringify(payload()), PASSWORT));
    const data = Buffer.from(envelope.data, "base64");
    data[5] ^= 0xff;
    envelope.data = data.toString("base64");
    expect(() => decryptBackup(JSON.stringify(envelope), PASSWORT)).toThrow(/beschädigte Datei/);
  });

  it("verlangt ein Passwort mit mindestens 8 Zeichen", () => {
    expect(checkBackupPassword("kurz")).toMatch(/mindestens 8/);
    expect(() => encryptBackup("{}", "kurz")).toThrow();
  });

  it("wird beim Import als verschlüsselte Sicherung erkannt", () => {
    const parsed = JSON.parse(encryptBackup("{}", PASSWORT));
    expect(isEncryptedBackup(parsed)).toBe(true);
    expect(looksLikeBackup(parsed)).toBe(false);
    expect(DESKTOP_FORMAT).toBe(ENCRYPTED_FORMAT);
  });
});

describe("Automatische Sicherung", () => {
  let dir;
  let status;
  let clock;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qwui-backup-"));
    status = null;
    clock = new Date(2027, 1, 13, 9, 0, 0);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function backup(overrides = {}) {
    return createAutoBackup({
      buildPayload: async () => payload(),
      getConfig: () => ({ enabled: true, dir }),
      getPassword: () => PASSWORT,
      readStatus: () => status,
      writeStatus: (s) => (status = s),
      now: () => clock,
      ...overrides,
    });
  }

  it("schreibt beim ersten Lauf eine tägliche und eine stündliche Sicherung", async () => {
    await backup().tick();
    expect(readdirSync(dir).sort()).toEqual([
      "Qwui-Backup_stuendlich_2027-02-13_09-00-00.qwuibak",
      "Qwui-Backup_taeglich_2027-02-13_09-00-00.qwuibak",
    ]);
    expect(status.stuendlich).toMatchObject({ ok: true, lastFile: "Qwui-Backup_stuendlich_2027-02-13_09-00-00.qwuibak" });
    const restored = JSON.parse(decryptBackup(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"), PASSWORT));
    expect(restored.serialUnits[0].serial).toBe("PR-1001");
  });

  it("sichert erst wieder, wenn eine Stunde bzw. ein Tag vorbei ist", async () => {
    const b = backup();
    await b.tick();
    clock = new Date(2027, 1, 13, 9, 30, 0);
    await b.tick();
    expect(readdirSync(dir)).toHaveLength(2);
    clock = new Date(2027, 1, 13, 10, 0, 0);
    await b.tick();
    expect(readdirSync(dir).filter((f) => f.includes("stuendlich"))).toHaveLength(2);
    expect(readdirSync(dir).filter((f) => f.includes("taeglich"))).toHaveLength(1);
  });

  it("sichert ohne Passwort nicht", async () => {
    const result = await backup({ getPassword: () => null }).runBackup("stuendlich");
    expect(readdirSync(dir)).toEqual([]);
    expect(result.stuendlich).toMatchObject({ ok: false, error: "Ohne Backup-Passwort wird nicht gesichert." });
  });

  it("meldet einen nicht erreichbaren Zielordner (Cloud-Laufwerk getrennt)", async () => {
    const result = await backup({ getConfig: () => ({ enabled: true, dir: join(dir, "fehlt") }) }).runBackup("taeglich");
    expect(result.taeglich.ok).toBe(false);
    expect(result.taeglich.error).toMatch(/nicht erreichbar/);
  });

  it("behält beim Fehlschlag den Zeitpunkt der letzten erfolgreichen Sicherung", async () => {
    const b = backup();
    await b.runBackup("stuendlich");
    const firstSuccess = status.stuendlich.lastSuccessAt;
    clock = new Date(2027, 1, 13, 11, 0, 0);
    await backup({ buildPayload: async () => { throw new Error("Datenbank gesperrt"); } }).runBackup("stuendlich");
    expect(status.stuendlich).toMatchObject({ ok: false, error: "Datenbank gesperrt", lastSuccessAt: firstSuccess });
  });
});

describe("Rotation", () => {
  let dir;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "qwui-rotation-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("behält 48 stündliche und löscht die ältesten", () => {
    for (let h = 0; h < 50; h++) {
      writeFileSync(join(dir, backupFileName("stuendlich", new Date(2027, 1, 1 + Math.floor(h / 24), h % 24))), "x");
    }
    const removed = rotate(dir, "stuendlich");
    expect(removed).toEqual(["Qwui-Backup_stuendlich_2027-02-01_01-00-00.qwuibak", "Qwui-Backup_stuendlich_2027-02-01_00-00-00.qwuibak"]);
    expect(readdirSync(dir)).toHaveLength(KEEP.stuendlich);
  });

  it("lässt fremde Dateien und die andere Art in Ruhe", () => {
    writeFileSync(join(dir, "Notizen.txt"), "x");
    writeFileSync(join(dir, "Qwui-Backup_2026-11-01.json"), "x");
    writeFileSync(join(dir, backupFileName("taeglich", new Date(2027, 0, 1))), "x");
    rotate(dir, "stuendlich", 0);
    rotate(dir, "taeglich", 1);
    expect(readdirSync(dir)).toHaveLength(3);
  });

  it("rechnet fällige Sicherungen ab der letzten erfolgreichen", () => {
    const now = new Date("2027-02-13T10:00:00Z");
    expect(isDue("stuendlich", null, now)).toBe(true);
    expect(isDue("stuendlich", { stuendlich: { lastSuccessAt: "2027-02-13T09:30:00Z" } }, now)).toBe(false);
    expect(isDue("taeglich", { taeglich: { lastSuccessAt: "2027-02-12T09:59:00Z" } }, now)).toBe(true);
  });
});
