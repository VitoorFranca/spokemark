import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { port: 5199, strictPort: true },
});
