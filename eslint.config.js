import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  // Core purity zone: src/core must be a pure engine with NO imports from
  // react, dexie, or any path outside src/core. Enforced via no-restricted-imports.
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Any bare/scoped package import (not starting with . or /) is external.
              group: ['*', '!./*', '!../*'],
              message:
                'src/core is a pure engine: no external package imports (react, dexie, etc.). Only relative imports within src/core are allowed.',
            },
            {
              // Escaping the core directory via relative parent paths is forbidden.
              group: ['../*', '../../*', '../../../*'],
              message:
                'src/core is a pure engine: no imports from outside src/core (relative paths must stay within core).',
            },
          ],
        },
      ],
    },
  },
]);
