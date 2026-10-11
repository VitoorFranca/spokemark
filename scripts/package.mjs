// Builds release/Live Captions-darwin-arm64/Live Captions.app and signs it ad hoc.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

for (const b of ['audiotap', 'whisper-worker']) {
  if (!existsSync(`build/bin/${b}`)) throw new Error(`build/bin/${b} missing — run npm run build:native`);
}

const [appDir] = await packager({
  dir: '.',
  out: 'release',
  overwrite: true,
  platform: 'darwin',
  arch: 'arm64',
  name: 'Live Captions',
  appBundleId: 'dev.local.livecaptions',
  appCategoryType: 'public.app-category.utilities',
  asar: true,
  prune: true,
  // Only the bundled JS is needed at runtime (react/zod are bundled by esbuild/vite).
  ignore: [/^\/(src|tests|native|vendor|build|scripts|docs|release|\.git)(\/|$)/, /^\/dist\/cli(\/|$)/, /^\/node_modules(\/|$)/, /\.(ts|tsx|mts|map)$/, /^\/(tsconfig|vite|vitest)/],
  extraResource: ['build/bin'], // -> Contents/Resources/bin/{audiotap,whisper-worker}
  extendInfo: {
    LSUIElement: true, // menu bar app, no Dock icon
    LSMinimumSystemVersion: '14.4',
    NSAudioCaptureUsageDescription: 'Live Captions captures the audio your Mac is playing to show subtitles locally. Audio never leaves this computer.',
  },
});

const app = path.join(appDir, 'Live Captions.app');
const bin = path.join(app, 'Contents', 'Resources', 'bin');
// Ad-hoc signing: helpers first, then the whole bundle.
for (const f of readdirSync(bin)) execFileSync('codesign', ['--force', '--sign', '-', path.join(bin, f)], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', 'build/macos/entitlements.plist', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`packaged + ad-hoc signed: ${app}`);
