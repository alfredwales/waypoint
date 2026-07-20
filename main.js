const { app, BrowserWindow, shell, session, dialog, ipcMain, clipboard, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');

const REPO_OWNER = 'alfredwales';
const REPO_NAME = 'waypoint';
const APP_ICON = path.join(__dirname, 'build', 'icon.png');

// ── Logging ──────────────────────────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// We only use electron-updater to check for and describe available updates.
// Actually downloading + installing macOS updates is handled ourselves below —
// see the note by downloadUpdateDmg() for why.
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
ipcMain.handle('get-app-version', () => app.getVersion());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Auto-updater ───────────────────────────────────────────────────────────────
// macOS auto-update normally works by handing a downloaded zip to Apple's native
// Squirrel/ShipIt updater, which swaps the app in place. ShipIt requires the new
// build's code signature to satisfy the running app's code requirement — that
// only holds for apps signed with a real (paid) Apple Developer ID. We ship ad
// hoc signed, so every install attempt fails validation. Rather than silently
// failing, we check for updates via electron-updater as before, but download and
// present the DMG ourselves, then let the user do the normal drag-to-Applications
// install from its (custom-branded) installer window.
autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  dialog.showMessageBox(getWin(), {
    type: 'info',
    icon: APP_ICON,
    title: 'Update available',
    message: `Waypoint ${info.version} is available.`,
    detail: 'The update will download in the background, then open an installer window with instructions.',
    buttons: ['Download & Install', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) downloadUpdateDmg(info);
  });
});

autoUpdater.on('update-not-available', () => {
  log.info('App is up to date');
});

autoUpdater.on('error', (err) => {
  log.error('Auto-updater error (checking for update):', err);
});

function downloadUpdateDmg(info) {
  const dmgFile = (info.files || []).find(f => f.url.endsWith('.dmg'));
  if (!dmgFile) {
    log.error('No .dmg file listed for this release:', info.version);
    showManualDownloadDialog('Could not find a downloadable installer for this update.');
    return;
  }

  const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${info.version}/${dmgFile.url}`;
  const destPath = path.join(app.getPath('downloads'), dmgFile.url);
  const win = getWin();
  if (win) win.webContents.send('update-status', { type: 'start' });

  const request = net.request(url);
  request.on('response', (response) => {
    if (response.statusCode >= 400) {
      log.error(`Update download failed: HTTP ${response.statusCode}`);
      if (win) win.webContents.send('update-status', { type: 'error' });
      showManualDownloadDialog('Could not download the update automatically.');
      return;
    }
    const total = Number(response.headers['content-length']) || dmgFile.size || 0;
    let received = 0;
    const fileStream = fs.createWriteStream(destPath);
    response.on('data', (chunk) => {
      received += chunk.length;
      fileStream.write(chunk);
      if (win) {
        if (total) win.setProgressBar(received / total);
        win.webContents.send('update-status', { type: 'progress', percent: total ? (received / total) * 100 : 0 });
      }
    });
    response.on('end', () => {
      fileStream.end(() => {
        if (win) win.setProgressBar(-1);
        verifyAndOpenInstaller(destPath, dmgFile, win);
      });
    });
    response.on('error', (err) => {
      fileStream.close();
      log.error('Update download stream error:', err);
      if (win) win.webContents.send('update-status', { type: 'error' });
      showManualDownloadDialog('Could not download the update automatically.');
    });
  });
  request.on('error', (err) => {
    log.error('Update download request error:', err);
    if (win) win.webContents.send('update-status', { type: 'error' });
    showManualDownloadDialog('Could not download the update automatically.');
  });
  request.end();
}

function verifyAndOpenInstaller(destPath, dmgFile, win) {
  if (!dmgFile.sha512) { finishInstall(destPath, win); return; }
  const hash = crypto.createHash('sha512');
  const stream = fs.createReadStream(destPath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => {
    if (hash.digest('base64') !== dmgFile.sha512) {
      log.error('Downloaded update failed checksum verification');
      fs.unlink(destPath, () => {});
      if (win) win.webContents.send('update-status', { type: 'error' });
      showManualDownloadDialog('The downloaded update looked corrupted, so it was discarded.');
      return;
    }
    finishInstall(destPath, win);
  });
  stream.on('error', (err) => {
    log.warn('Checksum verification read error, installing anyway:', err);
    finishInstall(destPath, win);
  });
}

function finishInstall(destPath, win) {
  if (win) win.webContents.send('update-status', { type: 'complete' });
  log.info('Update downloaded and verified:', destPath);
  dialog.showMessageBox(getWin(), {
    type: 'info',
    icon: APP_ICON,
    title: 'Ready to install',
    message: 'Update downloaded — installer window opening now.',
    detail: [
      'When the Waypoint window appears:',
      '',
      '  1. Drag Waypoint into Applications',
      '  2. Click Replace when prompted',
      '  3. Reopen Waypoint from Applications',
      '',
      'This app will close automatically once the installer opens.',
    ].join('\n'),
    buttons: ['Open installer', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response !== 0) return;
    shell.openPath(destPath).then((errorMessage) => {
      if (errorMessage) {
        log.error('Failed to open installer:', errorMessage);
        showManualDownloadDialog('Could not open the installer automatically.');
        return;
      }
      app.quit();
    });
  });
}

function showManualDownloadDialog(message) {
  dialog.showMessageBox(getWin(), {
    type: 'info',
    icon: APP_ICON,
    title: 'Download failed',
    message,
    detail: 'You can download it directly in your browser instead.',
    buttons: ['Download installer', 'Cancel'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) shell.openExternal(`https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/Waypoint-arm64.dmg`);
  });
}
