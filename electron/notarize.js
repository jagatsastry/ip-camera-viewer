/**
 * electron-builder afterSign hook for notarizing macOS builds.
 *
 * Required environment variables:
 *   APPLE_ID          — Your Apple ID email
 *   APPLE_ID_PASSWORD — App-specific password (generate at appleid.apple.com)
 *   APPLE_TEAM_ID     — Your Apple Developer Team ID
 *
 * This runs automatically during `electron-builder` for non-MAS macOS targets.
 * MAS builds are signed/notarized via Xcode / Transporter instead.
 */
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization if credentials aren't set (e.g. local dev builds)
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization: APPLE_ID, APPLE_ID_PASSWORD, or APPLE_TEAM_ID not set.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete.');
};
