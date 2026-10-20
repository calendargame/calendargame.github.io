// syncedDoc.records.fuzz — THE GATE FOR BEST RECORDS IN SYNC: the REAL records book (store/syncRecords) plays
// every new window in the world of design-q2-model's model5, judged by the model's own judge (design-q1-q2.md
// v4, 4.1 and 14.2).
//
// THE WORLD (tests/helpers/syncModel/world5.js): one Best record of two fields on one device; new windows that
// read it one write at a time, sleep, wake, close, open, fill the device, and Reset it; OLDER pages that play
// rounds, take them back with Overrides on their results screens, save through writeKept, save whole, reload,
// and Full Reset under Stats Only in two writes; the device clock set back and forward. Plus what the model did
// not have (part2-issues #1, #5, #6): a v2.26.0 page that SPREADS the record it changes (the tag kept), keeps
// a taken-back field with its own round, and numbers its rounds with a counter from 1 per load. And the model's
// AMNESIC configurations (design-amnesic-close.md 4): the preset's value changes, the app closes and opens cold,
// and the real book's forget under Full (RecordsBook.forgetWindow) puts each record back to its anchor - the
// judge runs right after every forget as well as at the end, with the model's named cases (R16, R17, R19).
// THE JUDGE (tests/helpers/syncModel/fuzz5.js, the model's own): knows nothing of stamps, tags or books - only
// every round's values and when the device first showed each: the record must be the best of the live rounds
// the device ever showed, held by the first round to reach it; every open new window must hold what the
// device holds. Every difference is a gate failure or a NAMED residual (design 2.8), counted.
// THE JUDGE'S OWN TEST: the model's rules turned off one at a time - the take-back rule, the runner-ups - and
// the v2.26.0 page read with the model's bare tag (part2-issues #1) must each turn it red; and the forget
// planted away (mutam5.mjs: no restore) must be caught where a restore would have changed the record.
// PARITY: before this suite was written the book was run beside the model's own new windows on the same seeds
// (40 per configuration, 0 to 3), stamping every record on every write as the model does: every judge figure
// was identical in every run. The book stamps a record only when it changes (2.2's compact form: the records'
// key is rewritten only by a save that changes a record); with that, the gate below is the proof.
//
// ★ SCALE. CI runs 60 seeds per configuration (a record is small: about fifteen seconds in all) - FUZZ_SCALE
// multiplies it, as it does the counts gate's; FUZZ_SCALE=5 runs the 300 a configuration the gate was last
// run at locally (every configuration 0 bad).
import { describe, it, expect } from 'vitest'
import { run, cfgs, ablations } from './helpers/syncModel/fuzz5.js'

const SCALE = Math.max(1, Number(process.env.FUZZ_SCALE ?? 1))
const SEEDS = Math.round(60 * SCALE)
const STEPS = 300

const totals = {}
describe('the records book in model5’s world', () => {
  for (const [ci, [name, cfg]] of cfgs.entries())
    it(`[${ci}] ${name}: 0 bad runs in ${SEEDS}`, () => {
      const bad = []
      for (let seed = 1; seed <= SEEDS; seed++) {
        const j = run(seed, cfg, STEPS)
        if (j.bad) bad.push(seed)
        for (const [k, v] of Object.entries(j)) totals[k] = (totals[k] ?? 0) + v
      }
      expect(bad, `first bad seeds: ${bad.slice(0, 3).join(', ')}`).toEqual([])
    })

  it('reach: the paths the gate is about were taken', () => {
    // runner-up lists dropped once nothing can take their holder back; Resets left waiting on a full device by
    // versions that added no play; the round-id leftover and the second-older-page class met; Full Resets
    // nobody saw (R10)
    // (v5) …and companions read as unknown, beside a holder a spreading page put there
    for (const k of [
      'runnerUpsDropped',
      'resetKept',
      'idOrder',
      'unseenFullReset',
      'companionUnknown',
    ])
      expect(totals[k], k).toBeGreaterThan(0)
  })
  it('reach, Amnesic: forgets under Full ran, records were put back, rounds were forgotten', () => {
    for (const k of ['forgets', 'restored', 'restoreChanges', 'roundsForgotten'])
      expect(totals[k], k).toBeGreaterThan(0)
  })
})

describe('the judge catches the rules turned off', () => {
  // (each is caught within these seeds: the first bad seed of each, at 300 seeds, was 25, 39 and 7)
  for (const [name, cfg] of ablations)
    it(name, () => {
      let bad = 0
      for (let seed = 1; seed <= 60 && !bad; seed++) if (run(seed, cfg, STEPS).bad) bad++
      expect(bad).toBeGreaterThan(0)
    })
  // (the model's own test: 99.1% caught with new windows only, 86% with older tabs - the misses runs where an
  // older tab's own rounds, or an older Full Reset no window saw, stand where the forgotten rounds were)
  it('the forget under Full planted away (no restore): caught where a restore would change the record', () => {
    let fired = 0
    let caught = 0
    for (const [, cfg] of cfgs) {
      if (!cfg.amnesic) continue
      for (let seed = 1; seed <= SEEDS; seed++) {
        const j = run(seed, { ...cfg, mut: 'amNoForget' }, STEPS)
        if (!j.restoreChanges) continue
        fired++
        if (j.bad) caught++
      }
    }
    expect(fired).toBeGreaterThan(20)
    expect(caught / fired).toBeGreaterThan(0.8)
  }, 600_000)
})
