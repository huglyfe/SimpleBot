import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/.claude/**',
      '**/dist/**',
      // The assembled artifact is build output; its sources are linted here.
      'dist-package/**',
      'dist-public/**',
      // A two-line ESM shim over the built CLI, outside every tsconfig.
      'bin/**',
      'eslint.config.js',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.venv/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // These two rules are style choices the engine deliberately does not
    // follow. Every substantive strict rule stays on.
    rules: {
      // Fastify route handlers, `AttemptTool.execute`, and the authored-file
      // writers are async by contract, not because each body happens to await.
      '@typescript-eslint/require-await': 'off',
      // `() => this.#emit(...)` reads better than a braced body, and the
      // engine's void-returning callbacks are deliberate.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // The model/tool loop and the effect drain are `while (true)` with
      // explicit exits; that literal is the loop's contract, not an accident.
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: 'only-allowed-literals' },
      ],
      // Session variables are one plain record owned by SQLite; deleting a
      // key the operator named is the operation, and a Map would be ceremony.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // The composition root binds `cron` after the manager that calls it, so
      // the closure reads the binding before it is assigned. That is the one
      // ordering the root cannot avoid, and `const` cannot express it.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      // A leading underscore is the deliberate rest-omit spelling:
      // `({ sessionId: _sessionId, ...schedule })`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // `node:test` registration calls return promises the runner itself owns;
    // awaiting or voiding all of them would only obscure the suite.
    files: ['server/src/**/*.test.ts', 'server/src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
);
