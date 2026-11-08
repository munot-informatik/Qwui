// Kalenderdaten in Ortszeit. toISOString() liefert das UTC-Datum — in der
// Schweiz (UTC+1/+2) ist das zwischen 00:00 und 01:00/02:00 Uhr noch gestern.

export function localDateISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
