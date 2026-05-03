/**
 * Capture window — the only UI the user actually sees during recording.
 *
 * Floating, frameless, always-on-top. Two modes:
 *   - Full (480x140): title input, Record button, mic picker, level meter
 *   - Pill (176x38): compact recording indicator that floats over the meeting app
 *
 * IPC handles everything: Record/Stop/upload calls hit the local Express server
 * (Step 4 wires the routes); cancel/pill-mode/mic-picker stay in the main process.
 */

import { BrowserWindow, ipcMain, screen, app } from 'electron';
import path from 'path';
import fs from 'fs';

const ELECTRON_DIR = path.join(app.getAppPath(), 'electron');

const FULL_WIDTH = 480;
const FULL_HEIGHT = 180;
const PILL_WIDTH = 192;
const PILL_HEIGHT = 52;            // 38 row + 14 chevron strip
const PILL_HEIGHT_WITH_TITLE = 90; // + 38 for title input

let captureWindow: BrowserWindow | null = null;
let captureMicWindow: BrowserWindow | null = null;
let preEnterPillBounds: { x: number; y: number; width: number; height: number } | null = null;
let handlersRegistered = false;

function pillBoundsFile(): string {
  return path.join(app.getPath('userData'), 'capture-pill-bounds.json');
}
function loadPillBounds(): { x: number; y: number } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pillBoundsFile(), 'utf-8'));
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch { /* ignore */ }
  return null;
}
function savePillBounds(b: { x: number; y: number }): void {
  try {
    fs.mkdirSync(path.dirname(pillBoundsFile()), { recursive: true });
    fs.writeFileSync(pillBoundsFile(), JSON.stringify(b));
  } catch { /* ignore */ }
}

export function createCaptureWindow(): void {
  registerHandlers();

  captureWindow = new BrowserWindow({
    width: FULL_WIDTH,
    height: FULL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ELECTRON_DIR, 'preload.js'),
    },
  });
  captureWindow.loadFile(path.join(ELECTRON_DIR, 'capture.html'));
  captureWindow.on('close', (e) => {
    if (!captureWindow?.isDestroyed()) {
      e.preventDefault();
      captureWindow?.hide();
    }
  });

  captureMicWindow = new BrowserWindow({
    width: 300,
    height: 340,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ELECTRON_DIR, 'preload.js'),
    },
  });
  captureMicWindow.loadFile(path.join(ELECTRON_DIR, 'capture-mic.html'));
  captureMicWindow.on('close', (e) => {
    if (!captureMicWindow?.isDestroyed()) {
      e.preventDefault();
      captureMicWindow?.hide();
    }
  });
  captureMicWindow.on('blur', () => {
    if (captureMicWindow?.isVisible()) captureMicWindow.hide();
  });
}

function registerHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.on('capture:cancel', () => hideCaptureSilently());

  ipcMain.on('capture:mic-show', (_event, anchor: { left: number; top: number; right: number; bottom: number }) => {
    if (!captureWindow || !captureMicWindow) return;
    const cap = captureWindow.getBounds();
    const W = 300, H = 340;
    captureMicWindow.setBounds({
      x: Math.max(0, Math.round(cap.x + anchor.right) - W),
      y: Math.round(cap.y + anchor.bottom) + 8,
      width: W,
      height: H,
    });
    captureMicWindow.show();
    captureMicWindow.focus();
    captureMicWindow.webContents.send('mic-picker:show');
  });

  ipcMain.on('capture:mic-hide', () => {
    if (captureMicWindow?.isVisible()) captureMicWindow.hide();
  });

  ipcMain.on('capture:mic-device-picked', (_event, deviceId: string, label: string) => {
    captureWindow?.webContents.send('mic-picker:device-picked', { deviceId, label });
  });

  ipcMain.on('capture:enter-pill-mode', () => {
    if (!captureWindow) return;
    preEnterPillBounds = captureWindow.getBounds();
    const savedPill = loadPillBounds();
    const target = savedPill
      ? { x: savedPill.x, y: savedPill.y, width: PILL_WIDTH, height: PILL_HEIGHT }
      : (() => {
          const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
          return {
            x: display.workArea.x + display.workArea.width - PILL_WIDTH - 24,
            y: display.workArea.y + 24,
            width: PILL_WIDTH,
            height: PILL_HEIGHT,
          };
        })();
    captureWindow.setBounds(target, true);
    if (captureMicWindow?.isVisible()) captureMicWindow.hide();
  });

  ipcMain.on('capture:pill-title-toggle', (_event, expanded: boolean) => {
    if (!captureWindow) return;
    const b = captureWindow.getBounds();
    captureWindow.setBounds({
      x: b.x,
      y: b.y,
      width: PILL_WIDTH,
      height: expanded ? PILL_HEIGHT_WITH_TITLE : PILL_HEIGHT,
    }, true);
  });

  ipcMain.on('capture:exit-pill-mode', () => {
    if (!captureWindow) return;
    const pillBounds = captureWindow.getBounds();
    savePillBounds({ x: pillBounds.x, y: pillBounds.y });
    const target = preEnterPillBounds
      ? preEnterPillBounds
      : (() => {
          const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
          return {
            x: Math.round(display.workArea.x + (display.workArea.width - FULL_WIDTH) / 2),
            y: Math.round(display.workArea.y + display.workArea.height * 0.25),
            width: FULL_WIDTH,
            height: FULL_HEIGHT,
          };
        })();
    captureWindow.setBounds(target, true);
    preEnterPillBounds = null;
  });
}

function hideCaptureSilently(): void {
  if (!captureWindow) return;
  captureWindow.blur();
  captureWindow.hide();
}

export function showCapture(): void {
  if (!captureWindow) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  captureWindow.setBounds({
    x: Math.round(x + (width - FULL_WIDTH) / 2),
    y: Math.round(y + height * 0.25),
    width: FULL_WIDTH,
    height: FULL_HEIGHT,
  });
  captureWindow.showInactive();
  captureWindow.focus();
  captureWindow.webContents.send('capture:focus');
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWindow;
}

/**
 * Lower the capture window's z-order so it stops sitting over the Settings window.
 * Called when Settings opens. We can't conditionally drop alwaysOnTop reliably
 * (Electron stacking is per-window-level), so the simplest correct fix is to
 * hide the capture window entirely while Settings is up — the user can always
 * re-trigger it via the hotkey or tray menu.
 */
export function hideCaptureForSettings(): void {
  if (captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible()) {
    captureWindow.hide();
  }
}

export function destroyCaptureWindow(): void {
  if (captureWindow) {
    captureWindow.removeAllListeners('close');
    captureWindow.destroy();
    captureWindow = null;
  }
  if (captureMicWindow) {
    captureMicWindow.removeAllListeners('close');
    captureMicWindow.removeAllListeners('blur');
    captureMicWindow.destroy();
    captureMicWindow = null;
  }
}
