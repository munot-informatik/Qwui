// Gutschrift zu einer Quittung oder Rechnung: Positionen wählen, Menge,
// zurück ins Lager oder nicht (z. B. defekt, geht an den Lieferanten), Art
// der Rückerstattung. Gebucht wird in App.jsx (createCreditNote).

import React, { useState } from "react";
import { Undo2 } from "lucide-react";
import { creditableLines, docWord, REFUND_METHODS } from "../shared/documents.js";
import { itemKind, itemLineTotal } from "../shared/items.js";

function chf(n) {
  return (Number(n) || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GutschriftForm({ receipt, creditNotes, today, onCreate, onCancel }) {
  const lines = creditableLines(receipt, creditNotes);
  const [picked, setPicked] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.item.id, { on: false, quantity: String(l.remaining || 0), restock: true }]))
  );
  const openInvoice = receipt.qrBillEnabled && !receipt.paid;
  const [refund, setRefund] = useState(openInvoice ? "verrechnung" : "bar");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const set = (id, patch) => setPicked((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const chosen = lines.filter((l) => picked[l.item.id]?.on && l.remaining > 0);
  const total = chosen.reduce((s, l) => s + itemLineTotal({ ...l.item, quantity: Number(picked[l.item.id].quantity) || 0 }), 0);
  const word = docWord(receipt);

  async function submit() {
    setBusy(true);
    setErrors([]);
    const selection = chosen.map((l) => ({
      itemId: l.item.id,
      quantity: Number(picked[l.item.id].quantity),
      restock: picked[l.item.id].restock,
    }));
    let result;
    try {
      result = await onCreate(selection, { date, refund, note });
    } catch (e) {
      result = [e.message || String(e)];
    }
    setBusy(false);
    if (result && result.length) setErrors(result);
  }

  return (
    <div className="no-print" style={s.box}>
      <div style={s.head}>
        <Undo2 size={15} /> Gutschrift / Retoure zu {word} Nr. <span className="mono">{receipt.number}</span>
      </div>
      <div style={s.muted}>
        Positionen wählen, die zurückkommen oder gutgeschrieben werden. Produkte gehen mit «zurück ins Lager» wieder in
        den Bestand — ohne Häkchen (z. B. defekt) bleibt der Bestand, wie er ist, und Exemplare mit Seriennummer stehen
        auf «retourniert».
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {lines.map((l) => {
          const p = picked[l.item.id];
          const isProduct = itemKind(l.item) === "product" && !!l.item.productId;
          const disabled = l.remaining === 0;
          return (
            <div key={l.item.id} style={{ ...s.line, opacity: disabled ? 0.5 : 1 }}>
              <label style={s.check}>
                <input
                  type="checkbox"
                  checked={!!p?.on && !disabled}
                  disabled={disabled}
                  onChange={(e) => set(l.item.id, { on: e.target.checked })}
                  aria-label={`${l.item.description} gutschreiben`}
                />
                <span>
                  <span style={{ fontWeight: 600 }}>{l.item.description}</span>
                  {l.item.serial && <span className="mono" style={s.muted}> · S/N {l.item.serial}</span>}
                  <span style={{ ...s.muted, display: "block" }}>
                    verkauft {l.sold}
                    {l.credited ? ` · schon gutgeschrieben ${l.credited}` : ""}
                    {disabled ? " · vollständig gutgeschrieben" : ""}
                  </span>
                </span>
              </label>
              {p?.on && !disabled && (
                <div style={s.lineOptions}>
                  {l.remaining > 1 && (
                    <label style={s.field}>
                      Menge
                      <input
                        type="number"
                        min="1"
                        max={l.remaining}
                        step="1"
                        value={p.quantity}
                        onChange={(e) => set(l.item.id, { quantity: e.target.value })}
                        className="mono"
                        style={{ width: 60, textAlign: "right" }}
                        aria-label="Menge gutschreiben"
                      />
                      <span style={s.muted}>von {l.remaining}</span>
                    </label>
                  )}
                  {isProduct && (
                    <label style={s.field}>
                      <input type="checkbox" checked={p.restock} onChange={(e) => set(l.item.id, { restock: e.target.checked })} />
                      zurück ins Lager
                    </label>
                  )}
                  <span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>
                    CHF {chf(itemLineTotal({ ...l.item, quantity: Number(p.quantity) || 0 }))}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
        <label style={s.stack}>
          <span style={s.label}>Datum</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
        </label>
        <label style={s.stack}>
          <span style={s.label}>Rückerstattung</span>
          <select value={refund} onChange={(e) => setRefund(e.target.value)} style={s.select}>
            {REFUND_METHODS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...s.stack, flex: 1, minWidth: 200 }}>
          <span style={s.label}>Grund / Notiz (optional, steht auf der Gutschrift)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Spitze defekt" />
        </label>
      </div>
      {openInvoice && refund === "verrechnung" && (
        <div style={{ ...s.muted, marginTop: 8 }}>
          Die Rechnung ist noch offen: Unter «Belege» zählt danach nur noch der Restbetrag als offen, und eine Mahnung
          verlangt nur diesen.
        </div>
      )}

      {errors.length > 0 && (
        <div style={s.error} role="alert">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={submit} disabled={busy || chosen.length === 0} style={{ ...s.primary, opacity: busy || chosen.length === 0 ? 0.4 : 1 }}>
          {busy ? "Erstelle…" : `Gutschrift über CHF ${chf(total)} erstellen`}
        </button>
        <button type="button" onClick={onCancel} style={s.link}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

const s = {
  box: { maxWidth: 640, margin: "0 auto 16px", border: "1px solid #DADDE1", background: "#fff", padding: 16 },
  head: { display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, marginBottom: 6 },
  muted: { fontSize: 12, color: "#70747C" },
  line: { borderBottom: "1px solid #EDEEEF", paddingBottom: 8 },
  check: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" },
  lineOptions: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 6, marginLeft: 24, fontSize: 12 },
  field: { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#5B5F66" },
  stack: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: "#8B8F96", textTransform: "uppercase", letterSpacing: "0.06em" },
  select: { padding: "8px 10px", border: "1px solid #DADDE1", fontSize: 13, background: "#fff" },
  error: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 12 },
  primary: { background: "#16181D", color: "#fff", border: "none", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  link: { background: "transparent", border: "none", color: "#E30613", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 },
};
