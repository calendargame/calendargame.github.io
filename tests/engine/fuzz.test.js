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
// The deterministic generator + the weighting profiles + the strong score oracle now live in the
// importable harness (tests/engine/fuzzHarness.js) so standalone sweep/debug scripts share them.
// This file just runs each profile and asserts profile-specific COVERAGE (so a profile can never pass
// by silently never reaching its target corner).
//
// ── WEIGHTING PROFILES (C1) ──
// The original survey used ONE uniform action distribution, which under-samples the rare COMPOUND
// sequences where the C2 score bugs lived. So the survey runs WEIGHTED profiles, each a weighted
// action table + flag probabilities, sharing one runSequence:
//   • uniform           — the original even distribution (broad, unbiased corpus).
//   • override-heavy     — biases OVERRIDE + the actions that make cards to toggle + BACK → every
//                          card the button can point at (browsed, live, retro), both directions.
//   • aox-complete-heavy — biases ANSWER.complete + OVERRIDE.hold → the AoX run-completion corner.
//   • reveal-heavy       — biases the "clean correct on the grid WITHOUT credit" seeds → the false-
//                          credit family the C2 fuzz first caught.
//
// ── STRONG oracle + extra profiles + a sweep knob (C1 deeper pass, EXTENDED in C2) ──
// The checks above are INEQUALITIES (good≤played, streak/best/times≤good): they catch IMPOSSIBLE
// states but not "merely WRONG" ones. So the strongOracle profiles add an EXACT oracle
// (checkStrongScoreOracle): good must EQUAL the reconstructed credit count (an independent cross-check
// — good is only ever maintained incrementally), plus best and clean-edge streak.
//   • classic-strict — balanced Classic/Deduction play under the strong oracle.
//   • deep-history   — long (600-step) sequences over DEEP stacks under the strong oracle.
//   • times-churn    — heavy solve-time + tracking churn → hammers the times pool (its play order —
//                      gameReducer.poolSlot — held exactly by the invariants' times ledger).
//   • aox-strong (C2 Part 1) — the AoX `complete` (held completing solve) surface. The oracle now
//     folds the HELD live credit (a clean credit on the live grid) and the back-browsed isLive forward
//     entry into the reconstruction, so the exact check runs where it previously couldn't. Still
//     excludes RESET_ROUND (keeps stats while wiping history) and the timeouts — unreachable in real
//     AoX play.
//   • timed-strong (C2 Part 1) — the Blitz timeout surface (LOCK_REVEAL / TIMEOUT_MISS, gated to the
//     active live edge so they stay oracle-safe). Flash's scoring surface IS Classic's, so it's
//     already covered by classic-strict et al.; this adds exact coverage of the two timeout actions.
// Sweep knob: `FUZZ_SCALE=N npx vitest run tests/engine/fuzz.test.js` multiplies every profile's
// sequence COUNT by N (committed default 1) so a "bigger one-time sweep" needs NO code edit.
//
// Deterministic seeds ⇒ any failure reproduces exactly (the failure prints profile + seed + step).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { runFuzzProfile, SCALE } from './fuzzHarness.js'

// These profiles are deliberately heavy (millions of reducer calls), so they routinely exceed
// vitest's 5s default per-test timeout — especially under full-suite CPU contention. Give them an
// explicit, generous budget, scaled with the sweep size (SCALE, imported from the harness) so a
// FUZZ_SCALE big-sweep doesn't trip it. A sweep can also pass `--testTimeout=…`.
const T = 30000 * SCALE

describe('fuzz / bug survey — engine invariants hold across random play (C1/C2)', () => {
  // The broad, unbiased baseline — no invariant may ever break across the whole action space.
  it(
    'uniform — survives a large unbiased corpus with ZERO invariant violations',
    () => {
      const cov = runFuzzProfile('uniform')
      // Prove the survey wasn't vacuous — it actually exercised credits, the override paths,
      // back-browsing, and Deduction puzzles (not just trivial no-ops).
      expect(cov.good).toBeGreaterThan(0)
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.back).toBeGreaterThan(0)
      expect(cov.deduction).toBeGreaterThan(0)
    },
    T,
  )

  // Override-heavy — the Override score-integrity family (every target, both directions) over deep
  // histories.
  it(
    'override-heavy — survives biased Override play with ZERO invariant violations',
    () => {
      const cov = runFuzzProfile('override-heavy')
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.toggleBack).toBeGreaterThan(0) // actually undid overrides between the overrides
      expect(cov.overrideBrowsing).toBeGreaterThan(0) // reached the browsed target
      expect(cov.back).toBeGreaterThan(0)
    },
    T,
  )

  // AoX-complete-heavy — credit the Nth solve without advancing, then take it away (run fails).
  it(
    'aox-complete-heavy — survives biased AoX-completion play with ZERO invariant violations',
    () => {
      const cov = runFuzzProfile('aox-complete-heavy')
      expect(cov.complete).toBeGreaterThan(0) // actually fired ANSWER.complete
      expect(cov.toggleBack).toBeGreaterThan(0) // actually undid overrides on the completion surface
      expect(cov.hold).toBeGreaterThan(0) // actually fired OVERRIDE.hold
      expect(cov.override).toBeGreaterThan(0)
    },
    T,
  )

  // Reveal-heavy — the "clean correct without credit" seeds, then back-browse + Override to inflate.
  it(
    'reveal-heavy — survives biased burn-then-override play with ZERO invariant violations',
    () => {
      const cov = runFuzzProfile('reveal-heavy')
      expect(cov.reveal).toBeGreaterThan(0) // actually burned questions via Reveal
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.overrideBrowsing).toBeGreaterThan(0) // back-browse Override after the burns
    },
    T,
  )

  // Classic-strict — the Classic/Deduction surface under the EXACT good==credits / best / streak oracle.
  it(
    'classic-strict — survives Classic/Deduction play under the EXACT score oracle',
    () => {
      const cov = runFuzzProfile('classic-strict')
      expect(cov.good).toBeGreaterThan(0)
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.overrideBrowsing).toBeGreaterThan(0)
      expect(cov.deduction).toBeGreaterThan(0)
      expect(cov.hydrated).toBeGreaterThan(0) // actually exercised the hydrated-start (bestFloor/streakCarry) fold
    },
    T,
  )

  // Deep-history — long sequences over DEEP stacks under the exact oracle.
  it(
    'deep-history — survives long, deep-stack play under the EXACT score oracle',
    () => {
      const cov = runFuzzProfile('deep-history')
      expect(cov.maxStack).toBeGreaterThan(20) // actually built a deep history
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.overrideBrowsing).toBeGreaterThan(0)
    },
    T,
  )

  // Times-churn — hammers the solve-time pool (and its play order) under the exact oracle.
  it(
    'times-churn — survives heavy solve-time churn under the EXACT score oracle',
    () => {
      const cov = runFuzzProfile('times-churn')
      expect(cov.maxTimes).toBeGreaterThan(5) // actually accumulated solve times
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.good).toBeGreaterThan(0)
    },
    T,
  )

  // AoX-strong — the AoX `complete` (held completing solve) surface under the EXACT oracle, now
  // EXTENDED to fold the held live credit (a clean credit on the live grid) and the isLive forward
  // entry into the reconstruction (C2 Part 1). This is the surface the old oracle couldn't run on.
  it(
    'aox-strong — survives held-completing-solve play under the EXACT score oracle',
    () => {
      const cov = runFuzzProfile('aox-strong')
      expect(cov.complete).toBeGreaterThan(0) // actually dispatched ANSWER.complete
      expect(cov.hold).toBeGreaterThan(0) // actually pressed Override with `hold`
      expect(cov.heldComplete).toBeGreaterThan(0) // actually REACHED a held-credit live edge
      expect(cov.liveHold).toBeGreaterThan(0) // reached the OVERRIDE hold specifically (not just ANSWER-complete)
      expect(cov.browsedHeld).toBeGreaterThan(0) // actually back-browsed AWAY from a held credit
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.toggleBack).toBeGreaterThan(0) // actually undid overrides of held solves under the oracle
    },
    T,
  )

  // Timed-strong — the Blitz timeout surface (LOCK_REVEAL / TIMEOUT_MISS, gated to the active live
  // edge) under the EXACT oracle (C2 Part 1). Confirms the timeout actions never desync good/best/
  // streak alongside the override/history machinery.
  it(
    'timed-strong — survives timed-mode timeout play under the EXACT score oracle',
    () => {
      const cov = runFuzzProfile('timed-strong')
      expect(cov.timedTimeout).toBeGreaterThan(0) // actually fired a gated LOCK_REVEAL / TIMEOUT_MISS
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.toggleBack).toBeGreaterThan(0) // actually undid overrides alongside the timeouts
      expect(cov.overrideBrowsing).toBeGreaterThan(0)
      expect(cov.good).toBeGreaterThan(0)
    },
    T,
  )

  // ── The fully-INDEPENDENT reference model (C2 Part 3) ──
  // A second, separately-written implementation of the scoring contract (referenceModel.js) runs in
  // lockstep and is compared field-by-field after EVERY action — played/good/times/best + clean-edge
  // streak. Unlike the strong oracle (which reconstructs good from the reducer's own hasCredit
  // flags), the model derives what SHOULD be credited from the user-visible rules alone, so a state
  // where the aggregate AND the flags are wrong together still disagrees here. `played` gets its
  // first exact oracle anywhere.
  it(
    'ref-classic — the reducer matches the independent reference model (Classic/Deduction surface)',
    () => {
      const cov = runFuzzProfile('ref-classic')
      expect(cov.refChecks).toBeGreaterThan(0) // the model actually ran
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.overrideBrowsing).toBeGreaterThan(0)
      expect(cov.deduction).toBeGreaterThan(0)
      expect(cov.good).toBeGreaterThan(0)
      expect(cov.hydrated).toBeGreaterThan(0) // the model matched the reducer on hydrated-start sequences too
      expect(cov.toggleBack).toBeGreaterThan(0) // the model's flipped bit matched the reducer's restore
    },
    T,
  )
  it(
    'ref-full — the reducer matches the independent reference model (held-complete + timeout surface)',
    () => {
      const cov = runFuzzProfile('ref-full')
      expect(cov.refChecks).toBeGreaterThan(0)
      expect(cov.complete).toBeGreaterThan(0) // actually held completing solves
      expect(cov.hold).toBeGreaterThan(0) // actually pressed Override with `hold`
      expect(cov.timedTimeout).toBeGreaterThan(0) // actually fired the timeout actions
      expect(cov.timedOutBehind).toBeGreaterThan(0) // a timed-out card left the live edge, and both sides still refused it
      expect(cov.override).toBeGreaterThan(0)
      expect(cov.hydrated).toBeGreaterThan(0) // held-complete + timeout surface verified on hydrated starts too
      expect(cov.toggleBack).toBeGreaterThan(0)
    },
    T,
  )

  // ── Override ⇄ Undo, the permanent per-card toggle (round 23 Q6) ──
  // Presses dominate the stream, under the exact oracle AND the reference model — whose toggle is
  // one bit on a question it stores as-answered, where the reducer rewrites two materialised states —
  // so the two routes to every position are independent. The harness also asserts, every step, that
  // its own reading of which card the button points at is the reducer's (the label and the press
  // can never disagree), and the coverage below proves the stream really reached the corners: an
  // Undo, a card toggled deep in the history, the same card pressed three times running, and a
  // crediting press that held on the live card.
  it(
    'toggle-churn — any card, any number of times, matches the reference model under the EXACT oracle',
    () => {
      const cov = runFuzzProfile('toggle-churn')
      expect(cov.refChecks).toBeGreaterThan(0)
      expect(cov.toggleBack).toBeGreaterThan(0) // O → A: an Undo
      expect(cov.toggleDeep).toBeGreaterThan(0) // a card browsed two or more deep
      expect(cov.retoggle).toBeGreaterThan(0) // one card flipped three times running
      expect(cov.liveHold).toBeGreaterThan(0) // a crediting press that stayed on the live card
      expect(cov.overrideBrowsing).toBeGreaterThan(0)
      expect(cov.heldComplete).toBeGreaterThan(0)
      expect(cov.timedTimeout).toBeGreaterThan(0)
      expect(cov.hydrated).toBeGreaterThan(0)
    },
    T,
  )
})
