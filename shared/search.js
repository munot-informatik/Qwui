// Suchen für Belege und Kunden. Reine Funktionen, dieselben in Web und Windows.

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Passt ein Beleg zur Suche? Gesucht wird in Nummer, Kunde (Name, E-Mail),
// Positionen (Text, Artikelnummer, Seriennummer) und Notiz. «4» findet auch
// die Nummer «0004».
export function receiptMatches(receipt, query) {
  const q = norm(query);
  if (!q) return true;
  const number = String(receipt.number ?? "");
  if (/^\d+$/.test(q) && /^\d+$/.test(number) && Number(q) === Number(number)) return true;
  const haystack = [
    number,
    receipt.customer?.name,
    receipt.customer?.email,
    receipt.note,
    ...(receipt.items || []).flatMap((it) => [it.description, it.articleNumber, it.serial]),
  ]
    .map(norm)
    .join("\n");
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

// Belege für die Liste: mit Suchtext über alle Zeiträume, sonst im gewählten
// Jahr/Monat (month 0–11 oder "all"). Neueste zuerst.
export function filterReceipts(receipts, { year, month = "all", query = "" } = {}) {
  const searching = !!norm(query);
  return (receipts || [])
    .filter((r) => {
      if (searching) return receiptMatches(r, query);
      const [y, m] = String(r.date || "").split("-");
      if (year != null && Number(y) !== Number(year)) return false;
      if (month !== "all" && Number(m) - 1 !== Number(month)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (Number(b.number) || 0) - (Number(a.number) || 0);
    });
}

// Kunden suchen: Name, E-Mail, Telefon, Ort. Treffer am Wortanfang zuerst.
export function searchCustomers(customers, query, limit = 8) {
  const q = norm(query);
  const list = customers || [];
  if (!q) return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH")).slice(0, limit);
  // Telefonnummern national vergleichen: «079 …» = «+41 79 …» = «0041 79 …».
  const national = (s) => String(s).replace(/[^\d]/g, "").replace(/^(00)?41/, "").replace(/^0/, "");
  const digits = /^[\d\s+()/-]+$/.test(q) ? national(q) : "";
  const scored = [];
  for (const c of list) {
    const name = norm(c.name);
    const fields = [name, norm(c.email), norm(c.city), norm(c.zipCity)];
    const phoneDigits = national(c.phone || "");
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (fields.some((f) => f.includes(q))) score = 1;
    else if (digits.length >= 3 && phoneDigits.includes(digits)) score = 1;
    if (score) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(a.c.name).localeCompare(String(b.c.name), "de-CH"))
    .slice(0, limit)
    .map((x) => x.c);
}
