import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env: rely on the environment (Docker, CI)
}

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false, // tests create and drop real databases
  },
});
