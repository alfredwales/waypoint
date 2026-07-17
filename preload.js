// Minimal preload — isolated context between main and renderer.
// No Node.js APIs are exposed to the page. All app data stays in localStorage.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('waypointApp', {
  version: process.env.npm_package_version || '',
  platform: process.platform,
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
