// Builds release/<APP_NAME>-darwin-arm64/<APP_NAME>.app.
// Signing:
//   default            -> ad-hoc signature (local use / unsigned community builds)
//   SIGN_IDENTITY=...  -> Developer ID + hardened runtime (@electron/osx-sign)
//   + APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID -> notarized and stapled
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

for (const b of ['audiotap', 'whisper-worker']) {
  if (!existsSync(`build/bin/${b}`)) throw new Error(`build/bin/${b} missing — run npm run build:native`);
}

const brand = readFileSync('src/shared/brand.ts', 'utf8');
const APP_NAME = /APP_NAME = '([^']+)'/.exec(brand)[1];
const BUNDLE_ID = /BUNDLE_ID = '([^']+)'/.exec(brand)[1];

const identity = process.env.SIGN_IDENTITY || null;
const notarize = identity && process.env.APPLE_ID && process.env.APPLE_APP_PASSWORD && process.env.APPLE_TEAM_ID
  ? { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_PASSWORD, teamId: process.env.APPLE_TEAM_ID }
  : undefined;

const [appDir] = await packager({
  dir: '.',
  out: 'release',
  overwrite: true,
  platform: 'darwin',
  arch: 'arm64',
  name: APP_NAME,
  appBundleId: BUNDLE_ID, // permanent: the TCC grant is tied to it
  icon: 'build/macos/icon.icns',
  appCategoryType: 'public.app-category.utilities',
  asar: true,
  prune: true,
  // Only the bundled JS is needed at runtime (react/zod are bundled by esbuild/vite).
  ignore: [/^\/(src|tests|native|vendor|build|scripts|docs|release|assets|test-results|\.git)(\/|$)/, /^\/dist\/cli(\/|$)/, /^\/playwright/, /^\/node_modules(\/|$)/, /\.(ts|tsx|mts|map)$/, /^\/(tsconfig|vite|vitest)/],
  extraResource: ['build/bin', 'assets/tray'], // -> Contents/Resources/{bin,tray}
  ...(identity ? {
    osxSign: {
      identity,
      // hardened runtime for every binary; Electron needs JIT entitlements, helpers need none
      optionsForFile: (file) => ({ hardenedRuntime: true, entitlements: /\/Resources\/bin\//.test(file) ? undefined : 'build/macos/entitlements.plist' }),
    },
    osxNotarize: notarize,
  } : {}),
  extendInfo: {
    LSUIElement: true, // menu bar app; the Dock icon is shown only while the main window is open
    LSMinimumSystemVersion: '14.2', // CoreAudio Process Tap; matches MACOS_MIN in build-native.sh
    NSAudioCaptureUsageDescription: `${APP_NAME} listens to the audio your Mac is playing to show live captions. Audio is processed on this Mac and never leaves it.`,
  },
});

const app = path.join(appDir, `${APP_NAME}.app`);
if (!identity) {
  const bin = path.join(app, 'Contents', 'Resources', 'bin');
  // Ad-hoc signing: helpers first, then the whole bundle.
  for (const f of readdirSync(bin)) execFileSync('codesign', ['--force', '--sign', '-', path.join(bin, f)], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', 'build/macos/entitlements.plist', app], { stdio: 'inherit' });
}
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`packaged (${identity ? `Developer ID${notarize ? ', notarized' : ''}` : 'ad-hoc'}): ${app}`);
