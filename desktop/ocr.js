// Texterkennung für Fotos von Seriennummern: nutzt die in Windows eingebaute
// Erkennung (Windows.Media.Ocr). Läuft auf diesem PC, ohne Internet und ohne
// Zusatzprogramm — die Fotos verlassen den Rechner nicht.
//
// Die Windows-Schnittstelle ist von Node aus nicht direkt erreichbar, deshalb
// der Umweg über die mitgelieferte Windows PowerShell. Das Skript kommt als
// -EncodedCommand (die Datei läge sonst im asar-Archiv, das PowerShell nicht
// lesen kann), der Bildpfad als Umgebungsvariable und nie im Skripttext: Ein
// Dateiname wie «a'; Remove-Item x» wird so nie als Befehl ausgeführt.

import { execFile } from "node:child_process";
import { join } from "node:path";

const OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'NO_LANGUAGE' }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:QWUI_OCR_FILE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
if ($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max) { throw 'TOO_LARGE' }
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$lines = @($result.Lines | ForEach-Object { $_.Text })
ConvertTo-Json -InputObject $lines -Compress
`;

export const OCR_TIMEOUT_MS = 60 * 1000;

// Verständliche Meldung statt des rohen PowerShell-Fehlers.
export function ocrErrorMessage(err) {
  const text = `${err?.stderr || ""} ${err?.message || err || ""}`;
  if (err?.killed || /ETIMEDOUT/.test(text)) return "Die Texterkennung hat zu lange gedauert. Bitte ein kleineres Foto versuchen.";
  if (/NO_LANGUAGE/.test(text)) return "Windows hat keine Sprache für die Texterkennung installiert (Einstellungen → Zeit und Sprache).";
  if (/TOO_LARGE/.test(text)) return "Das Foto ist zu gross für die Texterkennung (höchstens 10000 Pixel je Seite).";
  if (/0x88982F50|0x88982F07|not.*decoder|Komponente/i.test(text)) return "Dieses Bildformat kann Windows nicht lesen. Bitte als JPG oder PNG speichern.";
  return "Die Texterkennung ist fehlgeschlagen. Die Nummer lässt sich von Hand eintragen.";
}

export function parseOcrOutput(stdout) {
  const parsed = JSON.parse(String(stdout).trim() || "[]");
  if (Array.isArray(parsed)) return parsed.map(String);
  return parsed == null ? [] : [String(parsed)];
}

// run: wie execFile (in Tests ersetzbar). Liefert die erkannten Textzeilen.
export function recognizeText(filePath, run = execFile) {
  const shell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const encoded = Buffer.from(OCR_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    run(
      shell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        env: { ...process.env, QWUI_OCR_FILE: filePath },
        timeout: OCR_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(new Error(ocrErrorMessage(err)));
          return;
        }
        try {
          resolve(parseOcrOutput(stdout));
        } catch (e) {
          reject(new Error(ocrErrorMessage(e)));
        }
      }
    );
  });
}
