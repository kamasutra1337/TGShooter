// Generates public/icon-180.png — the TonConnect app icon. Pure Node (zlib),
// no image deps: draws a crosshair emblem on a dark disc into an RGBA buffer
// and encodes a PNG by hand. Run: node scripts/make-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const S = 180;
const buf = Buffer.alloc(S * S * 4);
const cx = S / 2;
const cy = S / 2;

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255;
  buf[i] = buf[i] * (1 - na) + r * na;
  buf[i + 1] = buf[i + 1] * (1 - na) + g * na;
  buf[i + 2] = buf[i + 2] * (1 - na) + b * na;
  buf[i + 3] = Math.max(buf[i + 3], a);
}

// Background: dark radial disc.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= 86) {
      const t = d / 86;
      const r = 12 + 6 * (1 - t);
      const g = 16 + 12 * (1 - t);
      const b = 24 + 20 * (1 - t);
      set(x, y, r, g, b, 255);
    }
  }
}

// Accent color (teal) helpers.
const AC = [53, 224, 200];
function ring(radius, thick, col, a = 255) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - radius) <= thick) set(x, y, col[0], col[1], col[2], a);
    }
}
function bar(horiz, len, thick, gap, col) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const along = horiz ? Math.abs(x - cx) : Math.abs(y - cy);
      const across = horiz ? Math.abs(y - cy) : Math.abs(x - cx);
      if (across <= thick && along <= len && along >= gap)
        set(x, y, col[0], col[1], col[2], 255);
    }
}

ring(66, 3.2, AC, 235); // outer target ring
bar(true, 58, 2.4, 14, AC); // horizontal crosshair
bar(false, 58, 2.4, 14, AC); // vertical crosshair
// center dot (warm amber for the "shot")
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++)
    if (Math.hypot(x - cx, y - cy) <= 7) set(x, y, 255, 209, 102, 255);

// ---- encode PNG ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// filter byte 0 per scanline
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "../public/icon-180.png");
writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
