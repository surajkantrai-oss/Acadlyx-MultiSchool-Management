import { config as loadDotenv } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// e2e tests talk to the real local PostgreSQL/Redis. Values come from the shell (CI)
// or fall back to apps/backend/.env for local runs.
const { parsed: dotenv = {} } = loadDotenv({ quiet: true });

// SWC is required because Vitest's default transform does not emit decorator
// metadata, which NestJS dependency injection relies on.
const swcPlugin = swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [swcPlugin],
        test: { name: 'unit', include: ['src/**/*.spec.ts'], environment: 'node' },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          environment: 'node',
          fileParallelism: false,
          env: { ...dotenv, ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' },
        },
      },
    ],
  },
});
