// defineConfig is imported from 'vitest/config' (a superset re-export of vite's own) so
// the single config serves BOTH `vite build`/`vite dev` (which ignore the `test` key) and
// Vitest (which reads it). The react plugin is shared, giving test files the same JSX
// transform as the app. Build behavior is unchanged by this import swap.
import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig(({ command, mode }) => ({
  // The live org page (calendargame.github.io — also served at calendargame.app) lives at the ROOT,
  // so its CI build uses base '/'. The test/staging repo (vite-deploy-test) + any local build keep
  // '/vite-deploy-test/'. GitHub Actions sets GITHUB_REPOSITORY to "owner/repo", so one codebase
  // deploys correctly to both: the live build detects the calendargame.github.io repo.
  base:
    command === 'build'
      ? (process.env.GITHUB_REPOSITORY || '').endsWith('/calendargame.github.io')
        ? '/'
        : '/vite-deploy-test/'
      : '/',
  // React Compiler — automatic memoization (Stage D2). @vitejs/plugin-react v6 is Rolldown/oxc-based
  // and dropped its old `babel` option, so the compiler runs through @rolldown/plugin-babel fed the
  // plugin's `reactCompilerPreset()`. Defaults are exactly what we want: compilationMode 'infer'
  // (compiles components/hooks), target React 19 (imports react/compiler-runtime), and client-only
  // (the preset's applyToEnvironmentHook). All 40 react-hooks violations were fixed first so every
  // component is compiler-safe to optimize.
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // PWA (Stage D3): installable + fully offline. vite-plugin-pwa generates the web app
    // manifest + a Workbox service worker that precaches the whole build (so the app runs
    // with no network). registerType 'autoUpdate' + injectRegister 'auto' silently swap in a
    // new service worker on the next visit after a deploy — no update prompt for a solo tool.
    // start_url/scope are derived from Vite `base`, so this is correct for both the test base
    // (/vite-deploy-test/) and the eventual root cutover (/). Icons live in public/ (generated
    // from the W5 master by design/icons/build-icons.mjs); apple-touch + favicon are precached
    // via includeAssets and linked (incl. the dark variant) in index.html.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg', 'favicon-32x32.png'],
      manifest: {
        name: 'Calendar Game',
        short_name: 'Calendar Game',
        description: 'A mobile-first trainer for fast mental day-of-the-week calculation.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The SW never runs in dev (keeps HMR clean) — offline is verified against a production
      // build via `vite preview`.
      devOptions: { enabled: false },
    }),
    // Bundle analysis (Stage E2): `npm run analyze` (= `vite build --mode analyze`) emits an
    // interactive treemap to dist/stats.html so we can see what's in the JS bundle and catch
    // surprise bloat as the app grows. Gated on the 'analyze' mode so it NEVER runs in a normal
    // or CI build — zero effect on the shipped output.
    ...(mode === 'analyze'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            title: 'Calendar Game — bundle',
          }),
        ]
      : []),
  ],
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
