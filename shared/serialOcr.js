// Seriennummern aus erkanntem Fototext herausfiltern. Die Texterkennung liefert
// alles, was auf dem Etikett steht (Modell, Herkunft, Datum). Hier wird daraus
// eine Vorschlagsliste, die beste Vermutung zuerst. Gebucht wird nie automatisch:
// Die Erkennung verwechselt ähnliche Zeichen, deshalb entscheidet immer ein
// Mensch mit Blick aufs Foto.

import { normalizeSerial } from "./serials.js";

const LABEL_RE = /(?:^|[\s(])(?:s\s*\/\s*n|s\/no|sn|ser\.?\s*(?:no|nr)|serial(?:\s*(?:no|nr|number))?|serien\s*(?:nummer|nr)|seriennummer)\s*[.:#]*\s*(.*)$/i;
const ALLOWED_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/;

function cleanToken(raw) {
  return String(raw).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function looksLikeSerial(token) {
  if (token.length < 4 || token.length > 40) return false;
  if (!ALLOWED_RE.test(token) || !/\d/.test(token)) return false;
  // Datum, Jahr, Preis und Adressen sind keine Seriennummern.
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(token)) return false;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(token)) return false;
  if (/^(19|20)\d{2}$/.test(token)) return false;
  if (/^\d+[.]\d{1,2}$/.test(token)) return false;
  if (/^(www\.|https?)/i.test(token)) return false;
  return true;
}

// lines: erkannte Textzeilen. Liefert Vorschläge, die beste Vermutung zuerst.
export function extractSerialCandidates(lines) {
  const scored = new Map();
  const add = (raw, score) => {
    const value = String(raw).trim();
    const key = normalizeSerial(value);
    if (!key) return;
    const previous = scored.get(key);
    if (!previous || previous.score < score) scored.set(key, { value, score });
  };

  const list = (lines || []).map((l) => String(l ?? "").trim()).filter(Boolean);
  list.forEach((line, i) => {
    const labeled = LABEL_RE.exec(line);
    if (labeled) {
      const rest = labeled[1].trim();
      const tokens = rest.split(/\s+/).map(cleanToken).filter(Boolean);
      if (tokens[0] && looksLikeSerial(tokens[0])) add(tokens[0], 100);
      // Die Erkennung trennt Nummern gern mit Leerzeichen: «PR 1001».
      if (tokens.length > 1 && tokens.length <= 3) {
        const joined = tokens.join("");
        if (looksLikeSerial(joined)) add(joined, 70);
      }
      // Bezeichnung auf der einen Zeile, Nummer auf der nächsten.
      if (!rest && list[i + 1]) {
        const next = cleanToken(list[i + 1].split(/\s+/)[0]);
        if (looksLikeSerial(next)) add(next, 90);
      }
    }
    for (const part of line.split(/\s+/)) {
      const token = cleanToken(part);
      if (!looksLikeSerial(token)) continue;
      add(token, /[A-Za-z]/.test(token) ? 30 : 10);
    }
  });

  return [...scored.values()].sort((a, b) => b.score - a.score).map((c) => c.value);
}

// Zeichen, die die Texterkennung leicht verwechselt. Für einen Hinweis neben dem
// Vorschlag, damit genau diese Stellen mit dem Foto verglichen werden.
export function confusableChars(serial) {
  const found = new Set();
  for (const ch of String(serial ?? "")) {
    if ("0OoQ".includes(ch)) found.add("0/O");
    if ("1IlL".includes(ch)) found.add("1/I");
    if ("8B".includes(ch)) found.add("8/B");
    if ("5S".includes(ch)) found.add("5/S");
    if ("2Z".includes(ch)) found.add("2/Z");
  }
  return [...found];
}
