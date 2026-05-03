#!/usr/bin/env node
/**
 * Tray icon generator — rasterizes the Echo "echoing dot" mark to PNG.
 *
 * Design (matches user reference):
 *   - Small filled dot on the left
 *   - Three concentric arcs to the right of the dot, expanding outward
 *   - Each arc is thicker as it grows farther from the source
 *   - Black-only, alpha-transparent — macOS NSTemplateImage tints automatically
 *
 * Why hand-rolled: macOS has no SVG rasterizer in stock tools, and adding sharp
 * or @resvg/resvg-js for one icon is overkill. Built-ins (zlib + Buffer) are
 * enough to encode a valid PNG.
 *
 * Outputs:
 *   electron/assets/trayTemplate.png      (22x22 — @1x)
 *   electron/assets/trayTemplate@2x.png   (44x44 — Retina)
 *
 * Run with: node scripts/build-tray-icon.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Geometry helpers ──────────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function smoothEdge(d, edgeRadius) {
  // Anti-aliased edge: returns alpha 0..1 for distance d from a target with edge radius.
  if (d <= 0) return 1;
  if (d >= edgeRadius) return 0;
  return 1 - (d / edgeRadius);
}

/**
 * Render the icon at `size` pixels and return raw RGBA pixel buffer.
 *
 * Coordinate system: (0,0) top-left, (size-1, size-1) bottom-right.
 * The "source" dot sits left-of-center at (size * 0.22, size * 0.5);
 * arcs are centered on that source point and span the right half-circle
 * (angles from -π/2 to π/2 — i.e., facing right).
 */
function renderEcho(size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA

  const cx = size * 0.22;            // dot center x — slightly left of center
  const cy = size * 0.50;            // dot center y — vertical middle
  const dotR = size * 0.075;         // small dot radius

  // Arc geometry: three arcs, each progressively larger and slightly thicker.
  // Radii are picked so the outermost arc is just inside the bounding box.
  const arcs = [
    { r: size * 0.22, t: size * 0.045 },
    { r: size * 0.36, t: size * 0.052 },
    { r: size * 0.52, t: size * 0.060 },
  ];
  // Angular span — arcs flow rightward from the source, gentle taper at the ends.
  const aMin = -Math.PI * 0.42;
  const aMax =  Math.PI * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);

      let alpha = 0;

      // Filled dot
      const dotEdge = 0.85;  // half-pixel anti-alias band
      if (dist <= dotR + dotEdge) {
        const aDot = smoothEdge(Math.max(0, dist - (dotR - dotEdge)), 2 * dotEdge);
        alpha = Math.max(alpha, aDot);
      }

      // Arcs — only render in the right-facing angular range
      if (ang >= aMin && ang <= aMax) {
        // Taper the arcs at their angular edges so they don't end abruptly
        const angTaper = Math.min(
          (ang - aMin) / 0.18,
          (aMax - ang) / 0.18,
          1,
        );
        if (angTaper > 0) {
          for (const arc of arcs) {
            const off = Math.abs(dist - arc.r);
            const halfT = arc.t / 2;
            if (off <= halfT + 0.85) {
              const aArc = smoothEdge(Math.max(0, off - (halfT - 0.85)), 1.7) * angTaper;
              alpha = Math.max(alpha, aArc);
            }
          }
        }
      }

      const a = clamp(Math.round(alpha * 255), 0, 255);
      buf[idx + 0] = 0;     // R — pure black
      buf[idx + 1] = 0;     // G
      buf[idx + 2] = 0;     // B
      buf[idx + 3] = a;     // A
    }
  }
  return buf;
}

// ── Minimal PNG encoder (no deps) ─────────────────────────────────────────
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
  // Filter byte 0 (None) prepended to each scanline.
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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type — RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Build ─────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, '..', 'electron', 'assets');
fs.mkdirSync(outDir, { recursive: true });

for (const [size, name] of [[22, 'trayTemplate.png'], [44, 'trayTemplate@2x.png']]) {
  const rgba = renderEcho(size);
  const png = encodePNG(rgba, size, size);
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${size}×${size}, ${png.length} bytes)`);
}
