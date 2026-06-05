import type { Metric } from 'web-vitals'

// Dev-only Core Web Vitals reporter (Stage E0 — performance measurement setup).
// Logs LCP / INP / CLS / FCP / TTFB to the console as the browser measures them, so
// load + interaction performance is visible live while tuning (Stage E3) and any
// regression is immediately obvious in the dev console.
//
// Gated on `import.meta.env.DEV`: in a production build Vite replaces that flag with the
// literal `false`, so the call site (`if (import.meta.env.DEV) reportWebVitals()` in
// main.tsx) becomes dead code, this function is tree-shaken out, and the dynamic
// `web-vitals` import it contains is eliminated — `web-vitals` never reaches the shipped
// bundle (zero production cost; verified against the build output). The production
// *baseline* numbers come from Lighthouse (lab) + the browser's Event Timing API (real
// INP); this reporter is the live instrument for measuring as we tune.
export function reportWebVitals(): void {
  if (!import.meta.env.DEV) return
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const log = (metric: Metric) => {
      // CLS is a unitless layout-shift score; the other four are millisecond timings.
      const value =
        metric.name === 'CLS' ? metric.value.toFixed(3) : `${Math.round(metric.value)}ms`
      console.log(`[web-vitals] ${metric.name} = ${value} (${metric.rating})`)
    }
    onCLS(log)
    onFCP(log)
    onINP(log)
    onLCP(log)
    onTTFB(log)
  })
}
