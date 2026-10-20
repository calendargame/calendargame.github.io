// progressStorage.fuzz — ONE DEVICE, FOUR BUILDS, RANDOM INTERLEAVINGS, AGAINST A MODEL.
//
// Live and staging are one browser origin, so the saved progress is read and written by whatever is
// open: two pages of the sealing line (each either this build, which seals, or a READER build —
// v2.28.0 / v2.29.x, which never starts sealing — run as its own recorded code), a v2.27.3 page and
// a v2.26.0 page (tests/helpers/progressWorld's models; every older model is held to the real builds
// by tests/progressStorage.olderBuilds). A page's `seal` says which of the first two it is. Each step one of them does one thing —
// loads, answers (timed, untimed, wrong, a long run), Overrides near the end or deep in the history,
// resets a mode, Full Resets, deletes or switches preset, turns Amnesic on or off, reloads, dies
// after the k-th write of a save — while the device is sometimes full.
//
// ★ THE ORACLE, after every step, for both presets:
//   1. What the main key means, read by the layout's definition alone (progressWorld's `meaning`),
//      is exactly what a fresh page of EITHER codec (this build's, the reader builds') loads.
//   2. That is exactly the state of the page whose save last landed there — its own state for a
//      page of this line, what its text meant when it landed for an older page.
//   3. No chunk key was ever written twice with different text.
//   4. Every stats invariant holds in every build's view of the save, and "correct answers and
//      saved times disagree" is true in no view unless an answer really was given with timing hidden.
//   5. A main key a page of this line saved names no chunk that is missing.
// ★ THE ONE STRAND, counted rather than forbidden: an older page holding a sealed save writes after
// a page of this line deleted chunks it names (a reset, or a clear-up after a complete plain copy
// was saved over them). The counts come back, the times in those chunks do not, and they are counted
// as lost — never doubled, never a false popup. It is allowed ONLY when chunks really were deleted
// since that page loaded, and the last group below shows it cannot happen without two things: a page
// of this line deleting, and an older page already holding the sealed save.
// ★ …AND ITS TWIN, in the `stale` worlds: what a page reads of another tab's writes can lag them, so
// a page of THIS line may save having compared the main key with a copy one write out of date —
// passing over a deletion it has not been told of yet. That one save may name chunks that are gone
// (the same strand, allowed only when chunks really were deleted since the page last looked). The
// report of the other tab's write reaches it right after, and from its NEXT save on every chunk it
// names must be there again: the oracle holds it to the letter as soon as the report has arrived.
import { describe, it, expect, beforeEach } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { createProgressCodec, removeProgressCopy } from '../src/store/progressStorage.js'
import { createProgressCodec as createReaderCodec } from './fixtures/olderBuilds/progressStorage-v2.29.0.ts'
import { placeChangedElsewhere, forgetStorageHealth } from '../src/store/storageHealth.js'
import { checkStatsInvariants } from '../src/engine/invariants.js'
import {
  Disk,
  Crash,
  blank,
  blankState,
  family,
  mainKey,
  meaning,
  mulberry,
  newPage,
  olderPage,
  play,
  seedSealed,
  siloOf,
  timeOf,
} from './helpers/progressWorld.js'

// modes/modeHooks' timingMismatch, as each build spells it.
const mismatch = (s) => s.good - (s.timesLost ?? 0) !== s.times.length
const mismatchV226 = (s) => s.good !== s.times.length
const PRESETS = [1, 12] // 12 on purpose: preset 1's chunk prefix must never match it
const SILOS = ['classic', 'flash']

// Whole chunks of one page's times, gone from (or back in) what a save means — counted in
// `timesLost`, every count untouched. Says whether any are gone.
function wholeChunksLost(was, means) {
  let lost = false
  for (const silo of Object.keys(was.stats)) {
    const held = was.stats[silo]
    const got = means.stats[silo]
    const gone = held.times.length - got.times.length
    expect(Math.abs(gone) % 250).toBe(0)
    expect((got.timesLost ?? 0) - (held.timesLost ?? 0)).toBe(gone)
    expect([got.played, got.good, got.streak, got.best]).toEqual([
      held.played,
      held.good,
      held.streak,
      held.best,
    ])
    if (gone > 0) lost = true
  }
  return lost
}

function world(seed, { seals, older, deletes, stale = false }) {
  const rand = mulberry(seed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const local = new Disk()
  const expected = new Map() // main key → the state that last landed there (null: removed)
  // `${key}:${silo}` whose correct answers and saved times may honestly disagree: an answer was
  // given there with timing hidden — or a v2.26.0 page took a credit back from a silo it had
  // trimmed to 1,000 times. That save is spelled exactly like a real mismatch (999 times beside
  // 1,000 correct answers is also 999 timed answers and one untimed), that build writes nothing
  // that tells them apart, and it asks "Enable and Reset Stats?" of it itself — so no reader can
  // recognise the trim, and store/progressStorage's baselineTrimmedTimes says why it does not
  // guess. The exemption is exactly that act: a take-back, by that build, from a silo holding more
  // correct answers than times.
  const untimed = new Set()
  const trimmed = new Set() // `${key}:${silo}` a v2.26.0 page has trimmed
  const oursLast = new Set() // main keys whose last landed save was a page of this line's
  const staleSaved = new Set() // …and was made on a stale read, naming chunks that had just gone
  let removals = 0 // chunk keys deleted so far
  let strands = 0
  let backs = 0
  const pages = []
  const trace = [] // what each step did, for a failure's message

  for (const preset of PRESETS) {
    const state = {
      ...blankState(),
      stats: {
        ...blankState().stats,
        classic: siloOf(900 + Math.floor(rand() * 1900), rand),
        flash: siloOf(Math.floor(rand() * 1300), rand),
      },
    }
    if (rand() < 0.6) seedSealed(local, state, { preset })
    else local.put(mainKey(preset), JSON.stringify({ state, version: 5 }))
    expected.set(mainKey(preset), state)
  }

  const isOurs = (p) => p.build === undefined
  local.onMain = (who, key, text, old) => {
    const writer = pages.find((p) => p.name === who)
    const preset = PRESETS.find((id) => mainKey(id) === key)
    // A save made by a page of this line, directly, IS that page's state (the check after the step
    // holds what the text means to it, to the letter).
    if (writer && isOurs(writer) && writer.saving === key) {
      const means = writer.lagging?.has(key) ? meaning(local, text, preset).state : writer.state
      staleSaved.delete(key)
      if (!isDeepStrictEqual(means, writer.state)) {
        // THE STRAND'S TWIN: a save made on a stale read of this key.
        expect(wholeChunksLost(writer.state, means)).toBe(true)
        countRemovals()
        expect(removals).toBeGreaterThan(writer.removalsSeen)
        staleSaved.add(key)
        strands++
      }
      expected.set(key, means)
      oursLast.add(key)
    } else {
      // An older page's save, or a held save landing later: what its text means as it lands.
      const means = meaning(local, text, preset).state
      expected.set(key, means)
      if (writer && isOurs(writer)) oursLast.add(key)
      else oursLast.delete(key)
      // A save a page of this line was HOLDING, landing while the news of another page's write has
      // not reached it: the twin again — it was composed before a deletion that page has not heard
      // of (and, landing in the middle of that other save, may be followed by its deletions).
      if (writer && isOurs(writer) && writer.pending?.has(key)) staleSaved.add(key)
      else staleSaved.delete(key)
      if (writer?.shadow && !isDeepStrictEqual(means, writer.shadow)) {
        // A v2.27.3 page: what it believes it holds, kept beside it, is what its save means —
        // unless whole chunks it names came or went since it loaded. GONE is THE STRAND, and needs
        // a deletion; BACK is another page having written the same times again under the same
        // names. Either way: whole chunks, counted in `timesLost`, every count untouched.
        if (wholeChunksLost(writer.shadow, means)) {
          expect(removals).toBeGreaterThan(writer.removalsAtLoad)
          strands++
        }
        writer.shadow = means
      }
    }
    // The browser tells every OTHER page that this key changed; store/storageHealth forgets what
    // that page was holding for it. In a `stale` world the news sometimes reaches a page late: until
    // its next save is done it reads the text this write replaced, and is told only afterwards.
    for (const p of pages) {
      if (p === writer || !isOurs(p)) continue
      if (stale && rand() < 0.5) (p.pending ??= new Map()).set(key, old ?? null)
      else {
        p.pending?.delete(key)
        placeChangedElsewhere(p.area, key)
      }
    }
  }
  let seen = 0
  const countRemovals = () => {
    for (; seen < local.log.length; seen++) {
      const [op, key] = local.log[seen]
      if (op === 'remove' && key.startsWith('cg-times-v1')) removals++
    }
  }

  // ── The pages ──
  const ours = (name, seal) => {
    const p = newPage(seal ? createProgressCodec : createReaderCodec, local, {
      preset: pick(PRESETS),
      name,
    })
    p.seal = seal
    p.session = null
    // A stale read: while `lagging` names a key, this page reads the text another page's last
    // write to it replaced.
    const read = p.area.getItem
    p.area.getItem = (k) => (p.lagging?.has(k) ? p.lagging.get(k) : read(k))
    const save = p.save
    p.save = () => {
      p.saving = p.copy.area === p.area ? mainKey(p.copy.presetId) : null
      p.lagging = p.pending?.size ? p.pending : null
      p.pending = null
      try {
        save()
      } finally {
        p.saving = null
        // …and now the news arrives.
        for (const key of p.lagging?.keys() ?? []) placeChangedElsewhere(p.area, key)
        p.lagging = null
        countRemovals()
        p.removalsSeen = removals
      }
    }
    p.load()
    countRemovals()
    p.removalsSeen = removals
    return p
  }
  const theirs = (build, name) => {
    const p = olderPage(build, local, { preset: pick(PRESETS), name })
    const load = p.load
    p.load = () => {
      p.shadow = null // nothing is believed while loading (a re-stamped save lands mid-load)
      load()
      p.removalsAtLoad = removals
      if (build === 'v2.27.3')
        p.shadow =
          meaning(local, local.items.get(mainKey(p.preset)), p.preset)?.state ?? blankState()
    }
    p.load()
    return p
  }
  seals.forEach((seal, i) => pages.push(ours(`N${i + 1}`, seal)))
  older.forEach((build, i) => pages.push(theirs(build, `${build}#${i + 1}`)))

  const presetOf = (p) => (isOurs(p) ? p.copy.presetId : p.preset)
  const onLocal = (p) => !isOurs(p) || p.copy.area === p.area
  // One change to one silo: the page's own state, and (v2.27.3) the shadow of what it believes.
  const change = (p, silo, fn, shadowFn = fn) => {
    if (p.shadow)
      p.shadow = {
        ...p.shadow,
        stats: { ...p.shadow.stats, [silo]: shadowFn(p.shadow.stats[silo]) },
      }
    p.update(silo, fn)
  }
  const reload = (p) => {
    // A reload (or a crash) is a new page: what the old one was holding in memory is gone.
    placeChangedElsewhere(p.area, null)
    p.shadow = null
    const fresh = isOurs(p) ? ours(p.name, p.seal) : theirs(p.build, p.name)
    pages[pages.indexOf(p)] = fresh
  }

  const step = () => {
    const p = pick(pages)
    const silo = pick(SILOS)
    const key = mainKey(presetOf(p))
    const held = p.state.stats[silo]
    const roll = rand()
    const crashing = isOurs(p) && onLocal(p) && rand() < 0.06
    if (crashing) local.crashIn = 1 + Math.floor(rand() * 5)
    trace.push(
      `${p.name}${onLocal(p) ? '' : '(amnesic)'} p${presetOf(p)} ${silo} roll=${roll.toFixed(3)}` +
        ` holds=${held.times.length}${crashing ? ` crashIn=${local.crashIn}` : ''}` +
        `${local.limit === Infinity ? '' : ' FULL'}`,
    )
    try {
      if (roll < 0.3) change(p, silo, play.timed(timeOf(rand)))
      else if (roll < 0.36) {
        // A long run: across chunk boundaries, and past v2.26.0's 1,000 cap.
        for (let i = 0, n = 120 + Math.floor(rand() * 260); i < n; i++)
          change(p, silo, play.timed(timeOf(rand)))
      } else if (roll < 0.42) {
        if (onLocal(p)) untimed.add(`${key}:${silo}`)
        change(p, silo, play.untimed)
      } else if (roll < 0.5) change(p, silo, play.wrong)
      else if (roll < 0.6 && held.times.length > 0) {
        // An Override near the end — the page's own end; for an older page that is the tail.
        const i = held.times.length - 1 - Math.floor(rand() * Math.min(200, held.times.length))
        const back = held.times.length - i
        if (p.build === 'v2.26.0' && held.good > held.times.length) untimed.add(`${key}:${silo}`)
        change(p, silo, play.takeBack(i), (s) => play.takeBack(s.times.length - back)(s))
      } else if (roll < 0.66 && isOurs(p) && held.times.length > 600) {
        change(p, silo, play.takeBack(Math.floor(rand() * (held.times.length - 500)))) // a deep one
      } else if (roll < 0.7 && deletes) change(p, silo, blank)
      else if (roll < 0.72 && deletes) {
        if (p.shadow) p.shadow = blankState()
        p.fullReset()
      } else if (roll < 0.75 && deletes && onLocal(p)) {
        // Delete the preset the page is on, and open the other one.
        const gone = presetOf(p)
        const other = PRESETS.find((id) => id !== gone)
        if (isOurs(p)) removeProgressCopy({ area: p.area, presetId: gone })
        else p.deletePreset()
        for (const q of pages)
          if (q !== p && isOurs(q)) placeChangedElsewhere(q.area, mainKey(gone))
        if (isOurs(p)) p.copy = { area: p.area, presetId: other }
        else p.preset = other
        p.load()
      } else if (roll < 0.8 && onLocal(p)) {
        const other = PRESETS.find((id) => id !== presetOf(p))
        if (isOurs(p)) p.copy = { area: p.area, presetId: other }
        else p.preset = other
        p.load()
      } else if (roll < 0.85 && isOurs(p)) {
        // Amnesic on (a session copy of its own, starting at zero) or off (it is thrown away).
        if (onLocal(p)) {
          p.session = new Disk()
          p.copy = { area: p.session.view(p.name), presetId: presetOf(p) }
        } else {
          removeProgressCopy(p.copy)
          expect(p.session.items.size).toBe(0)
          p.copy = { area: p.area, presetId: presetOf(p) }
        }
        p.load()
      } else if (roll < 0.93) reload(p)
      else
        local.limit = local.limit === Infinity ? local.used + Math.floor(rand() * 4000) : Infinity
    } catch (e) {
      if (!(e instanceof Crash)) throw e
      reload(p)
    }
    local.crashIn = 0
    countRemovals()
    if (p.build === 'v2.26.0' && p.state.stats[silo].times.length === 1000)
      trimmed.add(`${mainKey(p.preset)}:${silo}`)
    for (const id of PRESETS) if (!local.items.has(mainKey(id))) expected.set(mainKey(id), null)
  }

  const check = () => {
    expect(local.rewritten).toEqual([])
    for (const preset of PRESETS) {
      const key = mainKey(preset)
      const text = local.items.get(key)
      if (expected.get(key) === null) {
        expect(text).toBeUndefined()
        continue
      }
      const means = meaning(local, text, preset)
      if (staleSaved.has(key) && !isDeepStrictEqual(means.state, expected.get(key))) {
        wholeChunksLost(expected.get(key), means.state)
        expected.set(key, means.state)
      }
      // BACK, after the save landed: chunks its text names that were gone when it landed (a strand) are
      // there again - another page sealed the same times under the same names (a chunk's name is the
      // hash of its text at its position, so what comes back is what the save named). Whole chunks,
      // every count untouched, `timesLost` down by exactly them; never a chunk GONE (that needs a main
      // write, judged where it lands). Reached since a Reset takes every chunk key of its mode
      // (store/progressStorage's rule a), not only the ones its page knew.
      if (!isDeepStrictEqual(means.state, expected.get(key))) {
        expect(wholeChunksLost(expected.get(key), means.state)).toBe(false)
        backs++
        expected.set(key, means.state)
      }
      expect(means.state).toEqual(expected.get(key))
      for (const make of [createReaderCodec, createProgressCodec]) {
        const loaded = make().load({
          area: local.view('check'),
          presetId: preset,
        })
        expect(loaded.state).toEqual(means.state)
      }
      const raw = JSON.parse(text)
      for (const silo of SILOS) {
        const ours = means.state.stats[silo]
        const stored = raw.state.stats[silo]
        // v2.27.3 reads the stored silo as it is (after recording a pre-v5 trim); v2.26.0 likewise,
        // and knows no `timesLost`.
        const v2273 =
          raw.version < 5 && stored.times.length === 1000 && stored.good > 1000
            ? { ...stored, timesLost: stored.good - 1000 }
            : stored
        expect(checkStatsInvariants(ours, silo)).toEqual([])
        expect(checkStatsInvariants(v2273, silo)).toEqual([])
        const { timesLost: _unknown, ...v226 } = stored
        expect(checkStatsInvariants(v226, silo)).toEqual([])
        if (!untimed.has(`${key}:${silo}`)) {
          expect(mismatch(ours)).toBe(false)
          expect(mismatch(v2273)).toBe(false)
          // v2.26.0's own check is exact only while nothing is sealed, lost or trimmed.
          if (!stored.sealed && !stored.timesLost && !trimmed.has(`${key}:${silo}`))
            expect(mismatchV226(v226)).toBe(false)
        }
        // Every chunk a main key names is there — unless an older page wrote it (the strand), or a
        // page of this line did on a stale read (its twin).
        if (stored.sealed && oursLast.has(key) && !staleSaved.has(key))
          stored.sealed.ids.forEach((id, j) =>
            expect(local.items.has(`${family(preset)}${silo}:${j}.${id}`)).toBe(true),
          )
      }
    }
  }

  return {
    run(steps) {
      try {
        check()
        for (let i = 0; i < steps; i++) {
          step()
          check()
        }
      } catch (e) {
        e.message += `\nlast steps (of ${trace.length}):\n  ${trace.slice(-14).join('\n  ')}`
        throw e
      }
      return {
        strands,
        backs,
        removals,
        chunks: local.chunkKeys(1).length + local.chunkKeys(12).length,
      }
    },
  }
}

beforeEach(() => forgetStorageHealth())

// Short runs, many seeds: each test stays well inside the suite's limit on a loaded laptop.
const STEPS = 110
const seeds = (from, n) => Array.from({ length: n }, (_, i) => from + i)

describe.each([
  ['two pages of the reader builds', [false, false]],
  ['a reader build beside this build', [false, true]],
  ['two pages of this build', [true, true]],
])('%s, v2.27.3 and v2.26.0, everything allowed', (_label, seals) => {
  it.each(seeds(seals[0] * 1000 + seals[1] * 100 + 1, 6))('seed %i', (seed) => {
    const w = world(seed, { seals, older: ['v2.27.3', 'v2.26.0'], deletes: true })
    w.run(STEPS)
  })
})

describe('with ONE older page and no reset or delete, nothing is ever lost — no strand at all', () => {
  it.each([
    ...seeds(5001, 5).map((s) => [s, 'v2.27.3', [false, true]]),
    ...seeds(6001, 5).map((s) => [s, 'v2.26.0', [true, true]]),
    ...seeds(7001, 4).map((s) => [s, 'v2.27.3', [false, false]]),
  ])('seed %i (%s)', (seed, build, seals) => {
    const w = world(seed, { seals, older: [build], deletes: false })
    expect(w.run(STEPS).strands).toBe(0)
  })
})

describe.each([
  ['two pages of this build', [true, true], []],
  ['a reader build beside this build, and v2.27.3', [false, true], ['v2.27.3']],
])('%s, reading each other’s saves one write late', (_label, seals, older) => {
  it.each(seeds(8001 + seals[0] * 100, 6))('seed %i', (seed) => {
    world(seed, { seals, older, deletes: true, stale: true }).run(STEPS)
  })
})

describe('the fuzz reaches what it is for', () => {
  it('seals, deletes, and strands all really happen across the seeds', () => {
    let strands = 0
    let removals = 0
    let chunks = 0
    for (const seed of seeds(9001, 4)) {
      const got = world(seed, {
        seals: [true, true],
        older: ['v2.27.3', 'v2.27.3'],
        deletes: true,
      }).run(STEPS)
      strands += got.strands
      removals += got.removals
      chunks += got.chunks
    }
    expect(removals).toBeGreaterThan(0)
    expect(chunks).toBeGreaterThan(0)
    expect(strands).toBeGreaterThan(0)
  })

  it('a stale read really does pass over a deletion somewhere across the seeds', () => {
    // Rare by construction — a reset, the news of it held back, and the other page's very next act
    // a save of the same preset — so these are seeds found by a search (3 in 150), not a range.
    for (const seed of [8052, 8132, 8150]) {
      const got = world(seed, { seals: [true, true], older: [], deletes: true, stale: true }).run(
        STEPS,
      )
      expect(got.strands).toBeGreaterThan(0)
    }
  })
})
