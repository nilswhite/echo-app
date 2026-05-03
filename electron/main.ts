/**
 * Echo — main process entry.
 *
 * No main window: tray-resident, capture window opens on global hotkey.
 * Step 4 wires the embedded Express server. For now the capture window's
 * record/upload calls 404 against the not-yet-running server — they fail
 * cleanly (red text in the title input), no crashes.
 */

import { app, globalShortcut } from 'electron';
import { createTray, destroyTray, rebuildMenu } from './tray.js';
import { createCaptureWindow, showCapture, destroyCaptureWindow } from './capture.js';
import { getSettings } from '../server/services/settings-store.js';
import { startServer, stopServer } from '../server/index.js';
import { onSettingsChanged, registerSettingsHandlers } from './settings.js';
import { registerMicRegistryHandlers } from './mic-registry.js';

// Single-instance lock — prevents two Echo processes from racing for the mic.
// Without this, an unclean kill of one instance can leave coreaudiod holding
// a stale device reference, wedging the mic system-wide. Strata's pattern.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  // Another launch came in; surface our capture window so the user knows we're alive.
  showCapture();
});

const DEFAULT_HOTKEY = 'CommandOrControl+Shift+A';
let currentHotkey = DEFAULT_HOTKEY;

function registerHotkey(hotkey: string): boolean {
  globalShortcut.unregisterAll();
  try {
    if (globalShortcut.register(hotkey, showCapture)) {
      currentHotkey = hotkey;
      return true;
    }
  } catch (err) {
    console.error(`[main] Failed to register hotkey "${hotkey}":`, err);
  }
  // Fall back to default
  if (hotkey !== DEFAULT_HOTKEY) {
    try { globalShortcut.register(DEFAULT_HOTKEY, showCapture); } catch { /* ignore */ }
    currentHotkey = DEFAULT_HOTKEY;
  }
  return false;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();

  try {
    await startServer();
  } catch (err) {
    console.error('[main] Failed to start Echo server:', err);
  }

  registerSettingsHandlers();
  registerMicRegistryHandlers();

  const hotkey = getSettings().hotkey || DEFAULT_HOTKEY;
  createTray(showCapture, hotkey);
  createCaptureWindow();
  registerHotkey(hotkey);

  // Re-register the hotkey when it changes in settings, no restart needed.
  onSettingsChanged((settings) => {
    const newHotkey = settings.hotkey || DEFAULT_HOTKEY;
    if (newHotkey !== currentHotkey) {
      registerHotkey(newHotkey);
      rebuildMenu(showCapture, newHotkey);
    }
  });
});

app.on('window-all-closed', (e: Electron.Event) => {
  // Tray keeps Echo alive — never quit on window close.
  e.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', async () => {
  destroyCaptureWindow();
  destroyTray();
  await stopServer().catch(() => undefined);
});
