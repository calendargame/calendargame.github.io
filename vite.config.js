// defineConfig is imported from 'vitest/config' (a superset re-export of vite's own) so
// the single config serves BOTH `vite build`/`vite dev` (which ignore the `test` key) and
// Vitest (which reads it). The react plugin is shared, giving test files the same JSX
// transform as the app. Build behavior is unchanged by this import swap.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vite-deploy-test/' : '/',
  plugins: [react()],
  test: {
    // Pure-logic tests run in Node (Vitest's default environment). DOM characterization
    // tests (Stage C, Step 6) opt into jsdom per-file via `// @vitest-environment jsdom`.
    // setupFiles run before every test file is imported, in that file's environment, so
    // the jsdom API stubs in tests/setup/dom.js are guaranteed in place before the app
    // module loads. The stubs are window-guarded, so this file is inert under Node and the
    // existing pure-logic tests are unaffected (they only gain jest-dom matchers on expect).
    setupFiles: ['./tests/setup/dom.js'],
    // Don't run the CSS pipeline (Tailwind/PostCSS) for tests — characterization tests
    // import the app (which imports index.css) but assert on behavior/markup, never styles.
    // Skipping CSS keeps the harness fast and removes a moving part. (This is Vitest's
    // default, set explicitly to document intent.)
    css: false,
  },
}))
