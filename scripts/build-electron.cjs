#!/usr/bin/env node
/**
 * Pre-compile Electron main process into a single CJS bundle.
 *
 * Why: electron-forge ships our app source inside `app.asar`. asar archives are
 * not real directories — `child_process.spawn` can't execute binaries inside
 * them. When `entry.cjs` falls back to running `tsx` at runtime, tsx pulls in
 * esbuild, which spawns its native helper from `node_modules/@esbuild/...` —
 * that fails with `ENOTDIR` and the whole app dies silently.
 *
 * Solution: bundle main.ts (and everything it imports — server routes,
 * services, capture window code) into a self-contained electron-dist/main.cjs.
 * `entry.cjs` already prefers the bundle when it exists, so the packaged app
 * becomes pure JS — no tsx, no esbuild at runtime.
 *
 * Externalized:
 *   - `electron`            (provided by Electron runtime)
 *   - `ffmpeg-static`       (the binary path is the resource, not the JS)
 *   - All Node built-ins
 *
 * Outputs: electron-dist/main.cjs
 */

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'electron-dist');

// Wipe + recreate the output dir so we never ship stale artifacts
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });

const startedAt = Date.now();

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'electron', 'main.ts')],
  outfile: path.join(OUTDIR, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: false,        // readable stack traces in case of runtime errors
  sourcemap: 'inline',  // adds ~minor file size, huge debugging win
  external: [
    'electron',
    'ffmpeg-static',
    // OS-native modules — keep them as require()s resolved at runtime
  ],
  loader: {
    '.html': 'text',
    '.png': 'file',
    '.icns': 'file',
  },
  logLevel: 'info',
});

const sizeKB = Math.round(fs.statSync(path.join(OUTDIR, 'main.cjs')).size / 1024);
const ms = Date.now() - startedAt;
console.log(`✓ electron-dist/main.cjs — ${sizeKB} KB, ${ms} ms`);
