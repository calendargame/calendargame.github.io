// bootFlow — the pure phase math for the Updating screen's trace loop (its one consumer is
// BootOverlay, which lives in src/components/BootOverlay.tsx, not main.tsx).
//
// WHY THIS EXISTS (iOS render fix, 2026-07-13): the trace was originally a CSS keyframes
// animation driving stroke-dashoffset 0 → −174 → −348 over a SINGLE-value stroke-dasharray:174.
// Shipping iOS Safari mis-paints NEGATIVE dashoffsets when the dasharray has an ODD number of
// values (WebKit bug 249307 — fixed in WebKit main 2026-05, not yet in any shipping iOS): on
// device, both halves rendered as fills with two hard full→blank jumps per cycle instead of the
// approved erase-from-2 / redraw-from-2 sweep. Chromium (every dev preview) renders the original
// correctly, which is why this was only caught on the owner's phone.
//
// The fix: BootOverlay drives the mask path per-frame via rAF using this module — the SAME visual
// (erase ease-out, redraw ease-in, 2.6s loop, soft blurred trail untouched) — but the emitted
// offset is always NON-NEGATIVE and the dasharray is written as TWO values ("L L"), the
// combination every engine (including buggy iOS) paints identically. A second latent flaw is
// fixed en route: the CSS assumed the path length is 174, but the true Bézier length is ~170.9
// (the driver measures the live path via getTotalLength), which removes ~0.35s of dead/blank
// time per cycle that existed on every engine.
//
// NOTE: this is purely a make-it-render-right mechanism change. The approved animation DESIGN
// (and the owner's separately-parked aesthetic wishlist, on the backlog) is unchanged.

export const BOOT_FLOW_CYCLE_MS = 2600
// True arc length of "M310,256 C313,226 313,206 310,196 C300,184 240,184 202,196" (numerically
// integrated; segments 60.2641 + 110.6484). Used only when getTotalLength is unavailable (jsdom).
export const BOOT_FLOW_FALLBACK_LEN = 170.9125

// Generic CSS cubic-bezier(x1,y1,x2,y2) timing function: solve x(t)=u (Newton, then bisection
// fallback for flat spots), return y(t). Matches the browser's timing-function semantics so the
// driver reproduces the original keyframes' easing exactly.
const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t
  const dxAt = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t
  return (u: number): number => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    let t = u
    for (let i = 0; i < 8; i++) {
      const err = xAt(t) - u
      if (Math.abs(err) < 1e-6) return yAt(t)
      const d = dxAt(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = u
    for (let i = 0; i < 32; i++) {
      const x = xAt(t)
      if (Math.abs(x - u) < 1e-6) break
      if (x < u) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return yAt(t)
  }
}

// The exact timing functions the original keyframes used (CSS `ease-out` / `ease-in`).
export const cssEaseOut = cubicBezier(0, 0, 0.58, 1)
export const cssEaseIn = cubicBezier(0.42, 0, 1, 1)

// bootFlowOffset — the dashoffset for a given elapsed time, reproducing the original keyframes
// (0% → offset 0 [fully drawn, ease-out] → 50% → −L [fully erased, ease-in] → 100% → −2L) but
// returned as the NON-NEGATIVE equivalent mod 2L: with dasharray [L, L] the rendered dash phase
// is identical, and iOS paints it correctly (see the header). The value rises 0 → L over the
// erase half (visible arc [L·e … L]: the line erodes from position 2 toward the answer) and
// falls L → 0 over the redraw half (visible arc [0 … L·i]: it regrows from position 2), wrapping
// seamlessly at the cycle boundary.
export const bootFlowOffset = (elapsedMs: number, L: number): number => {
  const cycle = BOOT_FLOW_CYCLE_MS
  const u = (((elapsedMs % cycle) + cycle) % cycle) / cycle
  const raw = u < 0.5 ? -L * cssEaseOut(u / 0.5) : -L - L * cssEaseIn((u - 0.5) / 0.5)
  const wrap = 2 * L
  return ((raw % wrap) + wrap) % wrap
}
