// ─────────────────────────────────────────────────────────────────────────
// engine/stats.ts — pure time-stat helpers (average / median / last).
//
// One copy, shared by the mode screens' stat strips (modes/modeHooks for Classic / Flash /
// Deduction, and Blitz / MoX directly), engine/aoxBest (a run's Best Mean / Best Median) and
// engine/runBreakdown (the breakdown's summary, which must print the strip's own numbers).
// Pure — no app state, no React. `times` is an array of seconds; all three
// return null on an empty array (rendered as "—" by the formatters).
// ─────────────────────────────────────────────────────────────────────────
export const calcAvg = (t: number[]): number | null =>
  t.length ? t.reduce((a, b) => a + b, 0) / t.length : null
// "Last" — the newest solve's time. That is the pool's final entry only because the engine keeps the
// pool in PLAY ORDER through every toggle (gameReducer's poolSlot; engine/invariants holds it there).
export const calcLast = (t: number[]): number | null => (t.length ? t[t.length - 1] : null)
export const calcMed = (t: number[]): number | null => {
  if (!t.length) return null
  const s = [...t].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
