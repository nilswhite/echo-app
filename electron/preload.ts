/**
 * Preload bridge — exposes a narrow `window.echo` API to the renderer.
 *
 * Source-of-truth mirror of preload.js. The .js variant is what Electron actually
 * loads at runtime (the preload runs in a sandboxed renderer that can't use tsx).
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('echo', {
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (patch: unknown) => ipcRenderer.invoke('settings:write', patch),
  pickVault: () => ipcRenderer.invoke('settings:pick-vault'),
  listModels: (provider: string) => ipcRenderer.invoke('settings:list-models', provider),
  refreshModels: (provider: string) => ipcRenderer.invoke('settings:refresh-models', provider),
  closeSettings: () => ipcRenderer.send('settings:close'),

  cancelCapture: () => ipcRenderer.send('capture:cancel'),
  enterPillMode: () => ipcRenderer.send('capture:enter-pill-mode'),
  exitPillMode: () => ipcRenderer.send('capture:exit-pill-mode'),
  togglePillTitle: (expanded: boolean) => ipcRenderer.send('capture:pill-title-toggle', expanded),
  showMicPicker: (anchor: { left: number; top: number; right: number; bottom: number }) =>
    ipcRenderer.send('capture:mic-show', anchor),
  hideMicPicker: () => ipcRenderer.send('capture:mic-hide'),
  pickMicDevice: (deviceId: string, label: string) => ipcRenderer.send('capture:mic-device-picked', deviceId, label),
  onCaptureFocus: (cb: () => void) => ipcRenderer.on('capture:focus', () => cb()),
  onMicPickerShow: (cb: () => void) => ipcRenderer.on('mic-picker:show', () => cb()),
  onMicDevicePicked: (cb: (payload: { deviceId: string; label: string }) => void) =>
    ipcRenderer.on('mic-picker:device-picked', (_e, payload) => cb(payload)),
  publishMicDevices: (devices: Array<{ deviceId: string; label: string }>) =>
    ipcRenderer.send('mic:devices', devices),

  onThemeChange: (cb: (mode: 'system' | 'light' | 'dark') => void) =>
    ipcRenderer.on('theme:apply', (_e, mode) => cb(mode)),
});
