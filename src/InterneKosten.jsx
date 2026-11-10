// Eingabe des internen Aufwands in der Quittung (Kilometer, Material). Nur für
// die Buchhaltung — die Werte erscheinen nie auf dem Beleg (siehe
// shared/internalCosts.js).

import React, { useState } from "react";
import { Car, Plus, Trash2, Lock } from "lucide-react";
import { normalizeCosts, costTotals } from "../shared/internalCosts.js";

let nextId = 0;
const newLine = () => ({ id: `m${Date.now().toString(36)}${(nextId++).toString(36)}`, description: "", amount: "" });

function chf(n) {
  return (Number(n) || 0).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// value: { km, kmRate, materials } als Eingabetexte.
export function InterneKosten({ value, onChange }) {
  const filled = !!normalizeCosts(value);
  const [open, setOpen] = useState(filled);
  const show = open || filled;
  const totals = costTotals({ internalCosts: normalizeCosts(value) });
  const set = (patch) => onChange({ ...value, ...patch });
  const setLine = (id, patch) => set({ materials: value.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  if (!show) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={s.openBtn}>
        <Car size={14} /> Aufwand für die Buchhaltung erfassen (Kilometer, Material)
      </button>
    );
  }

  return (
    <div style={s.box}>
      <div style={s.head}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
          <Lock size={13} /> Aufwand für die Buchhaltung
        </span>
        <span style={s.muted}>Erscheint nicht auf dem Beleg für den Kunden.</span>
      </div>

      <div style={s.row}>
        <label style={s.field}>
          <span style={s.label}>Gefahrene Kilometer</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={value.km}
            onChange={(e) => set({ km: e.target.value })}
            placeholder="0"
            className="mono"
            style={{ width: 110, textAlign: "right" }}
            aria-label="Gefahrene Kilometer"
          />
        </label>
        <label style={s.field}>
          <span style={s.label}>Ansatz CHF/km</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.kmRate}
            onChange={(e) => set({ kmRate: e.target.value })}
            className="mono"
            style={{ width: 90, textAlign: "right" }}
            aria-label="Ansatz pro Kilometer"
          />
        </label>
        <span style={{ ...s.muted, alignSelf: "flex-end", paddingBottom: 9 }}>
          = CHF <span className="mono">{chf(totals.travel)}</span>
        </span>
      </div>

      <div style={{ ...s.label, marginTop: 12 }}>Material (Einkaufspreis)</div>
      {value.materials.map((m) => (
        <div key={m.id} style={{ ...s.row, marginTop: 6 }}>
          <input
            value={m.description}
            onChange={(e) => setLine(m.id, { description: e.target.value })}
            placeholder="z. B. Tuch, Leder, Kleber"
            style={{ flex: 1, minWidth: 160 }}
            aria-label="Material"
          />
          <span className="mono" style={s.muted}>CHF</span>
          <input
            type="number"
            min="0"
            step="0.05"
            value={m.amount}
            onChange={(e) => setLine(m.id, { amount: e.target.value })}
            placeholder="0.00"
            className="mono"
            style={{ width: 100, textAlign: "right" }}
            aria-label="Materialkosten"
          />
          <button type="button" onClick={() => set({ materials: value.materials.filter((x) => x.id !== m.id) })} style={s.iconBtn} aria-label="Material entfernen">
            <Trash2 size={14} color="#70747C" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ materials: [...value.materials, newLine()] })} style={{ ...s.linkBtn, marginTop: 8 }}>
        <Plus size={13} /> Material hinzufügen
      </button>

      {totals.total > 0 && (
        <div style={s.total}>
          Aufwand total <span className="mono">CHF {chf(totals.total)}</span>
        </div>
      )}
    </div>
  );
}

// Formularwerte aus einer gespeicherten Quittung (oder leer).
export function costsToForm(internalCosts, defaultRate) {
  return {
    km: internalCosts?.km ? String(internalCosts.km) : "",
    kmRate: String(internalCosts?.kmRate ?? defaultRate),
    materials: (internalCosts?.materials || []).map((m) => ({ id: m.id || newLine().id, description: m.description || "", amount: m.amount ? String(m.amount) : "" })),
  };
}

const s = {
  openBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px dashed #CBCED2",
    color: "#5B5F66",
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  box: { border: "1px solid #E4E5E7", borderLeft: "3px solid #8B8F96", background: "#F7F7F5", padding: "12px 14px" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13, marginBottom: 10 },
  row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: "#5B5F66", textTransform: "uppercase", letterSpacing: "0.03em" },
  muted: { fontSize: 12, color: "#70747C" },
  iconBtn: { border: "none", background: "transparent", cursor: "pointer", padding: 6, display: "flex" },
  linkBtn: { display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: "#16181D", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 },
  total: { marginTop: 12, paddingTop: 8, borderTop: "1px solid #E4E5E7", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 },
};
