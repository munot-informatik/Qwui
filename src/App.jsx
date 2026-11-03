import React, { useState, useEffect, useRef } from "react";
import logoImg from "./assets/logo.png";
import QrBillDocument from "./QrBillDocument.jsx";
import BuchhaltungTab from "./BuchhaltungTab.jsx";
import { buildReceiptPdfBytes } from "./receiptPdf.js";
import { isValidSwissIban, formatIbanDisplay } from "./qrbill.js";
import {
  itemKind,
  itemQuantity,
  itemUnitPrice,
  itemListPrice,
  itemDiscountPercent,
  itemDiscountAmount,
  itemLineTotal,
  formatPercent,
  quantityPrefix,
} from "../shared/items.js";
import {
  MOVEMENTS_PREFIX,
  isMovementsKey,
  isSerialTracked,
  productStock,
  bookReceipt,
  reverseReceipt,
  rebookReceipt,
  correctStock,
  changeUnitStatus,
  receiveGoods,
  appendMovements,
} from "../shared/stock.js";
import { UNIT_STATUS, isSellable, checkNewSerials } from "../shared/serials.js";
import { StockCell, UnitList, Wareneingang, SeriennummerSuche, Lagerbewegungen } from "./Lager.jsx";
import EmailEinstellungen from "./EmailEinstellungen.jsx";
import {
  hasEmailConsent,
  grantEmailConsent,
  withoutUnconsentedEmail,
  hasLegacyEmailWithoutConsent,
  isValidEmail,
} from "../shared/consent.js";

import { buildBackupPayload, looksLikeBackup, isEncryptedBackup } from "../shared/backupFormat.js";
import BackupAutomatik from "./BackupAutomatik.jsx";
import ShopAnbindung from "./ShopAnbindung.jsx";
import { Vorschlaege, Schnittstelle } from "./Assistent.jsx";
import { findArticle } from "../shared/reports.js";

// Direkter Versand per SMTP und automatische Sicherung gibt es nur in der
// Windows-Version (Preload).
const desktopMail = typeof window !== "undefined" ? window.qwuiDesktop?.mail || null : null;
const desktopBackup = typeof window !== "undefined" ? window.qwuiDesktop?.backup || null : null;
const desktopShop = typeof window !== "undefined" ? window.qwuiDesktop?.shop || null : null;
const desktopAssistant = typeof window !== "undefined" ? window.qwuiDesktop?.assistant || null : null;
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
  Package,
  Store,
  Bot,
} from "lucide-react";

// Backup-Dateiformat: siehe shared/backupFormat.js. Die Versionsnummer ist
// beim Import rein informativ — kein harter Kompatibilitäts-Check, damit auch
// künftige, abwärtskompatible Versionen weiterhin importiert werden können.

const KEYS = {
  company: "company-info",
  customers: "customers-list",
  receipts: "receipts-list",
  inventory: "inventory-list",
  // Ab 1.2.0: einzelne Exemplare seriennummernpflichtiger Artikel. Die
  // Lagerbewegungen liegen pro Jahr unter "stock-movements-JJJJ" (siehe
  // shared/stock.js, movementsKey).
  units: "serial-units",
};

const emptyCompany = {
  name: "",
  address: "",
  zipCity: "",
  email: "",
  phone: "",
  vatNumber: "",
  logoDataUrl: "",
  // Platzierung des Logos im PDF-Kopf. "left" ist das bisherige Verhalten und
  // bleibt Vorgabe, damit bestehende Firmendaten unverändert aussehen.
  logoLayout: "inline", // "inline" (neben dem Text) | "above" (über dem Text)
  logoPosition: "left", // Ausrichtung bei "above": "left" | "center" | "right"
  logoSize: "medium", // "small" | "medium" | "large"
  qrBill: { name: "", iban: "", street: "", houseNumber: "", postalCode: "", city: "", country: "CH" },
};

// ---- Rechnungspositionen: Produkt/Dienstleistung, Menge, Listenpreis und Rabatt ----
// Eine Position speichert in "amount" den LISTENPREIS PRO STÜCK (vor Rabatt).
// Gerechnet wird mit den Helfern aus shared/items.js. Alte Positionen ohne
// kind/quantity/discountPercent verhalten sich exakt wie bisher:
// Dienstleistung, 1 Stück, 0 % Rabatt, Betrag = Listenpreis.
//
// Produkte aus dem Inventar tragen productId (Bezug für die Lagerbuchung),
// seriennummernpflichtige zusätzlich unitId und serial des verkauften
// Exemplars.

function emptyItem() {
  return {
    id: uid(),
    description: "",
    amount: "",
    quantity: "1",
    kind: "service",
    discountPercent: "",
    articleNumber: "",
    productId: "",
    unitId: "",
    serial: "",
  };
}

const emptyProduct = { articleNumber: "", name: "", group: "", stock: "", price: "", serialTracked: false };

// Anordnung des Logos im Dokumentkopf: neben dem Firmen-Textblock ("inline")
// oder auf einer eigenen Zeile darüber ("above"). Firmendaten ohne diese
// Einstellung verhalten sich wie bisher.
function logoLayoutOf(company) {
  if (company?.logoLayout === "above" || company?.logoLayout === "inline") return company.logoLayout;
  return (company?.logoPosition || "left") === "left" ? "inline" : "above";
}

// Ausrichtung innerhalb der eigenen Zeile (nur bei "above" wirksam).
function logoAlignOf(company) {
  const p = company?.logoPosition || "left";
  return p === "center" || p === "right" ? p : "left";
}

// Anzeigename für Artikel ohne zugewiesene Gruppe. Bewusst kein leerer String,
// damit sich diese Artikel im Filter gezielt auswählen lassen.
const UNGROUPED_LABEL = "Ohne Gruppe";

function productGroup(p) {
  const g = (p?.group || "").trim();
  return g || UNGROUPED_LABEL;
}

// Alle vorkommenden Gruppen, alphabetisch; "Ohne Gruppe" immer zuletzt.
function collectGroups(products) {
  const set = new Set(products.map(productGroup));
  const named = [...set].filter((g) => g !== UNGROUPED_LABEL).sort((a, b) =>
    a.localeCompare(b, "de-CH", { sensitivity: "base" })
  );
  return set.has(UNGROUPED_LABEL) ? [...named, UNGROUPED_LABEL] : named;
}

const emptyPerson = {
  name: "",
  address: "", // alte Freitext-Adresse, bleibt für bestehende Kunden erhalten
  street: "",
  houseNumber: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
  // Einverständnis «E-Mail-Beleg», siehe shared/consent.js
  emailConsent: null,
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

function formatDateTimeDE(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

// Auswählbare Zahlungsfristen (in Tagen) für QR-Rechnungen. 30 Tage ist der
// bisherige Standard und bleibt Vorauswahl.
const PAYMENT_TERM_OPTIONS = [10, 14, 20, 30, 60];
const DEFAULT_PAYMENT_TERM_DAYS = 30;

// Zahlungsfrist einer Rechnung in Tagen. Fällt auf 30 zurück, wenn nichts
// gesetzt ist — so bleiben Alt-Rechnungen (vor dieser Funktion) und aus
// Backups importierte Belege unverändert bei 30 Tagen.
function paymentTermOf(receipt) {
  const d = Number(receipt?.paymentTermDays);
  return Number.isFinite(d) && d >= 0 ? d : DEFAULT_PAYMENT_TERM_DAYS;
}

function dayWord(n) {
  return n === 1 ? "Tag" : "Tagen";
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
  const [inventory, setInventory] = useState([]);
  const [units, setUnits] = useState([]);
  // Lagerbewegungen, nach Jahres-Schlüssel: { "stock-movements-2027": [...] }
  const [movementsByKey, setMovementsByKey] = useState({});
  // Meldungen der Lagerbuchung beim Erstellen/Bearbeiten einer Quittung:
  // errors verhindern das Speichern, warnings (z. B. negativer Bestand) nicht.
  const [stockErrors, setStockErrors] = useState([]);
  const [stockWarnings, setStockWarnings] = useState([]);
  const [currentReceipt, setCurrentReceipt] = useState(null);
  const [editingReceiptId, setEditingReceiptId] = useState(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [manualCustomer, setManualCustomer] = useState(emptyPerson);
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([emptyItem()]);
  const [note, setNote] = useState("");
  const [vatEnabled, setVatEnabled] = useState(false);
  const [qrBillEnabled, setQrBillEnabled] = useState(false);
  const [paymentTermDays, setPaymentTermDays] = useState(DEFAULT_PAYMENT_TERM_DAYS);
  // Zustellung nach dem Erstellen (nur Windows): per E-Mail und/oder Drucken.
  // null = Vorgabe aus dem Kunden (E-Mail, sofern eine Adresse bekannt ist).
  const [deliveryMail, setDeliveryMail] = useState(null);
  const [deliveryTo, setDeliveryTo] = useState(null);
  const [deliveryPrint, setDeliveryPrint] = useState(false);
  // Versand aus der Vorschau: { state: "idle" | "form" | "sending" | "sent" | "error", to, error }
  const [mailState, setMailState] = useState({ state: "idle", to: "", error: "" });

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
      try {
        const inv = await window.storage.get(KEYS.inventory);
        if (inv && inv.value) setInventory(JSON.parse(inv.value));
      } catch (e) {
        console.error("Laden des Inventars fehlgeschlagen", e);
        loadFailed = true;
      }
      try {
        const u = await window.storage.get(KEYS.units);
        if (u && u.value) setUnits(JSON.parse(u.value));
        const { keys = [] } = (await window.storage.list(MOVEMENTS_PREFIX)) || {};
        const loadedMovements = {};
        for (const key of keys.filter(isMovementsKey)) {
          const m = await window.storage.get(key);
          if (m && m.value) loadedMovements[key] = JSON.parse(m.value);
        }
        setMovementsByKey(loadedMovements);
      } catch (e) {
        console.error("Laden der Exemplare/Lagerbewegungen fehlgeschlagen", e);
        loadFailed = true;
      }
      if (loadFailed) {
        setPersistError(
          "Laden fehlgeschlagen — möglicherweise ist die Datenquelle gerade nicht erreichbar."
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

  // Speichert eine Lagerbuchung in EINEM Schritt (storage.setMany): neues
  // Inventar, Exemplare, angehängte Lagerbewegungen und optional weitere
  // Listen (z. B. die Quittungen). So können Quittung und Bestand nie
  // auseinanderlaufen, auch wenn das Speichern mittendrin scheitert.
  // extra: [{ key, value, setter }]
  async function commitStock({ inventory: nextInventory, units: nextUnits, movements = [], extra = [] }) {
    cancelPendingInventorySave();
    const appended = appendMovements(movementsByKey, movements);
    const entries = [
      { key: KEYS.inventory, value: nextInventory },
      { key: KEYS.units, value: nextUnits },
      ...Object.entries(appended).map(([key, value]) => ({ key, value })),
      ...extra.map(({ key, value }) => ({ key, value })),
    ];
    setInventory(nextInventory);
    setUnits(nextUnits);
    if (movements.length) setMovementsByKey((prev) => ({ ...prev, ...appended }));
    extra.forEach(({ value, setter }) => setter && setter(value));
    try {
      await window.storage.setMany(entries.map(({ key, value }) => ({ key, value: JSON.stringify(value) })));
      setPersistError("");
      return true;
    } catch (e) {
      console.error("Speichern der Lagerbuchung fehlgeschlagen", e);
      setPersistError(`Speichern fehlgeschlagen: ${e.message || "unbekannter Fehler"}`);
      return false;
    }
  }

  function stockCtx() {
    return { now: new Date().toISOString(), source: "app", newId: uid };
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

  // Verschlüsselte Sicherung, die auf das Passwort wartet: { text, name, password, error }
  const [encryptedImport, setEncryptedImport] = useState(null);

  async function decryptImport() {
    const { text, password } = encryptedImport;
    const result = await desktopBackup.decrypt(text, password);
    if (!result.ok) {
      setEncryptedImport({ ...encryptedImport, error: result.error });
      return;
    }
    const parsed = JSON.parse(result.json);
    if (!looksLikeBackup(parsed)) {
      setEncryptedImport({ ...encryptedImport, error: "Die Datei enthält keine Qwui-Daten." });
      return;
    }
    setEncryptedImport(null);
    setImportPreview(parsed);
  }

  const [evaluationStatus, setEvaluationStatus] = useState("");

  async function exportEvaluation() {
    setEvaluationStatus("");
    const result = await desktopBackup.exportEvaluation();
    if (result.ok) setEvaluationStatus(`Gespeichert: ${result.path}`);
    else if (!result.canceled) setEvaluationStatus(`Excel-Auswertung fehlgeschlagen: ${result.error}`);
  }

    function exportAllData() {
    const payload = buildBackupPayload({ company, customers, receipts, inventory, units, movementsByKey });
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
      // Verschlüsselte automatische Sicherung: erst nach dem Passwort fragen.
      if (isEncryptedBackup(parsed)) {
        if (!desktopBackup) {
          setImportError(
            "Das ist eine verschlüsselte automatische Sicherung der Windows-Version — sie lässt sich nur dort wiederherstellen."
          );
          return;
        }
        setEncryptedImport({ text: reader.result, name: file.name, password: "", error: "" });
        return;
      }
      if (!looksLikeBackup(parsed)) {
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
      // Ältere Backups (vor dem Inventar) haben kein inventory-Feld — dann
      // bleibt das bestehende Inventar unangetastet statt gelöscht zu werden.
      const okInventory = Array.isArray(importPreview.inventory)
        ? await persist(KEYS.inventory, importPreview.inventory, setInventory)
        : true;
      // Ab 1.2.0: Exemplare und Lagerbewegungen. Fehlen sie (Backup aus einer
      // älteren Version), bleiben die vorhandenen stehen — die Vorschau warnt.
      let okStock = true;
      if (Array.isArray(importPreview.serialUnits)) {
        okStock = await persist(KEYS.units, importPreview.serialUnits, setUnits);
      }
      if (okStock && importPreview.stockMovements && typeof importPreview.stockMovements === "object") {
        const imported = Object.fromEntries(
          Object.entries(importPreview.stockMovements).filter(([key, list]) => isMovementsKey(key) && Array.isArray(list))
        );
        try {
          for (const key of Object.keys(movementsByKey)) {
            if (!imported[key]) await window.storage.delete(key);
          }
          const entries = Object.entries(imported).map(([key, list]) => ({ key, value: JSON.stringify(list) }));
          if (entries.length) await window.storage.setMany(entries);
          setMovementsByKey(imported);
        } catch (e) {
          console.error("Import der Lagerbewegungen fehlgeschlagen", e);
          setPersistError(`Speichern fehlgeschlagen: ${e.message || "unbekannter Fehler"}`);
          okStock = false;
        }
      }

      // Erfolg nur melden, wenn wirklich alles geschrieben wurde. Sonst bleibt
      // die Bestätigung stehen, damit der Import wiederholt werden kann — der
      // React-State zeigt sonst die importierten Daten an, während in der
      // Datenbank noch die alten stehen und beim nächsten Laden zurückkommen.
      if (okCompany && okCustomers && okReceipts && okInventory && okStock) {
        // Einstellungen aus einer automatischen Sicherung (Windows): SMTP und
        // Backup-Ordner übernehmen, Passwörter sind darin nie enthalten. Erst
        // nach geglücktem Import — sonst stünden neue Einstellungen neben den
        // alten Daten.
        if (desktopBackup && importPreview.settings) {
          await desktopBackup.restoreSettings(importPreview.settings);
        }
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

  const [customerNotice, setCustomerNotice] = useState("");

  // Ohne Einverständnis «E-Mail-Beleg» wird die Adresse nicht gespeichert —
  // die Meldung sagt das, statt sie still zu verwerfen.
  function noticeIfEmailDropped(person) {
    setCustomerNotice(
      person.email && !hasEmailConsent(person)
        ? "Die E-Mail-Adresse wurde ohne Einverständnis «E-Mail-Beleg» nicht gespeichert."
        : ""
    );
  }

  async function addCustomer() {
    if (!newCustomer.name.trim()) return;
    noticeIfEmailDropped(newCustomer);
    const next = [...customers, { ...withoutUnconsentedEmail(newCustomer), id: uid() }];
    await persist(KEYS.customers, next, setCustomers);
    setNewCustomer(emptyPerson);
  }

  async function saveManualCustomerToList() {
    if (!manualCustomer.name.trim()) return;
    noticeIfEmailDropped(manualCustomer);
    const newEntry = { ...withoutUnconsentedEmail(manualCustomer), id: uid() };
    const next = [...customers, newEntry];
    await persist(KEYS.customers, next, setCustomers);
    setSelectedCustomerId(newEntry.id);
    // Die eingetippte Adresse bleibt für den Versand dieser Quittung stehen.
    if (!hasEmailConsent(manualCustomer) && manualCustomer.email) setDeliveryTo(manualCustomer.email);
    setManualCustomer(emptyPerson);
  }

  // Für Kunden aus Version 1.1: Einverständnis nachträglich erfassen oder die
  // gespeicherte Adresse entfernen.
  async function setCustomerConsent(id, given) {
    const next = customers.map((c) =>
      c.id !== id ? c : given ? grantEmailConsent(c, todayISO()) : { ...c, email: "", emailConsent: null }
    );
    await persist(KEYS.customers, next, setCustomers);
  }

  async function deleteCustomer(id) {
    const next = customers.filter((c) => c.id !== id);
    await persist(KEYS.customers, next, setCustomers);
    if (selectedCustomerId === id) setSelectedCustomerId("");
  }

  // ---- Inventar ----
  const [newProduct, setNewProduct] = useState(emptyProduct);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryBusy, setInventoryBusy] = useState(false);

  // Ob die Import-Anleitung eingeblendet ist. Reine Anzeige-Einstellung, daher
  // im Browser gespeichert statt in der Datenbank — wer das System kennt,
  // blendet sie einmal aus und sie bleibt weg.
  const [showImportHelp, setShowImportHelp] = useState(() => {
    try {
      return window.localStorage.getItem("qwui:importHelpHidden") !== "1";
    } catch (e) {
      return true;
    }
  });

  function toggleImportHelp() {
    setShowImportHelp((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("qwui:importHelpHidden", next ? "0" : "1");
      } catch (e) {
        // Privater Modus o.ä. — dann gilt die Einstellung nur für diese Sitzung.
      }
      return next;
    });
  }

  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryGroupFilter, setInventoryGroupFilter] = useState("");
  // Bereich im Reiter Inventar: Artikel | Wareneingang | Seriennummer | Bewegungen
  const [inventoryView, setInventoryView] = useState("articles");
  // Artikel, deren Exemplarliste aufgeklappt ist
  const [openUnitLists, setOpenUnitLists] = useState(() => new Set());

  function toggleUnitList(id) {
    setOpenUnitLists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Name des Kunden zu einem Exemplar — nur hier in der App, der Assistent
  // bekommt ausschliesslich die Kunden-ID.
  function unitCustomerName(unit) {
    const id = unit.customerId || unit.returnedFrom?.customerId;
    const c = id && customers.find((x) => x.id === id);
    if (c) return c.name;
    const receiptId = unit.receiptId || unit.returnedFrom?.receiptId;
    return receipts.find((r) => r.id === receiptId)?.customer?.name || "";
  }

  // Immer alphabetisch — so erscheinen die Artikel in der Rechnungsstellung
  // und im Inventar in derselben, erwartbaren Reihenfolge.
  const sortedInventory = [...inventory].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" })
  );

  const inventoryGroups = collectGroups(inventory);

  // Suche über Name und Artikelnummer, zusätzlich nach Gruppe filterbar.
  const visibleInventory = sortedInventory.filter((p) => {
    if (inventoryGroupFilter && productGroup(p) !== inventoryGroupFilter) return false;
    const q = inventorySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.articleNumber || "").toLowerCase().includes(q) ||
      (p.group || "").toLowerCase().includes(q)
    );
  });

  // Artikel nach Gruppe gebündelt — für die Auswahl in der Rechnungsstellung.
  const inventoryByGroup = inventoryGroups
    .map((g) => ({ group: g, items: sortedInventory.filter((p) => productGroup(p) === g) }))
    .filter((entry) => entry.items.length > 0);

  // Verwirft eine noch ausstehende Tipp-Speicherung: Hinzufügen und Löschen
  // arbeiten auf dem aktuellen State, der die getippten Änderungen bereits
  // enthält — der ältere Stand darf danach nicht mehr geschrieben werden.
  function cancelPendingInventorySave() {
    if (inventorySaveTimer.current) clearTimeout(inventorySaveTimer.current);
    inventorySaveTimer.current = null;
    pendingInventory.current = null;
  }

  // Legt einen Artikel an. Ein Anfangsbestand wird als Inventurkorrektur
  // gebucht, damit jede Menge im Protokoll belegt ist. Seriennummernpflichtige
  // Artikel starten bei 0 — ihre Exemplare kommen über den Wareneingang.
  // Liefert den neuen Artikel zurück (für den Wareneingang).
  async function addProduct(fields = newProduct) {
    if (!fields.name.trim()) return null;
    cancelPendingInventorySave();
    const serialTracked = !!fields.serialTracked;
    const entry = {
      id: uid(),
      articleNumber: fields.articleNumber.trim(),
      name: fields.name.trim(),
      group: fields.group.trim(),
      stock: 0,
      price: Number(fields.price) || 0,
      serialTracked,
      ...(fields.shopText ? { shopText: String(fields.shopText) } : {}),
      // Aus einem Vorschlag des Assistenten übernommen (verhindert Doppelte).
      ...(fields.sourceDraftId ? { sourceDraftId: fields.sourceDraftId } : {}),
    };
    const initial = serialTracked ? 0 : Number(fields.stock) || 0;
    const result = correctStock({ inventory: [...inventory, entry], units }, entry.id, initial, stockCtx(), "Anfangsbestand");
    await commitStock(result);
    if (fields === newProduct) setNewProduct(emptyProduct);
    return entry;
  }

  // Neue Zählmenge von Hand (nur Artikel ohne Seriennummernpflicht).
  async function setProductStock(id, value) {
    const result = correctStock({ inventory, units }, id, value, stockCtx());
    if (result.movements.length) await commitStock(result);
  }

  // Seriennummernpflicht nur umschalten, solange es nicht zu Widersprüchen
  // kommt: Einschalten bei Bestand 0 (die Exemplare kommen danach über den
  // Wareneingang), Ausschalten nur ohne erfasste Exemplare.
  async function setProductSerialTracked(id, on) {
    const p = inventory.find((x) => x.id === id);
    if (!p) return;
    setInventoryError("");
    if (on && (Number(p.stock) || 0) !== 0) {
      setInventoryError(
        `«${p.name}» hat noch Bestand ${p.stock}. Zuerst auf 0 setzen, dann die Exemplare mit Seriennummer über den Wareneingang erfassen.`
      );
      return;
    }
    if (!on && units.some((u) => u.productId === id)) {
      setInventoryError(`«${p.name}» hat bereits Exemplare mit Seriennummer — die Pflicht lässt sich nicht mehr abschalten.`);
      return;
    }
    cancelPendingInventorySave();
    await persist(KEYS.inventory, inventory.map((x) => (x.id === id ? { ...x, serialTracked: on } : x)), setInventory);
  }

  async function changeStatusOfUnit(unitId, status) {
    const result = changeUnitStatus({ inventory, units }, unitId, status, stockCtx());
    if (result.errors.length) {
      setInventoryError(result.errors.join(" "));
      return;
    }
    setInventoryError("");
    await commitStock(result);
  }

  // Wareneingang: legt Exemplare bzw. Menge an und bucht die Bewegungen.
  // Liefert die Fehlermeldungen zurück (leer = gespeichert).
  async function bookGoodsIn(entry) {
    const result = receiveGoods({ inventory, units }, entry, stockCtx(), checkNewSerials);
    if (result.errors.length) return result.errors;
    const ok = await commitStock(result);
    return ok ? [] : ["Speichern fehlgeschlagen — bitte erneut versuchen."];
  }

  // Sprung aus der Seriennummer-Suche zur Quittung.
  function openReceiptById(id) {
    const r = receipts.find((x) => x.id === id);
    if (r) openReceipt(r);
  }

  // ---- Vorschläge des Assistenten (nur Windows) ----
  const [drafts, setDrafts] = useState([]);
  useEffect(() => {
    if (!desktopAssistant) return;
    const reload = () => desktopAssistant.listDrafts().then(setDrafts);
    reload();
    return desktopAssistant.onDraftsChanged(reload);
  }, []);
  const openDraftCount = drafts.filter((d) => d.status === "offen").length;

  function describeDraftArticle(ref) {
    const p = findArticle(inventory, ref);
    return p ? `${p.name}${p.articleNumber ? ` (${p.articleNumber})` : ""}` : `«${ref}» — nicht im Inventar`;
  }

  function draftAlreadyBooked(draft) {
    if (draft.type === "artikel") return inventory.some((p) => p.sourceDraftId === draft.id);
    return Object.values(movementsByKey).some((list) => list.some((m) => m.ref?.draftId === draft.id));
  }

  // Bucht einen Entwurf. Ist er (z. B. nach einem Absturz zwischen Buchung
  // und Statuswechsel) schon gebucht, wird er nur noch als übernommen markiert.
  async function acceptDraft(draft) {
    if (!draftAlreadyBooked(draft)) {
      if (draft.type === "artikel") {
        const p = draft.payload;
        if (p.articleNumber && inventory.some((x) => (x.articleNumber || "").toLowerCase() === p.articleNumber.toLowerCase())) {
          return [`Artikelnummer ${p.articleNumber} gibt es schon im Inventar.`];
        }
        await addProduct({
          articleNumber: p.articleNumber || "",
          name: p.name,
          group: p.group || "",
          price: p.price,
          stock: "",
          serialTracked: !!p.serialTracked,
          shopText: p.shopText,
          sourceDraftId: draft.id,
        });
      } else {
        const product = findArticle(inventory, draft.payload.article);
        if (!product) {
          return [`Artikel «${draft.payload.article}» ist nicht im Inventar — bitte zuerst anlegen oder den Vorschlag verwerfen.`];
        }
        const serials = draft.payload.serials || [];
        if (isSerialTracked(product) && serials.length === 0) {
          return [`«${product.name}» ist seriennummernpflichtig — der Vorschlag enthält keine Seriennummern.`];
        }
        // Umgekehrt nicht still die Seriennummern verlieren, die der
        // Assistent erfassen sollte.
        if (!isSerialTracked(product) && serials.length > 0) {
          return [
            `«${product.name}» ist nicht seriennummernpflichtig — die Seriennummern im Vorschlag ` +
              `(${serials.join(", ")}) würden verloren gehen. Entweder die Seriennummernpflicht beim ` +
              `Artikel einschalten oder den Vorschlag verwerfen.`,
          ];
        }
        const entry = isSerialTracked(product)
          ? { productId: product.id, serials }
          : { productId: product.id, quantity: draft.payload.quantity };
        const result = receiveGoods(
          { inventory, units },
          { ...entry, purchasePrice: draft.payload.purchasePrice, note: draft.payload.note, draftId: draft.id },
          { ...stockCtx(), source: "assistent" },
          checkNewSerials
        );
        if (result.errors.length) return result.errors;
        if (!(await commitStock(result))) return ["Speichern fehlgeschlagen — bitte erneut versuchen."];
      }
    }
    const r = await desktopAssistant.setDraftStatus(draft.id, "übernommen");
    return r.ok ? [] : [r.error];
  }

  async function rejectDraft(draft) {
    await desktopAssistant.setDraftStatus(draft.id, "verworfen");
  }

  async function updateUnitNote(unitId, note) {
    await commitStock({ inventory, units: units.map((u) => (u.id === unitId ? { ...u, note } : u)) });
  }

  // Beim Tippen in der Inventartabelle nicht bei jedem Zeichen speichern —
  // das wäre ein kompletter Schreibzugriff auf die ganze Liste pro Tastendruck.
  // Die Anzeige aktualisiert sofort, geschrieben wird kurz nach der letzten
  // Eingabe.
  const inventorySaveTimer = useRef(null);
  const pendingInventory = useRef(null);

  function scheduleInventorySave(next) {
    pendingInventory.current = next;
    if (inventorySaveTimer.current) clearTimeout(inventorySaveTimer.current);
    inventorySaveTimer.current = setTimeout(() => {
      inventorySaveTimer.current = null;
      const toSave = pendingInventory.current;
      pendingInventory.current = null;
      if (toSave) persist(KEYS.inventory, toSave, setInventory);
    }, 700);
  }

  // Ausstehende Änderung noch sichern, wenn die Seite geschlossen wird.
  useEffect(() => {
    return () => {
      if (inventorySaveTimer.current) {
        clearTimeout(inventorySaveTimer.current);
        if (pendingInventory.current) {
          window.storage
            .set(KEYS.inventory, JSON.stringify(pendingInventory.current), false)
            .catch((e) => console.error("Inventar-Speichern beim Verlassen fehlgeschlagen", e));
        }
      }
    };
  }, []);

  function updateProduct(id, field, value) {
    const next = inventory.map((p) =>
      p.id === id ? { ...p, [field]: field === "stock" || field === "price" ? Number(value) || 0 : value } : p
    );
    setInventory(next); // sofort sichtbar
    scheduleInventorySave(next); // gebündelt speichern
  }

  async function deleteProduct(id) {
    // Exemplare (und damit Seriennummern verkaufter Queues) dürfen nicht ihren
    // Artikel verlieren — sonst lässt sich ein Garantiefall nicht mehr klären.
    const p = inventory.find((x) => x.id === id);
    if (units.some((u) => u.productId === id)) {
      setInventoryError(`«${p?.name || "Artikel"}» hat Exemplare mit Seriennummer und lässt sich nicht löschen.`);
      return;
    }
    cancelPendingInventorySave();
    await persist(KEYS.inventory, inventory.filter((p) => p.id !== id), setInventory);
  }

  async function exportInventoryExcel() {
    setInventoryBusy(true);
    setInventoryError("");
    try {
      const XLSX = await import("xlsx");
      // Nach Gruppe, dann nach Name — so ist die Excel-Datei direkt sortiert
      // und lässt sich ohne Nacharbeit lesen.
      const rows = [...sortedInventory]
        .sort(
          (a, b) =>
            productGroup(a).localeCompare(productGroup(b), "de-CH", { sensitivity: "base" }) ||
            (a.name || "").localeCompare(b.name || "", "de-CH", { sensitivity: "base" })
        )
        .map((p) => ({
          Produktgruppe: p.group || "",
          Artikelnummer: p.articleNumber || "",
          "Artikel-Name": p.name || "",
          "Stückzahl verfügbar": Number(p.stock) || 0,
          "Preis (CHF)": Number(p.price) || 0,
          Seriennummernpflichtig: isSerialTracked(p) ? "ja" : "nein",
        }));
      const ws = XLSX.utils.json_to_sheet(rows, {
        header: ["Produktgruppe", "Artikelnummer", "Artikel-Name", "Stückzahl verfügbar", "Preis (CHF)", "Seriennummernpflichtig"],
      });
      ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 14 }, { wch: 22 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventar");
      XLSX.writeFile(wb, `Inventar_${todayISO()}.xlsx`);
    } catch (e) {
      console.error("Inventar-Export fehlgeschlagen", e);
      setInventoryError(`Export fehlgeschlagen: ${e.message || "unbekannter Fehler"}`);
    } finally {
      setInventoryBusy(false);
    }
  }

  // Importiert eine Excel-Datei mit denselben Spalten wie der Export. Artikel
  // mit bereits vorhandener Artikelnummer werden aktualisiert statt doppelt
  // angelegt; alles andere kommt neu dazu. Bestehende Artikel, die in der Datei
  // fehlen, bleiben erhalten — ein Import ergänzt, er ersetzt nicht.
  async function importInventoryExcel(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setInventoryBusy(true);
    setInventoryError("");
    try {
      const XLSX = await import("xlsx");
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Die Datei enthält kein Tabellenblatt.");
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const pick = (row, ...names) => {
        for (const n of names) {
          const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
          if (key !== undefined) return row[key];
        }
        return "";
      };

      // Die Stückzahlen aus der Datei werden nicht direkt übernommen, sondern
      // danach als Inventurkorrektur gebucht (targets). Bei
      // seriennummernpflichtigen Artikeln zählt allein die Anzahl Exemplare —
      // ihre Stückzahl in der Datei wird ignoriert.
      const next = [...inventory];
      const targets = new Map();
      let added = 0;
      let updated = 0;
      for (const row of rows) {
        const name = String(pick(row, "Artikel-Name", "Artikelname", "Name")).trim();
        const articleNumber = String(pick(row, "Artikelnummer", "Artikel-Nr.", "Nr.")).trim();
        if (!name && !articleNumber) continue;
        const stock = Number(pick(row, "Stückzahl verfügbar", "Stückzahl", "Bestand")) || 0;
        const price = Number(pick(row, "Preis (CHF)", "Preis")) || 0;
        // Ältere Exportdateien haben keine Gruppenspalte — dann bleibt die
        // bisherige Gruppe des Artikels erhalten statt gelöscht zu werden.
        const hasGroupColumn = Object.keys(row).some((k) =>
          ["produktgruppe", "gruppe", "kategorie"].includes(k.trim().toLowerCase())
        );
        const group = String(pick(row, "Produktgruppe", "Gruppe", "Kategorie")).trim();
        const idx = articleNumber
          ? next.findIndex((p) => (p.articleNumber || "").toLowerCase() === articleNumber.toLowerCase())
          : -1;
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            name: name || next[idx].name,
            group: hasGroupColumn ? group : next[idx].group || "",
            price,
          };
          if (!isSerialTracked(next[idx])) targets.set(next[idx].id, stock);
          updated++;
        } else {
          // Seriennummernpflicht nur bei neuen Artikeln aus der Datei lesen —
          // bei bestehenden würde ein Umschalten die Exemplare durcheinanderbringen.
          const serialTracked = /^(ja|x|1|true)$/i.test(String(pick(row, "Seriennummernpflichtig")).trim());
          const entry = { id: uid(), articleNumber, name, group, stock: 0, price, serialTracked };
          next.push(entry);
          if (!serialTracked) targets.set(entry.id, stock);
          added++;
        }
      }
      if (!added && !updated) {
        throw new Error("Keine gültigen Zeilen gefunden (erwartet: Artikelnummer, Artikel-Name, Stückzahl verfügbar, Preis).");
      }
      let state = { inventory: next, units, movements: [] };
      const ctx = stockCtx();
      for (const [id, target] of targets) {
        const r = correctStock(state, id, target, ctx, "Excel-Import");
        state = { inventory: r.inventory, units: r.units, movements: [...state.movements, ...r.movements] };
      }
      const ok = await commitStock(state);
      setInventoryError(
        ok
          ? ""
          : "Import gelesen, aber Speichern fehlgeschlagen — bitte erneut versuchen."
      );
      if (ok) {
        setSaveStatus(`Inventar importiert: ${added} neu, ${updated} aktualisiert`);
        setTimeout(() => setSaveStatus(""), 4000);
      }
    } catch (err) {
      console.error("Inventar-Import fehlgeschlagen", err);
      setInventoryError(`Import fehlgeschlagen: ${err.message || "unbekannter Fehler"}`);
    } finally {
      setInventoryBusy(false);
    }
  }

  function updateItem(id, field, value) {
    setItems(items.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function addItem() {
    setItems([...items, emptyItem()]);
  }

  function removeItem(id) {
    if (items.length === 1) return;
    setItems(items.filter((it) => it.id !== id));
  }

  // Wechselt eine Position zwischen Dienstleistung und Produkt. Beim Wechsel
  // zurück auf Dienstleistung wird die Artikelnummer entfernt — sie gehört zu
  // einem Inventar-Artikel und wäre sonst eine Karteileiche auf der Rechnung.
  function setItemKind(id, kind) {
    setItems(
      items.map((it) =>
        it.id === id
          ? {
              ...it,
              kind,
              // Die Menge ist bei Dienstleistungen nicht sichtbar — eine vom
              // Produkt übrig gebliebene Menge würde den Preis unbemerkt vervielfachen.
              ...(kind === "service" ? { articleNumber: "", productId: "", unitId: "", serial: "", quantity: "1" } : {}),
            }
          : it
      )
    );
  }

  // Übernimmt einen Inventar-Artikel in die Position: Name, Listenpreis und
  // Artikelnummer. Der Rabatt der Position bleibt bestehen.
  // Ein gewähltes Exemplar gilt nur für diesen Artikel — beim Wechsel des
  // Artikels wird es zurückgesetzt. Seriennummernpflichtige Artikel stehen
  // immer mit Menge 1 auf der Position (ein Exemplar pro Position).
  function pickInventoryItem(id, productId) {
    const p = inventory.find((x) => x.id === productId);
    setItems(
      items.map((it) =>
        it.id === id
          ? p
            ? {
                ...it,
                description: p.name || "",
                amount: String(p.price ?? ""),
                articleNumber: p.articleNumber || "",
                productId: p.id,
                unitId: "",
                serial: "",
                ...(isSerialTracked(p) ? { quantity: "1" } : {}),
              }
            : { ...it, articleNumber: "", productId: "", unitId: "", serial: "" }
          : it
      )
    );
  }

  function pickUnit(id, unitId) {
    const unit = units.find((u) => u.id === unitId);
    setItems(items.map((it) => (it.id === id ? { ...it, unitId: unit ? unit.id : "", serial: unit ? unit.serial : "" } : it)));
  }

  // Artikel einer Position: über productId (ab 1.2.0), sonst wie bisher über
  // die Artikelnummer.
  function productOfItem(it) {
    if (it.productId) return inventory.find((p) => p.id === it.productId) || null;
    if (it.articleNumber) return inventory.find((p) => p.articleNumber && p.articleNumber === it.articleNumber) || null;
    return null;
  }

  // Wählbare Exemplare für eine Position: an Lager oder reserviert, nicht
  // schon in einer anderen Position gewählt. Beim Bearbeiten bleiben die
  // Exemplare wählbar, die diese Quittung selbst verkauft hat.
  function selectableUnits(it, product) {
    const takenElsewhere = new Set(items.filter((x) => x.id !== it.id && x.unitId).map((x) => x.unitId));
    return units
      .filter((u) => u.productId === product.id && !takenElsewhere.has(u.id))
      .filter((u) => isSellable(u) || (editingReceiptId && u.receiptId === editingReceiptId))
      .sort((a, b) => (a.serial || "").localeCompare(b.serial || "", "de-CH"));
  }

  const VAT_RATE = 0.081; // Normalsatz Schweiz für Dienstleistungen, Stand 2026

  // Summiert die Positionen NACH Rabatt — der eingegebene Betrag ist der
  // Listenpreis, verrechnet wird der reduzierte Betrag.
  const enteredSum = items.reduce((sum, it) => sum + itemLineTotal(it), 0);
  const total = round2(enteredSum);
  const discountTotal = round2(items.reduce((sum, it) => sum + itemDiscountAmount(it), 0));
  const listTotal = round2(items.reduce((sum, it) => sum + itemListPrice(it), 0));
  const netTotal = vatEnabled ? round2(total / (1 + VAT_RATE)) : total;
  const vatAmount = vatEnabled ? round2(total - netTotal) : 0;

  function resetForm() {
    setSelectedCustomerId("");
    setManualCustomer(emptyPerson);
    setDate(todayISO());
    setItems([emptyItem()]);
    setNote("");
    setVatEnabled(false);
    setQrBillEnabled(false);
    setPaymentTermDays(DEFAULT_PAYMENT_TERM_DAYS);
    setStockErrors([]);
    setStockWarnings([]);
    setDeliveryMail(null);
    setDeliveryTo(null);
    setDeliveryPrint(false);
  }

  function getActiveCustomer() {
    if (selectedCustomerId) {
      const c = customers.find((c) => c.id === selectedCustomerId);
      if (c) return c;
    }
    return manualCustomer;
  }

  const activeCustomer = getActiveCustomer();
  const deliveryAddress = (deliveryTo ?? activeCustomer.email ?? "").trim();
  const wantsMail = !!desktopMail && (deliveryMail ?? !!deliveryAddress);
  const validItems = items.filter((it) => it.description.trim() && Number(it.amount) > 0);
  const canCreate = activeCustomer.name.trim() && validItems.length > 0;
  const needsAddress = total >= 400;

  // Kunden-ID für den Beleg: gespeicherter Kunde → seine ID; manuell
  // eingetragener Empfänger → eine eigene ID, ohne dass er in der Kundenliste
  // landet. So lässt sich jedes verkaufte Exemplar einem Kunden zuordnen, und
  // der Assistent bekommt nur diese ID statt Name und Adresse.
  function receiptCustomer(existing) {
    // Die E-Mail-Adresse steht nur mit Einverständnis auf dem Beleg.
    if (selectedCustomerId) {
      const c = customers.find((x) => x.id === selectedCustomerId);
      if (c) return withoutUnconsentedEmail({ ...c });
    }
    const keepId = existing && !customers.some((c) => c.id === existing.customer?.id) ? existing.customer?.id : "";
    return withoutUnconsentedEmail({ ...activeCustomer, id: keepId || `m-${uid()}` });
  }

  // Positionen so speichern, wie sie auf dem Beleg stehen: Menge als Zahl,
  // Lagerbezug nur bei Produkten.
  function cleanItems(list) {
    return list.map((it) => {
      const base = { ...it, quantity: itemQuantity(it) };
      if (itemKind(it) !== "product") {
        return { ...base, productId: "", unitId: "", serial: "" };
      }
      const unit = it.unitId ? units.find((u) => u.id === it.unitId) : null;
      return { ...base, serial: unit ? unit.serial : "" };
    });
  }

  function showStockResult(result) {
    setStockErrors(result.errors || []);
    setStockWarnings(result.warnings || []);
    return !(result.errors && result.errors.length);
  }

  async function createReceipt() {
    if (!canCreate) return;
    const stockState = { inventory, units };

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
      const draft = {
        ...existing,
        company: companySnapshot,
        date,
        customer: receiptCustomer(existing),
        items: cleanItems(validItems),
        netTotal,
        vatEnabled,
        vatRate: VAT_RATE,
        vatAmount,
        total,
        qrBillEnabled: isQrBill,
        paymentTermDays,
        paid,
        note,
        editedAt: new Date().toISOString(),
      };
      // Alte Buchung stornieren, neue Fassung buchen — oder gar nichts.
      const booked = rebookReceipt(stockState, existing, draft, stockCtx());
      if (!showStockResult(booked)) return;
      const updated = booked.receipt;
      const next = receipts.map((r) => (r.id === editingReceiptId ? updated : r));
      await commitStock({
        inventory: booked.inventory,
        units: booked.units,
        movements: booked.movements,
        extra: [{ key: KEYS.receipts, value: next, setter: setReceipts }],
      });
      setCurrentReceipt(updated);
      setEditingReceiptId(null);
      setMode("preview");
      return;
    }

    const number = nextReceiptNumber(receipts);
    const isQrBill = qrBillEnabled && isValidSwissIban(company.qrBill?.iban);
    const draft = {
      id: uid(),
      number,
      date,
      customer: receiptCustomer(null),
      items: cleanItems(validItems),
      netTotal,
      vatEnabled,
      vatRate: VAT_RATE,
      vatAmount,
      total,
      qrBillEnabled: isQrBill,
      paymentTermDays,
      paid: !isQrBill,
      note,
      company,
      createdAt: new Date().toISOString(),
    };
    const booked = bookReceipt(stockState, draft, stockCtx());
    if (!showStockResult(booked)) return;
    const receipt = booked.receipt;
    const next = [...receipts, receipt];
    await commitStock({
      inventory: booked.inventory,
      units: booked.units,
      movements: booked.movements,
      extra: [{ key: KEYS.receipts, value: next, setter: setReceipts }],
    });
    setCurrentReceipt(receipt);
    setMode("preview");
    await deliverAfterCreate(receipt, next);
  }

  // Zustellung, die im Formular gewählt wurde (nur Windows).
  async function deliverAfterCreate(receipt, list) {
    setMailState({ state: "idle", to: "", error: "" });
    const print = !!desktopMail && deliveryPrint;
    if (wantsMail && deliveryAddress) await sendReceiptByMail(receipt, deliveryAddress, list);
    // Drucken erst, wenn die Vorschau steht — gedruckt wird die Bildschirmansicht.
    if (print) setTimeout(() => printReceipt(receipt), 400);
  }

  function startEditReceipt(r) {
    // Ab 1.2.0 über die Kunden-ID; ältere Belege kennen nur Name und E-Mail.
    const matchingCustomer =
      customers.find((c) => r.customer.id && c.id === r.customer.id) ||
      customers.find((c) => c.name === r.customer.name && c.email === r.customer.email);
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
    setItems(r.items.map((it) => ({ ...emptyItem(), ...it, quantity: String(itemQuantity(it)), id: uid() })));
    setStockErrors([]);
    setStockWarnings([]);
    setNote(r.note || "");
    setVatEnabled(!!r.vatEnabled);
    setQrBillEnabled(!!r.qrBillEnabled);
    setPaymentTermDays(paymentTermOf(r));
    setEditingReceiptId(r.id);
    setMode("form");
    setTab("new");
  }


  // Löschen storniert die Lagerbuchung der Quittung: Bestand zurück,
  // verkaufte Exemplare wieder "an Lager". Quittungen von vor 1.2.0 haben
  // nichts gebucht, dort ändert sich am Bestand nichts.
  async function deleteReceipt(id) {
    const existing = receipts.find((r) => r.id === id);
    const next = receipts.filter((r) => r.id !== id);
    if (existing && Array.isArray(existing.stockBooking) && existing.stockBooking.length) {
      const reversed = reverseReceipt({ inventory, units }, existing, stockCtx());
      await commitStock({
        inventory: reversed.inventory,
        units: reversed.units,
        movements: reversed.movements,
        extra: [{ key: KEYS.receipts, value: next, setter: setReceipts }],
      });
    } else {
      await persist(KEYS.receipts, next, setReceipts);
    }
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
    setStockWarnings([]);
    setMailState({ state: "idle", to: "", error: "" });
    setCurrentReceipt(r);
    setMode("preview");
  }

  function backToForm() {
    setMailState({ state: "idle", to: "", error: "" });
    setMode("form");
    setCurrentReceipt(null);
    setEditingReceiptId(null);
    resetForm();
  }

  // Betreff und Text der E-Mail. attached: true beim direkten Versand mit
  // PDF-Anhang (Windows), false für mailto:, wo der Anhang von Hand kommt.
  function mailContent(receipt, attached) {
    const word = documentWord(receipt);
    const lines = [
      `Guten Tag ${receipt.customer.name}`,
      "",
      `${attached ? "Im Anhang" : "Anbei"} erhalten Sie die ${word} Nr. ${receipt.number} vom ${formatDateDE(
        receipt.date
      )} über CHF ${chf(receipt.total)}.`,
      "",
      ...(attached
        ? []
        : [
            `Bitte fügen Sie die PDF-${word} dieser E-Mail als Anhang bei`,
            "(Button „Drucken / Als PDF speichern“ → als PDF sichern → hier anhängen).",
            "",
          ]),
      "Freundliche Grüsse",
      receipt.company.name || "",
    ];
    return {
      subject: `${word} Nr. ${receipt.number} – ${receipt.company.name || ""}`,
      text: lines.join("\n"),
    };
  }

  function sendMail() {
    if (!currentReceipt) return;
    const to = currentReceipt.customer.email || "";
    const { subject, text } = mailContent(currentReceipt, false);
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }

  // Versendet die Quittung direkt per SMTP (Windows) und hält das Ergebnis an
  // der Quittung fest — ohne die Adresse, die ohne Einverständnis nirgends
  // gespeichert werden darf. list: die Quittungsliste, in der die Quittung
  // steht (direkt nach dem Erstellen ist der State noch nicht nachgeführt).
  async function sendReceiptByMail(receipt, to, list = receipts) {
    // Ein Tippfehler in der Adresse ist kein Versandversuch — er soll einen
    // früheren erfolgreichen Versand an der Quittung nicht überschreiben.
    if (!isValidEmail(to)) {
      setMailState({ state: "error", to, error: "Die E-Mail-Adresse ist ungültig." });
      return;
    }
    setMailState({ state: "sending", to, error: "" });
    let result;
    try {
      const pdf = await buildReceiptPdfBytes(receipt);
      const { subject, text } = mailContent(receipt, true);
      result = await desktopMail.sendReceipt({
        to,
        subject,
        text,
        filename: `${documentWord(receipt)}_${receipt.number}.pdf`,
        pdf,
      });
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }
    const emailDelivery = result.ok
      ? { status: "gesendet", at: new Date().toISOString() }
      : { status: "fehlgeschlagen", at: new Date().toISOString(), error: result.error };
    const updated = { ...receipt, emailDelivery };
    await persist(KEYS.receipts, list.map((r) => (r.id === receipt.id ? updated : r)), setReceipts);
    setCurrentReceipt((cur) => (cur && cur.id === receipt.id ? updated : cur));
    setMailState(result.ok ? { state: "sent", to, error: "" } : { state: "error", to, error: result.error });
  }

  // receipt: direkt nach dem Erstellen übergeben, weil currentReceipt in
  // diesem Moment noch den alten Stand hat.
  function printReceipt(receipt = currentReceipt) {
    const previousTitle = document.title;
    if (receipt && receipt.number) {
      document.title = `${documentWord(receipt)} ${receipt.number} – ${receipt.customer.name || ""}`.trim();
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
      // Verrechneter Betrag (Menge und Rabatt eingerechnet), wie auf dem Beleg.
      ...receipt.items.map((it) => `${quantityPrefix(it)}${it.description}: CHF ${chf(itemLineTotal(it))}`),
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
        ? `Zahlbar per Rechnung innert ${paymentTermOf(receipt)} ${dayWord(paymentTermOf(receipt))} (Einzahlungsschein siehe PDF).`
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
            <NavItem icon={Package} label="Inventar" active={tab === "inventory"} onClick={() => setTab("inventory")} />
            {desktopShop && (
              <NavItem icon={Store} label="Shop-Anbindung" active={tab === "shop"} onClick={() => setTab("shop")} />
            )}
            {desktopAssistant && (
              <NavItem
                icon={Bot}
                label={openDraftCount ? `Assistent (${openDraftCount})` : "Assistent"}
                active={tab === "assistant"}
                onClick={() => setTab("assistant")}
              />
            )}
            <NavItem icon={Building2} label="Firma" active={tab === "company"} onClick={() => setTab("company")} />
            <NavItem icon={History} label="Verlauf" active={tab === "history"} onClick={() => setTab("history")} />
            <NavItem icon={Wallet} label="Buchhaltung" active={tab === "accounting"} onClick={() => setTab("accounting")} />
            <NavItem icon={RefreshCw} label="Backup" active={tab === "backup"} onClick={() => setTab("backup")} />

            <div style={styles.sidebarFooter}>
              <a
                href="https://github.com/munot-informatik/Qwui"
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

          <main
            style={{
              ...styles.main,
              ...(tab === "accounting" ? { maxWidth: 880 } : {}),
              // Artikeltabelle, Exemplare und Bewegungen brauchen mehr Breite.
              ...(tab === "inventory" ? { maxWidth: 1040 } : {}),
              ...(tab === "shop" || tab === "assistant" ? { maxWidth: 880 } : {}),
            }}
          >
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
                      {manualCustomer.email && <ConsentCheckbox person={manualCustomer} onChange={setManualCustomer} />}
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
                  <div style={{ display: "grid", gap: 14 }}>
                    {items.map((it) => {
                      const kind = itemKind(it);
                      const disc = itemDiscountPercent(it);
                      const product = kind === "product" ? productOfItem(it) : null;
                      const serialTracked = isSerialTracked(product);
                      return (
                        <div key={it.id} style={styles.itemCard}>
                          <div style={styles.itemRow}>
                            <KindToggle
                              kind={kind}
                              onChange={(k) => setItemKind(it.id, k)}
                            />
                            <input
                              placeholder="Beschreibung"
                              value={it.description}
                              onChange={(e) => updateItem(it.id, "description", e.target.value)}
                              style={{ flex: 1, minWidth: 120 }}
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
                                title={kind === "product" ? "Listenpreis pro Stück" : "Preis"}
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

                          <div style={styles.itemMetaRow}>
                            {kind === "product" && (
                              <label style={styles.itemMetaField}>
                                <span style={styles.itemMetaLabel}>Artikel</span>
                                <select
                                  value={product?.id || ""}
                                  onChange={(e) => pickInventoryItem(it.id, e.target.value)}
                                  style={{ ...styles.select, width: "auto", minWidth: 190 }}
                                  disabled={sortedInventory.length === 0}
                                >
                                  <option value="">
                                    {sortedInventory.length === 0 ? "— Inventar ist leer —" : "— aus Inventar wählen —"}
                                  </option>
                                  {/* Nach Produktgruppe gebündelt, damit die
                                      Auswahl auch bei vielen Artikeln
                                      überschaubar bleibt. */}
                                  {inventoryByGroup.map(({ group, items: groupItems }) => (
                                    <optgroup key={group} label={group}>
                                      {groupItems.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.articleNumber ? `${p.articleNumber} · ` : ""}
                                          {p.name} — CHF {chf(p.price)} · {productStock(p, units)} an Lager
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </label>
                            )}

                            {product && serialTracked && (
                              <label style={styles.itemMetaField}>
                                <span style={styles.itemMetaLabel}>Seriennummer</span>
                                <select
                                  value={it.unitId || ""}
                                  onChange={(e) => pickUnit(it.id, e.target.value)}
                                  style={{
                                    ...styles.select,
                                    width: "auto",
                                    minWidth: 170,
                                    ...(it.unitId ? {} : { borderColor: "#B5480C" }),
                                  }}
                                  aria-label="Exemplar wählen"
                                >
                                  <option value="">
                                    {selectableUnits(it, product).length === 0 ? "— kein Exemplar an Lager —" : "— Exemplar wählen —"}
                                  </option>
                                  {selectableUnits(it, product).map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.serial}
                                      {u.status === UNIT_STATUS.reserved ? " (reserviert)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}

                            {kind === "product" && !serialTracked && (
                              <label style={styles.itemMetaField}>
                                <span style={styles.itemMetaLabel}>Menge</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={it.quantity ?? "1"}
                                  onChange={(e) => updateItem(it.id, "quantity", e.target.value)}
                                  className="mono"
                                  style={{ width: 62, textAlign: "right" }}
                                  aria-label="Menge"
                                />
                              </label>
                            )}

                            <label style={styles.itemMetaField}>
                              <span style={styles.itemMetaLabel}>Rabatt</span>
                              <span style={styles.discountWrap}>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  placeholder="0"
                                  value={it.discountPercent ?? ""}
                                  onChange={(e) => updateItem(it.id, "discountPercent", e.target.value)}
                                  className="mono"
                                  style={{ width: 62, textAlign: "right" }}
                                />
                                <span style={styles.chfLabel}>%</span>
                              </span>
                            </label>

                            {(disc > 0 || itemQuantity(it) !== 1) && itemListPrice(it) > 0 && (
                              <span style={styles.itemLineSummary}>
                                {disc > 0 && (
                                  <>
                                    <span style={styles.strikePrice} className="mono">CHF {chf(itemListPrice(it))}</span>
                                    <span style={styles.discountBadge}>−{formatPercent(disc)} %</span>
                                  </>
                                )}
                                <span className="mono" style={{ fontWeight: 700 }}>CHF {chf(itemLineTotal(it))}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={addItem} style={styles.dashedBtn}>
                      <Plus size={14} /> Position hinzufügen
                    </button>
                  </div>

                  {discountTotal > 0 && (
                    <div style={styles.discountSummary}>
                      <div style={styles.vatBreakdownRow}>
                        <span>Zwischensumme (Listenpreise)</span>
                        <span className="mono">CHF {chf(listTotal)}</span>
                      </div>
                      <div style={styles.vatBreakdownRow}>
                        <span>Rabatt</span>
                        <span className="mono" style={{ color: "#1D7A3C" }}>− CHF {chf(discountTotal)}</span>
                      </div>
                    </div>
                  )}

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

                  {qrBillEnabled && (
                    <div style={styles.paymentTermRow}>
                      <span style={styles.paymentTermLabel}>Zahlbar innert</span>
                      <select
                        value={paymentTermDays}
                        onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                        style={styles.paymentTermSelect}
                        aria-label="Zahlungsfrist in Tagen"
                      >
                        {PAYMENT_TERM_OPTIONS.map((d) => (
                          <option key={d} value={d}>
                            {d} {dayWord(d)}
                          </option>
                        ))}
                      </select>
                      <span style={styles.paymentTermLabel}>ab Rechnungsdatum</span>
                    </div>
                  )}

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

                {desktopMail && !editingReceiptId && (
                  <FieldGroup label="Nach dem Erstellen">
                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={styles.checkLabel}>
                        <input type="checkbox" checked={wantsMail} onChange={(e) => setDeliveryMail(e.target.checked)} />
                        Per E-Mail senden (PDF im Anhang)
                      </label>
                      {wantsMail && (
                        <input
                          placeholder="E-Mail-Adresse für diesen Versand"
                          value={deliveryTo ?? activeCustomer.email ?? ""}
                          onChange={(e) => setDeliveryTo(e.target.value)}
                          style={{ maxWidth: 360 }}
                          aria-label="E-Mail-Adresse für den Versand"
                        />
                      )}
                      {wantsMail && !hasEmailConsent(activeCustomer) && (
                        <div style={styles.muted}>
                          Ohne Einverständnis «E-Mail-Beleg» wird die Adresse nur für diesen Versand verwendet und nicht gespeichert.
                        </div>
                      )}
                      <label style={styles.checkLabel}>
                        <input type="checkbox" checked={deliveryPrint} onChange={(e) => setDeliveryPrint(e.target.checked)} />
                        Drucken
                      </label>
                    </div>
                  </FieldGroup>
                )}

                {stockErrors.length > 0 && (
                  <div style={{ ...styles.hint, marginBottom: 12 }} role="alert">
                    {stockErrors.map((m, i) => (
                      <div key={i}>{m}</div>
                    ))}
                  </div>
                )}

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
                  {newCustomer.email && <ConsentCheckbox person={newCustomer} onChange={setNewCustomer} />}
                  <input
                    placeholder="Telefon (für WhatsApp, z.B. +41 79 123 45 67)"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                  <button onClick={addCustomer} style={styles.secondaryBtn}>
                    <Plus size={14} /> Kunde speichern
                  </button>
                  {customerNotice && <div style={styles.hint}>{customerNotice}</div>}
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
                          {hasEmailConsent(c) && c.email && (
                            <div style={styles.muted}>Einverständnis E-Mail-Beleg seit {formatDateDE(c.emailConsent.at)}</div>
                          )}
                          {hasLegacyEmailWithoutConsent(c) && (
                            <div style={{ ...styles.muted, color: "#B5480C" }}>
                              Einverständnis E-Mail-Beleg fehlt —{" "}
                              <button type="button" style={styles.linkBtn} onClick={() => setCustomerConsent(c.id, true)}>
                                erfassen
                              </button>{" "}
                              oder{" "}
                              <button type="button" style={styles.linkBtn} onClick={() => setCustomerConsent(c.id, false)}>
                                Adresse entfernen
                              </button>
                            </div>
                          )}
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

            {tab === "inventory" && (
              <div style={styles.panel}>
                <Eyebrow>03 — Inventar</Eyebrow>
                <h1 style={styles.h1}>Inventar</h1>
                <div style={{ fontSize: 13, color: "#5B5F66", marginBottom: 20, maxWidth: 520 }}>
                  Artikel, die sich beim Erstellen einer Rechnung als Position „Produkt"
                  auswählen lassen. Die Liste ist alphabetisch sortiert. Jeder Verkauf,
                  Wareneingang und jede Korrektur wird als Lagerbewegung festgehalten.
                </div>

                <OptionGroup
                  value={inventoryView}
                  onChange={setInventoryView}
                  ariaLabel="Bereich im Inventar"
                  options={[
                    ["articles", "Artikel"],
                    ["goodsIn", "Wareneingang"],
                    ["serials", "Seriennummer suchen"],
                    ["movements", "Lagerbewegungen"],
                  ]}
                />
                {persistError && inventoryView !== "articles" && <div style={styles.hint}>{persistError}</div>}

                {inventoryView === "goodsIn" && (
                  <div style={{ marginTop: 20 }}>
                    <Wareneingang
                      inventory={inventory}
                      units={units}
                      groups={inventoryGroups.filter((g) => g !== UNGROUPED_LABEL)}
                      onBook={bookGoodsIn}
                      onCreateProduct={addProduct}
                    />
                  </div>
                )}

                {inventoryView === "serials" && (
                  <div style={{ marginTop: 20 }}>
                    <SeriennummerSuche
                      units={units}
                      inventory={inventory}
                      customerName={unitCustomerName}
                      onOpenReceipt={openReceiptById}
                    />
                  </div>
                )}

                {inventoryView === "movements" && (
                  <div style={{ marginTop: 20 }}>
                    <Lagerbewegungen movementsByKey={movementsByKey} inventory={inventory} onOpenReceipt={openReceiptById} />
                  </div>
                )}

                {inventoryView === "articles" && (
                <>
                <div style={{ height: 20 }} />
                <FieldGroup label="Neuen Artikel erfassen">
                  <div style={styles.inventoryForm}>
                    <input
                      placeholder="Artikelnummer"
                      value={newProduct.articleNumber}
                      onChange={(e) => setNewProduct({ ...newProduct, articleNumber: e.target.value })}
                      style={{ width: 130 }}
                    />
                    <input
                      placeholder="Artikel-Name"
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                      style={{ flex: 1, minWidth: 160 }}
                    />
                    {/* Freies Feld mit Vorschlägen: bestehende Gruppen lassen
                        sich per Klick übernehmen, neue einfach eintippen. */}
                    <input
                      placeholder="Produktgruppe"
                      list="produktgruppen"
                      value={newProduct.group}
                      onChange={(e) => setNewProduct({ ...newProduct, group: e.target.value })}
                      style={{ width: 150 }}
                    />
                    {!newProduct.serialTracked && (
                      <input
                        placeholder="Stück"
                        type="number"
                        min="0"
                        step="1"
                        value={newProduct.stock}
                        onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                        className="mono"
                        style={{ width: 80, textAlign: "right" }}
                      />
                    )}
                    <div style={styles.amountWrap}>
                      <span className="mono" style={styles.chfLabel}>CHF</span>
                      <input
                        placeholder="0.00"
                        type="number"
                        min="0"
                        step="0.01"
                        value={newProduct.price}
                        onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        className="mono"
                        style={{ width: 90, textAlign: "right" }}
                      />
                    </div>
                    <label style={styles.checkLabel} title="Einzelstücke mit eigener Seriennummer, z. B. hochpreisige Queues">
                      <input
                        type="checkbox"
                        checked={!!newProduct.serialTracked}
                        onChange={(e) => setNewProduct({ ...newProduct, serialTracked: e.target.checked })}
                      />
                      Seriennummernpflichtig
                    </label>
                    <button
                      onClick={() => addProduct()}
                      disabled={!newProduct.name.trim()}
                      style={{ ...styles.secondaryBtn, opacity: newProduct.name.trim() ? 1 : 0.4 }}
                    >
                      <Plus size={14} /> Hinzufügen
                    </button>
                  </div>
                  {newProduct.serialTracked && (
                    <div style={{ ...styles.muted, marginTop: 6 }}>
                      Der Bestand ergibt sich aus den Exemplaren — Seriennummern danach im Wareneingang scannen.
                    </div>
                  )}
                </FieldGroup>

                <FieldGroup label="Excel">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={exportInventoryExcel}
                      style={styles.secondaryBtn}
                      disabled={inventoryBusy || inventory.length === 0}
                    >
                      <Download size={14} /> Inventar exportieren
                    </button>
                    <label style={{ ...styles.secondaryBtn, opacity: inventoryBusy ? 0.6 : 1 }}>
                      <Upload size={14} /> Aus Excel importieren
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={importInventoryExcel}
                        disabled={inventoryBusy}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                  <div style={styles.helpToggleRow}>
                    <button
                      type="button"
                      onClick={toggleImportHelp}
                      style={styles.linkBtn}
                      aria-expanded={showImportHelp}
                      aria-controls="import-anleitung"
                    >
                      {showImportHelp ? "Anleitung ausblenden" : "Anleitung anzeigen"}
                    </button>
                    {!showImportHelp && (
                      <span style={{ fontSize: 12, color: "#8B8F96" }}>
                        Spalten: Produktgruppe · Artikelnummer · Artikel-Name · Stückzahl verfügbar · Preis (CHF) · Seriennummernpflichtig (optional)
                      </span>
                    )}
                  </div>

                  {showImportHelp && (
                    <div
                      id="import-anleitung"
                      style={{ ...styles.hint, background: "#F1F1EF", color: "#5B5F66", marginTop: 8 }}
                    >
                      So muss die Datei aufgebaut sein — Spaltentitel in Zeile 1, ab Zeile 2 die Artikel:
                      <ExcelLayoutHint />
                      Beim Import werden Artikel mit bereits vorhandener Artikelnummer aktualisiert,
                      alle anderen neu angelegt — bestehende Artikel gehen nicht verloren.
                      Fehlt die Spalte „Produktgruppe" (ältere Datei), bleibt die bisherige Gruppe erhalten.
                    </div>
                  )}
                  {inventoryError && <div style={styles.hint}>{inventoryError}</div>}
                  {saveStatus && <div style={styles.savedMsg}>{saveStatus}</div>}
                </FieldGroup>

                <div style={{ marginTop: 8 }}>
                  {/* Vorschlagsliste für alle Gruppenfelder */}
                  <datalist id="produktgruppen">
                    {inventoryGroups
                      .filter((g) => g !== UNGROUPED_LABEL)
                      .map((g) => (
                        <option key={g} value={g} />
                      ))}
                  </datalist>

                  {inventory.length === 0 ? (
                    <EmptyState text="Noch keine Artikel im Inventar." />
                  ) : (
                    <>
                      <div style={styles.invFilterRow}>
                        <input
                          placeholder="Suchen (Name, Artikelnummer, Gruppe)"
                          value={inventorySearch}
                          onChange={(e) => setInventorySearch(e.target.value)}
                          style={{ flex: 1, minWidth: 200 }}
                          aria-label="Inventar durchsuchen"
                        />
                        <select
                          value={inventoryGroupFilter}
                          onChange={(e) => setInventoryGroupFilter(e.target.value)}
                          style={{ ...styles.select, width: "auto", minWidth: 170 }}
                          aria-label="Nach Produktgruppe filtern"
                        >
                          <option value="">Alle Gruppen ({inventory.length})</option>
                          {inventoryGroups.map((g) => (
                            <option key={g} value={g}>
                              {g} ({inventory.filter((p) => productGroup(p) === g).length})
                            </option>
                          ))}
                        </select>
                        {(inventorySearch || inventoryGroupFilter) && (
                          <button
                            type="button"
                            onClick={() => {
                              setInventorySearch("");
                              setInventoryGroupFilter("");
                            }}
                            style={styles.linkBtn}
                          >
                            Filter zurücksetzen
                          </button>
                        )}
                      </div>

                      <div style={styles.invHeaderRow}>
                        <span style={{ width: 120 }}>Artikelnr.</span>
                        <span style={{ flex: 1 }}>Artikel-Name</span>
                        <span style={{ width: 150 }}>Gruppe</span>
                        <span style={{ width: 80, textAlign: "right" }}>Stück</span>
                        <span style={{ width: 110, textAlign: "right" }}>Preis</span>
                        <span style={{ width: 90, textAlign: "center" }}>S/N-Pflicht</span>
                        <span style={{ width: 34 }} />
                      </div>
                      {visibleInventory.length === 0 && (
                        <div style={{ ...styles.empty, padding: "16px 0" }}>
                          Kein Artikel passt zu Suche/Filter.
                        </div>
                      )}
                      {visibleInventory.map((p) => (
                        <React.Fragment key={p.id}>
                        <div style={styles.invRow}>
                          <input
                            value={p.articleNumber || ""}
                            onChange={(e) => updateProduct(p.id, "articleNumber", e.target.value)}
                            className="mono"
                            style={{ width: 120 }}
                            aria-label="Artikelnummer"
                          />
                          <input
                            value={p.name || ""}
                            onChange={(e) => updateProduct(p.id, "name", e.target.value)}
                            style={{ flex: 1, minWidth: 140 }}
                            aria-label="Artikel-Name"
                          />
                          <input
                            value={p.group || ""}
                            list="produktgruppen"
                            placeholder="—"
                            onChange={(e) => updateProduct(p.id, "group", e.target.value)}
                            style={{ width: 150 }}
                            aria-label="Produktgruppe"
                          />
                          <StockCell product={p} units={units} onCommit={(value) => setProductStock(p.id, value)} />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={p.price ?? 0}
                            onChange={(e) => updateProduct(p.id, "price", e.target.value)}
                            className="mono"
                            style={{ width: 110, textAlign: "right" }}
                            aria-label="Preis"
                          />
                          <span style={{ width: 90, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={isSerialTracked(p)}
                              onChange={(e) => setProductSerialTracked(p.id, e.target.checked)}
                              aria-label="Seriennummernpflichtig"
                            />
                            {isSerialTracked(p) && (
                              <button type="button" style={styles.linkBtn} onClick={() => toggleUnitList(p.id)}>
                                {openUnitLists.has(p.id) ? "zu" : "Exemplare"}
                              </button>
                            )}
                          </span>
                          <ConfirmDeleteButton label="" onConfirm={() => deleteProduct(p.id)} />
                        </div>
                        {isSerialTracked(p) && openUnitLists.has(p.id) && (
                          <UnitList
                            product={p}
                            units={units}
                            customerName={unitCustomerName}
                            onStatus={changeStatusOfUnit}
                            onNote={updateUnitNote}
                            onOpenReceipt={openReceiptById}
                          />
                        )}
                        </React.Fragment>
                      ))}
                      <div style={styles.invFooter}>
                        {visibleInventory.length === inventory.length
                          ? `${inventory.length} Artikel`
                          : `${visibleInventory.length} von ${inventory.length} Artikeln`}{" "}
                        · {inventoryGroups.length} Gruppe{inventoryGroups.length === 1 ? "" : "n"} · Lagerwert{" "}
                        <span className="mono">
                          CHF{" "}
                          {chf(
                            visibleInventory.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.stock) || 0), 0)
                          )}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                </>
                )}
              </div>
            )}

            {tab === "company" && (
              <div style={styles.panel}>
                <Eyebrow>04 — Firma</Eyebrow>
                <h1 style={styles.h1}>Firmendaten</h1>

                <div style={{ marginBottom: 28, maxWidth: 420 }}>
                  <div style={styles.fieldLabel}>Firmenlogo</div>
                  <div style={{ fontSize: 12, color: "#8B8F96", marginBottom: 12 }}>
                    Erscheint im Kopf von Quittung/Rechnung (PDF und Druck). Ein Bild mit
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

                  {companyDraft.logoDataUrl && (
                    <div style={styles.logoOptions}>
                      <div style={styles.logoOptionRow}>
                        <span style={styles.itemMetaLabel}>Anordnung</span>
                        <OptionGroup
                          value={logoLayoutOf(companyDraft)}
                          options={[
                            ["inline", "Neben dem Text"],
                            ["above", "Über dem Text"],
                          ]}
                          onChange={(v) => setCompanyDraft({ ...companyDraft, logoLayout: v })}
                          ariaLabel="Logo-Anordnung"
                        />
                      </div>
                      {/* Ausrichtung ist nur sinnvoll, wenn das Logo eine eigene
                          Zeile hat — neben dem Text steht es immer links. */}
                      {logoLayoutOf(companyDraft) === "above" && (
                        <div style={styles.logoOptionRow}>
                          <span style={styles.itemMetaLabel}>Ausrichtung</span>
                          <OptionGroup
                            value={logoAlignOf(companyDraft)}
                            options={[
                              ["left", "Links"],
                              ["center", "Mittig"],
                              ["right", "Rechts"],
                            ]}
                            onChange={(v) => setCompanyDraft({ ...companyDraft, logoPosition: v })}
                            ariaLabel="Logo-Ausrichtung"
                          />
                        </div>
                      )}
                      <div style={styles.logoOptionRow}>
                        <span style={styles.itemMetaLabel}>Grösse</span>
                        <OptionGroup
                          value={companyDraft.logoSize || "medium"}
                          options={[
                            ["small", "Klein"],
                            ["medium", "Mittel"],
                            ["large", "Gross"],
                          ]}
                          onChange={(v) => setCompanyDraft({ ...companyDraft, logoSize: v })}
                          ariaLabel="Logo-Grösse"
                        />
                      </div>
                      <LogoLayoutPreview
                        layout={logoLayoutOf(companyDraft)}
                        align={logoAlignOf(companyDraft)}
                        size={companyDraft.logoSize || "medium"}
                        logoDataUrl={companyDraft.logoDataUrl}
                      />
                      <button onClick={saveCompany} style={{ ...styles.secondaryBtn, marginTop: 4 }}>
                        <Check size={14} /> Speichern
                      </button>
                    </div>
                  )}
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

                {/* Nur in der Windows-Version vorhanden (window.qwuiDesktop). */}
                <EmailEinstellungen />
              </div>
            )}

            {tab === "history" && (
              <div style={styles.panel}>
                <Eyebrow>05 — Verlauf</Eyebrow>
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
                          {r.emailDelivery ? ` · E-Mail ${r.emailDelivery.status}` : ""}
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

            {tab === "assistant" && desktopAssistant && (
              <div style={styles.panel}>
                <Eyebrow>Assistent</Eyebrow>
                <h1 style={styles.h1}>Vorschläge des Assistenten</h1>
                <Vorschlaege drafts={drafts} describeArticle={describeDraftArticle} onAccept={acceptDraft} onReject={rejectDraft} />
                <h2 style={{ ...styles.h1, fontSize: 20, marginTop: 40 }}>Lokale Schnittstelle</h2>
                <Schnittstelle />
              </div>
            )}

            {tab === "shop" && desktopShop && (
              <div style={styles.panel}>
                <Eyebrow>Shop-Anbindung</Eyebrow>
                <h1 style={styles.h1}>Bestand und Preise für den Shop</h1>
                <ShopAnbindung />
              </div>
            )}

            {tab === "accounting" && (
              <div style={styles.panel}>
                <BuchhaltungTab receipts={receipts} onTogglePaid={togglePaid} />
              </div>
            )}

            {tab === "backup" && (
              <div style={styles.panel}>
                <Eyebrow>07 — Backup</Eyebrow>
                <h1 style={styles.h1}>Backup & Datenübertragung</h1>
                <div style={{ fontSize: 13, color: "#5B5F66", marginBottom: 24, maxWidth: 480 }}>
                  Exportiert Firma, alle Kunden, alle Quittungen/Rechnungen, das Inventar
                  samt Exemplaren und das Protokoll der Lagerbewegungen als eine
                  einzelne Datei — z. B. um sie in die andere Qwui-Version zu übertragen
                  (Web ↔ Windows), oder einfach als Sicherungskopie in einem
                  Cloud-Speicher deiner Wahl (z. B. ProtonDrive, OneDrive) abzulegen.
                </div>

                <FieldGroup label="Exportieren">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={exportAllData} style={styles.secondaryBtn}>
                      <Download size={14} /> Alle Daten exportieren
                    </button>
                    {desktopBackup && (
                      <button onClick={exportEvaluation} style={styles.secondaryBtn}>
                        <Download size={14} /> Excel-Auswertung erstellen
                      </button>
                    )}
                  </div>
                  {desktopBackup && (
                    <div style={{ ...styles.muted, marginTop: 6 }}>
                      Die Excel-Auswertung (Kunden, Zahlungen, Inventar, Exemplare, Lagerbewegungen) ist zum Ansehen und
                      Weitergeben — Änderungen darin fliessen nicht zurück in Qwui.
                    </div>
                  )}
                  {evaluationStatus && <div style={{ ...styles.savedMsg, marginTop: 6 }}>{evaluationStatus}</div>}
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
                      accept="application/json,.json,.qwuibak"
                      onChange={handleImportFileSelect}
                      disabled={importing}
                      style={{ display: "none" }}
                    />
                  </label>
                  {importError && <div style={styles.hint}>{importError}</div>}
                  {saveStatus && <div style={{ ...styles.savedMsg, marginTop: 8 }}>{saveStatus}</div>}
                  {encryptedImport && (
                    <div style={{ ...styles.importPreviewBox, display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{encryptedImport.name}</strong> ist verschlüsselt. Bitte das Backup-Passwort eingeben.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="password"
                          value={encryptedImport.password}
                          onChange={(e) => setEncryptedImport({ ...encryptedImport, password: e.target.value, error: "" })}
                          onKeyDown={(e) => e.key === "Enter" && encryptedImport.password && decryptImport()}
                          placeholder="Backup-Passwort"
                          style={{ flex: 1 }}
                          aria-label="Backup-Passwort zum Wiederherstellen"
                          autoFocus
                        />
                        <button
                          onClick={decryptImport}
                          disabled={!encryptedImport.password}
                          style={{ ...styles.secondaryBtnSmall, opacity: encryptedImport.password ? 1 : 0.4 }}
                        >
                          Entschlüsseln
                        </button>
                        <button onClick={() => setEncryptedImport(null)} style={styles.linkBtn}>
                          Abbrechen
                        </button>
                      </div>
                      {encryptedImport.error && <div style={styles.hint}>{encryptedImport.error}</div>}
                    </div>
                  )}
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
                      {Array.isArray(importPreview.serialUnits) && `, ${importPreview.serialUnits.length} Exemplare mit Seriennummer`}
                    </div>
                    {!Array.isArray(importPreview.serialUnits) && (units.length > 0 || Object.keys(movementsByKey).length > 0) && (
                      <div style={{ ...styles.hint, marginBottom: 10 }}>
                        Diese Sicherung stammt aus einer Version vor 1.2.0 und enthält keine Exemplare
                        und Lagerbewegungen. Die vorhandenen bleiben erhalten — Bestand, Exemplare und
                        Quittungen passen danach unter Umständen nicht mehr zusammen. Bitte nach dem
                        Import im Inventar prüfen.
                      </div>
                    )}
                    {importPreview.exportedAt && (
                      <div style={{ fontSize: 12, color: "#8B8F96", marginBottom: 12 }}>
                        Exportiert am {formatDateDE(importPreview.exportedAt.slice(0, 10))}
                      </div>
                    )}
                    {importPreview.settings && desktopBackup && (
                      <div style={{ fontSize: 12, color: "#5B5F66", marginBottom: 12 }}>
                        Enthält Einstellungen (E-Mail-Versand, Sicherung) — sie werden übernommen. Passwörter
                        sind nicht enthalten und müssen neu eingegeben werden.
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

                {/* Nur in der Windows-Version vorhanden (window.qwuiDesktop). */}
                <BackupAutomatik />
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
              <button onClick={() => printReceipt()} style={styles.secondaryBtn}>
                Drucken
              </button>
              {canShareFiles && (
                <button onClick={sharePdf} style={styles.secondaryBtn} disabled={sharing}>
                  <Share2 size={14} /> {sharing ? "Bereite vor…" : "Teilen"}
                </button>
              )}
              {desktopMail ? (
                <button
                  onClick={() => setMailState({ state: "form", to: currentReceipt.customer.email || "", error: "" })}
                  style={styles.primaryBtnSmall}
                  disabled={mailState.state === "sending"}
                >
                  <Mail size={14} /> {mailState.state === "sending" ? "Sende…" : "Per E-Mail senden"}
                </button>
              ) : (
                <button
                  onClick={sendMail}
                  style={styles.primaryBtnSmall}
                  disabled={!currentReceipt.customer.email}
                  title={!currentReceipt.customer.email ? "Keine E-Mail-Adresse hinterlegt" : ""}
                >
                  <Mail size={14} /> Per E-Mail senden
                </button>
              )}
              <button onClick={sendWhatsApp} style={styles.whatsappBtn}>
                <MessageCircle size={14} /> Per WhatsApp senden
              </button>
            </div>
          </div>
          {stockWarnings.length > 0 && (
            <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 12px" }} role="status">
              {stockWarnings.map((m, i) => (
                <div key={i}>{m}</div>
              ))}
            </div>
          )}
          {desktopMail && (mailState.state !== "idle" || currentReceipt.emailDelivery) && (
            <div className="no-print" style={styles.mailBox}>
              {(mailState.state === "form" || mailState.state === "error") && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={mailState.to}
                    onChange={(e) => setMailState({ ...mailState, to: e.target.value })}
                    placeholder="E-Mail-Adresse"
                    style={{ flex: 1, minWidth: 220 }}
                    aria-label="Empfänger"
                    autoFocus
                  />
                  <button
                    onClick={() => sendReceiptByMail(currentReceipt, mailState.to.trim())}
                    disabled={!mailState.to.trim()}
                    style={{ ...styles.primaryBtnSmall, opacity: mailState.to.trim() ? 1 : 0.4 }}
                  >
                    <Mail size={14} /> Senden
                  </button>
                  <button onClick={() => setMailState({ state: "idle", to: "", error: "" })} style={styles.linkBtn}>
                    Abbrechen
                  </button>
                </div>
              )}
              {mailState.state === "sending" && <div style={styles.muted}>Sende an {mailState.to}…</div>}
              {mailState.state === "sent" && <div style={styles.savedMsg}>Gesendet an {mailState.to}.</div>}
              {mailState.state === "error" && <div style={styles.hint}>Versand fehlgeschlagen: {mailState.error}</div>}
              {mailState.state === "idle" && currentReceipt.emailDelivery && (
                <div style={currentReceipt.emailDelivery.status === "gesendet" ? styles.savedMsg : styles.hint}>
                  E-Mail {currentReceipt.emailDelivery.status} am {formatDateTimeDE(currentReceipt.emailDelivery.at)}
                  {currentReceipt.emailDelivery.error ? ` — ${currentReceipt.emailDelivery.error}` : ""}
                </div>
              )}
            </div>
          )}
          {!desktopMail && !currentReceipt.customer.email && (
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
          {!desktopMail && (
          <div className="no-print" style={{ ...styles.hint, maxWidth: 640, margin: "0 auto 8px" }}>
            Hinweis: „Per E-Mail senden" öffnet dein E-Mail-Programm mit vorausgefülltem Text. Da Browser aus
            Sicherheitsgründen keine automatischen Anhänge erlauben, lade die Quittung zuerst über den Button
            „PDF herunterladen" herunter und hänge sie manuell an
            {canShareFiles ? ' — oder nutze stattdessen „Teilen" (siehe unten).' : "."}
          </div>
          )}
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
  const company = receipt.company || {};
  const logoLayout = logoLayoutOf(company);
  const logoAlign = logoAlignOf(company);
  const logoHeights = { small: 26, medium: 38, large: 52 };
  const logoStyle = { ...styles.docLogo, height: logoHeights[company.logoSize] || logoHeights.medium };

  const companyBlock = (
    <div>
      <div style={styles.docCompanyName}>{company.name || "Firma"}</div>
      <div style={styles.docMuted}>{company.address}</div>
      <div style={styles.docMuted}>{company.zipCity}</div>
      <div style={styles.docMuted}>{company.email}</div>
      <div style={styles.docMuted}>{company.phone}</div>
      {company.vatNumber && <div style={styles.docMuted}>MWST-Nr. {company.vatNumber}</div>}
    </div>
  );
  const titleBlock = (
    <div style={{ textAlign: "right" }}>
      <div style={styles.docTitle}>{receipt.qrBillEnabled ? "RECHNUNG" : "QUITTUNG"}</div>
      <div className="mono" style={styles.docNumber}>Nr. {receipt.number}</div>
      <div className="mono" style={styles.docMuted}>{formatDateDE(receipt.date)}</div>
    </div>
  );

  return (
    <div className="print-area" style={styles.document}>
      {/* Bei mittiger/rechter Position steht das Logo auf einer eigenen Zeile
          über dem Kopf, sonst käme es mit dem Titelblock rechts ins Gehege. */}
      {company.logoDataUrl && logoLayout === "above" && (
        <div
          style={{
            display: "flex",
            justifyContent:
              logoAlign === "center" ? "center" : logoAlign === "right" ? "flex-end" : "flex-start",
            marginBottom: 26,
          }}
        >
          <img src={company.logoDataUrl} alt="" style={logoStyle} />
        </div>
      )}
      <div style={styles.docHeader}>
        <div style={styles.docHeaderLeft}>
          {company.logoDataUrl && logoLayout === "inline" && (
            <img src={company.logoDataUrl} alt="" style={logoStyle} />
          )}
          {companyBlock}
        </div>
        {titleBlock}
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
            {receipt.items.map((it) => {
              const disc = itemDiscountPercent(it);
              const isProduct = itemKind(it) === "product";
              return (
                <tr key={it.id} style={{ borderBottom: "1px solid #EDEEEF" }}>
                  <td style={{ padding: "6px 0", fontSize: 13 }}>
                    {quantityPrefix(it)}
                    {it.description}
                    {isProduct && it.articleNumber && (
                      <span className="mono" style={styles.docArticleNr}> · {it.articleNumber}</span>
                    )}
                    {itemQuantity(it) !== 1 && (
                      <span className="mono" style={styles.docArticleNr}> · à CHF {chf(itemUnitPrice(it))}</span>
                    )}
                    {it.serial && (
                      <div className="mono" style={styles.docArticleNr}>
                        S/N: {it.serial}
                      </div>
                    )}
                  </td>
                  {/* Beim Produkt zusätzlich der durchgestrichene Listenpreis —
                      bei der Dienstleistung nur Rabatt und neuer Preis. */}
                  <td className="mono" style={styles.docListPriceCell}>
                    {disc > 0 && isProduct ? (
                      <span style={styles.docStrike}>CHF {chf(itemListPrice(it))}</span>
                    ) : null}
                  </td>
                  <td className="mono" style={styles.docDiscountCell}>
                    {disc > 0 ? `Rabatt ${formatPercent(disc)} %` : ""}
                  </td>
                  <td className="mono" style={{ padding: "6px 0", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" }}>
                    CHF {chf(itemLineTotal(it))}
                  </td>
                </tr>
              );
            })}
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
            Zahlbar per beiliegendem Einzahlungsschein innert {paymentTermOf(receipt)}{" "}
            {dayWord(paymentTermOf(receipt))}.
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

      <DocumentFooter company={company} />
    </div>
  );
}

// Fusszeile mit den Firmenangaben, die auf ein Geschäftsdokument gehören:
// vollständige Adresse, Kontakt, MWST-Nummer und Bankverbindung. Steht am
// Seitenfuss, damit der Kunde alles für Rückfragen und Zahlung beisammen hat.
function companyFooterColumns(company) {
  const qr = company.qrBill || {};
  const addressLines = [company.name, company.address, company.zipCity].filter(Boolean);
  const contactLines = [
    company.email ? `E-Mail: ${company.email}` : "",
    company.phone ? `Telefon: ${company.phone}` : "",
    company.vatNumber ? `MWST-Nr. ${company.vatNumber}` : "",
  ].filter(Boolean);
  const bankLines = [
    qr.iban ? `IBAN: ${formatIbanDisplay(qr.iban)}` : "",
    qr.name && qr.name !== company.name ? `Kontoinhaber: ${qr.name}` : "",
  ].filter(Boolean);
  return [
    { title: "Adresse", lines: addressLines },
    { title: "Kontakt", lines: contactLines },
    { title: "Bankverbindung", lines: bankLines },
  ].filter((c) => c.lines.length > 0);
}

function DocumentFooter({ company }) {
  const columns = companyFooterColumns(company || {});
  if (columns.length === 0) return null;
  return (
    <div style={styles.docFooter}>
      {columns.map((col) => (
        <div key={col.title} style={styles.docFooterCol}>
          <div style={styles.docFooterTitle}>{col.title}</div>
          {col.lines.map((l, i) => (
            <div key={i} style={styles.docFooterLine}>{l}</div>
          ))}
        </div>
      ))}
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

// Umschalter Dienstleistung/Produkt für eine einzelne Rechnungsposition.
// Bewusst zwei sichtbare Schaltflächen statt eines Ein/Aus-Schalters: beide
// Zustände sind gleichwertig, ein Schalter würde einen davon als "aus"
// darstellen.
function KindToggle({ kind, onChange }) {
  const opts = [
    ["service", "Dienstleistung"],
    ["product", "Produkt"],
  ];
  return (
    <div style={styles.kindToggle} role="group" aria-label="Art der Position">
      {opts.map(([value, label]) => {
        const active = kind === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={active}
            style={{ ...styles.kindBtn, ...(active ? styles.kindBtnActive : {}) }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Miniatur eines Tabellenblatts: zeigt auf einen Blick, in welche Spalte was
// gehört. Bewusst mit Spaltenbuchstaben und Zeilennummern wie in Excel — so
// lässt sich die eigene Datei direkt danebenlegen und vergleichen.
function ExcelLayoutHint() {
  const columns = [
    { letter: "A", header: "Produktgruppe", values: ["Netzwerk", "Mobiliar"], width: 100 },
    { letter: "B", header: "Artikelnummer", values: ["ART-001", "ART-010"], width: 96, mono: true },
    { letter: "C", header: "Artikel-Name", values: ["Router AX55", "Bürostuhl"], width: 112 },
    { letter: "D", header: "Stückzahl verfügbar", values: ["12", "3"], width: 92, numeric: true },
    { letter: "E", header: "Preis (CHF)", values: ["200.00", "450.00"], width: 78, numeric: true },
  ];

  return (
    <>
    <div style={styles.sheetScroll}>
      <div style={styles.sheet} role="img" aria-label="Aufbau der Excel-Datei: Zeile 1 enthält die Spaltentitel Produktgruppe, Artikelnummer, Artikel-Name, Stückzahl verfügbar und Preis (CHF); ab Zeile 2 folgen die Artikel.">
        {/* Spaltenbuchstaben */}
        <div style={styles.sheetRow}>
          <div style={{ ...styles.sheetCorner }} />
          {columns.map((c) => (
            <div key={c.letter} style={{ ...styles.sheetColHead, width: c.width }}>
              {c.letter}
            </div>
          ))}
        </div>

        {/* Zeile 1: Spaltentitel */}
        <div style={styles.sheetRow}>
          <div style={styles.sheetRowHead}>1</div>
          {columns.map((c) => (
            <div key={c.letter} style={{ ...styles.sheetCell, ...styles.sheetHeaderCell, width: c.width }}>
              {c.header}
            </div>
          ))}
        </div>

        {/* Beispieldatensätze */}
        {[0, 1].map((i) => (
          <div key={i} style={styles.sheetRow}>
            <div style={styles.sheetRowHead}>{i + 2}</div>
            {columns.map((c) => (
              <div
                key={c.letter}
                style={{
                  ...styles.sheetCell,
                  width: c.width,
                  textAlign: c.numeric ? "right" : "left",
                  fontFamily: c.mono || c.numeric ? "'IBM Plex Mono', monospace" : undefined,
                }}
              >
                {c.values[i]}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
    <div style={styles.sheetNote}>Beispielzeilen — die Spaltentitel müssen exakt so heissen.</div>
    </>
  );
}

// Kleine Auswahlgruppe (wie KindToggle, aber für beliebig viele Optionen).
function OptionGroup({ value, options, onChange, ariaLabel }) {
  return (
    <div style={styles.kindToggle} role="group" aria-label={ariaLabel}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          style={{ ...styles.kindBtn, ...(value === v ? styles.kindBtnActive : {}) }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Miniatur des PDF-Kopfs, damit die Wirkung von Position und Grösse sofort
// sichtbar ist, ohne erst eine PDF erzeugen zu müssen.
function LogoLayoutPreview({ layout, align, size, logoDataUrl }) {
  const heights = { small: 14, medium: 20, large: 28 };
  const h = heights[size] || heights.medium;
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  // Firmenblock links, Titelblock rechts — wie im PDF.
  const textBlocks = (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <div style={{ display: "grid", gap: 3 }}>
        <span style={styles.logoPreviewBarStrong} />
        <span style={styles.logoPreviewBar} />
        <span style={styles.logoPreviewBar} />
      </div>
      <div style={{ display: "grid", gap: 3, justifyItems: "end" }}>
        <span style={{ ...styles.logoPreviewBarStrong, width: 44, background: "#E30613" }} />
        <span style={{ ...styles.logoPreviewBar, width: 28 }} />
      </div>
    </div>
  );

  return (
    <div style={styles.logoLayoutPreview} aria-hidden="true">
      {layout === "inline" ? (
        // Logo steht neben dem Firmenblock (grösserer Abstand wie im PDF)
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, width: "100%" }}>
          <img src={logoDataUrl} alt="" style={{ height: h, objectFit: "contain", flexShrink: 0 }} />
          {textBlocks}
        </div>
      ) : (
        // Logo steht auf eigener Zeile darüber
        <div style={{ display: "grid", gap: 14, width: "100%" }}>
          <div style={{ display: "flex", justifyContent: justify }}>
            <img src={logoDataUrl} alt="" style={{ height: h, objectFit: "contain" }} />
          </div>
          {textBlocks}
        </div>
      )}
    </div>
  );
}

// Einverständnis «E-Mail-Beleg» mit Datum (siehe shared/consent.js).
function ConsentCheckbox({ person, onChange }) {
  return (
    <label style={styles.checkLabel}>
      <input
        type="checkbox"
        checked={hasEmailConsent(person)}
        onChange={(e) =>
          onChange(e.target.checked ? grantEmailConsent(person, todayISO()) : { ...person, emailConsent: null })
        }
      />
      Einverständnis E-Mail-Beleg (Adresse speichern, Belege per E-Mail)
    </label>
  );
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
  itemRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  itemCard: {
    border: "1px solid #EDEEEF",
    borderLeft: "2px solid #E4E5E7",
    padding: "10px 12px",
    display: "grid",
    gap: 8,
    background: "#fff",
  },
  itemMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  itemMetaField: { display: "flex", alignItems: "center", gap: 6 },
  itemMetaLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#8B8F96",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  discountWrap: { display: "flex", alignItems: "center", gap: 4 },
  itemLineSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    fontSize: 12,
  },
  strikePrice: { textDecoration: "line-through", color: "#8B8F96" },
  discountBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#1D7A3C",
    background: "#EAF6EE",
    padding: "2px 6px",
  },
  discountSummary: { marginTop: 12 },
  inventoryForm: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B5F66" },
  mailBox: { maxWidth: 640, margin: "0 auto 12px", padding: 12, border: "1px solid #E4E5E7", background: "#fff", display: "grid", gap: 8 },
  invHeaderRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "0 0 6px",
    fontSize: 11,
    fontWeight: 600,
    color: "#8B8F96",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: "1px solid #E4E5E7",
  },
  invRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid #F1F1EF",
  },
  invFooter: { marginTop: 12, fontSize: 12, color: "#5B5F66" },
  // Miniatur-Tabellenblatt in der Import-Anleitung
  sheetScroll: { overflowX: "auto", margin: "10px 0 4px" },
  sheet: {
    display: "inline-block",
    border: "1px solid #B7BCC2",
    background: "#fff",
    fontSize: 11,
    lineHeight: 1.2,
    userSelect: "none",
  },
  sheetRow: { display: "flex" },
  sheetCorner: {
    width: 26,
    height: 20,
    background: "#E8EAED",
    borderRight: "1px solid #B7BCC2",
    borderBottom: "1px solid #B7BCC2",
    flexShrink: 0,
  },
  sheetColHead: {
    height: 20,
    background: "#E8EAED",
    borderRight: "1px solid #B7BCC2",
    borderBottom: "1px solid #B7BCC2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "#5B5F66",
    flexShrink: 0,
  },
  sheetRowHead: {
    width: 26,
    background: "#E8EAED",
    borderRight: "1px solid #B7BCC2",
    borderBottom: "1px solid #DDE1E5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "#5B5F66",
    flexShrink: 0,
  },
  sheetCell: {
    padding: "5px 7px",
    borderRight: "1px solid #DDE1E5",
    borderBottom: "1px solid #DDE1E5",
    color: "#16181D",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 0,
  },
  sheetHeaderCell: {
    fontWeight: 700,
    background: "#F7F8F9",
    // Umbrechen statt abschneiden: in einer Anleitung muss der Spaltentitel
    // vollständig lesbar sein, sonst rät man beim Nachbauen.
    whiteSpace: "normal",
    lineHeight: 1.2,
  },
  sheetNote: { fontSize: 11, color: "#8B8F96", fontStyle: "italic", margin: "2px 0 10px" },
  helpToggleRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" },
  invFilterRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 14,
  },
  logoOptions: { display: "grid", gap: 10, marginTop: 16 },
  logoOptionRow: { display: "flex", alignItems: "center", gap: 10 },
  logoLayoutPreview: {
    border: "1px solid #E4E5E7",
    background: "#fff",
    padding: 12,
    display: "flex",
    marginTop: 4,
  },
  logoPreviewBar: { display: "block", width: 60, height: 4, background: "#DADDE1" },
  logoPreviewBarStrong: { display: "block", width: 74, height: 6, background: "#9AA0A6" },
  docArticleNr: { fontSize: 11, color: "#8B8F96" },
  docListPriceCell: { padding: "6px 8px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" },
  docDiscountCell: { padding: "6px 8px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", color: "#1D7A3C" },
  docStrike: { textDecoration: "line-through", color: "#8B8F96" },
  docFooter: {
    marginTop: 28,
    paddingTop: 12,
    borderTop: "1px solid #E4E5E7",
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
  },
  docFooterCol: { flex: "1 1 150px", minWidth: 140 },
  docFooterTitle: {
    fontSize: 8.5,
    fontWeight: 700,
    color: "#8B8F96",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 3,
  },
  docFooterLine: { fontSize: 10, color: "#70747C", lineHeight: 1.5 },
  kindToggle: { display: "flex", border: "1px solid #DADDE1", flexShrink: 0 },
  kindBtn: {
    border: "none",
    background: "transparent",
    color: "#70747C",
    fontSize: 11,
    fontWeight: 600,
    padding: "6px 10px",
    cursor: "pointer",
  },
  kindBtnActive: { background: "#16181D", color: "#fff" },
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
  paymentTermRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },
  paymentTermLabel: {
    fontSize: 13,
    color: "#5B5F66",
  },
  paymentTermSelect: {
    padding: "6px 8px",
    border: "1px solid #DADDE1",
    fontSize: 13,
    background: "#fff",
    color: "#16181D",
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
  // gap passend zum PDF (dort mm(7) zwischen Logo und Firmenblock)
  docHeaderLeft: { display: "flex", alignItems: "flex-start", gap: 20 },
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
