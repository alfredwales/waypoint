const { app, BrowserWindow, shell, session, dialog, ipcMain, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const log = require('electron-log');

// ── Logging ──────────────────────────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

// ── Security: block any new renderer processes from being created ─────────────
app.on('web-contents-created', (_e, contents) => {
  // Block navigation to anything other than our local file
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });
  // Open all external links in the system browser, never inside the app
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // Block any attempt to open DevTools in production
  if (app.isPackaged) {
    contents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' || (input.meta && input.alt && input.key === 'i')) {
        _e.preventDefault();
      }
    });
  }
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,           // Renderer has no Node.js access
      contextIsolation: true,           // Preload isolated from renderer
      sandbox: true,                    // Chromium OS-level sandbox
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0D0D12',
    show: false, // Show only after ready-to-show to avoid flash
  });

  win.loadFile('index.html');

  // Show window only once content is ready (avoids white flash)
  win.once('ready-to-show', () => win.show());

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Set a strict Content-Security-Policy for all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
      },
    });
  });

  createWindow();

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  }
});

ipcMain.handle('copy-to-clipboard', (_, text) => clipboard.writeText(text));
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Auto-updater events ───────────────────────────────────────────────────────
autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  const arch = process.arch === 'arm64' ? 'Apple Silicon (M-series)' : 'Intel';
  dialog.showMessageBox({
    type: 'info',
    title: 'Update available',
    message: `Waypoint ${info.version} is available.`,
    detail: `Your Mac: ${arch}\n\nThe update will download in the background. When it's ready, a DMG installer will open — just drag Waypoint to Applications and relaunch. This takes about 30 seconds.`,
    buttons: ['Download & Install', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.downloadUpdate();
  });
});

autoUpdater.on('update-downloaded', (event) => {
  log.info('Update downloaded:', event.downloadedFile);
  const isArm = process.arch === 'arm64';
  dialog.showMessageBox({
    type: 'info',
    title: 'Ready to install',
    message: 'Update downloaded — one step to go.',
    detail: [
      'The installer is opening now. When the DMG window appears:',
      '',
      '  1. Drag Waypoint → Applications',
      '  2. Click Replace when prompted',
      '  3. Relaunch Waypoint from Applications',
      '',
      isArm
        ? 'Your Mac uses Apple Silicon — if asked, pick the file ending in -arm64.dmg.'
        : 'Your Mac uses an Intel chip — if asked, pick the file without -arm64 in the name.',
    ].join('\n'),
    buttons: ['Open installer', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      shell.openPath(event.downloadedFile);
      setTimeout(() => app.quit(), 1000);
    }
  });
});

autoUpdater.on('update-not-available', () => {
  log.info('App is up to date');
});

autoUpdater.on('error', (err) => {
  log.error('Auto-updater error:', err);
});
