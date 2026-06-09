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
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { computeStreaks } from '../../src/engine/streak.js'
import { computeHasCredit } from '../../src/engine/answerButtons.js'

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
    pNoAdvance: 0.2,
  },
  'override-heavy': {
    name: 'override-heavy',
    seedBase: 1_000_000,
    seqs: 4500,
    steps: 320,
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
  'aox-complete-heavy': {
    name: 'aox-complete-heavy',
    seedBase: 2_000_000,
    seqs: 6000,
    steps: 230,
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
    pNoAdvance: 0.1,
  },
  // ── strongOracle profiles (Classic/Deduction surface) ──
  'classic-strict': {
    name: 'classic-strict',
    seedBase: 4_000_000,
    seqs: 5000,
    steps: 300,
    strongOracle: true,
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
    pNoAdvance: 0,
  },
  'deep-history': {
    name: 'deep-history',
    seedBase: 5_000_000,
    seqs: 1500,
    steps: 600,
    strongOracle: true,
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
    pNoAdvance: 0,
  },
  'times-churn': {
    name: 'times-churn',
    seedBase: 6_000_000,
    seqs: 4500,
    steps: 300,
    strongOracle: true,
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
    pNoAdvance: 0,
  },
  // ── AoX-complete strong-oracle profile (C2 Part 1) ──
  // Exercises the AoX action surface — first-try corrects HELD as completing solves (`complete`),
  // their reversal (OVERRIDE `noAdvance`, Path 2), back-browsing AWAY from a held credit, and Show
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
    weights: {
      ANSWER: 6,
      OVERRIDE: 4,
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
    pNoAdvance: 0.4,
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
    weights: {
      ANSWER: 5,
      OVERRIDE: 3,
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
    pNoAdvance: 0,
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
// clean live edge) streak == trailing run. The sequence is the same one the reducer's streaksFromStacks
// walks — back-stack ++ the browsed question ++ the de-reversed non-live forward-stack — PLUS the
// LIVE question's own credit, which the reducer keeps in good/streak separately from the stack:
//   • Not browsing: a HELD live credit (AoX `complete` — a first-try-correct that credited good but
//     STAYED on the question instead of advancing) sits at the live edge, not in the stack. It's
//     flagged by canOverrideCorrect and was scored only if Save Stats was on for it (saveStatsThisQ).
//   • Browsing: the question we backed away from is parked in forwardStack as the isLive entry; the
//     base walk excludes it (filter !isLive) and we fold its true contribution back in at the newest
//     slot via liveCredit — 'credit' → a credit, 'miss' → a played non-credit, null → not played.
// This widens the exact oracle from the no-complete Classic/Deduction surface onto the AoX-complete
// reducer surface (C2 Part 1). It stays OFF for RESET_ROUND/TIMEOUT_MISS profiles — RESET_ROUND keeps
// stats while wiping the history (good != reconstructed by design), and TIMEOUT_MISS can clear
// canOverrideCorrect without un-crediting a held solve; both are unreachable in real AoX play.
//
// liveCredit is re-implemented here (NOT imported from the reducer's liveStreakContribution) so a bug
// in the reducer's own copy makes the two DISAGREE and the oracle catches it — keeping the check a
// genuinely independent cross-reference of the same rule advance() uses to set hasCredit.
function liveCredit(live) {
  if (!live) return null
  const ls = live.liveState
  const btns = live.btns
  const answered = !!btns && Object.keys(btns).length > 0
  if (!answered || !ls || ls.saveStatsFrozen !== true) return null
  return computeHasCredit(btns) && !ls.revealed && !ls.countedWrong ? 'credit' : 'miss'
}
export function checkStrongScoreOracle(state) {
  const v = []
  const s = state.stats
  const stackBools = state.stack.map((e) => !!e.hasCredit)
  const browsing = state.backDepth > 0
  let history
  if (browsing) {
    const fwdBools = state.forwardStack
      .slice()
      .reverse()
      .filter((e) => !e.isLive)
      .map((e) => !!e.hasCredit)
    const lc = liveCredit(state.forwardStack.find((e) => e.isLive))
    const liveBool = lc === 'credit' ? [true] : lc === 'miss' ? [false] : []
    history = [...stackBools, !!state.browseHasCredit, ...fwdBools, ...liveBool]
  } else {
    // A held live credit (canOverrideCorrect at the edge) was counted in good only if Save Stats was
    // on for the question (saveStatsThisQ===true); a complete-while-off neither credits nor pushes.
    const heldLiveCredit = state.canOverrideCorrect && state.saveStatsThisQ === true
    history = heldLiveCredit ? [...stackBools, true] : stackBools
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
    noAdvance: 0,
    reveal: 0,
    maxStack: 0,
    maxTimes: 0,
    heldComplete: 0, // reached a HELD completing solve (locked + canOverrideCorrect at the live edge)
    browsedHeld: 0, //  back-browsed AWAY from a held live credit (the oracle's isLive-fold corner)
    timedTimeout: 0, // fired a LOCK_REVEAL / TIMEOUT_MISS on the active live edge (timed surface)
  }
}

export function runSequence(seed, steps, cov, profile) {
  const rnd = mulberry32(seed)
  const useJulian = chance(rnd, profile.pJulian)
  let state = initEngine(randDate(rnd))
  const recent = []

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
          if (state.backDepth > 0) cov.overrideBrowsing++
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
    if (state.stats.good > 0) cov.good++
    if (state.stack.length > cov.maxStack) cov.maxStack = state.stack.length
    if (state.stats.times.length > cov.maxTimes) cov.maxTimes = state.stats.times.length
    if (kind === 'REVEAL' && !prev.countedWrong && state.countedWrong) cov.reveal++
    // A HELD completing solve at the live edge (locked + reversible) — the AoX-complete corner the
    // extended strong oracle now covers; browsing away from one parks the credit as the isLive entry.
    if (state.backDepth === 0 && state.locked && state.canOverrideCorrect) cov.heldComplete++
    if (kind === 'BACK' && prev.backDepth === 0 && prev.locked && prev.canOverrideCorrect)
      cov.browsedHeld++
    const S = state.stats
    recent.push(
      `${i}:${kind}${saveStats ? '+' : '-'} p${S.played}g${S.good}s${S.streak}b${S.best} bd${state.backDepth} stk${state.stack.length} cw${state.countedWrong ? 1 : 0} coc${state.canOverrideCorrect ? 1 : 0}`,
    )
    if (recent.length > 20) recent.shift()

    const violations = checkGameInvariants(state, useJulian)
    if (profile.strongOracle) violations.push(...checkStrongScoreOracle(state))
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
