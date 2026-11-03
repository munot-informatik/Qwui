// Lokale Schnittstelle für den Assistenten: ein kleiner HTTP-Server, der nur
// auf 127.0.0.1 lauscht — von anderen Geräten im Netz und aus dem Internet
// ist er nicht erreichbar. Standardmässig aus; eingeschaltet wird er in der
// App unter «Assistent». Der MCP-Server (mcp/server.js) spricht mit ihm.
//
// Schutz:
// - Zugriffstoken (Bearer), Vergleich in konstanter Zeit.
// - Nur Host 127.0.0.1/localhost mit dem eigenen Port: schützt vor
//   DNS-Rebinding, bei dem eine Webseite den Browser auf 127.0.0.1 lenkt.
// - Anfragen mit Origin-Header (also aus einem Browser) werden abgewiesen.
// - Kleine Anfragen, nur die festen Werkzeug-Pfade.
// Jeder Zugriff wird protokolliert (Zeit, Werkzeug, ok/Fehler).
//
// POST /v1/tools/<name>   Body: JSON-Argumente  → { ok, result } | { ok:false, error }
// GET  /v1/health                                → { ok, name }

import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

export const API_TOKEN_SECRET = "api-token";
export const DEFAULT_API_PORT = 47110;
const MAX_BODY = 64 * 1024;

function sameToken(given, expected) {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// deps: { getToken: () => string|null, toolNames: string[],
//         runTool: async (name, args) => result, log: (entry) => void }
export function createLocalApi({ getToken, toolNames, runTool, log }) {
  let server = null;
  let port = null;

  async function handle(req, res) {
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(String(req.headers.host || "").toLowerCase())) return send(res, 403, { ok: false, error: "Host nicht erlaubt." });
    if (req.headers.origin) return send(res, 403, { ok: false, error: "Zugriff aus dem Browser ist nicht erlaubt." });

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const match = /^\/v1\/tools\/([a-z_]+)$/.exec(url.pathname);
    const tool = match ? match[1] : url.pathname;

    if (!sameToken(token, getToken())) {
      log({ at: new Date().toISOString(), tool, ok: false, error: "Ungültiges Token" });
      return send(res, 401, { ok: false, error: "Ungültiges oder fehlendes Token." });
    }

    if (req.method === "GET" && url.pathname === "/v1/health") return send(res, 200, { ok: true, name: "Qwui" });
    if (req.method !== "POST" || !match || !toolNames.includes(tool)) {
      return send(res, 404, { ok: false, error: "Unbekannter Pfad." });
    }

    let body = "";
    let tooLarge = false;
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) {
        tooLarge = true;
        break;
      }
    }
    if (tooLarge) return send(res, 413, { ok: false, error: "Anfrage zu gross." });

    let args = {};
    try {
      args = body ? JSON.parse(body) : {};
    } catch (e) {
      log({ at: new Date().toISOString(), tool, ok: false, error: "Ungültiges JSON" });
      return send(res, 400, { ok: false, error: "Ungültiges JSON." });
    }

    try {
      const result = await runTool(tool, args);
      log({ at: new Date().toISOString(), tool, ok: true });
      return send(res, 200, { ok: true, result });
    } catch (e) {
      const error = e.message || String(e);
      log({ at: new Date().toISOString(), tool, ok: false, error });
      return send(res, 400, { ok: false, error });
    }
  }

  return {
    async start(listenPort) {
      if (server) await this.stop();
      port = listenPort;
      server = createServer((req, res) => {
        handle(req, res).catch((e) => send(res, 500, { ok: false, error: e.message || "Interner Fehler" }));
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      port = server.address().port;
      return port;
    },
    async stop() {
      if (!server) return;
      const s = server;
      server = null;
      await new Promise((resolve) => s.close(() => resolve()));
    },
    get running() {
      return !!server;
    },
    get port() {
      return port;
    },
  };
}
