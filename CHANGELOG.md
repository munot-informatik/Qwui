# Änderungsverlauf

Alle nennenswerten Änderungen an Qwui. Versionsnummern folgen der Web- und
Desktop-Version gemeinsam (`package.json` und `desktop/package.json`).

## 1.1.0 — 25. August 2026

Fünf neue Funktionen und ein überarbeiteter PDF-Aufbau. **Alle Änderungen sind
abwärtskompatibel:** bestehende Quittungen, Kunden und Firmendaten verhalten
sich unverändert, neue Felder haben Rückfallwerte.

### Inventar (neuer Reiter)

- Artikel mit Artikelnummer, Name, Produktgruppe, Stückzahl und Preis.
- Alphabetisch sortiert, direkt in der Tabelle bearbeitbar, mit Lagerwert-Summe.
- Suche über Name, Artikelnummer und Gruppe; Filter nach Produktgruppe mit
  Trefferzähler. Artikel ohne Gruppe laufen unter „Ohne Gruppe" und bleiben
  darüber auffindbar.
- Excel-Export und -Import. Beim Import werden Artikel mit bereits bekannter
  Artikelnummer aktualisiert und unbekannte neu angelegt — bestehende Artikel
  gehen nie verloren. Fehlt in einer älteren Datei die Spalte „Produktgruppe",
  bleibt die bisherige Gruppe erhalten statt geleert zu werden.
- Import-Anleitung mit Miniatur-Tabellenblatt (Spaltenbuchstaben und
  Zeilennummern) und Umschalter zum Ausblenden; die Wahl wird gemerkt.

### Rechnungspositionen: Produkt/Dienstleistung und Rabatt

- Jede Position ist wahlweise Dienstleistung oder Produkt.
- Produkte lassen sich aus dem Inventar wählen (nach Gruppen gebündelt); Name,
  Preis und Artikelnummer werden übernommen.
- Rabatt in Prozent je Position, auf 0–100 begrenzt.
- Der eingegebene Betrag ist neu der **Listenpreis**; verrechnet wird der Betrag
  nach Rabatt. Auf dem Beleg erscheint beim Produkt der durchgestrichene
  Listenpreis, dann der Rabatt, dann der neue Preis — bei der Dienstleistung nur
  Rabatt und neuer Preis.
- Zwischensumme „Listenpreise / Rabatt" über dem Total, sobald ein Rabatt
  gesetzt ist.

### Logo im PDF

- Anordnung wählbar: neben dem Text oder auf eigener Zeile darüber.
- Ausrichtung links/mittig/rechts und Grösse klein/mittel/gross. Die Ausrichtung
  greift nur bei eigener Zeile — neben dem Text steht das Logo immer links.
- Grössere Abstände zwischen Logo und Firmenblock.
- Mini-Vorschau des Kopfbereichs in den Firmendaten.

### Fusszeile auf Rechnung, Quittung und Mahnung

- Adresse, Kontakt mit MWST-Nummer und Bankverbindung mit IBAN, dreispaltig am
  unteren Seitenrand.
- Die Fusszeile sitzt am **Ende der Rechnungsseite**. Da ein Einzahlungsschein
  laut Vorgabe ebenfalls an den unteren Seitenrand gehört, liegt er neu auf
  einer eigenen Folgeseite: Seite 1 die Rechnung samt Fusszeile, Seite 2 der
  Schein zum Abtrennen. Quittungen ohne Schein bleiben einseitig.

### Desktop-Version

- Neues Tabellenblatt „Inventar" in `Qwui-Daten.xlsx` samt Anbindung. Ohne das
  hätte die .exe-Version das Inventar stillschweigend verworfen.
- Portable Windows-Version 1.1.0, unverändert ohne Installation lauffähig.

### Behoben

- Schreibweise „Listenpreis" statt „Listpreis".
- Beim Tippen in der Inventartabelle wird gebündelt gespeichert statt bei jedem
  einzelnen Zeichen.

## 1.0.0

Erste Fassung: Quittungen und QR-Rechnungen, Kundenverwaltung, Firmendaten mit
Logo, Verlauf, Buchhaltung mit Excel-Export und Mahnungen, Backup-Export und
-Import, Web-Version auf Cloudflare Pages mit D1 sowie portable Windows-Version
mit lokaler Excel-Datei.
