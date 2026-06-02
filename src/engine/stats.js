// ─────────────────────────────────────────────────────────────────────────
// engine/stats.js — pure time-stat helpers (average / median / last).
//
// One copy, shared by main.jsx (the mode components' stat strips) and the AoX
// reducer (which computes a run's Best Average / Best Median from its times).
// Pure — no app state, no React. `times` is an array of seconds; all three
// return null on an empty array (rendered as "—" by the formatters).
// ─────────────────────────────────────────────────────────────────────────
export const calcAvg = (t) => (t.length ? t.reduce((a, b) => a + b, 0) / t.length : null)
export const calcLast = (t) => (t.length ? t[t.length - 1] : null)
export const calcMed = (t) => {
  if (!t.length) return null
  const s = [...t].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
