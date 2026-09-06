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
//   • The CARD LEDGER: every browsable history entry is exactly one increment of `played`. That
//     correspondence is what makes the Q# badge (historyBase + stack.length + 1, see cardNumber) a
//     LIFETIME number rather than a session one, and it is the kind of claim that is easy to argue
//     and easy to break later — so it is asserted here and the fuzz proves it, instead of a comment
//     asserting it. A break means the badge silently disagrees with the Score box beside it.
//   • The TIMES LEDGER: every second in `stats.times` is either carried in (`timesBase` — hydrated
//     from saved progress, or kept across a RESET_ROUND that wiped the history) or is named by
//     exactly one card. That is what lets the run breakdown list the solves one per row and have
//     the rows RECONCILE with the mean printed above them, instead of being a second, independently
//     computed opinion that could quietly drift. Two checks, and they are strongest together: the
//     ledger's times are a sub-multiset of the pool (no card names a second the mean does not
//     contain), and the counts add up (no second in the mean goes unnamed). In a run mode, where
//     timesBase is 0 by construction, the pair forces exact equality.
//   • Date/calendar sanity: month 1-12, day 1-31, integer year; a weekday question resolves
//     to an index in 0-6, and a Deduction puzzle's correct answer is actually among its
//     options (correctIndexOf returns -1 if a generator ever produced a puzzle whose answer
//     isn't selectable).
// ─────────────────────────────────────────────────────────────────────────
import { correctIndexOf } from './gameReducer.js'
import type { GameState, Question, Stats } from './gameReducer.js'

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

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

// Has the LIVE question already taken its `played` increment? Every stat-affecting action FREEZES
// saveStatsThisQ, and every one that freezes it to `true` increments `played` exactly once for that
// question (a later action on the same question is gated by countedWrong, so it never double-counts)
// — so `saveStatsThisQ === true` IS "this question is counted". The other two values are both
// "not counted": `false` = it was played with Save Stats off, `null` = no stat action ran on it at
// all (a fresh card, or a Blitz per-round LOCK_REVEAL, which shows the answer without scoring it).
// While browsing back, the live question is parked in forwardStack as the isLive entry, which
// carries that same frozen flag as `saveStatsFrozen` — read it there instead.
function liveCounted(state: GameState): number {
  const frozen =
    state.backDepth === 0
      ? state.saveStatsThisQ
      : (state.forwardStack.find((e) => e.isLive)?.liveState?.saveStatsFrozen ?? null)
  return frozen === true ? 1 : 0
}

// Every second the ledger currently names: one per history entry that holds a time, plus the card
// on screen. `forwardStack` is included because browsing back PARKS cards there — including the
// live one — and a parked card is still contributing to the pool it left behind.
function ledgerTimes(state: GameState): number[] {
  const out: number[] = []
  for (const e of state.stack) if (e.solveTime != null) out.push(e.solveTime)
  for (const e of state.forwardStack) if (e.solveTime != null) out.push(e.solveTime)
  if (state.liveSolveTime != null) out.push(state.liveSolveTime)
  return out
}

// Is every value in `sub` present in `sup`, counting duplicates? Both are sorted copies walked once
// — the same two solve times really can occur twice, so a Set would silently accept a ledger naming
// one second twice when the pool holds it once.
function isSubMultiset(sub: number[], sup: number[]): boolean {
  const a = [...sub].sort((x, y) => x - y)
  const b = [...sup].sort((x, y) => x - y)
  let i = 0
  for (const v of b) {
    if (i < a.length && a[i] === v) i++
  }
  return i === a.length
}

// The full engine-state check. `useJulian` honors the active calendar in the date checks (matching
// what the reducer used to compute this state).
export function checkGameInvariants(state: GameState, useJulian: boolean): string[] {
  const v: string[] = []
  v.push(...checkStatsInvariants(state.stats, 'stats'))
  v.push(...checkQuestionInvariants(state.date, useJulian, 'date'))
  if (!isCount(state.backDepth))
    v.push(`backDepth is not a non-negative integer (${state.backDepth})`)
  if (state.backDepth !== state.forwardStack.length)
    v.push(`backDepth(${state.backDepth}) != forwardStack.length(${state.forwardStack.length})`)
  if (!isCount(state.questionId))
    v.push(`questionId is not a non-negative integer (${state.questionId})`)
  if (!isCount(state.gridEpoch))
    v.push(`gridEpoch is not a non-negative integer (${state.gridEpoch})`)
  // ── The card ledger ──
  // played == historyBase + (cards behind the viewed one) + (the live card, if it was counted).
  // The middle term is `stack.length + backDepth`, not just the stack: browsing back POPS entries
  // off `stack` and parks them in forwardStack, and backDepth counts exactly those (the currently-
  // viewed entry plus the non-live forward ones — the isLive entry is the live card, counted by the
  // last term). Only checked when both sides are real counts, so a corrupt base reports itself once
  // rather than also producing nonsense arithmetic.
  if (!isCount(state.historyBase)) {
    v.push(`historyBase is not a non-negative integer (${state.historyBase})`)
  } else if (isCount(state.stats.played)) {
    const behind = state.stack.length + state.backDepth
    const live = liveCounted(state)
    if (state.historyBase + behind + live !== state.stats.played)
      v.push(
        `card ledger: historyBase(${state.historyBase}) + history(${behind}) + live(${live}) != played(${state.stats.played})`,
      )
  }
  // ── The times ledger ──
  // See the header note. Checked only against a real times array (a corrupt one is already
  // reported above, and arithmetic on it would just report the same break a second time).
  if (!isCount(state.timesBase)) {
    v.push(`timesBase is not a non-negative integer (${String(state.timesBase)})`)
  } else if (Array.isArray(state.stats.times)) {
    const named = ledgerTimes(state)
    if (!isSubMultiset(named, state.stats.times))
      v.push(`times ledger: a card names a solve time that is not in stats.times`)
    if (state.timesBase + named.length !== state.stats.times.length)
      v.push(
        `times ledger: timesBase(${state.timesBase}) + named(${named.length}) != times.length(${state.stats.times.length})`,
      )
  }
  return v
}
