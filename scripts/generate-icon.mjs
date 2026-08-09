#!/usr/bin/env node
// Generates a simple placeholder 1024x1024 PNG app icon at
// apps/desktop/build/icon.png. electron-builder auto-derives .ico (Windows)
// and .icns (macOS) from this single source image at package time, so no
// other format is needed. Replace this file with real artwork before a
// real release; this is a stand-in so packaging isn't blocked on design.

import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "apps", "desktop", "build", "icon.png");

const SIZE = 1024;
const BG = [0x1e, 0x3a, 0x5f]; // dark blue
const COVER = [0xf5, 0xf0, 0xe6]; // off-white "page" color
const SPINE = BG;

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b], a = 255) {
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

const margin = SIZE * 0.18;
const bookLeft = margin;
const bookRight = SIZE - margin;
const bookTop = SIZE * 0.22;
const bookBottom = SIZE * 0.82;
const spineHalfWidth = SIZE * 0.018;
const cornerRadius = SIZE * 0.04;

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let color = BG;
    if (insideRoundedRect(x, y, bookLeft, bookTop, bookRight, bookBottom, cornerRadius)) {
      color = COVER;
      const midX = SIZE / 2;
      if (Math.abs(x - midX) < spineHalfWidth) {
        color = SPINE;
      }
    }
    setPixel(x, y, color);
  }
}

// --- minimal PNG encoder (no deps): 8-bit RGBA, filter type 0 per scanline ---
function crc32(buf) {
  let c;
  const table = crc32.table ??= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);
ihdrData.writeUInt32BE(SIZE, 4);
ihdrData[8] = 8; // bit depth
ihdrData[9] = 6; // color type: RGBA
ihdrData[10] = 0;
ihdrData[11] = 0;
ihdrData[12] = 0;
const ihdr = chunk("IHDR", ihdrData);

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // no filter
  pixels.copy(raw, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = chunk("IDAT", deflateSync(raw, { level: 9 }));
const iend = chunk("IEND", Buffer.alloc(0));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([signature, ihdr, idat, iend]));
console.log(`Wrote ${outPath}`);
