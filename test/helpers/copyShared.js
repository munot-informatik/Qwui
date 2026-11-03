// Vor den Tests: shared/ nach desktop/shared kopieren, wie beim Bauen der
// Windows-Version (desktop/scripts/copy-shared.js). Module des Hauptprozesses
// importieren die gemeinsamen Funktionen von dort.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup() {
  execFileSync(process.execPath, [fileURLToPath(new URL("../../desktop/scripts/copy-shared.js", import.meta.url))], { stdio: "ignore" });
}
