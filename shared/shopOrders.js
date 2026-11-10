// Bestellung aus dem Online-Shop → ausgefülltes Quittungsformular. Reine
// Funktion: Die Quittung wird danach ganz normal in der App erstellt, mit
// Lagerbuchung, Nummer und E-Mail-Versand wie jede andere.

// Bestellungen gibt es nur beim Qwui-Shop: Er nimmt den Feed unter
// …/api/qwui/feed an, die übrigen Adressen leiten sich davon ab.
export const QWUI_SHOP_FEED_PATH = /\/api\/qwui\/feed\/?$/;

export function isQwuiShopFeedUrl(url) {
  return QWUI_SHOP_FEED_PATH.test(String(url || "").trim());
}

const PAYMENT_LABEL = { twint: "TWINT", card: "Karte" };

export function paymentLabel(payload) {
  const method = PAYMENT_LABEL[payload.paymentMethod] || payload.paymentMethod || "online";
  return payload.payment === "testkasse" ? `${method} (Testkasse)` : method;
}

// deps: { inventory, findArticle, isSerialTracked, makeItem, today }
// Ergebnis: { customer, items, note, deliveryTo, deliveryMail, warnings }
export function orderToReceiptForm(payload, { inventory, findArticle, isSerialTracked, makeItem, today }) {
  const warnings = [];
  const items = [];
  for (const line of payload.items) {
    const product = line.articleNumber ? findArticle(inventory, line.articleNumber) : null;
    const amount = String(line.price);
    if (!product) {
      warnings.push(`«${line.name}» (${line.articleNumber || "ohne Nr."}) ist nicht im Inventar — als Position ohne Lagerbuchung übernommen.`);
      items.push({ ...makeItem(), kind: "service", description: line.name, amount, quantity: String(line.quantity) });
      continue;
    }
    const base = {
      kind: "product",
      description: product.name || line.name,
      amount,
      articleNumber: product.articleNumber || "",
      productId: product.id,
      unitId: "",
      serial: "",
    };
    if (isSerialTracked(product)) {
      // Ein Exemplar pro Position — gewählt bzw. gescannt wird es im Formular.
      for (let i = 0; i < line.quantity; i++) items.push({ ...makeItem(), ...base, quantity: "1" });
      warnings.push(`«${product.name}»: bitte ${line.quantity === 1 ? "das Exemplar" : `die ${line.quantity} Exemplare`} wählen oder scannen.`);
    } else {
      items.push({ ...makeItem(), ...base, quantity: String(line.quantity) });
    }
    if (Math.abs(Number(product.price) - line.price) >= 0.005) {
      warnings.push(`«${product.name}»: im Shop bezahlt CHF ${line.price.toFixed(2)}, im Inventar CHF ${Number(product.price).toFixed(2)} — übernommen ist der bezahlte Preis.`);
    }
  }
  if (payload.shipping > 0) {
    items.push({ ...makeItem(), kind: "service", description: "Versand", amount: String(payload.shipping), quantity: "1" });
  }

  const c = payload.customer;
  const customer = {
    name: c.name,
    address: "",
    street: c.street,
    houseNumber: c.houseNumber,
    postalCode: c.postalCode,
    city: c.city,
    email: c.email,
    phone: c.phone,
    // Wer im Shop «Quittung per E-Mail» angehakt hat, hat zugestimmt.
    emailConsent: c.receiptByEmail && c.email ? { given: true, at: today } : null,
  };

  const paid = payload.paidAt ? new Date(payload.paidAt) : null;
  const paidText = paid && !Number.isNaN(paid.getTime()) ? ` am ${paid.toLocaleDateString("de-CH")}` : "";
  const note = [
    `Online-Bestellung Nr. ${payload.number ?? "?"} · bezahlt mit ${paymentLabel(payload)}${paidText} · ${payload.delivery === "abholung" ? "Abholung" : "Versand"}`,
    payload.note ? `Bemerkung: ${payload.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    customer,
    items,
    note,
    deliveryTo: c.receiptByEmail && c.email ? c.email : null,
    deliveryMail: !!(c.receiptByEmail && c.email),
    warnings,
  };
}
