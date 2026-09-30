import { defineConfig } from 'vitest/config';

// Pure-logic unit tests only (no React Native runtime): src/**/*.test.ts.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
