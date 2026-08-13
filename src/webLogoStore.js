// Lagert Firmenlogos aus der Quittungsliste in eigene Datenbankzeilen aus —
// das Gegenstück zu desktop/logoCache.js, nur für die Web-/D1-Version.
//
// Warum das nötig ist: jede Quittung speichert ihren eigenen Firmen-Snapshot,
// damit ein alter Beleg nicht rückwirkend anders aussieht, wenn sich die
// Firmendaten ändern. Zu diesem Snapshot gehört auch logoDataUrl — ein auf
// 300px verkleinertes Logo sind als Base64-data-URL rund 100 KB. Die gesamte
// Quittungsliste liegt in EINEM einzigen Datenbankwert (Schlüssel
// "receipts-list"), also wuchs dieser Wert um ~100 KB PRO Quittung und lief
// nach einigen Dutzend Quittungen in die Wertgrösse-Grenze von D1: ab da
// schlug jedes Speichern fehl.
//
// Stattdessen wird jedes Logo einmal unter "logo:<sha256>" abgelegt und in der
// Quittung nur noch die Referenz gespeichert. Gleiches Logo über hunderte
// Quittungen hinweg = eine einzige Zeile. Die Bildtreue bleibt dabei voll
// erhalten: ein später geändertes Logo bekommt einen anderen Hash, alte
// Quittungen zeigen weiterhin ihr damaliges.

const LOGO_KEY_PREFIX = "logo:";

// Einmal geladene/gespeicherte Logos im Speicher behalten: beim Laden teilen
// sich alle Quittungen mit demselben Logo einen einzigen Abruf, und beim
// Speichern wird dasselbe Logo nicht bei jedem Save erneut hochgeladen.
const logoCache = new Map(); // ref -> dataUrl
const knownStored = new Set(); // refs, die in dieser Sitzung nachweislich existieren

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasLogo(receipt) {
  return !!(receipt && receipt.company && receipt.company.logoDataUrl);
}

function hasLogoRef(receipt) {
  return !!(receipt && receipt.company && receipt.company.logoRef);
}

/**
 * Ersetzt in einer Quittungsliste jedes eingebettete Logo durch eine Referenz
 * und legt das Logo selbst als eigenen Eintrag ab. Gibt die umgebaute Liste
 * zurück; das übergebene Array bleibt unverändert.
 *
 * @param {Array} receipts
 * @param {(key: string, value: string) => Promise<any>} writeRaw  Rohschreibzugriff
 */
export async function externalizeLogos(receipts, writeRaw) {
  if (!Array.isArray(receipts)) return receipts;

  const out = [];
  for (const receipt of receipts) {
    if (!hasLogo(receipt)) {
      out.push(receipt);
      continue;
    }

    const dataUrl = receipt.company.logoDataUrl;
    let ref;
    try {
      ref = LOGO_KEY_PREFIX + (await sha256Hex(dataUrl));
    } catch (e) {
      // Ohne WebCrypto (sehr alter Browser / unsicherer Kontext) lieber das
      // Logo eingebettet lassen als die Quittung zu beschädigen.
      console.warn("Logo konnte nicht ausgelagert werden, bleibt eingebettet", e);
      out.push(receipt);
      continue;
    }

    if (!knownStored.has(ref)) {
      // Schlägt das Ablegen fehl, wird das Logo NICHT durch eine Referenz
      // ersetzt — sonst zeigte die Quittung später auf ein Bild, das es nicht
      // gibt. Lieber eingebettet lassen (gross, aber korrekt).
      try {
        await writeRaw(ref, dataUrl);
        knownStored.add(ref);
      } catch (e) {
        console.warn("Logo konnte nicht gespeichert werden, bleibt eingebettet", e);
        out.push(receipt);
        continue;
      }
    }
    logoCache.set(ref, dataUrl);

    const company = { ...receipt.company, logoRef: ref };
    delete company.logoDataUrl;
    out.push({ ...receipt, company });
  }
  return out;
}

/**
 * Umkehrung von externalizeLogos: lädt die referenzierten Logos nach und setzt
 * logoDataUrl wieder ein, sodass App.jsx und die PDF-Erzeugung exakt dieselbe
 * Quittungsform sehen wie vor der Auslagerung.
 *
 * @param {Array} receipts
 * @param {(key: string) => Promise<string|null>} readRaw  Rohlesezugriff
 */
export async function restoreLogos(receipts, readRaw) {
  if (!Array.isArray(receipts)) return receipts;

  // Jede Referenz nur einmal laden, egal wie viele Quittungen sie benutzen.
  const refs = [...new Set(receipts.filter(hasLogoRef).map((r) => r.company.logoRef))];
  await Promise.all(
    refs.map(async (ref) => {
      if (logoCache.has(ref)) return;
      try {
        const dataUrl = await readRaw(ref);
        // Fehlt das Logo (z.B. Datenbank von Hand aufgeräumt), lieber ohne
        // Logo weitermachen als die ganze Liste scheitern zu lassen.
        logoCache.set(ref, dataUrl || "");
        if (dataUrl) knownStored.add(ref);
      } catch (e) {
        console.warn(`Logo ${ref} konnte nicht geladen werden`, e);
        logoCache.set(ref, "");
      }
    })
  );

  return receipts.map((receipt) => {
    if (!hasLogoRef(receipt)) return receipt;
    const company = { ...receipt.company, logoDataUrl: logoCache.get(receipt.company.logoRef) || "" };
    delete company.logoRef;
    return { ...receipt, company };
  });
}
