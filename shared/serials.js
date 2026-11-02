// Seriennummern einzelner Exemplare (z. B. hochpreisige Queues). Reine
// Funktionen ohne Speicherzugriff — dieselbe Datei läuft in der React-App,
// im Electron-Hauptprozess (lokale API, Shop-Feed) und in den Tests.
//
// Die Seriennummer bleibt ausschliesslich in Qwui: Shop-Feed und Assistent
// bekommen sie nie zu sehen (siehe shopFeed.js bzw. desktop/localApi.js).

export const UNIT_STATUS = {
  inStock: "an_lager",
  reserved: "reserviert",
  sold: "verkauft",
  returned: "retourniert",
};

export const UNIT_STATUS_LABEL = {
  an_lager: "an Lager",
  reserviert: "reserviert",
  verkauft: "verkauft",
  retourniert: "retourniert",
};

// Vergleichsform einer Seriennummer: Scanner hängen gern Leerzeichen an, und
// "pr-1234" und "PR-1234" sind auf dem Etikett dieselbe Nummer. Gespeichert
// wird die Nummer so, wie sie eingegeben wurde — nur verglichen wird normiert.
export function normalizeSerial(serial) {
  return String(serial ?? "").trim().toUpperCase();
}

export function findUnitBySerial(units, serial) {
  const wanted = normalizeSerial(serial);
  if (!wanted) return null;
  return (units || []).find((u) => normalizeSerial(u.serial) === wanted) || null;
}

// Prüft eine Liste neu erfasster Seriennummern (z. B. aus dem Wareneingang)
// gegen sich selbst und gegen den Bestand. Liefert pro Problem eine Meldung,
// die so direkt in der Oberfläche stehen kann.
export function checkNewSerials(serials, units) {
  const errors = [];
  const seen = new Set();
  for (const raw of serials || []) {
    const serial = normalizeSerial(raw);
    if (!serial) {
      errors.push("Leere Seriennummer.");
      continue;
    }
    if (seen.has(serial)) {
      errors.push(`Seriennummer ${String(raw).trim()} ist doppelt erfasst.`);
      continue;
    }
    seen.add(serial);
    if (findUnitBySerial(units, serial)) {
      errors.push(`Seriennummer ${String(raw).trim()} ist bereits vorhanden.`);
    }
  }
  return errors;
}

// Exemplare, die beim Verkauf gewählt werden dürfen. Reservierte bleiben
// wählbar (die Oberfläche markiert sie), verkaufte und retournierte nicht.
export function isSellable(unit) {
  return unit?.status === UNIT_STATUS.inStock || unit?.status === UNIT_STATUS.reserved;
}

export function unitsOfProduct(units, productId) {
  return (units || []).filter((u) => u.productId === productId);
}
