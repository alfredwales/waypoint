const { execFileSync } = require('child_process');
const path = require('path');

// electron-builder skips codesigning entirely when there's no Developer ID
// certificate in the keychain (our publish scripts also force this via
// --config.mac.identity=null). With no re-sign pass, the shipped .app keeps
// the base Electron.app template's stale ad-hoc signature, which doesn't cover
// the files we copy in afterward (icon, main.js, preload.js, index.html).
// macOS then sees a *broken* signature ("code has no resources but signature
// indicates they must be present") and Gatekeeper reports that to users as
// "app is damaged and can't be opened, you should move it to the Trash" -
// not a corrupted download, an invalid seal. Re-signing ad hoc here reseals
// every resource so the signature is internally consistent again. Gatekeeper
// will still flag the app as being from an unidentified developer (there's no
// paid Apple Developer ID / notarization involved), but that's the normal,
// dismissible "Open Anyway" prompt rather than the dead-end "damaged" one.
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
