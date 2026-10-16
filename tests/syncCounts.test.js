// syncCounts — the merge of one doc of counts and settings, case by case (design-q1-q2.md v4, 2.4-2.5).
// Each case is one row of the design's tables, driven by hand on a small world (tests/helpers/syncModel/
// miniDoor.js): new windows are the real door, older pages are written as the older builds write (a
// whole copy, no envelope; a silo spread, tag kept; a Reset as a literal). The fuzz
// (tests/syncedDoc.fuzz) is the gate; this file is the readable statement of the rules.
import { describe, it, expect } from 'vitest'
import { makeDevice, newWindow, deviceSilo, tagOn } from './helpers/syncModel/miniDoor.js'
import {
  encodeStamp,
  decodeStamp,
  packSync,
  unpackSync,
  cmpStamp,
  mint,
  see,
  newClock,
} from '../src/store/syncStamp.js'
import { siloFp, regFp } from '../src/store/syncCounts.js'

// An OLDER page: memory = the doc it loaded; an answer spreads the silo (its tag rides along); a Reset is
// a literal; a setting is rebuilt field by field (an unknown field dropped); every save is a whole copy.
function olderPage(dev, { drops = [] } = {}) {
  let state = JSON.parse(JSON.stringify(dev.state() ?? {}))
  for (const x of ['A', 'B']) state[x] ??= { pl: 0, gd: 0, sk: 0, bs: 0, t: [] }
  const save = () => {
    const out = { ...state }
    for (const f of drops) delete out[f]
    dev.oldSave(out)
  }
  return {
    reload() {
      state = JSON.parse(JSON.stringify(dev.state() ?? {}))
    },
    answer(x, r = true, tm = null) {
      const s = { ...state[x], t: [...state[x].t] }
      s.pl++
      if (r) {
        s.gd++
        s.sk++
        if (s.sk > s.bs) s.bs = s.sk
        if (tm !== null) s.t.push(tm)
      } else s.sk = 0
      state[x] = s
      save()
    },
    reset(x) {
      state[x] = { pl: 0, gd: 0, sk: 0, bs: 0, t: [] }
      save()
    },
    set(f, v) {
      state[f] = v
      save()
    },
    save,
  }
}
const counts = (s) => [s.pl, s.gd, s.sk, s.bs, s.t.length]

describe('stamps (2.3)', () => {
  it('a Lamport clock: every stamp minted is above every stamp seen, whatever the device clock', () => {
    const a = newClock()
    const s1 = mint(a, 'aa')
    const b = newClock()
    see(b, s1)
    const s2 = mint(b, 'bb')
    expect(cmpStamp(s2, s1)).toBeGreaterThan(0)
    expect(decodeStamp(encodeStamp(s2))).toEqual(s2)
    // derived stamps, and the two built-in ones, keep every part through the text
    for (const st of [
      { ...s2, d: -1 },
      { m: 0, c: 0, t: '~boot', d: 0 },
      { m: 0, c: 0, t: '', d: 1 },
    ])
      expect(decodeStamp(encodeStamp(st))).toEqual(st)
  })
  it('packed sync data reads back exactly, and a typed string beginning with § is never taken for a stamp', () => {
    const v = {
      st: { m: 1, c: 35, t: 'x1', d: 0 },
      name: '§1.x1',
      list: [{ m: 1, c: 2, t: 'q', d: -1 }],
    }
    expect(unpackSync(packSync(v))).toEqual(v)
  })
})

describe('reading the device (2.4) and the merge (2.5)', () => {
  it('BOOT: before any new save, the device is all there is; the first save tags the silo and names the bootstrap summary', () => {
    const dev = makeDevice()
    const old = olderPage(dev)
    old.answer('A', true, 1.5)
    const w = newWindow(dev, 'n1')
    expect(counts(w.silo('A'))).toEqual([1, 1, 1, 1, 1])
    w.answer('A', true, 2)
    expect(counts(deviceSilo(dev, 'A'))).toEqual([2, 2, 2, 2, 2])
    expect(tagOn(dev, 'A')).toMatchObject({ pl: 2, n: 2 })
    expect(JSON.parse(dev.key).boot.A).toMatchObject({ pl: 1, n: 1 })
  })

  it('an answer in one window is in the other at once, and the other’s next answer lands on top of it', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    a.answer('A', true, 1)
    expect(counts(b.silo('A'))).toEqual([1, 1, 1, 1, 1])
    b.answer('A', false)
    expect(counts(deviceSilo(dev, 'A'))).toEqual([2, 1, 0, 1, 1])
    expect(counts(a.silo('A'))).toEqual([2, 1, 0, 1, 1])
  })

  it('a window that slept never saves over newer answers: it reads the device first', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    b.asleep = true
    a.answer('A', true, 1)
    a.answer('A', true, 2)
    b.answer('A', true, 3) // b's act reads the device as it now is
    expect(counts(deviceSilo(dev, 'A'))).toEqual([3, 3, 3, 3, 3])
  })

  it('a Reset in one window is not undone by another window’s next save', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    a.answer('A', true, 1)
    b.asleep = true
    a.reset('A')
    b.answer('B', true, 5)
    expect(counts(deviceSilo(dev, 'A'))).toEqual([0, 0, 0, 0, 0])
    expect(counts(deviceSilo(dev, 'B'))).toEqual([1, 1, 1, 1, 1])
  })

  it('BLOCK: an older page’s answers on a new window’s version are FOLDED by a window holding it', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.answer('A', true, 1)
    const old = olderPage(dev)
    old.answer('A', true, 2)
    old.answer('A', false)
    // a held the newest version: it folded the block and wrote it back as a version of its own
    expect(counts(deviceSilo(dev, 'A'))).toEqual([3, 2, 0, 2, 2])
    expect(tagOn(dev, 'A')).toMatchObject({ pl: 3 })
    a.answer('A', true, 4)
    expect(counts(deviceSilo(dev, 'A'))).toEqual([4, 3, 1, 2, 3])
  })

  it('CARRY: an older page’s stale copy of an older version is put right by the newest one', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.answer('A', true, 1)
    const old = olderPage(dev) // loads version 1
    a.answer('A', true, 2) // version 2
    old.save() // the older page saves its whole stale copy (a setting change, say)
    expect(counts(deviceSilo(dev, 'A'))).toEqual([2, 2, 2, 2, 2])
  })

  it('CHANGE: an older page’s Reset (an untagged literal) stands', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.answer('A', true, 1)
    const old = olderPage(dev)
    old.reset('A')
    expect(counts(deviceSilo(dev, 'A'))).toEqual([0, 0, 0, 0, 0])
    expect(counts(a.silo('A'))).toEqual([0, 0, 0, 0, 0])
  })

  it('doc absent, key present: an older page’s Full Reset is a CHANGE to blank everywhere', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.answer('A', true, 1)
    a.set('R', 7)
    dev.oldRemove()
    expect(counts(a.silo('A'))).toEqual([0, 0, 0, 0, 0])
    expect(a.reg('R')).toBeUndefined()
  })

  it('a SETTING: an older page putting back the value from before the newest change is a stale copy; a new value is a choice', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.set('R', 1)
    const old = olderPage(dev) // loads R = 1
    a.set('R', 2)
    old.save() // its stale R = 1, the value just before the newest change
    expect(a.reg('R')).toBe(2)
    expect(dev.state().R).toBe(2) // re-asserted
    old.reload()
    old.set('R', 9) // a genuine choice in the older page
    expect(a.reg('R')).toBe(9)
  })

  it('a setting field an older build does not know (Q21’s Amnesic) is ABSENT from its save: the newest value stands', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.set('S', 'stats')
    const old = olderPage(dev, { drops: ['S'] })
    old.answer('A', true, 1)
    expect(a.reg('S')).toBe('stats')
    expect(dev.state().S).toBe('stats')
  })

  it('a setting changed in a NEW window reaches the other window as that window’s own value', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    a.set('R', 'x')
    expect(b.reg('R')).toBe('x')
  })
})

describe('held saves and Resets (2.5.5, 5)', () => {
  it('a refused write keeps no stamps; the retry lands on whatever another window saved meanwhile', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    dev.full.add('a')
    expect(a.answer('A', true, 1)).toBe(false)
    b.answer('A', true, 2)
    dev.full.delete('a')
    a.book.handle() // the retry
    expect(counts(deviceSilo(dev, 'A'))).toEqual([2, 2, 2, 2, 2])
  })

  it('a Reset waiting for room is CANCELLED by play it did not see, and kept by a mere re-save', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    const b = newWindow(dev, 'b')
    a.answer('A', true, 1)
    dev.full.add('a')
    a.reset('A') // held
    b.answer('B', true, 9) // play, but in another mode: A's Reset still waits
    dev.full.delete('a')
    a.book.handle()
    expect(counts(deviceSilo(dev, 'A'))).toEqual([0, 0, 0, 0, 0])
    a.answer('A', true, 2)
    dev.full.add('a')
    a.reset('A') // held again
    b.answer('A', true, 3) // play in that mode since the press: the Reset is cancelled
    dev.full.delete('a')
    a.book.handle()
    expect(counts(deviceSilo(dev, 'A'))).toEqual([2, 2, 2, 2, 2])
  })
})

describe('what a load and an idle window write (G7)', () => {
  it('opening a window writes nothing, and a window handling a notice of nothing new writes nothing', () => {
    const dev = makeDevice()
    const a = newWindow(dev, 'a')
    a.answer('A', true, 1)
    const n = dev.log.length
    const b = newWindow(dev, 'b')
    b.book.handle()
    expect(dev.log.length).toBe(n)
  })
})

describe('fingerprints', () => {
  it('a silo is named by its counts, its legacy gap, and the hash of its times in order', () => {
    const s = { pl: 3, gd: 2, sk: 1, bs: 2, t: [1, 2], tl: 0 }
    expect(siloFp(s)).toBe(siloFp({ ...s, t: [1, 2] }))
    expect(siloFp(s)).not.toBe(siloFp({ ...s, t: [2, 1] }))
    expect(siloFp(s)).not.toBe(siloFp({ ...s, tl: 4 }))
    expect(regFp({ b: 1, a: 2 })).toBe(regFp({ a: 2, b: 1 }))
    expect(regFp(undefined)).not.toBe(regFp(null))
  })
})
