import { useEffect, useRef } from 'react'
import { bootFlowOffset, BOOT_FLOW_FALLBACK_LEN } from '../lib/bootFlow.js'

// BootOverlay — the full-screen UPDATING screen: the fully-drawn W5 trace (STATIC for now —
// the erase-from-2 / redraw-from-2 flow sweep is parked behind BOOT_TRACE_ANIMATED below; see
// lib/bootFlow for the retained driver math + the iOS render fix) + "Updating" with a
// sequential three-dot pulse. Shown by the Settings "Check for updates" button, by the
// auto-update-on-open SW effect in App (when a freshly-deployed version is waiting at launch),
// and by the build-change flash effect (a cold open that detects an update already landed
// silently between sessions — same screen, no reload).
// The LOADING splash is no longer rendered here — it's index.html's body-level #boot, which App
// removes via dismissBootSplash; only the `updating` variant is ever mounted (the prop's loading
// form is kept so the component matches the approved mockup pair, pending the deferred animation
// pass). Theme-aware (bg = --bg1; logo lavender on dark, brand-purple on light). The glyph is the
// W5 logo, kept in sync with index.html's pre-React boot splash + src/components/W5Logo.tsx. Logo
// scaled up (174×188) for both screens (owner 2026-06-28).
// Static trace for now (the animated sweep is parked on the backlog); flip to true to restore the rAF driver +
// blurred mask below (plus lib/bootFlow + .boot-flow in index.css — all kept intact for that).
const BOOT_TRACE_ANIMATED = false
function BootOverlay({ updating = false }: { updating?: boolean }) {
  // iOS trace driver (2026-07-13; currently DISABLED via BOOT_TRACE_ANIMATED — the trace renders
  // static): the erase/redraw sweep is driven per-frame from JS instead of CSS keyframes —
  // shipping iOS mis-paints NEGATIVE dashoffsets over an odd-count dasharray
  // (WebKit bug 249307), which turned the loop into fill→instant-vanish jumps on-device while
  // every Chromium preview looked perfect. Same approved visual + 2.6s eased phases (the math
  // lives in lib/bootFlow); the driver measures the TRUE path length (the CSS assumed 174,
  // really ~170.9 — that mismatch alone cost ~0.35s of blank per cycle on every engine) and
  // emits only non-negative offsets over a two-value dasharray, which iOS paints correctly.
  // Deliberately ignores Reduce Motion: the trace is the sole FUNCTIONAL progress indicator
  // during a blocking update (the app scales only decorative motion via --motion-scale).
  // ⚠ AND SINCE ROUND 16 IT IS THE *ONLY* THING ON THIS SCREEN THAT IGNORES THE SETTING — the
  // "Updating" caption's three-dot pulse (.boot-d, index.css) now multiplies its duration and both
  // stagger delays by --motion-scale, because an animated ellipsis after a word that already says
  // "Updating" is decoration. With the trace parked static behind BOOT_TRACE_ANIMATED, that leaves
  // the Reduce-Motion updating screen completely still; re-enabling the trace is what gives
  // the setting's users their progress motion back, and this comment is why that matters.
  const flowRef = useRef<SVGPathElement | null>(null)
  useEffect(() => {
    if (!updating || !BOOT_TRACE_ANIMATED) return
    const p = flowRef.current
    if (!p) return
    let L = BOOT_FLOW_FALLBACK_LEN
    try {
      const m = p.getTotalLength()
      if (m > 0) L = m
    } catch {
      /* jsdom has no getTotalLength — fall back */
    }
    p.style.strokeDasharray = `${L} ${L}`
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      p.style.strokeDashoffset = `${bootFlowOffset(now - start, L)}px`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [updating])
  return (
    <div className="boot-overlay">
      <div className="boot-mark">
        <div className="boot-glow" />
        <svg
          width="174"
          height="188"
          viewBox="178 173 146 158"
          fill="none"
          aria-hidden="true"
          style={{ position: 'relative' }}
        >
          {updating && BOOT_TRACE_ANIMATED && (
            <defs>
              <filter id="bootSoft" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
              <mask id="bootMask">
                <path
                  ref={flowRef}
                  className="boot-flow"
                  d="M310,256 C313,226 313,206 310,196 C300,184 240,184 202,196"
                  stroke="#fff"
                  strokeWidth="26"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  strokeDasharray="174 174"
                  filter="url(#bootSoft)"
                />
              </mask>
            </defs>
          )}
          <g fill="currentColor" opacity="0.3">
            <circle cx="256" cy="256" r="10" />
            <circle cx="310" cy="316" r="10" />
            <circle cx="202" cy="316" r="10" />
            <circle cx="202" cy="256" r="10" />
          </g>
          {/* trace dimmed 0.7 — matches the icon master (line dimmer than dots); keep #boot / W5Logo / BootOverlay identical */}
          <path
            d="M310,256 C313,226 313,206 310,196 C300,184 240,184 202,196"
            stroke="currentColor"
            strokeOpacity={0.7}
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
            mask={updating && BOOT_TRACE_ANIMATED ? 'url(#bootMask)' : undefined}
          />
          <g fill="currentColor">
            <circle cx="310" cy="256" r="10" />
            <circle cx="310" cy="196" r="10" />
          </g>
          <circle cx="202" cy="196" r="9" fill="currentColor" />
          <circle cx="202" cy="196" r="19" fill="none" stroke="currentColor" strokeWidth="5" />
        </svg>
      </div>
      {updating && (
        <div className="boot-updating">
          Updating<span className="boot-d boot-d1">.</span>
          <span className="boot-d boot-d2">.</span>
          <span className="boot-d boot-d3">.</span>
        </div>
      )}
    </div>
  )
}

export default BootOverlay
