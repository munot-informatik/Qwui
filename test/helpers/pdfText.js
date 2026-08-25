// Liest den sichtbaren Text aus einer erzeugten PDF zurück.
//
// pdf-lib komprimiert die Inhalts-Streams (FlateDecode) und schreibt
// gezeichneten Text als Hex-String ("<4D756E6F74> Tj"). Ohne Auspacken und
// Dekodieren würde jede Prüfung auf Textinhalte still durchlaufen, ohne
// wirklich etwas zu prüfen.

import { inflateSync } from "node:zlib";

// Liefert den Text pro Seite, in Seitenreihenfolge.
export function pdfPages(bytes) {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const pages = [];
  let i = 0;

  while (true) {
    const start = raw.indexOf("stream", i);
    if (start === -1) break;

    // "endstream" enthält ebenfalls "stream".
    if (raw.slice(start - 3, start) === "end") {
      i = start + "stream".length;
      continue;
    }

    // Bild-Streams (Logo, QR-Code) sind keine Seiteninhalte und würden sonst
    // als zusätzliche Seiten mitgezählt.
    if (raw.slice(Math.max(0, start - 500), start).includes("/Subtype /Image")) {
      const end = raw.indexOf("endstream", start);
      i = end === -1 ? start + 6 : end + "endstream".length;
      continue;
    }

    let dataStart = start + "stream".length;
    if (raw[dataStart] === "\r") dataStart++;
    if (raw[dataStart] === "\n") dataStart++;
    const end = raw.indexOf("endstream", dataStart);
    if (end === -1) break;

    try {
      const text = inflateSync(buf.subarray(dataStart, end))
        .toString("latin1")
        .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex) => Buffer.from(hex, "hex").toString("latin1"));
      if (text.includes("BT")) pages.push(text);
    } catch (e) {
      // Kein auspackbarer Stream — überspringen.
    }
    i = end + "endstream".length;
  }
  return pages;
}

// Gesamter Text über alle Seiten.
export function pdfText(bytes) {
  return pdfPages(bytes).join("\n");
}

export function isPdf(bytes) {
  return Buffer.from(bytes).subarray(0, 4).toString() === "%PDF";
}
