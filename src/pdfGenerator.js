// Client-seitige PDF-Erzeugung mit pdf-lib — läuft direkt im Browser, kein
// Server-Umweg mehr. Jedes Element wird selbst mit exakten Koordinaten
// platziert — die Position der QR-Rechnung am unteren Seitenrand ist dadurch
// garantiert korrekt, unabhängig von Browser-/Druck-Engine-Eigenheiten, die
// bei der reinen CSS-Druck-Lösung im Weg standen.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MM = 2.834645669; // 1mm in PDF-Punkten
const mm = (v) => v * MM;

const PAGE_W = mm(210);
const PAGE_H = mm(297);
const MARGIN = mm(15);

const COLOR = {
  ink: rgb(0.086, 0.094, 0.114),
  red: rgb(0.89, 0.024, 0.075),
  gray: rgb(0.44, 0.455, 0.486),
  lightGray: rgb(0.545, 0.56, 0.588),
  line: rgb(0.855, 0.867, 0.882),
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
};

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Die eingebetteten Standardschriften (Helvetica) können nur WinAnsi/Latin-1
// codieren — pdf-lib wirft bei jedem anderen Zeichen einen harten Fehler und
// die GESAMTE PDF-Erzeugung bricht ab. In der Schweiz sind Namen wie "Šarić",
// "Đorđević" oder "Łukasz" alltäglich, d.h. für diese Kunden liesse sich sonst
// nie eine PDF/Mahnung erstellen. Darum werden solche Zeichen hier auf ihre
// nächstliegende Latin-1-Entsprechung abgebildet (Umlaute/Akzente bleiben
// unverändert, die sind in WinAnsi enthalten) und alles restlos Unbekannte
// wird zu "?" — eine PDF mit einem ersetzten Zeichen ist deutlich besser als
// gar keine PDF.
const TRANSLITERATIONS = {
  Š: "S", š: "s", Ž: "Z", ž: "z", Č: "C", č: "c", Ć: "C", ć: "c",
  Đ: "Dj", đ: "dj", Ł: "L", ł: "l", Ń: "N", ń: "n", Ő: "O", ő: "o",
  Ř: "R", ř: "r", Ś: "S", ś: "s", Ş: "S", ş: "s", Ť: "T", ť: "t",
  Ű: "U", ű: "u", Ź: "Z", ź: "z", Ż: "Z", ż: "z", Ě: "E", ě: "e",
  Ď: "D", ď: "d", Ň: "N", ň: "n", Ų: "U", ų: "u", Ā: "A", ā: "a",
  Ē: "E", ē: "e", Ī: "I", ī: "i", Ū: "U", ū: "u", Ğ: "G", ğ: "g",
  İ: "I", ı: "i", Ș: "S", ș: "s", Ț: "T", ț: "t", Ả: "A", ả: "a",
  "‐": "-", "‑": "-", "‒": "-", "−": "-", "→": "->", "←": "<-",
  "≥": ">=", "≤": "<=", "≠": "!=", "…": "...", "„": '"', "‚": "'",
};

// WinAnsi (CP1252) deckt ASCII, Latin-1 und einige Sonderzeichen im Bereich
// 0x80–0x9F ab. Alles ausserhalb kann Helvetica nicht darstellen.
const WINANSI_EXTRA = new Set([
  "€", "‚", "ƒ", "„", "…", "†", "‡", "ˆ", "‰", "Š", "‹", "Œ", "Ž",
  "‘", "’", "“", "”", "•", "–", "—", "˜", "™", "š", "›", "œ", "ž", "Ÿ",
]);

function isWinAnsiEncodable(ch) {
  const code = ch.codePointAt(0);
  if (code === 0x20ac || WINANSI_EXTRA.has(ch)) return true;
  // C0/C1-Steuerzeichen ausgenommen, sonst ASCII + Latin-1-Supplement.
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return false;
}

export function toWinAnsiSafe(str) {
  const input = str == null ? "" : String(str);
  let out = "";
  for (const ch of input) {
    if (isWinAnsiEncodable(ch)) {
      out += ch;
    } else if (TRANSLITERATIONS[ch]) {
      out += TRANSLITERATIONS[ch];
    } else {
      // Kombinierende Akzente abtrennen (z.B. "ệ" -> "e"), sonst "?".
      const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += stripped && [...stripped].every(isWinAnsiEncodable) ? stripped : "?";
    }
  }
  return out;
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Normalsatz Schweiz, identisch zu VAT_RATE in src/App.jsx. Nur als Rückfall
// gedacht: Quittungen speichern ihren eigenen vatRate mit, damit alte Belege
// nach einer Satzänderung weiterhin ihren damaligen Satz zeigen.
const FALLBACK_VAT_RATE = 0.081;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Zahlungsfrist einer Rechnung in Tagen; 30 als Rückfall für Belege ohne Feld
// (identisch zur Definition in src/App.jsx, bewusst dupliziert wie die anderen
// kleinen Helfer hier).
function paymentTermOf(receipt) {
  const d = Number(receipt?.paymentTermDays);
  return Number.isFinite(d) && d >= 0 ? d : 30;
}

function dayWord(n) {
  return n === 1 ? "Tag" : "Tagen";
}

// ---- Positionen: Produkt/Dienstleistung, Listpreis, Rabatt ----
// Spiegelt bewusst die Helfer aus src/App.jsx (gleiches Duplizierungs-Muster
// wie chf/formatDateDE). "amount" ist der Listpreis, verrechnet wird der
// Betrag nach Rabatt.

function itemKind(it) {
  return it?.kind === "product" ? "product" : "service";
}

function itemListPrice(it) {
  return Number(it?.amount) || 0;
}

function itemDiscountPercent(it) {
  const raw = Number(it?.discountPercent);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(100, raw);
}

function itemLineTotal(it) {
  const gross = itemListPrice(it);
  return round2(gross - round2((gross * itemDiscountPercent(it)) / 100));
}

function formatPercent(p) {
  return Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100);
}

function receiptListTotal(receipt) {
  return round2((receipt.items || []).reduce((s, it) => s + itemListPrice(it), 0));
}

function receiptDiscountTotal(receipt) {
  return round2(receiptListTotal(receipt) - round2((receipt.items || []).reduce((s, it) => s + itemLineTotal(it), 0)));
}

function ibanDisplay(iban) {
  return (iban || "").replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

// Firmenangaben für den Seitenfuss: Adresse, Kontakt/MWST und Bankverbindung.
function footerColumns(company) {
  const qr = company.qrBill || {};
  return [
    { title: "ADRESSE", lines: [company.name, company.address, company.zipCity].filter(Boolean) },
    {
      title: "KONTAKT",
      lines: [
        company.email ? `E-Mail: ${company.email}` : "",
        company.phone ? `Telefon: ${company.phone}` : "",
        company.vatNumber ? `MWST-Nr. ${company.vatNumber}` : "",
      ].filter(Boolean),
    },
    {
      title: "BANKVERBINDUNG",
      lines: [
        qr.iban ? `IBAN: ${ibanDisplay(qr.iban)}` : "",
        qr.name && qr.name !== company.name ? `Kontoinhaber: ${qr.name}` : "",
      ].filter(Boolean),
    },
  ].filter((c) => c.lines.length > 0);
}

// Höhe des Fusszeilen-Blocks — wird gebraucht, um vorher zu prüfen, ob er
// noch auf die Seite passt.
function footerBlockHeight(company) {
  const columns = footerColumns(company || {});
  if (columns.length === 0) return 0;
  const maxLines = Math.max(...columns.map((c) => c.lines.length));
  return 9 + maxLines * 9;
}

// Zeichnet die Fusszeile fix am unteren Seitenrand. bottomY erlaubt es, sie
// oberhalb eines Einzahlungsscheins zu platzieren.
function drawFooter(page, company, { font, fontBold }, bottomY = MARGIN) {
  const columns = footerColumns(company || {});
  if (columns.length === 0) return;

  const usableW = PAGE_W - 2 * MARGIN;
  const colW = usableW / columns.length;
  const maxLines = Math.max(...columns.map((c) => c.lines.length));
  const blockH = 9 + maxLines * 9;
  const topY = bottomY + blockH;

  page.drawLine({
    start: { x: MARGIN, y: topY },
    end: { x: PAGE_W - MARGIN, y: topY },
    thickness: 0.5,
    color: COLOR.line,
  });

  columns.forEach((col, i) => {
    const x = MARGIN + i * colW;
    let ly = topY - 9;
    page.drawText(toWinAnsiSafe(col.title), {
      x,
      y: ly,
      size: 6,
      font: fontBold,
      color: COLOR.lightGray,
    });
    ly -= 9;
    col.lines.forEach((l) => {
      page.drawText(toWinAnsiSafe(l), { x, y: ly, size: 7, font, color: COLOR.gray });
      ly -= 9;
    });
  });
}

// Liefert Satz, Netto und MWST-Betrag für die Aufschlüsselung. Ältere bzw. aus
// einem Backup importierte Quittungen können vatRate/netTotal/vatAmount nicht
// gesetzt haben — ohne diese Rückfälle stünde dann "MWST 0.0 %" und
// "Netto CHF 0.00" auf der PDF, während die Bildschirmansicht (die 8.1 % fest
// verdrahtet hat) etwas anderes zeigt.
function vatFigures(receipt) {
  const total = Number(receipt.total) || 0;
  const rate = Number(receipt.vatRate) > 0 ? Number(receipt.vatRate) : FALLBACK_VAT_RATE;
  const netTotal = Number(receipt.netTotal) > 0 ? Number(receipt.netTotal) : round2(total / (1 + rate));
  const vatAmount = Number(receipt.vatAmount) > 0 ? Number(receipt.vatAmount) : round2(total - netTotal);
  return { rate, netTotal, vatAmount };
}

// Bricht einen Text so um, dass jede Zeile innerhalb von maxWidth passt.
function wrapText(text, font, size, maxWidth) {
  const words = toWinAnsiSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// Lokales Kalenderdatum von "heute" (nicht toISOString(), das liefert das
// UTC-Datum — für Nutzer in der Schweiz z.B. nachts zwischen 00:00 und
// 01:00/02:00 Uhr fälschlich noch das Datum von gestern).
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Reine Kalenderdatum-Arithmetik, komplett in UTC verankert (Konstruktion
// UND Ausgabe), damit sie unabhängig von der lokalen Zeitzone ist. Mit
// lokaler Konstruktion + toISOString()-Ausgabe (frühere Version) verschob
// sich das Ergebnis in der Schweiz (UTC+1/+2) immer um einen Tag zurück,
// weil lokale Mitternacht in UTC auf den Vorabend fällt.
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenISO(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.round((to - from) / 86400000));
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl || "");
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

// Bettet ein hochgeladenes Firmenlogo (data: URL) ins PDF ein. Gibt null
// zurück, falls kein Logo gesetzt ist oder das Format nicht unterstützt wird
// (statt die PDF-Erzeugung mit einem Fehler abzubrechen).
async function embedLogo(pdfDoc, logoDataUrl) {
  if (!logoDataUrl) return null;
  const parsed = parseDataUrl(logoDataUrl);
  if (!parsed) return null;
  try {
    if (parsed.mime === "image/png") return await pdfDoc.embedPng(parsed.bytes);
    if (parsed.mime === "image/jpeg" || parsed.mime === "image/jpg") return await pdfDoc.embedJpg(parsed.bytes);
  } catch (e) {
    console.error("Logo konnte nicht ins PDF eingebettet werden", e);
  }
  return null;
}

// Maximale Logo-Abmessungen je gewählter Grösse.
const LOGO_SIZES = {
  small: { w: mm(24), h: mm(10) },
  medium: { w: mm(32), h: mm(14) },
  large: { w: mm(45), h: mm(20) },
};

function logoBox(company) {
  return LOGO_SIZES[company?.logoSize] || LOGO_SIZES.medium;
}

// Anordnung des Logos: neben dem Firmen-Textblock ("inline") oder auf einer
// eigenen Zeile darüber ("above"). Firmendaten ohne diese Einstellung
// verhalten sich wie bisher: links = neben dem Text, mittig/rechts = darüber.
function logoLayoutOf(company) {
  if (company?.logoLayout === "above" || company?.logoLayout === "inline") return company.logoLayout;
  return (company?.logoPosition || "left") === "left" ? "inline" : "above";
}

// Ausrichtung innerhalb der eigenen Zeile (nur bei "above" wirksam).
function logoAlignOf(company) {
  const p = company?.logoPosition || "left";
  return p === "center" || p === "right" ? p : "left";
}

// Zeichnet das Firmenlogo im Kopf und liefert { textX, topY }: x-Position für
// den Firmen-Textblock und die y-Position, ab der Firmen- und Titelblock
// beginnen. Bei "above" rückt alles unter das Logo, damit es rechts nicht mit
// dem Titelblock (RECHNUNG / Nr. / Datum) kollidiert.
function drawLogo(page, logoImage, company, marginX, pageW, topY) {
  if (!logoImage) return { textX: marginX, topY };
  const box = logoBox(company);
  const scale = Math.min(box.w / logoImage.width, box.h / logoImage.height);
  const w = logoImage.width * scale;
  const h = logoImage.height * scale;

  if (logoLayoutOf(company) === "inline") {
    page.drawImage(logoImage, { x: marginX, y: topY - h, width: w, height: h });
    return { textX: marginX + w + mm(7), topY };
  }

  const align = logoAlignOf(company);
  const x = align === "center" ? (pageW - w) / 2 : align === "right" ? pageW - marginX - w : marginX;
  page.drawImage(logoImage, { x, y: topY - h, width: w, height: h });
  return { textX: marginX, topY: topY - h - mm(9) };
}

export async function generateReceiptPdf(receipt, qrPngBytes) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function text(str, x, yPos, { size = 9, f = font, color = COLOR.ink } = {}) {
    page.drawText(toWinAnsiSafe(str), { x, y: yPos, size, font: f, color });
  }

  function line(x1, yPos, x2, color = COLOR.line, width = 1) {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness: width, color });
  }

  // ---- Kopfzeile: Logo (Position wählbar) + Firma links, Titel rechts ----
  const company = receipt.company || {};
  const logoImage = await embedLogo(pdfDoc, company.logoDataUrl);
  const head = drawLogo(page, logoImage, company, MARGIN, PAGE_W, y);
  const textX = head.textX;
  y = head.topY;
  let leftY = y;
  text(company.name || "Firma", textX, leftY, { size: 12, f: fontBold });
  leftY -= 14;
  // MWST-Nummer gehört auf jede Rechnung eines steuerpflichtigen Unternehmens
  // (Art. 26 MWSTG) — sie stand bisher nur in der Bildschirm-Vorschau, nicht
  // in der PDF, die der Kunde tatsächlich bekommt.
  [
    company.address,
    company.zipCity,
    company.email,
    company.phone,
    company.vatNumber ? `MWST-Nr. ${company.vatNumber}` : "",
  ]
    .filter(Boolean)
    .forEach((l) => {
      text(l, textX, leftY, { size: 8.5, color: COLOR.gray });
      leftY -= 11;
    });

  const rightX = PAGE_W - MARGIN;
  // Mit aktivierter QR-Rechnung ist die Quittung noch nicht bezahlt und
  // fungiert als Rechnung — Titel entsprechend anpassen.
  const titleStr = receipt.qrBillEnabled ? "RECHNUNG" : "QUITTUNG";
  const titleWidth = fontBold.widthOfTextAtSize(titleStr, 17);
  text(titleStr, rightX - titleWidth, y - 2, { size: 17, f: fontBold, color: COLOR.red });
  const nrStr = `Nr. ${receipt.number}`;
  const nrWidth = fontBold.widthOfTextAtSize(nrStr, 10);
  text(nrStr, rightX - nrWidth, y - 20, { size: 10, f: fontBold });
  const dateStr = formatDateDE(receipt.date);
  const dateWidth = font.widthOfTextAtSize(dateStr, 8.5);
  text(dateStr, rightX - dateWidth, y - 32, { size: 8.5, color: COLOR.gray });

  y = Math.min(leftY, y - 44) - 14;
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.ink, 1.5);
  y -= 26;

  // ---- Empfänger ----
  text("EMPFÄNGER", MARGIN, y, { size: 7.5, f: fontBold, color: COLOR.lightGray });
  y -= 14;
  text(receipt.customer?.name || "", MARGIN, y, { size: 11, f: fontBold });
  y -= 14;
  const custAddr = [
    `${receipt.customer?.street || ""} ${receipt.customer?.houseNumber || ""}`.trim(),
    `${receipt.customer?.postalCode || ""} ${receipt.customer?.city || ""}`.trim(),
  ].filter(Boolean);
  const legacyAddr = custAddr.length ? custAddr : [receipt.customer?.address].filter(Boolean);
  legacyAddr.forEach((l) => {
    text(l, MARGIN, y, { size: 8.5, color: COLOR.gray });
    y -= 11;
  });
  y -= 12;

  // ---- Leistung ----
  text("LEISTUNG", MARGIN, y, { size: 7.5, f: fontBold, color: COLOR.lightGray });
  y -= 16;

  const ITEM_SAFE_BOTTOM = MARGIN + mm(35); // Reserve für Total + Schlusszeile

  // Spaltenraster von rechts: Endbetrag ganz rechts, davor die Rabattangabe,
  // davor (nur bei Produkten) der durchgestrichene Listpreis.
  const COL_AMOUNT_RIGHT = PAGE_W - MARGIN;
  const COL_DISCOUNT_RIGHT = COL_AMOUNT_RIGHT - mm(26);
  const COL_LIST_RIGHT = COL_DISCOUNT_RIGHT - mm(24);

  (receipt.items || []).forEach((it) => {
    if (y < ITEM_SAFE_BOTTOM) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      text("LEISTUNG (Fortsetzung)", MARGIN, y, { size: 7.5, f: fontBold, color: COLOR.lightGray });
      y -= 16;
    }

    const disc = itemDiscountPercent(it);
    const isProduct = itemKind(it) === "product";
    const listPrice = itemListPrice(it);

    // Beschreibung; bei Produkten aus dem Inventar zusätzlich die Artikelnummer.
    const descMaxRight = disc > 0 ? (isProduct ? COL_LIST_RIGHT : COL_DISCOUNT_RIGHT) : COL_AMOUNT_RIGHT;
    const descLines = wrapText(it.description, font, 9.5, descMaxRight - MARGIN - mm(4));
    text(descLines[0], MARGIN, y, { size: 9.5 });
    if (isProduct && it.articleNumber) {
      const dw = font.widthOfTextAtSize(toWinAnsiSafe(descLines[0]), 9.5);
      text(` · ${it.articleNumber}`, MARGIN + dw, y, { size: 8, color: COLOR.lightGray });
    }

    if (disc > 0) {
      // Produkt: Listpreis durchgestrichen anzeigen. Dienstleistung: nur
      // Rabatt und neuer Preis (so vom Nutzer gewünscht).
      if (isProduct) {
        const listStr = `CHF ${chf(listPrice)}`;
        const listW = font.widthOfTextAtSize(toWinAnsiSafe(listStr), 8.5);
        const listX = COL_LIST_RIGHT - listW;
        text(listStr, listX, y, { size: 8.5, color: COLOR.gray });
        // pdf-lib kennt keinen Durchstreich-Stil -> Linie über den Text ziehen.
        page.drawLine({
          start: { x: listX, y: y + 2.6 },
          end: { x: COL_LIST_RIGHT, y: y + 2.6 },
          thickness: 0.6,
          color: COLOR.gray,
        });
      }
      const discStr = `Rabatt ${formatPercent(disc)} %`;
      const discW = font.widthOfTextAtSize(toWinAnsiSafe(discStr), 8.5);
      text(discStr, COL_DISCOUNT_RIGHT - discW, y, { size: 8.5, color: COLOR.gray });
    }

    const amt = `CHF ${chf(itemLineTotal(it))}`;
    const amtWidth = font.widthOfTextAtSize(toWinAnsiSafe(amt), 9.5);
    text(amt, COL_AMOUNT_RIGHT - amtWidth, y, { size: 9.5 });
    y -= 10;

    // Weitere Zeilen einer langen Beschreibung unterhalb einrücken.
    descLines.slice(1).forEach((l) => {
      text(l, MARGIN, y, { size: 9.5 });
      y -= 10;
    });

    line(MARGIN, y, PAGE_W - MARGIN, COLOR.line, 0.75);
    y -= 12;
  });

  const discountTotal = receiptDiscountTotal(receipt);

  // Platz für Total + Schlusszeile + Unterschrift, bei aktivierter MWST
  // zusätzlich für die Aufschlüsselung und bei Rabatten für die
  // Zwischensumme darüber.
  const totalBlockHeight =
    MARGIN + mm(45) + (receipt.vatEnabled ? mm(15) : 0) + (discountTotal > 0 ? mm(12) : 0);
  if (y < totalBlockHeight) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  // Rabatt-Zwischensumme: zeigt, wie viel vom Listpreis abgezogen wurde.
  if (discountTotal > 0) {
    [
      ["Zwischensumme (Listpreise)", `CHF ${chf(receiptListTotal(receipt))}`],
      ["Rabatt", `− CHF ${chf(discountTotal)}`],
    ].forEach(([label, value]) => {
      text(label, MARGIN, y, { size: 9.5, color: COLOR.gray });
      const vw = font.widthOfTextAtSize(toWinAnsiSafe(value), 9.5);
      text(value, PAGE_W - MARGIN - vw, y, { size: 9.5, color: COLOR.gray });
      y -= 13;
    });
    y -= 1;
  }

  // MWST-Aufschlüsselung (Netto / MWST / Total inkl.) — muss auf der PDF
  // stehen, sonst ist das Dokument keine gültige MWST-Rechnung und der Kunde
  // kann die Vorsteuer nicht abziehen. Die Bildschirm-Vorschau zeigt sie
  // bereits, die PDF bisher nicht.
  if (receipt.vatEnabled) {
    const { rate, netTotal, vatAmount } = vatFigures(receipt);
    y -= 2;
    line(MARGIN, y, PAGE_W - MARGIN, COLOR.line, 0.75);
    y -= 14;
    [
      ["Netto", chf(netTotal)],
      [`MWST ${(rate * 100).toFixed(1)} %`, chf(vatAmount)],
    ].forEach(([label, value]) => {
      text(label, MARGIN, y, { size: 9.5, color: COLOR.gray });
      const valueStr = `CHF ${value}`;
      const valueWidth = font.widthOfTextAtSize(valueStr, 9.5);
      text(valueStr, PAGE_W - MARGIN - valueWidth, y, { size: 9.5 });
      y -= 13;
    });
    y -= 1;
  }

  y -= 2;
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.ink, 1.5);
  y -= 16;
  text(receipt.vatEnabled ? "Total (inkl. MWST)" : "Total", MARGIN, y, { size: 10.5, f: fontBold });
  const totalStr = `CHF ${chf(receipt.total)}`;
  const totalWidth = fontBold.widthOfTextAtSize(totalStr, 10.5);
  text(totalStr, PAGE_W - MARGIN - totalWidth, y, { size: 10.5, f: fontBold, color: COLOR.red });
  y -= 26;

  if (receipt.note) {
    const noteLines = wrapText(receipt.note, font, 9, PAGE_W - 2 * MARGIN);
    noteLines.forEach((l) => {
      text(l, MARGIN, y, { size: 9 });
      y -= 11;
    });
    y -= 6;
  }

  const term = paymentTermOf(receipt);
  const closingText = receipt.qrBillEnabled
    ? `Zahlbar per beiliegendem Einzahlungsschein innert ${term} ${dayWord(term)}.`
    : `Betrag dankend erhalten, ${company.zipCity || "___________"}, ${formatDateDE(receipt.date)}`;
  text(closingText, MARGIN, y, { size: 9 });
  y -= 20;
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.line, 0.75);
  y -= 12;
  text("Unterschrift", MARGIN, y, { size: 8.5, color: COLOR.gray });
  // Breite auf dem bereinigten Text messen, sonst stimmt die Rechtsbündigkeit
  // nicht, wenn toWinAnsiSafe() Zeichen ersetzt hat (z.B. "Đ" -> "Dj").
  const sigWidth = fontOblique.widthOfTextAtSize(toWinAnsiSafe(company.name), 9.5);
  text(company.name || "", PAGE_W - MARGIN - sigWidth, y, { size: 9.5, f: fontOblique });
  y -= 20;

  // ---- QR-Rechnung: garantiert am unteren Rand, auf Seite 1 falls Platz
  //      reicht, sonst auf einer frischen Seite 2 — beides exakt berechnet,
  //      kein Browser-Druck-Ratespiel mehr. ----
  // Die Fusszeile (Adresse, Kontakt/MWST-Nr., Bankverbindung) gehört ans ENDE
  // der Rechnungsseite, ganz unten am Seitenrand. Ein Einzahlungsschein muss
  // laut Vorgabe ebenfalls am unteren Seitenrand sitzen — beides zusammen geht
  // nicht, darum bekommt der Schein eine eigene Seite.
  const footerH = footerBlockHeight(company);
  const withSlip = !!(receipt.qrBillEnabled && qrPngBytes);

  if (footerH > 0 && y < MARGIN + footerH + mm(8)) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  }
  drawFooter(page, company, { font, fontBold }, MARGIN);

  if (withSlip) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    await drawQrSlip(pdfDoc, page, receipt, qrPngBytes, { font, fontBold });
  }

  return pdfDoc.save();
}

// Erzeugt eine Mahnung (Zahlungserinnerung) für eine überfällige, noch
// unbezahlte QR-Rechnung. Referenziert die ursprüngliche Rechnungsnummer und
// legt den Einzahlungsschein erneut bei, damit direkt bezahlt werden kann.
export async function generateMahnungPdf(receipt, qrPngBytes) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function text(str, x, yPos, { size = 9, f = font, color = COLOR.ink } = {}) {
    page.drawText(toWinAnsiSafe(str), { x, y: yPos, size, font: f, color });
  }

  function line(x1, yPos, x2, color = COLOR.line, width = 1) {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness: width, color });
  }

  // ---- Kopfzeile: Logo (Position wählbar) + Firma links, "MAHNUNG" rechts ----
  const company = receipt.company || {};
  const logoImage = await embedLogo(pdfDoc, company.logoDataUrl);
  const head = drawLogo(page, logoImage, company, MARGIN, PAGE_W, y);
  const textX = head.textX;
  y = head.topY;
  let leftY = y;
  text(company.name || "Firma", textX, leftY, { size: 12, f: fontBold });
  leftY -= 14;
  [
    company.address,
    company.zipCity,
    company.email,
    company.phone,
    company.vatNumber ? `MWST-Nr. ${company.vatNumber}` : "",
  ]
    .filter(Boolean)
    .forEach((l) => {
      text(l, textX, leftY, { size: 8.5, color: COLOR.gray });
      leftY -= 11;
    });

  const rightX = PAGE_W - MARGIN;
  const titleStr = "MAHNUNG";
  const titleWidth = fontBold.widthOfTextAtSize(titleStr, 17);
  text(titleStr, rightX - titleWidth, y - 2, { size: 17, f: fontBold, color: COLOR.red });
  const refStr = `Rechnung Nr. ${receipt.number}`;
  const refWidth = fontBold.widthOfTextAtSize(refStr, 10);
  text(refStr, rightX - refWidth, y - 20, { size: 10, f: fontBold });
  const todayStr = formatDateDE(todayISO());
  const todayWidth = font.widthOfTextAtSize(todayStr, 8.5);
  text(todayStr, rightX - todayWidth, y - 32, { size: 8.5, color: COLOR.gray });

  y = Math.min(leftY, y - 44) - 14;
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.ink, 1.5);
  y -= 26;

  // ---- Empfänger ----
  text("EMPFÄNGER", MARGIN, y, { size: 7.5, f: fontBold, color: COLOR.lightGray });
  y -= 14;
  text(receipt.customer?.name || "", MARGIN, y, { size: 11, f: fontBold });
  y -= 14;
  const custAddr = [
    `${receipt.customer?.street || ""} ${receipt.customer?.houseNumber || ""}`.trim(),
    `${receipt.customer?.postalCode || ""} ${receipt.customer?.city || ""}`.trim(),
  ].filter(Boolean);
  const legacyAddr = custAddr.length ? custAddr : [receipt.customer?.address].filter(Boolean);
  legacyAddr.forEach((l) => {
    text(l, MARGIN, y, { size: 8.5, color: COLOR.gray });
    y -= 11;
  });
  y -= 20;

  // ---- Mahntext ----
  const term = paymentTermOf(receipt);
  const dueDate = addDaysISO(receipt.date, term);
  const overdueDays = daysBetweenISO(dueDate, todayISO());
  const bodyText =
    `Wir haben festgestellt, dass die untenstehende Rechnung noch nicht beglichen wurde. ` +
    `Die Zahlungsfrist von ${term} ${dayWord(term)} ist am ${formatDateDE(dueDate)} abgelaufen (seit ${overdueDays} ` +
    `Tag${overdueDays === 1 ? "" : "en"} überfällig). Wir bitten Sie, den ausstehenden Betrag innert ` +
    `10 Tagen mit dem beiliegenden Einzahlungsschein zu begleichen. Sollten Sie die Zahlung ` +
    `zwischenzeitlich bereits ausgeführt haben, betrachten Sie dieses Schreiben als gegenstandslos.`;
  wrapText(bodyText, font, 9.5, PAGE_W - 2 * MARGIN).forEach((l) => {
    text(l, MARGIN, y, { size: 9.5 });
    y -= 13;
  });
  y -= 14;

  // ---- Zusammenfassung ----
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.ink, 1.5);
  y -= 18;
  [
    ["Rechnung Nr.", receipt.number],
    ["Rechnungsdatum", formatDateDE(receipt.date)],
    ["Fällig seit", formatDateDE(dueDate)],
    ["Betrag", `CHF ${chf(receipt.total)}`],
  ].forEach(([label, value]) => {
    text(label, MARGIN, y, { size: 9.5, color: COLOR.gray });
    const valueWidth = fontBold.widthOfTextAtSize(value, 10);
    text(value, PAGE_W - MARGIN - valueWidth, y, { size: 10, f: fontBold });
    y -= 16;
  });
  y -= 6;
  line(MARGIN, y, PAGE_W - MARGIN, COLOR.line, 0.75);
  y -= 24;

  text("Freundliche Grüsse", MARGIN, y, { size: 9 });
  y -= 16;
  // Breite auf dem bereinigten Text messen, sonst stimmt die Rechtsbündigkeit
  // nicht, wenn toWinAnsiSafe() Zeichen ersetzt hat (z.B. "Đ" -> "Dj").
  const sigWidth = fontOblique.widthOfTextAtSize(toWinAnsiSafe(company.name), 9.5);
  text(company.name || "", MARGIN, y, { size: 9.5, f: fontOblique });
  y -= 30;

  // ---- Einzahlungsschein erneut beilegen, damit direkt bezahlt werden kann ----
  // Fusszeile wie auf der Rechnung, damit auch die Mahnung alle Firmenangaben
  // trägt (Adresse, Kontakt/MWST-Nr., Bankverbindung).
  // Wie bei der Rechnung: Fusszeile ans Seitenende, Schein auf eigene Seite.
  const footerH = footerBlockHeight(company);
  if (footerH > 0 && y < MARGIN + footerH + mm(8)) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  }
  drawFooter(page, company, { font, fontBold }, MARGIN);

  if (qrPngBytes) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    await drawQrSlip(pdfDoc, page, receipt, qrPngBytes, { font, fontBold });
  }

  return pdfDoc.save();
}

async function drawQrSlip(pdfDoc, page, receipt, qrPngBytes, { font, fontBold }) {
  const SLIP_H = mm(105);
  const RECEIPT_W = mm(62);
  const PAY_LEFT_W = mm(51);
  const GAP = mm(5);
  const PAY_RIGHT_X = RECEIPT_W + GAP + PAY_LEFT_W + GAP;

  const top = SLIP_H; // y-Koordinate des oberen Schein-Randes (0 = Seitenboden)
  const pad = mm(5);

  function t(str, x, yPos, { size = 8, f = font, color = COLOR.black } = {}) {
    page.drawText(toWinAnsiSafe(str), { x, y: yPos, size, font: f, color });
  }
  function label(str, x, yPos) {
    t(str, x, yPos, { size: 6, f: fontBold, color: COLOR.black });
  }

  // Obere Trennlinie über die volle Breite + Scheren-Symbol
  page.drawLine({ start: { x: 0, y: top }, end: { x: PAGE_W, y: top }, thickness: 1, color: COLOR.black });
  drawScissors(page, RECEIPT_W, top, true);

  // Gestrichelte, senkrechte Trennlinie Empfangsschein/Zahlteil
  drawDashedLine(page, RECEIPT_W, 0, RECEIPT_W, top);
  drawScissors(page, RECEIPT_W, 0, false);

  const qrImage = await pdfDoc.embedPng(qrPngBytes);

  const creditorLines = getCreditorLines(receipt);
  const debtorLines = getDebtorLines(receipt);
  const referenceDisplay = receipt.referenceDisplay || "";

  // ---------- Empfangsschein (links) ----------
  let ry = top - pad - 11;
  t("Empfangsschein", pad, ry, { size: 11, f: fontBold });
  ry -= 16;
  label("Konto / Zahlbar an", pad, ry);
  ry -= 8;
  [formatIbanDisplayLocal(receipt.qrIban), ...creditorLines].forEach((l) => {
    t(l, pad, ry, { size: 8 });
    ry -= 9.5;
  });
  ry -= 4;
  label("Referenz", pad, ry);
  ry -= 8;
  t(referenceDisplay, pad, ry, { size: 8 });
  ry -= 15;
  label("Zahlbar durch", pad, ry);
  ry -= 8;
  if (receipt.customer?.name) {
    t(receipt.customer.name, pad, ry, { size: 8 });
    ry -= 9.5;
    debtorLines.forEach((l) => {
      t(l, pad, ry, { size: 8 });
      ry -= 9.5;
    });
  }

  const contentBottomLeft = ry - mm(4);
  const fixedZoneBottom = top - mm(62);
  const amountY = Math.min(contentBottomLeft, fixedZoneBottom);
  label("Währung", pad, amountY);
  label("Betrag", pad + mm(20), amountY);
  t("CHF", pad, amountY - 9, { size: 8 });
  t(chf(receipt.total), pad + mm(20), amountY - 9, { size: 8 });

  t("Annahmestelle", RECEIPT_W - pad - font.widthOfTextAtSize("Annahmestelle", 6), pad + 2, {
    size: 6,
    f: fontBold,
  });

  // ---------- Zahlteil (rechts) ----------
  const zLeftX = RECEIPT_W + GAP;
  let zy = top - pad - 11;
  t("Zahlteil", zLeftX, zy, { size: 11, f: fontBold });

  const qrSize = mm(46);
  const qrY = zy - mm(2) - qrSize;
  page.drawImage(qrImage, { x: zLeftX, y: qrY, width: qrSize, height: qrSize });
  drawSwissCross(page, zLeftX + qrSize / 2, qrY + qrSize / 2);

  const zAmountY = qrY - mm(6);
  label("Währung", zLeftX, zAmountY);
  label("Betrag", zLeftX + mm(20), zAmountY);
  t("CHF", zLeftX, zAmountY - 9, { size: 8 });
  t(chf(receipt.total), zLeftX + mm(20), zAmountY - 9, { size: 8 });

  let py = top - pad - mm(13) - 11;
  label("Konto / Zahlbar an", PAY_RIGHT_X, py);
  py -= 8;
  [formatIbanDisplayLocal(receipt.qrIban), ...creditorLines].forEach((l) => {
    t(l, PAY_RIGHT_X, py, { size: 8 });
    py -= 9.5;
  });
  py -= 4;
  label("Referenz", PAY_RIGHT_X, py);
  py -= 8;
  t(referenceDisplay, PAY_RIGHT_X, py, { size: 8 });
  py -= 15;
  label("Zusätzliche Informationen", PAY_RIGHT_X, py);
  py -= 8;
  t(`Rechnung Nr. ${receipt.number}`, PAY_RIGHT_X, py, { size: 8 });
  py -= 15;
  label("Zahlbar durch", PAY_RIGHT_X, py);
  py -= 8;
  if (receipt.customer?.name) {
    t(receipt.customer.name, PAY_RIGHT_X, py, { size: 8 });
    py -= 9.5;
    debtorLines.forEach((l) => {
      t(l, PAY_RIGHT_X, py, { size: 8 });
      py -= 9.5;
    });
  }
}

function formatIbanDisplayLocal(iban) {
  const clean = (iban || "").replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function getCreditorLines(receipt) {
  const c = receipt.qrCreditor || {};
  return [c.name, `${c.street || ""} ${c.houseNumber || ""}`.trim(), `${c.postalCode || ""} ${c.city || ""}`.trim()].filter(
    Boolean
  );
}

function getDebtorLines(receipt) {
  const cust = receipt.customer || {};
  return [`${cust.street || ""} ${cust.houseNumber || ""}`.trim(), `${cust.postalCode || ""} ${cust.city || ""}`.trim()].filter(
    Boolean
  );
}

function drawDashedLine(page, x1, y1, x2, y2, dash = 3, gap = 2) {
  const totalLen = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / totalLen;
  const dy = (y2 - y1) / totalLen;
  let pos = 0;
  while (pos < totalLen) {
    const segEnd = Math.min(pos + dash, totalLen);
    page.drawLine({
      start: { x: x1 + dx * pos, y: y1 + dy * pos },
      end: { x: x1 + dx * segEnd, y: y1 + dy * segEnd },
      thickness: 0.75,
      color: COLOR.black,
    });
    pos += dash + gap;
  }
}

function drawScissors(page, x, y, above) {
  const s = 4;
  const yy = above ? y - 1 : y + 1;
  page.drawLine({ start: { x: x - s, y: yy - (above ? 0 : s) }, end: { x: x + s, y: yy + (above ? 0 : s) }, thickness: 1, color: COLOR.black });
  page.drawLine({ start: { x: x - s, y: yy + (above ? 0 : s) }, end: { x: x + s, y: yy - (above ? 0 : s) }, thickness: 1, color: COLOR.black });
}

function drawSwissCross(page, cx, cy) {
  const s = mm(7);
  page.drawRectangle({ x: cx - s / 2, y: cy - s / 2, width: s, height: s, color: COLOR.black });
  page.drawRectangle({ x: cx - mm(0.5), y: cy - mm(2.5), width: mm(1), height: mm(5), color: COLOR.white });
  page.drawRectangle({ x: cx - mm(2.5), y: cy - mm(0.5), width: mm(5), height: mm(1), color: COLOR.white });
}
