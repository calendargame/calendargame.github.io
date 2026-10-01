// Real-user error reporting — Sentry, PRODUCTION + STAGING ONLY.
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
//    and initObservability() itself refuses on a loopback host (see LOOPBACK_HOSTS — a locally
//    SERVED build is import.meta.env.PROD too, so the build-time flag alone was not enough).
//    Deployed staging (calendargame.app/test_version/) still reports, tagged environment:'staging'
//    (set in ./sentryClient), so we can verify it + catch bugs before prod.
type Reporter = (error: unknown, context?: Record<string, unknown>) => void

// Bound the pre-load buffer so a crash loop before the SDK arrives can't grow memory without limit.
const MAX_BUFFERED = 20

// Hosts that mean "this build is being SERVED locally", never a deployment. `vite preview` (and any
// headless run against it) serves a real production build, so import.meta.env.PROD is true there and
// main.tsx's build-time gate lets it through. It then reports into the REAL project — and because the
// environment tag is derived from the URL PATH (staging is the /test_version/ subpath of the same
// host), a loopback URL matches neither the live root nor staging and files as 'staging', polluting
// the exact data we read to check a deploy. So a local preview must not start reporting at all.
// LOOPBACK ONLY, deliberately: a deployed build is only ever served from calendargame.app, so this
// list can never silence a real one. ('[::1]' is what URL parsing yields for IPv6 loopback, brackets
// included; a bare LAN IP is out of scope — nothing serves this app that way.)
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

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
// Idempotent, and a no-op on a locally-served build. Call behind import.meta.env.PROD (main.tsx).
export function initObservability() {
  if (started) return
  // A local preview is not a deployment — nothing installed, SDK chunk never fetched.
  if (LOOPBACK_HOSTS.includes(window.location.hostname)) return
  started = true

  window.addEventListener('error', bufferUncaughtError)
  window.addEventListener('unhandledrejection', bufferUnhandledRejection)

  const stopBuffering = () => {
    window.removeEventListener('error', bufferUncaughtError)
    window.removeEventListener('unhandledrejection', bufferUnhandledRejection)
  }

  import('./sentryClient')
    .then((sentry) => {
      sentry.startSentry()
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
