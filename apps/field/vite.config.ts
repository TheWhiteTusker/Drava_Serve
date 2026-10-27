import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Four installable pages on tablets and phones: POS, receiving, kitchen, and the guest QR menu.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } } },
  build: {
    sourcemap: false, // keep the original code unreadable to anyone with the files
    // Not /assets: the admin app uses that, and on Vercel each path belongs to one service.
    assetsDir: 'field-assets',
    rollupOptions: {
      input: {
        pos: resolve(import.meta.dirname, 'pos/index.html'),
        receiving: resolve(import.meta.dirname, 'receiving/index.html'),
        menu: resolve(import.meta.dirname, 'menu/index.html'),
        kitchen: resolve(import.meta.dirname, 'kitchen/index.html'),
      },
    },
  },
});
