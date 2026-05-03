#!/usr/bin/env node
/**
 * App icon generator — produces electron/assets/icon.icns for the macOS bundle.
 *
 * Design: same Echo "echoing dot" mark as the tray icon, but as a full-color app
 * icon — rounded squircle background in the Electron Vue dark navy (#212836)
 * with the ripple in emerald (#37c886) for high contrast on the dock.
 *
 * Pipeline:
 *   1. Render a 1024×1024 RGBA PNG with the squircle + ripple
 *   2. Use macOS-native `sips` to scale to all required sizes
 *   3. Use `iconutil` to package the iconset into a .icns file
 *
 * Run: node scripts/build-app-icon.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ASSETS_DIR = path.join(__dirname, '..', 'electron', 'assets');
const ICONSET_DIR = path.join(ASSETS_DIR, 'icon.iconset');

// Brand colors — Electron Vue theme from Strata
const BG = [0x21, 0x28, 0x36];       // #212836 — dark navy background
const FG = [0x4d, 0xd8, 0x9a];       // #4dd89a — emerald accent (slightly lighter than --accent for dock visibility)

// ── Geometry helpers ──
function squircleAlpha(x, y, w, h, n = 5, smooth = 1.2) {
  // Superellipse |x/a|^n + |y/b|^n = 1; n≈5 mimics macOS Big Sur+ icon shape.
  // Returns 0..1 alpha based on distance from the squircle boundary.
  const cx = w / 2, cy = h / 2;
  const a = w / 2, b = h / 2;
  const px = (x - cx) / a;
  const py = (y - cy) / b;
  const r = Math.pow(Math.abs(px), n) + Math.pow(Math.abs(py), n);
  // r = 1 is the boundary. Smooth edge between r = 1 and r = 1 + small.
  const edgeStart = 1;
  const edgeEnd = 1 + smooth / Math.min(a, b);
  if (r <= edgeStart) return 1;
  if (r >= edgeEnd) return 0;
  return 1 - (r - edgeStart) / (edgeEnd - edgeStart);
}

function smoothEdge(d, edgeRadius) {
  if (d <= 0) return 1;
  if (d >= edgeRadius) return 0;
  return 1 - (d / edgeRadius);
}

function renderAppIcon(size) {
  const buf = Buffer.alloc(size * size * 4);

  // Echo mark — same proportions as tray icon, centered with some padding
  // The mark "lives" inside the central 70% of the canvas
  const insetTop = size * 0.18;
  const insetLeft = size * 0.22;
  const markW = size * 0.62;
  const markH = size * 0.62;
  const markCx = insetLeft + markW * 0.30;     // dot anchor — left-of-center within the mark
  const markCy = insetTop + markH * 0.50;
  const dotR = markW * 0.08;

  const arcs = [
    { r: markW * 0.22, t: markW * 0.045 },
    { r: markW * 0.36, t: markW * 0.052 },
    { r: markW * 0.52, t: markW * 0.060 },
  ];
  const aMin = -Math.PI * 0.42;
  const aMax = Math.PI * 0.42;
  const edgeAA = Math.max(1, size / 600);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // 1. Background squircle
      const bgA = squircleAlpha(x, y, size, size);
      if (bgA <= 0) {
        buf[idx + 0] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
        continue;
      }

      let r = BG[0], g = BG[1], b = BG[2];

      // 2. Foreground echo mark — only inside the squircle
      const dx = x - markCx;
      const dy = y - markCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      let fgAlpha = 0;

      if (dist <= dotR + edgeAA) {
        fgAlpha = Math.max(fgAlpha, smoothEdge(Math.max(0, dist - (dotR - edgeAA)), 2 * edgeAA));
      }
      if (ang >= aMin && ang <= aMax) {
        const angTaper = Math.min((ang - aMin) / 0.18, (aMax - ang) / 0.18, 1);
        if (angTaper > 0) {
          for (const arc of arcs) {
            const off = Math.abs(dist - arc.r);
            const halfT = arc.t / 2;
            if (off <= halfT + edgeAA) {
              const aArc = smoothEdge(Math.max(0, off - (halfT - edgeAA)), 2 * edgeAA) * angTaper;
              fgAlpha = Math.max(fgAlpha, aArc);
            }
          }
        }
      }

      if (fgAlpha > 0) {
        r = Math.round(r * (1 - fgAlpha) + FG[0] * fgAlpha);
        g = Math.round(g * (1 - fgAlpha) + FG[1] * fgAlpha);
        b = Math.round(b * (1 - fgAlpha) + FG[2] * fgAlpha);
      }

      buf[idx + 0] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = Math.round(255 * bgA);
    }
  }
  return buf;
}

// ── Minimal PNG encoder (no deps) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const filtered = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Build pipeline ──
fs.mkdirSync(ICONSET_DIR, { recursive: true });

// 1) Render the master 1024×1024 PNG once
console.log('Rendering 1024×1024 master…');
const masterBuf = renderAppIcon(1024);
const masterPng = encodePNG(masterBuf, 1024, 1024);
const masterPath = path.join(ICONSET_DIR, 'icon_512x512@2x.png');
fs.writeFileSync(masterPath, masterPng);
console.log(`  → ${path.basename(masterPath)} (${masterPng.length} bytes)`);

// 2) Use sips to downsample to all the required sizes
//    Required sizes per Apple HIG / iconutil:
//      icon_16x16.png     16×16
//      icon_16x16@2x.png  32×32
//      icon_32x32.png     32×32
//      icon_32x32@2x.png  64×64
//      icon_128x128.png   128×128
//      icon_128x128@2x.png 256×256
//      icon_256x256.png   256×256
//      icon_256x256@2x.png 512×512
//      icon_512x512.png   512×512
//      icon_512x512@2x.png 1024×1024  (already written)
const sizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
];
for (const [name, sz] of sizes) {
  const out = path.join(ICONSET_DIR, name);
  execFileSync('sips', ['-z', String(sz), String(sz), masterPath, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`  → ${name} (${sz}×${sz})`);
}

// 3) Pack iconset → .icns
const icnsPath = path.join(ASSETS_DIR, 'icon.icns');
console.log('Packaging .icns…');
execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', icnsPath], { stdio: 'inherit' });
const icnsSize = fs.statSync(icnsPath).size;
console.log(`✓ ${icnsPath} (${icnsSize} bytes)`);

// Optional: keep iconset around for re-builds, or remove
// fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
