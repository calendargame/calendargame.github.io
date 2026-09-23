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
//   • The PER-CARD OVERRIDE RECORD (round 23 Q6): every scored card holds two fixed states, A (as
//     answered) and O (overridden), and its credit is A.credited XOR overridden. A card in O stores
//     its A; if that record and the card it describes ever come apart — the credit not the opposite,
//     the grid not the answer alone, a time on an uncredited state, O not contributing its frozen
//     time, live flags where there is no live card to put them back on — a later Undo would land
//     somewhere that is neither of the card's two states, which is exactly how a toggle could stack
//     credit or strand a second. So each of those is a tripwire, over every card in play.
//   • Date/calendar sanity: month 1-12, day 1-31, integer year; a weekday question resolves
//     to an index in 0-6, and a Deduction puzzle's correct answer is actually among its
//     options (correctIndexOf returns -1 if a generator ever produced a puzzle whose answer
//     isn't selectable).
// ─────────────────────────────────────────────────────────────────────────
import { correctIndexOf, earnedCredit, liveCredited } from './gameReducer.js'
import type { EntryMeta, GameState, Question, Stats } from './gameReducer.js'

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
  // ── ONE WALK OVER EVERY CARD IN PLAY ──
  // Three of the checks below are about the cards the state is holding — the history behind the
  // viewed card (`stack`), the cards parked ahead of it (`forwardStack`, where browsing back parks
  // them, the live one included), and the card on screen — so they share ONE pass that visits each
  // card exactly once and collects what all three need:
  //   • the SECONDS the cards name (the times ledger),
  //   • the parked LIVE entry (the card ledger's last term — see liveCounted's note below),
  //   • the per-card Override record (the five tripwires — see visitCard).
  // The card on screen is handed to the same visitor in the shape a history entry already has
  // (EntryMeta), so there is one visitor rather than one per place a card can be.
  //
  // ⚠ HOT PATH. This runs in the app after EVERY state change (useGameEngine's tripwire effect) and
  // a run mode's history reaches a thousand cards, so the pass materialises nothing per card: no
  // view object, no result array, and a card's label built only when it has something to report.
  // (Round 23's first cut built all three per card, in a walk of its own on top of this one — it
  // cost ~4x the whole check and timed the fuzz survey's deep-history profile out. Keep it so.)
  const named: number[] = []
  const rec: string[] = []
  let parkedLive: EntryMeta | undefined
  for (let i = 0; i < state.stack.length; i++) visitCard(named, rec, state.stack[i], 'stack', i)
  for (let i = 0; i < state.forwardStack.length; i++) {
    const e = state.forwardStack[i]
    if (e.isLive && !parkedLive) parkedLive = e
    visitCard(named, rec, e, 'forwardStack', i)
  }
  visitCard(
    named,
    rec,
    {
      btns: state.persistBtns,
      // Not browsing → the live edge, whose credit is the live rule's; browsing → the entry under
      // the cursor, whose flag BACK already resolved. No liveState either way, so visitCard's
      // re-derivation falls through to exactly this value.
      hasCredit: state.backDepth === 0 ? liveCredited(state) : state.browseHasCredit,
      solveTime: state.liveSolveTime,
      meta: state.card,
      isLive: state.backDepth === 0,
    },
    'on-screen card',
    -1,
  )
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
    const live = liveCounted(state, parkedLive)
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
    if (!isSubMultiset(named, state.stats.times))
      v.push(`times ledger: a card names a solve time that is not in stats.times`)
    if (state.timesBase + named.length !== state.stats.times.length)
      v.push(
        `times ledger: timesBase(${state.timesBase}) + named(${named.length}) != times.length(${state.stats.times.length})`,
      )
  }
  v.push(...rec)
  return v
}

// Has the LIVE question already taken its `played` increment? Every stat-affecting action FREEZES
// saveStatsThisQ, and every one that freezes it to `true` increments `played` exactly once for that
// question (a later action on the same question is gated by countedWrong, so it never double-counts)
// — so `saveStatsThisQ === true` IS "this question is counted". The other two values are both
// "not counted": `false` = it was played with Save Stats off, `null` = no stat action ran on it at
// all (a fresh card, or a Blitz per-round LOCK_REVEAL, which shows the answer without scoring it).
// While browsing back, the live question is parked in forwardStack as the isLive entry, which
// carries that same frozen flag as `saveStatsFrozen` — read it there instead (`parked`, picked up
// by the one card walk).
function liveCounted(state: GameState, parked: EntryMeta | undefined): number {
  const frozen =
    state.backDepth === 0 ? state.saveStatsThisQ : (parked?.liveState?.saveStatsFrozen ?? null)
  return frozen === true ? 1 : 0
}

// Where a report points — built only when there is a report to make (idx < 0: the name stands alone).
const at = (arr: string, idx: number): string => (idx < 0 ? arr : `${arr}[${idx}]`)

// ONE card, for every check that is about a card (see the walk in checkGameInvariants):
//   • the second it names goes into `named` — the times ledger's side of the pool. `forwardStack`
//     cards count because a parked card is still contributing to the pool it left behind.
//   • the five Override-record tripwires go into `rec`.
// Optional chaining throughout: a tripwire that throws on a corrupt state (an entry with no record
// at all) would hide the very report it exists to make.
// The parked LIVE entry's `hasCredit` is BACK's raw read of its grid, so its credit is re-derived
// here through the same rule the reducer applies to a live card (earnedCredit on its parked flags) —
// a revealed live card must not pass as a credit.
function visitCard(named: number[], rec: string[], e: EntryMeta, arr: string, idx: number): void {
  const solveTime = e.solveTime ?? null
  if (solveTime != null) named.push(solveTime)
  const ls = e.liveState
  const credited =
    e.isLive && ls ? earnedCredit(e.btns, ls.revealed, ls.countedWrong) : !!e.hasCredit
  const a = e.meta?.answered ?? null
  // 3 (first half) — holds for every card, overridden or not: no credit, no time.
  if (!credited && solveTime != null)
    rec.push(`${at(arr, idx)}: an uncredited card contributes a time (${solveTime})`)
  // Everything below is about a card in state O, and most cards are not — this is where the walk
  // over a thousand-card history stops for them.
  if (a === null) return
  // 1 — the whole rule: O's credit is the opposite of A's.
  if (credited === a.hasCredit)
    rec.push(
      `${at(arr, idx)}: overridden, but its credit is not the opposite of its as-answered credit`,
    )
  // 2 — O's grid is the answer alone: green when O credits, 'override-wrong' when it does not.
  const vals = Object.values(e.btns ?? {})
  if (vals.length !== 1 || vals[0] !== (credited ? 'correct' : 'override-wrong'))
    rec.push(`${at(arr, idx)}: overridden, but its grid is not the answer alone`)
  // 3 (second half) — a stored uncredited A holds no time either.
  if (!a.hasCredit && a.solveTime != null)
    rec.push(
      `${at(arr, idx)}: its stored uncredited as-answered state holds a time (${a.solveTime})`,
    )
  // 4 — a credited O contributes exactly the time frozen the first time O credited.
  if (credited && solveTime !== (e.meta?.oTime ?? null))
    rec.push(
      `${at(arr, idx)}: a credited overridden card contributes ${solveTime}, not its frozen O time`,
    )
  // 5 — live flags exist exactly where there is a live card to restore them onto.
  const live = !!e.isLive
  if (live !== (a.live !== undefined))
    rec.push(
      `${at(arr, idx)}: overridden, with live flags ${live ? 'missing from' : 'on'} a ${live ? 'live' : 'history'} card`,
    )
}
