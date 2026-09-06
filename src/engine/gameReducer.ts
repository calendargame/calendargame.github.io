// ─────────────────────────────────────────────────────────────────────────
// engine/gameReducer.ts — the shared game engine as a PURE reducer.
//
// (state, action) => state. No React, no app state, no side effects: the impure
// inputs the original handlers computed inline — the next random date (genDate)
// and solve times (performance.now()) — are supplied by the caller in the action
// payload. Calendar lookups are pure, so the reducer does them directly.
//
// Folding the old App snapshot refs (prevStatsSnapshot / wrongTime) into state makes
// every transition atomic, which removes the lazy-mutator + stale-setState hazards
// documented in main.jsx WHILE keeping behavior identical — proven by the Classic
// characterization tests (tests/classic.dom).
//
// This is the engine ALL FIVE modes run on (Classic/Flash/Blitz/Deduction directly;
// AoX via the same hook + a component run/Best layer). The full action set lives here:
// the question loop (NEW/ANSWER/REVEAL/SHOW_CODES/RESET), the 5-path OVERRIDE, the
// Back/Forward history nav, the date regen (REGEN_DATE), and the timed-mode helpers
// (RESET_ROUND/LOCK_REVEAL/TIMEOUT_MISS + the ANSWER `complete` / OVERRIDE `noAdvance`
// flags AoX uses).
//
// TYPES (Stage C, TypeScript — the keystone): `GameState` is the full engine state;
// `GameAction` is a discriminated union on `type`, so every `case` is exhaustively
// checked and each action's payload is validated at the dispatch site. A question is a
// discriminated union too — `Question = WeekdayQuestion | DedPuzzle` — which lets
// `correctIndexOf` narrow by `type` with no casts. History entries are `StackEntry`
// (a question plus answer/override bookkeeping).
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

// The pre-answer stats snapshot used to roll back an Override (Path 2/4 read every field).
export interface Snapshot {
  played: number
  good: number
  streak: number
  best: number
  timesLen: number
  wasWrong: boolean
  // The solve time THIS answer contributed to stats.times (or null if it recorded none — timing off /
  // Save Stats off). Reversing a first-try-correct (Path 1/5) removes this exact value from the pool,
  // which is robust to reordering: matching by value survives a prior reversal shifting array indices,
  // where the old absolute `timesLen` index went stale and stranded a time (times.length > good).
  contributedTime: number | null
}
// A previous wrong answer reclaimable via Override on the NEXT question (Path 4). Just the wrong
// answer's solve time — Path 4 credits good+1 on the LIVE stats, so it needs no stats snapshot.
export interface PendingWrongOverride {
  wrongTime: number | null
}
// A history entry's rollback capsule: the stats snapshot + solve time captured for it.
export interface Capsule {
  snapshot: Snapshot | null
  wrongTime: number | null
}
// The live question's full state, stashed on the forward-stack so FORWARD can restore it.
export interface LiveState {
  locked: boolean
  revealed: boolean
  countedWrong: boolean
  canOverrideCorrect: boolean
  pendingWrongOverride: PendingWrongOverride | null
  calcPenaltyActive: boolean
  saveStatsFrozen: boolean | null
}
// The answer/override bookkeeping a question carries once it's in the back/forward history.
export interface EntryMeta {
  btns?: Btns
  overrideUsed?: boolean
  capsule?: Capsule
  hasCredit?: boolean
  isLive?: boolean
  liveState?: LiveState
  // THE TIME THIS CARD IS CURRENTLY CONTRIBUTING TO `stats.times` — see the times ledger in
  // GameState. null = it is contributing none (a miss, a late correct, timing off). It is not "how
  // long this card took": an Override that takes a credit away takes the time out of the pool AND
  // out of this field in the same transition, because the two must never disagree.
  solveTime?: number | null
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
  questionId: number //             bumps on every advance / RESET — the hook resets the solve-timer on this, NOT on raw date changes (Back/Forward change date but must not reset the timer)
  gridEpoch: number //              bumps ONLY on RESET / RESET_ROUND — the UI keys the answer grids on it, so every reset REMOUNTS them and the cleared colors SNAP to idle (a remounted element never CSS-transitions from its predecessor's state; .surface-button's hover transition would otherwise fade the green away, Q9). NOT bumped on advance / REGEN_DATE: a remount there would restart in-flight flash keyframes
  persistBtns: Btns //              answer-grid state {idx: 'correct'|'wrong-latest'|'wrong-prev'|'override-wrong'}
  stats: Stats //                   {played,good,streak,best,times}
  stack: StackEntry[] //            back-history (oldest→newest)
  forwardStack: StackEntry[] //     forward-history (for redo after Back)
  backDepth: number //              how many entries deep we've browsed
  locked: boolean //                grid locked (answered/revealed/browsing)
  revealed: boolean //              correct answer shown
  countedWrong: boolean //          this question has been "burned" (wrong / Reveal / Show Codes)
  canOverrideCorrect: boolean //    a first-try-correct is reversible via Override
  pendingWrongOverride: PendingWrongOverride | null // previous wrong reclaimable via Override
  overrideUsedThisQ: boolean //     Override already fired for this live question
  calcOpen: boolean //              Show Codes panel open
  calcPenaltyActive: boolean //     codes were shown on this question (penalty applied)
  browseHasCredit: boolean //       credit flag for the entry currently being browsed
  // Snapshots (were refs in App) — folded into state for atomic updates:
  prevStatsSnapshot: Snapshot | null //       pre-answer stats, for Override rollback
  wrongTime: number | null //                 solve time captured at a wrong answer (for retroactive credit)
  saveStatsThisQ: boolean | null //           frozen Save-Stats value for this question (null until first stat action)
  // ── Hydration baseline (the prior-session record the in-session stack CANNOT reconstruct) ──
  // A continuous mode (Classic/Flash/Deduction) HYDRATES lifetime stats on mount (initEngine's
  // initialStats) but NOT the history behind them, so `best`/`streak` carry a prior-session record while
  // `stack` starts empty. The OVERRIDE paths recompute streak/best from the stack via streaksFromStacks,
  // which (without these) collapses the hydrated record down to the current in-session run on ANY
  // Override (the owner-reported "best streak resets to match the current streak" bug; good/played/times
  // are safe — incremental). `bestFloor` (= hydrated best) is a high-water mark the recompute can never
  // drop below; `streakCarry` (= hydrated trailing streak) is prepended as leading credits so a corrected
  // miss continues the prior run — making Override consistent with the ANSWER path, which already
  // continues the hydrated streak. Both seed at initEngine (0 for a blank/timed start → no behavior
  // change), survive every transition (spread), and re-zero on RESET (a fresh initEngine).
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
  | {
      type: 'OVERRIDE'
      useJulian: boolean
      tracking: boolean
      timingOff: boolean
      nextDate: Question
      noAdvance?: boolean
    }
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
const oneBtn = (idx: number, s: ButtonState): Btns => {
  const b: Btns = {}
  b[idx] = s
  return b
}

// A stack / forward entry carries the question's date-or-puzzle fields PLUS bookkeeping (btns,
// capsule, hasCredit, isLive, liveState). Strip the bookkeeping to recover just the date/puzzle
// fields — so FORWARD restores a clean `date` that still keeps Deduction's puzzle fields
// (type/options/w/…), not only y/m/d/_fmt/_jul. For weekday entries the result is exactly
// {y,m,d,_fmt,_jul}, identical to the previous explicit field pick.
const stripEntryMeta = ({
  btns,
  overrideUsed,
  capsule,
  hasCredit,
  isLive,
  liveState,
  solveTime,
  ...date
}: StackEntry): Question => date

const blankStats = (): Stats => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })

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
  canOverrideCorrect: false,
  pendingWrongOverride: null,
  overrideUsedThisQ: false,
  calcOpen: false,
  calcPenaltyActive: false,
  browseHasCredit: false,
  prevStatsSnapshot: null,
  wrongTime: null,
  saveStatsThisQ: null,
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
  timesBase: initialStats?.times.length ?? 0,
})

// The card's LIFETIME number — the figure the Q# badge shows beside the Score box. `stack` holds the
// entries BEHIND the card being viewed (browsing back pops them), so the base plus that depth plus
// one is the viewed card's 1-based position in everything this mode has ever played. One counter per
// engine, so a mode with its own Score box (Deduction's Day/Month/Year each run their own) numbers
// separately, which is exactly the rule "the badge follows the Score box it sits beside".
export const cardNumber = (state: GameState): number => state.historyBase + state.stack.length + 1

// DID THIS CARD EARN ITS POINT? — the rule, in one place, because three callers need it and two of
// them used to spell it out for themselves. "Earned" is NOT "the grid shows green": a Reveal, a Show
// Codes, a timeout and a reversed-to-wrong Override all leave a clean 'correct' on the grid without
// crediting `good`, so computeHasCredit alone would call a give-up a credit. A card earned a point
// only if it was a clean first-try correct — a green with no wrong beside it, the answer never shown
// (`revealed`), and the question never burned (`countedWrong`). The genuine crediting advances (a
// first-try ANSWER, Override Path 3) set neither flag, so this only ever drops a FALSE credit.
// Callers: advance() stamping `hasCredit` onto the entry it pushes, liveStreakContribution folding
// the parked live card into a streak recompute, and engine/runBreakdown reading the same card for
// the run breakdown's rows. (Family of bugs found by the C2 fuzz survey, 2026-06-06; extracted to
// one function when the breakdown became a third caller and a third copy was the alternative.)
export const earnedCredit = (
  btns: Btns | null | undefined,
  revealed: boolean,
  countedWrong: boolean,
): boolean => computeHasCredit(btns) && !revealed && !countedWrong

// The per-question frozen Save-Stats value (frozen on first stat-affecting action),
// else the live setting. Mirrors App's effectiveSaveStats / saveStatsThisQRef.
export const effectiveSaveStats = (state: GameState, saveStats: boolean): boolean =>
  state.saveStatsThisQ === null ? saveStats : state.saveStatsThisQ

// pushAndNext (Classic): push the just-finished question to history (only when it was
// answered AND Save Stats is on for it), then load nextDate and clear per-question state.
// pendingWrongOverride is armed when the finished question had been counted wrong.
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
  // `good` (e.g. a later Path-4 Override that advances past a LOCK_REVEAL'd question counted the streak
  // as if the phantom miss weren't there). `saved` (the live/frozen Save-Stats) wrongly falls back to
  // the live setting when saveStatsThisQ is null, so it can't gate this alone. (C2 fuzz fix, found by
  // the timed-strong strong-oracle profile.)
  const scored = state.saveStatsThisQ !== null
  let stack = state.stack
  if (wasAnswered && saved && scored) {
    const capsule: Capsule = {
      snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null,
      wrongTime: state.wrongTime,
    }
    // hasCredit = "this question EARNED a point", NOT merely "the grid shows green" — the rule and
    // the bugs behind it are at earnedCredit above. Getting it wrong here inflates streak/best PAST
    // good on the next Override that recomputes from history (an impossible score that slips by the
    // good≤played check).
    const pushed = entryWithGreen(
      {
        ...state.date,
        btns,
        overrideUsed: false,
        capsule,
        hasCredit: earnedCredit(btns, state.revealed, state.countedWrong),
        // The times ledger hands off here: the time the live card was contributing becomes the
        // pushed card's, and the live half is cleared below. A card that is NOT pushed can never be
        // holding one — a non-null liveSolveTime means some action put a real number into
        // stats.times, which requires the frozen Save-Stats to be true, which is exactly the
        // condition (`wasAnswered && saved && scored`) this branch is inside. The clear is
        // unconditional anyway, so a future path that broke that reasoning would drop the time and
        // trip the invariant rather than mis-attributing it to the next card.
        solveTime: state.liveSolveTime,
      },
      useJulian,
    )
    // pushed is built from a non-null literal, so it's always defined — the guard just satisfies the type.
    if (pushed) stack = [...state.stack, pushed]
  }
  // Deduction never arms pendingWrongOverride (App's runDeductionRound, unlike pushAndNext,
  // doesn't), so a wrong-then-right on a puzzle is reclaimed by Path 5 (retro-flip the just-
  // pushed entry), not Path 4. Gate on the finished question being a puzzle (date.type set).
  const isDeductionQ = !!(state.date && state.date.type)
  // Only arm pendingWrongOverride when the finished wrong question was actually SCORED (`saved`):
  // a wrong burned while Save Stats was OFF was never counted (played not incremented), so there is
  // nothing to retroactively credit — arming it would let Override Path 4 credit good+1 on a played
  // it never incremented (an over-credit / 1-0). Fix 2026-06-06 (tests: classic.dom "Save Stats /
  // Override availability"; surfaced by the all-modes score-integrity survey).
  // AND only when the question still carries its correction capsule (prevStatsSnapshot) — the same
  // eligibility gate the browse/retro flips use (Paths 1/5 via capsule.snapshot). A question whose
  // credit was already overridden AWAY (a Path-2 reversal that stayed put — its snapshot is spent/
  // null) must not re-arm: Path 4 would re-credit the very credit the first override removed, a
  // flip-flop that defeats one-override-per-question while keeping good and hasCredit consistent
  // (invisible to the strong oracle — caught by the independent reference model, C2 Session 6).
  const pendingWrongOverride: PendingWrongOverride | null =
    state.countedWrong && !isDeductionQ && saved && state.prevStatsSnapshot != null
      ? { wrongTime: state.wrongTime }
      : null
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
    overrideUsedThisQ: false,
    backDepth: 0,
    pendingWrongOverride,
    countedWrong: false,
    wrongTime: null,
    prevStatsSnapshot: null,
    canOverrideCorrect: false,
    saveStatsThisQ: null,
    liveSolveTime: null, //  handed to the pushed entry above; the fresh card contributes nothing
  }
}

// A pre-answer stats snapshot used to roll back an Override. `contributedTime` is the solve time this
// answer added to the pool (or null) — only a first-try-correct records one; the wrong/Reveal/Show-
// Codes snapshots pass null (their reversal credits, it never removes a time).
const snapshot = (
  stats: Stats,
  wasWrong: boolean,
  contributedTime: number | null = null,
): Snapshot => ({
  played: stats.played,
  good: stats.good,
  streak: stats.streak,
  best: stats.best,
  timesLen: stats.times.length,
  wasWrong,
  contributedTime,
})

// Remove one occurrence of a now-reversed answer's solve time from the pool. Matches by VALUE (not the
// answer-time index, which goes stale once an earlier reversal removed a time) so the count stays in
// lockstep with `good`. null ⇒ the answer recorded no time, so nothing to remove. (C1 fuzz fix.)
const dropContributedTime = (times: number[], t: number | null): number[] => {
  if (t == null) return times
  const i = times.indexOf(t)
  return i < 0 ? times : [...times.slice(0, i), ...times.slice(i + 1)]
}

// Recompute {curStreak,bestStreak} from the full credit-history. `middle` (when given)
// is the currently-browsed/live question's credit, inserted between the back-stack and
// the (de-reversed, non-live) forward-stack — matching App's recalcStreak / inline copies.
const streaksFromStacks = (
  stack: StackEntry[],
  forwardStack: StackEntry[],
  middle?: boolean,
  carry = 0,
  floor = 0,
): { curStreak: number; bestStreak: number } => {
  const history = [
    // The hydrated trailing streak (carry) prepended as leading credits, so a corrected miss continues
    // the prior-session run — see GameState.streakCarry. carry is 0 for a blank/timed start, making this
    // a no-op (history identical to before). computeStreaks naturally drops the prefix past any
    // un-credited in-session miss, so the carry only extends a still-unbroken run.
    ...Array.from({ length: carry }, () => true),
    ...stack.map((e) => !!e.hasCredit),
    ...(middle === undefined ? [] : [middle]),
    ...forwardStack
      .slice()
      .reverse()
      .filter((e) => !e.isLive)
      .map((e) => !!e.hasCredit),
  ]
  const { curStreak, bestStreak } = computeStreaks(history)
  // best is a high-water mark: never below the hydrated prior-session best (floor). floor is 0 for a
  // blank start (no-op). Prepending `carry` trues already captures any run that joins the prior trailing
  // streak with in-session credits; the floor covers a longer prior run not represented by the carry.
  return { curStreak, bestStreak: Math.max(floor, bestStreak) }
}

// The live question's contribution to the credit history when browsing back (Path 1). The question
// we backed away from is parked in forwardStack as the `isLive` entry, which streaksFromStacks
// EXCLUDES — correctly for a FRESH live question (it isn't part of the played history), but WRONGLY
// for a PLAYED one: a live question that was scored still belongs to the trailing history exactly as
// advance() will later push it, so a scored MISS at the live edge must break the trailing streak and
// a scored live credit must extend it. Mirrors advance()'s push rule — contributes iff it was
// answered AND Save Stats was on for it (saveStatsFrozen === true) — then 'credit' only for a clean
// first-try correct (green grid, not revealed, not burned), else 'miss'. Returns null = transparent.
// Without this, an Override that credits an OLDER entry while a more-recent live MISS sits at the edge
// leaves the streak counting PAST that miss, and the inflated streak then inflates best via the next
// answer's Math.max. (C1 deeper-fuzz fix, 2026-06-08 — found by the strong-oracle profiles.)
const liveStreakContribution = (live: StackEntry | undefined): 'credit' | 'miss' | null => {
  if (!live) return null
  const ls = live.liveState
  const btns = live.btns
  const wasAnswered = !!btns && Object.keys(btns).length > 0
  if (!wasAnswered || !ls || ls.saveStatsFrozen !== true) return null
  return earnedCredit(btns, ls.revealed, ls.countedWrong) ? 'credit' : 'miss'
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    // ── NEW ────────────────────────────────────────────────────────────────
    // Advance to a fresh question (the "New" button / doNew→pushAndNext).
    case 'NEW': {
      const { nextDate, useJulian, saveStats } = action
      // If browsing back, return to the live edge FIRST (replay Forward), then advance — so New
      // advances the LIVE question, not the browsed one. Advancing from a browsed entry would
      // DUPLICATE it into history (advance resets the copy's overrideUsed, so it can be credited
      // AGAIN via Path 5 → good>played) and discard the live question. backDepth and forwardStack
      // length stay in lockstep while browsing, so this terminates at the live edge. Fix 2026-06-06.
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
      if (state.locked) return state
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)

      if (idx === correct) {
        const next: GameState = { ...state, saveStatsThisQ: effective }
        if (!state.countedWrong) {
          // The solve time this answer records (or null) — captured in the snapshot so a later
          // reversal (Path 1/5) removes this exact value, not a stale index.
          const recorded = elapsed != null && tracking && effective ? elapsed : null
          next.prevStatsSnapshot = snapshot(state.stats, false, recorded)
          // The ledger's live half, written in the same breath as the pool below — they are one
          // fact. A LATE correct (countedWrong, this whole block skipped) records no time at all
          // and so contributes none: the card is a miss, and its breakdown row shows a dash for a
          // time rather than a number the mean does not contain.
          next.liveSolveTime = recorded
          next.canOverrideCorrect = true
          next.pendingWrongOverride = null
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
        // lock it, and STAY on the question so it can be reviewed + reversed via Override (Path 2).
        // canOverrideCorrect / prevStatsSnapshot from the credit above are preserved. Only AoX
        // passes `complete`; the one-question-loop modes always advance after a correct.
        if (complete && !state.countedWrong) {
          return { ...next, persistBtns: finalBtns, locked: true }
        }
        return advance(next, { nextDate, useJulian, finalBtns, saved: effective })
      }

      // Wrong.
      const next: GameState = { ...state, saveStatsThisQ: effective, pendingWrongOverride: null }
      if (!state.countedWrong) {
        next.wrongTime = elapsed
        next.prevStatsSnapshot = snapshot(state.stats, true)
      }
      next.persistBtns = markBtns(state.persistBtns, idx, 'wrong-latest')
      if (!state.countedWrong && effective) {
        next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      next.canOverrideCorrect = false
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
        next.wrongTime = elapsed
        // Store a wasWrong snapshot (like a wrong ANSWER) so a revealed question's history entry is
        // back-browse-overridable later (Path 1): Reveal counts as a miss, so it must be flippable to
        // correct after New + Back, same as a wrong answer. (Was null → Override locked.) Fix 2026-06-06.
        next.prevStatsSnapshot = snapshot(state.stats, true)
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      next.canOverrideCorrect = false
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
      //   • browsing back (backDepth>0) — reviewing history. Burning a browsed entry would let Override
      //     fire Path 3 (good+1) instead of the legitimate back-browse Path 1 (flip), over-crediting to
      //     an impossible 2/1 (good > played). (Fix 2026-06-06; test: classic.dom "Show Codes while
      //     browsing back is read-only".)
      //   • a HELD completing solve (canOverrideCorrect — AoX's Nth solve, which credited `good` but
      //     STAYED on the question): an already-answered-CORRECT question. Burning it would count a
      //     phantom played + reset the streak while `good` keeps the credit. canOverrideCorrect is never
      //     true at rest in the one-question-loop modes (they advance on a correct), so this only
      //     affects AoX. (C2 fuzz fix, aox-strong profile.)
      //   • already REVEALED (revealed) — the answer is on screen: a wrong-then-Reveal, a Blitz
      //     per-round timeout (LOCK_REVEAL), or a per-question TIMEOUT_MISS. The penalty path is a
      //     no-op for these anyway (firstPenalty=!countedWrong&&!revealed is already false), but it
      //     STILL re-set saveStatsThisQ — which on a never-played LOCK_REVEAL'd question makes it look
      //     "scored" so a later advance pushes it as a PHANTOM history miss (a good/streak desync). A
      //     read-only review keeps saveStatsThisQ untouched. (C2 fuzz fix, timed-strong profile.)
      if (state.backDepth > 0 || state.canOverrideCorrect || state.revealed) {
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
        next.wrongTime = elapsed
        // wasWrong snapshot (like a wrong ANSWER) so a show-coded entry is back-browse-overridable
        // later (Path 1). The credit-at-most-once gate (Path 4 skips a target already credited via
        // Path 1) keeps the two override routes from double-crediting.
        next.prevStatsSnapshot = snapshot(state.stats, true)
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      if (state.backDepth === 0) next.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      if (!state.revealed) next.revealed = true
      // Arm countedWrong (which opens Override Path 3) ONLY on a first penalty — the burn that
      // actually counts this question. If it was already `revealed` but never counted (Blitz
      // per-round timeout = LOCK_REVEAL: revealed + locked, played NOT incremented), opening codes
      // must NOT arm Override — else Path 3 credits good+1 on played 0 (1-0). firstPenalty is the
      // same gate the played increment uses, keeping countedWrong and played in lockstep. Fix
      // 2026-06-06 (surfaced by the all-modes score-integrity survey).
      if (firstPenalty) {
        next.countedWrong = true
        next.canOverrideCorrect = false
      }
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
      // `liveSolveTime != null` joins the bail list for the reason the other two terms are on it:
      // you have USED this date. A card holding a recorded time is one that credited without
      // advancing — AoX's held completing solve, the only such card in the app — and swapping the
      // date under it would leave its second in the mean while the breakdown attributed it to a
      // date the player never saw. No in-app path reaches it (AoX only regenerates while idle), so
      // this changes no behaviour; it closes the gap rather than trusting the component to.
      if (
        state.countedWrong ||
        state.revealed ||
        state.backDepth > 0 ||
        state.liveSolveTime != null
      )
        return state
      return { ...state, date: nextDate, questionId: state.questionId + 1 }
    }

    // ── LOCK_REVEAL ──────────────────────────────────────────────────────────────
    // Show the correct answer + lock, WITHOUT any stat change — Blitz's per-round timeout
    // (the round ended on the clock; the unanswered live question isn't counted, App just
    // marks the answer and locks). Distinct from REVEAL, which counts a played miss.
    case 'LOCK_REVEAL': {
      const { useJulian } = action
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
    // no `countedWrong`, so a pristine expiry opens no Override path) + show the answer. On a
    // burned question (per-Q + Allow Mistakes: answered wrong, then the clock died) `countedWrong`
    // is ALREADY set, so that end stays Override-rescuable (modes/BlitzMode's resumableEnd — it
    // moved out of main.tsx with the mode screen) and the
    // played increment is not repeated (the guard below). The round-over lock is the component's
    // (!active disables the grid). Distinct from LOCK_REVEAL (no stat) + REVEAL (countedWrong).
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
        canOverrideCorrect: false,
        pendingWrongOverride: null,
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
        canOverrideCorrect: false,
        pendingWrongOverride: null,
        overrideUsedThisQ: false,
        calcOpen: false,
        calcPenaltyActive: false,
        browseHasCredit: false,
        prevStatsSnapshot: null,
        wrongTime: null,
        saveStatsThisQ: null,
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
      }
    }

    // ── OVERRIDE ───────────────────────────────────────────────────────────────
    // The 5-path override (App's most complex function), Classic scope. Only ever
    // dispatched when overrideAvail (Save Stats on + a path armed + not used this Q), so
    // stat updates apply unconditionally here. Paths are checked 1→5; first match wins.
    case 'OVERRIDE': {
      const { useJulian, tracking, timingOff, nextDate, noAdvance } = action
      const correct = correctIndexOf(state.date, useJulian)
      const s0: GameState = { ...state, overrideUsedThisQ: true } // setOverrideUsedThisQ(true) at top

      // PATH 1 — browsing-back: delta-adjust stats for the browsed entry, recalc streak.
      if (state.backDepth > 0 && state.canOverrideCorrect && state.prevStatsSnapshot) {
        const u = state.prevStatsSnapshot
        const newHC = !!u.wasWrong
        const times = [...state.stats.times]
        let stats: Stats
        let persistBtns: Btns
        // The ledger moves with the credit. The card being browsed IS `state.date`, so its share of
        // the pool is the LIVE half — BACK parked the live card's value in forwardStack and loaded
        // this entry's in its place, which is what lets one field serve "whatever card is on screen".
        let liveSolveTime = state.liveSolveTime
        if (u.wasWrong) {
          if (state.wrongTime != null && tracking) {
            times.push(state.wrongTime)
            liveSolveTime = state.wrongTime
          }
          stats = { ...state.stats, good: state.stats.good + 1, times }
          persistBtns = oneBtn(correct, 'correct')
        } else {
          const cut = dropContributedTime(times, u.contributedTime)
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          persistBtns = oneBtn(correct, 'override-wrong')
          liveSolveTime = null //  the credit is gone, so the time leaves the pool AND the card
        }
        const streaks = streaksFromStacks(
          state.stack,
          state.forwardStack,
          newHC,
          state.streakCarry,
          state.bestFloor,
        )
        let curStreak = streaks.curStreak
        let bestStreak = streaks.bestStreak
        // Fold in the live question we backed away from (excluded by streaksFromStacks): a scored
        // miss at the live edge breaks the trailing streak (→ 0); a scored live credit extends it.
        const live = liveStreakContribution(state.forwardStack.find((e) => e.isLive))
        if (live === 'miss') curStreak = 0
        else if (live === 'credit') {
          curStreak += 1
          bestStreak = Math.max(bestStreak, curStreak)
        }
        return {
          ...s0,
          stats: { ...stats, streak: curStreak, best: bestStreak },
          persistBtns,
          browseHasCredit: newHC,
          prevStatsSnapshot: null,
          wrongTime: null,
          canOverrideCorrect: false,
          liveSolveTime,
        }
      }

      // PATH 2 — live first-try-correct reversal: flip the live correct to a miss. At the live edge
      // (backDepth===0) canOverrideCorrect===true ALWAYS implies prevStatsSnapshot.wasWrong===false —
      // a wrong / Reveal / Show Codes clears canOverrideCorrect in the same transition, and the only
      // setter (a first-try correct) snapshots wasWrong:false — so this is only ever a correct→miss
      // reversal. (A former `if (u.wasWrong)` credit branch here was provably unreachable + driven by
      // no test — confirmed static + by a throw surviving a FUZZ_SCALE=30 sweep — and was removed
      // 2026-06-13. The old comment's "wrong-then-right reloaded via Back" never reaches Path 2: a
      // late-correct advances without arming canOverrideCorrect.)
      if (state.canOverrideCorrect && state.prevStatsSnapshot) {
        const u = state.prevStatsSnapshot
        // Drop THIS answer's credit RELATIVE to the live good (good-1) — NOT a restore to the
        // snapshot's u.good, which is stale once a back-browse Path-1 credit raised good after the
        // snapshot was taken: the restore wiped that credit from good while its history entry kept
        // hasCredit=true, so a later streak/best recompute counted the phantom (best>good). Recompute
        // streak/best from history with the now-miss live question (middle=false), mirroring Path
        // 1/3/5; drop the solve time by value. played is unchanged (a miss is still a play). (C1 fuzz
        // fix, 2026-06-07 — the Path-2 twin of the Path-4 stale-snapshot clobber the override-/reveal-
        // heavy + deeper profiles surfaced.)
        const cut = dropContributedTime([...state.stats.times], u.contributedTime)
        const { curStreak, bestStreak } = streaksFromStacks(
          state.stack,
          state.forwardStack,
          false,
          state.streakCarry,
          state.bestFloor,
        )
        const stats: Stats = {
          ...state.stats,
          good: Math.max(0, state.stats.good - 1),
          streak: curStreak,
          best: bestStreak,
          times: cut,
        }
        let s: GameState = {
          ...s0,
          stats,
          // The reversal flips the correct to a MISS → mark the grid 'override-wrong' so the history
          // entry advance() builds isn't counted as a (false) credit (which a later Path-3/5 streak
          // recompute would otherwise inflate past good). Mirrors Path 1's override-wrong. (C2 fuzz
          // fix, 2026-06-06.)
          persistBtns: oneBtn(correct, 'override-wrong'),
          prevStatsSnapshot: null,
          wrongTime: null,
          canOverrideCorrect: false,
          countedWrong: true,
          // `cut` above removed this answer's second from the pool; the card must let go of it in
          // the same transition, or the entry advance() pushes below would still name a time the
          // mean no longer contains.
          liveSolveTime: null,
        }
        // `noAdvance` (AoX): reversing the completing solve fails the run (Allow Mistakes off) —
        // stay on the question instead of advancing, so the component can lock it as failed.
        if (!timingOff && !noAdvance) {
          s = advance(s, { nextDate, useJulian, saved: true })
          if (s.stack.length)
            s = {
              ...s,
              stack: [
                ...s.stack.slice(0, -1),
                { ...s.stack[s.stack.length - 1], overrideUsed: true },
              ],
            }
        } else {
          s = { ...s, locked: false, revealed: false, calcPenaltyActive: false, calcOpen: false }
        }
        return s
      }

      // PATH 3 — override after a wrong / Reveal / Show Codes on this question: give credit,
      // recalc streak, advance.
      if (state.countedWrong) {
        const times = [...state.stats.times]
        // The one number this path can add to the pool, computed once and used three ways: pushed
        // into `times`, written onto the live card's ledger slot, and (in the held branch below)
        // recorded as the snapshot's contributedTime so a later reversal removes exactly it.
        const contributed = state.wrongTime != null && tracking ? state.wrongTime : null
        if (contributed != null) times.push(contributed)
        let s: GameState = {
          ...s0,
          stats: { ...state.stats, good: state.stats.good + 1, times },
          liveSolveTime: contributed,
          wrongTime: null,
          prevStatsSnapshot: null,
          countedWrong: false,
          canOverrideCorrect: false,
          locked: false,
          revealed: false,
          calcPenaltyActive: false,
          calcOpen: false,
        }
        const { curStreak, bestStreak } = streaksFromStacks(
          s.stack,
          s.forwardStack,
          true,
          state.streakCarry,
          state.bestFloor,
        )
        s = { ...s, stats: { ...s.stats, streak: curStreak, best: bestStreak } }
        // `noAdvance` (AoX): when crediting this wrong is the run's COMPLETING solve (good reaches N),
        // HOLD it at the live edge — locked, correct shown, reversible (canOverrideCorrect) — instead
        // of advancing, mirroring ANSWER's `complete` held solve. Otherwise the run completes (the
        // component flips to done) while sitting on a phantom extra question (an Ao10 via Reveal+
        // Override showed Q11). The held credit must be RECONSTRUCTABLE the same way a normal completing
        // solve is — canOverrideCorrect at a SCORED edge (the strong oracle counts a held credit only
        // when canOverrideCorrect && saveStatsThisQ===true) — so set canOverrideCorrect + a wasWrong=
        // false snapshot (= it's a held credit; the snapshot keeps a back/forward round trip + a later
        // reversal consistent). Gated on saveStatsThisQ===true: only a scored question can be a held
        // credit (AoX always tracks, so this IS real AoX's completing override); an unscored noAdvance
        // (only the fuzz produces it) falls through to the normal advance, whose history credit is
        // reconstructable. The streak above (middle=true) already counts this live credit. (C2 fix.)
        if (noAdvance && state.saveStatsThisQ === true) {
          return {
            ...s,
            persistBtns: oneBtn(correct, 'correct'),
            locked: true,
            canOverrideCorrect: true,
            prevStatsSnapshot: snapshot(state.stats, false, contributed),
            pendingWrongOverride: null,
          }
        }
        s = advance(s, { nextDate, useJulian, finalBtns: oneBtn(correct, 'correct'), saved: true })
        if (s.stack.length)
          s = {
            ...s,
            stack: [
              ...s.stack.slice(0, -1),
              { ...s.stack[s.stack.length - 1], overrideUsed: true },
            ],
          }
        return { ...s, pendingWrongOverride: null }
      }

      // PATH 4 — pendingWrongOverride: retroactively credit the PREVIOUS question.
      if (state.pendingWrongOverride != null) {
        const { wrongTime } = state.pendingWrongOverride
        const last = state.stack[state.stack.length - 1]
        // Skip if the target entry is gone OR already credited via back-browse Path 1 (its
        // overrideUsed flag): crediting it again is the Back→override→Forward→override double-credit
        // (good>played). A question is credited AT MOST once. Fix 2026-06-06.
        if (!last || last.overrideUsed) return { ...s0, pendingWrongOverride: null }
        // Credit the previous wrong question on the LIVE stats: good+1, played UNCHANGED (the burn
        // already counted it). The old form restored played/good from the pendingWrongOverride
        // snapshot (snap.good+1), which CLOBBERED any credit earned between the burn and this override
        // — e.g. a back-browse Path-1 credit — so the history's recomputed streak/best ended up ABOVE
        // good (an impossible score). In the immediate case (Path 4 on the very next question, no
        // drift) snap.good+1 == good+1 and the snapshot times-truncation was a no-op, so incrementing
        // the live stats is identical there and stays correct when stats have drifted. (C1 fuzz fix,
        // 2026-06-07 — the streak/best-inflation family the override-/reveal-heavy profiles surfaced.)
        const times = [...state.stats.times]
        const contributed = wrongTime != null && tracking ? wrongTime : null
        if (contributed != null) times.push(contributed)
        const stats = { ...state.stats, good: state.stats.good + 1, times }
        const wd = correctIndexOf(last, useJulian)
        const newStack = [
          ...state.stack.slice(0, -1),
          {
            ...last,
            btns: oneBtn(wd, 'correct'),
            overrideUsed: true,
            hasCredit: true,
            // The credit and the second belong to the SAME card — the previous one — so the ledger
            // write goes on the entry, not on the live half. The fallback keeps a card that somehow
            // already held one (it cannot: this target was burned, and a burn records nothing)
            // rather than silently zeroing a contribution the pool still counts.
            solveTime: contributed ?? last.solveTime ?? null,
          },
        ]
        const { curStreak, bestStreak } = streaksFromStacks(
          newStack,
          state.forwardStack,
          undefined,
          state.streakCarry,
          state.bestFloor,
        )
        let s: GameState = {
          ...s0,
          stats: { ...stats, streak: curStreak, best: bestStreak },
          stack: newStack,
          pendingWrongOverride: null,
        }
        if (!timingOff) {
          s = advance(s, { nextDate, useJulian, saved: true })
          if (s.stack.length)
            s = {
              ...s,
              stack: [
                ...s.stack.slice(0, -1),
                { ...s.stack[s.stack.length - 1], overrideUsed: true },
              ],
            }
        } else {
          // Live Q untouched — re-arm Override for its own future state (mirrors App).
          s = { ...s, overrideUsedThisQ: false }
        }
        return s
      }

      // PATH 5 — retro-override of the most recent history entry, live Q untouched.
      const target = state.stack[state.stack.length - 1]
      const cap = target?.capsule // guarded read: undefined when the stack is empty
      const retroEligible =
        !state.locked &&
        !state.revealed &&
        !state.countedWrong &&
        !state.canOverrideCorrect &&
        state.pendingWrongOverride == null &&
        state.stack.length > 0 &&
        !target.overrideUsed &&
        cap?.snapshot != null
      if (retroEligible && cap && cap.snapshot) {
        const u = cap.snapshot
        const wd = correctIndexOf(target, useJulian)
        const times = [...state.stats.times]
        let stats: Stats
        let newLast: StackEntry
        if (u.wasWrong) {
          const contributed = cap.wrongTime != null && tracking ? cap.wrongTime : null
          if (contributed != null) times.push(contributed)
          stats = { ...state.stats, good: state.stats.good + 1, times }
          newLast = {
            ...target,
            btns: oneBtn(wd, 'correct'),
            overrideUsed: true,
            hasCredit: true,
            solveTime: contributed ?? target.solveTime ?? null,
          }
        } else {
          const cut = dropContributedTime(times, u.contributedTime)
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          newLast = {
            ...target,
            btns: oneBtn(wd, 'override-wrong'),
            overrideUsed: true,
            hasCredit: false,
            solveTime: null, //  `cut` took it out of the pool; the card lets go of it here
          }
        }
        const newStack = [...state.stack.slice(0, -1), newLast]
        const { curStreak, bestStreak } = streaksFromStacks(
          newStack,
          state.forwardStack,
          undefined,
          state.streakCarry,
          state.bestFloor,
        )
        return { ...s0, stats: { ...stats, streak: curStreak, best: bestStreak }, stack: newStack }
      }

      // No path matched (shouldn't happen — overrideAvail gates dispatch). No-op beyond the
      // overrideUsedThisQ flag, matching App's override() falling through.
      return s0
    }

    // ── BACK ───────────────────────────────────────────────────────────────────
    // Step back one history entry. The current view is pushed onto forwardStack (the live
    // question is tagged isLive + carries its full liveState so Forward can restore it).
    case 'BACK': {
      const prev = state.stack[state.stack.length - 1]
      if (!prev) return state
      const fwdHC =
        state.backDepth === 0 ? computeHasCredit(state.persistBtns) : state.browseHasCredit
      const fwdCapsule: Capsule = {
        snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null,
        wrongTime: state.wrongTime,
      }
      const fwdEntry: StackEntry =
        state.backDepth === 0
          ? {
              isLive: true,
              ...state.date,
              btns: { ...state.persistBtns },
              overrideUsed: state.overrideUsedThisQ,
              capsule: fwdCapsule,
              liveState: {
                locked: state.locked,
                revealed: state.revealed,
                countedWrong: state.countedWrong,
                canOverrideCorrect: state.canOverrideCorrect,
                pendingWrongOverride: state.pendingWrongOverride,
                calcPenaltyActive: state.calcPenaltyActive,
                saveStatsFrozen: state.saveStatsThisQ,
              },
              hasCredit: fwdHC,
              solveTime: state.liveSolveTime,
            }
          : {
              ...state.date,
              btns: { ...state.persistBtns },
              overrideUsed: state.overrideUsedThisQ,
              capsule: fwdCapsule,
              hasCredit: fwdHC,
              solveTime: state.liveSolveTime,
            }
      const wasAnswered = prev.btns && Object.keys(prev.btns).length > 0
      const wasRevealed = !!(prev.btns && Object.values(prev.btns).includes('correct'))
      const cap: Partial<Capsule> = prev.capsule || {}
      return {
        ...state,
        calcOpen: false,
        forwardStack: [...state.forwardStack, fwdEntry],
        stack: state.stack.slice(0, -1),
        date: prev,
        persistBtns: wasAnswered ? (prev.btns ?? {}) : {},
        locked: true,
        revealed: wasRevealed,
        countedWrong: false,
        pendingWrongOverride: null,
        calcPenaltyActive: false,
        prevStatsSnapshot: cap.snapshot || null,
        wrongTime: cap.wrongTime ?? null,
        canOverrideCorrect: cap.snapshot != null && !(prev.overrideUsed || false),
        overrideUsedThisQ: prev.overrideUsed || false,
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
      const capsule: Capsule = {
        snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null,
        wrongTime: state.wrongTime,
      }
      const pushed = entryWithGreen(
        {
          ...state.date,
          btns: { ...state.persistBtns },
          overrideUsed: state.overrideUsedThisQ,
          capsule,
          hasCredit: state.browseHasCredit,
          solveTime: state.liveSolveTime,
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
      }
      if (fwd.isLive) {
        const ls: Partial<LiveState> = fwd.liveState || {}
        const fc: Partial<Capsule> = fwd.capsule || {}
        return {
          ...base,
          persistBtns: fwd.btns || {},
          locked: !!ls.locked,
          revealed: !!ls.revealed,
          countedWrong: !!ls.countedWrong,
          canOverrideCorrect: !!ls.canOverrideCorrect,
          pendingWrongOverride: ls.pendingWrongOverride || null,
          calcPenaltyActive: !!ls.calcPenaltyActive,
          overrideUsedThisQ: fwd.overrideUsed || false,
          prevStatsSnapshot: fc.snapshot || null,
          wrongTime: fc.wrongTime ?? null,
          browseHasCredit: fwd.hasCredit ?? false,
          saveStatsThisQ: ls.saveStatsFrozen === undefined ? null : ls.saveStatsFrozen,
        }
      }
      const fwdAnswered = fwd.btns && Object.keys(fwd.btns).length > 0
      const fwdRevealed = !!(fwd.btns && Object.values(fwd.btns).includes('correct'))
      const cap: Partial<Capsule> = fwd.capsule || {}
      return {
        ...base,
        persistBtns: fwdAnswered ? (fwd.btns ?? {}) : {},
        locked: true,
        revealed: fwdRevealed,
        countedWrong: false,
        pendingWrongOverride: null,
        calcPenaltyActive: false,
        prevStatsSnapshot: cap.snapshot || null,
        wrongTime: cap.wrongTime ?? null,
        canOverrideCorrect: cap.snapshot != null && !(fwd.overrideUsed || false),
        overrideUsedThisQ: fwd.overrideUsed || false,
        browseHasCredit: fwd.hasCredit ?? computeHasCredit(fwd.btns),
        saveStatsThisQ: true,
      }
    }

    default:
      return state
  }
}
