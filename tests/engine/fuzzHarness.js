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
  correctIndexOf,
  effectiveSaveStats,
  overrideTarget,
  overridePlan,
  liveCredited,
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { computeStreaks } from '../../src/engine/streak.js'
import { computeHasCredit } from '../../src/engine/answerButtons.js'
import { createRefModel, applyRefModel, compareRefModel } from './referenceModel.js'

// Big-sweep knob: FUZZ_SCALE multiplies every profile's sequence COUNT (not its step length).
export const SCALE = Math.max(1, Math.floor(Number(process.env.FUZZ_SCALE) || 1))

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
function randWeekday(rnd) {
  return {
    y: 1700 + Math.floor(rnd() * 400),
    m: 1 + Math.floor(rnd() * 12),
    d: 1 + Math.floor(rnd() * 28), // 1-28 is valid in every month
    _fmt: 'numeric-ymd',
    _jul: false,
  }
}
function randDayPuzzle(rnd) {
  const b = randWeekday(rnd)
  const options = [b.d]
  while (options.length < 4) {
    const o = 1 + Math.floor(rnd() * 28)
    if (!options.includes(o)) options.push(o)
  }
  return { type: 'day', y: b.y, m: b.m, d: b.d, w: 0, options }
}
function randYearPuzzle(rnd) {
  const b = randWeekday(rnd)
  return { type: 'year', y: b.y, m: b.m, d: b.d, w: 0, options: [b.y, b.y + 1, b.y + 2, b.y + 3] }
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
// the newest history card; else nothing (the button is dimmed).
function harnessTarget(state) {
  if (state.backDepth > 0) return 'browsed'
  const cleanCreditOnGrid =
    computeHasCredit(state.persistBtns) && !state.revealed && !state.countedWrong
  const scored = state.saveStatsThisQ === true
  if (scored && (state.countedWrong || cleanCreditOnGrid || state.card.answered !== null))
    return 'live'
  return state.stack.length > 0 ? 'retro' : null
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
  // ── AoX-complete strong-oracle profile (C2 Part 1) ──
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
  // ── Timed-mode strong-oracle profile (C2 Part 1) ──
  // The Blitz per-round / per-question surface = the Classic engine PLUS the two timeout actions
  // (LOCK_REVEAL = per-round timeout, no stat; TIMEOUT_MISS = per-question miss). Those are gated to
  // the active live edge (see runSequence), so the EXACT oracle stays valid. No `complete` (Blitz/Flash
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
  // ── referenceModel profiles (C2 Part 3) ──
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
  // ── Override ⇄ Undo toggle churn (round 23 Q6) ──
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
}

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
// reducer surface (C2 Part 1). It stays OFF for the RESET_ROUND profiles — RESET_ROUND keeps stats
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
export function checkStrongScoreOracle(state, priorHistory = []) {
  const v = []
  const s = state.stats
  const stackBools = state.stack.map((e) => !!e.hasCredit)
  const browsing = state.backDepth > 0
  // The hydrated prior-session credit flags, prepended to the reconstruction (the in-session stack
  // can't reach them). The oracle prepends the REAL prior history — independently re-deriving the
  // reducer's bestFloor/streakCarry from it — so a wrong fold collapses good/best/streak and is caught
  // here. Empty for a blank/timed start → byte-identical to before.
  let history
  if (browsing) {
    const fwdBools = state.forwardStack
      .slice()
      .reverse()
      .filter((e) => !e.isLive)
      .map((e) => !!e.hasCredit)
    const lc = liveCredit(state.forwardStack.find((e) => e.isLive))
    const liveBool = lc === 'credit' ? [true] : lc === 'miss' ? [false] : []
    history = [...priorHistory, ...stackBools, !!state.browseHasCredit, ...fwdBools, ...liveBool]
  } else {
    // A held live credit (a clean green on the grid at the edge) was counted in good only if Save
    // Stats was on for the question (saveStatsThisQ===true); a complete-while-off neither credits
    // nor pushes.
    const heldLiveCredit =
      computeHasCredit(state.persistBtns) &&
      !state.revealed &&
      !state.countedWrong &&
      state.saveStatsThisQ === true
    history = heldLiveCredit
      ? [...priorHistory, ...stackBools, true]
      : [...priorHistory, ...stackBools]
  }

  const credits = history.filter(Boolean).length
  if (s.good !== credits) v.push(`STRONG good(${s.good}) != reconstructed credits(${credits})`)

  const { bestStreak } = computeStreaks(history)
  if (s.best !== bestStreak) v.push(`STRONG best(${s.best}) != history best(${bestStreak})`)

  // Clean live edge only (not browsing, not a pending miss): the trailing run == streak. A held-
  // credit edge IS clean (it ends in a credit), and `history` already carries that credit.
  if (!browsing && !state.countedWrong && !state.revealed) {
    const { curStreak } = computeStreaks(history)
    if (s.streak !== curStreak) v.push(`STRONG streak(${s.streak}) != trailing(${curStreak})`)
  }
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
    toggleBack: 0, //  an Undo — a press on a card that was already overridden (O → A)
    toggleDeep: 0, //  a press on a card browsed two or more deep
    retoggle: 0, //    the same card pressed three times running (consecutive presses hit one card)
    hydrated: 0, //    sequences seeded with a prior-session baseline (the hydration net)
  }
}

export function runSequence(seed, steps, cov, profile) {
  const rnd = mulberry32(seed)
  const useJulian = chance(rnd, profile.pJulian)
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
  let state = initEngine(randDate(rnd), initialStats)
  // The independent reference model (C2 Part 3) — replays the same action stream and is compared
  // field-by-field after every action. Seeded with the only display facts it consumes: whether the
  // initial question is a Deduction puzzle (and, per ANSWER, whether the click was correct), plus the
  // hydrated baseline above (folded into its derived stats, never browsed/overridden).
  const model = profile.referenceModel
    ? createRefModel(!!state.date.type, priorHistory, priorTimes)
    : null
  const recent = []
  // Consecutive OVERRIDE dispatches. Consecutive presses always land on ONE card — a press that
  // stays leaves the button on the same card, and the one that advances leaves it on the card just
  // pushed — so a run of three is the same card flipped three times.
  let pressRun = 0

  for (let i = 0; i < steps; i++) {
    const saveStats = chance(rnd, profile.pSaveStats)
    const tracking = chance(rnd, profile.pTracking)
    const timingOff = chance(rnd, profile.pTimingOff)
    const nextDate = randDate(rnd)
    const kind = pickKind(rnd, profile.weights)
    const t = () => (chance(rnd, profile.pSolveTime) ? rnd() * 3 : null)
    let action = null

    switch (kind) {
      case 'ANSWER': {
        const corr = correctIndexOf(state.date, useJulian)
        const idx = chance(rnd, profile.pAnswerCorrect)
          ? corr
          : Math.floor(rnd() * optionCount(state.date))
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
    if (kind === 'BACK' && state.stack.length) cov.back++
    if (state.date.type) cov.deduction++
    const prev = state
    state = gameReducer(state, action)
    // A full RESET re-inits the engine blank (bestFloor/streakCarry → 0), so the hydrated prefix is
    // gone — drop it for the oracle in lockstep with the model's own RESET clear (referenceModel.js).
    // (priorTimes feeds only createRefModel at seed time + the model clears its own copy, so the oracle
    // side just needs priorHistory cleared here.)
    if (action.type === 'RESET') priorHistory = []
    // Reference model: apply the same action with its exogenous DISPLAY facts — isCorrect from the
    // PRE-action question (the one the user acted on), and the on-screen question kind before/after
    // (nextDed for plain advances; liveDedAfter for the view-ruled RESET/REGEN keep-vs-replace).
    // See referenceModel.js for the independence boundary.
    if (model) {
      applyRefModel(model, kind, action, {
        isCorrect:
          action.type === 'ANSWER' ? action.idx === correctIndexOf(prev.date, useJulian) : null,
        nextDed: action.nextDate ? !!action.nextDate.type : undefined,
        liveDedAfter: !!state.date.type,
      })
      cov.refChecks++
    }
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
    pressRun = action.type === 'OVERRIDE' ? pressRun + 1 : 0
    if (pressRun === 3) cov.retoggle++
    const S = state.stats
    recent.push(
      `${i}:${kind}${saveStats ? '+' : '-'} p${S.played}g${S.good}s${S.streak}b${S.best} bd${state.backDepth} stk${state.stack.length} cw${state.countedWrong ? 1 : 0} ov${state.card.answered !== null ? 1 : 0}`,
    )
    if (recent.length > 20) recent.shift()

    const violations = checkGameInvariants(state, useJulian)
    // The button and the press agree: the harness's own reading of which card the button points at
    // must be the reducer's, every step — so "Override is offered" ⇔ "there is a card to toggle"
    // (overrideAvail ⇔ overrideTarget !== null under the same Save-Stats gate).
    const ht = harnessTarget(state)
    if (ht !== overrideTarget(state))
      violations.push(`TARGET: harness ${ht}, reducer ${overrideTarget(state)}`)
    if (profile.strongOracle) violations.push(...checkStrongScoreOracle(state, priorHistory))
    if (model) violations.push(...compareRefModel(model, state, overridePlan(state)))
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
        recent,
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
