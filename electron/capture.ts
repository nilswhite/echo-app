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
const PILL_WIDTH = 252;  // single control row: mic, bars, timer, Notes, stop, expand
const PILL_HEIGHT = 44;

// Notes mode — the pill expands in place into a portrait window: the pill
// controls stay pinned at the top, with the attendees + notes fields below.
// Same window as the pill (one surface, not a popover), so it inherits the
// backgroundThrottling:false fix while a recording is in progress.
// The notes portrait keeps the pill's width — only the height animates. Animating
// width too makes the pill controls + panel text reflow every frame (a jiggle).
const NOTES_PORTRAIT_H = 432;

let captureWindow: BrowserWindow | null = null;
let captureMicWindow: BrowserWindow | null = null;
let preEnterPillBounds: { x: number; y: number; width: number; height: number } | null = null;
let notesTween: ReturnType<typeof setInterval> | null = null;
let handlersRegistered = false;

/**
 * Confine a popover's bounds to the work area of the display containing the pill.
 *
 * The previous code used `Math.max(0, ...)`, which clamped to the global origin
 * (the primary monitor's left edge) — anchoring popovers to primary whenever the
 * pill lived on a secondary monitor whose coordinates included negative x.
 */
function clampToDisplay(
  proposed: { x: number; y: number; width: number; height: number },
  pillBounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const display = screen.getDisplayMatching(pillBounds);
  const wa = display.workArea;
  const x = Math.max(wa.x, Math.min(proposed.x, wa.x + wa.width - proposed.width));
  const y = Math.max(wa.y, Math.min(proposed.y, wa.y + wa.height - proposed.height));
  return { x: Math.round(x), y: Math.round(y), width: proposed.width, height: proposed.height };
}

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
      // Keep the renderer fully awake while occluded. The recorder reads from a
      // Web Audio graph (destinationNode.stream); Chromium suspends the
      // AudioContext and throttles timers when the window is hidden behind
      // Mission Control / a Space switch / another app, which silently stalls
      // the recording. Must be set at construction — toggling it dynamically on
      // an already-occluded window causes a visibility desync (electron #50250).
      backgroundThrottling: false,
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

  ipcMain.on('capture:cancel', () => {
    if (captureMicWindow?.isVisible()) captureMicWindow.hide();
    hideCaptureSilently();
  });

  ipcMain.on('capture:mic-show', (_event, anchor: { left: number; top: number; right: number; bottom: number }) => {
    if (!captureWindow || !captureMicWindow) return;
    const cap = captureWindow.getBounds();
    const W = 300, H = 340;
    captureMicWindow.setBounds(
      clampToDisplay({
        x: Math.round(cap.x + anchor.right) - W,
        y: Math.round(cap.y + anchor.bottom) + 8,
        width: W,
        height: H,
      }, cap),
    );
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

  // Notes mode: animate the pill in place into a portrait window (and back).
  // We STEP the bounds ourselves (setBounds with animate:false each frame) rather
  // than using the native animated resize — the native one anchors the web content
  // to the bottom mid-animation, dragging it up over the pill. Stepping keeps the
  // content top-anchored; and because every step is a real frame, the window
  // shadow tracks the size (no lingering ghost) and it ends exactly on target (no
  // snap/bump). Both width and height tween together, anchored top-right so it
  // grows down and to the left (the pill sits near the top-right of the display).
  ipcMain.on('capture:notes-toggle', (_event, expanded: boolean) => {
    if (!captureWindow) return;
    if (notesTween) { clearInterval(notesTween); notesTween = null; }
    const b = captureWindow.getBounds();
    const { x, y, width } = b;          // position + width stay fixed: purely vertical motion
    const startH = b.height;
    const endH = expanded ? NOTES_PORTRAIT_H : PILL_HEIGHT;
    if (startH === endH) return;
    const STEPS = 18;
    let i = 0;
    notesTween = setInterval(() => {
      if (!captureWindow) { if (notesTween) clearInterval(notesTween); notesTween = null; return; }
      i++;
      const t = i / STEPS;
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      const h = Math.round(startH + (endH - startH) * eased);
      captureWindow.setBounds({ x, y, width, height: h }, false);
      if (i >= STEPS) {
        if (notesTween) clearInterval(notesTween);
        notesTween = null;
        captureWindow.setBounds({ x, y, width, height: endH }, false);
      }
    }, 12);
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

export function getCaptureMicWindow(): BrowserWindow | null {
  return captureMicWindow;
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
