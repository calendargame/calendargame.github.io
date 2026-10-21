// The actual Sentry SDK setup — lazily loaded by ./sentry (initObservability) as its own chunk.
//
// Isolated in its own module with STATIC NAMED imports (init, captureException) on purpose: that
// lets the bundler tree-shake everything we don't use — Session Replay (rrweb), Tracing, Profiling,
// the Feedback widget — OUT of this lazy chunk, leaving only the error-reporting core. (A namespace
// `import * as Sentry` would retain the whole package: ~150 KB gzip vs the lean core.) The
// __SENTRY_DEBUG__/__SENTRY_TRACING__ flags in vite.config.js strip the remaining debug/tracing
// code paths. See ./sentry for the buffering + lazy-load wrapper.
//
// The DSN is PUBLIC and safe to ship (it only lets the app SEND events, never read them) — same as
// the Cloudflare analytics token. Optional later hardening: set the project's "Allowed Domains"
// inbound filter in Sentry so only our own domains can post events.
import { init, captureException } from '@sentry/react'
import type { Site } from '../sites'

const DSN =
  'https://b86e091f9d51aefed301827b113a07ab@o4511521335148544.ingest.us.sentry.io/4511521342160896'

// `environment` is the site's own (src/sites.ts: 'production' on the live site, 'staging' on the test
// site), handed in by ./sentry, which starts the SDK only on one of those two hostnames — so a report
// is always filed under the site it came from, and the dashboard separates real visitors' crashes
// from our own testing.
export function startSentry(environment: Site['environment']) {
  init({
    dsn: DSN,
    environment,
    // Privacy-first (matches the cookieless analytics choice): never attach IP, cookies, or user
    // identifiers. The app collects no personal data, so reports carry only technical context.
    sendDefaultPii: false,
    // Errors only — no browserTracingIntegration() / replayIntegration() are added, so the SDK stays
    // lean and we never record users' screens or sessions. (Explicit 0 = no performance tracing.)
    tracesSampleRate: 0,
  })
}

// Send a caught error with optional technical context (which boundary, which mode, the React
// component stack). Privacy note: `extra` carries only what the caller passes — no PII.
export function report(error: unknown, context?: Record<string, unknown>) {
  captureException(error, context ? { extra: context } : undefined)
}
