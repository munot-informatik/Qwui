// Gemeinsame Testdaten: eine Firma mit allen Angaben und ein Kunde. Bewusst
// vollständig ausgefüllt, damit Fusszeile, QR-Schein und MWST-Angaben in den
// Prüfungen überhaupt erscheinen können.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const logoPath = fileURLToPath(new URL("../../src/assets/logo.png", import.meta.url));

export const LOGO_DATA_URL = "data:image/png;base64," + readFileSync(logoPath).toString("base64");

export const IBAN = "CH9300762011623852957";

export function makeCompany(overrides = {}) {
  return {
    name: "Munot Informatik",
    address: "Bachstrasse 12",
    zipCity: "8200 Schaffhausen",
    email: "info@munot-informatik.ch",
    phone: "052 620 00 00",
    vatNumber: "CHE-123.456.789 MWST",
    logoDataUrl: "",
    qrBill: {
      name: "Munot Informatik",
      iban: IBAN,
      street: "Bachstrasse",
      houseNumber: "12",
      postalCode: "8200",
      city: "Schaffhausen",
      country: "CH",
    },
    ...overrides,
  };
}

export function makeCustomer(overrides = {}) {
  return {
    name: "Sandra Meier",
    street: "Vordergasse",
    houseNumber: "48",
    postalCode: "8200",
    city: "Schaffhausen",
    email: "s.meier@example.ch",
    ...overrides,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
export const VAT_RATE = 0.081;

// Baut einen Beleg und rechnet Total/Netto/MWST konsistent aus den Positionen,
// damit Testdaten nicht versehentlich in sich widersprüchlich sind.
export function makeReceipt({
  number = "0001",
  date = "2026-08-24",
  items = [{ id: "a", description: "Beratung", amount: 1000 }],
  vatEnabled = false,
  qrBillEnabled = false,
  company = makeCompany(),
  customer = makeCustomer(),
  ...rest
} = {}) {
  const total = round2(
    items.reduce((sum, it) => {
      const gross = Number(it.amount) || 0;
      const disc = Math.min(100, Math.max(0, Number(it.discountPercent) || 0));
      return sum + round2(gross - round2((gross * disc) / 100));
    }, 0)
  );
  const netTotal = vatEnabled ? round2(total / (1 + VAT_RATE)) : total;
  return {
    number,
    date,
    customer,
    items,
    total,
    netTotal,
    vatEnabled,
    vatRate: VAT_RATE,
    vatAmount: vatEnabled ? round2(total - netTotal) : 0,
    qrBillEnabled,
    paid: !qrBillEnabled,
    company,
    ...rest,
  };
}
