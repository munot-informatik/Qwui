import React, { useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import QRCode from "qrcode";
import { buildSwissQrPayload, buildCreditorReference, formatIbanDisplay, formatReferenceDisplay } from "./qrbill.js";

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Kleines Schweizerkreuz für die Mitte des QR-Codes (Pflichtbestandteil des
// "Swiss QR Code" gemäss Spezifikation).
function SwissCross() {
  return (
    <div style={styles.crossWrap}>
      <svg viewBox="0 0 19 19" width="100%" height="100%">
        <rect x="0" y="0" width="19" height="19" fill="#000" />
        <rect x="8" y="4" width="3" height="11" fill="#fff" />
        <rect x="4" y="8" width="11" height="3" fill="#fff" />
      </svg>
    </div>
  );
}

export default function QrBillDocument({ receipt }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const company = receipt.company || {};
  const qr = company.qrBill || {};

  const creditor = {
    name: qr.name || company.name,
    street: qr.street,
    houseNumber: qr.houseNumber,
    postalCode: qr.postalCode,
    city: qr.city,
    country: qr.country || "CH",
  };

  const customer = receipt.customer || {};
  const debtor =
    customer.name && customer.postalCode && customer.city
      ? {
          name: customer.name,
          street: customer.street,
          houseNumber: customer.houseNumber,
          postalCode: customer.postalCode,
          city: customer.city,
          country: customer.country || "CH",
        }
      : null;

  const debtorAddressLines = [
    `${debtor?.street || ""} ${debtor?.houseNumber || ""}`.trim(),
    `${debtor?.postalCode || ""} ${debtor?.city || ""}`.trim(),
  ].filter(Boolean);

  const creditorReference = buildCreditorReference(receipt.number);
  const creditorReferenceDisplay = formatReferenceDisplay(creditorReference);

  useEffect(() => {
    let cancelled = false;
    const payload = buildSwissQrPayload({
      iban: qr.iban,
      creditor,
      amount: receipt.total,
      currency: "CHF",
      debtor,
      referenceText: receipt.number,
      // Diese Komponente wird nur angezeigt, wenn qrBillEnabled true ist (siehe
      // App.jsx) — dann ist die Quittung noch unbezahlt und fungiert als
      // Rechnung, siehe auch "Zusätzliche Informationen" weiter unten.
      message: `Rechnung Nr. ${receipt.number}`,
    });

    QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 480,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((err) => console.error("QR-Code-Generierung fehlgeschlagen", err));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr.iban, receipt.total, receipt.number]);

  const creditorAddressLines = [
    creditor.name,
    `${creditor.street || ""} ${creditor.houseNumber || ""}`.trim(),
    `${creditor.postalCode || ""} ${creditor.city || ""}`.trim(),
  ].filter(Boolean);

  return (
    <div className="print-area qr-bill-page" style={styles.slip}>
      {/* Scheren-Symbol oben: markiert den horizontalen Schnitt zwischen
          Rechnung/Dokument und dem Einzahlungsschein darunter. */}
      <div style={styles.topScissors}>
        <Scissors size={14} color="#000" strokeWidth={1.5} />
      </div>

      {/* Empfangsschein */}
      <div style={styles.receipt}>
        <div style={styles.topZone}>
          <div style={styles.title}>Empfangsschein</div>

          <div style={styles.fieldBlock}>
            <div style={styles.label}>Konto / Zahlbar an</div>
            <div style={styles.value}>{formatIbanDisplay(qr.iban)}</div>
            {creditorAddressLines.map((l, i) => (
              <div style={styles.value} key={i}>{l}</div>
            ))}
          </div>

          <div style={styles.fieldBlock}>
            <div style={styles.label}>Referenz</div>
            <div className="mono" style={styles.value}>{creditorReferenceDisplay}</div>
          </div>

          <div style={styles.fieldBlock}>
            {/* Wie im QR-Code: Schuldner nur mit Name, PLZ und Ort, sonst ein leeres Feld zum Ausfüllen. */}
            <div style={styles.label}>{debtor ? "Zahlbar durch" : "Zahlbar durch (Name/Adresse)"}</div>
            {debtor ? (
              <>
                <div style={styles.value}>{debtor.name}</div>
                {debtorAddressLines.map((l, i) => (
                  <div style={styles.value} key={i}>{l}</div>
                ))}
              </>
            ) : (
              <CornerBox width="52mm" height="20mm" />
            )}
          </div>
        </div>

        <div style={styles.amountRowFlow}>
          <div>
            <div style={styles.label}>Währung</div>
            <div style={styles.value}>CHF</div>
          </div>
          <div>
            <div style={styles.label}>Betrag</div>
            <div style={styles.value}>{chf(receipt.total)}</div>
          </div>
        </div>

        <div style={styles.receiptFooter}>
          <div style={styles.label}>Annahmestelle</div>
        </div>

        <div style={styles.verticalScissors}>
          <Scissors size={14} color="#000" strokeWidth={1.5} />
        </div>
      </div>

      {/* Zahlteil */}
      <div style={styles.paymentPart}>
        <div style={styles.paymentLeft}>
          <div>
            <div style={styles.title}>Zahlteil</div>
            <div style={styles.qrWrap}>
              {qrDataUrl ? (
                <div style={{ position: "relative", width: "46mm", height: "46mm" }}>
                  <img src={qrDataUrl} alt="Swiss QR Code" style={{ width: "100%", height: "100%" }} />
                  <SwissCross />
                </div>
              ) : (
                <div style={{ width: "46mm", height: "46mm", background: "#F1F1EF" }} />
              )}
            </div>
          </div>
          <div style={styles.amountRowFlow}>
            <div>
              <div style={styles.label}>Währung</div>
              <div style={styles.value}>CHF</div>
            </div>
            <div>
              <div style={styles.label}>Betrag</div>
              <div style={styles.value}>{chf(receipt.total)}</div>
            </div>
          </div>
        </div>

        <div style={styles.paymentRight}>
          <div style={styles.fieldBlock}>
            <div style={styles.label}>Konto / Zahlbar an</div>
            <div style={styles.value}>{formatIbanDisplay(qr.iban)}</div>
            {creditorAddressLines.map((l, i) => (
              <div style={styles.value} key={i}>{l}</div>
            ))}
          </div>

          <div style={styles.fieldBlock}>
            <div style={styles.label}>Referenz</div>
            <div className="mono" style={styles.value}>{creditorReferenceDisplay}</div>
          </div>

          <div style={styles.fieldBlock}>
            <div style={styles.label}>Zusätzliche Informationen</div>
            <div style={styles.value}>Rechnung Nr. {receipt.number}</div>
          </div>

          <div style={styles.fieldBlock}>
            {/* Wie im QR-Code: Schuldner nur mit Name, PLZ und Ort, sonst ein leeres Feld zum Ausfüllen. */}
            <div style={styles.label}>{debtor ? "Zahlbar durch" : "Zahlbar durch (Name/Adresse)"}</div>
            {debtor ? (
              <>
                <div style={styles.value}>{debtor.name}</div>
                {debtorAddressLines.map((l, i) => (
                  <div style={styles.value} key={i}>{l}</div>
                ))}
              </>
            ) : (
              <CornerBox width="65mm" height="25mm" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Leeres Feld mit Eckmarken, wie es die Vorgaben für den Zahlteil verlangen.
function CornerBox({ width, height }) {
  const mark = { position: "absolute", width: "3mm", height: "3mm", borderColor: "#000", borderStyle: "solid", borderWidth: 0 };
  return (
    <div style={{ position: "relative", width, height, marginTop: 2 }} aria-label="Feld für Name und Adresse">
      <span style={{ ...mark, left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 }} />
      <span style={{ ...mark, right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 }} />
      <span style={{ ...mark, left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 }} />
      <span style={{ ...mark, right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 }} />
    </div>
  );
}

const styles = {
  slip: {
    width: "210mm",
    height: "105mm",
    background: "#fff",
    display: "flex",
    fontFamily: "Helvetica, Arial, sans-serif",
    color: "#000",
    boxSizing: "border-box",
    border: "1px solid #000",
    borderLeft: "none",
    borderBottom: "none",
    borderRight: "none",
    margin: "10mm auto 0",
    position: "relative",
  },
  topScissors: {
    position: "absolute",
    top: "-4mm",
    left: "62mm",
    transform: "translateX(-50%) rotate(90deg)",
    background: "#fff",
    lineHeight: 0,
  },
  verticalScissors: {
    position: "absolute",
    bottom: "-4mm",
    left: "62mm",
    transform: "translate(-50%, 0)",
    background: "#fff",
    lineHeight: 0,
  },
  receipt: {
    width: "62mm",
    height: "105mm",
    boxSizing: "border-box",
    padding: "5mm",
    borderRight: "1px dashed #000",
    position: "relative",
  },
  paymentPart: {
    width: "148mm",
    height: "105mm",
    boxSizing: "border-box",
    display: "flex",
    gap: "5mm",
    position: "relative",
  },
  paymentLeft: {
    width: "51mm",
    height: "105mm",
    boxSizing: "border-box",
    padding: "5mm",
    position: "relative",
  },
  paymentRight: {
    width: "87mm",
    height: "105mm",
    boxSizing: "border-box",
    padding: "5mm",
    paddingTop: "13mm",
    display: "flex",
    flexDirection: "column",
  },
  title: {
    fontSize: "11pt",
    fontWeight: 700,
    marginBottom: "3mm",
  },
  // Gemeinsame, fest definierte Zone (Titel + Inhalt) — auf beiden Seiten
  // exakt gleich hoch, damit der Betrag danach garantiert auf derselben
  // Höhe landet, unabhängig von Schriftart-Rendering-Unterschieden.
  topZone: {
    height: "64mm",
    overflow: "hidden",
  },
  fieldBlock: {
    marginBottom: "4mm",
  },
  label: {
    fontSize: "6pt",
    fontWeight: 700,
    marginBottom: "0.5mm",
  },
  value: {
    fontSize: "8pt",
    lineHeight: 1.35,
  },
  amountRowFlow: {
    display: "flex",
    gap: "6mm",
  },
  receiptFooter: {
    position: "absolute",
    bottom: "5mm",
    right: "5mm",
    textAlign: "right",
  },
  qrWrap: {
    margin: "2mm 0 4mm",
  },
  crossWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "7mm",
    height: "7mm",
    background: "#fff",
    border: "0.5mm solid #fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
