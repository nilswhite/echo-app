/**
 * Settings window — single-window form for configuring Echo.
 *
 * Owns the Settings BrowserWindow and the IPC contract used by `settings.html`.
 * Validates `structuringModel` against the active provider's model catalog before
 * persisting so we never save a model the chosen provider can't serve.
 */

import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import path from 'path';
import { getSettings, updateSettings, type Settings, type StructuringProvider } from '../server/services/settings-store.js';
import { listModels, refreshModels } from '../server/services/model-catalog.js';
import { resolveAttendees, resolvePeopleDirectory } from '../server/services/people-index.js';
import { hideCaptureForSettings, getCaptureWindow, getCaptureMicWindow } from './capture.js';

const ELECTRON_DIR = path.join(app.getAppPath(), 'electron');

let settingsWindow: BrowserWindow | null = null;
let handlersRegistered = false;

type SettingsListener = (settings: Settings) => void;
const listeners = new Set<SettingsListener>();

export function onSettingsChanged(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(settings: Settings): void {
  for (const listener of listeners) {
    try { listener(settings); } catch (err) { console.error('[settings] listener threw:', err); }
  }
}

/**
 * Register the settings IPC handlers eagerly at app startup. Capture and other
 * windows may call settings:read before the user ever opens the Settings window.
 */
export function registerSettingsHandlers(): void {
  registerHandlers();
}

export function showSettingsWindow(): void {
  registerHandlers();
  hideCaptureForSettings();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 540,
    height: 740,
    title: 'Echo Settings',
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ELECTRON_DIR, 'preload.js'),
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(ELECTRON_DIR, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function registerHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('settings:read', () => getSettings());

  ipcMain.handle('settings:write', async (_event, patch: Partial<Settings>) => {
    try {
      const provider = (patch.structuringProvider || getSettings().structuringProvider) as StructuringProvider;
      if (patch.structuringModel) {
        const { models } = await listModels(provider);
        if (!models.includes(patch.structuringModel)) {
          return {
            ok: false,
            error: `Model "${patch.structuringModel}" not available for ${provider}.`,
          };
        }
      }
      const settings = updateSettings(patch);
      notifyListeners(settings);
      // Broadcast theme to all open renderers (capture, mic picker, settings).
      if (patch.themeMode !== undefined) {
        const cap = getCaptureWindow();
        cap?.webContents.send('theme:apply', settings.themeMode);
        const mic = getCaptureMicWindow();
        mic?.webContents.send('theme:apply', settings.themeMode);
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.webContents.send('theme:apply', settings.themeMode);
        }
      }
      return { ok: true, settings };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('settings:pick-vault', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose your Obsidian vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('settings:list-models', (_event, provider: StructuringProvider) => listModels(provider));

  ipcMain.handle('settings:refresh-models', (_event, provider: StructuringProvider) => refreshModels(provider));

  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });

  ipcMain.handle('attendees:resolve', (_event, names: unknown) => {
    const list = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
    return resolveAttendees(list);
  });

  ipcMain.handle('attendees:people-dir', () => resolvePeopleDirectory());

  ipcMain.handle('settings:pick-people', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose your Obsidian "People" folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });
}
