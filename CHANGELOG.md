# Änderungsverlauf

Alle nennenswerten Änderungen an Qwui. Versionsnummern folgen der Web- und
Desktop-Version gemeinsam (`package.json` und `desktop/package.json`).

## Unveröffentlicht

### Seriennummern aus Fotos (Windows)

- Im Wareneingang lassen sich Seriennummern aus Fotos lesen, wenn sie nicht als
  Barcode vorliegen. Die Erkennung läuft mit der in Windows eingebauten
  Texterkennung auf dem PC, ohne Internet.
- Die Erkennung macht nur Vorschläge: Jede Nummer wird neben dem Foto angezeigt,
  lässt sich korrigieren und kommt erst nach «Stimmt, übernehmen» in die Liste.

### Etiketten mit Strichcode

- Seriennummer-Etiketten mit Code-128-Strichcode drucken: nach dem Wareneingang,
  aus der Seriennummer-Suche und für alle Exemplare an Lager eines Artikels.
- Formate für Etikettendrucker (62 × 29 mm, 57 × 32 mm) und A4-Bogen 3 × 8.
  Das gewählte Format merkt sich Qwui auf diesem Gerät.

## 1.2.0 — 3. November 2026

Qwui wird zur einzigen Datenbasis eines Fachgeschäfts: Lager mit
Seriennummern, E-Mail-Versand, automatische Sicherung, Shop-Abgleich und ein
lokaler Zugang für den Assistenten. Der Schwerpunkt liegt auf der
Windows-Version; Lager und Seriennummern gibt es auch im Web. **Alle
Änderungen sind abwärtskompatibel:** bestehende Quittungen, Kunden, Inventar
und Backups funktionieren unverändert weiter, neue Felder haben
Rückfallwerte.

### Seriennummern und Lager

- Artikel lassen sich als **seriennummernpflichtig** kennzeichnen. Jedes
  Exemplar hat eine eigene Seriennummer, einen Status (an Lager, reserviert,
  verkauft, retourniert), Eingangsdatum, optional Einkaufspreis und
  Bemerkung. Der Bestand ergibt sich aus den Exemplaren an Lager.
- Doppelte Seriennummern werden abgewiesen, gleich ob gross oder klein
  geschrieben oder mit Leerzeichen gescannt.
- Neues **Protokoll der Lagerbewegungen** (Wareneingang, Verkauf, Storno,
  Inventurkorrektur) mit Zeitpunkt, Seriennummer, Menge, Referenz und Quelle
  (App oder Assistent).
- Eine Quittung bucht den Bestand automatisch aus; bei Seriennummernpflicht
  muss ein Exemplar gewählt werden. Löschen und Bearbeiten stornieren
  sauber, statt still zu überschreiben. Ein negativer Bestand warnt, hält den
  Verkauf aber nicht auf. Quittungen von vor 1.2.0 verändern den Bestand
  nicht.
- Bestandsänderungen von Hand und aus dem Excel-Import werden als
  Inventurkorrektur gebucht.
- Retouren und Reservationen lassen sich in der Exemplarliste von Hand
  erfassen.

### Wareneingang mit Scanner

- Neuer Bereich im Inventar. Artikelnummer scannen oder Artikel wählen,
  danach Seriennummern hintereinander scannen — der Fokus bleibt im Feld,
  Doppelte werden sofort rot gemeldet. Ohne Seriennummernpflicht die Menge
  eingeben.
- Neue Artikel lassen sich direkt im Wareneingang anlegen.

### Quittung und Garantie

- Positionen haben neu eine **Menge**; der Betrag gilt pro Stück.
- Die **Seriennummer** steht als «S/N: …» bei der Position — auf Bildschirm,
  Druck und PDF.
- **Seriennummer suchen:** Artikel, Status, Eingangs- und Verkaufsdatum,
  Quittung und Kunde auf einen Blick, mit Sprung zur Quittung.
- Jede neue Quittung trägt eine Kunden-ID, auch bei von Hand eingetragenen
  Empfängern.

### E-Mail-Versand mit PDF-Anhang (Windows)

- Quittungen und Rechnungen gehen direkt per SMTP hinaus, die PDF hängt
  automatisch an. Einstellungen unter Firma, mit Test-Mail.
- Beim Erstellen lässt sich «Per E-Mail senden» und/oder «Drucken» wählen;
  E-Mail ist vorgewählt, sobald eine Adresse bekannt ist.
- Der Versandstatus (gesendet oder fehlgeschlagen mit Meldung) steht an der
  Quittung und im Verlauf.
- Kunden haben neu ein **Einverständnis «E-Mail-Beleg»** mit Datum. Ohne
  Einverständnis wird die Adresse nur für den Versand verwendet und weder
  beim Kunden noch auf der Quittung gespeichert. Kunden aus 1.1 behalten ihre
  Adresse; die Kundenliste bietet an, das Einverständnis zu erfassen oder die
  Adresse zu entfernen.
- Die Web-Version bleibt bei `mailto:` und dem Teilen-Dialog.

### Lokale Datenbank statt Excel (Windows)

- Die Daten liegen neu in `Qwui-Datenqwui.db` (SQLite, gleicher Aufbau wie
  die Cloudflare-Datenbank der Web-Version). Damit können App, Shop-Abgleich
  und Assistent gleichzeitig arbeiten, und eine in Excel geöffnete Datei
  blockiert nichts mehr.
- Beim ersten Start mit 1.2.0 wird `Qwui-Daten.xlsx` vollständig übernommen.
  Die Excel-Datei bleibt unverändert als Sicherung liegen.
- **Excel-Auswertung** mit Kunden, Zahlungen, Inventar, Exemplaren und
  Lagerbewegungen — zum Ansehen und Weitergeben, nicht mehr als Datenbank.

### Automatische Sicherung (Windows)

- Stündlich und täglich eine Sicherung im bestehenden Backup-Format,
  erweitert um Exemplare, Lagerbewegungen und Einstellungen ohne
  Passwörter. Ziel ist ein frei wählbarer Ordner, z. B. von Proton Drive oder
  OneDrive; Qwui selbst lädt nichts hoch.
- Verschlüsselt mit einem Backup-Passwort (AES-256-GCM, Schlüssel per
  scrypt). Ohne Passwort wird nicht gesichert, mit Hinweis.
- Behalten werden 48 stündliche und 30 tägliche Sicherungen.
- Wiederherstellen über den Backup-Reiter, mit Passwortabfrage.

### Shop-Abgleich (Windows)

- Nach jeder Lagerbewegung und Preisänderung geht ein Shop-Feed hinaus: pro
  Artikel Artikelnummer, Name, Produktgruppe, Preis, verfügbare Menge und
  Status — ohne Seriennummern und Einkaufspreise.
- Zwei Ziele: Datei-Feed (JSON und CSV in einen Ordner) und Webhook (HTTPS,
  optional mit Token). Bei Fehlern versucht Qwui es nach 1, 5 und 15 Minuten
  erneut. Nur ausgehend — Qwui nimmt keine Verbindungen aus dem Internet an.
- Neuer Reiter «Shop-Anbindung» mit «Jetzt abgleichen», Status und Vorschau.

### Assistent (Windows)

- Lokale Schnittstelle nur auf diesem PC (127.0.0.1), mit Zugriffstoken,
  standardmässig aus.
- MCP-Server in `mcp/` für Claude Desktop mit acht Werkzeugen: Artikel
  suchen, Bestand abfragen, Seriennummer suchen, Umsatz auswerten,
  Ladenhüter, Wareneingang vorschlagen, Artikel vorschlagen, Backup-Status.
- Schreibende Werkzeuge legen nur Entwürfe an. Sie erscheinen unter
  «Vorschläge des Assistenten» und werden erst mit «Übernehmen» gebucht.
- Der Assistent bekommt keine Personendaten, nur Kunden-IDs. Jeder Zugriff
  steht im Protokoll.

### Technisches

- Electron 44 statt 33; die Datenbank nutzt das eingebaute `node:sqlite`.
- Passwörter und Tokens liegen verschlüsselt in `Qwui-Datengeheim.bin`
  (Windows-Verschlüsselung des angemeldeten Benutzers), nie im Code oder in
  einer Sicherung.
- Backup-Format Version 2; ältere Backups lassen sich weiter importieren.

### Behoben

- Der WhatsApp-Text nannte den Listenpreis statt des verrechneten Betrags
  (Rabatte fehlten).
- Der Backup-Reiter zeigt nach einem Import die Erfolgsmeldung.
- Das Total auf Quittung und QR-Rechnung zählte auch Zeilen ohne Beschreibung
  oder mit negativem Betrag mit, die gar nicht auf den Beleg kamen. Das Formular
  weist neu auf solche Zeilen hin.
- Nummern gelöschter Quittungen werden nicht mehr neu vergeben.
- Ein fehlgeschlagenes Laden eines Firmenlogos entfernte es beim nächsten
  Speichern dauerhaft von den Quittungen.
- Im Inventar-Excel-Import setzten leere Zellen Stückzahl und Preis auf 0; sie
  gelten jetzt als «keine Angabe».
- Eine beim Schliessen des Fensters noch nicht gespeicherte Eingabe in der
  Inventartabelle ging verloren.

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
