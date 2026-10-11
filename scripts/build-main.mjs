// Bundles main, preload and the headless CLI with esbuild (renderer is built by Vite).
import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: true, external: ['electron'], logLevel: 'warning' };
await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' }),
  // sandboxed preload: everything (incl. zod) must be bundled into one CJS file
  build({ ...common, entryPoints: ['src/preload/overlay.ts'], outfile: 'dist/preload/overlay.js' }),
  build({ ...common, entryPoints: ['src/cli/transcribe.ts'], outfile: 'dist/cli/transcribe.js' }),
]);
