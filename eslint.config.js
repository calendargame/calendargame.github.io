import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Accessibility linting for JSX (alt text, aria, roles, labels, etc.).
      // The plugin's published peer range lags (it lists eslint <=9), but it loads
      // and lints correctly on our eslint 10 — verified, and pinned via an explicit
      // package.json `overrides` so this is a documented choice, not a blind --force.
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // No dead code: unused vars/imports are now an ERROR. The mode-untangle landed and
      // the fused App engine (the old home of the deferred unused locals) is deleted, so the
      // codebase is unused-var-clean and this rule can hold the line going forward.
      // `ignoreRestSiblings` permits the intentional "strip fields via rest" destructure
      // (e.g. `const {btns, isLive, ...date}=e` in gameReducer's stripEntryMeta); the `^_`
      // pattern still marks any other deliberate discard.
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // ── React-Compiler-strict hook rules: DEFERRED to the React Compiler step (Stage D). ──
      // React 19's react-hooks plugin enforces Compiler-grade purity/immutability. The
      // mode-untangle is done (the fused App engine that tripped the bulk of these is gone),
      // but ~40 findings remain in the LIVE mode components + reducer — e.g. reading a timer
      // ref during render to show the live countdown, performance.now() in a handler, setState
      // inside a rAF effect. That code is CORRECT and fully tested; the patterns just aren't
      // React-Compiler-optimizable yet. They get fixed AT THE SOURCE when we turn on the React
      // Compiler (Stage D) — with the compiler in the loop to verify each refactor actually
      // helps. Kept WARN until then (always visible, never silently suppressed); flipping them
      // to error is part of enabling the Compiler.
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // TypeScript (.ts/.tsx): the typescript-eslint parser (so ESLint can read TS syntax at all)
  // + its recommended, non-type-aware ruleset. Its no-unused-vars supersedes the core rule for
  // TS (it understands type-only usage), so we turn the core one off here and mirror our error
  // severity + ignoreRestSiblings on the TS version.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // main.jsx is the app entry (renders the root) — it legitimately defines
    // components without exporting them, which the react-refresh rule flags. That
    // rule is for HMR of component MODULES, not the entry file, so silence it here.
    // (As the mode-untangle moves components into their own files, this shrinks.)
    files: ['src/main.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // MUST be last: turns off any ESLint rules that would conflict with Prettier's
  // formatting, so the two tools never fight (ESLint = correctness, Prettier = style).
  prettier,
])
