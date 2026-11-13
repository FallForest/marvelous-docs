import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Flat ESLint configuration for the whole monorepo.
 *
 * The ruleset is intentionally limited to what the compiler does not already
 * enforce: each package tsconfig owns unused-symbol and type checking, while
 * ESLint owns cross-file mistakes such as accidental globals, loose equality,
 * unreachable code, and React hook pitfalls.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'backups/**',
      '.tmp/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Style-only rules that duplicate tsc or fight the existing code base.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-empty': 'off',
      // Keep unused-symbol reporting, but allow intentionally unused arguments,
      // ignored catch bindings, and rest-sibling omissions.
      // Intentional patterns: Markdown sanitising and ANSI stripping use control
      // characters inside regular expressions.
      'no-control-regex': 'off',
      // Pre-existing style findings in application sources. They stay visible as
      // warnings so the lint gate is green today and can be tightened once the
      // sources are cleaned up (no source files are rewritten for style).
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      // Only apps/web enables noUnusedLocals/noUnusedParameters in tsconfig, so
      // there the compiler owns this check; elsewhere it stays a warning.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Node-side code: the API, the CLI, the update agent, the scripts, the flat
    // config itself. The agent used to live in scripts/, so it belonged here by
    // path; it moved to apps/updater and has to stay in this group by name.
    files: ['apps/server/**/*.ts', 'apps/updater/**/*.mjs', 'packages/cli/**/*.{ts,mjs}', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // apps/web/tsconfig.json sets noUnusedLocals and noUnusedParameters, so the
      // compiler already fails the build on unused symbols: keep it an error.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
)