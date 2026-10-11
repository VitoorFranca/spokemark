// Builds release/<APP_NAME>-darwin-arm64/<APP_NAME>.app and signs it ad hoc.
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

const [appDir] = await packager({
  dir: '.',
  out: 'release',
  overwrite: true,
  platform: 'darwin',
  arch: 'arm64',
  name: APP_NAME,
  appBundleId: BUNDLE_ID, // kept from the MVP: the TCC grant is tied to it
  icon: 'build/macos/icon.icns',
  appCategoryType: 'public.app-category.utilities',
  asar: true,
  prune: true,
  // Only the bundled JS is needed at runtime (react/zod are bundled by esbuild/vite).
  ignore: [/^\/(src|tests|native|vendor|build|scripts|docs|release|assets|test-results|\.git)(\/|$)/, /^\/dist\/cli(\/|$)/, /^\/playwright/, /^\/node_modules(\/|$)/, /\.(ts|tsx|mts|map)$/, /^\/(tsconfig|vite|vitest)/],
  extraResource: ['build/bin', 'assets/tray'], // -> Contents/Resources/{bin,tray}
  extendInfo: {
    LSUIElement: true, // menu bar app; the Dock icon is shown only while the main window is open
    LSMinimumSystemVersion: '14.4',
    NSAudioCaptureUsageDescription: `${APP_NAME} listens to the audio your Mac is playing to show live captions. Audio is processed on this Mac and never leaves it.`,
  },
});

const app = path.join(appDir, `${APP_NAME}.app`);
const bin = path.join(app, 'Contents', 'Resources', 'bin');
// Ad-hoc signing: helpers first, then the whole bundle.
for (const f of readdirSync(bin)) execFileSync('codesign', ['--force', '--sign', '-', path.join(bin, f)], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', 'build/macos/entitlements.plist', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`packaged + ad-hoc signed: ${app}`);
