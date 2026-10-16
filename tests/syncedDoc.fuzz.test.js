// syncedDoc.fuzz — THE GATE FOR WINDOWS IN SYNC: the REAL door (store/syncCounts) plays every new window in
// the world of design-q2-model's model4, judged by the model's oracle (design-q1-q2.md v4, 3 and 14.2).
//
// THE WORLD (tests/helpers/syncModel/world4.js): one device; new windows that read it one write at a time,
// sleep, wake, close, open, fill the device, have their sync key refused, and act on a stale copy (LAG);
// OLDER pages as v2.27-v2.29 behave (tests/syncedDoc.olderBuilds holds those facts to what the real builds
// did) - answers, Overrides of their own cards at any depth, Resets as literals, reloads, the boot rewrite,
// a Full Reset in two writes - and dropping Q21's Amnesic field; the device clock jumping by years; cleared
// storage. 22 configurations (tests/helpers/syncModel/fuzz4.js), 300 steps a run.
// THE ORACLE (tests/helpers/syncModel/judge4.js, the model's own): knows nothing of stamps, tags, books or
// the sync key - only who did what, and the DRIVER's log of every answer ever made. At every new window's
// write it decodes the silo against that log (an answer counted twice, a part no answer accounts for); at the
// end, losses and returns are each either a gate failure or a NAMED residual (design 2.8) with a definition
// taken from the world. Reviewer A's round-one oracle runs beside it; every flag it raises must be a Reset's
// own removal or a named residual.
// THE ORACLE'S OWN TEST: the model's three planted merge bugs, put into the real door's fold behind its test
// switch (hooks.mut): a one-answer block added twice must turn the gate red in EVERY run where the bad value
// was written; a dropped block, and a dropped single right answer, in almost every run outside the places a
// named residual covers that very loss (LAG: R1; "never reloads": R4).
// PARITY: before this suite was written the door was run beside the model's own new windows on the same seeds
// (100 per configuration): every count the oracle keeps was identical in every run.
//
// ★ SCALE. CI runs FUZZ_SEEDS (default 12) seeds per configuration - about a minute. Set FUZZ_SCALE=250 for
// the design's 3,000 a configuration (a local run of several hours); the mutation test scales with it.
import { describe, it, expect } from 'vitest'
import { run, cfgs } from './helpers/syncModel/fuzz4.js'

const SCALE = Math.max(1, Number(process.env.FUZZ_SCALE ?? 1))
const SEEDS = Math.round(Number(process.env.FUZZ_SEEDS ?? 12) * SCALE)
const STEPS = 300
// The two places a planted DROP is excused by the very residual that excuses the real loss (design 3).
const DROP_EXCUSED = new Set([4, 5, 20, 21])

// What a real browser hands a window that slept (frozen, discarded, bfcache): the device as it is, and no
// old value - so nothing it reads then is contiguous (design 2.5.8). The model's world handed it the doc
// just before the newest; the door must stay clean either way.
const VARIANTS = [
  ['as the model drove it', {}],
  ['a window that slept gets no old value (a real browser)', { missedHasNoOld: true }],
]

const totals = {}
const add = (o) => {
  for (const [k, v] of Object.entries(o))
    if (typeof v === 'number') totals[k] = (totals[k] ?? 0) + v
}

for (const [vname, vopt] of VARIANTS)
  describe(`the door in model4's world — ${vname}`, () => {
    for (const [ci, [name, cfg]] of cfgs.entries())
      it(`[${ci}] ${name}: 0 bad runs in ${SEEDS}, reviewer A's flags all named`, () => {
        let bad = 0
        let unexplained = 0
        let envMismatch = 0
        const first = []
        for (let seed = 1; seed <= SEEDS; seed++) {
          const j = run(seed, { ...cfg, opt: { ...(cfg.opt ?? {}), ...vopt } }, STEPS)
          if (j.bad) {
            bad++
            if (first.length < 3) first.push(seed)
          }
          unexplained += j.X.unexplained
          envMismatch += j.envMismatch
          add(j)
        }
        expect({ bad, unexplained, envMismatch, first }).toEqual({
          bad: 0,
          unexplained: 0,
          envMismatch: 0,
          first: [],
        })
      }, 600_000)
  })

describe('reach: the paths the gate is about were taken', () => {
  it('older blocks folded, carried exactly, parts not carried, Overrides at depth, held Resets kept waiting', () => {
    for (const k of [
      'carried',
      'dropped',
      'inexact',
      'overrides',
      'resetKept',
      'oldAnswersKept',
      'forcedSameBase',
      'regOldCarryWins',
    ])
      expect(totals[k] ?? 0, k).toBeGreaterThan(0)
  })
})

describe('the oracle catches the planted merge bugs in the real door', () => {
  const MUT_SEEDS = Math.max(4, Math.round(SEEDS / 2))
  for (const mut of ['double', 'drop', 'dropOne'])
    it(`${mut}: caught wherever it was written${mut === 'double' ? '' : ' (outside the residuals that excuse it)'}`, () => {
      let written = 0
      let caught = 0
      for (const [ci, [, cfg]] of cfgs.entries()) {
        if (mut !== 'double' && DROP_EXCUSED.has(ci)) continue
        for (let seed = 1; seed <= MUT_SEEDS; seed++) {
          const j = run(seed, { ...cfg, mut }, STEPS)
          if (!j.mutLanded) continue
          written++
          if (j.bad) caught++
        }
      }
      expect(written).toBeGreaterThan(10)
      if (mut === 'double') expect(caught).toBe(written)
      else expect(caught / written).toBeGreaterThan(0.95)
    }, 900_000)
})
