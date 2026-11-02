// Lager-Oberfläche im Reiter Inventar (ab 1.2.0): Bestand je Artikel,
// Exemplare mit Seriennummer, Wareneingang per Scanner, Garantie-Suche nach
// Seriennummer und das Protokoll der Lagerbewegungen.
//
// Reine Anzeige- und Eingabekomponenten. Gebucht wird in App.jsx über die
// Funktionen aus shared/stock.js, gespeichert in einem Schritt (setMany).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Search } from "lucide-react";
import { UNIT_STATUS_LABEL, normalizeSerial, findUnitBySerial } from "../shared/serials.js";
import { MOVEMENT_TYPE_LABEL, isSerialTracked, productStock } from "../shared/stock.js";

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function formatDateTimeDE(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Erlaubte Statuswechsel von Hand (siehe changeUnitStatus in shared/stock.js).
const STATUS_OPTIONS = {
  an_lager: ["an_lager", "reserviert"],
  reserviert: ["reserviert", "an_lager"],
  verkauft: ["verkauft", "retourniert"],
  retourniert: ["retourniert", "an_lager"],
};

const SOURCE_LABEL = { app: "App", assistent: "Assistent" };

// ---- Bestand in der Artikeltabelle ----

// Bei Seriennummernpflicht nur Anzeige (Anzahl Exemplare an Lager). Sonst ein
// Eingabefeld, das erst beim Verlassen bzw. mit Enter bucht — eine
// Inventurkorrektur pro Tastendruck wäre im Protokoll unbrauchbar.
export function StockCell({ product, units, onCommit }) {
  const [value, setValue] = useState(String(product.stock ?? 0));
  useEffect(() => setValue(String(product.stock ?? 0)), [product.stock]);

  if (isSerialTracked(product)) {
    return (
      <span className="mono" style={{ ...s.stockReadOnly, width: 80 }} title="Anzahl Exemplare an Lager">
        {productStock(product, units)}
      </span>
    );
  }

  function commit() {
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setValue(String(product.stock ?? 0));
      return;
    }
    if (next !== (Number(product.stock) || 0)) onCommit(next);
  }

  return (
    <input
      type="number"
      step="1"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="mono"
      style={{ width: 80, textAlign: "right", ...(Number(product.stock) < 0 ? { color: "#B00020" } : {}) }}
      aria-label="Stückzahl verfügbar"
      title="Neue Zählmenge — wird als Inventurkorrektur gebucht"
    />
  );
}

// ---- Exemplare eines Artikels ----

export function UnitList({ product, units, customerName, onStatus, onNote, onOpenReceipt }) {
  const list = units
    .filter((u) => u.productId === product.id)
    .sort((a, b) => (a.serial || "").localeCompare(b.serial || "", "de-CH"));

  if (list.length === 0) {
    return <div style={s.unitEmpty}>Noch keine Exemplare — Seriennummern über den Wareneingang erfassen.</div>;
  }

  return (
    <div style={s.unitBox}>
      <div style={s.unitHead}>
        <span style={{ width: 150, flexShrink: 0 }}>Seriennummer</span>
        <span style={{ width: 130, flexShrink: 0 }}>Status</span>
        <span style={{ width: 90, flexShrink: 0 }}>Eingang</span>
        <span style={{ width: 90, flexShrink: 0, textAlign: "right" }}>Einkauf</span>
        <span style={{ width: 130, flexShrink: 0 }}>Verkauf</span>
        <span style={{ flex: 1 }}>Bemerkung</span>
      </div>
      {list.map((u) => (
        <div key={u.id} style={s.unitRow}>
          <span className="mono" style={{ width: 150, flexShrink: 0, fontWeight: 600 }}>{u.serial}</span>
          <select
            value={u.status}
            onChange={(e) => onStatus(u.id, e.target.value)}
            style={{ ...s.select, width: 130, flexShrink: 0 }}
            aria-label={`Status von ${u.serial}`}
          >
            {(STATUS_OPTIONS[u.status] || [u.status]).map((st) => (
              <option key={st} value={st}>
                {UNIT_STATUS_LABEL[st] || st}
              </option>
            ))}
          </select>
          <span style={{ width: 90, flexShrink: 0 }}>{formatDateDE(u.receivedAt)}</span>
          <span className="mono" style={{ width: 90, flexShrink: 0, textAlign: "right" }}>
            {u.purchasePrice != null ? chf(u.purchasePrice) : "—"}
          </span>
          <span style={{ width: 130, flexShrink: 0 }}>
            {u.receiptId ? (
              <button type="button" style={s.linkBtn} onClick={() => onOpenReceipt(u.receiptId)}>
                Nr. {u.receiptNumber}
              </button>
            ) : u.returnedFrom ? (
              <span style={s.muted}>Retoure aus Nr. {u.returnedFrom.receiptNumber}</span>
            ) : (
              "—"
            )}
            {u.receiptId && u.customerId && <div style={s.muted}>{customerName(u)}</div>}
          </span>
          <NoteInput value={u.note || ""} onCommit={(note) => onNote(u.id, note)} />
        </div>
      ))}
    </div>
  );
}

function NoteInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="—"
      style={{ flex: 1, minWidth: 100 }}
      aria-label="Bemerkung"
    />
  );
}

// ---- Wareneingang ----

const emptyNewArticle = { articleNumber: "", name: "", group: "", price: "", serialTracked: true, stock: "" };

// Ein Barcode-Scanner verhält sich wie eine Tastatur: er tippt den Code und
// drückt Enter. Deshalb übernimmt jedes Feld hier seinen Wert mit Enter,
// behält danach den Fokus und ist sofort für den nächsten Scan bereit.
export function Wareneingang({ inventory, units, groups, onBook, onCreateProduct }) {
  const [productId, setProductId] = useState("");
  const [articleScan, setArticleScan] = useState("");
  const [scanInfo, setScanInfo] = useState("");
  const [serialInput, setSerialInput] = useState("");
  const [serials, setSerials] = useState([]);
  const [serialMessage, setSerialMessage] = useState(null); // { kind: "error" | "ok", text }
  const [quantity, setQuantity] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [newArticle, setNewArticle] = useState(null);
  const serialRef = useRef(null);
  const quantityRef = useRef(null);

  const product = inventory.find((p) => p.id === productId) || null;
  const serialTracked = isSerialTracked(product);

  const sorted = useMemo(
    () => [...inventory].sort((a, b) => (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" })),
    [inventory]
  );

  function focusEntry(p) {
    setTimeout(() => (isSerialTracked(p) ? serialRef.current : quantityRef.current)?.focus(), 0);
  }

  function selectProduct(p) {
    setProductId(p ? p.id : "");
    setSerials([]);
    setSerialMessage(null);
    setErrors([]);
    setSaved("");
    if (p) focusEntry(p);
  }

  function handleArticleScan() {
    const code = articleScan.trim();
    if (!code) return;
    const p = inventory.find((x) => (x.articleNumber || "").trim().toLowerCase() === code.toLowerCase());
    if (p) {
      selectProduct(p);
      setScanInfo("");
      setArticleScan("");
    } else {
      setScanInfo(`Artikelnummer ${code} ist nicht im Inventar.`);
      setNewArticle({ ...emptyNewArticle, articleNumber: code });
    }
  }

  function addSerial() {
    const raw = serialInput.trim();
    if (!raw) return;
    const wanted = normalizeSerial(raw);
    if (serials.some((x) => normalizeSerial(x) === wanted)) {
      setSerialMessage({ kind: "error", text: `${raw} ist bereits gescannt.` });
    } else if (findUnitBySerial(units, raw)) {
      setSerialMessage({ kind: "error", text: `${raw} ist bereits im Lager erfasst.` });
    } else {
      setSerials((prev) => [...prev, raw]);
      setSerialMessage({ kind: "ok", text: `${raw} übernommen.` });
    }
    setSerialInput("");
    serialRef.current?.focus();
  }

  async function save() {
    if (!product) return;
    setBusy(true);
    setErrors([]);
    const errs = await onBook({
      productId: product.id,
      serials: serialTracked ? serials : undefined,
      quantity: serialTracked ? undefined : quantity,
      purchasePrice,
      note,
    });
    setBusy(false);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    const count = serialTracked ? serials.length : Number(quantity);
    setSaved(`${count} × ${product.name} eingebucht.`);
    setSerials([]);
    setQuantity("");
    setNote("");
    setSerialMessage(null);
    focusEntry(product);
  }

  async function createArticle() {
    if (!newArticle?.name.trim()) return;
    const entry = await onCreateProduct(newArticle);
    if (entry) {
      setNewArticle(null);
      setScanInfo("");
      setArticleScan("");
      selectProduct(entry);
    }
  }

  const canSave = !!product && !busy && (serialTracked ? serials.length > 0 : Number(quantity) > 0);

  return (
    <div>
      <div style={s.row}>
        <label style={s.field}>
          <span style={s.label}>Artikelnummer scannen</span>
          <input
            value={articleScan}
            onChange={(e) => setArticleScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleArticleScan();
              }
            }}
            placeholder="Scannen oder tippen, Enter"
            className="mono"
            style={{ width: 200, flexShrink: 0 }}
            autoFocus
          />
        </label>
        <label style={{ ...s.field, flex: 1 }}>
          <span style={s.label}>oder Artikel wählen</span>
          <select
            value={productId}
            onChange={(e) => selectProduct(inventory.find((p) => p.id === e.target.value) || null)}
            style={s.select}
          >
            <option value="">— Artikel wählen —</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.articleNumber ? `${p.articleNumber} · ` : ""}
                {p.name}
                {isSerialTracked(p) ? " · S/N" : ""}
              </option>
            ))}
          </select>
        </label>
        {!newArticle && (
          <button type="button" style={{ ...s.secondaryBtn, alignSelf: "flex-end" }} onClick={() => setNewArticle({ ...emptyNewArticle })}>
            <Plus size={14} /> Neuer Artikel
          </button>
        )}
      </div>
      {scanInfo && <div style={s.hint}>{scanInfo}</div>}

      {newArticle && (
        <div style={s.newArticleBox}>
          <div style={s.label}>Neuen Artikel anlegen</div>
          <div style={s.row}>
            <input
              placeholder="Artikelnummer"
              value={newArticle.articleNumber}
              onChange={(e) => setNewArticle({ ...newArticle, articleNumber: e.target.value })}
              className="mono"
              style={{ width: 140, flexShrink: 0 }}
            />
            <input
              placeholder="Artikel-Name"
              value={newArticle.name}
              onChange={(e) => setNewArticle({ ...newArticle, name: e.target.value })}
              style={{ flex: 1, minWidth: 160 }}
              autoFocus
            />
            <input
              placeholder="Produktgruppe"
              list="wareneingang-gruppen"
              value={newArticle.group}
              onChange={(e) => setNewArticle({ ...newArticle, group: e.target.value })}
              style={{ width: 150, flexShrink: 0 }}
            />
            <datalist id="wareneingang-gruppen">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <input
              placeholder="Preis CHF"
              type="number"
              min="0"
              step="0.01"
              value={newArticle.price}
              onChange={(e) => setNewArticle({ ...newArticle, price: e.target.value })}
              className="mono"
              style={{ width: 100, flexShrink: 0, textAlign: "right" }}
            />
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={newArticle.serialTracked}
                onChange={(e) => setNewArticle({ ...newArticle, serialTracked: e.target.checked })}
              />
              Seriennummernpflichtig
            </label>
          </div>
          <div style={{ ...s.row, marginTop: 8 }}>
            <button
              type="button"
              onClick={createArticle}
              disabled={!newArticle.name.trim()}
              style={{ ...s.secondaryBtn, opacity: newArticle.name.trim() ? 1 : 0.4 }}
            >
              <Plus size={14} /> Anlegen und auswählen
            </button>
            <button type="button" style={s.linkBtn} onClick={() => setNewArticle(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {product && (
        <div style={s.entryBox}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            {product.name}
            {product.articleNumber && <span className="mono" style={s.muted}> · {product.articleNumber}</span>}
            <span style={s.muted}> · heute {productStock(product, units)} an Lager</span>
          </div>

          {serialTracked ? (
            <>
              <label style={s.field}>
                <span style={s.label}>Seriennummern scannen</span>
                <input
                  ref={serialRef}
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSerial();
                    }
                  }}
                  placeholder="Scannen, Enter — nächste Nummer"
                  className="mono"
                  style={{ width: 280, flexShrink: 0 }}
                  aria-label="Seriennummer"
                />
              </label>
              {serialMessage && (
                <div style={serialMessage.kind === "error" ? s.scanError : s.scanOk} role="status">
                  {serialMessage.text}
                </div>
              )}
              {serials.length > 0 && (
                <div style={s.chips}>
                  {serials.map((x) => (
                    <span key={x} className="mono" style={s.chip}>
                      {x}
                      <button
                        type="button"
                        style={s.chipRemove}
                        onClick={() => setSerials((prev) => prev.filter((y) => y !== x))}
                        aria-label={`${x} entfernen`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <span style={s.muted}>{serials.length} Exemplar{serials.length === 1 ? "" : "e"}</span>
                </div>
              )}
            </>
          ) : (
            <label style={s.field}>
              <span style={s.label}>Menge</span>
              <input
                ref={quantityRef}
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSave) save();
                }}
                className="mono"
                style={{ width: 100, flexShrink: 0, textAlign: "right" }}
              />
            </label>
          )}

          <div style={{ ...s.row, marginTop: 10 }}>
            <label style={s.field}>
              <span style={s.label}>Einkaufspreis pro Stück (optional)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="mono"
                style={{ width: 140, flexShrink: 0, textAlign: "right" }}
              />
            </label>
            <label style={{ ...s.field, flex: 1 }}>
              <span style={s.label}>Bemerkung (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Lieferschein-Nr." />
            </label>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            style={{ ...s.primaryBtn, opacity: canSave ? 1 : 0.4, marginTop: 14 }}
          >
            {busy ? "Speichere…" : "Wareneingang buchen"}
          </button>
          {errors.length > 0 && (
            <div style={s.hint} role="alert">
              {errors.map((m, i) => (
                <div key={i}>{m}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {saved && <div style={{ ...s.saved, marginTop: 10 }}>{saved}</div>}
    </div>
  );
}

// ---- Garantie-Suche nach Seriennummer ----

export function SeriennummerSuche({ units, inventory, customerName, onOpenReceipt }) {
  const [query, setQuery] = useState("");
  const q = normalizeSerial(query);
  const hits = q ? units.filter((u) => normalizeSerial(u.serial).includes(q)).slice(0, 50) : [];

  return (
    <div>
      <div style={{ ...s.row, alignItems: "center" }}>
        <Search size={16} color="#8B8F96" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Seriennummer scannen oder eintippen"
          className="mono"
          style={{ width: 320, flexShrink: 0 }}
          autoFocus
          aria-label="Seriennummer suchen"
        />
      </div>
      {q && hits.length === 0 && <div style={s.empty}>Keine Seriennummer gefunden.</div>}
      {hits.map((u) => {
        const product = inventory.find((p) => p.id === u.productId);
        return (
          <div key={u.id} style={s.hitCard}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{u.serial}</div>
                <div>
                  {product ? product.name : "Artikel nicht mehr im Inventar"}
                  {product?.articleNumber && <span className="mono" style={s.muted}> · {product.articleNumber}</span>}
                </div>
              </div>
              <span style={{ ...s.statusBadge, ...(STATUS_BADGE[u.status] || {}) }}>{UNIT_STATUS_LABEL[u.status] || u.status}</span>
            </div>
            <div style={s.hitGrid}>
              <span style={s.muted}>Eingang</span>
              <span>{formatDateDE(u.receivedAt) || "—"}</span>
              <span style={s.muted}>Verkauft am</span>
              <span>{u.soldAt ? formatDateDE(u.soldAt) : "—"}</span>
              <span style={s.muted}>Quittung</span>
              <span>
                {u.receiptId ? (
                  <button type="button" style={s.linkBtn} onClick={() => onOpenReceipt(u.receiptId)}>
                    Nr. {u.receiptNumber} öffnen
                  </button>
                ) : u.returnedFrom ? (
                  <>
                    Retoure aus{" "}
                    <button type="button" style={s.linkBtn} onClick={() => onOpenReceipt(u.returnedFrom.receiptId)}>
                      Nr. {u.returnedFrom.receiptNumber}
                    </button>
                  </>
                ) : (
                  "—"
                )}
              </span>
              <span style={s.muted}>Kunde</span>
              <span>{customerName(u) || "—"}</span>
              {u.note && (
                <>
                  <span style={s.muted}>Bemerkung</span>
                  <span>{u.note}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_BADGE = {
  an_lager: { background: "#EAF6EE", color: "#155C2C" },
  reserviert: { background: "#FDF3EC", color: "#8A4B12" },
  verkauft: { background: "#EDEEEF", color: "#16181D" },
  retourniert: { background: "#FDEBEC", color: "#8A1620" },
};

// ---- Protokoll der Lagerbewegungen ----

export function Lagerbewegungen({ movementsByKey, inventory, onOpenReceipt }) {
  const [productFilter, setProductFilter] = useState("");
  const [limit, setLimit] = useState(100);
  const all = useMemo(
    () =>
      Object.values(movementsByKey)
        .flat()
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    [movementsByKey]
  );
  const filtered = productFilter ? all.filter((m) => m.productId === productFilter) : all;
  const nameOf = (id) => inventory.find((p) => p.id === id)?.name || "—";

  if (all.length === 0) return <div style={s.empty}>Noch keine Lagerbewegungen.</div>;

  return (
    <div>
      <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} style={{ ...s.select, width: 280, marginBottom: 10 }}>
        <option value="">Alle Artikel ({all.length} Bewegungen)</option>
        {[...inventory]
          .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de-CH"))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <div style={s.unitHead}>
        <span style={{ width: 120, flexShrink: 0 }}>Zeitpunkt</span>
        <span style={{ flex: 1 }}>Artikel</span>
        <span style={{ width: 120, flexShrink: 0 }}>Seriennummer</span>
        <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}>Menge</span>
        <span style={{ width: 120, flexShrink: 0 }}>Typ</span>
        <span style={{ width: 120, flexShrink: 0 }}>Referenz</span>
        <span style={{ width: 70, flexShrink: 0 }}>Quelle</span>
      </div>
      {filtered.slice(0, limit).map((m) => (
        <div key={m.id} style={s.unitRow}>
          <span style={{ width: 120, flexShrink: 0 }}>{formatDateTimeDE(m.at)}</span>
          <span style={{ flex: 1 }}>{nameOf(m.productId)}</span>
          <span className="mono" style={{ width: 120, flexShrink: 0 }}>{m.serial || ""}</span>
          <span className="mono" style={{ width: 60, flexShrink: 0, textAlign: "right", color: m.qty < 0 ? "#B00020" : "#155C2C" }}>
            {m.qty > 0 ? `+${m.qty}` : m.qty}
          </span>
          <span style={{ width: 120, flexShrink: 0 }}>{MOVEMENT_TYPE_LABEL[m.type] || m.type}</span>
          <span style={{ width: 120, flexShrink: 0 }}>
            {m.ref?.receiptId ? (
              <button type="button" style={s.linkBtn} onClick={() => onOpenReceipt(m.ref.receiptId)}>
                Quittung {m.ref.receiptNumber}
              </button>
            ) : (
              <span style={s.muted}>{m.ref?.note || ""}</span>
            )}
          </span>
          <span style={{ width: 70, flexShrink: 0 }}>{SOURCE_LABEL[m.source] || m.source}</span>
        </div>
      ))}
      {filtered.length > limit && (
        <button type="button" style={{ ...s.linkBtn, marginTop: 10 }} onClick={() => setLimit(limit + 200)}>
          Weitere anzeigen ({filtered.length - limit})
        </button>
      )}
    </div>
  );
}

// Gleiche Farben und Masse wie die Stile in App.jsx.
const s = {
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: "#8B8F96", textTransform: "uppercase", letterSpacing: "0.03em" },
  select: { width: "100%", padding: "8px 10px", border: "1px solid #DADDE1", fontSize: 13, background: "#fff" },
  muted: { fontSize: 12, color: "#8B8F96" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "20px 0" },
  hint: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 8 },
  saved: { fontSize: 12, color: "#1D7A3C" },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: "#E30613",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
    padding: 0,
  },
  secondaryBtn: {
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  primaryBtn: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "11px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B5F66" },
  newArticleBox: { border: "1px dashed #DADDE1", padding: 12, marginTop: 12, display: "grid", gap: 8 },
  entryBox: { border: "1px solid #E4E5E7", padding: 16, marginTop: 16, background: "#fff" },
  scanError: { fontSize: 13, fontWeight: 600, color: "#fff", background: "#B00020", padding: "6px 10px", marginTop: 6, width: "fit-content" },
  scanOk: { fontSize: 12, color: "#1D7A3C", marginTop: 6 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, alignItems: "center" },
  chip: { display: "flex", alignItems: "center", gap: 4, border: "1px solid #DADDE1", padding: "3px 6px", fontSize: 12, background: "#F7F7F5" },
  chipRemove: { border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: "#70747C" },
  stockReadOnly: { display: "inline-block", textAlign: "right", padding: "8px 10px", fontSize: 13, color: "#5B5F66" },
  unitBox: { margin: "4px 0 10px 24px", borderLeft: "2px solid #EDEEEF", paddingLeft: 12 },
  unitEmpty: { margin: "4px 0 10px 24px", fontSize: 12, color: "#8B8F96", fontStyle: "italic" },
  unitHead: {
    display: "flex",
    gap: 8,
    padding: "4px 0",
    fontSize: 11,
    fontWeight: 600,
    color: "#8B8F96",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: "1px solid #E4E5E7",
  },
  unitRow: { display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid #F1F1EF", fontSize: 12 },
  hitCard: { border: "1px solid #E4E5E7", padding: 14, marginTop: 12, background: "#fff", maxWidth: 560 },
  hitGrid: { display: "grid", gridTemplateColumns: "110px 1fr", gap: "4px 10px", marginTop: 10, fontSize: 13 },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: "4px 8px", height: "fit-content", textTransform: "uppercase" },
};

