import React, { useMemo, useState } from "react";
import { Download, Check, Loader2, AlertTriangle, Bell } from "lucide-react";
import { buildMahnungPdfBytes } from "./receiptPdf.js";

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Anzahl ganzer Tage zwischen einem ISO-Datum und heute.
function daysSince(iso) {
  if (!iso) return 0;
  const from = new Date(`${iso}T00:00:00`);
  const now = new Date();
  return Math.floor((now - from) / 86400000);
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// Rückfall-Zahlungsfrist für Belege ohne eigenes paymentTermDays (Alt-Belege).
const DEFAULT_PAYMENT_TERM_DAYS = 30;

// Individuelle Zahlungsfrist einer Rechnung in Tagen (siehe src/App.jsx).
function paymentTermOf(receipt) {
  const d = Number(receipt?.paymentTermDays);
  return Number.isFinite(d) && d >= 0 ? d : DEFAULT_PAYMENT_TERM_DAYS;
}

function statusOf(receipt) {
  if (receipt.qrBillEnabled) {
    return receipt.paid ? "bezahlt" : "offen";
  }
  return "direkt";
}

function statusLabel(status) {
  if (status === "offen") return "Offene Rechnung";
  if (status === "bezahlt") return "Rechnung bezahlt";
  return "Direktzahlung";
}

// Offene QR-Rechnung, deren individuelle Zahlungsfrist ab Rechnungsdatum
// (siehe Hinweistext auf der Rechnung) bereits abgelaufen ist.
function isOverdue(receipt) {
  return statusOf(receipt) === "offen" && daysSince(receipt.date) > paymentTermOf(receipt);
}

// Tage über die Zahlungsfrist hinaus (>= 1, wenn überfällig).
function daysOverdue(receipt) {
  return daysSince(receipt.date) - paymentTermOf(receipt);
}

export default function BuchhaltungTab({ receipts, onTogglePaid }) {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-11, or "all"
  const [exporting, setExporting] = useState(false);
  const [mahnungId, setMahnungId] = useState(null);

  const availableYears = useMemo(() => {
    const years = new Set([now.getFullYear()]);
    receipts.forEach((r) => {
      const y = Number((r.date || "").slice(0, 4));
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [receipts]);

  const filtered = useMemo(() => {
    return receipts
      .filter((r) => {
        const [y, m] = (r.date || "").split("-");
        if (Number(y) !== selectedYear) return false;
        if (selectedMonth !== "all" && Number(m) - 1 !== selectedMonth) return false;
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [receipts, selectedYear, selectedMonth]);

  const total = filtered.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const totalOpen = filtered
    .filter((r) => statusOf(r) === "offen")
    .reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const totalPaid = total - totalOpen;
  const overdueCount = filtered.filter(isOverdue).length;

  function periodLabel() {
    if (selectedMonth === "all") return `Jahr ${selectedYear}`;
    return `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;
  }

  async function exportToExcel() {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");

      const rows = filtered.map((r) => ({
        "Nr.": r.number,
        Datum: formatDateDE(r.date),
        Kunde: r.customer?.name || "",
        "Betrag (CHF)": Number(r.total) || 0,
        "MWST enthalten": r.vatEnabled ? "Ja" : "Nein",
        Status: statusLabel(statusOf(r)),
      }));

      rows.push({});
      rows.push({ "Nr.": "", Datum: "", Kunde: "Total", "Betrag (CHF)": total, "MWST enthalten": "", Status: "" });
      rows.push({ "Nr.": "", Datum: "", Kunde: "davon bezahlt", "Betrag (CHF)": totalPaid, "MWST enthalten": "", Status: "" });
      rows.push({ "Nr.": "", Datum: "", Kunde: "davon offen", "Betrag (CHF)": totalOpen, "MWST enthalten": "", Status: "" });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Buchhaltung");

      const filename = `Buchhaltung_${selectedMonth === "all" ? "Jahr" : MONTH_NAMES[selectedMonth]}_${selectedYear}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (e) {
      // Vorher nur console.error: der Knopf sprang einfach zurück, ohne Datei
      // und ohne Meldung — der Benutzer konnte nicht wissen, was los war.
      console.error("Excel-Export fehlgeschlagen", e);
      alert(`Excel-Export fehlgeschlagen: ${e.message || "unbekannter Fehler"}`);
    } finally {
      setExporting(false);
    }
  }

  async function createMahnung(receipt) {
    setMahnungId(receipt.id);
    try {
      const pdfBytes = await buildMahnungPdfBytes(receipt);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Mahnung_${receipt.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Mahnung-Erzeugung fehlgeschlagen", err);
      alert(`Mahnung konnte nicht erstellt werden: ${err.message}`);
    } finally {
      setMahnungId(null);
    }
  }

  return (
    <div>
      <div style={styles.eyebrow}>05 — Buchhaltung</div>
      <h1 style={styles.h1}>Buchhaltung</h1>

      <div style={styles.filterRow}>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value === "all" ? "all" : Number(e.target.value))}
          style={styles.select}
        >
          <option value="all">Ganzes Jahr</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i}>{m}</option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          style={styles.select}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <button onClick={exportToExcel} style={styles.exportBtn} disabled={filtered.length === 0 || exporting}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {exporting ? "Exportiere…" : "Export zu Excel"}
        </button>
      </div>

      <div style={styles.legend}>
        <span style={styles.legendItem}><span style={{ ...styles.dot, background: "#B00020" }} /> Offene Rechnung</span>
        <span style={styles.legendItem}><span style={{ ...styles.dot, background: "#1D7A3C" }} /> Bezahlt / Direktzahlung</span>
        <span style={styles.legendItem}><AlertTriangle size={12} color="#B5480C" /> Überfällig (Zahlungsfrist abgelaufen)</span>
      </div>

      {overdueCount > 0 && (
        <div style={styles.overdueBanner}>
          <AlertTriangle size={14} color="#B5480C" />
          {overdueCount} offene Rechnung{overdueCount === 1 ? "" : "en"} in diesem Zeitraum
          {overdueCount === 1 ? " hat" : " haben"} ihre Zahlungsfrist überschritten.
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={styles.empty}>Keine Einträge für {periodLabel()}.</div>
      ) : (
        <div style={styles.table}>
          {filtered.map((r) => {
            const status = statusOf(r);
            const overdue = isOverdue(r);
            const rowColor = status === "offen" ? "#FDEBEC" : "#EAF6EE";
            const textColor = status === "offen" ? "#8A1620" : "#155C2C";
            return (
              <div
                key={r.id}
                style={{
                  ...styles.row,
                  background: rowColor,
                  ...(overdue ? styles.rowOverdue : {}),
                }}
              >
                <div style={styles.rowMain}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      Nr. <span className="mono">{r.number}</span> · {r.customer?.name}
                    </div>
                    <div style={styles.muted}>
                      {formatDateDE(r.date)}
                      {r.vatEnabled ? " · inkl. MWST" : ""}
                    </div>
                    {overdue && (
                      <div style={styles.overdueTag}>
                        <AlertTriangle size={11} />
                        Überfällig seit {daysOverdue(r)} Tag{daysOverdue(r) === 1 ? "" : "en"}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontWeight: 700 }}>CHF {chf(r.total)}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: textColor }}>
                      {statusLabel(status)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {status === "offen" && (
                    <button onClick={() => onTogglePaid(r.id, true)} style={styles.markPaidBtn}>
                      <Check size={13} /> Als bezahlt markieren
                    </button>
                  )}
                  {status === "bezahlt" && (
                    <button onClick={() => onTogglePaid(r.id, false)} style={styles.markUnpaidBtn}>
                      Als offen markieren
                    </button>
                  )}
                  {overdue && (
                    <button
                      onClick={() => createMahnung(r)}
                      style={styles.mahnungBtn}
                      disabled={mahnungId === r.id}
                    >
                      {mahnungId === r.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Bell size={13} />
                      )}
                      {mahnungId === r.id ? "Erstelle Mahnung…" : "Mahnung erstellen"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div style={styles.totalsBox}>
          <div style={styles.totalRow}>
            <span>davon offen</span>
            <span className="mono" style={{ color: "#B00020" }}>CHF {chf(totalOpen)}</span>
          </div>
          <div style={styles.totalRow}>
            <span>davon bezahlt</span>
            <span className="mono" style={{ color: "#1D7A3C" }}>CHF {chf(totalPaid)}</span>
          </div>
          <div style={{ ...styles.totalRow, ...styles.grandTotalRow }}>
            <span>Total {periodLabel()}</span>
            <span className="mono">CHF {chf(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "#E30613",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  h1: { fontSize: 22, fontWeight: 700, margin: "0 0 20px 0" },
  filterRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  select: { padding: "8px 10px", border: "1px solid #DADDE1", fontSize: 13, background: "#fff" },
  exportBtn: {
    marginLeft: "auto",
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
  legend: { display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "#5B5F66", flexWrap: "wrap" },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  overdueBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#FDF3EC",
    border: "1px solid #F3D9C4",
    color: "#8A4B12",
    fontSize: 12,
    fontWeight: 600,
    padding: "10px 12px",
    marginBottom: 16,
  },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "20px 0" },
  table: { display: "flex", flexDirection: "column", gap: 8 },
  row: { padding: "10px 14px", borderRadius: 2 },
  rowOverdue: { boxShadow: "inset 3px 0 0 #B5480C" },
  rowMain: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  muted: { fontSize: 12, color: "#70747C" },
  overdueTag: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    fontSize: 11,
    fontWeight: 700,
    color: "#B5480C",
  },
  markPaidBtn: {
    marginTop: 8,
    background: "#fff",
    border: "1px solid #1D7A3C",
    color: "#1D7A3C",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  markUnpaidBtn: {
    marginTop: 8,
    background: "transparent",
    border: "1px solid #DADDE1",
    color: "#5B5F66",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    cursor: "pointer",
  },
  mahnungBtn: {
    marginTop: 8,
    background: "#B5480C",
    border: "1px solid #B5480C",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  totalsBox: {
    marginTop: 20,
    maxWidth: 320,
    marginLeft: "auto",
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    padding: "4px 0",
  },
  grandTotalRow: {
    borderTop: "2px solid #16181D",
    marginTop: 6,
    paddingTop: 8,
    fontWeight: 700,
    fontSize: 15,
  },
};
