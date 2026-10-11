// Dev: Vite dev server for the overlay + Electron main (rebuilt once at start).
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
await import('./build-main.mjs');
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = spawn(process.platform === 'darwin' ? 'node_modules/.bin/electron' : 'electron', ['.'], {
  stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
electron.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
