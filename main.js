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
let mainWindow = null;

function getWin() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0] || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0D0D12',
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Check for updates only after window is visible, with a short delay
    if (app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdates(), 3000);
    }
  });

  return mainWindow;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
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
  dialog.showMessageBox(getWin(), {
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
  dialog.showMessageBox(getWin(), {
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
