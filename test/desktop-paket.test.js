// Jede Datei, die die Windows-Version beim Start lädt, muss in der Dateiliste
// von electron-builder stehen. Fehlt eine, startet die exe mit
// «Cannot find module» (in Version 1.4.0 passiert mit shopOrders.js).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop");
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const files = pkg.build.files;

function packaged(rel) {
  return files.some((pattern) => {
    if (pattern.endsWith("/**/*")) return rel.startsWith(pattern.slice(0, -"**/*".length));
    return pattern === rel;
  });
}

// Lokale Importe (./…) rekursiv ab den Einstiegspunkten einsammeln.
function localImports(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      const target = join(dirname(file), spec);
      // shared/ wird erst beim Bauen nach desktop/shared kopiert.
      const rel = relative(desktop, target).replaceAll("\\", "/");
      if (rel.startsWith("shared/") || rel.startsWith("..")) continue;
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].map((f) => relative(desktop, f).replaceAll("\\", "/"));
}

describe("Windows-Paket", () => {
  it("packt jede Datei, die main.js und preload.cjs laden", () => {
    const needed = [...localImports(join(desktop, "main.js")), ...localImports(join(desktop, "preload.cjs"))];
    const missing = needed.filter((rel) => !packaged(rel));
    expect(missing).toEqual([]);
  });
});
