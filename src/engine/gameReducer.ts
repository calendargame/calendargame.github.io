// ─────────────────────────────────────────────────────────────────────────
// engine/gameReducer.ts — the shared game engine as a PURE reducer.
//
// (state, action) => state. No React, no app state, no side effects: the impure
// inputs the original handlers computed inline — the next random date (genDate)
// and solve times (performance.now()) — are supplied by the caller in the action
// payload. Calendar lookups are pure, so the reducer does them directly.
//
// Folding the old App refs into state made every transition atomic, which removed the lazy-mutator +
// stale-setState hazards documented in main.jsx WHILE keeping behavior identical — proven by the
// Classic characterization tests (tests/classic.dom). (The pre-answer stats snapshot App kept is
// gone altogether since round 23: nothing reverses an answer by restoring stats any more — see
// OVERRIDE. The wrong answer's solve time it kept beside it lives on the card, GameState.card.)
//
// This is the engine ALL FIVE modes run on (Classic/Flash/Blitz/Deduction directly;
// AoX via the same hook + a component run/Best layer). The full action set lives here:
// the question loop (NEW/ANSWER/REVEAL/SHOW_CODES/RESET), the OVERRIDE toggle (ONE operation —
// flip the card it points at between "as you answered it" and "overridden", then recompute; see
// the OVERRIDE case), the Back/Forward history nav, the date regen (REGEN_DATE), and the timed-mode
// helpers (RESET_ROUND/LOCK_REVEAL/TIMEOUT_MISS + the ANSWER `complete` / OVERRIDE `hold` flags the
// run modes use).
//
// TYPES (Stage C, TypeScript — the keystone): `GameState` is the full engine state;
// `GameAction` is a discriminated union on `type`, so every `case` is exhaustively
// checked and each action's payload is validated at the dispatch site. A question is a
// discriminated union too — `Question = WeekdayQuestion | DedPuzzle` — which lets
// `correctIndexOf` narrow by `type` with no casts. History entries are `StackEntry`
// (a question plus its answer bookkeeping and its CardMeta).
// ─────────────────────────────────────────────────────────────────────────
import { isJulianDate, wday, wdayJulian } from '../lib/calendar.js'
import { computeStreaks } from './streak.js'
import { computeHasCredit, markBtns, mkBtnsWithCorrect, entryWithGreen } from './answerButtons.js'
import type { ButtonState, Btns } from './answerButtons.js'
import type { FormatId } from '../lib/format.js'

// ── Question / history-entry types ───────────────────────────────────────────
// A plain weekday question: pick the day-of-week for this date. `type` is absent
// (the discriminant) so the union below narrows weekday-vs-puzzle by its presence.
export interface WeekdayQuestion {
  type?: undefined
  y: number
  m: number
  d: number
  _fmt?: FormatId //  the date-format this question was generated in
  _jul?: boolean //   the calendar system (Julian/Gregorian) at generation
}
// One of a Deduction puzzle's answer boxes (Month sub-mode): a label + the months it covers.
export interface DedBox {
  label: string
  months: number[]
}
// A Deduction puzzle: the weekday `w` is shown and the player picks the hidden piece. The
// three sub-modes are a discriminated union because their `options` differ in kind — Day/Year
// answer by a numeric option (a day number / a year), while Month answers by a box, so its
// `options` hold the box LABELS (strings) and the answer resolves through `boxes`. The `_*`
// flags record the generation settings active at spawn.
interface BasePuzzle {
  y: number
  m: number
  d: number
  w: number //         the shown weekday index (0=Sun)
  _fmt?: FormatId
  _jul?: boolean
}
export interface DayPuzzle extends BasePuzzle {
  type: 'day'
  options: number[] //   the day-number choices
}
export interface MonthPuzzle extends BasePuzzle {
  type: 'month'
  options: string[] //   the box labels (e.g. 'Jan/Oct'); the answer is the box, resolved via `boxes`
  boxes: DedBox[]
  _m1582?: boolean
}
export interface YearPuzzle extends BasePuzzle {
  type: 'year'
  options: number[] //   the year choices
  _abx?: boolean
  _julx?: boolean
}
export type DedPuzzle = DayPuzzle | MonthPuzzle | YearPuzzle
// A question is either a weekday prompt or a Deduction puzzle (discriminated on `type`).
export type Question = WeekdayQuestion | DedPuzzle

// ── THE PER-CARD OVERRIDE RECORD (round 23 Q6, the owner's corrected rule) ────────────────────
// "Everything will either say Override or Undo, no locked Override any more. Store what you got
// wrong, so that if you get something wrong, override, then later come back to that question by
// browsing or from another preset and Undo there, it shows your original red highlights."
//
// So the Override state belongs to the QUESTION, permanently, and every scored card has exactly
// two states: A = as you answered it, O = overridden. ★ THE WHOLE RULE IS ONE LINE:
//     credited(card) = A.credited XOR overridden
// and nothing else may ever set a card's credit. An Override on a card in A takes it to O; the same
// button on a card in O (it reads Undo there) takes it back to A. Because the two states are fixed
// values stored on the card, any number of flips lands on one of exactly two positions — a flip
// can never stack credit, never drift a time, and never needs a "used it once" budget (the per-card
// lock the old five-path Override carried is gone for exactly that reason: its only job was to stop
// an incremental delta being applied twice, and a delta read off the card cannot be).
//
// `answered` is stored ONLY while the card is in O — for a card in A the materialised fields
// (StackEntry.btns / hasCredit / solveTime, or the live fields for the card on screen) ARE state
// A, so storing them twice would only make two copies to disagree.
// `live` is the on-screen flags A had; it exists only while the card is the live one (on screen
// at the live edge, or parked as the isLive forward entry), and advance() drops it when the card
// becomes history — a history card has no live flags to put back.
export interface LiveFlags {
  locked: boolean
  revealed: boolean
  countedWrong: boolean
  calcPenaltyActive: boolean
}
export interface AnsweredState {
  btns: Btns //               the grid the player left — every red, plus advance()'s synthesized green
  hasCredit: boolean
  solveTime: number | null // what state A contributes to stats.times (null unless credited)
  live?: LiveFlags
}
export interface CardMeta {
  // The elapsed time at the card's FIRST wrong answer / Reveal / Show Codes — what an Override that
  // credits a miss contributes to the mean (when timing is tracked), i.e. the time it took to get
  // it "wrong". Written once, at that first burn, and never again.
  wrongTime: number | null
  // Non-null ⇔ the card is in state O, and this is its state A. See the note above.
  answered: AnsweredState | null
  // State O's time contribution, FROZEN the first time O credits (absent = never frozen). Without
  // the freeze a card toggled with timing hidden, then toggled again with timing shown, would
  // contribute a different time each cycle — a third state, not a two-state switch.
  oTime?: number | null
}

// The live question's on-screen flags, stashed on the forward-stack so FORWARD can restore it.
export interface LiveState extends LiveFlags {
  saveStatsFrozen: boolean | null
}
// The answer bookkeeping a question carries once it's in the back/forward history.
export interface EntryMeta {
  btns?: Btns
  hasCredit?: boolean
  isLive?: boolean
  liveState?: LiveState
  // THE TIME THIS CARD IS CURRENTLY CONTRIBUTING TO `stats.times` — see the times ledger in
  // GameState. null = it is contributing none (a miss, a late correct, timing off). It is not "how
  // long this card took": an Override that takes a credit away takes the time out of the pool AND
  // out of this field in the same transition, because the two must never disagree.
  solveTime?: number | null
  meta: CardMeta
}
// A history entry: a question plus its bookkeeping.
export type StackEntry = Question & EntryMeta

// The running score/time stats.
export interface Stats {
  played: number
  good: number
  streak: number
  best: number
  times: number[]
}

// ── The full engine state ────────────────────────────────────────────────────
export interface GameState {
  date: Question //                 current question {y,m,d,_fmt,_jul} (or a Deduction puzzle)
  questionId: number //             bumps on every advance / RESET — the hook resets the solve-timer on this, NOT on raw date changes (Back/Forward change date but must not reset the timer; no Override ever moves it backwards)
  gridEpoch: number //              bumps ONLY on RESET / RESET_ROUND — the UI keys the answer grids on it, so every reset REMOUNTS them and the cleared colors SNAP to idle (a remounted element never CSS-transitions from its predecessor's state; .surface-button's hover transition would otherwise fade the green away, Q9). NOT bumped on advance / REGEN_DATE: a remount there would restart in-flight flash keyframes
  persistBtns: Btns //              answer-grid state {idx: 'correct'|'wrong-latest'|'wrong-prev'|'override-wrong'}
  stats: Stats //                   {played,good,streak,best,times}
  stack: StackEntry[] //            back-history (oldest→newest)
  forwardStack: StackEntry[] //     forward-history (for redo after Back)
  backDepth: number //              how many entries deep we've browsed
  locked: boolean //                grid locked (answered/revealed/browsing)
  revealed: boolean //              correct answer shown
  countedWrong: boolean //          this question has been "burned" (wrong / Reveal / Show Codes, or overridden to a miss)
  calcOpen: boolean //              Show Codes panel open
  calcPenaltyActive: boolean //     codes were shown on this question (penalty applied)
  browseHasCredit: boolean //       credit flag for the entry currently being browsed
  saveStatsThisQ: boolean | null // frozen Save-Stats value for this question (null until first stat action)
  // The Override record of the card ON SCREEN — the live card, or the browsed one — the role
  // `liveSolveTime` plays for its time. BACK/FORWARD hand it over alongside persistBtns /
  // browseHasCredit / liveSolveTime, so it always describes whatever card is being shown.
  card: CardMeta
  // ── Hydration baseline (the prior-session record the in-session stack CANNOT reconstruct) ──
  // A continuous mode (Classic/Flash/Deduction) HYDRATES lifetime stats on mount (initEngine's
  // initialStats) but NOT the history behind them, so `best`/`streak` carry a prior-session record while
  // `stack` starts empty. OVERRIDE recomputes streak/best from the whole credit sequence
  // (creditSequence), which (without these) collapses the hydrated record down to the current in-session
  // run on ANY Override (the owner-reported "best streak resets to match the current streak" bug;
  // good/played/times are safe — incremental). `bestFloor` (= hydrated best) is a high-water mark the
  // recompute can never drop below; `streakCarry` (= hydrated trailing streak) is prepended as leading
  // credits so a corrected miss continues the prior run — making Override consistent with the ANSWER
  // path, which already continues the hydrated streak. Both seed at initEngine (0 for a blank/timed
  // start → no behavior change), survive every transition (spread), re-zero on RESET (a fresh
  // initEngine), and RE-BASE on RESET_ROUND, which wipes the history behind the stats it keeps.
  bestFloor: number
  streakCarry: number
  // ── The card ledger (what the Q# badge counts) ──────────────────────────────────────────────
  // What `played` was when `stack` was last emptied — so the card being viewed is the
  // (historyBase + stack.length + 1)-th card of this mode's LIFETIME, not the n-th of this session
  // (see cardNumber). The badge sits beside a Score box that a continuous mode HYDRATES at mount
  // while the stack deliberately starts empty, so the old in-session formula and the box next to it
  // had never agreed: 500 cards in, pressing < read "Q1" beside "471/501" (the owner's report).
  // WHY NO NEW PERSISTED DATA IS NEEDED: the engine already keeps an exact 1-to-1 correspondence —
  // every browsable history entry is exactly one increment of `played`. advance() pushes iff the
  // question was answered AND scored (saveStatsThisQ === true), which is precisely the condition
  // under which some stat action already incremented `played` for it; Override moves `good` and
  // never `played`; a card played with Save Stats OFF is neither counted nor pushed; a Blitz
  // per-round timeout (LOCK_REVEAL) shows an answer without scoring it, and is likewise never
  // pushed. So the ONE fact the stack cannot supply is where it started — this field. The
  // correspondence is asserted outright by checkGameInvariants ('card ledger'), so the fuzz proves
  // it across millions of generated games instead of it resting on this paragraph.
  // It seeds at initEngine from the hydrated total (0 for a blank/timed start — which is why
  // Blitz/AoX, whose Begin/Reset is a full RESET, are unchanged BY CONSTRUCTION rather than by a
  // special case), re-zeroes on RESET with the stats it clears, and re-bases to the KEPT `played`
  // on RESET_ROUND (the timed modes' mid-round Reset wipes history but keeps lifetime stats).
  historyBase: number
  // ── The TIMES ledger (what makes the run breakdown a proof rather than a second opinion) ─────
  // `stats.times` is a bare pool of seconds: it says WHAT the mean is made of and nothing about
  // WHICH card contributed each number. That was survivable while the only consumers were
  // calcAvg/calcMed, and it stopped being survivable the moment a screen had to list the solves
  // one per row — a solve rescued by Override keeps its time in the mean while its own row had no
  // way to know, so the rows would silently fail to add up to the headline they sit under.
  //
  // So every card now carries the time it is contributing RIGHT NOW (StackEntry.solveTime), and
  // this field is that same fact for the card in `state.date` — the one card that is not in a
  // stack. Together they are a complete, per-card decomposition of the pool: every path that
  // pushes a time into `stats.times` writes it here or onto an entry, and every path that drops
  // one clears it in the same transition. checkGameInvariants asserts the two sides agree, so the
  // fuzz proves the decomposition across millions of games instead of it resting on this comment.
  //
  // `timesBase` is the count of times that sit BEHIND the current history with no card to name
  // them — exactly the role `historyBase` plays for `played`, and it exists for the same two
  // reasons: a continuous mode HYDRATES saved `times` on mount with no history behind them, and
  // RESET_ROUND wipes the history while keeping the stats. So the standing claim is
  // `times.length === timesBase + (the ledger's non-null entries)`, and the ledger times are
  // always a sub-multiset of the pool. When `timesBase` is 0 — which is every run/round mode, whose
  // Begin is a full RESET — those two together force EXACT equality, which is the property the
  // breakdown relies on (engine/runBreakdown).
  liveSolveTime: number | null
  timesBase: number
}

// ── The action set (discriminated union on `type`) ───────────────────────────
// Each action carries the impure inputs the reducer can't compute (the next date,
// the solve time) plus the per-dispatch settings (useJulian / saveStats / timing).
export type GameAction =
  | { type: 'NEW'; nextDate: Question; useJulian: boolean; saveStats: boolean }
  | {
      type: 'ANSWER'
      idx: number
      useJulian: boolean
      elapsed: number | null
      tracking: boolean
      saveStats: boolean
      nextDate: Question
      complete?: boolean
    }
  | { type: 'REVEAL'; useJulian: boolean; elapsed: number | null; saveStats: boolean }
  | {
      type: 'SHOW_CODES'
      open: boolean
      useJulian: boolean
      elapsed: number | null
      saveStats: boolean
    }
  | { type: 'RESET'; timingOff: boolean; nextDate: Question }
  | { type: 'REGEN_DATE'; nextDate: Question }
  | { type: 'LOCK_REVEAL'; useJulian: boolean }
  | { type: 'TIMEOUT_MISS'; useJulian: boolean; saveStats: boolean }
  | { type: 'RESET_ROUND' }
  // The toggle. It carries NO direction — the direction is read off the card it points at (see
  // overridePlan), which is what makes a double-dispatch or a stale caller unable to stack credit.
  // `hold` (the run modes): a toggle that CREDITS the live card stays on it, locked, instead of
  // advancing — MoX's completing solve, and a Blitz/MoX round/run that stays ended.
  | { type: 'OVERRIDE'; useJulian: boolean; tracking: boolean; nextDate: Question; hold?: boolean }
  | { type: 'BACK' }
  | { type: 'FORWARD'; useJulian: boolean }

// Weekday index (0=Sun) honoring the active calendar (Julian vs Gregorian).
export const activeWday = (y: number, m: number, d: number, useJulian: boolean): number =>
  useJulian && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)

// The correct answer index for a question. This is what makes the one shared engine serve
// BOTH weekday modes and Deduction: a Deduction puzzle resolves by its own options/answer —
// year: options.indexOf(y); month: the box whose months include m; day: options.indexOf(d) —
// while a plain weekday question resolves by activeWday on (y,m,d). Mirrors App's
// getDedCorrectIdx / dedCorrectIdxFor and the same dispatch in answerButtons.entryWithGreen.
// Weekday entries have no `type`, so this is byte-identical to the old direct activeWday call
// for Classic/Flash/Blitz. (Month always carries `boxes` from makeDedPuzzle, so it resolves
// through them — the old boxless `options.indexOf(m)` fallback was dead and is gone.)
export const correctIndexOf = (e: Question, useJulian: boolean): number => {
  if (e.type === 'year') return e.options.findIndex((y) => y === e.y)
  if (e.type === 'month') return e.boxes.findIndex((b) => b.months.includes(e.m))
  if (e.type === 'day') return e.options.findIndex((d) => d === e.d)
  return activeWday(e.y, e.m, e.d, useJulian)
}

// Build a single-entry answer map. (A computed-key object literal would widen its value to
// `string`, which isn't assignable to Btns, so we assign through a typed local.)
export const oneBtn = (idx: number, s: ButtonState): Btns => {
  const b: Btns = {}
  b[idx] = s
  return b
}

// Does this grid put the answer on screen? A green does; so does 'override-wrong', which marks the
// correct button as the answer an Override took the credit away from. It decides `revealed` for a
// card being BROWSED — every history card shows its answer (advance() synthesizes the green onto a
// miss, and both overridden grids name the answer), so REVEAL's penalty-free browse branch can
// never paint a green over an overridden card's 'override-wrong' and leave a grid that says the
// opposite of its own credit.
const showsAnswer = (btns: Btns | undefined): boolean =>
  !!btns && Object.values(btns).some((v) => v === 'correct' || v === 'override-wrong')

// A stack / forward entry carries the question's date-or-puzzle fields PLUS bookkeeping (btns,
// hasCredit, isLive, liveState, solveTime, meta). Strip the bookkeeping to recover just the
// date/puzzle fields — so FORWARD restores a clean `date` that still keeps Deduction's puzzle
// fields (type/options/w/…), not only y/m/d/_fmt/_jul. For weekday entries the result is exactly
// {y,m,d,_fmt,_jul}, identical to the previous explicit field pick.
const stripEntryMeta = ({
  btns,
  hasCredit,
  isLive,
  liveState,
  solveTime,
  meta,
  ...date
}: StackEntry): Question => date

const blankStats = (): Stats => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })
// A card nobody has answered or overridden — every fresh question starts with one.
export const blankCard = (): CardMeta => ({ wrongTime: null, answered: null })

// The launch / fresh-question engine state for a given starting date. `initialStats` lets a
// continuous mode (Classic/Flash/Deduction) HYDRATE its lifetime stats from saved progress on
// mount (Stage D1); omitted ⇒ a blank slate (timed modes, and the remount after a Full Reset).
export const initEngine = (date: Question, initialStats?: Stats): GameState => ({
  date,
  questionId: 0,
  gridEpoch: 0,
  persistBtns: {},
  stats: initialStats ?? blankStats(),
  stack: [],
  forwardStack: [],
  backDepth: 0,
  locked: false,
  revealed: false,
  countedWrong: false,
  calcOpen: false,
  calcPenaltyActive: false,
  browseHasCredit: false,
  saveStatsThisQ: null,
  card: blankCard(),
  // The hydration baseline (see GameState): seed from the prior-session record, 0 for a blank start.
  bestFloor: initialStats?.best ?? 0,
  streakCarry: initialStats?.streak ?? 0,
  // The card ledger's base (see GameState): the stack starts empty, so everything already played
  // sits behind it. 0 for a blank start ⇒ the badge is the old stack-slot number, unchanged.
  historyBase: initialStats?.played ?? 0,
  // The times ledger (see GameState): a fresh card contributes nothing yet, and every hydrated time
  // is carried-in — it has no card in this session's history to name it. 0 for a blank start ⇒ the
  // ledger accounts for the whole pool, which is what the run modes rely on.
  liveSolveTime: null,
  // ⚠ BOTH LINKS ARE OPTIONAL, and the second one is not symmetry for its own sake: `initialStats`
  // is a hydrated payload out of localStorage, so `times` is only an array because the last build
  // to write it said so. engine/invariants REPORTS a silo with counters and no times array (it is
  // one of the shapes checkStatsInvariants names) rather than repairing it — and a bare
  // `.times.length` would not survive to be reported: it throws inside the engine's initializer, at
  // mount, on every boot, and the player meets the error card instead of the app. `?? 0` is the
  // same answer a blank start gives, which is the honest reading of a silo that names no times.
  timesBase: initialStats?.times?.length ?? 0,
})

// The card's LIFETIME number — the figure the Q# badge shows beside the Score box. `stack` holds the
// entries BEHIND the card being viewed (browsing back pops them), so the base plus that depth plus
// one is the viewed card's 1-based position in everything this mode has ever played. One counter per
// engine, so a mode with its own Score box (Deduction's Day/Month/Year each run their own) numbers
// separately, which is exactly the rule "the badge follows the Score box it sits beside".
export const cardNumber = (state: GameState): number => state.historyBase + state.stack.length + 1

// DID THIS CARD EARN ITS POINT? — the rule, in one place, because four callers need it and two of
// them used to spell it out for themselves. "Earned" is NOT "the grid shows green": a Reveal, a Show
// Codes and a timeout all leave a clean 'correct' on the grid without crediting `good`, so
// computeHasCredit alone would call a give-up a credit. A card earned a point only if it was a clean
// first-try correct — a green with no wrong beside it, the answer never shown (`revealed`), and the
// question never burned (`countedWrong`) — or an Override credited it, which leaves exactly that
// shape (a lone green, both flags clear). Callers: advance() stamping `hasCredit` onto the entry it
// pushes, liveCredited below, the streak recompute folding the parked live card, and
// engine/runBreakdown reading the same card for the run breakdown's rows. (Family of bugs found by the
// C2 fuzz survey, 2026-06-06; extracted to one function when the breakdown became a caller and a
// further copy was the alternative.)
export const earnedCredit = (
  btns: Btns | null | undefined,
  revealed: boolean,
  countedWrong: boolean,
): boolean => computeHasCredit(btns) && !revealed && !countedWrong

// Is the LIVE card (the one at the live edge, backDepth 0) credited right now? Read from the grid and
// the two flags, never stored: the only credited cards that ever sit at the live edge are the ones
// that credited WITHOUT advancing — MoX's held completing solve (ANSWER `complete`) and a crediting
// Override that held — and both leave exactly earnedCredit's shape. It is what the old
// `canOverrideCorrect` flag approximated; a derived fact cannot fall out of step with the grid.
export const liveCredited = (s: GameState): boolean =>
  earnedCredit(s.persistBtns, s.revealed, s.countedWrong)

// The per-question frozen Save-Stats value (frozen on first stat-affecting action),
// else the live setting. Mirrors App's effectiveSaveStats / saveStatsThisQRef.
export const effectiveSaveStats = (state: GameState, saveStats: boolean): boolean =>
  state.saveStatsThisQ === null ? saveStats : state.saveStatsThisQ

// ── WHICH CARD THE ONE BUTTON POINTS AT ─────────────────────────────────────────────────────────
// ★ ONE SELECTOR, READ BY BOTH THE REDUCER AND THE HOOK — never two copies, because the button's
// label (useGameEngine) and what the press does (OVERRIDE below) disagreeing is the one bug a toggle
// cannot survive. In priority order:
//   'browsed' — you are browsing history: the card on screen, whatever it is (every history card
//               was scored — that is what put it in history).
//   'live'    — the live card has something to override: it was scored AND it is burned, credited,
//               or already overridden. ⚠ A card the clock timed out on (Blitz's per-question
//               TIMEOUT_MISS on an untouched card) is scored but none of the three, so it is NOT a
//               target — the clock running out is not a misclick, and that has always been the rule
//               (owner decision, round 23). The target falls through to the card before it.
//   'retro'   — otherwise the most recent history card, with the live card untouched: a fresh date
//               is on screen and the card you just finished is the one Override means.
//   null      — nothing to point at (a fresh mode with no history): the button is dimmed.
// The Save-Stats gate is the hook's (it needs the live setting); the reducer trusts it.
export type OverrideTarget = 'browsed' | 'live' | 'retro' | null
const liveEligible = (s: GameState): boolean =>
  s.saveStatsThisQ === true && (s.countedWrong || liveCredited(s) || s.card.answered !== null)
export function overrideTarget(state: GameState): OverrideTarget {
  if (state.backDepth > 0) return 'browsed'
  if (liveEligible(state)) return 'live'
  return state.stack.length > 0 ? 'retro' : null
}

// What a press would do, read off the targeted card before it happens — the mode screens decide
// their own half (a round that ends or resumes, a run that fails, a flash that stops) from this,
// and the reducer decides its own from the SAME object, so the two can never be told different
// stories. `overridden`: the card is in state O now (the button reads Undo). `credits`: the card
// is credited AFTER the press.
export interface OverridePlan {
  target: 'browsed' | 'live' | 'retro'
  overridden: boolean
  credits: boolean
}
export function overridePlan(state: GameState): OverridePlan | null {
  const target = overrideTarget(state)
  if (target === null) return null
  if (target === 'retro') {
    const e = state.stack[state.stack.length - 1]
    return { target, overridden: e.meta.answered !== null, credits: !e.hasCredit }
  }
  const credited = target === 'browsed' ? state.browseHasCredit : liveCredited(state)
  return { target, overridden: state.card.answered !== null, credits: !credited }
}
// Does the press move play on to a fresh date? Exactly one case: the LIVE card goes from A to a
// CREDITED O and the caller did not ask to hold it — the old "credit the wrong and move on". Every
// other press stays where it is, and in particular an Undo NEVER navigates.
export const overrideAdvances = (plan: OverridePlan, hold: boolean): boolean =>
  plan.target === 'live' && !plan.overridden && plan.credits && !hold

// The card fields a toggle reads and writes, whichever of the three places the card lives in.
interface CardFields {
  btns: Btns
  hasCredit: boolean
  solveTime: number | null
  meta: CardMeta
}
// ★ THE TOGGLE ITSELF — one function for every target. A → O stashes A (with the live flags when the
// card is the live one), freezes O's time the first time O credits, and materialises O's grid: the
// answer alone, green when O credits and 'override-wrong' when it takes the credit away. O → A puts
// A back exactly, reds and time included, and keeps the frozen oTime for the next flip.
const toggleCard = (
  cur: CardFields,
  correctIdx: number,
  tracking: boolean,
  live?: LiveFlags,
): CardFields => {
  const a = cur.meta.answered
  if (a !== null) {
    return {
      btns: a.btns,
      hasCredit: a.hasCredit,
      solveTime: a.solveTime,
      meta: { ...cur.meta, answered: null },
    }
  }
  const credits = !cur.hasCredit
  const oTime =
    credits && cur.meta.oTime === undefined
      ? tracking
        ? cur.meta.wrongTime
        : null
      : cur.meta.oTime
  const answered: AnsweredState = {
    btns: cur.btns,
    hasCredit: cur.hasCredit,
    solveTime: cur.solveTime,
    ...(live ? { live } : {}),
  }
  return {
    btns: oneBtn(correctIdx, credits ? 'correct' : 'override-wrong'),
    hasCredit: credits,
    solveTime: credits ? (oTime ?? null) : null,
    meta: { ...cur.meta, answered, ...(oTime !== undefined ? { oTime } : {}) },
  }
}

// Remove one occurrence of a now-reversed answer's solve time from the pool. Matches by VALUE (not an
// index, which goes stale once an earlier reversal removed a time) so the count stays in lockstep
// with `good`. null ⇒ the card contributed no time, so nothing to remove. (C1 fuzz fix.)
const dropContributedTime = (times: number[], t: number | null): number[] => {
  if (t == null) return times
  const i = times.indexOf(t)
  return i < 0 ? times : [...times.slice(0, i), ...times.slice(i + 1)]
}

// A toggle's effect on the counters: `good` moves by one in the card's new direction, and the card's
// old contribution leaves the pool as its new one enters. `played` never moves — a toggle neither
// adds nor removes a card — which is why historyBase and timesBase are never touched by one either.
const retime = (stats: Stats, before: CardFields, after: CardFields): Stats => {
  const times = dropContributedTime(stats.times, before.solveTime)
  return {
    ...stats,
    good: stats.good + (after.hasCredit ? 1 : -1),
    times: after.solveTime == null ? times : [...times, after.solveTime],
  }
}

// ── THE CREDIT SEQUENCE — every scored card in play order, as credit / miss ──────────────────────
// What streak and best are recomputed from after a toggle, because a toggle can change ANY card's
// credit — not just the newest — and a run of credits is a fact about the whole sequence:
//   the hydrated trailing streak (as leading credits — see GameState.streakCarry), then the cards
//   behind the one on screen (`stack`), then the browsed card, then the cards parked ahead of it
//   (the forward stack, newest-first, so reversed), then the LIVE card if it was scored.
// The live card is folded in wherever it is — on screen, or parked as the isLive forward entry while
// you browse — because a scored live card belongs to the trailing history exactly as advance() will
// later push it: a scored miss at the live edge breaks the streak, a scored live credit extends it.
// (This replaced five hand-passed variants, two of which dropped a scored live card altogether.)
const liveContribution = (s: GameState): boolean[] => {
  if (s.backDepth === 0) {
    const scored = s.saveStatsThisQ === true && Object.keys(s.persistBtns).length > 0
    return scored ? [liveCredited(s)] : []
  }
  const e = s.forwardStack.find((f) => f.isLive)
  const ls = e?.liveState
  if (!e || !ls || ls.saveStatsFrozen !== true || !e.btns || !Object.keys(e.btns).length) return []
  return [earnedCredit(e.btns, ls.revealed, ls.countedWrong)]
}
const creditSequence = (s: GameState): boolean[] => [
  ...Array.from({ length: s.streakCarry }, () => true),
  ...s.stack.map((e) => !!e.hasCredit),
  ...(s.backDepth > 0 ? [s.browseHasCredit] : []),
  ...s.forwardStack
    .slice()
    .reverse()
    .filter((e) => !e.isLive)
    .map((e) => !!e.hasCredit),
  ...liveContribution(s),
]
// streak = the trailing run, best = the longest run — never below the hydrated best (bestFloor, 0 for
// a blank start). Prepending the carry already captures a run joining the prior trailing streak to
// in-session credits; the floor covers a longer prior run the carry does not represent.
const withStreaks = (s: GameState): GameState => {
  const { curStreak, bestStreak } = computeStreaks(creditSequence(s))
  return {
    ...s,
    stats: { ...s.stats, streak: curStreak, best: Math.max(s.bestFloor, bestStreak) },
  }
}

// pushAndNext (Classic): push the just-finished question to history (only when it was
// answered AND Save Stats is on for it), then load nextDate and clear per-question state.
const advance = (
  state: GameState,
  {
    nextDate,
    useJulian,
    finalBtns,
    saved,
  }: { nextDate: Question; useJulian: boolean; finalBtns?: Btns; saved: boolean },
): GameState => {
  const btns = finalBtns ?? state.persistBtns
  const wasAnswered = Object.keys(btns).length > 0
  // A question enters history only if it was actually SCORED — i.e. some stat-affecting action ran on
  // it (saveStatsThisQ goes non-null the moment any answer / Reveal / Show Codes / TIMEOUT_MISS touches
  // it). A Blitz per-round timeout (LOCK_REVEAL) SYNTHESIZES the answer onto a fresh, never-scored
  // question (saveStatsThisQ stays null) purely to display it; that question wasn't played, so pushing
  // it would add a PHANTOM history entry — a miss that desyncs the streak/credit reconstruction from
  // `good`. `saved` (the live/frozen Save-Stats) wrongly falls back to the live setting when
  // saveStatsThisQ is null, so it can't gate this alone. (C2 fuzz fix, found by the timed-strong
  // strong-oracle profile.)
  const scored = state.saveStatsThisQ !== null
  let stack = state.stack
  if (wasAnswered && saved && scored) {
    // The card's Override record goes with it, minus the live flags: from here on it is a history
    // card, and an Undo on it puts back its grid, its credit and its time — there is no on-screen
    // lock or reveal left to restore. Its state-A grid gets the same synthesized green the entry
    // itself gets, so undoing it later lands exactly where it would have been had it never been
    // overridden. (Only an O card carries `answered`; an A card's A is the entry itself.)
    const a = state.card.answered
    const meta: CardMeta =
      a === null
        ? state.card
        : {
            ...state.card,
            answered: {
              btns: entryWithGreen({ ...state.date, btns: a.btns }, useJulian)?.btns ?? a.btns,
              hasCredit: a.hasCredit,
              solveTime: a.solveTime,
            },
          }
    // hasCredit = "this question EARNED a point", NOT merely "the grid shows green" — the rule and
    // the bugs behind it are at earnedCredit above. Getting it wrong here inflates streak/best PAST
    // good on the next Override that recomputes from history (an impossible score that slips by the
    // good≤played check).
    const pushed = entryWithGreen(
      {
        ...state.date,
        btns,
        hasCredit: earnedCredit(btns, state.revealed, state.countedWrong),
        // The times ledger hands off here: the time the live card was contributing becomes the
        // pushed card's, and the live half is cleared below. A card that is NOT pushed can never be
        // holding one — a non-null liveSolveTime means some action put a real number into
        // stats.times, which requires the frozen Save-Stats to be true, which is exactly the
        // condition (`wasAnswered && saved && scored`) this branch is inside. The clear is
        // unconditional anyway, so a future path that broke that reasoning would drop the time and
        // trip the invariant rather than mis-attributing it to the next card.
        solveTime: state.liveSolveTime,
        meta,
      },
      useJulian,
    )
    // pushed is built from a non-null literal, so it's always defined — the guard just satisfies the type.
    if (pushed) stack = [...state.stack, pushed]
  }
  return {
    ...state,
    questionId: state.questionId + 1,
    stack,
    forwardStack: [],
    date: nextDate,
    persistBtns: {},
    revealed: false,
    locked: false,
    calcPenaltyActive: false,
    calcOpen: false,
    backDepth: 0,
    countedWrong: false,
    saveStatsThisQ: null,
    card: blankCard(), //  handed to the pushed entry above; the fresh card has no record yet
    liveSolveTime: null, // handed to the pushed entry above; the fresh card contributes nothing
  }
}

// ★ THE ENGINE'S ONE DOOR. (Round 23's first cut wrapped this switch in a second function that
// discarded a whole-state undo capsule on every other action; the per-card toggle has nothing to
// discard, so the wrapper and its capsule are gone and every action is just its case below.)
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    // ── NEW ────────────────────────────────────────────────────────────────
    // Advance to a fresh question (the "New" button / doNew→pushAndNext).
    case 'NEW': {
      const { nextDate, useJulian, saveStats } = action
      // If browsing back, return to the live edge FIRST (replay Forward), then advance — so New
      // advances the LIVE question, not the browsed one. Advancing from a browsed entry would
      // DUPLICATE it into history (a second copy of a card whose played was already counted →
      // good>played once both copies are credited) and discard the live question. backDepth and
      // forwardStack length stay in lockstep while browsing, so this terminates at the live edge.
      // Fix 2026-06-06.
      let s = state
      while (s.backDepth > 0 && s.forwardStack.length > 0)
        s = gameReducer(s, { type: 'FORWARD', useJulian })
      return advance(s, { nextDate, useJulian, saved: effectiveSaveStats(s, saveStats) })
    }

    // ── ANSWER ───────────────────────────────────────────────────────────────
    // Click a weekday (submitDoW). Correct → credit (first try) + advance. Wrong →
    // mark, burn the question, no advance. `elapsed` is the solve time (component-timed);
    // `tracking` is trackingOn() (record times only when timing is visible).
    case 'ANSWER': {
      const { idx, useJulian, elapsed, tracking, saveStats, nextDate, complete } = action
      // A locked card is resolved — including every card an Override left on screen (both of its
      // overridden states lock), so an answer can never paint over a card's overridden grid.
      if (state.locked) return state
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)

      if (idx === correct) {
        const next: GameState = { ...state, saveStatsThisQ: effective }
        if (!state.countedWrong) {
          const recorded = elapsed != null && tracking && effective ? elapsed : null
          // The ledger's live half, written in the same breath as the pool below — they are one
          // fact. A LATE correct (countedWrong, this whole block skipped) records no time at all
          // and so contributes none: the card is a miss, and its breakdown row shows a dash for a
          // time rather than a number the mean does not contain.
          next.liveSolveTime = recorded
          let stats = state.stats
          if (recorded != null) {
            stats = { ...stats, times: [...stats.times, recorded] }
          }
          if (effective) {
            const streak = stats.streak + 1
            stats = {
              ...stats,
              played: stats.played + 1,
              good: stats.good + 1,
              streak,
              best: Math.max(stats.best, streak),
            }
          }
          next.stats = stats
        }
        const finalBtns = state.countedWrong
          ? mkBtnsWithCorrect(state.persistBtns, correct)
          : oneBtn(correct, 'correct')
        // `complete` (AoX's Nth/last solve): credit the answer but DON'T advance — mark the grid,
        // lock it, and STAY on the question so it can be reviewed and overridden (the live target —
        // see overrideTarget; liveCredited reads the credit straight off this grid). Only AoX passes
        // `complete`; the one-question-loop modes always advance after a correct.
        if (complete && !state.countedWrong) {
          return { ...next, persistBtns: finalBtns, locked: true }
        }
        return advance(next, { nextDate, useJulian, finalBtns, saved: effective })
      }

      // Wrong.
      const next: GameState = { ...state, saveStatsThisQ: effective }
      if (!state.countedWrong) next.card = { ...state.card, wrongTime: elapsed }
      next.persistBtns = markBtns(state.persistBtns, idx, 'wrong-latest')
      if (!state.countedWrong && effective) {
        next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      return next
    }

    // ── REVEAL ───────────────────────────────────────────────────────────────
    // Show the correct answer. On an unanswered back-browsed entry it's penalty-free;
    // otherwise it burns the question (counts as played, streak reset) and locks.
    case 'REVEAL': {
      const { useJulian, elapsed, saveStats } = action
      const correct = correctIndexOf(state.date, useJulian)
      if (state.locked && !state.revealed && state.backDepth > 0) {
        return {
          ...state,
          persistBtns: mkBtnsWithCorrect(state.persistBtns, correct),
          revealed: true,
        }
      }
      if (state.locked) return state
      const effective = effectiveSaveStats(state, saveStats)
      const next: GameState = { ...state, saveStatsThisQ: effective }
      if (!state.countedWrong) {
        // Reveal counts as a miss, so it records the card's wrongTime exactly like a wrong answer —
        // an Override that later credits the card contributes it.
        next.card = { ...state.card, wrongTime: elapsed }
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      next.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      next.locked = true
      next.revealed = true
      return next
    }

    // ── SHOW_CODES ─────────────────────────────────────────────────────────────
    // Toggle the codes panel. Opening on a live (non-back-browsed-unanswered) question
    // applies the penalty (counts as played, reveals the answer) — applyCalcPenalty.
    case 'SHOW_CODES': {
      const { open, useJulian, elapsed, saveStats } = action
      if (!open) return { ...state, calcOpen: false }
      // Show Codes is a PENALTY-FREE, read-only review (just open the panel) whenever the current
      // question is already RESOLVED — opening the codes then can't be a "peek before answering". Three
      // resolved cases, all of which must NOT run the penalty path below (which counts a played, resets
      // the streak, arms countedWrong, and re-sets saveStatsThisQ):
      //   • browsing back (backDepth>0) — reviewing history. Burning a browsed entry would count a
      //     second `played` for a card whose one was counted when it was played (good > played).
      //     (Fix 2026-06-06; test: classic.dom "Show Codes while browsing back is read-only".)
      //   • a CREDITED live card (liveCredited — AoX's held completing solve, or a crediting Override
      //     that held): an already-answered-CORRECT question. Burning it would count a phantom played +
      //     reset the streak while `good` keeps the credit. Only the run modes ever leave a credited
      //     card at the live edge (the one-question-loop modes advance on a correct). (C2 fuzz fix,
      //     aox-strong profile.)
      //   • already REVEALED (revealed) — the answer is on screen: a wrong-then-Reveal, a Blitz
      //     per-round timeout (LOCK_REVEAL), a per-question TIMEOUT_MISS, or a live card an Override
      //     took the credit from. The penalty path is a no-op for these anyway
      //     (firstPenalty=!countedWrong&&!revealed is already false), but it STILL re-set
      //     saveStatsThisQ — which on a never-played LOCK_REVEAL'd question makes it look "scored" so
      //     a later advance pushes it as a PHANTOM history miss (a good/streak desync). A read-only
      //     review keeps saveStatsThisQ untouched. (C2 fuzz fix, timed-strong profile.)
      if (state.backDepth > 0 || liveCredited(state) || state.revealed) {
        return { ...state, calcOpen: true }
      }
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)
      const next: GameState = {
        ...state,
        calcPenaltyActive: true,
        calcOpen: true,
        saveStatsThisQ: effective,
      }
      const firstPenalty = !state.countedWrong && !state.revealed
      if (firstPenalty) {
        // A miss like a wrong answer, so it records the card's wrongTime the same way.
        next.card = { ...state.card, wrongTime: elapsed }
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      if (state.backDepth === 0) next.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      if (!state.revealed) next.revealed = true
      // Arm countedWrong (which makes the card an Override target — see overrideTarget) ONLY on a
      // first penalty — the burn that actually counts this question. If it was already `revealed` but
      // never counted (Blitz per-round timeout = LOCK_REVEAL: revealed + locked, played NOT
      // incremented), opening codes must NOT arm it — else a crediting Override would add good+1 on
      // played 0 (1-0). firstPenalty is the same gate the played increment uses, keeping countedWrong
      // and played in lockstep. Fix 2026-06-06 (surfaced by the all-modes score-integrity survey).
      if (firstPenalty) next.countedWrong = true
      return next
    }

    // ── RESET ────────────────────────────────────────────────────────────────
    // Reset Stats: clear stats + history + per-question state. The date is regenerated
    // when timing is visible OR the current question was burned; otherwise kept (you
    // haven't used it yet). `nextDate` is supplied for the regen case.
    case 'RESET': {
      const { timingOff, nextDate } = action
      const regen = !timingOff || state.countedWrong || state.revealed
      return {
        ...initEngine(regen ? nextDate : state.date),
        questionId: state.questionId + 1,
        // initEngine re-zeroes gridEpoch — carry the bump instead, so the reset remounts the grids (Q9).
        gridEpoch: state.gridEpoch + 1,
      }
    }

    // ── REGEN_DATE ───────────────────────────────────────────────────────────────
    // Swap the live date in place — no history push, no stat change. Used by
    // performTimingOn (enabling timing/Save Stats) and by regenDecisionFor (a format /
    // leap / year-range setting change). A BURNED date (wrong/Reveal/Show Codes) is kept
    // — you haven't used it yet only when it's fresh — and a browsed entry (backDepth>0)
    // is never regenerated. Bumps questionId so the solve-timer restarts (matches
    // performTimingOn setting tStartRef).
    case 'REGEN_DATE': {
      const { nextDate } = action
      // `liveCredited` joins the bail list for the reason the other terms are on it: you have USED
      // this date. A credited card at the live edge is one that credited without advancing — AoX's
      // held completing solve, or a crediting Override that held — and swapping the date under it
      // would leave its credit (and any second it put in the mean) attributed to a date the player
      // never saw. It replaces the narrower "holds a recorded time", which missed the same card when
      // timing was not tracked. No in-app path reaches it (AoX only regenerates while idle), so this
      // changes no behaviour; it closes the gap rather than trusting the component to. (Every
      // overridden live card is covered too: both of its states lock, and the miss one reveals.)
      if (state.countedWrong || state.revealed || state.backDepth > 0 || liveCredited(state))
        return state
      return { ...state, date: nextDate, questionId: state.questionId + 1 }
    }

    // ── LOCK_REVEAL ──────────────────────────────────────────────────────────────
    // Show the correct answer + lock, WITHOUT any stat change — Blitz's per-round timeout
    // (the round ended on the clock; the unanswered live question isn't counted, App just
    // marks the answer and locks). Distinct from REVEAL, which counts a played miss.
    case 'LOCK_REVEAL': {
      const { useJulian } = action
      // A locked card is already resolved — and since round 23 a locked card can be an OVERRIDDEN
      // one, whose grid is the record of that Override (a lone green or 'override-wrong'). Marking a
      // green onto it would contradict its own credit. Unreachable in the app (the clock only runs on
      // an unlocked live card, and a run fails on an unlocked wrong); the engine refuses anyway, as
      // ANSWER and TIMEOUT_MISS already do.
      if (state.locked) return state
      const correct = correctIndexOf(state.date, useJulian)
      return {
        ...state,
        persistBtns: mkBtnsWithCorrect(state.persistBtns, correct),
        locked: true,
        revealed: true,
      }
    }

    // ── TIMEOUT_MISS ─────────────────────────────────────────────────────────────
    // Blitz per-question timeout: on a pristine question, count a played miss (this action sets
    // no `countedWrong`, so a pristine expiry is not an Override target — see overrideTarget) +
    // show the answer. On a burned question (per-Q + Allow Mistakes: answered wrong, then the clock
    // died) `countedWrong` is ALREADY set, so that card stays an Override target and its round stays
    // resumable (modes/BlitzMode's end kinds), and the played increment is not repeated (the guard
    // below). The round-over lock is the component's (!active disables the grid). Distinct from
    // LOCK_REVEAL (no stat) + REVEAL (countedWrong).
    case 'TIMEOUT_MISS': {
      const { useJulian, saveStats } = action
      // A locked question is already resolved — a timeout on it must be a no-op, exactly like
      // ANSWER's locked guard. Unreachable in the app (the round ends with the timeout), but the
      // engine must not rely on the component to forbid an invalid move. (C2 Session-6 hardening,
      // same class as the TIMEOUT_MISS lock fix.)
      if (state.locked) return state
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)
      // One played per question: a burned (countedWrong) question already took its increment at the
      // wrong answer — the timeout still resolves it (locks + reveals) but must not re-count it.
      const stats =
        effective && !state.countedWrong
          ? { ...state.stats, played: state.stats.played + 1, streak: 0 }
          : state.stats
      return {
        ...state,
        saveStatsThisQ: effective,
        stats,
        persistBtns: mkBtnsWithCorrect(state.persistBtns, correct),
        // The answer is shown → mark revealed (like LOCK_REVEAL), so if this question were ever
        // advanced into history its 'correct' grid isn't mistaken for an earned credit. (C2 fuzz
        // fix, 2026-06-06 — keeps the revealed-gate in advance() exhaustive.)
        revealed: true,
        // LOCK the grid too — a per-question timeout ENDS the round, so the question is resolved and
        // must not be answerable. LOCK_REVEAL (the per-round timeout) already locks; TIMEOUT_MISS did
        // not, leaving an unlocked-but-revealed question that the reducer would let ANSWER credit good
        // while pushing it to history as a (revealed) non-credit — a good>credits desync. The Blitz
        // component already disables the grid post-round, so this only closes the engine's own
        // consistency gap (the engine must not rely on the component to forbid an invalid move). (C2
        // fuzz fix, found by the timed-strong strong-oracle profile.)
        locked: true,
      }
    }

    // ── RESET_ROUND ──────────────────────────────────────────────────────────────
    // Clear the history + the current question's transient state but KEEP stats and the
    // current date — App's arm() for the timed modes (Flash/Blitz "Reset" while a round is
    // live). Stats survive (unlike RESET); the timer machinery itself is component-owned.
    case 'RESET_ROUND': {
      return {
        ...state,
        persistBtns: {},
        gridEpoch: state.gridEpoch + 1, // remount the grids — the cleared colors snap, not fade (Q9)
        stack: [],
        forwardStack: [],
        backDepth: 0,
        locked: false,
        revealed: false,
        countedWrong: false,
        calcOpen: false,
        calcPenaltyActive: false,
        browseHasCredit: false,
        saveStatsThisQ: null,
        card: blankCard(),
        // Re-base the card ledger onto the stats that SURVIVE (unlike RESET, which zeroes them):
        // the history behind them is gone, so everything counted so far is now "behind the empty
        // stack". Flash's mid-round Reset therefore keeps numbering forward — the next card is the
        // 502nd, not the 1st — while Blitz/AoX, which reset via RESET, restart at 1. Without this
        // the badge would fall back to a session number the surviving Score box contradicts, which
        // is the very defect this ledger exists to close.
        historyBase: state.stats.played,
        // …and the times ledger re-bases with it, for the identical reason: the surviving `times`
        // keep every second they had, while the cards that earned them are gone. They become
        // carried-in — counted by `timesBase`, named by nothing.
        liveSolveTime: null,
        timesBase: state.stats.times.length,
        // …and so does the streak baseline, for the reason it exists at all (see GameState): the
        // kept best and trailing streak were earned by cards that are no longer in any stack, so an
        // Override's recompute must treat them exactly as it treats a hydrated record. Left at the
        // mount-time values, the first Override after a Reset recomputed best from the post-Reset
        // cards alone and could drop a Best the player set before the Reset.
        bestFloor: state.stats.best,
        streakCarry: state.stats.streak,
      }
    }

    // ── OVERRIDE ───────────────────────────────────────────────────────────────
    // ★ ONE OPERATION: flip the card overridePlan points at between its two states, then
    // recompute. The direction is read off the card, never passed; the credit and the time come from
    // the card's own two stored states, never from a delta — so ANY sequence of presses on ANY
    // cards leaves every card in one of its two states and good ≤ played, streak/best ≤ good and
    // times.length ≤ good hold by construction. Only ever dispatched when overrideAvail (Save Stats
    // on for the card, and a target exists); with no target it is a no-op.
    // Navigation happens in exactly one case (overrideAdvances): the LIVE card credited from A
    // without `hold` moves play on, as crediting a wrong always has. Everything else stays put —
    // in particular taking a held credit away stays on the card as a resolved miss (advancing would
    // hide the very card just flipped), and an Undo never moves.
    case 'OVERRIDE': {
      const { useJulian, tracking, nextDate, hold = false } = action
      const plan = overridePlan(state)
      if (plan === null) return state

      if (plan.target === 'retro') {
        const e = state.stack[state.stack.length - 1]
        const before: CardFields = {
          btns: e.btns ?? {},
          hasCredit: !!e.hasCredit,
          solveTime: e.solveTime ?? null,
          meta: e.meta,
        }
        const after = toggleCard(before, correctIndexOf(e, useJulian), tracking)
        const entry: StackEntry = { ...e, ...after }
        return withStreaks({
          ...state,
          stats: retime(state.stats, before, after),
          stack: [...state.stack.slice(0, -1), entry],
        })
      }

      if (plan.target === 'browsed') {
        const before: CardFields = {
          btns: state.persistBtns,
          hasCredit: state.browseHasCredit,
          solveTime: state.liveSolveTime,
          meta: state.card,
        }
        const after = toggleCard(before, correctIndexOf(state.date, useJulian), tracking)
        return withStreaks({
          ...state,
          stats: retime(state.stats, before, after),
          persistBtns: after.btns,
          browseHasCredit: after.hasCredit,
          // The card being browsed IS `state.date`, so its share of the pool is the on-screen half —
          // BACK parked the live card's value in forwardStack and loaded this entry's in its place,
          // which is what lets one field serve "whatever card is on screen".
          liveSolveTime: after.solveTime,
          card: after.meta,
          revealed: showsAnswer(after.btns),
        })
      }

      // The live card.
      const liveFlags: LiveFlags = {
        locked: state.locked,
        revealed: state.revealed,
        countedWrong: state.countedWrong,
        calcPenaltyActive: state.calcPenaltyActive,
      }
      const before: CardFields = {
        btns: state.persistBtns,
        hasCredit: liveCredited(state),
        solveTime: state.liveSolveTime,
        meta: state.card,
      }
      const after = toggleCard(before, correctIndexOf(state.date, useJulian), tracking, liveFlags)
      const onCard: GameState = {
        ...state,
        stats: retime(state.stats, before, after),
        persistBtns: after.btns,
        liveSolveTime: after.solveTime,
        card: after.meta,
      }
      if (plan.overridden) {
        // O → A: the card is back exactly as you left it — its grid, and its lock / reveal / burn /
        // codes-penalty flags. (A live card in O always carries them; see LiveFlags on
        // AnsweredState. The spread is a no-op on a corrupt record, which the invariants report.)
        return withStreaks({ ...onCard, ...state.card.answered?.live })
      }
      if (plan.credits) {
        // A → O, crediting a burned card: a clean credited card — locked, the answer alone in green,
        // nothing revealed or burned — which is exactly earnedCredit's shape, so liveCredited,
        // advance() and the run breakdown all read it as the credit it now is.
        const credited: GameState = {
          ...onCard,
          locked: true,
          revealed: false,
          countedWrong: false,
          calcPenaltyActive: false,
        }
        if (!overrideAdvances(plan, hold)) return withStreaks(credited)
        return withStreaks(advance(credited, { nextDate, useJulian, saved: true }))
      }
      // A → O, taking a held credit away: STAYS on the card as a resolved miss — locked, the answer
      // shown, burned — and the mode offers whatever it offers after a miss (MoX's Next).
      return withStreaks({ ...onCard, locked: true, revealed: true, countedWrong: true })
    }

    // ── BACK ───────────────────────────────────────────────────────────────────
    // Step back one history entry. The current view is pushed onto forwardStack (the live
    // question is tagged isLive + carries its full liveState so Forward can restore it).
    case 'BACK': {
      const prev = state.stack[state.stack.length - 1]
      if (!prev) return state
      const fwdHC =
        state.backDepth === 0 ? computeHasCredit(state.persistBtns) : state.browseHasCredit
      const fwdEntry: StackEntry =
        state.backDepth === 0
          ? {
              isLive: true,
              ...state.date,
              btns: { ...state.persistBtns },
              liveState: {
                locked: state.locked,
                revealed: state.revealed,
                countedWrong: state.countedWrong,
                calcPenaltyActive: state.calcPenaltyActive,
                saveStatsFrozen: state.saveStatsThisQ,
              },
              hasCredit: fwdHC,
              solveTime: state.liveSolveTime,
              meta: state.card,
            }
          : {
              ...state.date,
              btns: { ...state.persistBtns },
              hasCredit: fwdHC,
              solveTime: state.liveSolveTime,
              meta: state.card,
            }
      const wasAnswered = prev.btns && Object.keys(prev.btns).length > 0
      return {
        ...state,
        calcOpen: false,
        forwardStack: [...state.forwardStack, fwdEntry],
        stack: state.stack.slice(0, -1),
        date: prev,
        persistBtns: wasAnswered ? (prev.btns ?? {}) : {},
        locked: true,
        revealed: showsAnswer(prev.btns),
        countedWrong: false,
        calcPenaltyActive: false,
        // The card's Override record comes on screen with it, exactly as its grid does.
        card: prev.meta,
        backDepth: state.backDepth + 1,
        browseHasCredit: prev.hasCredit ?? computeHasCredit(prev.btns),
        // The times ledger's live half follows the card on screen, exactly as persistBtns and
        // browseHasCredit do: the card we are leaving takes its second into forwardStack (above),
        // and the card we are arriving at brings its own back out. Nothing enters or leaves
        // `stats.times` here — this is the same seconds changing hands, which is why Back/Forward
        // can never move the mean.
        liveSolveTime: prev.solveTime ?? null,
        saveStatsThisQ: true,
      }
    }

    // ── FORWARD ──────────────────────────────────────────────────────────────────
    // Step forward one entry. The current browsed view is pushed back onto the stack; the
    // restored entry is either the live question (full liveState) or another saved entry.
    case 'FORWARD': {
      const { useJulian } = action
      const fwd = state.forwardStack[state.forwardStack.length - 1]
      if (!fwd) return state
      const pushed = entryWithGreen(
        {
          ...state.date,
          btns: { ...state.persistBtns },
          hasCredit: state.browseHasCredit,
          solveTime: state.liveSolveTime,
          meta: state.card,
        },
        useJulian,
      )
      const base: GameState = {
        ...state,
        calcOpen: false,
        stack: pushed ? [...state.stack, pushed] : [...state.stack],
        forwardStack: state.forwardStack.slice(0, -1),
        backDepth: Math.max(0, state.backDepth - 1),
        date: stripEntryMeta(fwd),
        liveSolveTime: fwd.solveTime ?? null, //  the ledger hand-off, mirroring BACK
        card: fwd.meta, //                          …and the Override record's
      }
      if (fwd.isLive) {
        const ls: Partial<LiveState> = fwd.liveState || {}
        return {
          ...base,
          persistBtns: fwd.btns || {},
          locked: !!ls.locked,
          revealed: !!ls.revealed,
          countedWrong: !!ls.countedWrong,
          calcPenaltyActive: !!ls.calcPenaltyActive,
          browseHasCredit: fwd.hasCredit ?? false,
          saveStatsThisQ: ls.saveStatsFrozen === undefined ? null : ls.saveStatsFrozen,
        }
      }
      const fwdAnswered = fwd.btns && Object.keys(fwd.btns).length > 0
      return {
        ...base,
        persistBtns: fwdAnswered ? (fwd.btns ?? {}) : {},
        locked: true,
        revealed: showsAnswer(fwd.btns),
        countedWrong: false,
        calcPenaltyActive: false,
        browseHasCredit: fwd.hasCredit ?? computeHasCredit(fwd.btns),
        saveStatsThisQ: true,
      }
    }

    default:
      return state
  }
}
