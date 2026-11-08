// Vereinfachte Bedienung (1.3.0): Verkauf per Scan, Suche in Belegen und
// Kunden. Hier die Regeln, die nicht von der Oberfläche abhängen.

import { describe, it, expect } from "vitest";
import { resolveSaleScan, applySaleScan } from "../shared/sale.js";
import { receiptMatches, filterReceipts, searchCustomers } from "../shared/search.js";

const queue = { id: "p1", articleNumber: "PRED-REVO", name: "Predator Revo", price: 890, serialTracked: true, stock: 0 };
const kreide = { id: "p2", articleNumber: "KR-01", name: "Kreide", price: 4, stock: 12 };
const inventory = [queue, kreide];
const units = [
  { id: "u1", productId: "p1", serial: "PR-1001", status: "an_lager" },
  { id: "u2", productId: "p1", serial: "PR-1002", status: "verkauft", receiptId: "r9", receiptNumber: "0009" },
  { id: "u3", productId: "p1", serial: "PR-1003", status: "retourniert" },
  { id: "u4", productId: "p1", serial: "PR-1004", status: "reserviert" },
];
let n = 0;
const makeItem = () => ({ id: `neu${++n}`, description: "", amount: "", quantity: "1", kind: "service", productId: "", unitId: "", serial: "" });
const blank = () => [{ id: "a", description: "", amount: "", quantity: "1", kind: "service", productId: "", unitId: "", serial: "" }];

describe("Scan beim Verkauf erkennen", () => {
  it("erkennt eine Seriennummer, auch klein geschrieben und mit Leerzeichen", () => {
    const r = resolveSaleScan(" pr-1001 ", { inventory, units });
    expect(r.type).toBe("unit");
    expect(r.unit.id).toBe("u1");
    expect(r.product.id).toBe("p1");
  });

  it("erlaubt reservierte Exemplare", () => {
    expect(resolveSaleScan("PR-1004", { inventory, units }).type).toBe("unit");
  });

  it("erkennt eine Artikelnummer", () => {
    expect(resolveSaleScan("kr-01", { inventory, units })).toMatchObject({ type: "product", product: { id: "p2" } });
  });

  it("meldet verkaufte, retournierte, doppelte und unbekannte Codes", () => {
    expect(resolveSaleScan("PR-1002", { inventory, units }).error).toMatch(/bereits verkauft \(Quittung Nr\. 0009\)/);
    expect(resolveSaleScan("PR-1003", { inventory, units }).error).toMatch(/retourniert/);
    expect(resolveSaleScan("PR-1001", { inventory, units, items: [{ unitId: "u1" }] }).error).toMatch(/bereits auf dieser Quittung/);
    expect(resolveSaleScan("XYZ", { inventory, units }).error).toMatch(/weder eine Seriennummer noch eine Artikelnummer/);
  });

  it("lässt beim Bearbeiten das Exemplar zu, das diese Quittung verkauft hat", () => {
    expect(resolveSaleScan("PR-1002", { inventory, units, editingReceiptId: "r9" }).type).toBe("unit");
  });
});

describe("Scan in die Positionen eintragen", () => {
  it("füllt die leere erste Position mit Artikel und Exemplar", () => {
    const { items } = applySaleScan(blank(), resolveSaleScan("PR-1001", { inventory, units }), makeItem);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "a", kind: "product", productId: "p1", unitId: "u1", serial: "PR-1001", description: "Predator Revo", amount: "890", quantity: "1" });
  });

  it("hängt weitere Stücke als neue Position an", () => {
    const first = applySaleScan(blank(), resolveSaleScan("PR-1001", { inventory, units }), makeItem).items;
    const second = applySaleScan(first, resolveSaleScan("PR-1004", { inventory, units, items: first }), makeItem).items;
    expect(second.map((i) => i.serial)).toEqual(["PR-1001", "PR-1004"]);
  });

  it("zählt bei Artikeln ohne Seriennummer die Menge hoch", () => {
    let list = blank();
    for (let i = 0; i < 3; i++) list = applySaleScan(list, resolveSaleScan("KR-01", { inventory, units }), makeItem).items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ productId: "p2", quantity: "3", amount: "4" });
  });

  it("legt bei Seriennummernpflicht per Artikelnummer eine wartende Position an, die der nächste Scan füllt", () => {
    const step1 = applySaleScan(blank(), resolveSaleScan("PRED-REVO", { inventory, units }), makeItem);
    expect(step1.items[0]).toMatchObject({ productId: "p1", unitId: "" });
    expect(step1.message).toMatch(/Seriennummer scannen/);
    const again = applySaleScan(step1.items, resolveSaleScan("PRED-REVO", { inventory, units }), makeItem);
    expect(again.items).toHaveLength(1);
    const step2 = applySaleScan(step1.items, resolveSaleScan("PR-1001", { inventory, units }), makeItem);
    expect(step2.items).toHaveLength(1);
    expect(step2.items[0]).toMatchObject({ unitId: "u1", serial: "PR-1001" });
  });

  it("lässt eine angefangene Dienstleistung stehen", () => {
    const list = [{ id: "a", description: "Queue neu belegen", amount: "40", kind: "service", productId: "", unitId: "" }];
    const { items } = applySaleScan(list, resolveSaleScan("KR-01", { inventory, units }), makeItem);
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("Queue neu belegen");
  });
});

describe("Belege suchen", () => {
  const receipts = [
    { id: "1", number: "0004", date: "2026-11-08", customer: { name: "Laufkunde" }, items: [{ description: "Kreide" }] },
    { id: "2", number: "0003", date: "2026-11-08", customer: { name: "Marco Rossi", email: "marco@example.ch" }, items: [{ description: "Predator Revo", serial: "PR-1002" }] },
    { id: "3", number: "1", date: "2025-03-01", customer: { name: "Sandra Müller" }, items: [{ description: "Service" }] },
  ];

  it("findet über Nummer, Kunde, Seriennummer und Umlaute", () => {
    expect(receiptMatches(receipts[0], "4")).toBe(true);
    expect(receiptMatches(receipts[1], "rossi")).toBe(true);
    expect(receiptMatches(receipts[1], "pr-1002")).toBe(true);
    expect(receiptMatches(receipts[2], "muller")).toBe(true);
    expect(receiptMatches(receipts[1], "marco kreide")).toBe(false);
  });

  it("zeigt ohne Suche den Zeitraum, mit Suche alle Zeiträume, neueste zuerst", () => {
    expect(filterReceipts(receipts, { year: 2026, month: 10 }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterReceipts(receipts, { year: 2026, month: 10, query: "müller" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterReceipts(receipts, { year: 2025, month: "all" }).map((r) => r.id)).toEqual(["3"]);
  });
});

describe("Kunden suchen", () => {
  const customers = [
    { id: "a", name: "Marco Rossi", email: "marco@example.ch", phone: "+41 79 123 45 67", city: "Schaffhausen" },
    { id: "b", name: "Andrea Marconi", email: "a@example.ch" },
    { id: "c", name: "Sandra Meier", email: "s@example.ch" },
  ];

  it("nennt Treffer am Namensanfang zuerst", () => {
    expect(searchCustomers(customers, "marc").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("findet über Telefon und Ort", () => {
    expect(searchCustomers(customers, "079 123").map((c) => c.id)).toEqual(["a"]);
    expect(searchCustomers(customers, "schaff").map((c) => c.id)).toEqual(["a"]);
  });

  it("zeigt ohne Suchtext alle alphabetisch, begrenzt", () => {
    expect(searchCustomers(customers, "", 2).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

import { detectPreset, suggestPreset, MAIL_PRESETS } from "../shared/mailPresets.js";
import { buildMcpb, mcpbManifest, zipStore } from "../desktop/mcpbExport.js";

describe("E-Mail-Anbieter", () => {
  it("erkennt den gespeicherten Server wieder", () => {
    expect(detectPreset("smtpauths.bluewin.ch")).toBe("bluewin");
    expect(detectPreset(" SMTP.GMAIL.COM ")).toBe("gmail");
    expect(detectPreset("mail.example.ch")).toBe("other");
    expect(detectPreset("")).toBe("");
  });

  it("schlägt den Anbieter anhand der Adresse vor", () => {
    expect(suggestPreset("laden@bluewin.ch")).toBe("bluewin");
    expect(suggestPreset("x@gmx.ch")).toBe("gmx");
    expect(suggestPreset("x@hotmail.com")).toBe("outlook");
    expect(suggestPreset("x@billard-munot.ch")).toBe("");
  });

  it("hat zu jedem Anbieter Server, Verschlüsselung und Port", () => {
    for (const p of MAIL_PRESETS) {
      expect(p.host).toMatch(/\./);
      expect(["ssl", "starttls"]).toContain(p.security);
      expect(p.port).toBe(p.security === "ssl" ? 465 : 587);
    }
  });
});

// Liest ein ungepacktes ZIP (wie zipStore es schreibt) zurück.
function readZip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    files[name] = buf.subarray(i + 30 + nameLen, i + 30 + nameLen + size);
    i += 30 + nameLen + size;
  }
  return files;
}

describe("Erweiterung für Claude Desktop", () => {
  it("setzt Adresse und Token als Vorgabe, das Token als vertraulich", () => {
    const m = mcpbManifest({ version: "1.3.0", port: 47111, token: "geheim" });
    expect(m.manifest_version).toBe("0.3");
    expect(m.server.mcp_config.env).toEqual({ QWUI_API_URL: "${user_config.api_url}", QWUI_API_TOKEN: "${user_config.api_token}" });
    expect(m.server.mcp_config.args).toEqual(["${__dirname}/server/index.mjs"]);
    expect(m.user_config.api_url.default).toBe("http://127.0.0.1:47111");
    expect(m.user_config.api_token).toMatchObject({ sensitive: true, required: true, default: "geheim" });
  });

  it("packt Manifest, Server und Symbol in ein gültiges ZIP", () => {
    const buf = buildMcpb({ version: "1.3.0", port: 47110, token: "t", serverCode: "console.log(1)", icon: Buffer.from([1, 2, 3]) });
    const files = readZip(buf);
    expect(Object.keys(files)).toEqual(["manifest.json", "server/index.mjs", "icon.png"]);
    expect(JSON.parse(files["manifest.json"]).icon).toBe("icon.png");
    expect(files["server/index.mjs"].toString()).toBe("console.log(1)");
    // Ende-Eintrag: drei Dateien
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(3);
  });

  it("schreibt Umlaute im Dateinamen als UTF-8", () => {
    const files = readZip(zipStore([{ name: "ä.txt", data: "x" }]));
    expect(Object.keys(files)).toEqual(["ä.txt"]);
  });
});

import { localDateISO } from "../shared/dates.js";

describe("Datum der Quittung", () => {
  it("nimmt kurz nach Mitternacht den neuen Tag, nicht das UTC-Datum von gestern", () => {
    expect(localDateISO(new Date(2027, 1, 14, 0, 30))).toBe("2027-02-14");
    expect(localDateISO(new Date(2027, 0, 1, 0, 5))).toBe("2027-01-01");
  });
});

import { buildSwissQrPayload, isQrIban, isValidSwissIban } from "../src/qrbill.js";

describe("QR-Rechnung", () => {
  const creditor = { name: "Billard Shop Munot", street: "Vordergasse", houseNumber: "1", postalCode: "8200", city: "Schaffhausen" };

  it("kürzt Adressfelder auf die Längen des Swiss-QR-Standards", () => {
    const lines = buildSwissQrPayload({
      iban: "CH93 0076 2011 6238 5295 7",
      creditor,
      amount: 890,
      debtor: { name: "N".repeat(90), street: "S".repeat(80), houseNumber: "1".repeat(20), postalCode: "8200", city: "C".repeat(50) },
      referenceText: "0001",
      message: "M".repeat(200),
    }).split("\r\n");
    // Schuldner: Zeilen 20–26 (Adresstyp, Name, Strasse, Nr., PLZ, Ort, Land), Mitteilung 29
    expect(lines[20]).toBe("S");
    expect(lines[21]).toHaveLength(70);
    expect(lines[22]).toHaveLength(70);
    expect(lines[23]).toHaveLength(16);
    expect(lines[25]).toHaveLength(35);
    expect(lines[29]).toHaveLength(140);
    expect(lines.at(-1)).toBe("EPD");
  });

  it("erkennt eine QR-IBAN, die mit der Kreditorreferenz nicht funktioniert", () => {
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isValidSwissIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH93 0076 2011 6238 5295 7")).toBe(false);
  });
});
