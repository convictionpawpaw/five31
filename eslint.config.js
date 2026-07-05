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
              // Block every import specifier, then re-allow ONLY relative imports
              // that stay within src/core (start with ./ and do not escape via ..).
              // This bans bare/scoped packages (react, dexie, ulid, …) AND any
              // parent-directory escape (../…) out of the core purity zone.
              regex: '^(?!\\.\\/)(?!.*\\.\\.\\/).*|\\.\\.\\/',
              message:
                'src/core is a pure engine: no external packages (react, dexie, etc.) and no imports from outside src/core. Only ./relative imports within core are allowed.',
            },
          ],
        },
      ],
    },
  },
]);
