/*
 * Generates the PWA icons with no external dependencies.
 * Writes a minimal RGBA PNG (IHDR/IDAT/IEND) using Node's built-in zlib.
 *
 *   node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG encoding ---------- */

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let table = crc32._table;
  if (!table) {
    table = crc32._table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- tiny raster canvas ---------- */

function createCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return {
    w, h, buf,
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      if (a >= 255) {
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
        return;
      }
      const af = a / 255, ia = 1 - af;
      buf[i]     = Math.round(r * af + buf[i]     * ia);
      buf[i + 1] = Math.round(g * af + buf[i + 1] * ia);
      buf[i + 2] = Math.round(b * af + buf[i + 2] * ia);
      buf[i + 3] = Math.max(buf[i + 3], Math.round(a));
    }
  };
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function insideRounded(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRounded(cv, x, y, w, h, r, hex) {
  const [cr, cg, cb] = hexToRgb(hex);
  const S = 4; // supersampling for smooth corners
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          if (insideRounded(px + (sx + 0.5) / S, py + (sy + 0.5) / S, x, y, w, h, r)) hits++;
        }
      }
      if (hits) cv.set(px, py, cr, cg, cb, (255 * hits) / (S * S));
    }
  }
}

/* ---------- the icon artwork ---------- */

const BG = '#12161c';
const FRAME = '#f3f5f7';
const SLOT = '#d3dae2';
const COLUMNS = ['#e53935', '#00897b', '#1e88e5']; // solved columns: red, green, blue

function drawIcon(size, padRatio) {
  const cv = createCanvas(size, size);
  fillRounded(cv, 0, 0, size, size, 0, BG);

  const pad = size * padRatio;
  const frame = size - pad * 2;
  fillRounded(cv, pad, pad, frame, frame, frame * 0.16, FRAME);

  const inner = frame * 0.80;
  const originX = pad + (frame - inner) / 2;
  const originY = pad + (frame - inner) / 2;
  const gutter = inner * 0.06;
  const cell = (inner - gutter * 2) / 3;
  const radius = cell * 0.18;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = originX + col * (cell + gutter);
      const y = originY + row * (cell + gutter);
      // Bottom-right stays empty: that is the sliding gap.
      const isGap = row === 2 && col === 2;
      fillRounded(cv, x, y, cell, cell, radius, isGap ? SLOT : COLUMNS[col]);
    }
  }

  return encodePNG(size, size, cv.buf);
}

/* ---------- write files ---------- */

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.10],
  ['icon-512.png', 512, 0.10],
  ['icon-maskable-512.png', 512, 0.19] // extra padding for Android's maskable safe zone
];

for (const [name, size, pad] of targets) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, drawIcon(size, pad));
  console.log('wrote', name, fs.statSync(file).size, 'bytes');
}
