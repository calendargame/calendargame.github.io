// ─────────────────────────────────────────────────────────────────────────
// tests/engine/fuzzHarness.js — the shared, importable guts of the fuzz / bug survey.
//
// Extracted from fuzz.test.js so BOTH the vitest suite (fuzz.test.js) and standalone sweep
// scripts can drive the same deterministic generator. The test file is now a thin wrapper that calls
// runFuzzProfile(); a one-time deeper sweep is `FUZZ_SCALE=N npx vitest run tests/engine/fuzz.test.js`
// (N multiplies each profile's sequence count). See fuzz.test.js for the full design notes.
// ─────────────────────────────────────────────────────────────────────────
import {
  gameReducer,
  initEngine,
  calendarOf,
  correctIndexOf,
  effectiveSaveStats,
  overrideTarget,
  overridePlan,
  liveCredited,
  forgetOldestCards,
  regenReplaces,
  waitingDateMissing,
} from '../../src/engine/gameReducer.js'
import { isDeepStrictEqual } from 'node:util'
import { parkedText, restoreParked } from '../../src/engine/parkedHistory.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { deepFreeze } from '../../src/engine/freeze.js'
import { computeStreaks } from '../../src/engine/streak.js'
import { computeHasCredit } from '../../src/engine/answerButtons.js'
import { createRefModel, applyRefModel, compareRefModel } from './referenceModel.js'
import { auditTimesPool } from '../../src/engine/timesPool.js'

// Big-sweep knob: FUZZ_SCALE multiplies every profile's sequence COUNT (not its step length).
export const SCALE = Math.max(1, Math.floor(Number(process.env.FUZZ_SCALE) || 1))
// …and a deep sweep checks EVERY times-pool summary the engine makes against a from-scratch Mean and
// Median (engine/timesPool audits every 64th in the ordinary run).
if (SCALE > 1) auditTimesPool(1)

// Seeded PRNG (mulberry32) — deterministic, so a failing seed reproduces exactly.
export function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const chance = (rnd, p) => rnd() < p

// ── Valid question generators (so nextDate covers every mode's question kind) ──
// ★ THE YEARS STRADDLE THE 1582 REFORM, about four dates in ten before it — where a date has two
// weekdays and the Julian Calendar setting, which the driver switches mid-sequence (pJulianFlip),
// decides which is the answer. That is the ground a card's calendar (CardMeta.jul) is proved on: a
// date drawn under one setting, judged under another, overridden and browsed under a third. `_jul`,
// the setting at the draw, is random on purpose — nothing may judge by it.
// ★ …AND SOME ARE DATES ONLY THE JULIAN CALENDAR HAS — February 29 of a year that is a leap year by
// the Julian rule alone (the list below is the harness's own, written out, not the app's function).
// About one weekday date in twenty-five. The app draws one only with the setting on, so that is the
// draw it records (`_jul: true`); the driver then switches the setting off over it like over any
// other date, and half the time plays the screen's part (the ⚙ panel closing: a waiting date the
// calendar in force lacks is regenerated) and half the time does not (a clock running out behind the
// open panel) — so such a date is judged with the setting off too, and must come out a Julian card.
const JULIAN_ONLY_LEAP_YEARS = [100, 200, 300, 500, 600, 700, 900, 1000, 1100, 1300, 1400, 1500]
const onlyJulianHas = (q) => q.m === 2 && q.d === 29 && JULIAN_ONLY_LEAP_YEARS.includes(q.y)
function randWeekday(rnd) {
  if (rnd() < 0.04)
    return {
      y: JULIAN_ONLY_LEAP_YEARS[Math.floor(rnd() * JULIAN_ONLY_LEAP_YEARS.length)],
      m: 2,
      d: 29,
      _fmt: 'numeric-ymd',
      _jul: true,
    }
  for (;;) {
    const q = {
      y: 1200 + Math.floor(rnd() * 900),
      m: 1 + Math.floor(rnd() * 12),
      d: 1 + Math.floor(rnd() * 28), // 1-28 is valid in every month
      _fmt: 'numeric-ymd',
      _jul: rnd() < 0.5,
    }
    if (!(q.y === 1582 && q.m === 10 && q.d >= 5 && q.d <= 14)) return q // the ten days that never were
  }
}
// A puzzle carries the calendar it was BUILT in — or, one time in four, no record of it (a puzzle
// is then read in the setting at its first judgement, like a weekday date).
const built = (rnd, b) => (rnd() < 0.75 ? { _jul: b._jul } : {})
function randDayPuzzle(rnd) {
  const b = randWeekday(rnd)
  const options = [b.d]
  while (options.length < 4) {
    const o = 1 + Math.floor(rnd() * 28)
    if (!options.includes(o)) options.push(o)
  }
  return { type: 'day', y: b.y, m: b.m, d: b.d, w: 0, options, ...built(rnd, b) }
}
function randYearPuzzle(rnd) {
  const b = randWeekday(rnd)
  return {
    type: 'year',
    y: b.y,
    m: b.m,
    d: b.d,
    w: 0,
    options: [b.y, b.y + 1, b.y + 2, b.y + 3],
    ...built(rnd, b),
  }
}
function randMonthPuzzle(rnd) {
  const b = randWeekday(rnd)
  const other = (b.m % 12) + 1
  return {
    type: 'month',
    y: b.y,
    m: b.m,
    d: b.d,
    w: 0,
    options: ['A', 'B'],
    boxes: [
      { label: 'A', months: [b.m] },
      { label: 'B', months: [other] },
    ],
    ...built(rnd, b),
  }
}
function randDate(rnd) {
  const r = rnd()
  if (r < 0.55) return randWeekday(rnd)
  if (r < 0.7) return randDayPuzzle(rnd)
  if (r < 0.85) return randYearPuzzle(rnd)
  return randMonthPuzzle(rnd)
}
// Number of answer options for the current question (for picking a wrong index).
function optionCount(q) {
  if (q.type === 'month') return q.boxes.length
  if (q.type) return q.options.length
  return 7
}

// WHICH CARD THE ONE BUTTON POINTS AT — a DELIBERATE SECOND COPY of the reducer's overrideTarget,
// written again here from the UI contract rather than imported: the harness gates every OVERRIDE on
// it (so a press is only dispatched when the APP would offer one) and asserts, every step, that it
// agrees with the reducer's own selector — the button's label and the press it makes can never be
// told different stories without a profile failing. Browsing → the browsed card; else a SCORED live
// card that is burned, holds a clean credit on its grid, or is already overridden → the live card; else
// the newest history card; else nothing (the button is dimmed). A card the clock timed out on is never
// the one, wherever it sits — it cannot be overridden, so its place yields nothing.
function harnessTarget(state) {
  if (state.backDepth > 0) return state.card.timedOut ? null : 'browsed'
  // (The grid is read last, and only when the answer still depends on it.)
  const cleanCreditOnGrid = () =>
    !state.revealed && !state.countedWrong && computeHasCredit(state.persistBtns)
  const scored = state.saveStatsThisQ === true && !state.card.timedOut
  if (scored && (state.countedWrong || state.card.answered !== null || cleanCreditOnGrid()))
    return 'live'
  const newest = state.stack[state.stack.length - 1]
  return newest && !newest.meta.timedOut ? 'retro' : null
}
// The hook's gate: the frozen Save-Stats for the card (or the live setting before any stat action).
function overrideAvail(state, saveStats) {
  return effectiveSaveStats(state, saveStats) && harnessTarget(state) !== null
}

// ── Weighting profiles ───────────────────────────────────────────────────────
export const PROFILES = {
  uniform: {
    name: 'uniform',
    seedBase: 1,
    seqs: 5000,
    steps: 250,
    weights: {
      ANSWER: 2,
      NEW: 1,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      BACK: 1,
      FORWARD: 1,
      OVERRIDE: 1,
      RESET: 1,
      REGEN: 1,
      LOCK_REVEAL: 1,
      TIMEOUT_MISS: 1,
      RESET_ROUND: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.8,
    pTracking: 0.5,
    pTimingOff: 0.5,
    pSolveTime: 0.5,
    pAnswerCorrect: 0.5,
    pComplete: 0.2,
    pHold: 0.2,
  },
  'override-heavy': {
    name: 'override-heavy',
    seedBase: 1_000_000,
    seqs: 4500,
    steps: 320,
    weights: {
      ANSWER: 5,
      OVERRIDE: 8,
      BACK: 3,
      FORWARD: 2,
      NEW: 2,
      REVEAL: 2,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      LOCK_REVEAL: 1,
      TIMEOUT_MISS: 1,
      RESET: 1,
      REGEN: 1,
      RESET_ROUND: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.9,
    pTracking: 0.5,
    pTimingOff: 0.5,
    pSolveTime: 0.5,
    pAnswerCorrect: 0.5,
    pComplete: 0.1,
    pHold: 0.1,
  },
  'aox-complete-heavy': {
    name: 'aox-complete-heavy',
    seedBase: 2_000_000,
    seqs: 6000,
    steps: 230,
    weights: {
      ANSWER: 6,
      OVERRIDE: 6,
      NEW: 2,
      BACK: 2,
      FORWARD: 1,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
      RESET_ROUND: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.2,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.8,
    pComplete: 0.7,
    pHold: 0.7,
  },
  'reveal-heavy': {
    name: 'reveal-heavy',
    seedBase: 3_000_000,
    seqs: 4500,
    steps: 300,
    weights: {
      REVEAL: 4,
      SHOW_CODES_OPEN: 3,
      NEW: 3,
      BACK: 3,
      OVERRIDE: 3,
      FORWARD: 2,
      TIMEOUT_MISS: 2,
      LOCK_REVEAL: 2,
      ANSWER: 2,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
      RESET_ROUND: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.5,
    pTimingOff: 0.5,
    pSolveTime: 0.5,
    pAnswerCorrect: 0.5,
    pComplete: 0.05,
    pHold: 0.1,
  },
  // ── strongOracle profiles (Classic/Deduction surface) ──
  'classic-strict': {
    name: 'classic-strict',
    seedBase: 4_000_000,
    seqs: 5000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    weights: {
      ANSWER: 4,
      OVERRIDE: 4,
      BACK: 3,
      FORWARD: 2,
      NEW: 2,
      REVEAL: 2,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.5,
    pTimingOff: 0.5,
    pSolveTime: 0.5,
    pAnswerCorrect: 0.5,
    pComplete: 0,
    pHold: 0,
  },
  'deep-history': {
    name: 'deep-history',
    seedBase: 5_000_000,
    seqs: 1500,
    steps: 600,
    strongOracle: true,
    pHydrate: 0.5,
    weights: {
      ANSWER: 5,
      NEW: 4,
      BACK: 4,
      OVERRIDE: 3,
      FORWARD: 3,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.92,
    pTracking: 0.5,
    pTimingOff: 0.5,
    pSolveTime: 0.5,
    pAnswerCorrect: 0.6,
    pComplete: 0,
    pHold: 0,
  },
  'times-churn': {
    name: 'times-churn',
    seedBase: 6_000_000,
    seqs: 4500,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    weights: {
      ANSWER: 5,
      OVERRIDE: 4,
      NEW: 3,
      BACK: 3,
      FORWARD: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.9,
    pTracking: 0.8,
    pTimingOff: 0.5,
    pSolveTime: 0.9,
    pAnswerCorrect: 0.55,
    pComplete: 0,
    pHold: 0,
  },
  // ── AoX-complete strong-oracle profile ──
  // Exercises the AoX action surface — first-try corrects HELD as completing solves (`complete`),
  // the Override on them (taking the held credit away, and crediting a burned card with `hold` —
  // MoX's completing solve via Override), back-browsing AWAY from a held credit, and Show
  // Codes / Reveal on a held credit — under the now-extended EXACT oracle. Excludes TIMEOUT_MISS +
  // RESET_ROUND (oracle-incompatible — RESET_ROUND keeps stats while wiping history) AND LOCK_REVEAL:
  // AoX's lockReveal fires ONLY after a WRONG answer (never a `complete`), so complete→LOCK_REVEAL is
  // unreachable; modeling it would only inject that artifact, and a reachable wrong→lockReveal is
  // stat-identical to the wrong ANSWER this profile already covers. High pAnswerCorrect + pComplete
  // make held-credit edges frequent.
  'aox-strong': {
    name: 'aox-strong',
    seedBase: 7_000_000,
    seqs: 5000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    weights: {
      ANSWER: 6,
      OVERRIDE: 6,
      BACK: 3,
      FORWARD: 2,
      NEW: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.5,
    pTimingOff: 0.3,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.7,
    pComplete: 0.5,
    pHold: 0.4,
  },
  // ── Timed-mode strong-oracle profile ──
  // The Blitz per-round / per-question surface = the Classic engine PLUS the two timeout actions
  // (LOCK_REVEAL = per-round timeout, no stat; TIMEOUT_MISS = per-question miss). Those are gated to
  // the active live edge (see runSequence), so the EXACT oracle stays valid. No `complete` (Flash/Blitz
  // never hold a solve) and no RESET_ROUND (it keeps stats while wiping history — oracle-incompatible;
  // it's the timed modes' "Reset", separately exercised by the inequality profiles). This exact-checks
  // that the timeout actions never desync good/best/streak in combination with the override/history
  // machinery. (Flash's scoring surface IS Classic's — already covered by classic-strict et al.)
  'timed-strong': {
    name: 'timed-strong',
    seedBase: 8_000_000,
    seqs: 5000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    weights: {
      ANSWER: 5,
      OVERRIDE: 5,
      LOCK_REVEAL: 3,
      TIMEOUT_MISS: 3,
      NEW: 3,
      BACK: 3,
      FORWARD: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.4,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.55,
    pComplete: 0,
    pHold: 0,
  },
  // ── referenceModel profiles ──
  // Run the fully-INDEPENDENT reference score model (referenceModel.js) in lockstep with the
  // reducer — a second implementation of the scoring contract compared field-by-field after every
  // action (played/good/times/best + clean-edge streak; `played` has no other exact oracle). The
  // strong oracle runs alongside (layered nets). Same exclusions as the strong profiles:
  // RESET_ROUND keeps stats while wiping history — underivable from a question ledger by design.
  'ref-classic': {
    name: 'ref-classic',
    seedBase: 9_000_000,
    seqs: 4000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    referenceModel: true,
    weights: {
      ANSWER: 5,
      OVERRIDE: 6,
      BACK: 3,
      FORWARD: 2,
      NEW: 3,
      REVEAL: 2,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.5,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.55,
    pComplete: 0,
    pHold: 0,
  },
  // The full reducer surface: the AoX held-complete corner + both timed timeouts, under the model.
  'ref-full': {
    name: 'ref-full',
    seedBase: 10_000_000,
    seqs: 4000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    referenceModel: true,
    weights: {
      ANSWER: 5,
      OVERRIDE: 6,
      BACK: 3,
      FORWARD: 2,
      NEW: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      LOCK_REVEAL: 2,
      TIMEOUT_MISS: 2,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.4,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.65,
    pComplete: 0.35,
    pHold: 0.35,
  },
  // ── Override ⇄ Undo toggle churn (round 23) ──
  // The button is a permanent per-card toggle, so OVERRIDE dominates the stream — every press lands
  // on the card the button points at, flipping it one way or the other — with enough Back / Forward
  // between presses to toggle cards deep in the history, and enough ANSWER / NEW / REVEAL / Show
  // Codes to keep making new cards of every kind (credited, burned, revealed, held). Under the
  // strong oracle AND the independent reference model, whose toggle is a single bit on a question it
  // stores as-answered — no shared mechanism with the reducer's two materialised states. The Blitz
  // timeouts ride along (a pristine timeout is the one scored card the button skips). RESET_ROUND
  // stays out for the reason every oracle profile excludes it.
  'toggle-churn': {
    name: 'toggle-churn',
    seedBase: 11_000_000,
    seqs: 4000,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    referenceModel: true,
    weights: {
      OVERRIDE: 8,
      BACK: 3,
      FORWARD: 3,
      ANSWER: 3,
      NEW: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      LOCK_REVEAL: 1,
      TIMEOUT_MISS: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.4,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.6,
    pComplete: 0.35,
    pHold: 0.35,
  },
  // ── The restore round trip (store/sessionHistory) ──
  // A casual mode's history is parked when its screen is about to go away — a reload, a preset
  // switch, an Amnesic interlude — and restored when the screen comes back. These profiles restore
  // mid-play, often, on the casual surface (no RESET_ROUND and no timeouts: Classic/Deduction/Flash
  // never send them), hydrated half the time — and demand the restored state be the state parked,
  // under the exact oracle and, in the first, the independent reference model too. Half the restores
  // (pRestoreRegen) then apply the LIVE-QUESTION RULE's regeneration, exactly as a screen whose
  // timing is shown does at mount (modes/modeHooks' restoredEngine): the one REGEN_DATE action, on a
  // state that may have come back browsed to an earlier card. The second profile forgets the oldest
  // cards before some restores, as the size budget does, over long sequences where the history is
  // deep enough to cut.
  'reload-ref': {
    name: 'reload-ref',
    seedBase: 12_000_000,
    seqs: 2500,
    steps: 300,
    strongOracle: true,
    pHydrate: 0.5,
    referenceModel: true,
    pReload: 0.08,
    pRestoreRegen: 0.5,
    weights: {
      ANSWER: 5,
      OVERRIDE: 5,
      BACK: 3,
      FORWARD: 2,
      NEW: 3,
      REVEAL: 2,
      SHOW_CODES_OPEN: 2,
      SHOW_CODES_CLOSE: 1,
      RESET: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.85,
    pTracking: 0.6,
    pTimingOff: 0.5,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.55,
    pComplete: 0,
    pHold: 0,
  },
  'reload-trim': {
    name: 'reload-trim',
    seedBase: 13_000_000,
    seqs: 1200,
    steps: 500,
    strongOracle: true,
    pHydrate: 0.5,
    pReload: 0.05,
    pRestoreRegen: 0.5,
    pTrim: 0.5,
    weights: {
      ANSWER: 5,
      NEW: 3,
      OVERRIDE: 4,
      BACK: 3,
      FORWARD: 2,
      REVEAL: 1,
      SHOW_CODES_OPEN: 1,
      SHOW_CODES_CLOSE: 1,
      REGEN: 1,
    },
    pJulian: 0.3,
    pSaveStats: 0.9,
    pTracking: 0.6,
    pTimingOff: 0.4,
    pSolveTime: 0.6,
    pAnswerCorrect: 0.6,
    pComplete: 0,
    pHold: 0,
  },
}

// How often, per step, the Julian Calendar setting is switched. Often enough that most sequences
// judge, override and browse cards under a setting unlike the one they were first judged in.
const P_JULIAN_FLIP = 0.06
// …and how often a switch is followed by the SCREEN's rule — the ⚙ panel closing, where Classic and
// Flash regenerate a waiting date the calendar now in force does not have (modes/modeHooks'
// useDateSettingsOnRegen). The rest of the time the date stays and may be judged as it stands.
const P_PANEL_CLOSES = 0.5

// Weighted pick of one action kind.
function pickKind(rnd, weights) {
  let total = 0
  for (const k in weights) total += weights[k]
  let r = rnd() * total
  for (const k in weights) {
    r -= weights[k]
    if (r < 0) return k
  }
  for (const k in weights) return k
}

// ── The STRONG, EXACT score oracle (strongOracle profiles only) ────────────────────────────────
// Reconstructs the chronological credit sequence INDEPENDENTLY of the reducer's incrementally-
// maintained good/streak/best, then cross-checks good == credits, best == longest run, and (at a
// clean live edge) streak == trailing run. The sequence walks the same cards the reducer's
// creditSequence does — back-stack ++ the browsed question ++ the de-reversed non-live forward-stack —
// PLUS the LIVE question's own credit, re-derived here rather than read from any reducer helper:
//   • Not browsing: a HELD live credit (AoX `complete`, or a crediting Override that held — a
//     credit that STAYED on the question instead of advancing) sits at the live edge, not in the
//     stack. It is re-derived from the grid and the two flags (a green with no red, not revealed,
//     not burned), and was scored only if Save Stats was on for it (saveStatsThisQ).
//   • Browsing: the question we backed away from is parked in forwardStack as the isLive entry; the
//     base walk excludes it (filter !isLive) and we fold its true contribution back in at the newest
//     slot via liveCredit — 'credit' → a credit, 'miss' → a played non-credit, null → not played.
// This widens the exact oracle from the no-complete Classic/Deduction surface onto the AoX-complete
// reducer surface. It stays OFF for the RESET_ROUND profiles — RESET_ROUND keeps stats
// while wiping the history (good != reconstructed by design).
//
// liveCredit / heldLiveCredit are re-implemented here (NOT imported from the reducer's liveCredited /
// creditSequence) so a bug in the reducer's own copy makes the two DISAGREE and the oracle catches it
// — keeping the check a genuinely independent cross-reference of the same rule advance() uses to set
// hasCredit.
function liveCredit(live) {
  if (!live) return null
  const ls = live.liveState
  const btns = live.btns
  const answered = !!btns && Object.keys(btns).length > 0
  if (!answered || !ls || ls.saveStatsFrozen !== true) return null
  return computeHasCredit(btns) && !ls.revealed && !ls.countedWrong ? 'credit' : 'miss'
}
// ⚠ BUILT WITH PLAIN LOOPS, ONE LIST, ONE STREAK WALK — the same list, in the same order, that a
// chain of slice / reverse / filter / map and four spreads used to build after every action. Those
// are not checks, and here they are not cheap either: every array of a state is frozen (engine/
// freeze), and the array methods leave their fast path on a frozen array (`slice` on a frozen
// hundred-card history measured about ninety times slower than on a plain one, Node 24). The
// forward stack is read from its end, so its cards arrive oldest first, and the isLive entry met
// LAST on that walk is the lowest-indexed one — the one `find` returned.
export function checkStrongScoreOracle(state, priorHistory = []) {
  const v = []
  const s = state.stats
  const browsing = state.backDepth > 0
  // The hydrated prior-session credit flags, prepended to the reconstruction (the in-session stack
  // can't reach them). The oracle prepends the REAL prior history — independently re-deriving the
  // reducer's bestFloor/streakCarry from it — so a wrong fold collapses good/best/streak and is caught
  // here. Empty for a blank/timed start → byte-identical to before.
  const history = priorHistory.slice()
  for (let i = 0; i < state.stack.length; i++) history.push(!!state.stack[i].hasCredit)
  if (browsing) {
    history.push(!!state.browseHasCredit)
    let parkedLive
    for (let i = state.forwardStack.length - 1; i >= 0; i--) {
      const e = state.forwardStack[i]
      if (e.isLive) parkedLive = e
      else history.push(!!e.hasCredit)
    }
    const lc = liveCredit(parkedLive)
    if (lc !== null) history.push(lc === 'credit')
  } else if (
    // A held live credit (a clean green on the grid at the edge) was counted in good only if Save
    // Stats was on for the question (saveStatsThisQ===true); a complete-while-off neither credits
    // nor pushes.
    computeHasCredit(state.persistBtns) &&
    !state.revealed &&
    !state.countedWrong &&
    state.saveStatsThisQ === true
  )
    history.push(true)

  let credits = 0
  for (let i = 0; i < history.length; i++) if (history[i]) credits++
  if (s.good !== credits) v.push(`STRONG good(${s.good}) != reconstructed credits(${credits})`)

  const { curStreak, bestStreak } = computeStreaks(history)
  if (s.best !== bestStreak) v.push(`STRONG best(${s.best}) != history best(${bestStreak})`)

  // Clean live edge only (not browsing, not a pending miss): the trailing run == streak. A held-
  // credit edge IS clean (it ends in a credit), and `history` already carries that credit.
  if (!browsing && !state.countedWrong && !state.revealed && s.streak !== curStreak)
    v.push(`STRONG streak(${s.streak}) != trailing(${curStreak})`)
  return v
}

// Fresh coverage counters.
export function freshCov() {
  return {
    good: 0,
    override: 0,
    overrideBrowsing: 0,
    back: 0,
    deduction: 0,
    complete: 0,
    hold: 0, //         OVERRIDE dispatched with `hold`
    reveal: 0,
    maxStack: 0,
    maxTimes: 0,
    heldComplete: 0, // reached a HELD credit at the live edge (locked + a clean credit on the grid)
    liveHold: 0, //     a crediting Override that HELD on the live card (vs the ANSWER-complete hold)
    browsedHeld: 0, //  back-browsed AWAY from a held live credit (the oracle's isLive-fold corner)
    timedTimeout: 0, // fired a LOCK_REVEAL / TIMEOUT_MISS on the active live edge (timed surface)
    refChecks: 0, //   reference-model comparisons performed (referenceModel profiles)
    julianFlips: 0, // the Julian Calendar setting switched mid-sequence
    crossJudged: 0, // a card judged AGAIN (or overridden) with the setting unlike its own calendar
    twoDayAnswers: 0, // an answer on a date whose two calendars name different weekdays
    julianOnlyJudgedOff: 0, // a date only the Julian calendar has, first judged with the setting OFF
    missingRegens: 0, // a waiting date the calendar in force lacks, regenerated by the screen's rule
    legacyRestores: 0, // a restore of the state as an OLDER build would have parked it (no calendars)
    legacyCrossed: 0, //  …an overridden card in one, its Override mark on the other calendar's day
    toggleBack: 0, //  an Undo — a press on a card that was already overridden (O → A)
    toggleDeep: 0, //  a press on a card browsed two or more deep
    retoggle: 0, //    the same card pressed three times running (consecutive presses hit one card)
    hydrated: 0, //    sequences seeded with a prior-session baseline (the hydration net)
    timedOutBehind: 0, // a timed-out card was the one the button would otherwise mean (history tail / browsed)
    reloads: 0, //     parked + restored mid-sequence (engine/parkedHistory's restore round trip)
    reloadsDeep: 0, // …while browsed back, i.e. with the live card parked as the isLive forward entry
    forgotten: 0, //   …after forgetting some of the oldest cards (forgetOldestCards, the size budget)
    restoreRegen: 0, // a restore whose live question was then REGENERATED (the live-question rule)
    restoreKept: 0, //  …and one whose live question was USED, so the same question came back
    regenBrowsing: 0, // a regen that replaced the live question while it waited in the forward stack
  }
}

// The LIVE question: the one on screen at the live edge, and the `isLive` entry at the bottom of the
// forward stack while browsing — the reference model's live slot either way.
const liveQuestion = (state) => (state.backDepth > 0 ? state.forwardStack[0] : state.date)

// THE REDUCER'S CARDS AS THE REFERENCE MODEL COMPARES THEM — read off the state here, by the
// harness's own walk (never the reducer's forEachCard): the history in play order (the cards behind
// the one on screen, the browsed card, the non-live cards parked ahead of it, oldest first) and the
// live card. Each is something with a `meta` (the card's record, whose `jul` is its calendar) and a
// `btns` (the grid it shows), and compareRefModel reads those two and nothing else of it.
// ⚠ A history entry IS such a thing, so it is handed over AS IT IS — the entry object itself, not a
// copy made for the comparison. Only the card on screen, which the state keeps as two fields, is
// put together here. That is one small object per comparison where there was one per card, and it
// is what lets the comparison know a card it has already held to its question (referenceModel's
// compareCalendar: the very same frozen grid object). Plain loops for the reason
// checkStrongScoreOracle gives; the isLive entry met last, walking the forward stack from its end,
// is the one `find` returned.
function refCards(state) {
  const browsing = state.backDepth > 0
  const onScreen = { meta: state.card, btns: state.persistBtns }
  const history = []
  for (let i = 0; i < state.stack.length; i++) history.push(state.stack[i])
  let parkedLive
  if (browsing) {
    history.push(onScreen)
    for (let i = state.forwardStack.length - 1; i >= 0; i--) {
      const e = state.forwardStack[i]
      if (e.isLive) parkedLive = e
      else history.push(e)
    }
  }
  return { history, live: browsing ? parkedLive : onScreen }
}

// ── A STATE AS AN OLDER BUILD WOULD HAVE PARKED IT ──────────────────────────────────────────────
// ⏰ TEMPORARY, with the door's stamping it tests: removed in the release that turns sealing on and
// deletes `SEAL_NEW_SILOS` (src/store/progressStorage.ts) — engine/parkedEngine's header says why.
//
// Builds up to v2.27.3 park in the same slots and stamp no calendar on a card. `asOlderBuild` is
// this state as they would have left it: every stamp gone, and — for about half the overridden
// cards on a date whose two calendars name different days — the Override's own mark sitting on the
// OTHER calendar's day, which is where that build put it when the setting had been switched between
// the answer and the press (it marked the answer of the setting at the press). The restore door
// (engine/parkedEngine) must give every judged card a calendar again, one that can never contradict
// the card's own green, and put a crossed Override mark back on the card's own answer. What the fuzz
// can demand of each card, and does (legacyRestoreBreaks), by the grid AS THE PLAYER LEFT IT (the
// grid, or an overridden card's stored as-answered grid):
//   • it marks an answer, or it marks exactly one of the two calendars' answers WRONG: wherever the
//     calendars name DIFFERENT answers, the calendar that comes back is the original, exactly — and
//     so is the card's grid, a crossed Override mark included;
//   • it says neither (a live date holding wrong picks that are neither calendar's answer), and the
//     card is overridden: the Override's mark is all there is, so the card comes back in the calendar
//     that mark names — the original's, or the other one when the mark was crossed — grid untouched;
//   • it says neither, and the card is not overridden: the calendar it was drawn under — nothing on
//     the card says more (and a date only the Julian calendar has was drawn under that one);
//   • wherever the two calendars name the same answer, either calendar is right — the green cannot
//     be wrong.
const stripCalendar = ({ jul: _jul, ...meta }) => meta
const isAnswerMark = (v) => v === 'correct' || v === 'override-wrong'
const isWrongMark = (v) => v === 'wrong' || v === 'wrong-latest' || v === 'wrong-prev'
const marksAnAnswer = (btns) => Object.values(btns ?? {}).some(isAnswerMark)
const twoDays = (q) => !q.type && correctIndexOf(q, true) !== correctIndexOf(q, false)
function asOlderBuild(s, rnd) {
  const crossed = new Set()
  const card = (where, q, btns, meta) => {
    const marks = Object.keys(btns ?? {})
    let grid = btns
    if (meta.answered && twoDays(q) && marks.length === 1 && rnd() < 0.5) {
      const other = correctIndexOf(q, !meta.jul)
      grid = { [other]: btns[marks[0]] }
      crossed.add(where)
    }
    return { btns: grid, meta: stripCalendar(meta) }
  }
  const onScreen = card('the card on screen', s.date, s.persistBtns, s.card)
  return {
    crossed,
    state: {
      ...s,
      card: onScreen.meta,
      persistBtns: onScreen.btns,
      stack: s.stack.map((e, i) => ({ ...e, ...card(`stack[${i}]`, e, e.btns, e.meta) })),
      forwardStack: s.forwardStack.map((e, i) => ({
        ...e,
        ...card(`forwardStack[${i}]`, e, e.btns, e.meta),
      })),
    },
  }
}
function legacyRestoreBreaks(state, crossed, back, useJulian) {
  if (!back) return ['LEGACY RESTORE: refused a state an older build could have parked']
  const v = checkGameInvariants(back, useJulian)
  const check = (where, q, was, btns, now, nowBtns) => {
    if (was.jul === undefined) {
      if (now.jul !== undefined) v.push(`LEGACY RESTORE: ${where} was never judged, now stamped`)
      return
    }
    const left = was.answered ? was.answered.btns : btns
    const J = correctIndexOf(q, true)
    const G = correctIndexOf(q, false)
    const says =
      marksAnAnswer(left) || (twoDays(q) && isWrongMark(left[J]) !== isWrongMark(left[G]))
    const cross = crossed.has(where)
    if (twoDays(q) && (says || was.answered)) {
      const expected = says || !cross || onlyJulianHas(q) ? was.jul : !was.jul
      if (now.jul !== expected)
        v.push(`LEGACY RESTORE: ${where} came back in the wrong calendar (${was.jul} → ${now.jul})`)
      if (says && !isDeepStrictEqual(nowBtns, btns))
        v.push(`LEGACY RESTORE: ${where} did not come back with the grid this build gave it`)
    } else if (!says && !was.answered) {
      if (now.jul !== (onlyJulianHas(q) || (q._jul ?? useJulian)))
        v.push(`LEGACY RESTORE: ${where} says nothing, and is not in its drawn calendar`)
    }
  }
  state.stack.forEach((e, i) =>
    check(`stack[${i}]`, e, e.meta, e.btns, back.stack[i].meta, back.stack[i].btns),
  )
  state.forwardStack.forEach((e, i) =>
    check(
      `forwardStack[${i}]`,
      e,
      e.meta,
      e.btns,
      back.forwardStack[i].meta,
      back.forwardStack[i].btns,
    ),
  )
  check(
    'the card on screen',
    state.date,
    state.card,
    state.persistBtns,
    back.card,
    back.persistBtns,
  )
  return v
}

// ── THE LAST FEW ACTIONS, FOR A FAILURE'S REPORT ────────────────────────────────────────────────
// What a failing sequence prints under "recent actions": one line per action, the newest twenty.
// Kept as the NUMBERS each line is made of, in a ring written over in place, and turned into text
// only by a sequence that fails (`lines`). It used to be the text itself, built after every action
// of every sequence — ten numbers formatted into a string some seventeen million times a run, for a
// report a green run never prints: measured at about a quarter of the whole survey's time, and
// none of it a check. The lines read exactly as they did.
const TRAIL_ACTIONS = 20
const TRAIL_FIELDS = 10
function startTrail() {
  const kinds = new Array(TRAIL_ACTIONS)
  const nums = new Array(TRAIL_ACTIONS * TRAIL_FIELDS).fill(0)
  let noted = 0
  return {
    note(step, kind, saveStats, state) {
      const slot = noted++ % TRAIL_ACTIONS
      const at = slot * TRAIL_FIELDS
      const S = state.stats
      kinds[slot] = kind
      nums[at] = step
      nums[at + 1] = saveStats ? 1 : 0
      nums[at + 2] = S.played
      nums[at + 3] = S.good
      nums[at + 4] = S.streak
      nums[at + 5] = S.best
      nums[at + 6] = state.backDepth
      nums[at + 7] = state.stack.length
      nums[at + 8] = state.countedWrong ? 1 : 0
      nums[at + 9] = state.card.answered !== null ? 1 : 0
    },
    // Oldest first.
    lines() {
      const out = []
      for (let k = Math.max(0, noted - TRAIL_ACTIONS); k < noted; k++) {
        const slot = k % TRAIL_ACTIONS
        const n = (f) => nums[slot * TRAIL_FIELDS + f]
        out.push(
          `${n(0)}:${kinds[slot]}${n(1) ? '+' : '-'} p${n(2)}g${n(3)}s${n(4)}b${n(5)} bd${n(6)} stk${n(7)} cw${n(8)} ov${n(9)}`,
        )
      }
      return out
    },
  }
}

export function runSequence(seed, steps, cov, profile) {
  const rnd = mulberry32(seed)
  // The Julian Calendar setting — where it starts, and (below) switched at any step, as a player
  // switches it in the ⚙ menu with a date on screen.
  let useJulian = chance(rnd, profile.pJulian)
  // Hydrated start (the hydration net): with prob pHydrate, seed initEngine with a prior-session
  // baseline — lifetime stats the in-session stack CANNOT reconstruct (a continuous mode hydrates stats
  // but not the history behind them). This is what exercises the override bestFloor/streakCarry fold —
  // the blind spot that hid the owner-reported best/streak-collapse bug. priorHistory = the prior
  // per-question credit flags; priorTimes = one solve time per prior credit (a distinct >=10 range, so
  // a reproduce dump shows at a glance which seconds were carried in — the engine no longer cares:
  // a toggle moves a time by its card's slot, never by its value). The derived baseline satisfies
  // every invariant (good<=played, streak/best<=good, times.length<=good). RESET clears it (the engine
  // re-inits blank), so the oracle's prepended prefix is dropped in lockstep.
  let priorHistory = []
  const priorTimes = []
  let initialStats
  if (profile.pHydrate && chance(rnd, profile.pHydrate)) {
    const n = Math.floor(rnd() * 25)
    for (let i = 0; i < n; i++) priorHistory.push(rnd() < 0.6)
    for (const c of priorHistory) if (c) priorTimes.push(rnd() * 3 + 10)
    const { curStreak, bestStreak } = computeStreaks(priorHistory)
    initialStats = {
      played: n,
      good: priorHistory.filter(Boolean).length,
      streak: curStreak,
      best: bestStreak,
      times: [...priorTimes],
    }
    cov.hydrated++
  }
  // ★ EVERY STATE IS FROZEN, ALL THE WAY DOWN, BEFORE THE NEXT ACTION IS APPLIED TO IT (engine/freeze)
  // — the first one here, and below every state the reducer returns, every restored one and every
  // one with its oldest cards forgotten. So a reducer case, the restore door or forgetOldestCards
  // that wrote into a state it was handed — instead of returning new objects — throws at that line,
  // in whichever profile first reaches it. engine/invariants remembers which history cards have
  // passed its calendar tripwires by object identity, which is sound only if no card is ever changed
  // in place; this is what holds the engine to that. (Incremental: a state shares almost everything
  // with the frozen one before it, so freezing it costs what the transition made.)
  let state = deepFreeze(initEngine(randDate(rnd), initialStats))
  // The independent reference model — replays the same action stream and is compared
  // field-by-field after every action. Seeded with the only display facts it consumes: whether the
  // initial question is a Deduction puzzle (and, per ANSWER, whether the click was correct), plus the
  // hydrated baseline above (folded into its derived stats, never browsed/overridden).
  const model = profile.referenceModel ? createRefModel(state.date, priorHistory, priorTimes) : null
  const trail = startTrail()
  // Consecutive OVERRIDE dispatches. Consecutive presses always land on ONE card — a press that
  // stays leaves the button on the same card, and the one that advances leaves it on the card just
  // pushed — so a run of three is the same card flipped three times.
  let pressRun = 0
  // ★ A STATE THAT HAS PASSED IS NOT ASKED THE SAME QUESTIONS AGAIN. Three of the checks made after
  // every action read nothing but the state, the Julian Calendar setting, and the prior history: the
  // engine's invariants, "the button and the press agree", and the exact score oracle. An action the
  // reducer answers by handing back the state it was given — Back with nothing behind, an answer
  // on a locked card, a regeneration of a question already used: one dispatched action in four
  // (3.9 million of the survey's 15.5 million, counted) — leaves all three inputs exactly as they
  // were when those checks last passed, and the state is FROZEN, so it is not merely the same
  // object: nothing in it can have changed. Running them again could only return what they
  // returned. So they run when any of the three is not the one that last passed, and never
  // otherwise (the three `passed…` below; the prior history is replaced, never written into, so
  // its identity is its content too).
  // The reference model is NOT one of them, and is compared after every action without exception:
  // the model is told about the action whatever the reducer did with it, so "the reducer did
  // nothing and the model did something" is precisely a disagreement that has to be seen.
  let passedState = null
  let passedUnderJulian = false
  let passedPrior = null

  for (let i = 0; i < steps; i++) {
    if (chance(rnd, P_JULIAN_FLIP)) {
      useJulian = !useJulian
      cov.julianFlips++
      // The screen's half of the switch (see P_PANEL_CLOSES): the one REGEN_DATE, asked for exactly
      // when the engine says the waiting date is one the calendar in force does not have.
      if (chance(rnd, P_PANEL_CLOSES) && waitingDateMissing(state, useJulian)) {
        state = deepFreeze(gameReducer(state, { type: 'REGEN_DATE', nextDate: randDate(rnd) }))
        if (model) applyRefModel(model, 'REGEN', null, { liveAfter: liveQuestion(state) })
        cov.missingRegens++
      }
    }
    // THE RELOAD (round 23): with prob pReload, the state goes through exactly what a reload does
    // to a casual mode — parked as the app parks it (engine/parkedHistory's parkedText, the times left
    // out), JSON and all, then restored over its own stats as the app restores it (restoreParked: the
    // one engine restore door, then the stats-agree and invariant checks). A reachable state must
    // come back, and come back EXACTLY; the oracle and the reference model then carry on against the
    // restored state as if nothing happened, which is the claim. With prob pTrim it first forgets
    // some of its oldest cards, as the size budget does — the forgotten credits join the oracle's
    // prior history, which is precisely what the engine claims forgetting them means (the reference
    // model keeps every question it saw, so the trimming profile runs without one).
    if (profile.pReload && chance(rnd, profile.pReload)) {
      if (profile.pTrim && state.stack.length && chance(rnd, profile.pTrim)) {
        const k = 1 + Math.floor(rnd() * state.stack.length)
        priorHistory = [...priorHistory, ...state.stack.slice(0, k).map((e) => !!e.hasCredit)]
        state = deepFreeze(forgetOldestCards(state, k))
        cov.forgotten++
      }
      const back = restoreParked(
        JSON.parse(parkedText(state, { config: '' })),
        state.stats,
        useJulian,
        'classic',
      )
      const same = back && isDeepStrictEqual(back.engine, JSON.parse(JSON.stringify(state)))
      if (!same)
        return {
          ok: false,
          profile: profile.name,
          seed,
          step: i,
          violations: [
            back ? 'RELOAD: the restored state differs' : 'RELOAD: refused a real state',
          ],
          action: 'RELOAD',
          prevStats: state.stats,
          nowStats: back?.engine.stats,
          recent: trail.lines(),
        }
      state = deepFreeze(back.engine)
      cov.reloads++
      if (state.backDepth > 0) cov.reloadsDeep++
      // …AND AS AN OLDER BUILD WOULD HAVE PARKED IT: the same state with no calendar on any card,
      // and some Override marks on the other calendar's day (asOlderBuild), goes through the same
      // door, and what comes back is held to legacyRestoreBreaks (above).
      // Play then carries on from the state this build parked.
      const older = asOlderBuild(state, rnd)
      const legacy = restoreParked(
        JSON.parse(parkedText(older.state, { config: '' })),
        state.stats,
        useJulian,
        'classic',
      )
      const legacyBreaks = legacyRestoreBreaks(state, older.crossed, legacy?.engine, useJulian)
      cov.legacyRestores++
      cov.legacyCrossed += older.crossed.size
      if (legacyBreaks.length)
        return {
          ok: false,
          profile: profile.name,
          seed,
          step: i,
          violations: legacyBreaks,
          action: 'LEGACY RESTORE',
          prevStats: state.stats,
          nowStats: legacy?.engine.stats,
          recent: trail.lines(),
        }
      // THE LIVE-QUESTION RULE: a screen whose timing is shown regenerates the restored live question
      // (one REGEN_DATE, exactly as modes/modeHooks' restoredEngine dispatches it) — which swaps an
      // UNUSED question, wherever it sits, and keeps a used one. Nothing scored may move either way,
      // so the oracle, the reference model and every invariant are held to the result at once.
      // The same action is the rule for a restored date the calendar now in force does not have —
      // whatever the timing says (restoredEngine asks waitingDateMissing too).
      const timingShown = profile.pRestoreRegen && chance(rnd, profile.pRestoreRegen)
      if (timingShown || waitingDateMissing(state, useJulian)) {
        if (!timingShown) cov.missingRegens++
        const before = state
        state = deepFreeze(gameReducer(state, { type: 'REGEN_DATE', nextDate: randDate(rnd) }))
        if (state === before) cov.restoreKept++
        else {
          cov.restoreRegen++
          if (state.backDepth > 0) cov.regenBrowsing++
        }
        if (model) applyRefModel(model, 'REGEN', null, { liveAfter: liveQuestion(state) })
        const broken = [
          ...checkGameInvariants(state, useJulian),
          ...(state.stats === before.stats ? [] : ['RESTORE REGEN: the stats moved']),
          ...(profile.strongOracle ? checkStrongScoreOracle(state, priorHistory) : []),
          ...(model ? compareRefModel(model, state, overridePlan(state), refCards(state)) : []),
        ]
        if (broken.length)
          return {
            ok: false,
            profile: profile.name,
            seed,
            step: i,
            violations: broken,
            action: 'RESTORE REGEN',
            prevStats: before.stats,
            nowStats: state.stats,
            recent: trail.lines(),
          }
      }
    }
    const saveStats = chance(rnd, profile.pSaveStats)
    const tracking = chance(rnd, profile.pTracking)
    const timingOff = chance(rnd, profile.pTimingOff)
    const nextDate = randDate(rnd)
    const kind = pickKind(rnd, profile.weights)
    const t = () => (chance(rnd, profile.pSolveTime) ? rnd() * 3 : null)
    let action = null

    switch (kind) {
      case 'ANSWER': {
        // Which option to click — the right one in the card's calendar most of the time, else any
        // (on a date with two weekdays that is sometimes the OTHER calendar's answer, which must
        // count as wrong). Only a choice of input: whether it IS right is the reducer's to decide
        // and the reference model's to decide again, each for itself.
        const corr = correctIndexOf(state.date, calendarOf(state.card, state.date, useJulian))
        const idx = chance(rnd, profile.pAnswerCorrect)
          ? corr
          : Math.floor(rnd() * optionCount(state.date))
        if (
          !state.date.type &&
          correctIndexOf(state.date, true) !== correctIndexOf(state.date, false)
        )
          cov.twoDayAnswers++
        const elapsed = t()
        const complete = chance(rnd, profile.pComplete)
        action = {
          type: 'ANSWER',
          idx,
          useJulian,
          elapsed,
          tracking,
          saveStats,
          nextDate,
          complete,
        }
        if (complete) cov.complete++
        break
      }
      case 'NEW':
        action = { type: 'NEW', nextDate, useJulian, saveStats }
        break
      case 'REVEAL':
        action = { type: 'REVEAL', useJulian, elapsed: t(), saveStats }
        break
      case 'SHOW_CODES_OPEN':
        action = { type: 'SHOW_CODES', open: true, useJulian, elapsed: t(), saveStats }
        break
      case 'SHOW_CODES_CLOSE':
        action = { type: 'SHOW_CODES', open: false, useJulian, elapsed: null, saveStats }
        break
      case 'BACK':
        action = { type: 'BACK' }
        break
      case 'FORWARD':
        action = { type: 'FORWARD', useJulian }
        break
      case 'OVERRIDE':
        if (overrideAvail(state, saveStats)) {
          const hold = chance(rnd, profile.pHold)
          action = { type: 'OVERRIDE', useJulian, tracking, nextDate, hold }
          cov.override++
          if (hold) cov.hold++
          if (state.backDepth > 0) cov.overrideBrowsing++
          if (state.backDepth >= 2) cov.toggleDeep++
          if (overridePlan(state).overridden) cov.toggleBack++
        }
        break
      case 'RESET':
        action = { type: 'RESET', timingOff, nextDate }
        break
      case 'REGEN':
        action = { type: 'REGEN_DATE', nextDate }
        break
      case 'LOCK_REVEAL':
        // A timed-mode timeout (Blitz per-round) fires only on the ACTIVE live question — never while
        // browsing back and never on an already-locked/ended question. Gating it to that reachable
        // edge keeps the action stream faithful AND keeps the strong oracle valid on the timed surface
        // (a timeout mid-browse is an unreachable artifact). Coverage counter proves it still fires.
        if (state.backDepth === 0 && !state.locked) {
          action = { type: 'LOCK_REVEAL', useJulian }
          cov.timedTimeout++
        }
        break
      case 'TIMEOUT_MISS':
        // Blitz per-question (sudden-death) timeout — same reachability as LOCK_REVEAL.
        if (state.backDepth === 0 && !state.locked) {
          action = { type: 'TIMEOUT_MISS', useJulian, saveStats }
          cov.timedTimeout++
        }
        break
      case 'RESET_ROUND':
        action = { type: 'RESET_ROUND' }
        break
    }

    if (!action) continue
    // A card that already has its calendar, acted on with the setting now saying the other one.
    if ('useJulian' in action && state.card.jul !== undefined && state.card.jul !== useJulian)
      cov.crossJudged++
    const unjudgedJulianOnly =
      !useJulian &&
      state.backDepth === 0 &&
      state.card.jul === undefined &&
      !state.date.type &&
      onlyJulianHas(state.date)
    if (kind === 'BACK' && state.stack.length) cov.back++
    if (state.date.type) cov.deduction++
    const prev = state
    state = deepFreeze(gameReducer(state, action))
    // A full RESET re-inits the engine blank (bestFloor/streakCarry → 0), so the hydrated prefix is
    // gone — drop it for the oracle in lockstep with the model's own RESET clear (referenceModel.js).
    // (priorTimes feeds only createRefModel at seed time + the model clears its own copy, so the oracle
    // side just needs priorHistory cleared here.)
    if (action.type === 'RESET') priorHistory = []
    // Reference model: apply the same action with its exogenous DISPLAY facts — the incoming
    // question (`next`, for plain advances) and the LIVE question afterwards (`liveAfter` — on
    // screen, or waiting in the forward stack — for the view-ruled RESET/REGEN keep-vs-replace).
    // Whether an ANSWER is right is the model's own to work out. See referenceModel.js for the
    // independence boundary.
    if (model) {
      applyRefModel(model, kind, action, {
        next: action.nextDate,
        liveAfter: liveQuestion(state),
      })
      cov.refChecks++
    }
    if (kind === 'REGEN' && state !== prev && state.backDepth > 0) cov.regenBrowsing++
    // The card that was on screen has now been judged — it stayed (stamped), or went into history.
    if (
      unjudgedJulianOnly &&
      (state.questionId === prev.questionId
        ? state.backDepth === 0 && state.card.jul !== undefined
        : state.stack.length > prev.stack.length)
    )
      cov.julianOnlyJudgedOff++
    if (state.stats.good > 0) cov.good++
    if (state.stack.length > cov.maxStack) cov.maxStack = state.stack.length
    if (state.stats.times.length > cov.maxTimes) cov.maxTimes = state.stats.times.length
    if (kind === 'REVEAL' && !prev.countedWrong && state.countedWrong) cov.reveal++
    // A HELD completing solve at the live edge (locked + reversible) — the AoX-complete corner the
    // extended strong oracle now covers; browsing away from one parks the credit as the isLive entry.
    if (state.backDepth === 0 && state.locked && liveCredited(state)) cov.heldComplete++
    // The crediting Override that HELD on the live card specifically (a burned, scored card credited
    // with `hold`, still on screen afterwards). cov.heldComplete alone conflates this with the
    // ANSWER-complete hold (identical end state); this proves the override branch is actually
    // reached, not just the answer one. (F7 coverage-gap fix.)
    if (
      action.type === 'OVERRIDE' &&
      action.hold &&
      prev.backDepth === 0 &&
      prev.countedWrong &&
      prev.saveStatsThisQ === true &&
      state.questionId === prev.questionId &&
      liveCredited(state)
    )
      cov.liveHold++
    if (kind === 'BACK' && prev.backDepth === 0 && prev.locked && liveCredited(prev))
      cov.browsedHeld++
    if (
      state.backDepth > 0 ? state.card.timedOut : state.stack[state.stack.length - 1]?.meta.timedOut
    )
      cov.timedOutBehind++
    pressRun = action.type === 'OVERRIDE' ? pressRun + 1 : 0
    if (pressRun === 3) cov.retoggle++
    trail.note(i, kind, saveStats, state)

    const violations = []
    const asked =
      passedState === state && passedUnderJulian === useJulian && passedPrior === priorHistory
    if (!asked) {
      violations.push(...checkGameInvariants(state, useJulian))
      // The button and the press agree: the harness's own reading of which card the button points
      // at must be the reducer's, every step — so "Override is offered" ⇔ "there is a card to
      // toggle" (overrideAvail ⇔ overrideTarget !== null under the same Save-Stats gate).
      const ht = harnessTarget(state)
      if (ht !== overrideTarget(state))
        violations.push(`TARGET: harness ${ht}, reducer ${overrideTarget(state)}`)
      if (profile.strongOracle) violations.push(...checkStrongScoreOracle(state, priorHistory))
      if (!violations.length) {
        passedState = state
        passedUnderJulian = useJulian
        passedPrior = priorHistory
      }
    }
    // What a screen is TOLD a regeneration will do is what the reducer then did: regenReplaces is
    // asked before the dispatch (Flash ends its flash on the answer), so it must never disagree with
    // whether REGEN_DATE replaced the waiting question.
    if (action.type === 'REGEN_DATE' && regenReplaces(prev) !== (state !== prev))
      violations.push(`REGEN: regenReplaces said ${regenReplaces(prev)}, the reducer disagreed`)
    if (model)
      violations.push(...compareRefModel(model, state, overridePlan(state), refCards(state)))
    if (violations.length) {
      return {
        ok: false,
        profile: profile.name,
        seed,
        step: i,
        violations,
        action,
        prevStats: prev.stats,
        nowStats: state.stats,
        recent: trail.lines(),
      }
    }
  }
  return { ok: true }
}

// Run every sequence of a profile; throw (with a reproduce line) on the first invariant violation.
export function runFuzzProfile(name) {
  const profile = PROFILES[name]
  const cov = freshCov()
  const seqs = profile.seqs * SCALE
  for (let i = 0; i < seqs; i++) {
    const seed = profile.seedBase + i
    const r = runSequence(seed, profile.steps, cov, profile)
    if (!r.ok) {
      throw new Error(
        `INVARIANT VIOLATED — profile ${r.profile}, seed ${r.seed}, step ${r.step}:\n` +
          `  ${r.violations.join('\n  ')}\n` +
          `  action:   ${JSON.stringify(r.action)}\n` +
          `  stats before: ${JSON.stringify(r.prevStats)}\n` +
          `  stats after:  ${JSON.stringify(r.nowStats)}\n` +
          `  recent actions (oldest→newest):\n    ${r.recent.join('\n    ')}\n` +
          `  reproduce: runSequence(${r.seed}, ${r.step + 1}, freshCov(), PROFILES['${r.profile}'])`,
      )
    }
  }
  return cov
}
