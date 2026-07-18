// Minimal preload — isolated context between main and renderer.
// No Node.js APIs are exposed to the page. All app data stays in localStorage.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('waypointApp', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, status) => callback(status)),
});
