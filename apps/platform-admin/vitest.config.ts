import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Local runs reuse the backend's platform DATABASE_URL for fixtures; CI sets it directly.
if (!process.env.DATABASE_URL && existsSync('../backend/.env')) {
  process.loadEnvFile('../backend/.env');
}

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
