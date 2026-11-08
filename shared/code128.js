// Strichcode im Format Code 128 für Seriennummer-Etiketten. Code 128 lesen
// praktisch alle Scanner, auch einfache 1D-Geräte, und er kann Buchstaben,
// Ziffern und Zeichen wie «-» oder «/» darstellen.
//
// Reine Funktionen ohne Abhängigkeiten. Ergebnis ist eine Folge von Balken- und
// Lückenbreiten in Modulen (schmalste Strichbreite), daraus zeichnet die
// Oberfläche ein SVG.

// Breiten (Balken, Lücke, Balken, …) für die Werte 0–106. 106 ist das Stoppzeichen.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
export const QUIET_ZONE = 10; // Module Ruhezone links und rechts

// Druckbar sind die normalen ASCII-Zeichen (Leerzeichen bis «~»). Umlaute und
// andere Sonderzeichen kann Code 128 nicht ohne Weiteres darstellen.
export function canEncode(text) {
  const value = String(text ?? "");
  return value.length > 0 && value.length <= 48 && /^[\x20-\x7E]+$/.test(value);
}

// Werte inklusive Start und Prüfzeichen, ohne Stopp. Reine Zifferfolgen gerader
// Länge kommen in Zeichensatz C (zwei Ziffern je Zeichen, halb so breit).
export function code128Values(text) {
  const value = String(text ?? "");
  if (!canEncode(value)) throw new Error("Diese Seriennummer lässt sich nicht als Strichcode drucken.");
  const values = [];
  if (value.length >= 4 && value.length % 2 === 0 && /^\d+$/.test(value)) {
    values.push(START_C);
    for (let i = 0; i < value.length; i += 2) values.push(Number(value.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of value) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  return values;
}

// Balken- und Lückenbreiten, beginnend mit einem Balken, ohne Ruhezone.
export function code128Widths(text) {
  const widths = [];
  for (const v of [...code128Values(text), STOP]) {
    for (const w of PATTERNS[v]) widths.push(Number(w));
  }
  return widths;
}

// Als Folge aus 1 (Balken) und 0 (Lücke), je ein Zeichen pro Modul.
export function code128Binary(text) {
  return code128Widths(text)
    .map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(w))
    .join("");
}

// Rechtecke für ein SVG: { x, width } in Modulen, dazu die Gesamtbreite
// inklusive Ruhezone.
export function code128Bars(text) {
  const bars = [];
  let x = QUIET_ZONE;
  code128Widths(text).forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, width: w });
    x += w;
  });
  return { bars, totalWidth: x + QUIET_ZONE };
}
