// Offerten: Liste mit Suche und Stand (offen, angenommen, abgelehnt,
// abgelaufen). «Als Quittung übernehmen» füllt das Quittungsformular — erst
// die Quittung bucht das Lager (siehe App.jsx, startReceiptFromQuote).

import React, { useMemo, useState } from "react";
import { Plus, Search, X, Check, Trash2 } from "lucide-react";
import { receiptMatches } from "../shared/search.js";
import { quoteState, QUOTE_STATE_LABEL, QUOTE_STATUS } from "../shared/documents.js";

function chf(n) {
  return (Number(n) || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

const FILTERS = [
  ["alle", "Alle"],
  ["offen", "Offen"],
  ["abgelaufen", "Abgelaufen"],
  ["angenommen", "Angenommen"],
  ["abgelehnt", "Abgelehnt"],
];

const STATE_STYLE = {
  offen: { background: "#EEF3FB", color: "#1F4B8F" },
  abgelaufen: { background: "#FDF3EC", color: "#B5480C" },
  angenommen: { background: "#EAF6EE", color: "#155C2C" },
  abgelehnt: { background: "#F1F1EF", color: "#70747C" },
};

export default function Offerten({ quotes, today, onNew, onOpen, onEdit, onAccept, onSetStatus, onDelete, onOpenReceipt }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("alle");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const list = useMemo(
    () =>
      (quotes || [])
        .filter((q) => filter === "alle" || quoteState(q, today) === filter)
        .filter((q) => receiptMatches(q, query))
        .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : String(b.number).localeCompare(String(a.number)))),
    [quotes, filter, query, today]
  );
  const openTotal = (quotes || [])
    .filter((q) => quoteState(q, today) === QUOTE_STATUS.open)
    .reduce((s, q) => s + (Number(q.total) || 0), 0);

  return (
    <div>
      <div style={s.headRow}>
        <h1 style={s.h1}>Offerten</h1>
        <button type="button" onClick={onNew} style={s.primary}>
          <Plus size={14} /> Neue Offerte
        </button>
      </div>

      <div style={s.searchRow}>
        <Search size={15} color="#8B8F96" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen: Nummer, Kunde oder Artikel"
          style={{ flex: 1, border: "none", outline: "none", padding: "8px 0", background: "transparent" }}
          aria-label="Offerten durchsuchen"
        />
        {query && (
          <button type="button" style={s.iconBtn} onClick={() => setQuery("")} aria-label="Suche leeren">
            <X size={14} />
          </button>
        )}
      </div>

      <div style={s.filterRow} role="radiogroup" aria-label="Stand">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filter === id}
            onClick={() => setFilter(id)}
            style={{ ...s.filterBtn, ...(filter === id ? s.filterBtnOn : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={s.empty}>{(quotes || []).length === 0 ? "Noch keine Offerten erstellt." : "Keine Offerte gefunden."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((q) => {
            const state = quoteState(q, today);
            return (
              <div key={q.id} style={s.row}>
                <div style={s.rowMain}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      <span className="mono">{q.number}</span> · {q.customer?.name}
                    </div>
                    <div style={s.muted}>
                      {formatDateDE(q.date)} · gültig bis {formatDateDE(q.validUntil)}
                      {q.vatEnabled ? " · inkl. MWST" : ""}
                      {q.emailDelivery ? ` · E-Mail ${q.emailDelivery.status}` : ""}
                    </div>
                    {state === "angenommen" && q.receiptNumber && (
                      <button type="button" style={{ ...s.link, marginTop: 4 }} onClick={() => onOpenReceipt(q.receiptId)}>
                        → Quittung Nr. {q.receiptNumber}
                      </button>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontWeight: 700 }}>CHF {chf(q.total)}</div>
                    <span style={{ ...s.pill, ...STATE_STYLE[state] }}>{QUOTE_STATE_LABEL[state]}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" onClick={() => onOpen(q)} style={s.action}>
                    Öffnen
                  </button>
                  {q.status !== QUOTE_STATUS.accepted && (
                    <>
                      <button type="button" onClick={() => onEdit(q)} style={s.action}>
                        Bearbeiten
                      </button>
                      <button type="button" onClick={() => onAccept(q)} style={s.accept}>
                        <Check size={13} /> Als Quittung übernehmen
                      </button>
                    </>
                  )}
                  {q.status === QUOTE_STATUS.open && (
                    <button type="button" onClick={() => onSetStatus(q.id, QUOTE_STATUS.declined)} style={s.action}>
                      Abgelehnt
                    </button>
                  )}
                  {q.status === QUOTE_STATUS.declined && (
                    <button type="button" onClick={() => onSetStatus(q.id, QUOTE_STATUS.open)} style={s.action}>
                      Wieder offen
                    </button>
                  )}
                  {confirmDelete === q.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(null);
                          onDelete(q.id);
                        }}
                        style={s.danger}
                      >
                        Ja, löschen
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} style={s.action}>
                        Nein
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(q.id)} style={s.action} aria-label={`Offerte ${q.number} löschen`}>
                      <Trash2 size={12} /> Löschen
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openTotal > 0 && (
        <div style={s.totals}>
          <span>Offene Offerten</span>
          <span className="mono">CHF {chf(openTotal)}</span>
        </div>
      )}
    </div>
  );
}

const s = {
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  h1: { fontSize: 22, fontWeight: 700, margin: 0 },
  primary: { background: "#16181D", color: "#fff", border: "none", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #DADDE1", background: "#fff", padding: "0 10px", marginBottom: 10 },
  iconBtn: { border: "none", background: "transparent", cursor: "pointer", padding: 6, display: "flex" },
  filterRow: { display: "inline-flex", border: "1px solid #DADDE1", background: "#fff", marginBottom: 16, flexWrap: "wrap" },
  filterBtn: { background: "transparent", color: "#5B5F66", border: "none", padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  filterBtnOn: { background: "#16181D", color: "#fff" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "20px 0" },
  row: { padding: "10px 14px", background: "#fff", border: "1px solid #EDEEEF" },
  rowMain: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  muted: { fontSize: 12, color: "#70747C" },
  pill: { display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", marginTop: 4 },
  action: { background: "#fff", color: "#16181D", border: "1px solid #DADDE1", fontSize: 11, fontWeight: 600, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 },
  accept: { background: "#1D7A3C", color: "#fff", border: "none", fontSize: 11, fontWeight: 600, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 },
  danger: { background: "#B00020", color: "#fff", border: "none", fontSize: 11, fontWeight: 600, padding: "6px 10px", cursor: "pointer" },
  link: { background: "transparent", border: "none", color: "#E30613", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 },
  totals: { display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 10, borderTop: "1px solid #DADDE1", fontSize: 13, fontWeight: 600 },
};
