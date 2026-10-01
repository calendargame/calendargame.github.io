// ─────────────────────────────────────────────────────────────────────────
// engine/stats.ts — pure time-stat helpers (average / median / last).
//
// One copy, shared by the mode screens' stat strips (modes/modeHooks for Classic / Flash /
// Deduction, and Blitz / MoX directly), engine/aoxBest (a run's Best Mean / Best Median) and
// engine/runBreakdown (the breakdown's summary, which must print the strip's own numbers).
// Pure — no app state, no React. `times` is an array of seconds; all three
// return null on an empty array (rendered as "—" by the formatters).
// ─────────────────────────────────────────────────────────────────────────

// ★ THE SOLVE-TIME GRID: every recorded time is a whole number of 0.1 ms (1/10000 s). Round 23
// made the saved times unbounded (every solve is kept), which made their SIZE matter, and a raw time
// was ~17 characters of floating-point noise: performance.now() is clamped to 0.1 ms in Chrome (1 ms
// in Safari and Firefox), but the SUBTRACTION of two clamped readings is not — 126913.4 − 123456.7
// is 3456.699999999997, saved as 3.456699999999997. Snapping the difference back onto the grid the
// browser measured on keeps every digit it actually measured (so nothing a player could see moves)
// and saves "3.4567" — about 7 bytes a time instead of 17.
// ⚠ 0.1 ms, NOT 1 ms, deliberately. The display shows hundredths, so 1 ms would look like plenty —
// but it would throw away real Chrome precision, and a Last (truncated) or Median (rounded) that sits
// within a millisecond of a hundredth boundary would then print a different hundredth than the
// unrounded time does (measured: ~5% of Lasts, ~3.5% of Medians). On 0.1 ms the only thing removed is
// the subtraction noise.
// ⚠ THE UNIT STAYS SECONDS everywhere, including the save. An integer count of 0.1 ms would save one
// byte a time more, and it is not worth it: live and staging share ONE browser origin — one copy of
// the saved data — and a build from before this change would read an integer 34567 as 34,567
// SECONDS and write it back that way. Seconds on the grid read correctly in every build ever shipped.
export const SOLVE_TIME_UNITS_PER_SECOND = 10000
/** A solve time in seconds, on the 0.1 ms grid, from a performance.now() difference in ms. */
export const solveTimeFromMs = (ms: number): number =>
  Math.round(ms * (SOLVE_TIME_UNITS_PER_SECOND / 1000)) / SOLVE_TIME_UNITS_PER_SECOND

export const calcAvg = (t: number[]): number | null =>
  t.length ? t.reduce((a, b) => a + b, 0) / t.length : null
// "Last" — the newest solve's time. That is the pool's final entry only because the engine keeps the
// pool in PLAY ORDER through every toggle (gameReducer's poolSlot; engine/invariants holds it there).
export const calcLast = (t: number[]): number | null => (t.length ? t[t.length - 1] : null)
// Median — SELECTED, not sorted. Every solve time is kept now, so a casual mode's pool
// grows without bound, and the casual stat strip computes this on EVERY render, not only when a time
// is added: sorting a copy of a 100,000-time pool cost ~50-60 ms a render in Chromium. Selecting the
// middle element is linear (~1-2 ms there) and returns the very same doubles the sort did, so the
// result is bit-identical — tests/engine/stats holds it to the sort on hundreds of random pools.
// It works on a Float64Array COPY: the pool itself is in play order and "Last" reads its end.
export const calcMed = (t: number[]): number | null => {
  if (!t.length) return null
  const a = Float64Array.from(t)
  const k = a.length >> 1
  const upper = selectInPlace(a, k)
  if (a.length % 2) return upper
  // selectInPlace leaves everything below index k at or under a[k], so the lower middle is their max.
  let lower = a[0]
  for (let i = 1; i < k; i++) if (a[i] > lower) lower = a[i]
  return (lower + upper) / 2
}

// Hoare selection: rearranges `a` so that a[k] is the value a full ascending sort would put there,
// with every a[i<k] <= a[k] <= every a[i>k], and returns it. Median-of-three pivot, so sorted,
// reversed and duplicate-heavy pools (all ordinary for solve times) stay linear.
function selectInPlace(a: Float64Array, k: number): number {
  let lo = 0
  let hi = a.length - 1
  while (lo < hi) {
    const x = a[lo]
    const y = a[(lo + hi) >> 1]
    const z = a[hi]
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        const tmp = a[i]
        a[i] = a[j]
        a[j] = tmp
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}
