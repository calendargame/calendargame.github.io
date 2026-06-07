// defineConfig is imported from 'vitest/config' (a superset re-export of vite's own) so
// the single config serves BOTH `vite build`/`vite dev` (which ignore the `test` key) and
// Vitest (which reads it). The react plugin is shared, giving test files the same JSX
// transform as the app. Build behavior is unchanged by this import swap.
import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// GitHub Pages serves the org ROOT page `calendargame.github.io` (and its custom domain
// calendargame.app) from '/', but every PROJECT repo's Pages site from '/<repo>/'. CI sets
// GITHUB_REPOSITORY="owner/repo", so deriving the base from it lets ONE codebase deploy correctly to
// BOTH the live repo and the staging repo (currently `test_version`) — and it stays correct even if
// the staging repo is renamed later, with no code change. Local builds have no GITHUB_REPOSITORY → '/'.
const pagesBase = (repository) => {
  const repo = (repository || '').split('/')[1] || ''
  return repo && repo !== 'calendargame.github.io' ? `/${repo}/` : '/'
}

// True only for the live production repo's CI build. Used to inject the Cloudflare Web Analytics
// beacon on PRODUCTION ONLY (calendargame.app) — not the staging repo, not local/dev builds — so our
// own testing never pollutes the real visitor numbers.
const isLiveRepo = (repository) => (repository || '').endsWith('/calendargame.github.io')

// Cloudflare Web Analytics: privacy-first, cookieless page analytics (no consent banner needed).
// The site is DNS-only (not proxied through Cloudflare), so Cloudflare can't auto-collect — we inject
// the manual beacon into the built index.html. The token is PUBLIC (it ships in the page HTML for
// every visitor), so it's fine in source. Remove this plugin + its conditional below to drop analytics.
// ⚠ The token below must be the value from Cloudflare's "Enable with JS Snippet installation" snippet —
// NOT the dashboard site ID (the /web-analytics/edit/<id> value). Using the site ID was the original B1
// bug: beacons sent fine but Cloudflare silently dropped them all (zero data). Fixed 2026-06-06.
const cfWebAnalytics = () => ({
  name: 'cf-web-analytics-beacon',
  transformIndexHtml: (html) =>
    html.replace(
      '</head>',
      `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "f9c4758b29d04e02ad0e757ae824a4b5"}'></script>\n</head>`,
    ),
})

export default defineConfig(({ command, mode }) => ({
  // Dev/preview serve from '/'. A production `vite build` derives its base from the repo it builds
  // in (see pagesBase above): '/' for the live org page, '/<repo>/' for the staging project repo.
  base: command === 'build' ? pagesBase(process.env.GITHUB_REPOSITORY) : '/',
  // Sentry tree-shaking flags (Current Work C1): compile OUT debug logging and all performance-
  // tracing code paths from the lazy error-reporting chunk (we use Sentry for errors only — see
  // src/observability/). This + the static named imports in src/observability/sentryClient.ts keep
  // Session Replay (rrweb), Tracing, and Profiling out of the bundle. The string 'false' is inserted
  // as the raw token `false` (Vite define = raw expression substitution).
  define: {
    __SENTRY_DEBUG__: 'false',
    __SENTRY_TRACING__: 'false',
  },
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
    // start_url/scope are derived from Vite `base`, so this is correct for both the live root (/)
    // and the staging project base (/<repo>/). Icons live in public/ (generated
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
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // The SW never runs in dev (keeps HMR clean) — offline is verified against a production
      // build via `vite preview`.
      devOptions: { enabled: false },
    }),
    // Cloudflare Web Analytics beacon — PRODUCTION build only (see cfWebAnalytics + isLiveRepo above),
    // so the staging repo and local/dev builds never report and the real numbers stay clean.
    ...(command === 'build' && isLiveRepo(process.env.GITHUB_REPOSITORY) ? [cfWebAnalytics()] : []),
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
    // Sentry source-map upload (Current Work C1b): makes crash stack traces READABLE (real file/line,
    // not minified gibberish). Runs ONLY in a production build that has a SENTRY_AUTH_TOKEN — a GitHub
    // Actions SECRET set in both repos; local builds (no token) skip it cleanly. It uploads the source
    // maps to Sentry (matched to events by injected debug IDs, so the lazy SDK chunk resolves too),
    // then DELETES them from dist so they're never publicly served. Must be last (processes the final
    // output). org/project slugs are public, not secret. telemetry off.
    ...(command === 'build' && process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: 'ts-6a',
            project: 'javascript-react',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  // Generate hidden source maps ONLY when we're uploading them to Sentry (CI deploys with the auth
  // token). 'hidden' emits the .map files but omits the //# sourceMappingURL comment from the shipped
  // JS, so browsers never fetch them and they aren't referenced; the Sentry plugin above uploads then
  // deletes them. Local builds (no token) generate none — no clutter, no cost — and .map files never
  // count toward the JS size budget anyway (the size script globs *.js only).
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
  },
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
