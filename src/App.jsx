import React, { useState, useEffect } from "react";
import logoImg from "./assets/logo.png";
import QrBillDocument from "./QrBillDocument.jsx";
import BuchhaltungTab from "./BuchhaltungTab.jsx";
import { buildReceiptPdfBytes } from "./receiptPdf.js";
import { isValidSwissIban } from "./qrbill.js";
import {
  Plus,
  Trash2,
  Printer,
  Mail,
  Building2,
  Users,
  FileText,
  History,
  ArrowLeft,
  Check,
  Loader2,
  MessageCircle,
  Wallet,
  Share2,
  Upload,
  Github,
  Copyright,
  RefreshCw,
  Download,
  AlertTriangle,
} from "lucide-react";

// Aktuelle Version des Backup-Dateiformats (siehe exportAllData/handleImportFileSelect).
// Rein informativ beim Import — kein harter Kompatibilitäts-Check, damit auch
// künftige, abwärtskompatible Versionen weiterhin importiert werden können.
const BACKUP_SCHEMA_VERSION = 1;

const KEYS = {
  company: "company-info",
  customers: "customers-list",
  receipts: "receipts-list",
};

const emptyCompany = {
  name: "",
  address: "",
  zipCity: "",
  email: "",
  phone: "",
  vatNumber: "",
  logoDataUrl: "",
  qrBill: { name: "", iban: "", street: "", houseNumber: "", postalCode: "", city: "", country: "CH" },
};
const emptyPerson = {
  name: "",
  address: "", // alte Freitext-Adresse, bleibt für bestehende Kunden erhalten
  street: "",
  houseNumber: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
};

// Liefert Adresszeilen für die Anzeige: bevorzugt die neuen strukturierten
// Felder, fällt sonst auf die alte Freitext-Adresse zurück (für Kunden, die
// vor dieser Änderung angelegt wurden).
function personAddressLines(person) {
  if (!person) return [];
  const line1 = `${person.street || ""} ${person.houseNumber || ""}`.trim();
  const line2 = `${person.postalCode || ""} ${person.city || ""}`.trim();
  const structured = [line1, line2].filter(Boolean);
  if (structured.length) return structured;
  return person.address ? [person.address] : [];
}

function personHasAddress(person) {
  return !!(person && ((person.postalCode && person.city) || person.address));
}

function sanitizePhone(phone) {
  return (phone || "").replace(/[^\d]/g, "");
}

// Verkleinert ein hochgeladenes Bild auf maxDim (längste Seite) und liefert es
// als PNG-data-URL zurück — hält die in D1 gespeicherte Firmendaten-Grösse
// klein und vermeidet unnötig grosse PDFs, ohne Transparenz zu verlieren.
function resizeImageFile(file, maxDim = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function chf(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Nächste freie Quittungsnummer: höchste bisher vergebene Nummer + 1, statt
// receipts.length + 1 — sonst würden nach dem Löschen einer Quittung
// Nummern doppelt vergeben (z.B. Löschen von Nr. 0003 bei 5 Quittungen würde
// die nächste neue Quittung wieder auf 0004 setzen, obwohl das schon vergeben ist).
function nextReceiptNumber(receipts) {
  const maxNumber = receipts.reduce((max, r) => {
    const n = parseInt(r.number, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return String(maxNumber + 1).padStart(4, "0");
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Mit aktivierter QR-Rechnung ist der Betrag noch nicht bezahlt und das
// Dokument fungiert als Rechnung statt als Quittung für bereits erhaltenes Geld.
function documentWord(receipt) {
  return receipt.qrBillEnabled ? "Rechnung" : "Quittung";
}

export default function ReceiptApp() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("new");
  const [mode, setMode] = useState("form"); // 'form' | 'preview'
  const [saveStatus, setSaveStatus] = useState("");
  // Sichtbarer Speicher-/Ladefehler (z.B. Excel-Datei in der Desktop-Version
  // gerade in echtem Excel geöffnet) — bei D1 kam das kaum vor, war deshalb
  // bisher nur ein stiller console.error.
  const [persistError, setPersistError] = useState("");

  const [company, setCompany] = useState(emptyCompany);
  const [companyDraft, setCompanyDraft] = useState(emptyCompany);
  const [customers, setCustomers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [currentReceipt, setCurrentReceipt] = useState(null);
  const [editingReceiptId, setEditingReceiptId] = useState(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [manualCustomer, setManualCustomer] = useState(emptyPerson);
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([{ id: uid(), description: "", amount: "" }]);
  const [note, setNote] = useState("");
  const [vatEnabled, setVatEnabled] = useState(false);
  const [qrBillEnabled, setQrBillEnabled] = useState(false);

  const [newCustomer, setNewCustomer] = useState(emptyPerson);

  useEffect(() => {
    (async () => {
      let loadFailed = false;
      try {
        const c = await window.storage.get(KEYS.company);
        if (c && c.value) {
          const parsed = JSON.parse(c.value);
          setCompany(parsed);
          setCompanyDraft(parsed);
        }
      } catch (e) {
        console.error("Laden der Firmendaten fehlgeschlagen", e);
        loadFailed = true;
      }
      try {
        const cu = await window.storage.get(KEYS.customers);
        if (cu && cu.value) setCustomers(JSON.parse(cu.value));
      } catch (e) {
        console.error("Laden der Kunden fehlgeschlagen", e);
        loadFailed = true;
      }
      try {
        const r = await window.storage.get(KEYS.receipts);
        if (r && r.value) setReceipts(JSON.parse(r.value));
      } catch (e) {
        console.error("Laden der Quittungen fehlgeschlagen", e);
        loadFailed = true;
      }
      if (loadFailed) {
        setPersistError(
          "Laden fehlgeschlagen — möglicherweise ist die Datenquelle gerade nicht erreichbar (z.B. Excel-Datei in Excel geöffnet)."
        );
      }
      setLoaded(true);
    })();
  }, []);

  // Liefert true/false zurück, statt Fehler nur zu schlucken — Aufrufer, die
  // dem Benutzer Erfolg melden (z.B. der Backup-Import), müssen wissen, ob
  // tatsächlich gespeichert wurde. Wirft bewusst nicht: die vielen
  // Feuer-und-Vergiss-Aufrufer (Kunde speichern, bezahlt-Häkchen) zeigen den
  // Fehler weiterhin nur über das persistError-Banner an.
  async function persist(key, value, setter) {
    setter(value);
    try {
      await window.storage.set(key, JSON.stringify(value), false);
      setPersistError("");
      return true;
    } catch (e) {
      console.error("Speichern fehlgeschlagen", e);
      setPersistError(`Speichern fehlgeschlagen: ${e.message || "unbekannter Fehler"}`);
      return false;
    }
  }

  async function saveCompany() {
    // Nur melden, was auch passiert ist: bisher stand "Firmendaten gespeichert"
    // selbst dann da, wenn der Schreibzugriff fehlschlug (gleichzeitig mit dem
    // roten Fehlerbanner darüber — zwei widersprüchliche Meldungen).
    const ok = await persist(KEYS.company, companyDraft, setCompany);
    if (!ok) return;
    setSaveStatus("Firmendaten gespeichert");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Auswählen derselben Datei
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("Bitte eine Bilddatei auswählen.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setLogoError("Bild ist zu gross (max. 8 MB).");
      return;
    }
    setLogoError("");
    setLogoUploading(true);
    try {
      const dataUrl = await resizeImageFile(file, 300);
      setCompanyDraft({ ...companyDraft, logoDataUrl: dataUrl });
    } catch (err) {
      console.error("Logo-Verarbeitung fehlgeschlagen", err);
      setLogoError("Logo konnte nicht verarbeitet werden.");
    } finally {
      setLogoUploading(false);
    }
  }

  function removeLogo() {
    setCompanyDraft({ ...companyDraft, logoDataUrl: "" });
    setLogoError("");
  }

  // ---- Backup: kompletter Datenexport/-import (Firma + Kunden + Quittungen) ----
  // Funktioniert identisch in Web-App und Desktop-Version, da beide dieselbe
  // window.storage-Schnittstelle nutzen — hier wird nur mit dem bereits
  // geladenen React-State gearbeitet, unabhängig vom Speicherort. Damit lässt
  // sich der aktuelle Stand der einen Version exportieren und in der anderen
  // (oder als reines Backup) wieder importieren.
  const [importPreview, setImportPreview] = useState(null); // geparste Datei, wartet auf Bestätigung
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  function exportAllData() {
    const payload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      company,
      customers,
      receipts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Qwui-Backup_${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function handleImportFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Auswählen derselben Datei
    if (!file) return;
    setImportError("");
    setImportPreview(null);
    const reader = new FileReader();
    reader.onerror = () => setImportError("Datei konnte nicht gelesen werden.");
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        setImportError("Datei ist kein gültiges JSON.");
        return;
      }
      const looksValid =
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.company === "object" &&
        Array.isArray(parsed.customers) &&
        Array.isArray(parsed.receipts);
      if (!looksValid) {
        setImportError("Datei hat kein gültiges Qwui-Backup-Format.");
        return;
      }
      setImportPreview(parsed);
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const importedCompany = importPreview.company || emptyCompany;
      const okCompany = await persist(KEYS.company, importedCompany, setCompany);
      setCompanyDraft(importedCompany);
      const okCustomers = await persist(KEYS.customers, importPreview.customers || [], setCustomers);
      const okReceipts = await persist(KEYS.receipts, importPreview.receipts || [], setReceipts);

      // Erfolg nur melden, wenn wirklich alles geschrieben wurde. Sonst bleibt
      // die Bestätigung stehen, damit der Import wiederholt werden kann — der
      // React-State zeigt sonst die importierten Daten an, während in der
      // Datenbank noch die alten stehen und beim nächsten Laden zurückkommen.
      if (okCompany && okCustomers && okReceipts) {
        setImportPreview(null);
        setSaveStatus("Backup importiert");
        setTimeout(() => setSaveStatus(""), 3000);
      } else {
        setImportError(
          "Import fehlgeschlagen — die Daten konnten nicht gespeichert werden. " +
            "Angezeigt werden vorerst die importierten Daten, gespeichert ist aber " +
            "noch der alte Stand. Bitte erneut versuchen."
        );
      }
    } finally {
      setImporting(false);
    }
  }

  function cancelImport() {
    setImportPreview(null);
    setImportError("");
  }

  async function addCustomer() {
    if (!newCustomer.name.trim()) return;
    const next = [...customers, { ...newCustomer, id: uid() }];
    await persist(KEYS.customers, next, setCustomers);
    setNewCustomer(emptyPerson);
  }

  async function saveManualCustomerToList() {
    if (!manualCustomer.name.trim()) return;
    const newEntry = { ...manualCustomer, id: uid() };
    const next = [...customers, newEntry];
    await persist(KEYS.customers, next, setCustomers);
    setSelectedCustomerId(newEntry.id);
    setManualCustomer(emptyPerson);
  }

  async function deleteCustomer(id) {
    const next = customers.filter((c) => c.id !== id);
    await persist(KEYS.customers, next, setCustomers);
    if (selectedCustomerId === id) setSelectedCustomerId("");
  }

  function updateItem(id, field, value) {
    setItems(items.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function addItem() {
    setItems([...items, { id: uid(), description: "", amount: "" }]);
  }

  function removeItem(id) {
    if (items.length === 1) return;
    setItems(items.filter((it) => it.id !== id));
  }

  const VAT_RATE = 0.081; // Normalsatz Schweiz für Dienstleistungen, Stand 2026

  const enteredSum = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  const total = round2(enteredSum);
  const netTotal = vatEnabled ? round2(total / (1 + VAT_RATE)) : total;
  const vatAmount = vatEnabled ? round2(total - netTotal) : 0;

  function resetForm() {
    setSelectedCustomerId("");
    setManualCustomer(emptyPerson);
    setDate(todayISO());
    setItems([{ id: uid(), description: "", amount: "" }]);
    setNote("");
    setVatEnabled(false);
    setQrBillEnabled(false);
  }

  function getActiveCustomer() {
    if (selectedCustomerId) {
      const c = customers.find((c) => c.id === selectedCustomerId);
      if (c) return c;
    }
    return manualCustomer;
  }

  const activeCustomer = getActiveCustomer();
  const validItems = items.filter((it) => it.description.trim() && Number(it.amount) > 0);
  const canCreate = activeCustomer.name.trim() && validItems.length > 0;
  const needsAddress = total >= 400;

  async function createReceipt() {
    if (!canCreate) return;

    if (editingReceiptId) {
      const existing = receipts.find((r) => r.id === editingReceiptId);
      const isQrBill = qrBillEnabled && isValidSwissIban(company.qrBill?.iban);
      // War die Quittung vorher schon eine QR-Rechnung, bleibt ihr Bezahlt-Status
      // erhalten. Wird sie beim Bearbeiten NEU zur QR-Rechnung (vorher
      // Direktzahlung, deren "paid" immer true ist), muss sie als offen starten
      // — sonst würde eine frisch in eine Rechnung umgewandelte Quittung den
      // alten "bezahlt"-Wert der Direktzahlung übernehmen und fälschlich schon
      // als bezahlt gelten, obwohl noch niemand die Rechnung beglichen hat.
      const wasQrBill = !!existing.qrBillEnabled;
      const paid = isQrBill ? (wasQrBill ? !!existing.paid : false) : true;
      // Die Quittung trägt einen eigenen Firmen-Snapshot, damit alte Belege
      // nicht rückwirkend mutieren, wenn sich die Firmendaten ändern. Wird
      // beim Bearbeiten aber NEU eine QR-Rechnung daraus, muss der Snapshot
      // die aktuellen Zahlungsdaten enthalten: sonst prüft isQrBill die IBAN
      // der *heutigen* Firmendaten, der Einzahlungsschein wird danach aber aus
      // dem *alten* Snapshot gebaut — mit leerer IBAN und damit unbezahlbar.
      const snapshotIbanUsable = isValidSwissIban(existing.company?.qrBill?.iban);
      const companySnapshot = isQrBill && !snapshotIbanUsable ? company : existing.company;
      const updated = {
        ...existing,
        company: companySnapshot,
        date,
        customer: { ...activeCustomer },
        items: validItems,
        netTotal,
        vatEnabled,
        vatRate: VAT_RATE,
        vatAmount,
        total,
        qrBillEnabled: isQrBill,
        paid,
        note,
        editedAt: new Date().toISOString(),
      };
      const next = receipts.map((r) => (r.id === editingReceiptId ? updated : r));
      await persist(KEYS.receipts, next, setReceipts);
      setCurrentReceipt(updated);
      setEditingReceiptId(null);
      setMode("preview");
      return;
    }

    const number = nextReceiptNumber(receipts);
    const isQrBill = qrBillEnabled && isValidSwissIban(company.qrBill?.iban);
    const receipt = {
      id: uid(),
      number,
      date,
      customer: { ...activeCustomer },
      items: validItems,
      netTotal,
      vatEnabled,
      vatRate: VAT_RATE,
      vatAmount,
      total,
      qrBillEnabled: isQrBill,
      paid: !isQrBill,
      note,
      company,
      createdAt: new Date().toISOString(),
    };
    const next = [...receipts, receipt];
    await persist(KEYS.receipts, next, setReceipts);
    setCurrentReceipt(receipt);
    setMode("preview");
  }

  function startEditReceipt(r) {
    const matchingCustomer = customers.find(
      (c) => c.name === r.customer.name && c.email === r.customer.email
    );
    if (matchingCustomer) {
      setSelectedCustomerId(matchingCustomer.id);
      setManualCustomer(emptyPerson);
    } else {
      setSelectedCustomerId("");
      setManualCustomer({
        name: r.customer.name || "",
        address: r.customer.address || "",
        street: r.customer.street || "",
        houseNumber: r.customer.houseNumber || "",
        postalCode: r.customer.postalCode || "",
        city: r.customer.city || "",
        email: r.customer.email || "",
        phone: r.customer.phone || "",
      });
    }
    setDate(r.date);
    setItems(r.items.map((it) => ({ ...it, id: uid() })));
    setNote(r.note || "");
    setVatEnabled(!!r.vatEnabled);
    setQrBillEnabled(!!r.qrBillEnabled);
    setEditingReceiptId(r.id);
    setMode("form");
    setTab("new");
  }


  async function deleteReceipt(id) {
    const next = receipts.filter((r) => r.id !== id);
    await persist(KEYS.receipts, next, setReceipts);
    if (currentReceipt && currentReceipt.id === id) {
      backToForm();
    }
  }

  async function togglePaid(id, paidValue) {
    const next = receipts.map((r) => (r.id === id ? { ...r, paid: paidValue } : r));
    await persist(KEYS.receipts, next, setReceipts);
    if (currentReceipt && currentReceipt.id === id) {
      setCurrentReceipt({ ...currentReceipt, paid: paidValue });
    }
  }

  function cancelEdit() {
    setEditingReceiptId(null);
    resetForm();
  }

  function openReceipt(r) {
    setCurrentReceipt(r);
    setMode("preview");
  }

  function backToForm() {
    setMode("form");
    setCurrentReceipt(null);
    setEditingReceiptId(null);
    resetForm();
  }

  function sendMail() {
    if (!currentReceipt) return;
    const word = documentWord(currentReceipt);
    const to = currentReceipt.customer.email || "";
    const subject = encodeURIComponent(
      `${word} Nr. ${currentReceipt.number} – ${currentReceipt.company.name || ""}`
    );
    const bodyLines = [
      `Guten Tag ${currentReceipt.customer.name}`,
      "",
      `Anbei erhalten Sie die ${word} Nr. ${currentReceipt.number} vom ${formatDateDE(
        currentReceipt.date
      )} über CHF ${chf(currentReceipt.total)}.`,
      "",
      `Bitte fügen Sie die PDF-${word} dieser E-Mail als Anhang bei`,
      "(Button „Drucken / Als PDF speichern“ → als PDF sichern → hier anhängen).",
      "",
      "Freundliche Grüsse",
      currentReceipt.company.name || "",
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  function printReceipt() {
    const previousTitle = document.title;
    if (currentReceipt) {
      document.title = `${documentWord(currentReceipt)} ${currentReceipt.number} – ${currentReceipt.customer.name || ""}`.trim();
    }
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  }

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Web Share API (Level 2, Datei-Anhänge) nur nutzen, wenn der Browser sie
  // tatsächlich unterstützt (v.a. mobile Browser) — sonst bleibt es beim
  // bisherigen Weg über "PDF herunterladen" + manuell anhängen.
  const [canShareFiles, setCanShareFiles] = useState(false);
  useEffect(() => {
    try {
      const testFile = new File([""], "test.pdf", { type: "application/pdf" });
      setCanShareFiles(!!(navigator.canShare && navigator.canShare({ files: [testFile] })));
    } catch (e) {
      setCanShareFiles(false);
    }
  }, []);

  async function downloadPdf() {
    if (!currentReceipt) return;
    setGeneratingPdf(true);
    try {
      const pdfBytes = await buildReceiptPdfBytes(currentReceipt);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${documentWord(currentReceipt)}_${currentReceipt.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error(err);
      alert(`PDF-Erzeugung fehlgeschlagen: ${err.message}\n\nBitte nutze stattdessen 'Drucken'.`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  // Teilt die Quittung direkt als PDF-Anhang über den nativen Teilen-Dialog
  // des Geräts (WhatsApp, Mail, etc.) — löst den manuellen Umweg über
  // "herunterladen, dann in der anderen App anhängen".
  async function sharePdf() {
    if (!currentReceipt) return;
    setSharing(true);
    try {
      const word = documentWord(currentReceipt);
      const pdfBytes = await buildReceiptPdfBytes(currentReceipt);
      const file = new File([pdfBytes], `${word}_${currentReceipt.number}.pdf`, {
        type: "application/pdf",
      });
      await navigator.share({
        files: [file],
        title: `${word} Nr. ${currentReceipt.number}`,
        text: `${word} Nr. ${currentReceipt.number} – CHF ${chf(currentReceipt.total)}`,
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(err);
        alert(`Teilen fehlgeschlagen: ${err.message}\n\nBitte nutze stattdessen 'PDF herunterladen'.`);
      }
    } finally {
      setSharing(false);
    }
  }

  function buildWhatsAppText(receipt) {
    const word = documentWord(receipt);
    const lines = [
      `*${word} Nr. ${receipt.number}*`,
      receipt.company.name || "",
      "",
      `Datum: ${formatDateDE(receipt.date)}`,
      `Empfänger: ${receipt.customer.name}`,
      "",
      ...receipt.items.map((it) => `${it.description}: CHF ${chf(it.amount)}`),
      "",
    ];
    if (receipt.vatEnabled) {
      lines.push(
        `Netto: CHF ${chf(receipt.netTotal)}`,
        `MWST 8.1 %: CHF ${chf(receipt.vatAmount)}`,
        `*Total (inkl. MWST): CHF ${chf(receipt.total)}*`
      );
    } else {
      lines.push(`*Total: CHF ${chf(receipt.total)}*`);
    }
    if (receipt.note) lines.push("", `Notiz: ${receipt.note}`);
    lines.push(
      "",
      // Hier bewusst nicht "beiliegender Einzahlungsschein" wie im PDF —
      // die WhatsApp-Nachricht ist reiner Text ohne Anhang, das würde einen
      // nicht vorhandenen Anhang suggerieren.
      receipt.qrBillEnabled
        ? "Zahlbar per Rechnung innert 30 Tagen (Einzahlungsschein siehe PDF)."
        : "Betrag dankend erhalten."
    );
    if (receipt.company.name) lines.push(receipt.company.name);
    return lines.join("\n");
  }

  function sendWhatsApp() {
    if (!currentReceipt) return;
    const text = encodeURIComponent(buildWhatsAppText(currentReceipt));
    const phone = sanitizePhone(currentReceipt.customer.phone);
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!loaded) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 className="animate-spin" size={20} color="#70747C" />
      </div>
    );
  }

  return (
    <div className="receipt-app" style={styles.appWrap}>
      <style>{`
        /* Schriften liegen lokal unter public/fonts (siehe index.html). Vorher
           wurden sie per @import direkt von fonts.googleapis.com geladen — das
           schickt bei jedem Seitenaufruf IP und User-Agent jedes Nutzers an
           Google, was für ein passwortgeschütztes Werkzeug mit Schweizer
           Kundendaten (DSG/DSGVO) unnötig ist. Lokal ausgeliefert funktioniert
           die App ausserdem vollständig offline. */
        .receipt-app { font-family: 'IBM Plex Sans', sans-serif; color: #16181D; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .receipt-app input, .receipt-app textarea {
          font-family: 'IBM Plex Sans', sans-serif;
          border: 1px solid #DADDE1;
          padding: 8px 10px;
          font-size: 13px;
          outline: none;
          background: #fff;
          color: #16181D;
        }
        .receipt-app input:focus, .receipt-app textarea:focus { border-color: #E30613; }
        .navbtn { transition: background 0.12s ease; }
        .navbtn:hover { background: #F1F1EF; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-area { box-shadow: none !important; }
          .print-area:not(.qr-bill-page) { border: none !important; }
          .qr-bill-page { page-break-inside: avoid; break-inside: avoid; }
          .preview-wrap { padding: 0 !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      {persistError && (
        <div className="no-print" style={styles.persistErrorBanner}>
          {persistError}
        </div>
      )}

      {mode === "form" && (
        <div style={styles.shell}>
          <nav className="no-print" style={styles.sidebar}>
            <div style={styles.brand}>
              <img src={logoImg} alt="Qwui Logo" style={styles.brandMark} />
              <div>
                <div style={styles.brandTitle}>Qwui</div>
                <div style={styles.brandSub}>Quittungen Schweiz</div>
              </div>
            </div>
            <NavItem icon={FileText} label="Neue Quittung" active={tab === "new"} onClick={() => setTab("new")} />
            <NavItem icon={Users} label="Kunden" active={tab === "customers"} onClick={() => setTab("customers")} />
            <NavItem icon={Building2} label="Firma" active={tab === "company"} onClick={() => setTab("company")} />
            <NavItem icon={History} label="Verlauf" active={tab === "history"} onClick={() => setTab("history")} />
            <NavItem icon={Wallet} label="Buchhaltung" active={tab === "accounting"} onClick={() => setTab("accounting")} />
            <NavItem icon={RefreshCw} label="Backup" active={tab === "backup"} onClick={() => setTab("backup")} />

            <div style={styles.sidebarFooter}>
              <a
                href="https://github.com/mardoommo/Qwui"
                target="_blank"
                rel="noopener noreferrer"
                style={styles.footerLink}
              >
                <Github size={14} /> GitHub
              </a>
              <a
                href="https://munot-informatik.ch"
                target="_blank"
                rel="noopener noreferrer"
                style={styles.footerLink}
              >
                <Copyright size={14} /> Matthias Kubin
              </a>
            </div>
          </nav>

          <main style={{ ...styles.main, ...(tab === "accounting" ? { maxWidth: 880 } : {}) }}>
            {tab === "new" && (
              <div style={styles.panel}>
                <Eyebrow>01 — Neue Quittung</Eyebrow>
                <h1 style={styles.h1}>
                  {editingReceiptId ? "Quittung bearbeiten" : "Neue Quittung erstellen"}
                </h1>
                {editingReceiptId && (
                  <div style={styles.editBanner}>
                    <span>
                      Du bearbeitest Quittung Nr.{" "}
                      <span className="mono">
                        {receipts.find((r) => r.id === editingReceiptId)?.number}
                      </span>
                      . Die Quittungsnummer bleibt dabei unverändert.
                    </span>
                    <button onClick={cancelEdit} style={styles.linkBtn}>
                      Abbrechen
                    </button>
                  </div>
                )}

                <FieldGroup label="Datum">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    style={{ width: 180 }}
                  />
                </FieldGroup>

                <FieldGroup label="Empfänger">
                  {customers.length > 0 && (
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        if (e.target.value) setManualCustomer(emptyPerson);
                      }}
                      style={styles.select}
                    >
                      <option value="">— gespeicherten Kunden wählen —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!selectedCustomerId && (
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <input
                        placeholder="Name"
                        value={manualCustomer.name}
                        onChange={(e) => setManualCustomer({ ...manualCustomer, name: e.target.value })}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          placeholder="Strasse"
                          value={manualCustomer.street}
                          onChange={(e) => setManualCustomer({ ...manualCustomer, street: e.target.value })}
                          style={{ flex: 2 }}
                        />
                        <input
                          placeholder="Nr."
                          value={manualCustomer.houseNumber}
                          onChange={(e) => setManualCustomer({ ...manualCustomer, houseNumber: e.target.value })}
                          style={{ flex: 1 }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          placeholder="PLZ"
                          value={manualCustomer.postalCode}
                          onChange={(e) => setManualCustomer({ ...manualCustomer, postalCode: e.target.value })}
                          style={{ flex: 1 }}
                        />
                        <input
                          placeholder="Ort"
                          value={manualCustomer.city}
                          onChange={(e) => setManualCustomer({ ...manualCustomer, city: e.target.value })}
                          style={{ flex: 2 }}
                        />
                      </div>
                      <input
                        placeholder="E-Mail"
                        value={manualCustomer.email}
                        onChange={(e) => setManualCustomer({ ...manualCustomer, email: e.target.value })}
                      />
                      <input
                        placeholder="Telefon (für WhatsApp, z.B. +41 79 123 45 67)"
                        value={manualCustomer.phone}
                        onChange={(e) => setManualCustomer({ ...manualCustomer, phone: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={saveManualCustomerToList}
                        disabled={!manualCustomer.name.trim()}
                        style={{ ...styles.secondaryBtn, opacity: manualCustomer.name.trim() ? 1 : 0.4 }}
                      >
                        <Plus size={14} /> Kunde speichern
                      </button>
                    </div>
                  )}
                  {needsAddress && !personHasAddress(activeCustomer) && (
                    <div style={styles.hint}>
                      Ab CHF 400 ist die Adresse des Käufers gesetzlich vorgeschrieben (OR Art. 958f).
                    </div>
                  )}
                </FieldGroup>

                <FieldGroup label="Leistungen">
                  <div style={{ display: "grid", gap: 8 }}>
                    {items.map((it, idx) => (
                      <div key={it.id} style={styles.itemRow}>
                        <input
                          placeholder="Beschreibung"
                          value={it.description}
                          onChange={(e) => updateItem(it.id, "description", e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <div style={styles.amountWrap}>
                          <span className="mono" style={styles.chfLabel}>CHF</span>
                          <input
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            value={it.amount}
                            onChange={(e) => updateItem(it.id, "amount", e.target.value)}
                            className="mono"
                            style={{ width: 90, textAlign: "right" }}
                          />
                        </div>
                        <button
                          onClick={() => removeItem(it.id)}
                          style={styles.iconBtn}
                          disabled={items.length === 1}
                          aria-label="Position entfernen"
                        >
                          <Trash2 size={14} color={items.length === 1 ? "#CBCED2" : "#70747C"} />
                        </button>
                      </div>
                    ))}
                    <button onClick={addItem} style={styles.dashedBtn}>
                      <Plus size={14} /> Position hinzufügen
                    </button>
                  </div>

                  <button
                    onClick={() => setVatEnabled(!vatEnabled)}
                    style={styles.vatToggleRow}
                    type="button"
                  >
                    <span style={{ ...styles.vatSwitch, ...(vatEnabled ? styles.vatSwitchOn : {}) }}>
                      <span style={{ ...styles.vatSwitchKnob, ...(vatEnabled ? styles.vatSwitchKnobOn : {}) }} />
                    </span>
                    <span style={styles.vatToggleLabel}>
                      Mehrwertsteuerpflichtig <span style={styles.docMuted}>(Normalsatz 8.1 %)</span>
                    </span>
                  </button>

                  {vatEnabled ? (
                    <div style={styles.vatBreakdown}>
                      <div style={styles.vatBreakdownRow}>
                        <span>Netto</span>
                        <span className="mono">CHF {chf(netTotal)}</span>
                      </div>
                      <div style={styles.vatBreakdownRow}>
                        <span>MWST 8.1 %</span>
                        <span className="mono">CHF {chf(vatAmount)}</span>
                      </div>
                      <div style={styles.totalLine}>
                        <span>Total (inkl. MWST)</span>
                        <span className="mono" style={styles.totalAmount}>CHF {chf(total)}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={styles.totalLine}>
                      <span>Total</span>
                      <span className="mono" style={styles.totalAmount}>CHF {chf(total)}</span>
                    </div>
                  )}

                  <button
                    onClick={() => setQrBillEnabled(!qrBillEnabled)}
                    style={styles.vatToggleRow}
                    type="button"
                  >
                    <span style={{ ...styles.vatSwitch, ...(qrBillEnabled ? styles.vatSwitchOn : {}) }}>
                      <span style={{ ...styles.vatSwitchKnob, ...(qrBillEnabled ? styles.vatSwitchKnobOn : {}) }} />
                    </span>
                    <span style={styles.vatToggleLabel}>
                      Bezahlbar per Rechnung <span style={styles.docMuted}>(QR-Einzahlungsschein)</span>
                    </span>
                  </button>

                  {qrBillEnabled && !isValidSwissIban(company.qrBill?.iban) && (
                    <div style={styles.hint}>
                      Dafür brauchst du eine gültige IBAN unter{" "}
                      <button
                        type="button"
                        onClick={() => setTab("company")}
                        style={{ ...styles.linkBtn, fontSize: 12 }}
                      >
                        Firma → QR-Rechnung
                      </button>
                      .
                    </div>
                  )}
                </FieldGroup>

                <FieldGroup label="Notiz (optional)">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </FieldGroup>

                <button
                  onClick={createReceipt}
                  disabled={!canCreate}
                  style={{ ...styles.primaryBtn, opacity: canCreate ? 1 : 0.4 }}
                >
                  {editingReceiptId ? "Änderungen speichern" : "Quittung erstellen →"}
                </button>
              </div>
            )}

            {tab === "customers" && (
              <div style={styles.panel}>
                <Eyebrow>02 — Kunden</Eyebrow>
                <h1 style={styles.h1}>Kundenverwaltung</h1>

                <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                  <input
                    placeholder="Name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      placeholder="Strasse"
                      value={newCustomer.street}
                      onChange={(e) => setNewCustomer({ ...newCustomer, street: e.target.value })}
                      style={{ flex: 2 }}
                    />
                    <input
                      placeholder="Nr."
                      value={newCustomer.houseNumber}
                      onChange={(e) => setNewCustomer({ ...newCustomer, houseNumber: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      placeholder="PLZ"
                      value={newCustomer.postalCode}
                      onChange={(e) => setNewCustomer({ ...newCustomer, postalCode: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <input
                      placeholder="Ort"
                      value={newCustomer.city}
                      onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })}
                      style={{ flex: 2 }}
                    />
                  </div>
                  <input
                    placeholder="E-Mail"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  />
                  <input
                    placeholder="Telefon (für WhatsApp, z.B. +41 79 123 45 67)"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                  <button onClick={addCustomer} style={styles.secondaryBtn}>
                    <Plus size={14} /> Kunde speichern
                  </button>
                </div>

                <div style={{ marginTop: 24 }}>
                  {customers.length === 0 ? (
                    <EmptyState text="Noch keine Kunden gespeichert." />
                  ) : (
                    customers.map((c) => (
                      <div key={c.id} style={styles.listRow}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          {personAddressLines(c).map((l, i) => (
                            <div style={styles.muted} key={i}>{l}</div>
                          ))}
                          <div style={styles.muted}>{c.email}</div>
                          {c.phone && <div style={styles.muted}>{c.phone}</div>}
                        </div>
                        <button onClick={() => deleteCustomer(c.id)} style={styles.iconBtn}>
                          <Trash2 size={14} color="#70747C" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === "company" && (
              <div style={styles.panel}>
                <Eyebrow>03 — Firma</Eyebrow>
                <h1 style={styles.h1}>Firmendaten</h1>

                <div style={{ marginBottom: 28, maxWidth: 420 }}>
                  <div style={styles.fieldLabel}>Firmenlogo</div>
                  <div style={{ fontSize: 12, color: "#8B8F96", marginBottom: 12 }}>
                    Erscheint oben links auf Quittung/Rechnung (PDF und Druck). Ein Bild mit
                    wenig Rand wirkt am besten, PNG mit transparentem Hintergrund wird unterstützt.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {companyDraft.logoDataUrl ? (
                      <img src={companyDraft.logoDataUrl} alt="Firmenlogo" style={styles.logoPreview} />
                    ) : (
                      <div style={styles.logoPlaceholder}>Kein Logo</div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ ...styles.secondaryBtn, opacity: logoUploading ? 0.6 : 1 }}>
                        <Upload size={14} /> {logoUploading ? "Lade hoch…" : "Logo hochladen"}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          disabled={logoUploading}
                          style={{ display: "none" }}
                        />
                      </label>
                      {companyDraft.logoDataUrl && (
                        <button type="button" onClick={removeLogo} style={styles.linkBtn}>
                          Logo entfernen
                        </button>
                      )}
                    </div>
                  </div>
                  {logoError && <div style={styles.hint}>{logoError}</div>}
                </div>

                <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                  <input
                    placeholder="Firmenname"
                    value={companyDraft.name}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, name: e.target.value })}
                  />
                  <input
                    placeholder="Strasse und Nr."
                    value={companyDraft.address}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, address: e.target.value })}
                  />
                  <input
                    placeholder="PLZ Ort"
                    value={companyDraft.zipCity}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, zipCity: e.target.value })}
                  />
                  <input
                    placeholder="E-Mail"
                    value={companyDraft.email}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, email: e.target.value })}
                  />
                  <input
                    placeholder="Telefon"
                    value={companyDraft.phone}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, phone: e.target.value })}
                  />
                  <input
                    placeholder="MWST-Nummer (optional, z.B. CHE-123.456.789 MWST)"
                    value={companyDraft.vatNumber}
                    onChange={(e) => setCompanyDraft({ ...companyDraft, vatNumber: e.target.value })}
                  />
                  <button onClick={saveCompany} style={styles.secondaryBtn}>
                    <Check size={14} /> Speichern
                  </button>
                  {saveStatus && <div style={styles.savedMsg}>{saveStatus}</div>}
                </div>

                <div style={{ marginTop: 32, maxWidth: 420 }}>
                  <div style={styles.fieldLabel}>QR-Rechnung (Einzahlungsschein)</div>
                  <div style={{ fontSize: 12, color: "#8B8F96", marginBottom: 12 }}>
                    Nötig, damit Kunden Quittungen per Banküberweisung mit Schweizer
                    QR-Code bezahlen können. Die Adresse muss laut aktueller
                    Vorgabe strukturiert (einzelne Felder) angegeben werden.
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      placeholder="Name des Zahlungsempfängers (z.B. dein Privatname, falls das Konto nicht auf die Firma läuft)"
                      value={companyDraft.qrBill?.name || ""}
                      onChange={(e) =>
                        setCompanyDraft({
                          ...companyDraft,
                          qrBill: { ...(companyDraft.qrBill || {}), name: e.target.value },
                        })
                      }
                    />
                    <input
                      placeholder="IBAN (CH...)"
                      value={companyDraft.qrBill?.iban || ""}
                      onChange={(e) =>
                        setCompanyDraft({
                          ...companyDraft,
                          qrBill: { ...(companyDraft.qrBill || {}), iban: e.target.value },
                        })
                      }
                    />
                    {companyDraft.qrBill?.iban && (
                      <div
                        style={{
                          fontSize: 11,
                          color: isValidSwissIban(companyDraft.qrBill.iban) ? "#1D7A3C" : "#B00020",
                        }}
                      >
                        {isValidSwissIban(companyDraft.qrBill.iban)
                          ? "✓ Gültige Schweizer IBAN"
                          : "IBAN unvollständig oder ungültig (muss mit CH/LI beginnen, 21 Zeichen)"}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        placeholder="Strasse"
                        value={companyDraft.qrBill?.street || ""}
                        onChange={(e) =>
                          setCompanyDraft({
                            ...companyDraft,
                            qrBill: { ...(companyDraft.qrBill || {}), street: e.target.value },
                          })
                        }
                        style={{ flex: 2 }}
                      />
                      <input
                        placeholder="Nr."
                        value={companyDraft.qrBill?.houseNumber || ""}
                        onChange={(e) =>
                          setCompanyDraft({
                            ...companyDraft,
                            qrBill: { ...(companyDraft.qrBill || {}), houseNumber: e.target.value },
                          })
                        }
                        style={{ flex: 1 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        placeholder="PLZ"
                        value={companyDraft.qrBill?.postalCode || ""}
                        onChange={(e) =>
                          setCompanyDraft({
                            ...companyDraft,
                            qrBill: { ...(companyDraft.qrBill || {}), postalCode: e.target.value },
                          })
                        }
                        style={{ flex: 1 }}
                      />
                      <input
                        placeholder="Ort"
                        value={companyDraft.qrBill?.city || ""}
                        onChange={(e) =>
                          setCompanyDraft({
                            ...companyDraft,
                            qrBill: { ...(companyDraft.qrBill || {}), city: e.target.value },
                          })
                        }
                        style={{ flex: 2 }}
                      />
                    </div>
                    <button onClick={saveCompany} style={styles.secondaryBtn}>
                      <Check size={14} /> Speichern
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === "history" && (
              <div style={styles.panel}>
                <Eyebrow>04 — Verlauf</Eyebrow>
                <h1 style={styles.h1}>Bisherige Quittungen</h1>
                {receipts.length === 0 ? (
                  <EmptyState text="Noch keine Quittungen erstellt." />
                ) : (
                  [...receipts].reverse().map((r) => (
                    <div key={r.id} style={styles.listRow}>
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          Nr. <span className="mono">{r.number}</span> · {r.customer.name}
                        </div>
                        <div style={styles.muted}>
                          {formatDateDE(r.date)} · CHF {chf(r.total)}
                          {r.editedAt ? " · bearbeitet" : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openReceipt(r)} style={styles.secondaryBtnSmall}>
                          Öffnen
                        </button>
                        <button onClick={() => startEditReceipt(r)} style={styles.secondaryBtnSmall}>
                          Bearbeiten
                        </button>
                        <ConfirmDeleteButton onConfirm={() => deleteReceipt(r.id)} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "accounting" && (
              <div style={styles.panel}>
                <BuchhaltungTab receipts={receipts} onTogglePaid={togglePaid} />
              </div>
            )}

            {tab === "backup" && (
              <div style={styles.panel}>
                <Eyebrow>06 — Backup</Eyebrow>
                <h1 style={styles.h1}>Backup & Datenübertragung</h1>
                <div style={{ fontSize: 13, color: "#5B5F66", marginBottom: 24, maxWidth: 480 }}>
                  Exportiert Firma, alle Kunden und alle Quittungen/Rechnungen als eine
                  einzelne Datei — z. B. um sie in die andere Qwui-Version zu übertragen
                  (Web ↔ Windows), oder einfach als Sicherungskopie in einem
                  Cloud-Speicher deiner Wahl (z. B. ProtonDrive, OneDrive) abzulegen.
                </div>

                <FieldGroup label="Exportieren">
                  <button onClick={exportAllData} style={styles.secondaryBtn}>
                    <Download size={14} /> Alle Daten exportieren
                  </button>
                </FieldGroup>

                <FieldGroup label="Importieren">
                  <div style={{ ...styles.hint, marginTop: 0, marginBottom: 12 }}>
                    Achtung: Ein Import ersetzt Firma, alle Kunden und alle Quittungen
                    vollständig durch den Inhalt der Backup-Datei — nicht rückgängig zu
                    machen. Am besten vorher selbst ein aktuelles Backup exportieren.
                  </div>
                  <label style={{ ...styles.secondaryBtn, opacity: importing ? 0.6 : 1 }}>
                    <Upload size={14} /> Backup-Datei auswählen
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={handleImportFileSelect}
                      disabled={importing}
                      style={{ display: "none" }}
                    />
                  </label>
                  {importError && <div style={styles.hint}>{importError}</div>}
                </FieldGroup>

                {importPreview && (
                  <div style={styles.importPreviewBox}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <AlertTriangle size={16} color="#B5480C" />
                      <strong style={{ fontSize: 13 }}>Backup-Datei bereit zum Import</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#5B5F66", marginBottom: 4 }}>
                      Firma: <strong>{importPreview.company?.name || "(kein Name)"}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#5B5F66", marginBottom: 4 }}>
                      {importPreview.customers?.length || 0} Kunden,{" "}
                      {importPreview.receipts?.length || 0} Quittungen/Rechnungen
                    </div>
                    {importPreview.exportedAt && (
                      <div style={{ fontSize: 12, color: "#8B8F96", marginBottom: 12 }}>
                        Exportiert am {formatDateDE(importPreview.exportedAt.slice(0, 10))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={confirmImport} disabled={importing} style={styles.dangerBtnSmall}>
                        {importing ? "Importiere…" : "Jetzt importieren (ersetzt alle Daten)"}
                      </button>
                      <button onClick={cancelImport} disabled={importing} style={styles.secondaryBtnSmall}>
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {mode === "preview" && currentReceipt && (
        <div className="preview-wrap" style={styles.previewWrap}>
          <div className="no-print" style={styles.previewToolbar}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={backToForm} style={styles.secondaryBtn}>
                <ArrowLeft size={14} /> Neue Quittung
              </button>
              <button onClick={() => startEditReceipt(currentReceipt)} style={styles.secondaryBtn}>
                Bearbeiten
              </button>
              <ConfirmDeleteButton
                label="Quittung löschen"
                onConfirm={() => deleteReceipt(currentReceipt.id)}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={downloadPdf} style={styles.secondaryBtn} disabled={generatingPdf}>
                <Printer size={14} /> {generatingPdf ? "Erstelle PDF…" : "PDF herunterladen"}
              </button>
              <button onClick={printReceipt} style={styles.secondaryBtn}>
                Drucken
              </button>
              {canShareFiles && (
                <button onClick={sharePdf} style={styles.secondaryBtn} disabled={sharing}>
                  <Share2 size={14} /> {sharing ? "Bereite vor…" : "Teilen"}
                </button>
              )}
              <button
                onClick={sendMail}
                style={styles.primaryBtnSmall}
                disabled={!currentReceipt.customer.email}
                title={!currentReceipt.customer.email ? "Keine E-Mail-Adresse hinterlegt" : ""}
              >
                <Mail size={14} /> Per E-Mail senden
              </button>
              <button onClick={sendWhatsApp} style={styles.whatsappBtn}>
                <MessageCircle size={14} /> Per WhatsApp senden
              </button>
            </div>
          </div>
          {!currentReceipt.customer.email && (
            <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 12px" }}>
              Für diesen Kunden ist keine E-Mail-Adresse hinterlegt — bitte manuell versenden.
            </div>
          )}
          {!currentReceipt.customer.phone && (
            <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 12px" }}>
              Für diesen Kunden ist keine Telefonnummer hinterlegt — WhatsApp öffnet sich ohne
              vorausgewählten Kontakt, du wählst ihn dann manuell aus.
            </div>
          )}
          <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 12px" }}>
            Tipp für eine saubere PDF ohne Titel/URL am Seitenrand: Im Druckdialog unten auf
            „Mehr Einstellungen" klicken und „Kopf- und Fusszeilen" abwählen.
          </div>
          <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 8px" }}>
            Hinweis: „Per E-Mail senden" öffnet dein E-Mail-Programm mit vorausgefülltem Text. Da Browser aus
            Sicherheitsgründen keine automatischen Anhänge erlauben, lade die Quittung zuerst über den Button
            „PDF herunterladen" herunter und hänge sie manuell an
            {canShareFiles ? ' — oder nutze stattdessen „Teilen" (siehe unten).' : "."}
          </div>
          <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 20px" }}>
            Hinweis: „Per WhatsApp senden" öffnet WhatsApp (App oder WhatsApp Web) mit fertig
            eingetragenem Text — als reine Nachricht, ohne PDF-Anhang. Welche WhatsApp-Version sich
            öffnet (privat oder Business), entscheidet dein Betriebssystem, nicht dieses Tool — ist
            nur WhatsApp Business installiert, öffnet sich automatisch diese.
          </div>
          {canShareFiles && (
            <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 20px" }}>
              Tipp: Der Button „Teilen" öffnet den Teilen-Dialog deines Geräts und übergibt die
              Quittung direkt als PDF-Anhang an WhatsApp, Mail oder eine andere App — ohne den
              Umweg über „Herunterladen" und manuelles Anhängen.
            </div>
          )}

          <ReceiptDocument receipt={currentReceipt} />
          {currentReceipt.qrBillEnabled && (
            <div className="no-print" style={{ textAlign: "center", margin: "16px 0" }}>
              <span style={styles.docMuted}>↓ QR-Rechnung — wird sowohl beim PDF-Download als auch beim Drucken mit ausgegeben</span>
            </div>
          )}
          {currentReceipt.qrBillEnabled && <QrBillDocument receipt={currentReceipt} />}
        </div>
      )}
    </div>
  );
}

function ReceiptDocument({ receipt }) {
  return (
    <div className="print-area" style={styles.document}>
      <div style={styles.docHeader}>
        <div style={styles.docHeaderLeft}>
          {receipt.company.logoDataUrl && (
            <img src={receipt.company.logoDataUrl} alt="" style={styles.docLogo} />
          )}
          <div>
            <div style={styles.docCompanyName}>{receipt.company.name || "Firma"}</div>
            <div style={styles.docMuted}>{receipt.company.address}</div>
            <div style={styles.docMuted}>{receipt.company.zipCity}</div>
            <div style={styles.docMuted}>{receipt.company.email}</div>
            <div style={styles.docMuted}>{receipt.company.phone}</div>
            {receipt.company.vatNumber && (
              <div style={styles.docMuted}>MWST-Nr. {receipt.company.vatNumber}</div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={styles.docTitle}>{receipt.qrBillEnabled ? "RECHNUNG" : "QUITTUNG"}</div>
          <div className="mono" style={styles.docNumber}>Nr. {receipt.number}</div>
          <div className="mono" style={styles.docMuted}>{formatDateDE(receipt.date)}</div>
        </div>
      </div>

      <div style={styles.docRule} />

      <div style={styles.docSection}>
        <div style={styles.docLabel}>Empfänger</div>
        <div style={{ fontWeight: 600 }}>{receipt.customer.name}</div>
        {personAddressLines(receipt.customer).map((l, i) => (
          <div style={styles.docMuted} key={i}>{l}</div>
        ))}
        {receipt.customer.email && <div style={styles.docMuted}>{receipt.customer.email}</div>}
      </div>

      <div style={styles.docSection}>
        <div style={styles.docLabel}>Leistung</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <tbody>
            {receipt.items.map((it) => (
              <tr key={it.id} style={{ borderBottom: "1px solid #EDEEEF" }}>
                <td style={{ padding: "6px 0", fontSize: 13 }}>{it.description}</td>
                <td className="mono" style={{ padding: "6px 0", fontSize: 13, textAlign: "right" }}>
                  CHF {chf(it.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {receipt.vatEnabled ? (
          <div style={{ marginTop: 10 }}>
            <div style={styles.vatBreakdownRow}>
              <span>Netto</span>
              <span className="mono">CHF {chf(receipt.netTotal)}</span>
            </div>
            <div style={styles.vatBreakdownRow}>
              <span>MWST 8.1 %</span>
              <span className="mono">CHF {chf(receipt.vatAmount)}</span>
            </div>
            <div style={styles.totalLine}>
              <span>Total (inkl. MWST)</span>
              <span className="mono" style={styles.totalAmount}>CHF {chf(receipt.total)}</span>
            </div>
          </div>
        ) : (
          <div style={styles.totalLine}>
            <span>Total</span>
            <span className="mono" style={styles.totalAmount}>CHF {chf(receipt.total)}</span>
          </div>
        )}
      </div>

      {receipt.note && (
        <div style={styles.docSection}>
          <div style={styles.docLabel}>Notiz</div>
          <div style={{ fontSize: 13 }}>{receipt.note}</div>
        </div>
      )}

      <div style={{ ...styles.docSection, marginTop: 24 }}>
        {receipt.qrBillEnabled ? (
          <div style={{ fontSize: 13 }}>
            Zahlbar per beiliegendem Einzahlungsschein innert 30 Tagen.
          </div>
        ) : (
          <div style={{ fontSize: 13 }}>
            Betrag dankend erhalten, {receipt.company.zipCity || "___________"}, {formatDateDE(receipt.date)}
          </div>
        )}
        <div style={styles.signatureLine}>
          <span style={styles.docMuted}>Unterschrift</span>
          <span style={{ fontStyle: "italic" }}>{receipt.company.name}</span>
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button
      className="navbtn"
      onClick={onClick}
      style={{
        ...styles.navBtn,
        borderLeft: active ? "3px solid #E30613" : "3px solid transparent",
        background: active ? "#F1F1EF" : "transparent",
        color: active ? "#16181D" : "#5B5F66",
      }}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
}

function Eyebrow({ children }) {
  return <div style={styles.eyebrow}>{children}</div>;
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={styles.empty}>{text}</div>;
}

function ConfirmDeleteButton({ onConfirm, label = "Löschen" }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#B5480C" }}>Wirklich löschen?</span>
        <button
          onClick={() => {
            onConfirm();
            setConfirming(false);
          }}
          style={styles.dangerBtnSmall}
        >
          Ja, löschen
        </button>
        <button onClick={() => setConfirming(false)} style={styles.secondaryBtnSmall}>
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} style={styles.dangerOutlineBtnSmall}>
      <Trash2 size={13} /> {label}
    </button>
  );
}

const styles = {
  loadingWrap: { display: "flex", justifyContent: "center", alignItems: "center", height: 200 },
  persistErrorBanner: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    background: "#B00020",
    color: "#fff",
    textAlign: "center",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
  },
  appWrap: { minHeight: "100vh", background: "#FAFAF8" },
  shell: { display: "flex", minHeight: "100vh" },
  sidebar: {
    width: 200,
    borderRight: "1px solid #E4E5E7",
    padding: "20px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    background: "#fff",
  },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", marginBottom: 18 },
  brandMark: {
    width: 30,
    height: 30,
    objectFit: "contain",
  },
  brandTitle: { fontWeight: 700, fontSize: 13, lineHeight: 1.1 },
  brandSub: { fontSize: 11, color: "#8B8F96", letterSpacing: "0.04em" },
  sidebarFooter: {
    marginTop: "auto",
    paddingTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  footerLink: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    fontSize: 11,
    color: "#8B8F96",
    textDecoration: "none",
  },
  navBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  main: { flex: 1, padding: "40px 48px", maxWidth: 640 },
  panel: {},
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "#E30613",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  h1: { fontSize: 22, fontWeight: 700, margin: "0 0 28px 0" },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#5B5F66", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  select: { width: "100%", padding: "8px 10px", border: "1px solid #DADDE1", fontSize: 13, background: "#fff" },
  itemRow: { display: "flex", alignItems: "center", gap: 8 },
  amountWrap: { display: "flex", alignItems: "center", gap: 4 },
  chfLabel: { fontSize: 11, color: "#8B8F96" },
  iconBtn: { border: "none", background: "transparent", cursor: "pointer", padding: 6, display: "flex" },
  dashedBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1px dashed #C7CACF",
    background: "transparent",
    color: "#5B5F66",
    fontSize: 12,
    padding: "8px 10px",
    cursor: "pointer",
    width: "fit-content",
  },
  totalLine: {
    display: "flex",
    justifyContent: "space-between",
    borderTop: "2px solid #16181D",
    marginTop: 10,
    paddingTop: 8,
    fontWeight: 600,
    fontSize: 14,
  },
  totalAmount: { color: "#E30613" },
  vatToggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "10px 0 0",
    width: "fit-content",
  },
  vatSwitch: {
    width: 34,
    height: 18,
    background: "#DADDE1",
    borderRadius: 999,
    position: "relative",
    transition: "background 0.15s ease",
    flexShrink: 0,
  },
  vatSwitchOn: {
    background: "#E30613",
  },
  vatSwitchKnob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 0.15s ease",
  },
  vatSwitchKnobOn: {
    left: 18,
  },
  vatToggleLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: "#16181D",
    textAlign: "left",
  },
  vatBreakdown: {
    marginTop: 10,
  },
  vatBreakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#5B5F66",
    padding: "3px 0",
  },
  primaryBtn: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "11px 20px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnSmall: {
    background: "#16181D",
    color: "#fff",
    border: "none",
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
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
    width: "fit-content",
  },
  whatsappBtn: {
    background: "#25D366",
    color: "#0B2E1A",
    border: "none",
    padding: "9px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  secondaryBtnSmall: {
    background: "#fff",
    color: "#16181D",
    border: "1px solid #DADDE1",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  dangerOutlineBtnSmall: {
    background: "#fff",
    color: "#B00020",
    border: "1px solid #F0C4C9",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  dangerBtnSmall: {
    background: "#B00020",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  editBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#FDF3EC",
    border: "1px solid #F3D9C4",
    color: "#5B5F66",
    fontSize: 12,
    padding: "10px 12px",
    marginBottom: 20,
  },
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
  card: { border: "1px solid #E4E5E7", padding: 16, background: "#fff", maxWidth: 380 },
  listRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #EDEEEF",
  },
  muted: { fontSize: 12, color: "#8B8F96" },
  empty: { fontSize: 13, color: "#8B8F96", fontStyle: "italic", padding: "20px 0" },
  hint: { fontSize: 12, color: "#B5480C", background: "#FDF3EC", padding: "8px 10px", marginTop: 8 },
  savedMsg: { fontSize: 12, color: "#1D7A3C" },
  importPreviewBox: {
    marginTop: 8,
    padding: 16,
    maxWidth: 420,
    border: "1px solid #F3D9C4",
    background: "#FDF3EC",
  },
  logoPreview: {
    width: 90,
    height: 60,
    objectFit: "contain",
    border: "1px solid #E4E5E7",
    background: "#fff",
    padding: 6,
  },
  logoPlaceholder: {
    width: 90,
    height: 60,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px dashed #C7CACF",
    color: "#B4B7BC",
    fontSize: 11,
  },
  previewWrap: { padding: "40px 20px" },
  previewToolbar: {
    maxWidth: 640,
    margin: "0 auto 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  document: {
    maxWidth: 640,
    margin: "0 auto",
    background: "#fff",
    border: "1px solid #E4E5E7",
    padding: 40,
  },
  docHeader: { display: "flex", justifyContent: "space-between" },
  docHeaderLeft: { display: "flex", alignItems: "flex-start", gap: 12 },
  docLogo: { maxWidth: 90, maxHeight: 56, objectFit: "contain" },
  docCompanyName: { fontWeight: 700, fontSize: 15 },
  docMuted: { fontSize: 12, color: "#70747C" },
  docTitle: { fontSize: 20, fontWeight: 700, letterSpacing: "0.04em", color: "#E30613" },
  docNumber: { fontSize: 13, fontWeight: 600 },
  docRule: { height: 2, background: "#16181D", margin: "20px 0 24px" },
  docSection: { marginBottom: 22 },
  docLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#8B8F96",
    marginBottom: 4,
  },
  signatureLine: { display: "flex", justifyContent: "space-between", marginTop: 20, borderTop: "1px solid #DADDE1", paddingTop: 8 },
};
