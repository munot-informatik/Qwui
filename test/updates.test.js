// Updates der Windows-Version: Nur eine neuere, vollständige Datei mit
// stimmender Prüfsumme darf die laufende .exe ersetzen, und der Austausch
// muss den alten Namen behalten (Verknüpfungen) oder sauber ausweichen.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  parseVersion,
  isNewer,
  releaseInfo,
  downloadVerified,
  swapExecutable,
  cleanupLeftovers,
  createUpdater,
  RELEASES_URL,
} from "../desktop/updater.js";

const BYTES = Buffer.from("MZ neue Qwui-Version ".repeat(200));
const SHA = createHash("sha256").update(BYTES).digest("hex");

function release(overrides = {}, asset = {}) {
  return {
    tag_name: "v1.5.0",
    html_url: "https://github.com/munot-informatik/Qwui/releases/tag/v1.5.0",
    body: "Offerten, Gutschriften, Lieferscheine",
    published_at: "2026-11-21T10:00:00Z",
    assets: [
      {
        name: "Qwui-1.5.0.exe",
        size: BYTES.length,
        digest: `sha256:${SHA}`,
        browser_download_url: "https://github.com/munot-informatik/Qwui/releases/download/v1.5.0/Qwui-1.5.0.exe",
        ...asset,
      },
    ],
    ...overrides,
  };
}

function fakeFetch({ body = BYTES, status = 200, json = release() } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url === RELEASES_URL) return { ok: status === 200, status, json: async () => json };
    return { ok: true, status: 200, body: new Blob([body]).stream() };
  };
  fn.calls = calls;
  return fn;
}

describe("Versionen", () => {
  it("vergleicht numerisch und ignoriert Vorabversionen", () => {
    expect(parseVersion("v1.10.2")).toEqual([1, 10, 2]);
    expect(parseVersion("1.5.0-beta")).toBeNull();
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("v1.4.0", "1.4.0")).toBe(false);
    expect(isNewer("1.3.9", "1.4.0")).toBe(false);
    expect(isNewer("kaputt", "1.4.0")).toBe(false);
  });

  it("nimmt nur die passende .exe mit Prüfsumme von GitHub", () => {
    const ok = releaseInfo(release(), "1.4.0");
    expect(ok).toMatchObject({ available: true, version: "1.5.0", problem: null });
    expect(ok.asset).toMatchObject({ name: "Qwui-1.5.0.exe", sha256: SHA });

    expect(releaseInfo(release({}, { digest: undefined }), "1.4.0").problem).toMatch(/Prüfsumme/);
    expect(releaseInfo(release({}, { browser_download_url: "https://evil.example/Qwui-1.5.0.exe" }), "1.4.0").problem).toMatch(/unerwartet/);
    expect(releaseInfo(release({}, { name: "Qwui-Setup.exe" }), "1.4.0").problem).toMatch(/keine Datei/);
    expect(releaseInfo(release({ html_url: "https://evil.example/" }), "1.4.0").pageUrl).toBe("https://github.com/munot-informatik/Qwui/releases");
    expect(releaseInfo(release(), "1.5.0").available).toBe(false);
  });
});

describe("Austausch der .exe", () => {
  let dir;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "qwui-update-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lädt herunter und verwirft eine Datei mit falscher Prüfsumme", async () => {
    const asset = releaseInfo(release(), "1.4.0").asset;
    const target = join(dir, "Qwui-1.5.0.download");
    await downloadVerified(fakeFetch(), asset, target);
    expect(readFileSync(target).equals(BYTES)).toBe(true);

    const bad = join(dir, "bad.download");
    await expect(downloadVerified(fakeFetch({ body: Buffer.from("anders") }), { ...asset, size: 6 }, bad)).rejects.toThrow(/Prüfsumme/);
    expect(existsSync(bad)).toBe(false);
    await expect(downloadVerified(fakeFetch({ body: BYTES.subarray(0, 10) }), asset, bad)).rejects.toThrow(/unvollständig/);
    expect(existsSync(bad)).toBe(false);
  });

  it("behält den Namen der laufenden .exe und räumt danach auf", async () => {
    const exeFile = join(dir, "Qwui-1.4.0.exe");
    writeFileSync(exeFile, "alt");
    const downloaded = join(dir, "Qwui-1.5.0.download");
    writeFileSync(downloaded, "neu");
    const result = await swapExecutable({ exeFile, downloaded, version: "1.5.0" });
    expect(result).toEqual({ target: exeFile, keptName: true });
    expect(readFileSync(exeFile, "utf8")).toBe("neu");
    expect(readFileSync(`${exeFile}.alt`, "utf8")).toBe("alt");

    writeFileSync(join(dir, "Notizen.txt"), "x");
    writeFileSync(join(dir, "Qwui-1.6.0.download"), "abgebrochen");
    writeFileSync(join(dir, "Kasse.exe.alt"), "umbenannt");
    writeFileSync(join(dir, "Fremd.exe.alt"), "nicht von uns");
    expect((await cleanupLeftovers(dir, ["Kasse.exe.alt"])).sort()).toEqual(["Kasse.exe.alt", "Qwui-1.4.0.exe.alt", "Qwui-1.6.0.download"]);
    expect(readdirSync(dir).sort()).toEqual(["Fremd.exe.alt", "Notizen.txt", "Qwui-1.4.0.exe"]);
  });

  it("installiert über den Updater: prüfen, laden, tauschen, neu starten", async () => {
    const exeFile = join(dir, "Qwui-1.4.0.exe");
    writeFileSync(exeFile, "alt");
    let status = null;
    let launched = null;
    let backedUp = false;
    const updater = createUpdater({
      currentVersion: "1.4.0",
      exeFile,
      getEnabled: () => true,
      readStatus: () => status,
      writeStatus: (s) => (status = s),
      fetch: fakeFetch(),
      launch: (t) => (launched = t),
      beforeInstall: async () => (backedUp = true),
    });
    const state = await updater.check();
    expect(state.latest).toMatchObject({ available: true, version: "1.5.0" });
    const result = await updater.install();
    expect(result).toMatchObject({ ok: true, keptName: true });
    expect(backedUp).toBe(true);
    expect(launched).toBe(exeFile);
    expect(readFileSync(exeFile).equals(BYTES)).toBe(true);
  });

  it("installiert nicht ohne portable .exe und prüft nicht ausgeschaltet", async () => {
    let status = null;
    const fetch = fakeFetch();
    const updater = createUpdater({
      currentVersion: "1.4.0",
      exeFile: null,
      getEnabled: () => false,
      readStatus: () => status,
      writeStatus: (s) => (status = s),
      fetch,
      launch: () => {},
    });
    await updater.checkIfDue();
    expect(fetch.calls).toHaveLength(0);
    await updater.check();
    expect((await updater.install()).error).toMatch(/nur in der Windows-Version/);
  });

  it("meldet Fehler von GitHub verständlich", async () => {
    let status = null;
    const updater = createUpdater({
      currentVersion: "1.4.0",
      exeFile: null,
      getEnabled: () => true,
      readStatus: () => status,
      writeStatus: (s) => (status = s),
      fetch: fakeFetch({ status: 403 }),
      launch: () => {},
    });
    const state = await updater.check();
    expect(state.error).toMatch(/HTTP 403/);
  });
});
