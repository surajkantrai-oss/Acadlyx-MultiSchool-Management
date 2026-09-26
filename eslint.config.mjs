// Root ESLint flat config — used by the backend and all shared packages.
// Next.js and Expo apps extend their framework configs in their own eslint.config.mjs.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      'apps/backend/src/generated/**',
      'apps/platform-admin/**',
      'apps/school-admin/**',
      'apps/mobile/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // NestJS modules are decorated empty classes by design.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
