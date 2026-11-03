// Entwürfe des Assistenten: Schreibende Aktionen aus Claude (Wareneingang,
// neuer Artikel) werden nie direkt gebucht, sondern als Entwurf abgelegt.
// Sie erscheinen in der App unter «Vorschläge des Assistenten» und werden
// erst mit «Übernehmen» gebucht — mit der Quelle "Assistent" im Protokoll.

export const DRAFT_TYPE = { goodsIn: "wareneingang", article: "artikel" };
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

// Für die Antwort an den Assistenten: was angelegt wurde, ohne Interna.
export function draftSummary(draft) {
  return { draftId: draft.id, type: draft.type, status: draft.status, createdAt: draft.createdAt, ...draft.payload };
}
