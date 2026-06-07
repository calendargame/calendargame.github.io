// ─────────────────────────────────────────────────────────────────────────
// engine/invariants.ts — runtime "tripwires": the engine's impossible states.
//
// Pure checks that return a list of violated invariants for a game state (empty =
// healthy). Every check is a TRUE impossibility — a CORRECT engine can never violate
// one — so it is safe to treat a violation as a bug, not a normal edge case.
//
// Used in TWO places, which is the whole point:
//   • PRODUCTION TRIPWIRE — useGameEngine runs checkGameInvariants after every dispatch
//     and reports any violation to Sentry (deduped, prod-only). These bugs DON'T crash —
//     they silently produce a wrong number (an impossible score, a desynced history) —
//     so without this we'd never hear about them on the untestable devices the book
//     brings. Complements the crash reporting: crashes throw, these don't.
//   • FUZZ SURVEY (tests/engine/fuzz) — drives millions of random action sequences and
//     asserts these stay empty, which both hunts for bugs AND proves the tripwires never
//     false-fire (if a check fired during correct play, the fuzz would catch it first).
//
// Why these specific invariants:
//   • Score integrity (the C3 work): `good` can never exceed `played`; a run of credits
//     (`streak`, `best`) can never exceed the total credits (`good`); counts are
//     non-negative integers; `times` are finite, non-negative, and never outnumber the
//     credits that produced them.
//   • History structure: BACK pushes one forward entry + bumps backDepth, FORWARD undoes
//     exactly that, advance() clears both — so backDepth and forwardStack.length move in
//     lockstep. A mismatch means the Back/Forward bookkeeping desynced.
//   • Date/calendar sanity: month 1-12, day 1-31, integer year; a weekday question resolves
//     to an index in 0-6, and a Deduction puzzle's correct answer is actually among its
//     options (correctIndexOf returns -1 if a generator ever produced a puzzle whose answer
//     isn't selectable).
// ─────────────────────────────────────────────────────────────────────────
import { correctIndexOf } from './gameReducer.js'
import type { GameState, Question, Stats } from './gameReducer.js'

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

// Score/stats integrity. `where` labels the source (e.g. 'stats', or a saved silo name) so a
// report says exactly which counter broke. Exported so the persistence tripwire can reuse it on
// rehydrated saved progress.
export function checkStatsInvariants(s: Stats, where: string): string[] {
  const v: string[] = []
  if (!s || typeof s !== 'object') return [`${where}: stats is not an object`]
  for (const k of ['played', 'good', 'streak', 'best'] as const) {
    if (!isCount(s[k])) v.push(`${where}.${k} is not a non-negative integer (${String(s[k])})`)
  }
  if (isCount(s.good) && isCount(s.played) && s.good > s.played)
    v.push(`${where}: good(${s.good}) > played(${s.played})`)
  if (isCount(s.streak) && isCount(s.good) && s.streak > s.good)
    v.push(`${where}: streak(${s.streak}) > good(${s.good})`)
  if (isCount(s.best) && isCount(s.good) && s.best > s.good)
    v.push(`${where}: best(${s.best}) > good(${s.good})`)
  if (!Array.isArray(s.times)) {
    v.push(`${where}: times is not an array`)
  } else {
    if (s.times.some((t) => typeof t !== 'number' || !Number.isFinite(t) || t < 0))
      v.push(`${where}: times has a non-finite/negative value`)
    if (isCount(s.good) && s.times.length > s.good)
      v.push(`${where}: times.length(${s.times.length}) > good(${s.good})`)
  }
  return v
}

// Date/calendar sanity for the current question.
function checkQuestionInvariants(q: Question, useJulian: boolean, where: string): string[] {
  const v: string[] = []
  if (!q || typeof q !== 'object') return [`${where}: question is missing`]
  if (!Number.isInteger(q.y)) v.push(`${where}: year is not an integer (${String(q.y)})`)
  if (!(Number.isInteger(q.m) && q.m >= 1 && q.m <= 12))
    v.push(`${where}: month out of 1-12 (${String(q.m)})`)
  if (!(Number.isInteger(q.d) && q.d >= 1 && q.d <= 31))
    v.push(`${where}: day out of 1-31 (${String(q.d)})`)
  const idx = correctIndexOf(q, useJulian)
  if (q.type === undefined) {
    if (!(Number.isInteger(idx) && idx >= 0 && idx <= 6))
      v.push(`${where}: weekday index out of 0-6 (${String(idx)})`)
  } else if (idx < 0) {
    v.push(`${where}: puzzle (type ${q.type}) correct answer is not among its options`)
  }
  return v
}

// The full engine-state check. `useJulian` honors the active calendar in the date checks (matching
// what the reducer used to compute this state).
export function checkGameInvariants(state: GameState, useJulian: boolean): string[] {
  const v: string[] = []
  v.push(...checkStatsInvariants(state.stats, 'stats'))
  v.push(...checkQuestionInvariants(state.date, useJulian, 'date'))
  if (!isCount(state.backDepth)) v.push(`backDepth is not a non-negative integer (${state.backDepth})`)
  if (state.backDepth !== state.forwardStack.length)
    v.push(`backDepth(${state.backDepth}) != forwardStack.length(${state.forwardStack.length})`)
  if (!isCount(state.questionId))
    v.push(`questionId is not a non-negative integer (${state.questionId})`)
  return v
}
