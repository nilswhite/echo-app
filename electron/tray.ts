/**
 * System tray — the only persistent UI surface in Echo.
 *
 * Menu: Capture, Settings…, Reveal Vault, Quit.
 * Tray click opens the capture window (most common action).
 */

import { Tray, Menu, nativeImage, app, shell, dialog } from 'electron';
import path from 'path';
import { getSettings, updateSettings } from '../server/services/settings-store.js';
import { showSettingsWindow } from './settings.js';
import { getMicDevices, onMicDevicesChanged } from './mic-registry.js';

const ELECTRON_DIR = path.join(app.getAppPath(), 'electron');

let tray: Tray | null = null;
let lastOnCapture: (() => void) | null = null;
let lastShortcut: string | undefined;

export function createTray(onCapture: () => void, shortcut?: string): void {
  lastOnCapture = onCapture;
  lastShortcut = shortcut;
  const iconPath = path.join(ELECTRON_DIR, 'assets', 'trayTemplate.png');
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createEmpty();
    else image.setTemplateImage(true);
  } catch {
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  if (image.isEmpty()) tray.setTitle('●');
  tray.setToolTip('Echo');

  rebuildMenu(onCapture, shortcut);
  // No tray.on('click') handler — left-click should show the context menu,
  // not silently open the capture window. Setting setContextMenu alone is
  // enough; macOS displays the menu on click when no click handler shadows it.

  // Rebuild the menu whenever the mic device list changes so the submenu stays fresh.
  onMicDevicesChanged(() => rebuildMenu(onCapture, shortcut));
}

export function rebuildMenu(onCapture: () => void, shortcut?: string): void {
  if (!tray) return;
  lastOnCapture = onCapture;
  lastShortcut = shortcut;

  const settings = getSettings();
  const devices = getMicDevices();
  const micItems: Electron.MenuItemConstructorOptions[] = devices.length
    ? [
        {
          label: 'System default',
          type: 'checkbox',
          checked: !settings.preferredMicId,
          click: () => pickMic('', 'System default'),
        },
        { type: 'separator' },
        ...devices.map((d): Electron.MenuItemConstructorOptions => ({
          label: d.label || d.deviceId.slice(0, 12),
          type: 'checkbox',
          checked: settings.preferredMicId === d.deviceId,
          click: () => pickMic(d.deviceId, d.label || ''),
        })),
      ]
    : [{ label: 'No devices found yet — open Capture once to enumerate', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: 'Capture', accelerator: shortcut || 'CommandOrControl+Shift+A', click: onCapture },
    { type: 'separator' },
    {
      label: settings.preferredMicLabel
        ? `Microphone: ${settings.preferredMicLabel}`
        : 'Microphone',
      submenu: micItems,
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => showSettingsWindow() },
    { label: 'Reveal Output Folder', click: revealVaultInbox },
    { type: 'separator' },
    { label: 'Quit Echo', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function pickMic(deviceId: string, label: string): void {
  updateSettings({ preferredMicId: deviceId, preferredMicLabel: label });
  // Rebuild so the checkmark moves immediately.
  if (lastOnCapture) rebuildMenu(lastOnCapture, lastShortcut);
}

function revealVaultInbox(): void {
  const { vaultPath } = getSettings();
  if (!vaultPath) {
    dialog.showMessageBox({
      type: 'info',
      message: 'No output folder configured',
      detail: 'Open Settings… and choose where Echo should write your notes.',
    });
    return;
  }
  shell.openPath(vaultPath).then((err) => {
    if (err) dialog.showErrorBox('Could not open folder', `${vaultPath}\n\n${err}`);
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
