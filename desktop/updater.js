// Updates für die Windows-Version (portable .exe). Qwui fragt GitHub nach der
// neuesten veröffentlichten Version — dabei geht nur die Anfrage selbst
// hinaus, keine Daten aus Qwui. Ist eine neuere da, lädt Qwui sie auf Knopfdruck
// herunter, prüft die SHA-256-Prüfsumme, die GitHub zur Datei angibt, und
// tauscht die .exe aus:
//
//   Qwui-1.4.0.exe        → Qwui-1.4.0.exe.alt   (die laufende Datei)
//   Qwui-1.5.0.download   → Qwui-1.4.0.exe       (neue Version, alter Name)
//
// So bleiben Verknüpfungen auf dem Desktop gültig, und der Datenordner
// «Qwui-Daten» liegt weiter daneben. Windows erlaubt das Umbenennen einer
// laufenden .exe, nicht aber das Überschreiben. Die .alt-Datei räumt die neue
// Version beim nächsten Start weg. Klappt das Umbenennen nicht (z. B. fehlende
// Rechte), landet die neue Version als «Qwui-1.5.0.exe» daneben.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const REPO = "munot-informatik/Qwui";
export const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_EXE_BYTES = 400 * 1024 * 1024;

// «v1.5.0» / «1.5.0» → [1, 5, 0]; Vorabversionen und Unsinn → null.
export function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(remote, current) {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// Antwort von GitHub → was die App braucht. Die .exe muss «Qwui-<Version>.exe»
// heissen, von github.com kommen und eine SHA-256-Prüfsumme haben — sonst wird
// nicht automatisch installiert, nur auf die Seite verwiesen.
export function releaseInfo(release, currentVersion) {
  const version = String(release?.tag_name || "").replace(/^v/, "");
  if (!parseVersion(version)) return { available: false, error: "Die Antwort von GitHub enthält keine gültige Version." };
  const pageUrl = String(release.html_url || "");
  const info = {
    available: isNewer(version, currentVersion),
    version,
    notes: String(release.body || "").slice(0, 4000),
    publishedAt: release.published_at || null,
    pageUrl: pageUrl.startsWith(`https://github.com/${REPO}/releases/`) ? pageUrl : RELEASES_PAGE,
    asset: null,
    problem: null,
  };
  const asset = (release.assets || []).find((a) => a?.name === `Qwui-${version}.exe`);
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset?.digest || ""));
  const url = String(asset?.browser_download_url || "");
  if (!asset) {
    info.problem = `Zur Version ${version} gibt es keine Datei Qwui-${version}.exe.`;
  } else if (!url.startsWith(`https://github.com/${REPO}/releases/download/`)) {
    info.problem = "Die Download-Adresse der neuen Version ist unerwartet.";
  } else if (!digest) {
    info.problem = "GitHub nennt zur neuen Version keine Prüfsumme — bitte von Hand herunterladen.";
  } else if (!(asset.size > 0 && asset.size <= MAX_EXE_BYTES)) {
    info.problem = "Die Grösse der neuen Version ist unerwartet.";
  } else {
    info.asset = { name: asset.name, url, size: asset.size, sha256: digest[1].toLowerCase() };
  }
  return info;
}

// Lädt die Datei nach target, prüft Grösse und Prüfsumme. onProgress(bytes).
export async function downloadVerified(fetchImpl, asset, target, onProgress = () => {}) {
  const res = await fetchImpl(asset.url, {
    headers: { "User-Agent": "Qwui-Update", Accept: "application/octet-stream" },
    redirect: "follow",
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`);
  const hash = createHash("sha256");
  let received = 0;
  const meter = new Transform({
    transform(chunk, _enc, done) {
      received += chunk.length;
      if (received > MAX_EXE_BYTES) return done(new Error("Die Datei ist grösser als angekündigt."));
      hash.update(chunk);
      onProgress(received);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(target));
    if (received !== asset.size) throw new Error("Die Datei ist unvollständig angekommen.");
    if (hash.digest("hex") !== asset.sha256) throw new Error("Die Prüfsumme der heruntergeladenen Datei stimmt nicht.");
  } catch (e) {
    await rm(target, { force: true });
    throw e;
  }
}

// Neue .exe an die Stelle der laufenden setzen. Liefert den Pfad, der gestartet
// werden soll, und ob der alte Name erhalten blieb.
export async function swapExecutable({ exeFile, downloaded, version }) {
  const dir = dirname(exeFile);
  const backup = `${exeFile}.alt`;
  await rm(backup, { force: true });
  try {
    await rename(exeFile, backup);
  } catch {
    const target = join(dir, `Qwui-${version}.exe`);
    await rm(target, { force: true });
    await rename(downloaded, target);
    return { target, keptName: false };
  }
  try {
    await rename(downloaded, exeFile);
  } catch (e) {
    // Zurück auf den alten Stand, sonst fehlte die .exe ganz.
    await rename(backup, exeFile).catch(() => {});
    throw e;
  }
  return { target: exeFile, keptName: true };
}

// Reste eines früheren Updates neben der .exe wegräumen (.alt, abgebrochene
// Downloads). Nur eigene Dateien, nie etwas anderes. also: weitere Namen, z. B.
// die .alt-Kopie einer umbenannten .exe («Kasse.exe.alt»).
export async function cleanupLeftovers(dir, also = []) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const ours = /^Qwui.*\.exe\.alt$/i.test(name) || /^Qwui-\d+\.\d+\.\d+\.download$/i.test(name) || also.includes(name);
    if (!ours) continue;
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile()) continue;
      await rm(join(dir, name), { force: true });
      removed.push(name);
    } catch {
      // Noch in Gebrauch (die alte Version beendet sich gerade) — nächstes Mal.
    }
  }
  return removed;
}

// deps: { currentVersion, exeFile (null ausserhalb der portablen .exe),
//         getEnabled, readStatus, writeStatus, fetch?, now?, launch(target), quit() }
export function createUpdater({
  currentVersion,
  exeFile,
  getEnabled,
  readStatus,
  writeStatus,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  launch,
  beforeInstall = async () => {},
}) {
  let checking = null;
  let installing = false;
  let progress = null;

  function state() {
    return {
      currentVersion,
      enabled: !!getEnabled(),
      canInstall: !!exeFile,
      ...(readStatus() || {}),
      progress,
      installing,
    };
  }

  async function checkOnce() {
    const at = now().toISOString();
    try {
      const res = await fetchImpl(RELEASES_URL, {
        headers: { "User-Agent": "Qwui-Update", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (res.status === 404) throw new Error("Noch keine Version veröffentlicht.");
      if (!res.ok) throw new Error(`GitHub antwortet mit HTTP ${res.status}.`);
      const info = releaseInfo(await res.json(), currentVersion);
      if (info.error) throw new Error(info.error);
      writeStatus({ checkedAt: at, error: null, latest: info });
    } catch (e) {
      writeStatus({ ...(readStatus() || {}), checkedAt: at, error: e.message || String(e) });
    }
    return state();
  }

  function check() {
    if (!checking) checking = checkOnce().finally(() => (checking = null));
    return checking;
  }

  return {
    state,
    check,
    // Für den Zeitgeber: nur, wenn eingeschaltet und die letzte Prüfung alt ist.
    async checkIfDue() {
      if (!getEnabled()) return state();
      const last = Date.parse(readStatus()?.checkedAt || "");
      if (Number.isFinite(last) && now().getTime() - last < CHECK_INTERVAL_MS) return state();
      return check();
    },
    async install() {
      if (installing) return { ok: false, error: "Das Update läuft schon." };
      if (!exeFile) return { ok: false, error: "Automatisch aktualisieren geht nur in der Windows-Version (Qwui-….exe)." };
      const latest = readStatus()?.latest;
      if (!latest?.available || !latest.asset) {
        return { ok: false, error: latest?.problem || "Es ist kein Update verfügbar." };
      }
      installing = true;
      progress = { received: 0, total: latest.asset.size };
      const downloaded = join(dirname(exeFile), `Qwui-${latest.version}.download`);
      try {
        await downloadVerified(fetchImpl, latest.asset, downloaded, (received) => {
          progress = { received, total: latest.asset.size };
        });
        await beforeInstall();
        const { target, keptName } = await swapExecutable({ exeFile, downloaded, version: latest.version });
        launch(target);
        return { ok: true, target: basename(target), keptName };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      } finally {
        installing = false;
        progress = null;
      }
    },
  };
}
