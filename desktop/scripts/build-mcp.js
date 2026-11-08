// Bündelt mcp/server.js samt MCP-SDK und zod zu einer einzigen Datei
// (desktop/mcp-server.mjs). Daraus baut Qwui beim Klick auf «In Claude Desktop
// installieren» eine Claude-Desktop-Erweiterung (.mcpb, siehe mcpbExport.js).
// Claude Desktop bringt Node.js selbst mit — auf dem PC muss nichts weiter
// installiert sein. desktop/mcp-server.mjs ist erzeugt und steht in .gitignore.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { copyFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

await build({
  entryPoints: [resolve(root, "mcp", "server.js")],
  outfile: resolve(__dirname, "..", "mcp-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Abhängigkeiten in CommonJS rufen require() auf — in einem ESM-Bündel gibt es
  // das nur über createRequire.
  banner: { js: "import { createRequire as __qwuiCreateRequire } from \"node:module\"; const require = __qwuiCreateRequire(import.meta.url);" },
  target: "node20",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  nodePaths: [resolve(root, "mcp", "node_modules")],
});
// Symbol der Erweiterung in Claude Desktop: das Qwui-Logo (512 × 512).
copyFileSync(resolve(root, "src", "assets", "logo.png"), resolve(__dirname, "..", "mcp-icon.png"));
console.log("MCP-Server gebündelt: desktop/mcp-server.mjs");
