import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'test-results']),
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
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // React-Compiler hook rules run at their recommended severities (the Stage-D deferral is over:
      // the compiler is enabled in vite.config and every violation was fixed at the source). The
      // compiler-correctness rules — refs, purity, immutability, set-state-in-effect,
      // static-components, preserve-manual-memoization, etc. — are ERRORS via
      // reactHooks.configs.flat.recommended (extended above), so a regression that makes a component
      // un-optimizable (and risks a subtle miscompile) blocks CI.
      // exhaustive-deps is bumped from its recommended `warn` to ERROR too — the site owner wants a
      // hard 0-errors / 0-warnings bar, so a missing/extra effect dependency must BLOCK CI rather
      // than linger as a warning. It's a heuristic with known false-positives (more so with the
      // compiler stabilizing functions the linter can't see), so the few genuinely-intentional
      // exclusions carry justified inline `eslint-disable … react-hooks/exhaustive-deps` comments.
      // (The two remaining recommended-`warn` rules — incompatible-library + unsupported-syntax —
      // are "the compiler skipped optimizing this component" notices, currently silent; left as soft
      // warnings so a future non-bug can't block the build. Flip them to error if you want it
      // impossible for any warning to ever appear.)
      'react-hooks/exhaustive-deps': 'error',
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // main.tsx is the app entry (renders the root) — it legitimately defines
    // components without exporting them, which the react-refresh rule flags. That
    // rule is for HMR of component MODULES, not the entry file, so silence it here.
    // (As the mode-untangle moves components into their own files, this shrinks.)
    files: ['src/main.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // Build config files (vite.config.js, postcss.config.js, eslint.config.js) run in Node, not the
  // browser — give them Node globals so `no-undef` doesn't flag e.g. `process.env` (the live build
  // reads process.env.GITHUB_REPOSITORY to pick the base path).
  {
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  // Tests run under vitest in Node with a jsdom DOM, so they need BOTH browser globals (the DOM tests
  // touch document/window) AND Node globals (the fuzz harness reads process.env.FUZZ_SCALE to scale a
  // one-time sweep). The base block above grants only browser globals.
  // react-refresh is off here for the same reason it is off for src/main.tsx, only more plainly: the
  // rule exists so the dev server can hot-replace a component MODULE, and nothing under tests/ is in
  // the dev server's graph at all. Test fixtures and helpers legitimately define a component beside
  // the functions that drive it (tests/helpers/guideScroller mounts the guide inside a stand-in for
  // App's scroll box), and moving those apart would split one idea across two files to satisfy a
  // rule about a build step they never take part in.
  {
    files: ['tests/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // The browser lane (tests/browser, run by Playwright) holds no React at all, and Playwright's
  // fixtures hand each one a callback NAMED `use` — which the hooks rule reads as React's `use`
  // hook called outside a component. Off for these files only; nothing in them can call a hook.
  {
    files: ['tests/browser/**/*.{js,ts}', 'playwright.config.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  // MUST be last: turns off any ESLint rules that would conflict with Prettier's
  // formatting, so the two tools never fight (ESLint = correctness, Prettier = style).
  prettier,
])
