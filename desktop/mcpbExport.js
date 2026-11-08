// Claude-Desktop-Erweiterung (.mcpb) für den Assistenten. Eine .mcpb ist ein
// ZIP-Archiv mit manifest.json und dem Server; Claude Desktop installiert sie
// per Doppelklick und startet den Server mit seinem eigenen Node.js. So muss
// niemand Node installieren oder Konfigurationsdateien von Hand bearbeiten.
//
// Adresse und Zugriffstoken stehen als Vorgabe im Manifest; Claude Desktop
// zeigt sie beim Installieren an und legt das Token im Schlüsselbund von
// Windows ab. Die Datei entsteht nur im Temp-Ordner bzw. dort, wo der Benutzer
// sie speichert.

import { crc32 } from "node:zlib";

// Minimaler ZIP-Schreiber (ohne Kompression). Reicht für drei Dateien und
// spart eine zusätzliche Abhängigkeit.
export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const crc = crc32(body) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // benötigte Version
    local.writeUInt16LE(0x0800, 6); // Dateinamen in UTF-8
    local.writeUInt16LE(0, 8); // gespeichert, nicht komprimiert
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // Datum 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function mcpbManifest({ version, port, token }) {
  return {
    manifest_version: "0.3",
    name: "qwui",
    display_name: "Qwui",
    version,
    description: "Bestand, Seriennummern, Umsätze und Ladenhüter aus Qwui abfragen; Wareneingänge und Artikel als Vorschlag anlegen.",
    long_description:
      "Verbindet Claude Desktop mit der lokalen Schnittstelle von Qwui auf diesem PC (127.0.0.1). Qwui gibt keine Namen, Adressen, E-Mails oder Telefonnummern heraus. Gebucht wird erst, wenn jemand den Vorschlag in Qwui übernimmt.",
    author: { name: "Matthias Kubin", url: "https://munot-informatik.ch" },
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"],
        env: {
          QWUI_API_URL: "${user_config.api_url}",
          QWUI_API_TOKEN: "${user_config.api_token}",
        },
      },
    },
    user_config: {
      api_url: {
        type: "string",
        title: "Adresse der Schnittstelle",
        description: "Steht in Qwui unter Einstellungen → Assistent.",
        default: `http://127.0.0.1:${port}`,
        required: true,
      },
      api_token: {
        type: "string",
        title: "Zugriffstoken",
        description: "Steht in Qwui unter Einstellungen → Assistent. Ist bereits eingetragen.",
        sensitive: true,
        required: true,
        default: token,
      },
    },
    compatibility: {
      platforms: ["win32"],
      runtimes: { node: ">=20.0.0" },
    },
  };
}

// Baut die .mcpb-Datei als Buffer. serverCode: Inhalt von mcp-server.mjs.
export function buildMcpb({ version, port, token, serverCode, icon }) {
  const manifest = mcpbManifest({ version, port, token });
  if (icon) manifest.icon = "icon.png";
  const files = [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: "server/index.mjs", data: serverCode },
  ];
  if (icon) files.push({ name: "icon.png", data: icon });
  return zipStore(files);
}
