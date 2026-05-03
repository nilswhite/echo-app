"use strict";

// Compiled mirror of electron/preload.ts — Electron's preload runs in a sandboxed
// renderer that can't load TypeScript via tsx, so we ship the JS directly.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echo", {
  // Settings window
  readSettings: () => ipcRenderer.invoke("settings:read"),
  writeSettings: (patch) => ipcRenderer.invoke("settings:write", patch),
  pickVault: () => ipcRenderer.invoke("settings:pick-vault"),
  listModels: (provider) => ipcRenderer.invoke("settings:list-models", provider),
  refreshModels: (provider) => ipcRenderer.invoke("settings:refresh-models", provider),
  closeSettings: () => ipcRenderer.send("settings:close"),

  // Capture window
  cancelCapture: () => ipcRenderer.send("capture:cancel"),
  enterPillMode: () => ipcRenderer.send("capture:enter-pill-mode"),
  exitPillMode: () => ipcRenderer.send("capture:exit-pill-mode"),
  togglePillTitle: (expanded) => ipcRenderer.send("capture:pill-title-toggle", expanded),
  showMicPicker: (anchor) => ipcRenderer.send("capture:mic-show", anchor),
  hideMicPicker: () => ipcRenderer.send("capture:mic-hide"),
  pickMicDevice: (deviceId, label) => ipcRenderer.send("capture:mic-device-picked", deviceId, label),
  onCaptureFocus: (cb) => ipcRenderer.on("capture:focus", () => cb()),
  onMicPickerShow: (cb) => ipcRenderer.on("mic-picker:show", () => cb()),
  onMicDevicePicked: (cb) => ipcRenderer.on("mic-picker:device-picked", (_e, payload) => cb(payload)),

  // Mic registry — capture renderer broadcasts device list to main.
  publishMicDevices: (devices) => ipcRenderer.send("mic:devices", devices),

  // Theme — main broadcasts new mode to all renderers when settings change.
  onThemeChange: (cb) => ipcRenderer.on("theme:apply", (_e, mode) => cb(mode)),
});
