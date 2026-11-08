// Kunden: Auswahl in der Quittung (Suche statt langer Liste, ohne Kunde gilt
// «Laufkunde») und Kundenliste mit Suche und Bearbeiten.
//
// Gespeichert wird in App.jsx; hier nur Anzeige und Eingabe.

import React, { useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, X, Check } from "lucide-react";
import { hasEmailConsent, grantEmailConsent, hasLegacyEmailWithoutConsent } from "../shared/consent.js";
import { searchCustomers } from "../shared/search.js";
import { localDateISO } from "../shared/dates.js";

export const WALK_IN_NAME = "Laufkunde";

const todayISO = () => localDateISO();

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function addressLines(person) {
  if (!person) return [];
  const line1 = `${person.street || ""} ${person.houseNumber || ""}`.trim();
  const line2 = `${person.postalCode || ""} ${person.city || ""}`.trim();
  const structured = [line1, line2].filter(Boolean);
  if (structured.length) return structured;
  return person.address ? [person.address] : [];
}

export function ConsentCheckbox({ person, onChange }) {
  return (
    <label style={k.checkLabel}>
      <input
        type="checkbox"
        checked={hasEmailConsent(person)}
        onChange={(e) => onChange(e.target.checked ? grantEmailConsent(person, todayISO()) : { ...person, emailConsent: null })}
      />
      Einverständnis E-Mail-Beleg (Adresse speichern, Belege per E-Mail)
    </label>
  );
}

// Die Eingabefelder einer Person, überall gleich.
export function PersonFields({ person, onChange, autoFocus = false }) {
  const set = (field) => (e) => onChange({ ...person, [field]: e.target.value });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input placeholder="Name" value={person.name} onChange={set("name")} autoFocus={autoFocus} aria-label="Name" />
      <div style={{ display: "flex", gap: 8 }}>
        <input placeholder="Strasse" value={person.street} onChange={set("street")} style={{ flex: 2 }} />
        <input placeholder="Nr." value={person.houseNumber} onChange={set("houseNumber")} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input placeholder="PLZ" value={person.postalCode} onChange={set("postalCode")} style={{ flex: 1 }} />
        <input placeholder="Ort" value={person.city} onChange={set("city")} style={{ flex: 2 }} />
      </div>
      <input placeholder="E-Mail" value={person.email} onChange={set("email")} />
      {person.email && <ConsentCheckbox person={person} onChange={onChange} />}
      <input placeholder="Telefon (für WhatsApp, z.B. +41 79 123 45 67)" value={person.phone} onChange={set("phone")} />
    </div>
  );
}

function isEmptyPerson(p) {
  return !["name", "street", "houseNumber", "postalCode", "city", "email", "phone", "address"].some((f) => String(p?.[f] || "").trim());
}

// Empfänger in der Quittung.
//  - Gespeicherter Kunde: per Suche wählen, als Karte angezeigt.
//  - Neuer Empfänger: Adressfelder, optional als Kunde speichern.
//  - Nichts davon: die Quittung geht an «Laufkunde».
export function Kundenwahl({
  customers,
  selectedCustomerId,
  onSelect,
  manualCustomer,
  onManualChange,
  onSaveManual,
  emptyPerson,
  qrBillEnabled,
  addressRequired,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const selected = customers.find((c) => c.id === selectedCustomerId) || null;
  const hits = useMemo(() => searchCustomers(customers, query, 6), [customers, query]);
  const showManual = !selected && (manualOpen || !isEmptyPerson(manualCustomer));

  function choose(c) {
    onSelect(c.id);
    setQuery("");
    setOpen(false);
    setManualOpen(false);
  }

  function startManual() {
    onManualChange({ ...emptyPerson, name: query.trim() });
    setManualOpen(true);
    setOpen(false);
    setQuery("");
  }

  function backToWalkIn() {
    onManualChange(emptyPerson);
    setManualOpen(false);
  }

  // Gilt für alle drei Ansichten (Kunde gewählt, Adresse eingeben, Suche).
  const hint =
    qrBillEnabled || addressRequired ? (
      <div style={k.hint}>
        {addressRequired
          ? "Ab CHF 400 ist die Adresse des Käufers gesetzlich vorgeschrieben (OR Art. 958f)."
          : "Für eine Rechnung bitte einen Kunden wählen oder die Adresse eingeben."}
      </div>
    ) : null;

  if (selected) {
    return (
      <div>
      <div style={k.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{selected.name}</div>
            {addressLines(selected).map((l, i) => (
              <div key={i} style={k.muted}>
                {l}
              </div>
            ))}
            {selected.email && <div style={k.muted}>{selected.email}</div>}
            {selected.phone && <div style={k.muted}>{selected.phone}</div>}
          </div>
          <button type="button" style={k.linkBtn} onClick={() => onSelect("")}>
            Anderer Kunde
          </button>
        </div>
      </div>
      {hint}
      </div>
    );
  }

  if (showManual) {
    return (
      <div>
        <PersonFields person={manualCustomer} onChange={onManualChange} autoFocus={manualOpen && !manualCustomer.street} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              onSaveManual();
              setManualOpen(false);
            }}
            disabled={!manualCustomer.name.trim()}
            style={{ ...k.secondaryBtn, opacity: manualCustomer.name.trim() ? 1 : 0.4 }}
          >
            <Plus size={14} /> In Kundenliste speichern
          </button>
          <button type="button" style={k.linkBtn} onClick={backToWalkIn}>
            Doch ohne Kunde (Laufkunde)
          </button>
        </div>
        {hint}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={k.searchRow}>
        <Search size={15} color="#8B8F96" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0] && query.trim()) {
              e.preventDefault();
              choose(hits[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={customers.length ? "Kunde suchen (Name, Telefon, E-Mail)" : "Noch keine Kunden gespeichert"}
          style={{ flex: 1, border: "none", outline: "none", padding: "8px 0" }}
          aria-label="Kunde suchen"
          disabled={!customers.length}
        />
      </div>
      {open && customers.length > 0 && (
        <div style={k.dropdown} role="listbox">
          {hits.length === 0 && <div style={{ ...k.muted, padding: "8px 10px" }}>Kein Kunde gefunden.</div>}
          {hits.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              style={k.option}
            >
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={k.muted}>{[addressLines(c)[1], c.email, c.phone].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" style={k.secondaryBtn} onClick={startManual}>
          <Plus size={14} /> {query.trim() ? `«${query.trim()}» als neuen Kunden` : "Neuer Kunde / Adresse eingeben"}
        </button>
        <span style={k.muted}>Ohne Kunde geht die Quittung an «{WALK_IN_NAME}».</span>
      </div>
      {hint}
    </div>
  );
}

// Kundenliste mit Suche, Bearbeiten und Löschen.
export function KundenListe({ customers, onSave, onDelete, onConsent, emptyPerson }) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const list = useMemo(
    () => (query.trim() ? searchCustomers(customers, query, 500) : [...customers].sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH"))),
    [customers, query]
  );

  function startEdit(c) {
    setEditingId(c.id);
    setDraft({ ...emptyPerson, ...c });
  }

  async function saveEdit() {
    if (!draft.name.trim()) return;
    await onSave(draft);
    setEditingId(null);
    setDraft(null);
  }

  return (
    <div>
      {customers.length > 0 && (
        <div style={{ ...k.searchRow, maxWidth: 420 }}>
          <Search size={15} color="#8B8F96" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${customers.length} Kunden durchsuchen`}
            style={{ flex: 1, border: "none", outline: "none", padding: "8px 0" }}
            aria-label="Kunden durchsuchen"
          />
          {query && (
            <button type="button" style={k.iconBtn} onClick={() => setQuery("")} aria-label="Suche leeren">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {customers.length === 0 && <div style={k.empty}>Noch keine Kunden gespeichert.</div>}
      {customers.length > 0 && list.length === 0 && <div style={k.empty}>Kein Kunde gefunden.</div>}
      {list.map((c) =>
        editingId === c.id ? (
          <div key={c.id} style={{ ...k.card, maxWidth: 420, margin: "12px 0" }}>
            <PersonFields person={draft} onChange={setDraft} autoFocus />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" style={k.primaryBtn} onClick={saveEdit} disabled={!draft.name.trim()}>
                <Check size={14} /> Speichern
              </button>
              <button type="button" style={k.secondaryBtn} onClick={() => setEditingId(null)}>
                Abbrechen
              </button>
            </div>
            <div style={{ ...k.muted, marginTop: 8 }}>
              Bestehende Quittungen behalten die Angaben von damals.
            </div>
          </div>
        ) : (
          <div key={c.id} style={k.listRow}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              {addressLines(c).map((l, i) => (
                <div style={k.muted} key={i}>
                  {l}
                </div>
              ))}
              {c.email && <div style={k.muted}>{c.email}</div>}
              {hasEmailConsent(c) && c.email && <div style={k.muted}>Einverständnis E-Mail-Beleg seit {formatDateDE(c.emailConsent.at)}</div>}
              {hasLegacyEmailWithoutConsent(c) && (
                <div style={{ ...k.muted, color: "#B5480C" }}>
                  Einverständnis E-Mail-Beleg fehlt —{" "}
                  <button type="button" style={k.linkBtn} onClick={() => onConsent(c.id, true)}>
                    erfassen
                  </button>{" "}
                  oder{" "}
                  <button type="button" style={k.linkBtn} onClick={() => onConsent(c.id, false)}>
                    Adresse entfernen
                  </button>
                </div>
              )}
              {c.phone && <div style={k.muted}>{c.phone}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {confirmDelete === c.id ? (
                <>
                  <span style={k.muted}>Löschen?</span>
                  <button type="button" style={k.dangerBtn} onClick={() => onDelete(c.id)}>
                    Ja, löschen
                  </button>
                  <button type="button" style={k.secondaryBtn} onClick={() => setConfirmDelete(null)}>
                    Nein
                  </button>
                </>
              ) : (
                <>
                  <button type="button" style={k.secondaryBtn} onClick={() => startEdit(c)}>
                    <Pencil size={13} /> Bearbeiten
                  </button>
                  <button type="button" style={k.iconBtn} onClick={() => setConfirmDelete(c.id)} aria-label={`${c.name} löschen`}>
                    <Trash2 size={14} color="#70747C" />
                  </button>
                </>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

const k = {
  card: { border: "1px solid #E4E5E7", padding: 12, background: "#fff" },
  muted: { fontSize: 12, color: "#8B8F96" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "20px 0" },
  hint: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 8 },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B5F66" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #DADDE1", background: "#fff", padding: "0 10px" },
  dropdown: {
    position: "absolute",
    zIndex: 20,
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #DADDE1",
    borderTop: "none",
    boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
    maxHeight: 280,
    overflowY: "auto",
  },
  option: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    textAlign: "left",
    background: "#fff",
    border: "none",
    borderBottom: "1px solid #F1F1EF",
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
  },
  listRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #EDEEEF" },
  linkBtn: { background: "transparent", border: "none", color: "#E30613", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 },
  iconBtn: { border: "none", background: "transparent", cursor: "pointer", padding: 6, display: "flex" },
  secondaryBtn: {
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "fit-content",
  },
  primaryBtn: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dangerBtn: { background: "#B00020", color: "#fff", border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
};
