# Qwui

Schweizer Quittungen erstellen, Firmen- und Kundendaten verwalten, Quittungen als PDF
herunterladen und per E-Mail oder WhatsApp versenden — inklusive Schweizer
QR-Einzahlungsschein. Web-App (PWA), gehostet auf Cloudflare Pages mit zentraler
Datenbank (Cloudflare D1) und Passwortschutz.

Dieser Guide führt einmal komplett von "leeres Verzeichnis" bis "fertig
eingerichtete, live erreichbare App" durch.

## Inhaltsverzeichnis

1. [Überblick & Funktionen](#1-überblick--funktionen)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Lokale Entwicklung](#3-lokale-entwicklung)
4. [Projektstruktur](#4-projektstruktur)
5. [Auf GitHub bringen](#5-auf-github-bringen)
6. [Deployment auf Cloudflare Pages](#6-deployment-auf-cloudflare-pages)
7. [Zentrale Datenbank einrichten (Cloudflare D1)](#7-zentrale-datenbank-einrichten-cloudflare-d1)
8. [Passwortschutz einrichten](#8-passwortschutz-einrichten)
9. [Erste Schritte in der App](#9-erste-schritte-in-der-app)
10. [PDF-Erzeugung & Versand](#10-pdf-erzeugung--versand)
11. [Als App installieren (PWA)](#11-als-app-installieren-pwa)
12. [Sicherheit](#12-sicherheit)
13. [Updates & weitere Deployments](#13-updates--weitere-deployments)
14. [Troubleshooting](#14-troubleshooting)
15. [Desktop-Version (Windows .exe)](#15-desktop-version-windows-exe)
16. [Backup & Datenübertragung (Web ↔ Windows)](#16-backup--datenübertragung-web--windows)
17. [Lager und Seriennummern](#17-lager-und-seriennummern)
18. [E-Mail-Versand (Windows)](#18-e-mail-versand-windows)
19. [Automatische Sicherung (Windows)](#19-automatische-sicherung-windows)
20. [Shop-Anbindung (Windows)](#20-shop-anbindung-windows)
21. [Assistent (Claude Desktop)](#21-assistent-claude-desktop)
22. [Tests](#22-tests)

---

## 1. Überblick & Funktionen

- **Quittungen erstellen**: Positionen mit Beschreibung/Betrag, optional 8.1 %
  Mehrwertsteuer, fortlaufende Quittungsnummer.
- **Kundenverwaltung**: Kunden mit strukturierter Adresse speichern und wiederverwenden.
- **Firmendaten**: Name, Adresse, Kontakt, MWST-Nummer, QR-Rechnungs-Konto (IBAN),
  optional ein Firmenlogo (erscheint oben links auf Quittung/Rechnung).
- **QR-Einzahlungsschein**: Schweizer QR-Rechnung nach aktueller Spezifikation
  (strukturierte Adresse, ISO-11649-Referenz), funktioniert mit jeder normalen
  Schweizer/Liechtensteiner IBAN — keine QR-IBAN nötig.
- **PDF-Export**: Exakt positioniertes PDF direkt im Browser erzeugt (`pdf-lib`),
  QR-Rechnung landet garantiert am unteren Seitenrand.
- **Versand**: Per E-Mail oder WhatsApp (`wa.me`) mit vorausgefülltem Text. Die
  Windows-Version versendet E-Mails direkt per SMTP mit der PDF als Anhang
  (Abschnitt 18), die Web-Version öffnet das E-Mail-Programm (`mailto:`).
- **Lager und Seriennummern**: Bestand pro Artikel, Einzelstücke mit
  Seriennummer, Wareneingang per Barcode-Scanner, Protokoll aller
  Lagerbewegungen, Garantie-Suche nach Seriennummer (Abschnitt 17).
- **Verlauf & Bearbeiten**: Alle Quittungen einsehen, bearbeiten, löschen.
- **Buchhaltung**: Monats-/Jahresübersicht, offene/bezahlte Beträge, Excel-Export.
- **Zentrale Datenbank**: Alle Daten liegen in Cloudflare D1 — jedes Gerät sieht nach
  dem Login denselben, aktuellen Stand.
- **Backup & Datenübertragung**: Ein Klick exportiert Firma, alle Kunden und alle
  Quittungen/Rechnungen als eine einzelne JSON-Datei — für Backups im eigenen
  Cloud-Speicher oder zur Übertragung zwischen Web- und Windows-Version (siehe
  Abschnitt 16).
- **Passwortschutz**: Echter, serverseitiger Schutz (Basic Auth via Cloudflare Pages
  Function), inkl. Rate-Limiting gegen Brute-Force.
- **PWA**: Installierbar auf Desktop/Handy, mit Icon und Offline-Cache für die
  Oberfläche.
- **Nur in der Windows-Version**: automatische, verschlüsselte Sicherung
  (Abschnitt 19), Shop-Abgleich von Bestand und Preisen (Abschnitt 20) und ein
  lokaler Zugang für den Assistenten Claude (Abschnitt 21).

## 2. Voraussetzungen

- [Node.js](https://nodejs.org) 18 oder neuer (inkl. `npm`)
- Ein [GitHub](https://github.com)-Account
- Ein [Cloudflare](https://dash.cloudflare.com)-Account (kostenlos ausreichend)
- Git

## 3. Lokale Entwicklung

```bash
npm install
npm run dev
```

Öffnet die App unter `http://localhost:5173`.

> Hinweis: Im reinen `npm run dev`-Modus laufen die Cloudflare Pages Functions
> (`/api/storage`, Passwortschutz) **nicht** — dafür bräuchte es `wrangler pages dev`.
> Ohne Backend zeigt die Konsole 404-Fehler beim Speichern; die Oberfläche selbst lässt
> sich aber trotzdem bedienen und testen. Für einen vollständigen lokalen Test inkl.
> API und D1 siehe [Troubleshooting](#14-troubleshooting).

Weitere Befehle:

```bash
npm run build      # Produktions-Build nach dist/
npm run preview    # Baut nicht neu, zeigt nur dist/ lokal an
```

## 4. Projektstruktur

```
index.html                     Einstiegspunkt (Vite)
src/                            React-App (UI, Logik)
  App.jsx                       Hauptkomponente: alle Tabs, Formulare, Vorschau
  BuchhaltungTab.jsx             Buchhaltungs-Übersicht + Excel-Export
  Lager.jsx                      Wareneingang, Exemplare, Seriennummer-Suche, Lagerbewegungen
  EmailEinstellungen.jsx         SMTP-Einstellungen (nur Windows)
  BackupAutomatik.jsx            Automatische Sicherung (nur Windows)
  ShopAnbindung.jsx              Shop-Feed: Ziele, Status, Vorschau (nur Windows)
  Assistent.jsx                  Vorschläge, lokale Schnittstelle, Protokoll (nur Windows)
  QrBillDocument.jsx             Bildschirm-/Druckansicht des QR-Einzahlungsscheins
  qrbill.js                      Swiss-QR-Payload, IBAN-/Referenz-Prüfziffern
  pdfGenerator.js                Clientseitige PDF-Erzeugung (pdf-lib)
  apiStorage.js                  Speicher-Adapter, spricht mit D1 via /api/storage
  storageShim.js                 Alte localStorage-Variante (Referenz/Offline-Fallback)
shared/                          Reine Logik für App und Windows-Hauptprozess
  items.js                       Positionen: Menge, Listenpreis, Rabatt, Betrag
  stock.js, serials.js           Lagerbuchungen, Exemplare, Seriennummern
  consent.js                     Einverständnis E-Mail-Beleg
  backupFormat.js                Aufbau der Backup-Datei
  shopFeed.js                    Shop-Feed (ohne Seriennummern/Einkaufspreise)
  reports.js, drafts.js,         Auswertungen und Entwürfe für den Assistenten
  assistantTools.js
desktop/                         Windows-Version (Electron), siehe Abschnitt 15
mcp/                             MCP-Server für Claude Desktop, siehe Abschnitt 21
test/                            vitest-Tests, siehe Abschnitt 22
public/                          Icons, PWA-Manifest, Service Worker
functions/
  _middleware.js                 Passwortschutz + Rate-Limiting (läuft vor jedem Request)
  api/storage.js                 GET/POST/DELETE für einzelne Schlüssel (D1)
  api/storage-list.js            Auflisten von Schlüsseln nach Präfix (D1)
  api/storage-batch.js           Mehrere Schlüssel in einem Schritt (D1-Batch)
schema.sql                       Datenbankschema für Cloudflare D1
wrangler.toml                    Cloudflare-Konfiguration (D1-Binding, Compat-Flags)
vite.config.js                   Build-Konfiguration
```

## 5. Auf GitHub bringen

Falls das Repo noch nicht existiert:

```bash
git init
git add .
git commit -m "Initial commit: Qwui"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/DEIN-REPO.git
git push -u origin main
```

Ist das Repo (wie bei `munot-informatik/Qwui`) bereits verbunden, reicht ab jetzt:

```bash
git add .
git commit -m "Beschreibung der Änderung"
git push origin main
```

## 6. Deployment auf Cloudflare Pages

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Pages** → **Connect to Git** → dein Repo auswählen.
2. Build-Einstellungen:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
3. **Save and Deploy**.

Ab jetzt baut Cloudflare bei jedem `git push` auf `main` automatisch neu und
veröffentlicht die neue Version.

> Ohne die Schritte 7 und 8 unten ist die App zwar erreichbar, aber ohne Datenbank
> und ohne Passwortschutz. Beides einmalig einrichten, bevor echte Daten
> hineinkommen.

## 7. Zentrale Datenbank einrichten (Cloudflare D1)

Alle Daten (Firma, Kunden, Quittungen) liegen zentral in einer Cloudflare-D1-Datenbank
statt im Browser — dieselben Daten sind von jedem Gerät aus sichtbar, sobald man sich
anmeldet.

**Einmalige Einrichtung:**

1. Cloudflare Dashboard → **Workers & Pages** → **D1 SQL Database** →
   **Create database** (Name frei wählbar, z. B. `qwui-db`).
2. Datenbank öffnen → Tab **Console** → Inhalt von [`schema.sql`](schema.sql)
   einfügen und ausführen. Das legt die Tabelle `kv_store` an (ein generischer
   Key-Value-Speicher für Firma/Kunden/Quittungen/Rate-Limiting).
3. Pages-Projekt → **Settings → Functions → D1 database bindings** →
   **Add binding**: Variable name **`DB`** (exakt so, gross geschrieben), Datenbank
   auswählen → **Speichern**.
4. Neu deployen (z. B. mit einem leeren Commit oder über **Retry deployment**),
   damit die Bindung greift.

> Die `database_id` in [`wrangler.toml`](wrangler.toml) ist kein Geheimnis — es ist
> nur ein Bezeichner, kein Zugangsschlüssel. Sie darf bedenkenlos im Repo stehen;
> Zugriff auf die Datenbank erfordert einen authentifizierten Cloudflare-Account.

Die API-Endpunkte (`/api/storage`, `/api/storage-list`) sind durch dieselbe
`functions/_middleware.js` geschützt wie der Rest der Seite — ohne gültiges Passwort
kommt niemand an die Daten.

## 8. Passwortschutz einrichten

Der eigentliche Zugriffsschutz läuft über eine Cloudflare Pages Function
(`functions/_middleware.js`, bereits im Repo enthalten) und ist **echt
serverseitig** — das Passwort steht nirgends im ausgelieferten JavaScript und lässt
sich nicht über "Seitenquelltext ansehen" auslesen.

**Einrichtung:**

1. Pages-Projekt → **Settings → Environment variables** → **Add variable**.
2. Name: **`SITE_PASSWORD`**, Wert: dein Passwort (empfohlen: lang und zufällig,
   z. B. 20+ Zeichen — Brute-Force-Angriffe werden zusätzlich serverseitig
   abgeblockt, siehe [Sicherheit](#12-sicherheit)).
3. **Save**, danach neu deployen, damit die Variable greift.

Ohne gesetztes `SITE_PASSWORD` blockiert die App den Zugriff sicherheitshalber
komplett (kein offener Fallback-Modus).

**Optional, als zusätzliche Schicht:** Cloudflare Access (Login per E-Mail-Code oder
bestehendem Konto), lässt sich mit dem Passwortschutz kombinieren:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Zero Trust** →
   **Access → Applications → Add an application → Self-hosted**.
2. Domain deines Pages-Projekts eintragen.
3. Unter **Policies** eine Regel erstellen (z. B. eigene E-Mail-Adresse als
   "Include").
4. Speichern.

## 9. Erste Schritte in der App

Nach dem Login (Passwort aus Schritt 8) einmalig:

1. **Firma** (Sidebar) → Firmenname, Adresse, Kontakt, ggf. MWST-Nummer eintragen
   → **Speichern**. Optional ein **Firmenlogo hochladen** (erscheint danach oben
   links auf jeder Quittung/Rechnung, PDF und Druck) — ein Bild mit wenig Rand
   wirkt am besten, PNG mit transparentem Hintergrund wird unterstützt.
2. Falls QR-Rechnungen gewünscht: im selben Tab unter "QR-Rechnung" die
   Zahlungsempfänger-Adresse und die IBAN eintragen (Validierung erfolgt live,
   grüner Haken = gültige Schweizer/Liechtensteiner IBAN).
3. **Kunden** (optional vorab) → Kunden mit Adresse anlegen, damit sie später in der
   Quittung per Dropdown auswählbar sind. Alternativ kann pro Quittung auch ein
   Kunde manuell eingetragen werden.

**Eine Quittung erstellen:**

1. Tab **Neue Quittung** → Datum, Empfänger (gespeicherten Kunden wählen oder manuell
   eintragen), eine oder mehrere Positionen mit Betrag.
2. Optional **Mehrwertsteuerpflichtig** aktivieren (Normalsatz 8.1 %) — Netto/MWST/
   Total werden automatisch ausgerechnet.
3. Optional **Bezahlbar per Rechnung (QR-Einzahlungsschein)** aktivieren (setzt eine
   gültige IBAN unter Firma voraus). Ist diese Option aktiv, heisst das Dokument
   auf Bildschirm, PDF und Druck **"RECHNUNG"** statt **"QUITTUNG"** — schliesslich
   ist der Betrag noch nicht bezahlt, sondern erst fällig.
4. Ab CHF 400 Total ist laut OR Art. 958f die Adresse des Käufers gesetzlich
   vorgeschrieben — die App weist darauf hin, wenn sie fehlt.
5. **Quittung erstellen →** — Nummer wird automatisch fortlaufend vergeben.

**Verlauf & Buchhaltung:**

- Tab **Verlauf**: alle Quittungen öffnen, bearbeiten oder löschen.
- Tab **Buchhaltung**: nach Monat/Jahr filtern, offene vs. bezahlte QR-Rechnungen
  markieren, Summen einsehen, per Button **Export zu Excel** als `.xlsx`
  herunterladen. Offene QR-Rechnungen, deren 30-Tage-Zahlungsfrist abgelaufen ist,
  werden farblich hervorgehoben (inkl. Anzahl überfälliger Tage); für diese steht
  ein Button **Mahnung erstellen** bereit, der eine eigenständige Mahnungs-PDF mit
  erneut beigelegtem Einzahlungsschein generiert.

## 10. PDF-Erzeugung & Versand

In der Quittungs-Vorschau stehen mehrere Aktionen zur Verfügung:

- **PDF herunterladen**: erzeugt das PDF **clientseitig im Browser**
  (`src/pdfGenerator.js`, via `pdf-lib`) — kein Server-Umweg. Jedes Element wird mit
  exakten Koordinaten selbst platziert; ist die QR-Rechnung aktiviert, landet sie
  dadurch garantiert am unteren Seitenrand, unabhängig von Browser/Druck-Engine und
  unabhängig von der Länge der Quittung.
- **Drucken**: klassischer Browser-Druckdialog (`window.print()`) als Alternative.
- **Per E-Mail senden**: In der Windows-Version geht die E-Mail direkt mit der
  PDF als Anhang hinaus (Abschnitt 18). In der Web-Version öffnet sich das
  E-Mail-Programm mit vorausgefülltem Betreff/Text (kein automatischer Anhang
  möglich — PDF vorher herunterladen und manuell anhängen).
- **Per WhatsApp senden**: öffnet WhatsApp (App oder Web) mit fertigem Text; ist eine
  Telefonnummer beim Kunden hinterlegt, wird der Chat direkt vorausgewählt.
- **Teilen** (nur sichtbar, wenn das Gerät es unterstützt — v. a. mobile Browser):
  übergibt die Quittung direkt als PDF-Anhang an den nativen Teilen-Dialog des
  Geräts (WhatsApp, Mail, weitere Apps), ohne den Umweg über „PDF herunterladen"
  und manuelles Anhängen. Nutzt die
  [Web Share API (Level 2)](https://developer.mozilla.org/docs/Web/API/Navigator/canShare);
  auf Desktop-Browsern ohne Unterstützung bleibt der Button ausgeblendet, die
  bisherigen Wege (Herunterladen, E-Mail, WhatsApp) funktionieren dort unverändert.

## 11. Als App installieren (PWA)

Qwui liefert ein Web-App-Manifest und einen Service Worker mit, dadurch:

- **Desktop (Chrome/Edge)**: Adressleiste → Install-Icon → "Qwui installieren".
- **Android**: Browser-Menü → "Zum Startbildschirm hinzufügen".
- **iOS (Safari)**: Teilen-Menü → "Zum Home-Bildschirm".

Die Oberfläche (HTML/CSS/JS) wird für schnelleren Start zwischengespeichert. API-
Aufrufe (`/api/...`) sind davon ausgenommen und laden immer frisch vom Server, damit
nie veraltete Firmen-/Kunden-/Quittungsdaten angezeigt werden.

## 12. Sicherheit

Kurzüberblick, was bereits eingebaut ist:

- **Serverseitiger Passwortschutz** vor jedem Request (`functions/_middleware.js`),
  nicht im Client-Code auslesbar.
- **Konstante-Zeit-Vergleich** des Passworts (SHA-256-Hash-Vergleich statt direktem
  String-Vergleich) — kein Timing-Seitenkanal.
- **Rate-Limiting**: nach 100 fehlgeschlagenen Login-Versuchen pro IP innerhalb von
  15 Minuten wird mit `429 Too Many Requests` gesperrt. Die Sperre wird VOR dem
  Passwortvergleich geprüft — sonst käme ein Angreifer mit einem Glückstreffer
  trotz überschrittenem Limit durch und das Limit wäre wirkungslos.
  Die Grenze ist bewusst hoch: davor steht bereits Cloudflare Access, und ein
  20-stelliges Passwort lässt sich ohnehin nicht durchprobieren. Ein niedriger
  Wert würde daher nur den rechtmässigen Nutzer aussperren. Übrig bleibt eine
  Bremse gegen Schleifen, die sonst unbegrenzt in die Datenbank schreiben.
- **Parametrisierte D1-Queries** überall — kein SQL-Injection-Risiko.
- **`database_id` in `wrangler.toml` ist unbedenklich** im Repo (siehe Hinweis in
  Abschnitt 7) — kein Geheimnis, sondern nur ein Bezeichner.
- **`.gitignore`** schliesst `.dev.vars`, `node_modules/`, `dist/` und Logs aus —
  echte Secrets (`SITE_PASSWORD`) werden ausschliesslich über Cloudflare
  Environment Variables gesetzt, nie im Code.

Was bewusst nicht umgesetzt ist (da für den Anwendungsfall nicht nötig): einzelne
Benutzerkonten/Rollen — alle, die das eine Passwort kennen, haben vollen Zugriff auf
alle Daten. Wer das nicht will, kann zusätzlich Cloudflare Access (Abschnitt 8)
einrichten, um den Zugriff auf bestimmte E-Mail-Adressen einzuschränken.

## 13. Updates & weitere Deployments

Für jede weitere Änderung reicht:

```bash
git add .
git commit -m "Beschreibung der Änderung"
git push origin main
```

Cloudflare Pages baut daraufhin automatisch neu und veröffentlicht die neue Version
innerhalb weniger Minuten (Fortschritt im Cloudflare Dashboard unter
**Workers & Pages → dein Projekt → Deployments** sichtbar).

## 14. Troubleshooting

**"Speichern fehlgeschlagen" / 404 bei `/api/storage` in der lokalen Entwicklung**
Erwartet bei reinem `npm run dev` — die Pages Functions laufen nur auf Cloudflare
selbst oder lokal über die Cloudflare-CLI `wrangler` (`npm install -g wrangler`,
danach `npm run build` gefolgt von `wrangler pages dev dist`; die D1-Bindung aus
`wrangler.toml` wird dabei automatisch berücksichtigt — Details in der offiziellen
Wrangler-Dokumentation von Cloudflare).

**Zugriff komplett verweigert (401), obwohl Passwort stimmt**
`SITE_PASSWORD` in den Environment Variables des Pages-Projekts prüfen (Tippfehler,
führende/nachfolgende Leerzeichen) und danach neu deployen — Variablenänderungen
gelten erst ab dem nächsten Deployment.

**"Zu viele fehlgeschlagene Versuche" (429)**
Rate-Limiting hat nach 100 Fehlversuchen in 15 Minuten gegriffen (siehe
Abschnitt 12). Der `Retry-After`-Header in der Antwort gibt an, in wie vielen
Sekunden es weitergeht — einfach kurz warten und erneut versuchen.

**QR-Rechnung wird nicht angeboten / Hinweis "gültige IBAN" erscheint**
Unter **Firma → QR-Rechnung** muss eine gültige Schweizer (`CH...`) oder
liechtensteinische (`LI...`) IBAN mit korrekter Prüfziffer hinterlegt sein (grüner
Haken = gültig).

**Build schlägt fehl**
`npm install` erneut ausführen (stellt sicher, dass `node_modules/` vollständig ist)
und danach `npm run build`. Bei Fehlermeldungen zur `xlsx`-Abhängigkeit: Diese wird
bewusst direkt von `cdn.sheetjs.com` bezogen (offizieller Vertriebsweg von
SheetJS), nicht vom npm-Registry — eine funktionierende Internetverbindung beim
`npm install` ist dafür nötig.

**Daten von Gerät A erscheinen nicht auf Gerät B / Eingaben verschwinden nach Reload**
Sicherstellen, dass auf beiden Geräten dasselbe Cloudflare-Pages-Projekt (Domain)
verwendet wird und die D1-Bindung (Abschnitt 7) korrekt eingerichtet ist. Es gibt
keinen lokalen Fallback-Speicher — ohne funktionierende D1-Bindung schlägt jedes
Speichern und Laden fehl (sichtbar als Fehler in der Browser-Konsole), Eingaben
gehen dann nach einem Neuladen der Seite verloren.

## 15. Desktop-Version (Windows .exe)

Neben der gehosteten Web-App gibt es eine eigenständige Windows-Version mit
identischem Funktionsumfang (Firma, Kunden, Quittungen/Rechnungen inkl.
QR-Rechnung, PDF-Erzeugung, Buchhaltung inkl. Mahnwesen, Lager) — läuft komplett
offline, **ohne Installation**, und speichert alle Daten lokal in einer
SQLite-Datenbank statt in Cloudflare D1. Dazu kommen Funktionen, die nur lokal Sinn
ergeben: E-Mail-Versand per SMTP, automatische Sicherung, Shop-Abgleich und der
Zugang für den Assistenten (Abschnitte 18–21). Technisch ein zweites, kleines Teilprojekt in `desktop/`
(Electron), das dieselbe React-Oberfläche lädt wie die Web-App — nur der
Speicher-Adapter ist ausgetauscht (`src/electronStorage.js` statt
`src/apiStorage.js`, automatisch erkannt in `src/main.jsx`).

**Download:** Fertige `.exe`-Dateien zum direkten Herunterladen unter
[Releases](https://github.com/munot-informatik/Qwui/releases) — kein eigenes
Bauen nötig, einfach herunterladen und doppelklicken.

### Bauen

```bash
npm install
npm run build          # Web-App im Projekt-Root bauen (dist/)
cd desktop
npm install
npm run dist            # kopiert dist/ und shared/ hinein und erzeugt die portable .exe
```

Die fertige `Qwui-<Version>.exe` liegt danach in `desktop/release/`. Einfach
doppelklicken — kein Installer, keine Admin-Rechte nötig. Da die .exe nicht mit
einem kostenpflichtigen Zertifikat signiert ist, zeigt Windows beim ersten Start
die SmartScreen-Warnung "Windows hat den PC geschützt" — **weitere Informationen**
→ **Trotzdem ausführen** ist normal und kein Fehler.

Für die Entwicklung: `npm run dev` in `desktop/` startet Electron gegen den
laufenden Vite-Dev-Server (`npm run dev` im Projekt-Root muss dafür parallel
laufen) statt gegen den gebauten `dist/`-Ordner.

**Windows-Entwicklermodus nötig zum Bauen:** `npm run dist` lädt u. a. das
Cross-Platform-Tool `winCodeSign` herunter, das intern macOS-Symlinks enthält.
Ohne aktivierten Windows-Entwicklermodus (oder ohne Ausführung als
Administrator) schlägt allein das Entpacken dieses Tools mit "Cannot create
symbolic link" fehl — die eigentliche App wird davon nicht beeinträchtigt
(`desktop/release/win-unpacked/Qwui.exe` funktioniert bereits einwandfrei),
nur der letzte Schritt (Verpacken zu einer einzelnen portablen .exe-Datei)
bricht ab. Fix: **Einstellungen → Datenschutz und Sicherheit → Für
Entwickler → Entwicklermodus** einmalig aktivieren, dann `npm run dist`
erneut ausführen.

### Wo die Daten liegen

**Direkt neben der .exe-Datei** — nur eine Datei herunterladen, doppelklicken,
fertig. Beim ersten Start wird dort automatisch ein Ordner `Qwui-Daten\`
angelegt (im selben Verzeichnis, in dem die `Qwui.exe` liegt), darin:

- **`qwui.db`** — die Datenbank (SQLite) mit Firma, Kunden, Quittungen,
  Inventar, Exemplaren und Lagerbewegungen. Gleicher Aufbau wie die
  Cloudflare-Datenbank der Web-Version (Tabelle `kv_store`). Die Dateien
  `qwui.db-wal` und `qwui.db-shm` daneben gehören dazu.
- **`geheim.bin`** — Passwörter und Tokens (SMTP, Sicherung, Shop, Assistent),
  verschlüsselt mit der Windows-Verschlüsselung des angemeldeten Benutzers.
  Auf einem anderen PC oder in einem anderen Windows-Konto lässt sich die Datei
  nicht lesen — die Passwörter müssen dort neu eingegeben werden.
- **`logos/`** — hochgeladene Firmenlogos als eigene Bilddateien.

**Umstieg von Version 1.1:** Bis 1.1 lagen die Daten in `Qwui-Daten.xlsx` und
`firma.json`. Beim ersten Start mit 1.2.0 übernimmt Qwui sie vollständig in die
Datenbank; für jeden Artikel mit Bestand entsteht dabei eine Inventurkorrektur
«Übernahme aus Qwui-Daten.xlsx». Beide Dateien bleiben **unverändert** als
Sicherung liegen; die Excel-Datei lässt sich über das Menü **Qwui →
Excel-Sicherung aus Version 1.1 öffnen** ansehen. Änderungen darin wirken sich
nicht mehr auf Qwui aus.

**Excel-Auswertung:** Über **Backup → Excel-Auswertung erstellen** (oder das
Menü **Qwui**) entsteht eine Excel-Datei mit den Blättern Kunden, Zahlungen,
Inventar, Exemplare und Lagerbewegungen — zum Ansehen, Filtern und
Weitergeben, z. B. an die Treuhand. **Ampel-Farben** in der Spalte
"Zahlungsstatus": Grün = bezahlt/Direktzahlung, Orange = offen, Zahlungsfrist
noch nicht abgelaufen, Rot = offen und überfällig. Kunden lassen sich nicht
mehr in Excel bearbeiten, sondern nur noch in der App.

**Backup-Empfehlung:** Die automatische Sicherung einschalten (Abschnitt 19).
Sie legt stündlich und täglich eine verschlüsselte Kopie in einen Cloud-Ordner.

**Verschieben der .exe:** Liegt die `Qwui.exe` z. B. auf einem USB-Stick oder wird
in einen anderen Ordner verschoben, wandert der `Qwui-Daten\`-Ordner beim nächsten
Start automatisch mit — die App findet ihre Daten immer relativ zur eigenen
.exe-Datei (technisch über die von electron-builders portablem Windows-Build
gesetzte Umgebungsvariable `PORTABLE_EXECUTABLE_DIR`). Der erste Start einer
neuen .exe dauert einige Sekunden länger, weil sie sich zuerst entpackt.

## 16. Backup & Datenübertragung (Web ↔ Windows)

Tab **Backup** (in beiden Versionen identisch vorhanden) exportiert Firma, alle
Kunden, alle Quittungen/Rechnungen, das Inventar samt Exemplaren und die
Lagerbewegungen als eine einzelne JSON-Datei
(`Qwui-Backup_JJJJ-MM-TT.json`) und kann dieselbe Datei wieder importieren. Damit
lassen sich drei Fälle abdecken, ohne eine echte bidirektionale Cloud-Synchronisation
(Login-Popup, automatischer Merge) bauen zu müssen — bei einer einzelnen Firma pro
Installation ist ein einfacher "Schnappschuss exportieren / importieren"-Ansatz
zuverlässiger als ein automatischer Zwei-Wege-Abgleich mit Konfliktauflösung:

- **Windows → Web**: In der Windows-App **Backup → Alle Daten exportieren**, die
  JSON-Datei in der Web-App unter **Backup → Backup-Datei auswählen** importieren.
  Praktisch z. B. für wöchentliches Übertragen, wenn hauptsächlich offline am
  Windows-Rechner gearbeitet wird.
- **Web → Windows**: Gleicher Weg umgekehrt — z. B. als Notfall-Wiederherstellung
  auf einem neuen Windows-Rechner, falls die lokalen Daten dort verloren gehen.
- **Reines Backup**: Die exportierte JSON-Datei regelmässig (z. B. monatlich) im
  eigenen Cloud-Speicher ablegen (ProtonDrive, OneDrive, Google Drive, …) —
  unabhängig von der App selbst, einfach eine normale Datei.

**Wichtig — ein Import ersetzt vollständig:** Firma, alle Kunden und alle
Quittungen werden beim Import komplett durch den Inhalt der Backup-Datei ersetzt,
nicht zusammengeführt. Die App warnt davor direkt im Backup-Tab und zeigt vor dem
eigentlichen Import eine Vorschau (Firmenname, Anzahl Kunden/Quittungen, Exportdatum)
zur Kontrolle an. Am besten vor einem Import selbst nochmal ein aktuelles Backup der
Zielversion ziehen, falls der Import rückgängig gemacht werden müsste.

Die JSON-Datei enthält alle Daten unverschlüsselt im Klartext (inkl. Kundenadressen)
— beim Ablegen in einem Cloud-Speicher gilt dessen übliche Verschlüsselung/Zugriffs-
schutz, wie bei jeder anderen dort gespeicherten Datei auch. Für regelmässige
Sicherungen in die Cloud gibt es in der Windows-Version die automatische,
verschlüsselte Sicherung (Abschnitt 19).

Backups aus Version 1.1 enthalten noch keine Exemplare und Lagerbewegungen. Beim
Import bleiben die vorhandenen dann stehen; die Vorschau weist darauf hin, dass
Bestand und Quittungen danach im Inventar zu prüfen sind.

## 17. Lager und Seriennummern

Reiter **Inventar**, oben vier Bereiche: Artikel, Wareneingang, Seriennummer
suchen, Lagerbewegungen. Funktioniert in der Web- und der Windows-Version.

**Seriennummernpflicht:** Hochpreisige Einzelstücke (z. B. Queues) bekommen
beim Artikel das Häkchen **S/N-Pflicht**. Jedes Exemplar hat dann eine eigene
Seriennummer und einen Status — an Lager, reserviert, verkauft, retourniert.
Die Stückzahl lässt sich bei diesen Artikeln nicht mehr eintippen, sie ergibt
sich aus den Exemplaren **an Lager**. Über **Exemplare** beim Artikel klappt
die Liste auf; dort lassen sich Reservation und Retoure von Hand setzen und
Bemerkungen erfassen. Einschalten lässt sich die Pflicht bei Bestand 0,
ausschalten nur, solange keine Exemplare erfasst sind.

**Wareneingang:** Ein Barcode-Scanner verhält sich wie eine Tastatur: er tippt
den Code und drückt Enter.

1. Artikelnummer scannen (oder den Artikel wählen). Ist sie unbekannt, bietet
   Qwui an, den Artikel gleich anzulegen.
2. Bei Seriennummernpflicht die Seriennummern hintereinander scannen — der
   Fokus bleibt im Feld, doppelte Scans und bereits erfasste Nummern
   erscheinen sofort rot. Sonst die Menge eingeben.
3. Optional Einkaufspreis und Bemerkung (z. B. Lieferschein), dann
   **Wareneingang buchen**.

**Verkauf:** In der Quittung bei der Position **Produkt** den Artikel wählen.
Bei Seriennummernpflicht muss ein Exemplar gewählt werden, sonst wird die
Quittung nicht erstellt; die Seriennummer steht danach als «S/N: …» auf dem
Beleg. Bei anderen Artikeln gibt es das Feld **Menge**. Erstellen, Bearbeiten
und Löschen buchen den Bestand mit — beim Bearbeiten und Löschen als Storno,
nichts wird still überschrieben. Unter 0 warnt Qwui, verkauft aber trotzdem.
Quittungen von vor 1.2.0 haben nichts gebucht; ihr Löschen verändert den
Bestand nicht.

**Lagerbewegungen:** Jeder Wareneingang, Verkauf, Storno und jede
Inventurkorrektur (Stückzahl von Hand oder per Excel-Import geändert) steht
mit Zeitpunkt, Seriennummer, Menge, Referenz und Quelle (App oder Assistent)
im Protokoll. Reservierte Exemplare zählen nicht als verfügbar, erzeugen aber
keine Bewegung.

**Garantiefall:** **Seriennummer suchen** zeigt Artikel, Status, Eingangs- und
Verkaufsdatum, Quittung und Kunde — mit Sprung direkt zur Quittung.

**Gespeichert in einem Schritt:** Quittung, Exemplare, Bestand und
Lagerbewegungen eines Verkaufs werden zusammen gespeichert — unter Windows in
einer Datenbank-Transaktion, im Web über `/api/storage-batch` als D1-Batch.
Bricht das Speichern ab, bleibt alles beim alten Stand.

## 18. E-Mail-Versand (Windows)

Die Windows-Version verschickt Quittungen und Rechnungen direkt per SMTP, die
PDF hängt automatisch an.

**Einrichten:** **Firma → E-Mail-Versand (SMTP)**: Server, Verschlüsselung
(STARTTLS meist Port 587, SSL/TLS meist Port 465), Benutzer, Passwort, Absender.
Die Angaben stehen beim E-Mail-Anbieter unter "Postausgangsserver". **Test-Mail
senden** prüft die Einstellungen sofort. Das Passwort liegt verschlüsselt in
`geheim.bin` und wird in der App nie wieder angezeigt.

**Versenden:** Beim Erstellen einer Quittung unter **Nach dem Erstellen** «Per
E-Mail senden» und/oder «Drucken» wählen — E-Mail ist vorgewählt, sobald beim
Kunden eine Adresse hinterlegt ist. In der Vorschau verschickt **Per E-Mail
senden** jederzeit erneut. Ob der Versand geklappt hat (oder mit welcher
Meldung er scheiterte), steht an der Quittung und im Verlauf.

**Einverständnis «E-Mail-Beleg»:** Beim Kunden lässt sich das Einverständnis
mit Datum erfassen. Ohne Einverständnis wird die E-Mail-Adresse **nicht
gespeichert** — weder beim Kunden noch auf der Quittung; sie dient nur dem einen
Versand. Kunden aus Version 1.1 behalten ihre Adresse; die Kundenliste zeigt
"Einverständnis fehlt" und bietet an, es zu erfassen oder die Adresse zu
entfernen.

Die Web-Version bleibt beim bisherigen Weg (`mailto:`, Teilen-Dialog).

## 19. Automatische Sicherung (Windows)

**Backup → Automatische Sicherung:** Stündlich und täglich eine Sicherung aller
Daten — im selben Format wie «Alle Daten exportieren», zusätzlich mit den
Einstellungen (ohne Passwörter) — in einen frei wählbaren Ordner. Am besten ein
Ordner, den Proton Drive, OneDrive o. ä. mit der Cloud abgleicht; Qwui selbst
lädt nichts hoch.

- **Verschlüsselt** mit einem Backup-Passwort (mind. 8 Zeichen; AES-256-GCM,
  Schlüssel per scrypt). Ohne Passwort wird nicht gesichert — die App zeigt das
  als Hinweis an. **Das Passwort gut aufbewahren** (z. B. im Passwort-Manager):
  ohne es lässt sich keine Sicherung öffnen.
- **Dateien:** `Qwui-Backup_stuendlich_JJJJ-MM-TT_hh-mm-ss.qwuibak` bzw.
  `…_taeglich_…`. Behalten werden 48 stündliche und 30 tägliche; ältere löscht
  Qwui. Andere Dateien im Ordner bleiben unberührt.
- **Wann:** Gesichert wird, solange Qwui läuft. War die App geschlossen, holt sie
  die fällige Sicherung kurz nach dem nächsten Start nach. **Jetzt sichern**
  sichert sofort.
- **Status:** Letzte Sicherung und allfällige Fehler (z. B. Cloud-Ordner nicht
  erreichbar) stehen im Backup-Reiter.

**Wiederherstellen:** **Backup → Backup-Datei auswählen**, die `.qwuibak`-Datei
wählen und das Backup-Passwort eingeben. Danach erscheint die gewohnte
Vorschau. Einstellungen (SMTP-Server, Backup-Ordner) werden mit übernommen,
Passwörter müssen neu eingegeben werden. Die Web-Version kann verschlüsselte
Sicherungen nicht öffnen; für die Übertragung Windows → Web bleibt «Alle Daten
exportieren».

## 20. Shop-Anbindung (Windows)

Reiter **Shop-Anbindung:** Nach jeder Lagerbewegung und Preisänderung geht ein
Shop-Feed hinaus — pro Artikel Artikelnummer, Name, Produktgruppe, Preis,
verfügbare Menge und Status (verfügbar/ausverkauft). **Seriennummern und
Einkaufspreise sind nie enthalten.**

- **Datei-Feed:** `qwui-shop-feed.json` und `qwui-shop-feed.csv` (Semikolon)
  in einen gewählten Ordner.
- **Webhook:** Der Feed als JSON per HTTPS-POST an eine Adresse des Shops,
  optional mit Token (`Authorization: Bearer …`, verschlüsselt gespeichert).
  Nur ausgehend — Qwui nimmt keine Verbindungen aus dem Internet an.

Schlägt ein Abgleich fehl, versucht Qwui es nach 1, 5 und 15 Minuten erneut.
Mehrere schnelle Änderungen werden zu einem Abgleich gebündelt, unveränderte
Feeds nicht erneut geschickt. **Jetzt abgleichen** schickt sofort; Status und
Vorschau zeigen, was der Shop zuletzt bekommen hat.

Die Anbindung eines bestimmten Shopsystems (z. B. WooCommerce) wäre ein
weiterer Adapter in `desktop/shopSync.js`.

## 21. Assistent (Claude Desktop)

Claude kann Qwui bedienen, **ohne dass Qwui aus dem Internet erreichbar ist**:
Die Windows-App öffnet auf Wunsch eine Schnittstelle nur auf diesem PC
(`127.0.0.1`), und ein kleiner MCP-Server (`mcp/`) verbindet Claude Desktop
damit. Claude Desktop muss dafür auf demselben PC laufen.

**Werkzeuge:** `artikel_suchen`, `bestand_abfragen`, `seriennummer_suchen`,
`umsatz_auswerten`, `ladenhueter`, `wareneingang_vorschlagen`,
`artikel_vorschlagen`, `backup_status`.

- **Nur Entwürfe:** Wareneingänge und neue Artikel aus Claude erscheinen in
  Qwui unter **Assistent → Vorschläge des Assistenten** und werden erst mit
  **Übernehmen** gebucht (Lagerbewegungen mit Quelle «Assistent»).
- **Datenschutz:** Der Assistent bekommt keine Namen, Adressen, E-Mails oder
  Telefonnummern, nur Kunden-IDs; die Zuordnung macht der Laden in Qwui.
  Geschäftszahlen wie Bestand und Umsatz gehen aber an Claude und damit an
  Anthropic.
- **Protokoll:** Jeder Zugriff steht mit Zeit, Werkzeug und Ergebnis unter
  **Assistent**.

**Einrichten (einmalig):**

1. [Node.js](https://nodejs.org) (LTS) installieren.
2. Den Ordner `mcp/` aus diesem Repository auf den PC kopieren und darin
   einmal ausführen:

   ```bash
   npm install
   ```

3. In Qwui **Assistent → Lokale Schnittstelle einschalten → Speichern**. Qwui
   erzeugt ein Zugriffstoken und zeigt den fertigen Eintrag für Claude Desktop.
4. In Claude Desktop **Einstellungen → Entwickler → Konfiguration bearbeiten**
   und den Eintrag einfügen, mit dem richtigen Pfad zu `server.js`:

   ```json
   {
     "mcpServers": {
       "qwui": {
         "command": "node",
         "args": ["C:\\Qwui\\mcp\\server.js"],
         "env": {
           "QWUI_API_URL": "http://127.0.0.1:47110",
           "QWUI_API_TOKEN": "<Token aus Qwui>"
         }
       }
     }
   }
   ```

5. Claude Desktop neu starten. Probe: «Wie viele Predator-Queues haben wir an
   Lager?»

**Sicherheit:** Die Schnittstelle ist standardmässig aus und lauscht nur auf
`127.0.0.1`. Ohne gültiges Token, aus einem Browser (Origin-Header) oder unter
fremdem Host-Namen (DNS-Rebinding) wird jede Anfrage abgewiesen. Das Token wie
ein Passwort behandeln; **Erneuern** macht das alte sofort ungültig (danach den
Eintrag in Claude Desktop anpassen).

## 22. Tests

```bash
npm install
(cd desktop && npm install)
(cd mcp && npm install)
npm test
```

Die Tests (vitest, Ordner `test/`) prüfen u. a. Belegsinhalt und Seitenlayout der
PDF, Lagerbuchungen und Seriennummern, die Übernahme aus `Qwui-Daten.xlsx`, den
SQLite-Speicher, E-Mail-Versand gegen einen lokalen SMTP-Testserver,
Verschlüsselung und Rotation der Sicherungen, Shop-Feed und Webhook, die lokale
Schnittstelle samt Token-Schutz und den MCP-Server über stdio. Abhängigkeiten
aus `desktop/` und `mcp/` werden dafür gebraucht, deshalb die drei
`npm install`.
