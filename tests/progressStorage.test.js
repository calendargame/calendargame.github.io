// progressStorage — the layout of the saved progress on the device (store/progressStorage).
//
// A silo past 1,000 solve times is SEALED: its newest 250–499 times stay in the main key and the
// older ones live in 250-time chunk keys the main key names. This build seals; the READER builds
// that may still share the device (v2.28.0 and v2.29.x) read and keep the layout and never start it.
// So every group here that saves runs BOTH ways — this build, and the reader builds' own recorded
// code (tests/fixtures/olderBuilds/progressStorage-v2.29.0.ts, held to the real builds by
// tests/progressStorage.olderBuilds) — and sealed saves are seeded by hand
// (tests/helpers/progressWorld's seedSealed, which shares no code with the file under test).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'
import {
  Disk,
  Crash,
  MAIN,
  CHUNK,
  blankState,
  chunkId,
  family,
  mainKey,
  meaning,
  mulberry,
  newPage,
  olderPage,
  play,
  sealedChunks,
  seedSealed,
  siloOf,
  timeOf,
} from './helpers/progressWorld.js'

// ★ THE MODULES UNDER TEST ARE LOADED FRESH, BEHIND THE MOCK. tests/setup/dom.js has already loaded
// the stores (and store/progressStorage with them) holding the real reporter, and a mock declared
// here cannot reach a module that is already loaded.
vi.mock('../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
let createProgressCodec, removeProgressCopy, sweepAbandonedTimes, hasTimesKeys, parseTimesKey
let placeChangedElsewhere
let baselineTrimmedTimes, createReaderCodec
let readItem, writeItem, removeItem, useStorageHealth, forgetStorageHealth, captureError
beforeAll(async () => {
  vi.resetModules()
  ;({
    createProgressCodec,
    removeProgressCopy,
    sweepAbandonedTimes,
    hasTimesKeys,
    parseTimesKey,
    baselineTrimmedTimes,
  } = await import('../src/store/progressStorage.js'))
  // The reader builds' codec, loaded behind the same reset so it shares this file's storageHealth.
  ;({ createProgressCodec: createReaderCodec } =
    await import('./fixtures/olderBuilds/progressStorage-v2.29.0.ts'))
  ;({
    readItem,
    writeItem,
    removeItem,
    useStorageHealth,
    forgetStorageHealth,
    placeChangedElsewhere,
  } = await import('../src/store/storageHealth.js'))
  ;({ captureError } = await import('../src/observability/sentry.js'))
})

const BOTH = [
  ['this build (it seals)', false],
  ['the reader builds, v2.28.0 and v2.29.0 (they never start sealing)', true],
]
const disks = []
const disk = () => {
  const d = new Disk()
  disks.push(d)
  return d
}
const page = (d, { reader = false, ...opts } = {}) =>
  newPage(reader ? createReaderCodec : createProgressCodec, d, opts)
const stateWith = (stats) => ({ ...blankState(), stats: { ...blankState().stats, ...stats } })
const mainOf = (d, preset = 1) => JSON.parse(d.items.get(mainKey(preset)))
const siloOnDisk = (d, silo = 'classic', preset = 1) => mainOf(d, preset).state.stats[silo]
// A fresh page of either release reads the same thing, and it is what the main text means.
const expectLoads = (d, state, preset = 1) => {
  expect(meaning(d, d.items.get(mainKey(preset)), preset)?.state).toEqual(state)
  for (const [, reader] of BOTH) {
    const fresh = page(d, { reader, preset })
    fresh.load()
    expect(fresh.state).toEqual(state)
  }
}
const writesSince = (d, mark) => d.log.slice(mark).filter(([op]) => op === 'set')

beforeEach(() => {
  captureError.mockClear()
  forgetStorageHealth() // this file's own copy of the module (see the mock above)
})
afterEach(() => {
  // ★ THE IMMUTABILITY SPY, on every disk any test here made: no chunk key was ever set twice to
  // different text.
  for (const d of disks.splice(0)) expect(d.rewritten).toEqual([])
})

// ★ WHAT A PAGE READS OF ANOTHER TAB'S WRITES CAN LAG THEM. The check that lets a save reuse the
// chunk ids it remembers compares the main key with the text this page last saw — and if that read is
// one write behind, it passes over a reset another tab has just made. The save that follows names
// chunks the reset deleted (that much cannot be prevented: the page cannot see what has not reached
// it). What must not happen is that it goes on naming them: the other tab's change is still reported
// to this page, and its next save puts every chunk back from memory.
describe('a save made on a stale read of the main key', () => {
  it('names chunks another tab just deleted — until the change is reported, and then heals', () => {
    const d = disk()
    const rand = mulberry(41)
    const state = stateWith({ classic: siloOf(2300, rand) })
    seedSealed(d, state)
    const mine = page(d, { name: 'mine' })
    const other = page(d, { name: 'other' })
    mine.load()
    other.load()
    const before = d.items.get(MAIN)
    other.reset('classic') // the other tab: main saved without the silo, its chunks deleted
    expect(d.chunkKeys()).toEqual([])
    // This page answers before that has reached it: its read of the main key is one write stale.
    const read = mine.area.getItem
    mine.area.getItem = (k) => (k === MAIN ? before : read(k))
    mine.update('classic', play.timed(timeOf(rand)))
    mine.area.getItem = read
    const named = siloOnDisk(d).sealed.ids.length
    expect(named).toBeGreaterThan(0)
    expect(d.chunkKeys()).toEqual([]) // …named, and not there: those times read as lost
    const lost = meaning(d, d.items.get(MAIN)).state.stats.classic
    expect(lost.timesLost).toBe(named * CHUNK)
    expect(lost.times).toHaveLength(mine.state.stats.classic.times.length - named * CHUNK)
    // The browser's report of the other tab's write arrives; this page's next save looks.
    placeChangedElsewhere(mine.area, MAIN)
    mine.update('classic', play.timed(timeOf(rand)))
    expect(d.chunkKeys()).toHaveLength(siloOnDisk(d).sealed.ids.length)
    expectLoads(d, mine.state)
    expect(mine.state.stats.classic.times).toHaveLength(2302)
    // …and with nobody heard from since, the save after that reads no chunk back.
    const reads = vi.spyOn(mine.area, 'getItem')
    mine.update('classic', play.timed(timeOf(rand)))
    expect(reads.mock.calls.filter(([k]) => k.startsWith('cg-times-v1'))).toHaveLength(0)
  })
})

describe('sealing on, and the saves that are not sealed', () => {
  it.each(BOTH)(
    'with nothing sealed, a save is written and read byte-for-byte as v2.27.3 does — %s',
    (_label, reader) => {
      // v2.27.3's adapter: zustand's createJSONStorage over store/storageHealth's three functions.
      const before = (area) =>
        createJSONStorage(() => ({
          getItem: (k) => readItem(area, k),
          setItem: (k, v) => writeItem(area, k, v),
          removeItem: (k) => removeItem(area, k),
        }))
      const rand = mulberry(7)
      const now = disk()
      const then = disk()
      const make = reader ? createReaderCodec : createProgressCodec
      const codec = make()
      const old = before(then.view())
      const copy = { area: now.view(), presetId: 1 }
      let state = blankState()
      for (let step = 0; step < 60; step++) {
        const silo = ['classic', 'flash', 'dedYear'][step % 3]
        // Legacy long floats, a legacy gap, bests — and for the reader long histories too (0 … 6,000
        // times: it never starts sealing); this build seals past 1,000, so its plain saves stop there.
        const most = reader ? (step % 5 === 0 ? 6000 : 1300) : 1001
        const n = step % 7 === 0 ? 0 : Math.floor(rand() * most)
        const extra = step % 4 === 0 ? { timesLost: 1 + Math.floor(rand() * 900) } : {}
        const silos = { ...state.stats, [silo]: siloOf(n, rand, extra) }
        if (n) silos[silo].times[0] = 3.456699999999997
        if (extra.timesLost) silos[silo].good += extra.timesLost
        state = { ...state, stats: silos, blitzBest: { [`k${step}`]: { score: step, streak: 1 } } }
        const value = { state, version: 5 }
        codec.save(copy, value)
        old.setItem(MAIN, value)
        expect([...now.items]).toEqual([...then.items]) // the same keys holding the same text
        expect(now.items.get(MAIN)).toBe(JSON.stringify(value))
        expect(make().load(copy)).toEqual(old.getItem(MAIN))
      }
      expect(now.log.every(([, key]) => key === MAIN)).toBe(true)
    },
  )

  it('a save the old cap trimmed (v4) reads as v2.27.3 read it, and is handed on with its version', () => {
    const d = disk()
    const stats = {
      ...blankState().stats,
      classic: { played: 1500, good: 1400, streak: 2, best: 9, times: siloOf(1000).times },
      flash: { played: 900, good: 900, streak: 2, best: 9, times: siloOf(900).times },
    }
    d.put(MAIN, JSON.stringify({ state: { ...blankState(), stats }, version: 4 }))
    const loaded = createProgressCodec().load({ area: d.view(), presetId: 1 })
    expect(loaded.version).toBe(4) // zustand still runs `migrate` and re-saves
    expect(loaded.state.stats.classic.timesLost).toBe(400)
    expect('timesLost' in loaded.state.stats.flash).toBe(false)
    expect(loaded.state.stats).toEqual(baselineTrimmedTimes(stats))
    // …and a v5 save with the same numbers is NOT re-baselined.
    d.put(MAIN, JSON.stringify({ state: { ...blankState(), stats }, version: 5 }))
    expect(createProgressCodec().load({ area: d.view(), presetId: 1 }).state.stats).toEqual(stats)
  })

  it('the reader builds leave a long plain silo plain, however long it plays', () => {
    const d = disk()
    const p = page(d, { reader: true })
    p.state = stateWith({ classic: siloOf(5000) })
    p.save()
    for (let i = 0; i < 300; i++) p.update('classic', play.timed(2 + i / 1000))
    expect(d.chunkKeys()).toEqual([])
    expect(d.items.get(MAIN)).toBe(JSON.stringify({ state: p.state, version: 5 }))
  })

  it('…and this build seals it: chunks first, then the one main write that names them', () => {
    const d = disk()
    const p = page(d)
    p.state = stateWith({ classic: siloOf(5000) })
    p.save()
    const sets = d.log.map(([, key]) => key)
    expect(sets.at(-1)).toBe(MAIN)
    expect(sets.slice(0, -1).every((k) => k.startsWith('cg-times-v1:classic:'))).toBe(true)
    expect(d.chunkKeys()).toHaveLength(sealedChunks(5000))
    const stored = siloOnDisk(d)
    expect(stored.times).toHaveLength(5000 - 19 * CHUNK)
    expect(stored.sealed.n).toBe(19 * CHUNK)
    expect(stored.timesLost).toBe(19 * CHUNK)
    expectLoads(d, p.state)
  })

  it('a silo of exactly 1,000 times is never sealed; the 1,001st seals it', () => {
    const d = disk()
    const p = page(d)
    p.state = stateWith({ classic: siloOf(1000) })
    p.save()
    expect(d.chunkKeys()).toEqual([])
    expect('sealed' in siloOnDisk(d)).toBe(false)
    p.update('classic', play.timed(1.5))
    expect(siloOnDisk(d).sealed.n).toBe(750)
    expect(siloOnDisk(d).times).toHaveLength(251)
    expectLoads(d, p.state)
  })
})

describe.each(BOTH)('codec round trips — %s', (_label, reader) => {
  it('load(save(x)) is x: any lengths, legacy long floats, a legacy gap', () => {
    const rand = mulberry(reader ? 12 : 11)
    for (let round = 0; round < 25; round++) {
      const d = disk()
      // Already sealed on the device where the lengths allow, so both releases save it sealed.
      const lengths = [
        0,
        1,
        999,
        1000,
        1001,
        1249,
        1250,
        1499,
        1500,
        2600,
        Math.floor(rand() * 4000),
      ]
      const stats = {}
      for (const name of ['classic', 'flash', 'dedDay', 'dedMonth', 'dedYear']) {
        const n = lengths[Math.floor(rand() * lengths.length)]
        stats[name] = siloOf(
          n,
          rand,
          rand() < 0.3 ? { timesLost: 1 + Math.floor(rand() * 50) } : {},
        )
        if (stats[name].timesLost) stats[name].good += stats[name].timesLost
        if (n) stats[name].times[n - 1] = 3.456699999999997
      }
      const state = { ...blankState(), stats, aoxBest: { a: { avg: 1.5, med: null } } }
      seedSealed(d, state)
      expectLoads(d, state)
      const p = page(d, { reader })
      p.load()
      p.save()
      expectLoads(d, state)
      for (const name of Object.keys(stats)) {
        const stored = siloOnDisk(d, name)
        expect(stored.sealed?.ids.length ?? 0).toBe(sealedChunks(stats[name].times.length))
        expect(stored.times.length).toBe(stats[name].times.length - (stored.sealed?.n ?? 0))
      }
      // A zero gap is ABSENT in memory (engine/parkedHistory compares it with !==).
      for (const name of Object.keys(stats))
        expect('timesLost' in p.state.stats[name]).toBe('timesLost' in stats[name])
    }
  })

  it('an already-sealed silo is saved back sealed, and seals forward as its tail grows', () => {
    const d = disk()
    const state = stateWith({ classic: siloOf(2000) })
    seedSealed(d, state)
    const p = page(d, { reader })
    p.load()
    expect(p.state).toEqual(state)
    for (let i = 0; i < 600; i++) {
      const mark = d.log.length
      p.update('classic', play.timed(timeOf(Math.random)))
      const len = 2001 + i
      const sets = writesSince(d, mark)
      // One main write per answer; one chunk before it on every 250th time.
      expect(sets.at(-1)[1]).toBe(MAIN)
      expect(sets.length).toBe(len % CHUNK === 0 ? 2 : 1)
      expect(siloOnDisk(d).times.length).toBe(len - sealedChunks(len) * CHUNK)
    }
    expect(siloOnDisk(d).times.length).toBeLessThan(500)
    expectLoads(d, p.state)
  })

  it.each([
    ['1,000 times above the threshold', 2000, 6000],
    ['100,000 times', 100_000, 12_000],
  ])('what an answer writes is bounded — %s', (_what, n, bound) => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(n) }))
    const whole = JSON.stringify(siloOf(n).times).length
    const p = page(d, { reader })
    p.load()
    expect(p.state.stats.classic.times).toHaveLength(n)
    let most = 0
    let chunks = 0
    for (let i = 0; i < 520; i++) {
      const mark = d.log.length
      p.update('classic', play.timed(timeOf(Math.random)))
      const sets = writesSince(d, mark)
      const chars = sets.reduce((sum, [, key, length]) => sum + key.length + length, 0)
      most = Math.max(most, chars)
      chunks += sets.length - 1
      expect(writesSince(d, mark).at(-1)[1]).toBe(MAIN)
    }
    expect(chunks).toBe(Math.floor((n + 520) / CHUNK) - Math.floor(n / CHUNK))
    expect(most).toBeLessThan(bound)
    if (n === 100_000) expect(most).toBeLessThan(whole / 50) // the old cost was the whole array
    expectLoads(d, p.state)
  })

  it('an Override in the tail writes the main key only; a deep one re-seals from its chunk on', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(3000) }))
    const p = page(d, { reader })
    p.load()
    const original = d.chunkKeys()
    let mark = d.log.length
    p.update('classic', play.takeBack(2990))
    expect(writesSince(d, mark).map(([, k]) => k)).toEqual([MAIN])
    expectLoads(d, p.state)

    // Deep: the time at 600 (chunk 2) goes. Chunks 0 and 1 keep their names; 2… are written anew.
    const before = p.state
    mark = d.log.length
    p.update('classic', play.takeBack(600))
    const written = writesSince(d, mark).map(([, k]) => k)
    expect(written.at(-1)).toBe(MAIN)
    expect(written.slice(0, -1).map((k) => parseTimesKey(k).index)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ])
    for (const key of original) expect(d.items.has(key)).toBe(true) // the old chunks are KEPT
    expectLoads(d, p.state)

    // Undoing it spells the old chunks again — found by name, nothing written but the main key.
    mark = d.log.length
    p.state = before
    p.save()
    expect(writesSince(d, mark).map(([, k]) => k)).toEqual([MAIN])
    const byIndex = original.map(parseTimesKey).sort((x, y) => x.index - y.index)
    expect(siloOnDisk(d).sealed.ids).toEqual(byIndex.slice(0, 10).map((k) => k.id))
    expectLoads(d, before)
  })

  it('a sealed silo that falls to 1,000 times is saved plain again', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(1001) }))
    const p = page(d, { reader })
    p.load()
    p.update('classic', play.takeBack(1000))
    expect('sealed' in siloOnDisk(d)).toBe(false)
    expect(siloOnDisk(d).times).toHaveLength(1000)
    expectLoads(d, p.state)
    p.update('classic', play.timed(2)) // back to 1,001
    expect('sealed' in siloOnDisk(d)).toBe(!reader) // only this build seals it again
    expectLoads(d, p.state)
  })

  it('Reset Stats: the main key first, then exactly the chunks this page knew — never the family next door', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(3000), flash: siloOf(2000) }))
    seedSealed(d, stateWith({ classic: siloOf(2000) }), { preset: 12 })
    const p = page(d, { reader })
    p.load()
    const flash = d.chunkKeys().filter((k) => k.includes(':flash:'))
    const mark = d.log.length
    p.reset('classic')
    const ops = d.log.slice(mark)
    expect(ops[0].slice(0, 2)).toEqual(['set', MAIN])
    expect(ops.slice(1).every(([op, key]) => op === 'remove' && key.includes(':classic:'))).toBe(
      true,
    )
    expect(ops).toHaveLength(1 + sealedChunks(3000))
    expect(d.chunkKeys()).toEqual(flash)
    expect(d.chunkKeys(12)).toHaveLength(sealedChunks(2000))
    expectLoads(d, p.state)
  })

  it('a reset whose main save is REFUSED deletes nothing until a save lands', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(3000) }))
    const p = page(d, { reader })
    p.load()
    const kept = d.chunkKeys()
    const before = p.state
    d.limit = 0 // nothing fits, not even a smaller main
    p.reset('classic')
    expect(d.chunkKeys()).toEqual(kept)
    expect(useStorageHealth.getState().unsaved).toBe(true)
    expectLoads(d, before) // the device still holds every time
    d.limit = Infinity
    p.update('flash', play.wrong)
    expect(d.chunkKeys()).toEqual([])
    expect(useStorageHealth.getState().unsaved).toBe(false)
    expectLoads(d, p.state)
  })

  it('chunks an OLDER build left behind go at the first save that lands — by the names seen at load', () => {
    const d = disk()
    const state = stateWith({ classic: siloOf(3000), flash: siloOf(1500) })
    seedSealed(d, state)
    const older = olderPage('v2.27.3', d)
    older.load()
    older.reset('classic') // drops `sealed`; knows nothing of chunks
    older.update('classic', play.timed(2.5))
    expect(d.chunkKeys().filter((k) => k.includes(':classic:'))).toHaveLength(sealedChunks(3000))
    const p = page(d, { reader })
    p.load()
    expect(d.log.filter(([, , , who]) => who === 'N')).toEqual([]) // a load writes nothing
    p.update('classic', play.timed(3.5))
    expect(d.chunkKeys().every((k) => k.includes(':flash:'))).toBe(true)
    expect(d.chunkKeys()).toHaveLength(sealedChunks(1500))
    expectLoads(d, p.state)
  })

  it('…but a chunk that still spells the times a COMPLETE plain copy holds is kept', () => {
    // A stale older page (loaded before the silo was sealed) saves every time back, plain. Another
    // older page may still hold the sealed save that names these chunks — and the next sealing save
    // names them again.
    const d = disk()
    const state = stateWith({ classic: siloOf(3000) })
    seedSealed(d, state)
    const chunks = d.chunkKeys()
    d.put(MAIN, JSON.stringify({ state, version: 5 })) // the stale page's complete copy
    const p = page(d, { reader })
    p.load()
    const mark = d.log.length
    p.update('classic', play.timed(3.5))
    expect(d.chunkKeys()).toEqual(chunks)
    expect(writesSince(d, mark).map(([, k]) => k)).toEqual([MAIN]) // re-sealing writes no chunk
    expect('sealed' in siloOnDisk(d)).toBe(!reader)
    expectLoads(d, p.state)
  })

  it('chunk keys with no main key at all are left-behind too', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(3000) }))
    d.remove(MAIN)
    const p = page(d, { reader })
    expect(p.load()).toBeNull()
    p.update('flash', play.wrong)
    expect(d.chunkKeys()).toEqual([])
  })

  it('two pages taking turns: each save is that page’s whole state, exactly', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(2600) }))
    const a = page(d, { reader, name: 'A' })
    const b = page(d, { reader, name: 'B' })
    a.load()
    b.load()
    for (let i = 0; i < 40; i++) {
      const p = i % 3 ? a : b
      p.update('classic', i % 7 === 3 ? play.takeBack(100 + i) : play.timed(1 + i / 100))
      expectLoads(d, p.state)
    }
  })

  it('while its own save is held, a page re-checks its chunks — another page’s reset cannot strand them', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(3000) }))
    const a = page(d, { reader, name: 'A' })
    const b = page(d, { reader, name: 'B' })
    a.load()
    b.load()
    d.limit = d.used // full: A's next save is refused and held
    a.update('classic', play.timed(2.25))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    b.reset('classic') // smaller, so it lands — and B deletes the chunks
    expect(d.chunkKeys()).toEqual([])
    d.limit = Infinity
    a.update('classic', play.timed(2.5))
    expectLoads(d, a.state)
    expect(a.state.stats.classic.times).toHaveLength(3002)
  })
})

describe('a full device', () => {
  it('a chunk the device refuses is simply not sealed: nothing is unsaved, and the next save tries again', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(2249) }))
    const p = page(d, { reader: true })
    p.load()
    d.limit = d.used + 40 // room for one more time in the main key, not for a 1.7 KB chunk
    p.update('classic', play.timed(2.5)) // the 2,250th: a chunk is due
    expect(siloOnDisk(d).times).toHaveLength(500) // …and stays in the tail
    expect(useStorageHealth.getState().unsaved).toBe(false)
    expectLoads(d, p.state)
    d.limit = Infinity
    p.update('classic', play.wrong)
    expect(siloOnDisk(d).times).toHaveLength(250)
    expectLoads(d, p.state)
  })

  it('a refused main save is held for this page, and lands when room appears', () => {
    const d = disk()
    seedSealed(d, stateWith({ classic: siloOf(2249) }))
    const before = meaning(d, d.items.get(MAIN)).state
    const p = page(d)
    p.load()
    d.limit = d.used // full: neither the chunk that is due nor the grown main key fits
    p.update('classic', play.timed(2.5))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    expect(meaning(d, d.items.get(MAIN)).state).toEqual(before) // the device is behind…
    expect(meaning(d, readItem(p.area, MAIN)).state).toEqual(p.state) // …this page is not
    d.limit = Infinity
    p.update('classic', play.wrong)
    expect(useStorageHealth.getState().unsaved).toBe(false)
    expect(siloOnDisk(d).times).toHaveLength(250)
    expectLoads(d, p.state)
  })

  it('sealing a long plain silo on a device more than half full converges, losing nothing', () => {
    const d = disk()
    const p = page(d)
    p.state = stateWith({ classic: siloOf(20_000) })
    d.put(MAIN, JSON.stringify({ state: p.state, version: 5 }))
    d.limit = Math.floor(d.used * 1.3) // 77% full: the chunks cannot all fit beside the old main
    p.load()
    let saves = 0
    while (siloOnDisk(d).times.length >= 500) {
      p.update('classic', play.wrong)
      expect(useStorageHealth.getState().unsaved).toBe(false)
      expectLoads(d, p.state)
      expect(++saves).toBeLessThan(8)
    }
    expect(saves).toBeGreaterThan(1) // it really did take more than one pass
    expect(d.used).toBeLessThan(d.limit)
  })
})

describe('crash injection: the page dies at every write of a save', () => {
  const scenarios = {
    'sealing a long plain silo': (d) => {
      const p = page(d)
      p.state = stateWith({ classic: siloOf(3000, mulberry(1)) })
      d.put(MAIN, JSON.stringify({ state: p.state, version: 5 }))
      p.load()
      return [p, () => p.update('classic', play.timed(2.5))]
    },
    'sealing forward': (d) => {
      seedSealed(d, stateWith({ classic: siloOf(2249, mulberry(2)) }))
      const p = page(d)
      p.load()
      return [p, () => p.update('classic', play.timed(2.5))]
    },
    'a deep Override': (d) => {
      seedSealed(d, stateWith({ classic: siloOf(3000, mulberry(3)) }))
      const p = page(d)
      p.load()
      return [p, () => p.update('classic', play.takeBack(10))]
    },
    'Reset Stats': (d) => {
      seedSealed(
        d,
        stateWith({ classic: siloOf(3000, mulberry(4)), flash: siloOf(1300, mulberry(5)) }),
      )
      const p = page(d)
      p.load()
      return [p, () => p.reset('classic')]
    },
  }
  it.each(Object.keys(scenarios))('%s', (name) => {
    // How many writes the save makes when nothing goes wrong.
    const clean = disk()
    const [, run] = scenarios[name](clean)
    const mark = clean.log.length
    run()
    const writes = clean.log.length - mark
    expect(writes).toBeGreaterThan(1)
    for (let k = 1; k <= writes; k++) {
      const d = disk()
      const [p, act] = scenarios[name](d)
      const before = meaning(d, d.items.get(MAIN)).state
      d.crashIn = k
      expect(act).toThrow(Crash)
      // The device holds the state from before, or the whole new one — never anything between.
      const now = meaning(d, d.items.get(MAIN)).state
      expect([before, p.state]).toContainEqual(now)
      expectLoads(d, now)
      // The next open finishes the job, and leaves nothing a reset should have removed.
      const again = page(d, { reader: name !== 'sealing a long plain silo' })
      again.load()
      again.state = p.state
      again.save()
      expectLoads(d, p.state)
      if (name === 'Reset Stats') {
        again.load()
        again.update('flash', play.wrong)
        expect(d.chunkKeys().some((key) => key.includes(':classic:'))).toBe(false)
      }
    }
  })
})

describe('corruption', () => {
  const sealed = () => {
    const d = disk()
    const state = stateWith({ classic: siloOf(3000, mulberry(9), { timesLost: 7, good: 3007 }) })
    seedSealed(d, state)
    return [d, state, d.chunkKeys().sort((a, b) => parseTimesKey(a).index - parseTimesKey(b).index)]
  }
  // Chunk 3's 250 times are gone; every other time is read, and the gap is counted.
  const without3 = (state) => ({
    ...state,
    stats: {
      ...state.stats,
      classic: {
        ...state.stats.classic,
        times: [
          ...state.stats.classic.times.slice(0, 750),
          ...state.stats.classic.times.slice(1000),
        ],
        timesLost: 257,
      },
    },
  })
  const broken = {
    'a missing chunk': (d, key) => d.remove(key),
    'a truncated chunk': (d, key) => d.put(key, d.items.get(key).slice(0, 900)),
    'a chunk holding other times (wrong hash)': (d, key) =>
      d.put(key, JSON.stringify(siloOf(250).times)),
    'a chunk that is not a list of times': (d, key) => d.put(key, '{"a":1}'),
  }
  it.each(Object.keys(broken))('%s costs exactly its own 250 times', (what) => {
    const [d, state, keys] = sealed()
    broken[what](d, keys[3])
    const p = page(d)
    p.load()
    expect(p.state).toEqual(without3(state))
    expect(captureError).toHaveBeenCalledTimes(1)
    // The next save re-seals what is left, and it reads back whole from then on.
    p.update('classic', play.timed(2.5))
    captureError.mockClear()
    expectLoads(d, p.state)
    expect(captureError).not.toHaveBeenCalled()
    expect(siloOnDisk(d).timesLost).toBe(257 + siloOnDisk(d).sealed.n)
  })

  it('a chunk of the wrong length is refused even when its name matches its text', () => {
    const [d, state, keys] = sealed()
    const short = JSON.stringify(state.stats.classic.times.slice(750, 999))
    const main = JSON.parse(d.items.get(MAIN))
    main.state.stats.classic.sealed.ids[3] = chunkId(short)
    d.remove(keys[3])
    d.put(`${family(1)}classic:3.${chunkId(short)}`, short)
    d.put(MAIN, JSON.stringify(main))
    const p = page(d)
    p.load()
    expect(p.state).toEqual(without3(state))
  })

  it.each([
    ['the count is not its chunks’ worth', (s) => ({ ...s.sealed, n: s.sealed.n - 1 })],
    ['more sealed than the gap covers', (s) => s.sealed, (s) => s.sealed.n - 1],
    ['ids that are not names', (s) => ({ ...s.sealed, ids: s.sealed.ids.map(() => 7) })],
    ['no ids', () => ({ n: 0, ids: [] })],
    ['not a record', () => 5],
  ])(
    'a malformed `sealed` (%s) is dropped: the gap stands, the chunks are left alone',
    (_w, bad, lost) => {
      const [d, , keys] = sealed()
      const main = JSON.parse(d.items.get(MAIN))
      const silo = main.state.stats.classic
      const stored = { ...silo, sealed: bad(silo) }
      if (lost) stored.timesLost = lost(silo)
      main.state.stats.classic = stored
      d.put(MAIN, JSON.stringify(main))
      const p = page(d)
      p.load()
      const { sealed: _gone, ...rest } = stored
      expect(p.state.stats.classic).toEqual(rest)
      expect(captureError).toHaveBeenCalledTimes(1)
      p.update('flash', play.wrong)
      expect(d.chunkKeys()).toEqual(keys.slice().sort())
    },
  )

  it('a main key that is not JSON throws out of the load, as it always did', () => {
    const d = disk()
    d.put(MAIN, '{"state":')
    expect(() => page(d).load()).toThrow(SyntaxError)
  })

  it('a name already taken by other text gets a numbered suffix — nothing is overwritten', () => {
    const d = disk()
    const p = page(d)
    p.state = stateWith({ classic: siloOf(1300, mulberry(21)) })
    const text = JSON.stringify(p.state.stats.classic.times.slice(0, CHUNK))
    d.put(`${family(1)}classic:0.${chunkId(text)}`, '[1,2,3]')
    p.save()
    expect(siloOnDisk(d).sealed.ids[0]).toBe(`${chunkId(text)}.1`)
    expect(d.items.get(`${family(1)}classic:0.${chunkId(text)}`)).toBe('[1,2,3]')
    expectLoads(d, p.state)
  })
})

describe('older builds on the same device', () => {
  it.each(BOTH)(
    'v2.26.0 plays a sealed silo past its 1,000 cap and trims — %s reads it exactly',
    (_l, reader) => {
      const d = disk()
      const state = stateWith({ classic: siloOf(2499) }) // sealed: 8 chunks + a 499-time tail
      seedSealed(d, state)
      const old = olderPage('v2.26.0', d)
      old.load()
      for (let i = 0; i < 520; i++) old.update('classic', play.timed(1 + i / 1000))
      expect(siloOnDisk(d).times).toHaveLength(1000)
      expect(mainOf(d).version).toBe(4)
      const p = page(d, { reader })
      p.load()
      const got = p.state.stats.classic
      expect(got.times).toHaveLength(2000 + 1000)
      expect(got.timesLost).toBe(19) // the 19 times that build's trim threw away, and nothing else
      expect(got.good - got.timesLost).toBe(got.times.length)
      expect(mainOf(d).version).toBe(5) // re-saved at once, as zustand does after a migration
      expectLoads(d, p.state)
    },
  )

  it.each(BOTH)(
    'v2.27.3 appends to the tail of a sealed save — %s reads every time',
    (_l, reader) => {
      const d = disk()
      const state = stateWith({ classic: siloOf(3000) })
      seedSealed(d, state)
      const old = olderPage('v2.27.3', d)
      old.load()
      for (let i = 0; i < 700; i++) old.update('classic', play.timed(1 + i / 1000))
      const p = page(d, { reader })
      p.load()
      expect(p.state.stats.classic.times).toHaveLength(3700)
      expect('timesLost' in p.state.stats.classic).toBe(false)
      p.update('classic', play.timed(9)) // …and seals the long tail forward
      expect(siloOnDisk(d).times.length).toBeLessThan(500)
      expectLoads(d, p.state)
    },
  )
})

describe('whole copies', () => {
  it('removeProgressCopy takes the main key and that preset’s chunks in THAT area only', () => {
    const local = disk()
    const session = disk()
    for (const d of [local, session]) {
      seedSealed(d, stateWith({ classic: siloOf(1500) }))
      seedSealed(d, stateWith({ classic: siloOf(1500) }), { preset: 12 })
      seedSealed(d, stateWith({ classic: siloOf(1500) }), { preset: 2 })
    }
    const everything = [...session.items.keys()]
    removeProgressCopy({ area: local.view(), presetId: 1 })
    expect(local.items.has(MAIN)).toBe(false)
    expect(local.chunkKeys(1)).toEqual([])
    expect(local.chunkKeys(12)).toHaveLength(5)
    expect(local.chunkKeys(2)).toHaveLength(5)
    expect(local.items.has(mainKey(12))).toBe(true)
    expect([...session.items.keys()]).toEqual(everything)
    expect(hasTimesKeys({ area: local.view(), presetId: 1 })).toBe(false)
    expect(hasTimesKeys({ area: local.view(), presetId: 2 })).toBe(true)
  })

  it('the fresh-open sweep removes only a preset nobody vouches for AND that has no main key', () => {
    const d = disk()
    for (const preset of [1, 2, 3, 4])
      seedSealed(d, stateWith({ classic: siloOf(1500) }), { preset })
    d.remove(mainKey(2)) // an older build deleted preset 2: its four keys, no chunk
    d.remove(mainKey(4)) // …preset 4 still exists, and merely has no main key
    sweepAbandonedTimes(d.view(), (id) => id === 1 || id === 4)
    expect(d.chunkKeys(2)).toEqual([])
    expect(d.chunkKeys(1)).toHaveLength(5)
    expect(d.chunkKeys(3)).toHaveLength(5) // not vouched for, but it has a main key
    expect(d.chunkKeys(4)).toHaveLength(5)
  })

  it('reads a chunk key apart, and refuses what is not one', () => {
    expect(parseTimesKey('cg-times-v1:dedYear:12.abc.1')).toEqual({
      presetId: 1,
      silo: 'dedYear',
      index: 12,
      id: 'abc.1',
    })
    expect(parseTimesKey('cg-times-v1~p12:classic:0.zz')?.presetId).toBe(12)
    for (const not of [
      'cg-progress-v1',
      'cg-times-v1',
      'cg-times-v1~px:classic:0.a',
      'cg-times-v1:classic:x.a',
      'cg-times-v1:classic',
    ])
      expect(parseTimesKey(not)).toBeNull()
  })
})
