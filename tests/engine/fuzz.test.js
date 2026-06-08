// ─────────────────────────────────────────────────────────────────────────
// tests/engine/fuzz.test.js — the C2 fuzz / bug survey, EXPANDED in C1 (the giant bug pass).
//
// Drives the shared game reducer through MILLIONS of random-but-valid action sequences, covering
// every mode's action pattern and every settings toggle mid-play, and after EVERY action asserts
// the engine's invariants (engine/invariants.ts) still hold. This is two things at once:
//   1. A BUG HUNT — any impossible score (good>played, …) or desynced history fails the test with
//      a reproducible {profile, seed, step}.
//   2. The VALIDATION that the production tripwires never false-fire — if any invariant fired during
//      correct play, it would fail HERE first, so a green run proves the tripwires are safe to ship.
//
// ── C1 expansion (2026-06-07): WEIGHTING PROFILES ──
// The original survey used ONE uniform action distribution, which under-samples the rare COMPOUND
// sequences where the C2 score bugs actually lived (e.g. burn-a-question-without-credit → advance →
// back-browse → Override, which inflated streak/best past good). Uniform weighting reaches such
// corners only by luck. So the survey now runs FOUR profiles, each a weighted action table + flag
// probabilities, sharing one `runSequence`:
//   • uniform           — the original even distribution (keeps the broad, unbiased corpus).
//   • override-heavy     — biases OVERRIDE *and* the actions that arm it (ANSWER/REVEAL/SHOW_CODES/
//                          BACK) over deeper histories → hammers all 5 Override paths + back-browse.
//   • aox-complete-heavy — biases ANSWER.complete + OVERRIDE.noAdvance with timing ON → the AoX run-
//                          completion corner (credit the Nth solve without advancing, then reverse it).
//   • reveal-heavy       — biases the "clean correct on the grid WITHOUT credit" seeds (REVEAL /
//                          Show Codes / LOCK_REVEAL / TIMEOUT_MISS) then NEW+BACK+OVERRIDE → the exact
//                          false-credit family the C2 fuzz first caught.
// Each profile asserts PROFILE-SPECIFIC coverage (e.g. aox-complete must actually fire `complete`
// answers AND `noAdvance` overrides) so a profile can never pass by silently never reaching its corner.
//
// Coverage: weekday questions AND all three Deduction puzzle kinds (day/month/year) as nextDate; the
// full action set incl. the timed-mode actions (LOCK_REVEAL / TIMEOUT_MISS / RESET_ROUND) and the
// AoX flags (ANSWER.complete / OVERRIDE.noAdvance); Save Stats, timing, and tracking toggled per
// action (where the C3 score bugs lived); calendar (useJulian) fixed per sequence. OVERRIDE is gated
// on the SAME availability check the hook uses (engine/useGameEngine overrideAvail), so we exercise
// the real 5 paths, not the no-op fall-through.
//
// Deterministic seeds ⇒ any failure reproduces exactly (the failure prints the profile + seed + step).
// KEPT as a permanent CI regression net (an upgrade over the prior throwaway survey — justified now
// the invariants are a real shared module).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  gameReducer,
  initEngine,
  correctIndexOf,
  effectiveSaveStats,
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'

// Seeded PRNG (mulberry32) — deterministic, so a failing seed reproduces exactly.
function mulberry32(a) {
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

// Replicate the hook's overrideAvail gate so OVERRIDE is only dispatched when the APP would dispatch
// it — exercising the real 5 paths instead of the no-op fall-through.
function overrideAvail(state, saveStats) {
  const last = state.stack[state.stack.length - 1]
  const retro =
    !state.locked &&
    !state.revealed &&
    !state.countedWrong &&
    !state.canOverrideCorrect &&
    state.pendingWrongOverride == null &&
    !!last &&
    !last.overrideUsed &&
    last.capsule?.snapshot != null
  return (
    effectiveSaveStats(state, saveStats) &&
    (state.countedWrong ||
      state.canOverrideCorrect ||
      (state.pendingWrongOverride != null && !last?.overrideUsed) ||
      retro) &&
    !state.overrideUsedThisQ
  )
}

// ── Weighting profiles ───────────────────────────────────────────────────────
// Each profile is a weighted action table (only listed kinds can be picked; an omitted kind has
// weight 0) plus the per-action flag probabilities. `seedBase` keeps each profile's seeds in their
// own range so a reproduce line is unambiguous. The flag knobs (p*) tune how often each impure input
// lands true; uniform's values are the original survey's, so it stays the unbiased baseline.
const PROFILES = {
  // The original even distribution — broad, unbiased coverage of the whole action space.
  uniform: {
    name: 'uniform',
    seedBase: 1,
    seqs: 5000,
    steps: 200,
    weights: {
      ANSWER: 2, // answering is the most common action
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
    pNoAdvance: 0.2,
  },
  // Hammer the Override engine: bias OVERRIDE and the actions that ARM it (answer/reveal/show-codes
  // to set canOverrideCorrect / countedWrong / pendingWrongOverride) and BACK (to reach the back-
  // browse Path 1 + retro Path 5 targets) over deeper histories. Save Stats stays mostly ON so the
  // override gate is usually open.
  'override-heavy': {
    name: 'override-heavy',
    seedBase: 1_000_000,
    seqs: 5000,
    steps: 250,
    weights: {
      ANSWER: 5,
      OVERRIDE: 5,
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
    pNoAdvance: 0.1,
  },
  // The AoX run-completion corner: credit the Nth/last solve WITHOUT advancing (ANSWER.complete on a
  // correct first try), then reverse it via Override Path 2 with noAdvance (fails the run). Needs
  // answers mostly correct (so the complete branch fires), timing usually ON (so the !timingOff &&
  // !noAdvance distinction in Path 2 is live), and Save Stats mostly ON (so Override is available).
  // LOCK_REVEAL / TIMEOUT_MISS are omitted — AoX has no countdown, so it never dispatches them (the
  // other profiles cover those); keeping this profile faithful to AoX's real action surface.
  'aox-complete-heavy': {
    name: 'aox-complete-heavy',
    seedBase: 2_000_000,
    seqs: 6000,
    steps: 200,
    weights: {
      ANSWER: 6,
      OVERRIDE: 4,
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
    pNoAdvance: 0.7,
  },
  // The false-credit family: bias the actions that leave a clean 'correct' on the grid WITHOUT
  // crediting good (REVEAL / Show Codes / LOCK_REVEAL / TIMEOUT_MISS), then NEW (push the burned
  // entry into history), BACK (browse to it), and OVERRIDE (try to inflate streak/best past good).
  'reveal-heavy': {
    name: 'reveal-heavy',
    seedBase: 3_000_000,
    seqs: 5000,
    steps: 250,
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
    pNoAdvance: 0.1,
  },
}

// Weighted pick of one action kind. Both loops iterate `weights` in insertion order (string keys ⇒
// deterministic), so the same seed always yields the same kind.
function pickKind(rnd, weights) {
  let total = 0
  for (const k in weights) total += weights[k]
  let r = rnd() * total
  for (const k in weights) {
    r -= weights[k]
    if (r < 0) return k
  }
  for (const k in weights) return k // floating-point fall-through guard
}

// Fresh coverage counters. `good/override/back/deduction` prove the survey isn't trivial; the rest
// prove each focused profile actually reached its target corner (asserted per-profile below).
function freshCov() {
  return {
    good: 0, //            a credit was ever earned
    override: 0, //        an OVERRIDE actually dispatched (gate was open)
    overrideBrowsing: 0, // an OVERRIDE dispatched while browsing back (Path 1 territory)
    back: 0, //            a BACK stepped into real history
    deduction: 0, //       a Deduction puzzle was the live question
    complete: 0, //        an ANSWER carried the AoX `complete` flag
    noAdvance: 0, //       an OVERRIDE carried the AoX `noAdvance` flag
    reveal: 0, //          a REVEAL actually burned the live question
  }
}

function runSequence(seed, steps, cov, profile) {
  const rnd = mulberry32(seed)
  const useJulian = chance(rnd, profile.pJulian) // calendar setting — fixed per sequence
  let state = initEngine(randDate(rnd))
  const recent = []

  for (let i = 0; i < steps; i++) {
    const saveStats = chance(rnd, profile.pSaveStats)
    const tracking = chance(rnd, profile.pTracking)
    const timingOff = chance(rnd, profile.pTimingOff)
    const nextDate = randDate(rnd)
    const kind = pickKind(rnd, profile.weights)
    const t = () => (chance(rnd, profile.pSolveTime) ? rnd() * 3 : null) // a random solve time, or null
    let action = null

    switch (kind) {
      case 'ANSWER': {
        const corr = correctIndexOf(state.date, useJulian)
        const idx = chance(rnd, profile.pAnswerCorrect)
          ? corr
          : Math.floor(rnd() * optionCount(state.date))
        const elapsed = t()
        const complete = chance(rnd, profile.pComplete) // AoX completing-solve
        action = { type: 'ANSWER', idx, useJulian, elapsed, tracking, saveStats, nextDate, complete }
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
          const noAdvance = chance(rnd, profile.pNoAdvance)
          action = { type: 'OVERRIDE', useJulian, tracking, timingOff, nextDate, noAdvance }
          cov.override++
          if (noAdvance) cov.noAdvance++
          if (state.backDepth > 0) cov.overrideBrowsing++ // Path 1 (back-browse) territory
        }
        break
      case 'RESET':
        action = { type: 'RESET', timingOff, nextDate }
        break
      case 'REGEN':
        action = { type: 'REGEN_DATE', nextDate }
        break
      case 'LOCK_REVEAL':
        action = { type: 'LOCK_REVEAL', useJulian }
        break
      case 'TIMEOUT_MISS':
        action = { type: 'TIMEOUT_MISS', useJulian, saveStats }
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
    if (state.stats.good > 0) cov.good++
    // A REVEAL that flipped the live question from un-burned to burned = a genuine "clean correct on
    // the grid without credit" seed (the reveal-heavy profile's target).
    if (kind === 'REVEAL' && !prev.countedWrong && state.countedWrong) cov.reveal++
    const S = state.stats
    recent.push(
      `${i}:${kind}${saveStats ? '+' : '-'} p${S.played}g${S.good}s${S.streak}b${S.best} bd${state.backDepth} stk${state.stack.length} cw${state.countedWrong ? 1 : 0} coc${state.canOverrideCorrect ? 1 : 0}`,
    )
    if (recent.length > 20) recent.shift()

    const violations = checkGameInvariants(state, useJulian)
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
// Returns the accumulated coverage so the caller can assert the profile reached its target corner.
function runFuzzProfile(name) {
  const profile = PROFILES[name]
  const cov = freshCov()
  for (let i = 0; i < profile.seqs; i++) {
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

describe('fuzz / bug survey — engine invariants hold across random play (C1/C2)', () => {
  // The broad, unbiased baseline — no invariant may ever break across the whole action space.
  it('uniform — survives a large unbiased corpus with ZERO invariant violations', () => {
    const cov = runFuzzProfile('uniform')
    // Prove the survey wasn't vacuous — it actually exercised credits, the override paths,
    // back-browsing, and Deduction puzzles (not just trivial no-ops).
    expect(cov.good).toBeGreaterThan(0)
    expect(cov.override).toBeGreaterThan(0)
    expect(cov.back).toBeGreaterThan(0)
    expect(cov.deduction).toBeGreaterThan(0)
  })

  // Override-heavy — the back-browse / 5-path Override score-integrity family over deep histories.
  it('override-heavy — survives biased Override play with ZERO invariant violations', () => {
    const cov = runFuzzProfile('override-heavy')
    expect(cov.override).toBeGreaterThan(0)
    expect(cov.overrideBrowsing).toBeGreaterThan(0) // reached back-browse Override (Path 1)
    expect(cov.back).toBeGreaterThan(0)
  })

  // AoX-complete-heavy — credit the Nth solve without advancing, then reverse it (run fails).
  it('aox-complete-heavy — survives biased AoX-completion play with ZERO invariant violations', () => {
    const cov = runFuzzProfile('aox-complete-heavy')
    expect(cov.complete).toBeGreaterThan(0) // actually fired ANSWER.complete
    expect(cov.noAdvance).toBeGreaterThan(0) // actually fired OVERRIDE.noAdvance
    expect(cov.override).toBeGreaterThan(0)
  })

  // Reveal-heavy — the "clean correct without credit" seeds, then back-browse + Override to inflate.
  it('reveal-heavy — survives biased burn-then-override play with ZERO invariant violations', () => {
    const cov = runFuzzProfile('reveal-heavy')
    expect(cov.reveal).toBeGreaterThan(0) // actually burned questions via Reveal
    expect(cov.override).toBeGreaterThan(0)
    expect(cov.overrideBrowsing).toBeGreaterThan(0) // back-browse Override after the burns
  })
})
