import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", '<!doctype html><html><head><meta charset="utf-8"><title>Agent Workspace Tauri smoke</title></head><body><main>Tauri build acceptance</main></body></html>');

// Tauri's generate_context! requires a valid RGBA PNG, even in a headless build.
// Generate the tiny fixture asset deterministically instead of storing binary
// content in the GitHub source API.
function chunk(name, payload) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const data = Buffer.concat([type, payload]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, tail]);
}
const width = 32, height = 32;
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA truecolor
const scanline = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4)]);
for (let x = 0; x < width; x++) {
  const o = 1 + x * 4;
  scanline[o] = 22;
  scanline[o + 1] = 100;
  scanline[o + 2] = 190;
  scanline[o + 3] = 255;
}
const rows = Buffer.concat(Array.from({ length: height }, () => scanline));
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows)),
  chunk("IEND", Buffer.alloc(0))
]);
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/icon.png", png);

console.log("Static Tauri frontend and valid 32-bit RGBA icon: PASS");
