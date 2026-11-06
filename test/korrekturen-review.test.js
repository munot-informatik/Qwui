// Fehler aus der Durchsicht von 1.2.0, jeweils mit dem Fall, an dem sie
// aufgefallen sind: falsche Beträge und Mengen, verlorene Daten, Personendaten
// an Stellen, wo sie nicht hingehören.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeQuantity, isCompleteItem, parseNumberCell, nextReceiptNumber } from "../shared/items.js";
import { bookReceipt, reverseReceipt, rebookReceipt, receiveGoods, changeUnitStatus } from "../shared/stock.js";
import { receiptCustomerSnapshot, redactEmails } from "../shared/consent.js";
import { salesReport, slowMovers } from "../shared/reports.js";
import { buildBackupPayload } from "../shared/backupFormat.js";
import { restoreLogos } from "../src/webLogoStore.js";
import { openStore } from "../desktop/sqliteStore.js";
import { createAutoBackup, backupFileName, KEEP } from "../desktop/autoBackup.js";
import { createShopSync } from "../desktop/shopSync.js";
import { buildReceiptPdfBytes } from "../src/receiptPdf.js";
import { pdfText } from "./helpers/pdfText.js";
import { makeReceipt } from "./helpers/fixtures.js";

function ctx() {
  let n = 0;
  return { now: "2027-02-13T10:00:00.000Z", source: "app", newId: () => `id${++n}` };
}

const QUEUE = { id: "q", articleNumber: "PRED", name: "Predator", group: "Queues", price: 890, stock: 1, serialTracked: true };
const unit = (extra = {}) => ({ id: "u1", productId: "q", serial: "S-1", status: "an_lager", ...extra });
const receipt = (extra = {}) => ({
  id: "r1",
  number: "0007",
  customer: { id: "c1" },
  items: [{ kind: "product", productId: "q", unitId: "u1" }],
  ...extra,
});

describe("Positionen", () => {
  it("zählt nur vollständige Positionen", () => {
    expect(isCompleteItem({ description: "Kreide", amount: "4" })).toBe(true);
    expect(isCompleteItem({ description: "", amount: "50" })).toBe(false);
    expect(isCompleteItem({ description: "Gutschrift", amount: "-5" })).toBe(false);
    expect(isCompleteItem({ description: "Kreide", amount: "" })).toBe(false);
  });

  it.each([
    ["3", 3],
    ["", 1],
    ["0", 1],
    ["-3", 1],
    ["abc", 1],
    ["2.5", 3],
  ])("macht aus der Menge «%s» die Stückzahl %i", (eingabe, menge) => {
    expect(normalizeQuantity(eingabe)).toBe(menge);
  });
});

describe("Excel-Zellen", () => {
  it("liest leere Zellen und Text als keine Angabe, nicht als 0", () => {
    expect(parseNumberCell("")).toBeNull();
    expect(parseNumberCell(null)).toBeNull();
    expect(parseNumberCell("   ")).toBeNull();
    expect(parseNumberCell("abc")).toBeNull();
    expect(parseNumberCell(0)).toBe(0);
    expect(parseNumberCell("0")).toBe(0);
    expect(parseNumberCell("1'290.50")).toBe(1290.5);
  });
});

describe("Quittungsnummer", () => {
  it("vergibt die Nummer einer gelöschten Quittung nicht neu", () => {
    expect(nextReceiptNumber([{ number: "0001" }])).toBe("0002");
    expect(nextReceiptNumber([{ number: "0001" }], 2)).toBe("0003");
    expect(nextReceiptNumber([{ number: "0009" }], 2)).toBe("0010");
    expect(nextReceiptNumber([], 0)).toBe("0001");
  });

  it("kommt mit ins Backup", () => {
    expect(buildBackupPayload({ lastReceiptNumber: 12 }).lastReceiptNumber).toBe(12);
  });
});

describe("Lagerbuchungen", () => {
  it("setzt ein reserviertes Exemplar beim Storno wieder auf reserviert", () => {
    const state = { inventory: [QUEUE], units: [unit({ status: "reserviert" })] };
    const sold = bookReceipt(state, receipt(), ctx());
    expect(sold.units[0].status).toBe("verkauft");
    const back = reverseReceipt(sold, sold.receipt, ctx());
    expect(back.units[0].status).toBe("reserviert");
    expect(back.inventory[0].stock).toBe(0);
  });

  it("lässt eine Quittung mit retourniertem Exemplar bearbeiten, ohne neu zu buchen", () => {
    const c = ctx();
    const sold = bookReceipt({ inventory: [QUEUE], units: [unit()] }, receipt(), c);
    const returned = changeUnitStatus(sold, "u1", "retourniert", c);
    const edited = rebookReceipt(returned, sold.receipt, receipt({ note: "Tippfehler korrigiert" }), c);
    expect(edited.errors).toEqual([]);
    expect(edited.movements).toEqual([]);
    expect(edited.units[0].status).toBe("retourniert");
    expect(edited.receipt.note).toBe("Tippfehler korrigiert");
  });

  it("lässt auch nach dem Weiterverkauf des Exemplars bearbeiten und nimmt es dem neuen Käufer nicht weg", () => {
    const c = ctx();
    const sold = bookReceipt({ inventory: [QUEUE], units: [unit()] }, receipt(), c);
    const returned = changeUnitStatus(sold, "u1", "retourniert", c);
    const again = changeUnitStatus(returned, "u1", "an_lager", c);
    const resold = bookReceipt(again, receipt({ id: "r2", number: "0008", customer: { id: "c2" } }), c);
    const edited = rebookReceipt(resold, sold.receipt, receipt({ note: "x" }), c);
    expect(edited.errors).toEqual([]);
    expect(edited.units[0]).toMatchObject({ status: "verkauft", receiptId: "r2", customerId: "c2" });
  });

  it("verkauft weiterhin kein retourniertes Exemplar auf einer anderen Quittung", () => {
    const c = ctx();
    const sold = bookReceipt({ inventory: [QUEUE], units: [unit()] }, receipt(), c);
    const returned = changeUnitStatus(sold, "u1", "retourniert", c);
    const other = bookReceipt(returned, receipt({ id: "r3" }), c);
    expect(other.errors[0]).toMatch(/nicht an Lager/);
  });

  it("warnt, wenn der Artikel inzwischen seriennummernpflichtig ist, statt ein falsches Storno zu buchen", () => {
    const inventory = [{ ...QUEUE, stock: 0 }];
    const old = { id: "r1", number: "1", stockBooking: [{ productId: "q", qty: 2 }] };
    const r = reverseReceipt({ inventory, units: [] }, old, ctx());
    expect(r.movements).toEqual([]);
    expect(r.warnings[0]).toMatch(/inzwischen seriennummernpflichtig/);
  });

  it("behält beim Wareneingang ohne Seriennummer Einkaufspreis und Bemerkung", () => {
    const kreide = { id: "k", articleNumber: "KR", name: "Kreide", stock: 1, price: 4 };
    const r = receiveGoods({ inventory: [kreide], units: [] }, { productId: "k", quantity: 5, purchasePrice: "3.5", note: " LS-42 " }, ctx());
    expect(r.movements[0]).toMatchObject({ qty: 5, purchasePrice: 3.5, ref: { note: "LS-42" } });
  });

  it("lehnt Bruchteile im Wareneingang ab", () => {
    const kreide = { id: "k", name: "Kreide", stock: 1 };
    expect(receiveGoods({ inventory: [kreide], units: [] }, { productId: "k", quantity: 2.5 }, ctx()).errors).toHaveLength(1);
  });
});

describe("E-Mail-Adresse", () => {
  const ohne = { name: "Hans", email: "hans@example.ch" };

  it("nimmt ohne Einverständnis keine neue Adresse auf den Beleg", () => {
    expect(receiptCustomerSnapshot(ohne, null).email).toBe("");
    expect(receiptCustomerSnapshot(ohne, { email: "andere@example.ch" }).email).toBe("");
  });

  it("lässt beim Bearbeiten eine Adresse stehen, die schon auf dem Beleg stand", () => {
    expect(receiptCustomerSnapshot(ohne, { email: "hans@example.ch" }).email).toBe("hans@example.ch");
  });

  it("entfernt Adressen aus Fehlermeldungen des Mailservers", () => {
    const text = "Can't send mail - all recipients were rejected: 550 5.1.1 <kunde@example.ch>: Recipient address rejected";
    expect(redactEmails(text)).toBe("Can't send mail - all recipients were rejected: 550 5.1.1 <[Adresse]>: Recipient address rejected");
  });
});

describe("Assistent", () => {
  const inventory = [{ id: "q", articleNumber: "PRED", name: "Predator", group: "Queues", price: 890, stock: 1 }];

  it("gibt beim Umsatz den Inventarnamen weiter, nicht den Freitext der Position", () => {
    const r = salesReport(
      [
        {
          date: "2027-02-01",
          total: 940,
          items: [
            { kind: "product", productId: "q", articleNumber: "PRED", description: "Queue für Hans Mueller 079 123 45 67", amount: "890" },
            { kind: "product", description: "Reparatur bei Hans Mueller", amount: "50" },
          ],
        },
      ],
      inventory,
      {}
    );
    const text = JSON.stringify(r);
    expect(text).not.toContain("Hans");
    expect(text).not.toContain("079");
    expect(r.topArticles[0]).toEqual({ articleNumber: "PRED", name: "Predator", quantity: 1, revenue: 890 });
    expect(r.topArticles[1]).toEqual({ articleNumber: "", name: "(freie Position)", quantity: 1, revenue: 50 });
  });

  it("nennt frisch eingegangene Artikel nicht als Ladenhüter", () => {
    const movements = [{ type: "wareneingang", productId: "q", at: "2027-02-12T09:00:00.000Z", qty: 1 }];
    expect(slowMovers(inventory, [], movements, { days: 30, now: new Date("2027-02-13T10:00:00.000Z") }).articles).toEqual([]);
  });
});

describe("Logos", () => {
  it("behält im Web die Referenz, wenn das Laden scheitert, und findet das Logo später wieder", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const receipts = [{ id: "r1", company: { name: "A", logoRef: "logo:test-fehler" } }];
    const failed = await restoreLogos(receipts, async () => {
      throw new Error("offline");
    });
    expect(failed[0].company.logoRef).toBe("logo:test-fehler");
    const ok = await restoreLogos(failed, async () => "data:image/png;base64,AAAA");
    expect(ok[0].company).toEqual({ name: "A", logoDataUrl: "data:image/png;base64,AAAA" });
    vi.restoreAllMocks();
  });

  it("behält unter Windows die Referenz, wenn die Logo-Datei fehlt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qwui-logo-"));
    const store = openStore(join(dir, "qwui.db"), { storeLogo: async () => null, loadLogo: async () => "" });
    await store.set("receipts-list", JSON.stringify([{ id: "r1", company: { logoRef: "abc.png", logoMime: "image/png" } }]));
    const read = JSON.parse((await store.get("receipts-list")).value);
    expect(read[0].company.logoRef).toBe("abc.png");
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Sicherung", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qwui-rotate-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("gilt als gelungen, auch wenn sich alte Dateien nicht löschen lassen", async () => {
    // Ordner statt Dateien: unlink scheitert wie an einer vom Cloud-Client gesperrten Datei.
    for (let d = 0; d < KEEP.stuendlich + 2; d++) mkdirSync(join(dir, backupFileName("stuendlich", new Date(2027, 0, 1 + d))));
    let status = null;
    const b = createAutoBackup({
      buildPayload: async () => ({ a: 1 }),
      getConfig: () => ({ enabled: true, dir }),
      getPassword: () => "ein-langes-passwort",
      readStatus: () => status,
      writeStatus: (s) => (status = s),
      now: () => new Date(2027, 2, 1),
    });
    await b.runBackup("stuendlich");
    expect(status.stuendlich.ok).toBe(true);
    expect(status.stuendlich.rotateWarning).toMatch(/nicht aufgeräumt/);
    expect(readdirSync(dir).length).toBe(KEEP.stuendlich + 3);
  });
});

describe("Shop-Abgleich", () => {
  it("holt beim nächsten Anstoss nach, was vor dem Schliessen gescheitert ist", async () => {
    let status = { webhook: { ok: false, fingerprint: "f", target: "https://shop.example.ch/feed", error: "HTTP 503" } };
    const calls = [];
    const timers = [];
    const s = createShopSync({
      buildFeed: async () => ({ feed: { items: [] }, csv: "", fingerprint: "f" }),
      getConfig: () => ({ webhookEnabled: true, webhookUrl: "https://shop.example.ch/feed" }),
      getToken: () => null,
      readStatus: () => status,
      writeStatus: (x) => (status = x),
      fetch: async (url) => {
        calls.push(url);
        return { ok: true, status: 204 };
      },
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    });
    s.trigger();
    await timers.at(-1)();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(status.webhook.ok).toBe(true);
  });
});

describe("Beleg", () => {
  it("setzt Menge und Stückpreis bei Rabatt auf eine eigene Zeile, wenn sie sonst den Listenpreis überdecken", async () => {
    const text = pdfText(
      await buildReceiptPdfBytes(
        makeReceipt({
          items: [
            {
              id: "a",
              kind: "product",
              description: "Sehr langes Billardqueue mit Zubehör und Etui",
              amount: "890",
              quantity: 2,
              discountPercent: 10,
              articleNumber: "PRED-REVO-129",
            },
          ],
        })
      )
    );
    expect(text).toContain("PRED-REVO-129 · à CHF 890.00");
    expect(text).toContain("Rabatt 10 %");
  });
});
