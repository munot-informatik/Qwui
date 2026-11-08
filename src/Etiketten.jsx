// Etiketten mit Strichcode für Seriennummern. Für Stücke, auf denen die Nummer
// nur als Text steht: einmal Etikett drucken und aufkleben, danach lässt sich
// das Stück im Wareneingang, beim Verkauf und in der Garantie-Suche scannen.
//
// Gedruckt wird wie bei den Quittungen über window.print(). Während des Drucks
// trägt <body> die Klasse qwui-print-labels: dann ist nur der Etikettenbogen
// sichtbar, und ein eigenes @page-Format gilt (Etikettenrolle oder A4-Bogen).

import React, { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { canEncode, code128Bars, fitsWidth } from "../shared/code128.js";

export const LABEL_FORMATS = [
  { id: "roll62x29", label: "Etikettendrucker 62 × 29 mm", kind: "roll", width: 62, height: 29 },
  { id: "roll57x32", label: "Etikettendrucker 57 × 32 mm", kind: "roll", width: 57, height: 32 },
  { id: "a4_3x8", label: "A4-Bogen 3 × 8 (70 × 37 mm)", kind: "sheet", width: 70, height: 37.125, columns: 3, rows: 8 },
];

const FORMAT_KEY = "qwui.labelFormat";

function loadFormatId() {
  try {
    const id = window.localStorage.getItem(FORMAT_KEY);
    if (LABEL_FORMATS.some((f) => f.id === id)) return id;
  } catch {
    // Speicher gesperrt (z. B. privates Fenster): Standard nehmen.
  }
  return LABEL_FORMATS[0].id;
}

function saveFormatId(id) {
  try {
    window.localStorage.setItem(FORMAT_KEY, id);
  } catch {
    // nicht schlimm, nächstes Mal wieder der Standard
  }
}

// Strichcode als SVG. Breite in Millimetern: so breit wie möglich, aber ein
// Modul höchstens 0,4 mm — breitere Striche bringen keinen Vorteil.
export function Barcode({ value, maxWidthMm, heightMm }) {
  if (!canEncode(value)) {
    return <div style={l.noCode}>Kein Strichcode möglich (Sonderzeichen)</div>;
  }
  if (!fitsWidth(value, maxWidthMm)) {
    return <div style={l.noCode}>Nummer zu lang für einen lesbaren Strichcode in diesem Format</div>;
  }
  const { bars, totalWidth } = code128Bars(value);
  const widthMm = Math.min(maxWidthMm, totalWidth * 0.4);
  return (
    <svg
      viewBox={`0 0 ${totalWidth} 10`}
      preserveAspectRatio="none"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, display: "block", margin: "0 auto" }}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Strichcode ${value}`}
    >
      <rect x="0" y="0" width={totalWidth} height="10" fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.width} height="10" fill="#000" />
      ))}
    </svg>
  );
}

function Label({ item, format }) {
  const pad = 2;
  return (
    <div className="qwui-label" style={{ ...l.label, width: `${format.width}mm`, height: `${format.height}mm`, padding: `${pad}mm ${pad + 1}mm` }}>
      <div style={l.name}>{item.productName || ""}</div>
      <Barcode value={item.serial} maxWidthMm={format.width - 2 * (pad + 1)} heightMm={format.height * 0.45} />
      <div className="mono" style={l.serial}>{item.serial}</div>
    </div>
  );
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Der Bogen selbst: auf dem Bildschirm unsichtbar, nur beim Etikettendruck da.
export function LabelSheet({ job }) {
  if (!job) return null;
  const format = LABEL_FORMATS.find((f) => f.id === job.formatId) || LABEL_FORMATS[0];
  return (
    <div className="label-sheet" data-format={format.id}>
      {format.kind === "sheet" ? (
        // Je Bogen ein eigener Block mit fester Höhe: Der Seitenumbruch hängt so
        // nicht davon ab, wie der Browser ein Raster auf Seiten verteilt.
        chunk(job.labels, format.columns * format.rows).map((page, p, pages) => (
          <div
            key={p}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${format.columns}, ${format.width}mm)`,
              gridAutoRows: `${format.height}mm`,
              height: "296mm",
              overflow: "hidden",
              breakAfter: p < pages.length - 1 ? "page" : "auto",
            }}
          >
            {page.map((item, i) => (
              <Label key={i} item={item} format={format} />
            ))}
          </div>
        ))
      ) : (
        job.labels.map((item, i) => (
          <div key={i} style={i < job.labels.length - 1 ? { breakAfter: "page" } : undefined}>
            <Label item={item} format={format} />
          </div>
        ))
      )}
    </div>
  );
}

// Druckauftrag: labels = [{ serial, productName }]. Liefert [job, print].
export function useLabelPrinter() {
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!job) return undefined;
    const format = LABEL_FORMATS.find((f) => f.id === job.formatId) || LABEL_FORMATS[0];
    const page = document.createElement("style");
    page.textContent =
      format.kind === "sheet"
        ? "@page { size: A4; margin: 0; }"
        : `@page { size: ${format.width}mm ${format.height}mm; margin: 0; }`;
    // Ans Ende von <body>, damit diese Regel nach dem A4-Format der Quittungen kommt.
    document.body.appendChild(page);
    document.body.classList.add("qwui-print-labels");
    const previousTitle = document.title;
    document.title = job.labels.length === 1 ? `Etikett ${job.labels[0].serial}` : `Etiketten (${job.labels.length})`;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", finish);
      page.remove();
      document.body.classList.remove("qwui-print-labels");
      document.title = previousTitle;
    };
    function finish() {
      cleanup();
      setJob(null);
    }
    window.addEventListener("afterprint", finish);
    // Erst drucken, wenn der Bogen gezeichnet ist. window.print() kehrt erst
    // nach dem Druckdialog zurück; danach aufräumen, auch wenn «afterprint»
    // ausbleibt — sonst druckte die nächste Quittung nur Etiketten.
    const timer = setTimeout(() => {
      window.print();
      finish();
    }, 50);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [job]);

  function print(labels, formatId) {
    const list = (labels || []).filter((x) => x && String(x.serial || "").trim());
    if (list.length === 0) return;
    setJob({ labels: list, formatId: formatId || loadFormatId() });
  }

  return [job, print];
}

// Knopf mit Formatwahl. labels: Liste oder Funktion, die sie beim Klick liefert.
export function LabelPrintButton({ labels, onPrint, text = "Etiketten drucken", style }) {
  const [formatId, setFormatId] = useState(loadFormatId);
  const count = Array.isArray(labels) ? labels.length : null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", ...style }}>
      <button
        type="button"
        style={l.btn}
        disabled={count === 0}
        onClick={() => onPrint(typeof labels === "function" ? labels() : labels, formatId)}
      >
        <Printer size={14} /> {text}
        {count > 1 ? ` (${count})` : ""}
      </button>
      <select
        value={formatId}
        onChange={(e) => {
          setFormatId(e.target.value);
          saveFormatId(e.target.value);
        }}
        style={l.select}
        aria-label="Etikettenformat"
      >
        {LABEL_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export const LABEL_PRINT_CSS = `
  .label-sheet { display: none; }
  @media print {
    body.qwui-print-labels .receipt-app > :not(.label-sheet) { display: none !important; }
    body.qwui-print-labels .label-sheet { display: block !important; }
    html:has(body.qwui-print-labels), body.qwui-print-labels, body.qwui-print-labels .receipt-app {
      margin: 0 !important;
      padding: 0 !important;
      min-height: 0 !important;
      background: #fff !important;
    }
  }
`;

const l = {
  label: {
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "1mm",
    background: "#fff",
    color: "#000",
    breakInside: "avoid",
  },
  name: { fontSize: "7pt", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" },
  serial: { fontSize: "9pt", fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" },
  noCode: { fontSize: "7pt", textAlign: "center", border: "1px dashed #000", padding: "2mm" },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    borderRadius: 6,
    padding: "7px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  select: { border: "1px solid #DADDE1", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "#fff" },
};
