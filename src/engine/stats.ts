// ─────────────────────────────────────────────────────────────────────────
// engine/stats.ts — pure time-stat helpers (average / median / last).
//
// One copy, shared by the mode screens' stat strips (modes/modeHooks for Classic / Flash /
// Deduction, and MoX / Blitz directly), engine/aoxBest (a run's Best Mean / Best Median) and
// engine/runBreakdown (the breakdown's summary, which must print the strip's own numbers).
// Pure — no app state, no React (the summaries engine/timesPool keeps beside each pool are a cache,
// never a different answer). `times` is an array of seconds; all three return null on an empty array
// (rendered as "—" by the formatters).
// ─────────────────────────────────────────────────────────────────────────
import { summaryOf } from './timesPool.js'

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
// byte a time more, and it is not worth it: every build reads the ONE copy of the saved data on its
// origin — a tab or the installed app left open across an update is a build from before it — and a
// build from before this change would read an integer 34567 as 34,567 SECONDS and write it back that
// way. Seconds on the grid read correctly in every build ever shipped.
export const SOLVE_TIME_UNITS_PER_SECOND = 10000
/** A solve time in seconds, on the 0.1 ms grid, from a performance.now() difference in ms. */
// (`+ 0` turns the −0 a rounding of a tiny negative difference would give into 0: engine/timesPool's
// sorted buffer orders −0 apart from 0, which a selection does not, so a −0 is kept out at the source.)
export const solveTimeFromMs = (ms: number): number =>
  Math.round(ms * (SOLVE_TIME_UNITS_PER_SECOND / 1000)) / SOLVE_TIME_UNITS_PER_SECOND + 0

// ★ MEAN AND MEDIAN ARE READ FROM THE POOL'S SUMMARY (engine/timesPool), not worked out on every
// call. Every solve time is kept, so a casual mode's pool grows without bound, and the stat strip
// asks for both on every render: walking a 100,000-time pool cost milliseconds each time. The
// summary is kept beside the array and carried forward by the engine's own changes, and its answers
// are BIT-IDENTICAL to working them out from scratch — the Mean is the same left-to-right sum from 0
// divided by the count; the Median is the value a full ascending sort puts in the middle (the two
// middles added lower first, then halved) — tests/engine/timesPool holds both to the from-scratch
// expressions on thousands of pools. A pool with no summary yet (one just loaded, restored, or built
// here and there for a breakdown) is summed and SELECTED once, linearly, and then answers at once.
// ⚠ So an array handed to these must not be changed in place afterwards — engine/timesPool says why
// nothing in the app does.
export const calcAvg = (t: readonly number[]): number | null =>
  t.length ? summaryOf(t).sum / t.length : null
// "Last" — the newest solve's time. That is the pool's final entry only because the engine keeps the
// pool in PLAY ORDER through every toggle (gameReducer's poolSlot; engine/invariants holds it there).
export const calcLast = (t: readonly number[]): number | null => (t.length ? t[t.length - 1] : null)
// Median — from the pool's summary (above), never by sorting the pool on a render: a sort of a
// 100,000-time pool cost ~50-60 ms in Chromium. It never reorders the pool (in play order; "Last"
// reads its end).
export const calcMed = (t: readonly number[]): number | null => summaryOf(t).median
