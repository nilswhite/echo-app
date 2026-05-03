/**
 * Electron entry point.
 *
 * In packaged mode: loads the pre-compiled CJS bundle (no tsx needed).
 * In dev mode: registers tsx and imports TypeScript source directly.
 */

process.env.ELECTRON = '1';

const path = require('path');
const fs = require('fs');

const logFile = path.join(
  require('electron').app.getPath('appData'),
  'Echo',
  'echo-startup.log'
);
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch { /* ignore */ }
}

log('Entry point starting');

const bundlePath = path.join(__dirname, '..', 'electron-dist', 'main.cjs');

if (fs.existsSync(bundlePath)) {
  log('Loading compiled bundle');
  try {
    require(bundlePath);
  } catch (err) {
    log(`Bundle load FAILED: ${err.stack || err}`);
    const { dialog } = require('electron');
    dialog.showErrorBox('Echo — Startup Error', String(err.stack || err));
    process.exit(1);
  }
} else {
  log('Dev mode: registering tsx');
  require('tsx/cjs');
  const { register } = require('tsx/esm/api');
  register();
  import('./main.ts');
}
