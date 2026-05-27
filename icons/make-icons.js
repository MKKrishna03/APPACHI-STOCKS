/**
 * make-icons.js — generates PNG icons for the Appachi Jewellery PWA
 * Run once: node icons/make-icons.js
 * No npm deps — uses only built-in Node.js (zlib, fs, path).
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ──────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG encoder ────────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

function makePNG(w, h, drawPixel) {
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = drawPixel(x, y);
      const off = y * stride + 1 + x * 4;
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Colors ─────────────────────────────────────────────────────────────────────
const NAVY  = [15,  32,  68,  255];
const GOLD  = [184, 151, 58,  255];
const GOLDL = [212, 174, 86,  255];
const TRANS = [0,   0,   0,   0  ];

// ── Geometry helpers ───────────────────────────────────────────────────────────
function inRoundedSquare(dx, dy, R, cr) {
  const qx = Math.max(0, Math.abs(dx) - (R - cr));
  const qy = Math.max(0, Math.abs(dy) - (R - cr));
  return qx * qx + qy * qy <= cr * cr;
}

function inRotRect(dx, dy, angle, hw, hh) {
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return Math.abs(rx) <= hw && Math.abs(ry) <= hh;
}

// ── App icon draw fn ───────────────────────────────────────────────────────────
function makeAppIconFn(size) {
  const cx  = size / 2,  cy  = size / 2;
  const R   = size * 0.46;
  const cr  = size * 0.18;
  const bw  = Math.max(2, Math.round(size * 0.055)); // border width

  const sw2 = size * 0.042;   // star arm half-width (main axes)
  const sd2 = size * 0.026;   // star arm half-width (diagonals)
  const sl2 = size * 0.32;    // star arm half-length

  return function drawPixel(x, y) {
    const dx = x - cx, dy = y - cy;

    // Outer rounded square
    if (!inRoundedSquare(dx, dy, R, cr)) return TRANS;

    // Gold border ring
    const innerR  = R  - bw;
    const innerCr = Math.max(1, cr - bw);
    if (!inRoundedSquare(dx, dy, innerR, innerCr)) return GOLD;

    // 4-pointed ✦ star (two axes + two diagonals)
    if (
      inRotRect(dx, dy,  0,            sw2, sl2)         ||  // vertical
      inRotRect(dx, dy,  Math.PI / 2,  sw2, sl2)         ||  // horizontal
      inRotRect(dx, dy,  Math.PI / 4,  sd2, sl2 * 0.72)  ||  // diagonal ↗
      inRotRect(dx, dy, -Math.PI / 4,  sd2, sl2 * 0.72)      // diagonal ↘
    ) return GOLDL;

    // Small gold center dot
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < size * 0.05) return GOLD;

    return NAVY;
  };
}

// ── Badge icon draw fn (72×72 circle with gold bell outline) ───────────────────
function makeBadgeFn(size) {
  const cx = size / 2, cy = size / 2;
  const r  = size / 2;
  return function drawPixel(x, y) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > r - 1) return TRANS;
    if (dist > r * 0.82) return GOLD;
    // Bell body (rounded rect)
    if (inRotRect(dx, dy + size*0.04, 0, size*0.19, size*0.20)) return GOLDL;
    // Bell top arc (smaller rect sitting on body)
    if (inRotRect(dx, dy - size*0.16, 0, size*0.12, size*0.10)) return GOLDL;
    // Bell base bar
    if (Math.abs(dy - size*0.14) < size*0.025 && Math.abs(dx) < size*0.23) return GOLDL;
    // Clapper dot
    if (Math.abs(dx) < size*0.055 && Math.abs(dy - size*0.23) < size*0.045) return GOLDL;
    return NAVY;
  };
}

// ── Generate ───────────────────────────────────────────────────────────────────
const dir = __dirname;

for (const size of [192, 512]) {
  const buf = makePNG(size, size, makeAppIconFn(size));
  fs.writeFileSync(path.join(dir, `icon-${size}.png`), buf);
  console.log(`✅ icon-${size}.png (${buf.length} bytes)`);
}

const badge = makePNG(72, 72, makeBadgeFn(72));
fs.writeFileSync(path.join(dir, 'badge-72.png'), badge);
console.log(`✅ badge-72.png (${badge.length} bytes)`);

console.log('\n🎉 All icons generated in icons/');
