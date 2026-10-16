// syncRecords — the records book's own arithmetic (store/syncRecords), for what the model's world cannot
// show: a field where LOWER is better and the empty value is `null` (MoX's best mean and median), a
// companion riding with a value (the Best Score round's streak), the self-verifying tag, and v2.26.0's
// counter round ids scoped to their load (part2-issues #1, #5). The merge itself is gated in the model's
// world (tests/syncedDoc.records.fuzz).
import { describe, it, expect } from 'vitest'
import {
  RecordsBook,
  fpRec,
  recordTag,
  scopedRoundId,
  clockRoundId,
  loadKeyOf,
  COUNTER_ROUND_ID,
  SCOPED_ROUND_ID,
  ALT,
} from '../src/store/syncRecords.js'

// MoX's two fields: a time, lower is better, none is null; its companion is the other figure of that run
const LOWER = {
  fields: ['avg', 'med'],
  empty: null,
  better: (a, b) => b !== null && (a === null || Math.round(b * 100) < Math.round(a * 100)),
  present: (v) => v !== null,
  same: (a, b) =>
    a === null ? b === null : b !== null && Math.round(a * 100) === Math.round(b * 100),
}
const book = (spec = LOWER) =>
  new RecordsBook({
    spec,
    tag: 'w1',
    clock: { hi: 0, peek: () => 5_000 },
    io: {
      view: () => ({
        docPresent: false,
        env: false,
        stTag: null,
        stBoot: false,
        stFresh: false,
        S: null,
        recs: {},
      }),
      deviceKey: () => null,
    },
  })
const run = (id, avg, med) => ({ id, v: { avg: { v: avg, c: med }, med: { v: med, c: avg } } })

describe('a lower-is-better record with companions', () => {
  it('the faster round holds each field, with the other figure of its run beside it', () => {
    const b = book()
    b.op('k', run(1, 2.5, 2.4))
    b.op('k', run(2, 2.3, 2.6))
    const r = b.recs.k.mem
    expect(r.f.avg).toMatchObject({ v: 2.3, c: 2.6, id: 2 })
    expect(r.f.med).toMatchObject({ v: 2.4, c: 2.5, id: 1 })
    // the slower value of each field is the runner-up a take-back would land on
    expect(r.x.avg.map((q) => q.id)).toEqual([1])
  })

  it('a tie stays with the round that got there first; the same value again changes nothing', () => {
    const b = book()
    b.op('k', run(1, 2.5, 2.4))
    b.op('k', run(2, 2.504, 2.9)) // (2.50 to the hundredth: a tie)
    expect(b.recs.k.mem.f.avg.id).toBe(1)
    const before = JSON.stringify(b.recs.k.mem)
    b.op('k', run(1, 2.5, 2.4))
    expect(JSON.stringify(b.recs.k.mem)).toBe(before)
  })

  it('an Override taking a round back lands on the true next value, not on nothing', () => {
    const b = book()
    b.op('k', run(1, 3.0, 3.1))
    b.op('k', run(2, 2.8, 2.9))
    b.op('k', run(3, 2.2, 2.0))
    b.op('k', { id: 3, v: { avg: { v: null }, med: { v: null } }, ov: true }) // run 3 taken back whole
    expect(b.recs.k.mem.f.avg).toMatchObject({ v: 2.8, id: 2 })
    expect(b.recs.k.mem.f.med).toMatchObject({ v: 2.9, id: 2 })
    // …and the take-back is remembered as a new window's Override of that run
    expect(b.recs.k.mem.hn.avg).toEqual([3])
  })

  it('keeps at most ALT runner-ups a field', () => {
    const b = book()
    for (let i = 1; i <= ALT + 3; i++) b.op('k', run(i, 10 - i, 10 - i))
    expect(b.recs.k.mem.x.avg).toHaveLength(ALT)
  })
})

describe('what a record says about itself', () => {
  it('its fingerprint names every value, companion and holder', () => {
    const r = { f: { avg: { v: 2.3, c: 2.6, id: 2 }, med: { v: null, id: null } } }
    expect(fpRec(LOWER, r)).toBe('2.3~2.6@2|null@null')
    expect(fpRec(LOWER, null)).toBe('none')
  })

  it('its tag names its own values: a record an older build changed under the tag no longer matches', () => {
    const rec = { score: 7, scoreRoundId: 2, streak: 7, streakRoundId: 2 }
    const w = recordTag(rec)
    expect(recordTag({ ...rec, w })).toBe(w) // (the tag itself is not one of the values)
    expect(recordTag({ ...rec, score: 5, w })).not.toBe(w)
  })
})

describe('v2.26.0’s counter round ids (part2-issues #5)', () => {
  it('a counter is scoped to its load: the same counter in two loads is two rounds', () => {
    const a = scopedRoundId('boot', 1)
    const b = scopedRoundId(loadKeyOf({ m: 1, c: 4, t: 'w1', d: 0 }, false), 1)
    expect(a).not.toBe(b)
    expect(a).toBe(scopedRoundId('boot', 1))
    for (const id of [a, b]) {
      expect(id).toBeGreaterThanOrEqual(SCOPED_ROUND_ID)
      expect(Number.isSafeInteger(id)).toBe(true)
      expect(clockRoundId(id)).toBe(false)
    }
    // every clock's id is a clock's: v2.27.3+'s and a new build's alike
    expect(clockRoundId(Date.now() * 1024 + 1023)).toBe(true)
    expect(COUNTER_ROUND_ID).toBeLessThan(Date.now() * 1024)
  })

  it('a scoped round is never killed by a Reset’s bound - only by being one the resetting window knew', () => {
    const b = book()
    const old = scopedRoundId('boot', 3)
    b.dead = 10 ** 15
    expect(b.roundDead(old)).toBe(false)
    expect(b.roundDead(10 ** 14)).toBe(true)
    b.deadIds = [old]
    expect(b.roundDead(old)).toBe(true)
  })
})
