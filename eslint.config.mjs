import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'
import importX from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'build', 'src/noVNC']),

  // ── Source & library code ──────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      reactX.configs.recommended,
      reactDom.configs.recommended,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
    rules: {
      // TypeScript already validates default imports; avoids false positives
      // on React's `export =` module pattern
      'import-x/default': 'off',

      // bun:test is a Bun built-in; @novnc/novnc/lib/rfb is a valid subpath
      // not declared in the package's `exports` field
      'import-x/no-unresolved': ['error', {
        ignore: ['^bun:', '@novnc/novnc/lib/rfb'],
      }],
    },
  },

  // ── Test files — relax rules for mocks and test utilities ──────────
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      'react-x/no-create-ref': 'off',
    },
  },
])
