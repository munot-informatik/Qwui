# Änderungsverlauf

Alle nennenswerten Änderungen an Qwui. Versionsnummern folgen der Web- und
Desktop-Version gemeinsam (`package.json` und `desktop/package.json`).

## 1.5.0 — 21. November 2026

### Offerten

- In **«Neue Quittung»** oben die Belegart **«Offerte»** wählen: gleiche
  Positionen, Kunde und MWST wie bei der Quittung, dazu **«Gültig bis»**
  (Vorgabe 30 Tage). Eine Offerte bucht kein Lager und hat eigene Nummern
  (O-0001, O-0002, …).
- Neuer Bereich **«Offerten»** mit Suche und Stand: offen, abgelaufen,
  angenommen, abgelehnt. PDF, Drucken, E-Mail und WhatsApp wie bei der
  Quittung.
- **«Als Quittung übernehmen»** füllt das Quittungsformular mit Kunde und
  Positionen. Artikel mit Seriennummer stehen dort einzeln, das Exemplar wählt
  man beim Verkauf. Erst die Quittung bucht das Lager; die Offerte gilt dann als
  angenommen und verweist auf die Quittung.

### Gutschriften bei Retouren

- Bei jeder Quittung oder Rechnung: **«Gutschrift / Retoure»**. Positionen und
  Menge wählen, je Produkt «zurück ins Lager» oder nicht (z. B. defekt), dazu
  die Rückerstattung: bar, Überweisung oder mit der Rechnung verrechnet.
- Die Gutschrift ist ein eigener Beleg (G-0001, …) mit PDF und Versand.
  Zurückgenommene Ware geht als Lagerbewegung «Retoure» in den Bestand,
  Exemplare mit Seriennummer stehen wieder «an Lager» oder auf «retourniert».
- Es lässt sich nie mehr gutschreiben, als verkauft wurde. Eine Quittung mit
  Gutschrift bleibt, wie sie ist (nicht mehr bearbeiten oder löschen). Wird
  eine Gutschrift gelöscht, kehrt Qwui die Rücknahme um — ausser ein Exemplar
  ist inzwischen weiterverkauft.
- **Belege** zeigen Gutschriften als eigene Zeilen und ziehen sie vom Total ab.
  Bei einer offenen Rechnung zählt nur noch der Rest als offen; die Mahnung
  und ihr Einzahlungsschein verlangen genau diesen Rest.
- Der Assistent rechnet den Umsatz nach Abzug der Gutschriften. Die
  Excel-Auswertung (Windows) hat neu die Blätter «Gutschriften» und
  «Offerten».

### Lieferscheine

- In der Vorschau einer Quittung oder Rechnung umschalten auf
  **«Lieferschein»**: Lieferadresse, Menge, Artikel, Artikelnummer und
  Seriennummer, ohne Preise und ohne Einzahlungsschein, mit Feld für die
  Empfangsbestätigung. Hat der Beleg Produkte, stehen nur diese darauf (ohne
  Versandkosten oder Montage). Bei Online-Bestellungen steht die
  Bestellnummer mit drauf.
- Unter **Belege** gibt es dafür bei jedem Beleg den Knopf «Lieferschein».

### Automatische Updates (Windows)

- Neue Seite **Einstellungen → Updates**: Qwui sucht alle 6 Stunden bei GitHub
  nach einer neuen Version (abschaltbar) und zeigt oben einen Hinweis, sobald
  eine bereitsteht. Übertragen wird dabei nur die Anfrage, keine Daten.
- **«Jetzt aktualisieren»** lädt die neue .exe, prüft ihre SHA-256-Prüfsumme,
  sichert vorher noch einmal (falls eingerichtet), ersetzt die laufende Datei
  unter ihrem bisherigen Namen und startet neu. Verknüpfungen und der Ordner
  «Qwui-Daten» bleiben, wie sie sind.
- Wer noch 1.4.0 hat, installiert 1.5.0 ein letztes Mal von Hand.

### Behoben

- **Assistent:** Ein Wareneingang-Vorschlag über eine gebrochene Menge
  (z. B. 1.5 Stück) liess sich nie übernehmen. Jetzt sind nur ganze Stück
  erlaubt.
- **Shop-Bestellungen:** Eine gebuchte Bestellung konnte ein zweites Mal als
  Vorschlag erscheinen, wenn die Meldung «gebucht» noch nicht beim Shop
  angekommen war und der erledigte Vorschlag inzwischen aus der Liste fiel.
- **Shop:** Der Webhook liess sich nicht ausschalten, solange «Bestellungen
  abholen» an war. «Jetzt abgleichen» verwarf ungespeicherte Eingaben im
  Formular.
- **Backup:** Eine präparierte Sicherungsdatei konnte Qwui beim Öffnen mit
  extremen Schlüsselwerten lahmlegen; die Werte sind jetzt begrenzt.
- **Kunden:** Die Suche findet Kunden jetzt auch über die Postleitzahl.
- **Web, Sicherheit:** Der Schutz gegen Schreibzugriffe von fremden Seiten
  liess sich mit einem gross geschriebenen Pfad umgehen (`/API/storage` statt
  `/api/storage` — Cloudflare leitet beide an die Speicher-API weiter). Eine
  fremde Seite hätte so bei angemeldetem Browser z. B. die IBAN in den
  Firmendaten überschreiben können. Die Prüfung gilt jetzt für jeden Pfad, und
  die Speicher-API nimmt nur noch JSON an.
- **Windows, Sicherheit:** Eine präparierte Sicherung konnte über einen
  Logo-Verweis wie `..\..\geheim.bin` eine beliebige Datei als «Logo» einlesen.
  Gelesen werden nur noch die Logo-Dateien, die Qwui selbst abgelegt hat.
- **Belege:** Lagen Rechnung und Gutschrift in verschiedenen Monaten, stimmten
  «davon offen» und «davon bezahlt» nicht (die Gutschrift erschien im Monat der
  Rechnung als bezahlt).
- **Offerten:** Wird die Quittung aus einer Offerte gelöscht, ist die Offerte
  wieder offen, statt für immer auf «angenommen» zu stehen.
- **Import:** Eine Sicherung von vor 1.5.0 ersetzt Quittungen und Exemplare;
  die bisherigen Gutschriften dazu werden jetzt mit entfernt (die Vorschau
  sagt es), statt auf nicht mehr vorhandene Rücknahmen zu zeigen. Angenommene
  Offerten, deren Quittung danach fehlt, sind wieder offen.
- **QR-Rechnung:** «Zahlbar durch» zeigt Name und Adresse nur noch, wenn sie
  auch im QR-Code stehen (Name, PLZ und Ort); sonst ein leeres Feld mit
  Eckmarken zum Ausfüllen, wie es die Vorgaben verlangen.
- **Excel-Auswertung:** Im Blatt «Zahlungen» stehen die Gutschriften je
  Rechnung; eine ganz ausgeglichene Rechnung gilt nicht mehr als offen.
- **Assistent:** Offene Rechnungen mit Produktgruppe ziehen die Gutschriften
  jetzt ebenfalls ab. Die Erweiterung für Claude Desktop meldet die Version
  der App statt fest 1.4.0.
- **Gutschrift:** Ohne Datum lässt sie sich nicht mehr erstellen; der Knopf
  «Gutschrift / Retoure» fehlt, wenn schon alles gutgeschrieben ist.
- Windows-Paket: Abhängigkeiten aktualisiert (u. a. Sicherheitskorrektur in
  `brace-expansion`). Web: Entwicklungswerkzeuge (vite, vitest, wrangler)
  aktualisiert.

## 1.4.0 — 10. November 2026

### Bestellungen aus dem Online-Shop

- Die Windows-Version holt jede Minute die bezahlten Bestellungen aus dem
  eigenen Online-Shop ab: **Einstellungen → Shop → «Bestellungen abholen»**.
  Der Shop ist ein eigenes Projekt auf Cloudflare Pages.
- Jede Bestellung erscheint unter **Vorschläge** mit Kunde, Artikeln,
  Versand oder Abholung und Zahlungsart. **«Quittung erstellen…»** öffnet eine
  ausgefüllte Quittung; Artikel mit Seriennummer stehen einzeln darin.
- Erst beim Erstellen der Quittung bucht Qwui das Lager. Qwui meldet dem Shop
  «abgeholt», «gebucht» oder «verworfen»; eine verlorene Meldung wird beim
  nächsten Abholen wiederholt. Bis zur Buchung hält der Shop die Ware selbst
  zurück, damit nichts doppelt verkauft wird.
- Eine bezahlte Bestellung lässt sich nur mit einem zweiten Klick
  («Wirklich verwerfen») verwerfen; das Geld erstattest du im Zahlungsdienst.
- Eine fehlerhafte Bestellung (z. B. ohne gültigen Preis) wird übersprungen
  und unter **Einstellungen → Shop** gemeldet; die übrigen kommen trotzdem an.

## 1.3.1 — 10. November 2026

### Aufwand für die Buchhaltung

- Neuer Bereich **Aufwand für die Buchhaltung** in der Quittung: gefahrene
  Kilometer und verbrauchtes Material (Einkaufspreis) eines Einsatzes vor Ort.
  Erscheint **nie** auf dem Beleg — weder auf Bildschirm, Druck, PDF, E-Mail,
  QR-Rechnung oder Mahnung, noch im Shop-Feed oder beim Assistenten.
- Kilometeransatz unter **Firma**, Vorgabe CHF 0.75 pro Kilometer: Höchstansatz
  der ESTV für die geschäftliche Benützung des Privatfahrzeugs ab 2026
  (Wegleitung zum Lohnausweis, Rz 52; bis 2025: CHF 0.70). Jede Quittung
  speichert ihren Ansatz, ältere Belege behalten ihren.
- **Belege** zeigen den Aufwand pro Beleg und die Summen im Zeitraum
  (Fahrkosten, Material, total); der Excel-Export hat dafür eigene Spalten.
- Die **Excel-Auswertung** der Windows-Version hat ein neues Blatt «Aufwand».

## 1.3.0 — 8. November 2026

Einfachere Bedienung.

### Verkauf und Belege

- **Verkauf per Scan:** Feld «Scannen» in der Quittung. Eine Seriennummer trägt
  Artikel und Exemplar ein, eine Artikelnummer den Artikel (bzw. Menge +1).
  Verkaufte, retournierte oder doppelt gescannte Stücke werden gemeldet.
- **Kunde suchen statt aus einer langen Liste wählen** (Name, Telefon, E-Mail;
  «079 …» findet auch «+41 79 …»). Neue Kunden direkt aus der Quittung anlegen.
  Ohne Kunde geht die Quittung an «Laufkunde»; die Adressfelder erscheinen nur,
  wenn sie gebraucht werden.
- **Kunden bearbeiten und durchsuchen.** Bisher liessen sie sich nur löschen und
  neu anlegen.
- **Belege:** «Verlauf» und «Buchhaltung» sind zu einer Seite zusammengelegt —
  mit Suche über alle Monate (Nummer, Kunde, Artikel, Seriennummer), Öffnen,
  Bearbeiten, Löschen mit Rückfrage, Zahlungsstatus, Mahnung und Excel-Export.

### Struktur und Einrichtung

- Seitenleiste in Tagesgeschäft (Neue Quittung, Belege, Kunden, Inventar) und
  Einstellungen (Firma, E-Mail, Shop, Assistent, Backup) geteilt. Offene
  Vorschläge des Assistenten erscheinen oben als «Vorschläge (n)».
- Hinweis «Noch einzurichten» auf «Neue Quittung», solange Firmendaten,
  E-Mail-Versand oder automatische Sicherung fehlen.
- **E-Mail:** eigene Seite; Anbieter wählen (Bluewin, Hostpoint, Infomaniak,
  Gmail, GMX), dann genügen Adresse und Passwort. Hinweis, dass Outlook.com
  keine Passwort-Anmeldung mehr erlaubt.
- **Firma:** ein einziger Knopf «Firmendaten speichern» statt drei, mit Hinweis
  auf ungespeicherte Änderungen.

### Fortgeschrittenes

- **Claude Desktop mit einem Klick verbinden:** Qwui erstellt eine
  Claude-Desktop-Erweiterung (.mcpb) mit Adresse und Token. Node.js und das
  Bearbeiten der Konfiguration sind nicht mehr nötig.
- **Inventar:** Artikelzeilen sind nur zur Ansicht und werden nach «Bearbeiten»
  geändert — kein versehentlich geänderter Preis mehr. «Neuer Artikel» und der
  Excel-Bereich sind eingeklappt; Inventar und Wareneingang nutzen dasselbe
  Formular für neue Artikel.

### Behoben

- Eine Artikelnummer liess sich zweimal vergeben (Inventar, Wareneingang,
  Bearbeiten). Scanner fanden dann nur einen der beiden Artikel. Jetzt wird das
  abgelehnt bzw. beim Bearbeiten gewarnt.
- Web-Version auf dem Telefon: Die Seitenleiste nahm die halbe Breite ein und
  der Inhalt lief rechts aus dem Bild. Unter 760 px Breite steht die
  Navigation jetzt als Leiste oben.
- **Web-Version mit zwei Geräten oder Fenstern:** Speicherte das zweite,
  überschrieb es die Quittungen des ersten — die Quittung des ersten Geräts war
  weg und ihre Nummer wurde doppelt vergeben. Jetzt hat jeder gespeicherte Wert
  eine Version; wer mit einem veralteten Stand speichert, bekommt die Meldung
  «Die Daten wurden inzwischen … geändert» mit **Neu laden**, statt fremde
  Daten zu überschreiben.
- **Web-Version, viele Quittungen:** Cloudflare D1 nimmt pro Wert höchstens
  2 MB an, alle Quittungen stehen in einem Wert — nach etwa 1500–3000
  Quittungen wäre das Speichern gescheitert. Grosse Werte werden jetzt in Teile
  zerlegt und in einem Schritt gespeichert (getestet mit 7000 Quittungen).
- **Datum der Quittung:** Zwischen Mitternacht und 01:00 (Sommer 02:00) stand
  das Datum von gestern darauf (UTC statt Schweizer Zeit). Bleibt Qwui über
  Nacht offen, springt das Datum jetzt auch ohne neue Quittung auf heute.
- **QR-Rechnung:** Lange Namen oder Orte ergaben einen QR-Code, den
  Banking-Apps ablehnen. Die Felder werden jetzt auf die Längen des
  Swiss-QR-Standards gekürzt. Eine QR-IBAN wird erkannt und abgelehnt — Qwui
  braucht die normale IBAN.
- **Web-Version nach einem Update:** Die Seite kam beim ersten Aufruf noch aus
  dem Zwischenspeicher, also in der alten Version. Jetzt zuerst vom Netz,
  der Zwischenspeicher nur noch offline.

## 1.2.1 — 8. November 2026

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
