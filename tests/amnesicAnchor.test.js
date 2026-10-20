// amnesicAnchor — THE AMNESIC ANCHOR AS THE DOC STORES IT (store/syncCounts' encodeAnchor / decodeAnchor;
// design-amnesic-close.md 1): one field of a mode's silo, `a`, holding the window it was taken in, the
// version it describes, and the counts as they stood - read back exactly, and anything this build did
// not write read as no anchor at all (so nothing is forgotten by it).
import { describe, it, expect } from 'vitest'
import { encodeAnchor, decodeAnchor } from '../src/store/syncCounts.js'
import { newClock, mint } from '../src/store/syncStamp.js'
import { timesHash } from '../src/engine/timesPool.js'

const ANCHOR = {
  e: '3:2',
  st: mint(newClock(), 'w1'),
  pl: 12,
  gd: 9,
  sk: 2,
  bs: 5,
  n: 3,
  h: timesHash([1.5, 2.25, 3]),
  tl: 4,
}

describe('the anchor, stored and read back', () => {
  it('is read back exactly - with a version, and without one', () => {
    expect(decodeAnchor(encodeAnchor(ANCHOR))).toEqual(ANCHOR)
    const none = { ...ANCHOR, st: null }
    expect(decodeAnchor(encodeAnchor(none))).toEqual(none)
  })

  it('names both readings of the window: <session>:<switch-on>, and the model’s s<session>', () => {
    for (const e of ['0:0', '17:204', 's5'])
      expect(decodeAnchor(encodeAnchor({ ...ANCHOR, e }))?.e).toBe(e)
  })

  it('anything this build did not write is no anchor', () => {
    const good = encodeAnchor(ANCHOR)
    const parts = good.split('|')
    const variant = (i, v) => parts.map((p, j) => (j === i ? v : p)).join('|')
    for (const bad of [
      undefined,
      null,
      7,
      { e: '1:1' },
      '',
      good + '|1', // a field too many
      parts.slice(0, 8).join('|'), // one too few
      variant(0, 'x:1'), // not a window
      variant(1, 'not-a-stamp'),
      variant(2, '-1'), // a negative count
      variant(3, '1.5'), // not a whole count
      variant(7, ''), // no hash of the times kept
    ])
      expect(decodeAnchor(bad)).toBeNull()
  })
})
