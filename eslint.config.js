import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'android/**',
    'src/App-backup-before-*.{js,jsx,css}',
    'src/App-before-*.{js,jsx,css}',
    'server/index-before-*.js',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // App.jsx still contains older admin helpers kept for compatibility while
    // the dedicated Admin app owns the live dashboard. All other recommended
    // rules continue to run on this production entry point.
    files: ['src/App.jsx'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
])
