/**
 * Mic registry — keeps a fresh list of audio input devices in the main process.
 *
 * The list comes from the capture renderer's `navigator.mediaDevices.enumerateDevices()`
 * (main process can't enumerate directly). Capture renderer broadcasts updates on
 * startup + on every `devicechange` event. The tray menu reads the cache and
 * rebuilds its mic submenu whenever the list changes.
 */

import { ipcMain } from 'electron';

export interface MicDevice {
  deviceId: string;
  label: string;
}

let cachedDevices: MicDevice[] = [];
const listeners = new Set<(devices: MicDevice[]) => void>();

export function getMicDevices(): MicDevice[] {
  return [...cachedDevices];
}

export function onMicDevicesChanged(listener: (devices: MicDevice[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerMicRegistryHandlers(): void {
  ipcMain.on('mic:devices', (_event, devices: MicDevice[]) => {
    if (!Array.isArray(devices)) return;
    cachedDevices = devices.filter((d) => d && typeof d.deviceId === 'string');
    for (const listener of listeners) {
      try { listener(cachedDevices); } catch (err) { console.error('[mic-registry] listener threw:', err); }
    }
  });
}
