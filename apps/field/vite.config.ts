import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Three installable pages on tablets and phones: POS, receiving, and the guest QR menu.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } } },
  build: {
    rollupOptions: {
      input: {
        pos: resolve(import.meta.dirname, 'pos/index.html'),
        receiving: resolve(import.meta.dirname, 'receiving/index.html'),
        menu: resolve(import.meta.dirname, 'menu/index.html'),
      },
    },
  },
});
