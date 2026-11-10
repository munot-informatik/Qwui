// Entwürfe des Assistenten: Schreibende Aktionen aus Claude (Wareneingang,
// neuer Artikel) werden nie direkt gebucht, sondern als Entwurf abgelegt.
// Sie erscheinen in der App unter «Vorschläge des Assistenten» und werden
// erst mit «Übernehmen» gebucht — mit der Quelle "Assistent" im Protokoll.

// «bestellung» kommt nicht vom Assistenten, sondern aus dem Online-Shop
// (desktop/shopOrders.js): bezahlte Bestellungen, die mit «Übernehmen» zur
// Quittung werden — erst dann wird das Lager gebucht.
export const DRAFT_TYPE = { goodsIn: "wareneingang", article: "artikel", order: "bestellung" };
export const DRAFT_STATUS = { open: "offen", accepted: "übernommen", rejected: "verworfen" };

function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

// Prüft und normiert einen Wareneingang-Vorschlag. Der Artikel wird hier nur
// beschrieben (Artikelnummer oder Name) — aufgelöst wird beim Übernehmen in
// der App, mit dem dann aktuellen Inventar.
export function makeGoodsInDraft(input, ctx) {
  const article = cleanText(input?.article ?? input?.articleNumber);
  if (!article) throw new Error("Bitte den Artikel angeben (Artikelnummer oder Name).");
  const serials = Array.isArray(input?.serials) ? input.serials.map((s) => cleanText(s, 80)).filter(Boolean) : [];
  const quantity = input?.quantity == null || input.quantity === "" ? null : Number(input.quantity);
  if (serials.length === 0 && !(Number.isFinite(quantity) && quantity > 0)) {
    throw new Error("Bitte eine Menge grösser als 0 oder Seriennummern angeben.");
  }
  if (serials.length > 500) throw new Error("Zu viele Seriennummern in einem Vorschlag.");
  const purchasePrice = input?.purchasePrice == null || input.purchasePrice === "" ? null : Number(input.purchasePrice);
  return {
    id: ctx.newId(),
    type: DRAFT_TYPE.goodsIn,
    status: DRAFT_STATUS.open,
    createdAt: ctx.now,
    source: "assistent",
    payload: {
      article,
      quantity: serials.length ? serials.length : quantity,
      serials,
      purchasePrice: Number.isFinite(purchasePrice) && purchasePrice >= 0 ? purchasePrice : null,
      note: cleanText(input?.note, 500),
    },
  };
}

export function makeArticleDraft(input, ctx) {
  const name = cleanText(input?.name);
  if (!name) throw new Error("Bitte einen Artikelnamen angeben.");
  const price = Number(input?.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Bitte einen gültigen Preis angeben.");
  return {
    id: ctx.newId(),
    type: DRAFT_TYPE.article,
    status: DRAFT_STATUS.open,
    createdAt: ctx.now,
    source: "assistent",
    payload: {
      name,
      articleNumber: cleanText(input?.articleNumber, 60),
      group: cleanText(input?.group, 80),
      price: Math.round(price * 100) / 100,
      serialTracked: input?.serialTracked === true,
      shopText: cleanText(input?.shopText, 4000),
    },
  };
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Bestellung aus dem Shop (GET /api/qwui/orders) als Vorschlag. Alles wird
// einzeln übernommen und begrenzt — der Shop ist eine Quelle von aussen.
export function makeOrderDraft(order, ctx) {
  const orderId = cleanText(order?.id, 80);
  if (!orderId) throw new Error("Bestellung ohne ID.");
  const items = (Array.isArray(order.items) ? order.items : []).slice(0, 100).map((it) => ({
    articleNumber: cleanText(it?.articleNumber, 60),
    name: cleanText(it?.name, 200),
    quantity: Math.max(1, Math.min(999, Math.floor(Number(it?.quantity) || 1))),
    price: money(it?.price) ?? 0,
  }));
  if (items.length === 0) throw new Error(`Bestellung ${orderId} hat keine Positionen.`);
  const c = order.customer || {};
  return {
    id: ctx.newId(),
    type: DRAFT_TYPE.order,
    status: DRAFT_STATUS.open,
    createdAt: ctx.now,
    source: "shop",
    payload: {
      orderId,
      number: Math.floor(Number(order.number)) || null,
      createdAt: cleanText(order.createdAt, 40),
      paidAt: cleanText(order.paidAt, 40),
      payment: cleanText(order.payment, 20),
      paymentMethod: cleanText(order.paymentMethod, 20),
      delivery: order.delivery === "abholung" ? "abholung" : "versand",
      note: cleanText(order.note, 500),
      customer: {
        name: cleanText(c.name, 120),
        email: cleanText(c.email, 200),
        phone: cleanText(c.phone, 40),
        street: cleanText(c.street, 120),
        houseNumber: cleanText(c.houseNumber, 16),
        postalCode: cleanText(c.postalCode, 16),
        city: cleanText(c.city, 60),
        receiptByEmail: c.receiptByEmail === true,
      },
      items,
      shipping: money(order.shipping) ?? 0,
      total: money(order.total) ?? 0,
    },
  };
}

// Für die Antwort an den Assistenten: was angelegt wurde, ohne Interna.
export function draftSummary(draft) {
  return { draftId: draft.id, type: draft.type, status: draft.status, createdAt: draft.createdAt, ...draft.payload };
}
