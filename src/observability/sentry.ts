// Real-user error reporting — Sentry, FROM THE TWO SITES ONLY (live and test, src/sites.ts).
//
// Why this shape:
//  • ErrorBoundary (whole-app) + ModeErrorBoundary (per-mode) already CATCH crashes and show a
//    graceful recover card. This adds the missing half — telling us a crash happened on devices we
//    can't test (the book will send readers on a huge range of old/weak phones). The boundaries call
//    captureError() from componentDidCatch.
//  • LAZY-LOADED: the heavy SDK lives in ./sentryClient, pulled in via a dynamic import() as its OWN
//    chunk, so it never blocks first paint (most important on the weak devices we want to support). A
//    tiny eager pair of window handlers + a bounded queue buffer any errors that fire BEFORE the SDK
//    finishes loading (e.g. an early incompatibility crash on a slow device — exactly what we most
//    want to hear about), then flush once it is ready. The SDK installs its own global handlers, so
//    ours are removed on load to avoid double-reporting.
//  • PRIVACY-FIRST + LEAN: errors only — see ./sentryClient (no Session Replay, no Tracing,
//    sendDefaultPii:false) and the __SENTRY_* tree-shake flags in vite.config.js.
//  • DEPLOYED BUILDS ONLY, and that takes TWO gates because no single flag distinguishes them:
//    main.tsx calls initObservability() behind import.meta.env.PROD (so `vite dev` never reports),
//    and initObservability() itself starts only on the two sites' own hostnames (see the ★ note
//    below — a build served anywhere else is import.meta.env.PROD too, so the build-time flag alone
//    was not enough). The test site (test.calendargame.app) reports too, tagged environment:'staging',
//    so we can verify it + catch bugs before they reach the live site's 'production'.
import { siteAtHostname } from '../sites'

type Reporter = (error: unknown, context?: Record<string, unknown>) => void

// Bound the pre-load buffer so a crash loop before the SDK arrives can't grow memory without limit.
const MAX_BUFFERED = 20

// ★ WHERE A REPORT MAY COME FROM: THE TWO SITES' OWN HOSTNAMES, AND NOWHERE ELSE (Round 27, Q2). A
// built copy of the app is import.meta.env.PROD wherever it is served — `vite preview`, the browser
// lane, a phone on the laptop's LAN address (192.168.x.x), a tunnel to a laptop, a copy someone else
// hosts — and from any of those it would report into the REAL project as if it were a visitor,
// polluting the very data read to check a deploy. Until Round 27 this was a list of the places NOT
// to report from (the three loopback names), which cannot be complete: every LAN address and every
// tunnel host is another entry it lacked. The two places a real visitor can be ARE a complete list,
// it already exists (src/sites.ts), and the same row says which environment the report belongs to —
// so the question "may this report?" and "as what?" have one answer and cannot disagree.

let report: Reporter | null = null
let started = false
const buffer: Array<{ error: unknown; context?: Record<string, unknown> }> = []

// Temporary, ultra-light handlers that buffer uncaught errors/rejections fired before the SDK loads;
// removed once the real SDK (with its own handlers) is ready.
function bufferUncaughtError(e: ErrorEvent) {
  captureError(e.error ?? e.message)
}
function bufferUnhandledRejection(e: PromiseRejectionEvent) {
  captureError(e.reason)
}

// Report a caught error. Safe to call anywhere (incl. dev + tests): before the SDK loads it buffers
// (bounded); if the SDK never loads (dev/tests/offline) it is a harmless no-op beyond that small
// buffer. The error boundaries call this from componentDidCatch.
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (report) report(error, context)
  else if (buffer.length < MAX_BUFFERED) buffer.push({ error, context })
}

// Start error reporting: install the temporary buffering handlers, then lazy-load + init the SDK.
// Idempotent, and a no-op anywhere but the two sites. Call behind import.meta.env.PROD (main.tsx).
export function initObservability() {
  if (started) return
  // Not one of the two sites — not a visitor: nothing installed, SDK chunk never fetched.
  const site = siteAtHostname(window.location.hostname)
  if (!site) return
  started = true

  window.addEventListener('error', bufferUncaughtError)
  window.addEventListener('unhandledrejection', bufferUnhandledRejection)

  const stopBuffering = () => {
    window.removeEventListener('error', bufferUncaughtError)
    window.removeEventListener('unhandledrejection', bufferUnhandledRejection)
  }

  import('./sentryClient')
    .then((sentry) => {
      sentry.startSentry(site.environment)
      report = sentry.report
      // The SDK now owns the global error/rejection handlers → drop ours so nothing double-reports.
      stopBuffering()
      for (const item of buffer) sentry.report(item.error, item.context)
      buffer.length = 0
    })
    .catch(() => {
      // SDK blocked or offline — keep the app fully working; just stop buffering forever.
      stopBuffering()
      buffer.length = 0
    })
}
