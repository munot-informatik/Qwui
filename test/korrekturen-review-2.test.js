// Korrekturen aus der zweiten Gesamtdurchsicht (Code- und Sicherheitsprüfung).
// - Web: Schreibschutz gegen fremde Seiten gilt für jeden Pfad (Cloudflare
//   ordnet «/API/storage» ebenfalls der Speicher-API zu), und die API nimmt
//   nur JSON an.
// - Belege: offen + bezahlt = Total, auch wenn Rechnung und Gutschrift in
//   verschiedenen Monaten liegen.
// - Assistent: offene Rechnungen mit Gruppe abzüglich der Gutschriften.
// - QR-Zahlteil: «Zahlbar durch» nur, wenn der Schuldner auch im QR-Code steht.

import { describe, it, expect } from "vitest";
import { onRequest } from "../functions/_middleware.js";
import { onRequestPost as postStorage } from "../functions/api/storage.js";
import { onRequestPost as postBatch } from "../functions/api/storage-batch.js";
import { periodTotals, reopenOrphanedQuotes } from "../shared/documents.js";
import { salesReport } from "../shared/reports.js";
import { hasQrDebtor } from "../src/pdfGenerator.js";
import { buildReceiptPdfBytes } from "../src/receiptPdf.js";
import { pdfText } from "./helpers/pdfText.js";
import { makeReceipt } from "./helpers/fixtures.js";

const PASSWORD = "richtig-langes-passwort";

// D1-Ersatz: genug für Rate-Limit und Schreibzugriffe.
function fakeDb() {
  const writes = [];
  const stmt = (sql) => ({
    bind: (...args) => ({
      first: async () => null,
      run: async () => {
        writes.push({ sql, args });
        return {};
      },
      sql,
      args,
    }),
  });
  return {
    writes,
    prepare: stmt,
    batch: async (statements) => {
      writes.push(...statements.map((s) => ({ sql: s.sql, args: s.args })));
      return [];
    },
  };
}

function request(path, { method = "POST", headers = {}, body } = {}) {
  return new Request(`https://qwui.example${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`qwui:${PASSWORD}`)}`, ...headers },
    body,
  });
}

async function viaMiddleware(req) {
  let passed = false;
  const res = await onRequest({
    request: req,
    env: { SITE_PASSWORD: PASSWORD, DB: fakeDb() },
    next: async () => {
      passed = true;
      return new Response("ok");
    },
  });
  return { status: res.status, passed };
}

describe("Web: Schreibschutz gegen fremde Seiten", () => {
  it("weist einen fremden Schreibzugriff auch mit grossgeschriebenem Pfad ab", async () => {
    for (const path of ["/api/storage", "/API/storage", "/Api/Storage-Batch"]) {
      const r = await viaMiddleware(request(path, { headers: { "Sec-Fetch-Site": "cross-site" }, body: "{}" }));
      expect(r, path).toEqual({ status: 403, passed: false });
    }
    const fremd = await viaMiddleware(request("/API/storage", { headers: { Origin: "https://boese.example" }, body: "{}" }));
    expect(fremd).toEqual({ status: 403, passed: false });
  });

  it("lässt die eigene Seite schreiben und fremde Seiten lesen nichts Neues", async () => {
    expect(await viaMiddleware(request("/api/storage", { headers: { "Sec-Fetch-Site": "same-origin" }, body: "{}" }))).toEqual({
      status: 200,
      passed: true,
    });
    expect(await viaMiddleware(request("/", { method: "GET", headers: { "Sec-Fetch-Site": "cross-site" } }))).toEqual({
      status: 200,
      passed: true,
    });
  });

  it("speichert nur mit Content-Type application/json", async () => {
    const body = JSON.stringify({ key: "company-info", value: "{}" });
    for (const post of [postStorage, postBatch]) {
      const db = fakeDb();
      const plain = new Request("https://qwui.example/api/storage", { method: "POST", headers: { "Content-Type": "text/plain" }, body });
      const res = await post({ request: plain, env: { DB: db } });
      expect(res.status).toBe(415);
      expect(db.writes).toHaveLength(0);
    }
    const db = fakeDb();
    const ok = new Request("https://qwui.example/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    });
    expect((await postStorage({ request: ok, env: { DB: db } })).status).toBe(200);
    expect(db.writes.length).toBeGreaterThan(0);
  });
});

describe("Belege: Summen eines Zeitraums", () => {
  const invoice = { id: "r1", date: "2027-10-05", total: 980, qrBillEnabled: true, paid: false };
  const credit = { id: "g1", receiptId: "r1", date: "2027-11-02", total: 450 };

  it("rechnet eine Gutschrift im Folgemonat nicht als bezahlt", () => {
    expect(periodTotals([invoice], [], [invoice])).toEqual({ receipts: 980, credits: 0, total: 980, open: 980, paid: 0 });
    expect(periodTotals([], [credit], [invoice])).toEqual({ receipts: 0, credits: 450, total: -450, open: -450, paid: 0 });
    expect(periodTotals([invoice], [credit], [invoice])).toEqual({ receipts: 980, credits: 450, total: 530, open: 530, paid: 0 });
  });

  it("zieht die Rückerstattung einer bezahlten Quittung vom Bezahlten ab", () => {
    const paid = { id: "r2", date: "2027-10-05", total: 300, qrBillEnabled: false, paid: true };
    const refund = { id: "g2", receiptId: "r2", date: "2027-11-02", total: 100 };
    expect(periodTotals([], [refund], [paid])).toEqual({ receipts: 0, credits: 100, total: -100, open: 0, paid: -100 });
  });
});

describe("Offerten ohne ihre Quittung", () => {
  it("öffnet angenommene Offerten wieder, deren Quittung fehlt", () => {
    const quotes = [
      { id: "q1", number: "O-0001", status: "angenommen", receiptId: "r1", receiptNumber: "0001", decidedAt: "x" },
      { id: "q2", number: "O-0002", status: "angenommen", receiptId: "r2", receiptNumber: "0002", decidedAt: "x" },
      { id: "q3", number: "O-0003", status: "abgelehnt", decidedAt: "x" },
    ];
    const next = reopenOrphanedQuotes(quotes, [{ id: "r2" }]);
    expect(next[0]).toEqual({ id: "q1", number: "O-0001", status: "offen", decidedAt: null });
    expect(next[1]).toBe(quotes[1]);
    expect(next[2]).toBe(quotes[2]);
    // Nichts zu tun: dieselbe Liste, damit nichts gespeichert wird.
    expect(reopenOrphanedQuotes(quotes, [{ id: "r1" }, { id: "r2" }])).toBe(quotes);
  });
});

describe("Assistent: offene Rechnungen mit Produktgruppe", () => {
  it("zieht Gutschriften auch mit Gruppenfilter vom offenen Betrag ab", () => {
    const inventory = [
      { id: "p1", articleNumber: "Q-1", name: "Queue", group: "Queues", price: 500 },
      { id: "p2", articleNumber: "K-1", name: "Kreide", group: "Zubehör", price: 5 },
    ];
    const items = [
      { id: "a", kind: "product", productId: "p1", description: "Queue", amount: 500, quantity: 1 },
      { id: "b", kind: "product", productId: "p2", description: "Kreide", amount: 5, quantity: 2 },
    ];
    const receipts = [{ id: "r1", date: "2027-03-01", total: 510, qrBillEnabled: true, paid: false, items }];
    const creditNotes = [{ id: "g1", receiptId: "r1", date: "2027-03-05", total: 500, items: [{ ...items[0], sourceItemId: "a" }] }];
    const queues = salesReport(receipts, inventory, { group: "Queues" }, creditNotes);
    expect(queues.openInvoices).toBe(0);
    const zubehoer = salesReport(receipts, inventory, { group: "Zubehör" }, creditNotes);
    expect(zubehoer.openInvoices).toBe(10);
    expect(salesReport(receipts, inventory, {}, creditNotes).openInvoices).toBe(10);
  });
});

describe("QR-Zahlteil: Zahlbar durch", () => {
  it("zeigt den Schuldner nur mit vollständiger Adresse, sonst ein leeres Feld", async () => {
    expect(hasQrDebtor({ name: "Laufkunde" })).toBe(false);
    expect(hasQrDebtor({ name: "Sandra Meier", postalCode: "8200", city: "Schaffhausen" })).toBe(true);

    const items = [{ id: "a", description: "Montage", amount: 120, quantity: 1 }];
    const ohne = pdfText(await buildReceiptPdfBytes(makeReceipt({ items, qrBillEnabled: true, customer: { name: "Laufkunde" } })));
    expect(ohne).toContain("Zahlbar durch (Name/Adresse)");
    // Nur noch beim Empfänger oben, nicht mehr im Zahlteil.
    expect(ohne.split("Laufkunde").length - 1).toBe(1);

    const mit = pdfText(
      await buildReceiptPdfBytes(
        makeReceipt({ items, qrBillEnabled: true, customer: { name: "Sandra Meier", street: "Vordergasse", houseNumber: "3", postalCode: "8200", city: "Schaffhausen" } })
      )
    );
    expect(mit).not.toContain("Zahlbar durch (Name/Adresse)");
    expect(mit).toContain("8200 Schaffhausen");
  });
});
