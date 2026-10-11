import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(__dirname, 'src/renderer');
export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      // one entry per surface; components and tokens are shared chunks
      input: Object.fromEntries(['overlay', 'panel', 'main', 'settings', 'onboarding'].map((n) => [n, resolve(root, `${n}.html`)])),
    },
  },
  server: { port: 5199, strictPort: true },
});
