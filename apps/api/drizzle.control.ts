import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/control-schema.ts',
  out: './migrations/control',
  casing: 'snake_case',
});
