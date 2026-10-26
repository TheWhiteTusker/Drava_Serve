import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false }, // keep the original code unreadable to anyone with the files
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } } },
});
