// progressStorage.olderBuilds — THE OLDER-BUILD MODELS, HELD TO WHAT THE REAL BUILDS STORED.
//
// Every build on an origin shares its saved progress, so older builds (a tab or the installed app left
// open across an update) read and write the same saved progress this build does. Two lines of them:
//   • v2.27.3 and v2.26.0 have never heard of `sealed`. The sealed layout (store/progressStorage)
//     rests on one claim about them: such a build carries `sealed`, and the `timesLost` beside it,
//     through every write it makes, and drops both only on a reset.
//   • v2.28.0 and v2.29.0 are the READER: they load and keep a sealed save, seal it further as its
//     tail grows, delete the chunks of a silo they reset — and never start sealing a plain one.
//     Round 26 turned sealing on in this build and deleted the switch, so they are modelled by a
//     verbatim record of their code (tests/fixtures/olderBuilds/progressStorage-v2.29.0.ts), held to
//     the real builds below.
// ★ THAT CLAIM WAS RUN, NOT READ. tests/fixtures/olderBuilds/v2.27.3.json and v2.26.0.json are what
// the real app at each tag (fcdcf56, ff506f8) left in storage after each step of
// sealedDrive.dom.test.jsx.txt — mounted, answered, overridden, timing hidden and shown, Amnesic on
// and off, a preset switch and back, a reload, Reset Stats, and play past the old 1,000 cap — over a
// seeded sealed save. This file replays those steps through tests/helpers/progressWorld's models and
// requires the same stored state at every one, so the fuzz that leans on the models leans on the
// builds.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  Disk,
  olderPage,
  newPage,
  blankState,
  chunkId,
  family,
  MAIN,
} from './helpers/progressWorld.js'
import { createProgressCodec as createReaderCodec } from './fixtures/olderBuilds/progressStorage-v2.29.0.ts'

const recorded = (build) =>
  JSON.parse(readFileSync(new URL(`./fixtures/olderBuilds/${build}.json`, import.meta.url), 'utf8'))
    .filter((e) => e.step)
    .map((e) => [e.step, e])

const TAIL = Array.from({ length: 300 }, (_, i) => 2 + (i % 50) / 10)
const SEALED = { n: 1000, ids: ['aaa0', 'bbb1', 'ccc2', 'ddd3'] }
const seed = (classic) =>
  JSON.stringify({
    state: { ...blankState(), stats: { ...blankState().stats, classic } },
    version: 5,
  })
// The stored classic silo as the fixtures spell it: the times as a count plus their last two.
const stored = (disk) => {
  const text = disk.items.get(MAIN)
  const { state, version } = JSON.parse(text)
  const c = state.stats.classic
  return { version, classic: { ...c, times: c.times.length, lastTimes: c.times.slice(-2) } }
}

describe.each(['v2.27.3', 'v2.26.0'])(
  '%s, replayed against what the real build stored',
  (build) => {
    const steps = new Map(recorded(build))
    const at = (step) => steps.get(step).main
    // The fixture's counts for a step, onto the Stats the page holds — a spread, as the build's are.
    const counts = (step) => {
      const { played, good, streak, best } = at(step).classic
      return { played, good, streak, best }
    }

    it('carries `sealed` and `timesLost` through every write, and drops both on a reset', () => {
      const disk = new Disk()
      disk.put(
        MAIN,
        seed({
          played: 1400,
          good: 1300,
          streak: 3,
          best: 40,
          times: TAIL,
          timesLost: 1000,
          sealed: SEALED,
        }),
      )
      const page = olderPage(build, disk)
      page.load()
      expect(stored(disk)).toEqual(at('loaded'))

      // Three timed answers: the recorded times are the real ones the build measured.
      const three = at('3 timed answers')
      const [t0, t1] = three.classic.lastTimes
      page.update('classic', (s) => ({
        ...s,
        ...counts('3 timed answers'),
        times: [...s.times, t0, t0, t1],
      }))
      expect(stored(disk)).toEqual(three)

      page.update('classic', (s) => ({ ...s, ...counts('a wrong answer') }))
      expect(stored(disk)).toEqual(at('a wrong answer'))

      // An Override in the tail (the wrong answer is given its credit, with a time), then undone.
      const given = at('override in the tail (credit taken back)')
      page.update('classic', (s) => ({
        ...s,
        ...counts('override in the tail (credit taken back)'),
        times: [...s.times, given.classic.lastTimes[1]],
      }))
      expect(stored(disk)).toEqual(given)
      page.update('classic', (s) => ({
        ...s,
        ...counts('override undone'),
        times: s.times.slice(0, -1),
      }))
      expect(stored(disk)).toEqual(at('override undone'))

      // Hiding and showing timing, Amnesic on and off, a switch to another preset: none of them is a
      // write to this key that changes it — the real builds stored the same silo at each.
      for (const step of ['timing hidden', 'timing shown again', 'amnesic on', 'amnesic off'])
        expect(at(step).classic).toEqual(at('override undone').classic)
      expect(at('switched to a new preset and answered').classic).toEqual(
        at('override undone').classic,
      )

      page.load() // the reload
      expect(stored(disk).classic.sealed).toEqual(SEALED)
      expect(at('reloaded and answered').classic.sealed).toEqual(SEALED)
      expect(at('reloaded and answered').classic.timesLost).toBe(1000)

      page.reset('classic')
      expect(stored(disk)).toEqual({
        ...at('Reset Stats'),
        classic: { ...at('Reset Stats').classic, lastTimes: [] },
      })
      expect('sealed' in stored(disk).classic).toBe(false)
      expect('timesLost' in stored(disk).classic).toBe(false)
      // …and no older build touched a chunk key at any step, reset included.
      for (const [, e] of steps) expect(e.chunkKeys).toBe(4)
    })

    it('play past the old 1,000 cap: v2.26.0 trims the tail, v2.27.3 keeps every time', () => {
      const disk = new Disk()
      const tail = Array.from({ length: 999 }, (_, i) => 2 + (i % 50) / 10)
      disk.put(
        MAIN,
        seed({
          played: 1999,
          good: 1999,
          streak: 3,
          best: 40,
          times: tail,
          timesLost: 1000,
          sealed: SEALED,
        }),
      )
      const page = olderPage(build, disk)
      page.load()
      expect(stored(disk)).toEqual(at('trim: loaded a 999-time tail'))
      const after = at('trim: 3 timed answers past 1,000')
      for (let i = 1; i <= 3; i++)
        page.update('classic', (s) => ({
          ...s,
          played: 1999 + i,
          good: 1999 + i,
          streak: 3 + i,
          times: [...s.times, after.classic.lastTimes[i < 3 ? 0 : 1]],
        }))
      expect(stored(disk)).toEqual(after)
      expect(after.classic.times).toBe(build === 'v2.26.0' ? 1000 : 1002)
      expect(after.classic.timesLost).toBe(1000) // carried, never recomputed, by both
    })
  },
)

// ── THE READER BUILDS ────────────────────────────────────────────────────────────────────────────
// The same drive (sealedDrive.dom.test.jsx.txt, with SEALED_REAL_IDS=1: chunks named by the hash of
// their text, the only save a reader can read), run on the real v2.28.0 and v2.29.0, replayed through
// their recorded code. One difference from the builds above: the reader's five mode screens write the
// whole doc as they mount, so a load is followed by a save (`mount`), as the app does.
describe.each(['v2.29.0', 'v2.28.0'])(
  '%s (the reader), replayed against what the real build stored',
  (build) => {
    const steps = new Map(recorded(build))
    const at = (step) => steps.get(step).main
    const counts = (step) => {
      const { played, good, streak, best } = at(step).classic
      return { played, good, streak, best }
    }
    const CHUNK_TEXT = JSON.stringify(TAIL.slice(0, 250))
    const REAL = { n: 1000, ids: [0, 1, 2, 3].map(() => chunkId(CHUNK_TEXT)) }
    const sealedSeed = (disk) => {
      REAL.ids.forEach((id, j) => disk.put(`${family(1)}classic:${j}.${id}`, CHUNK_TEXT))
      disk.put(
        MAIN,
        seed({
          played: 1400,
          good: 1300,
          streak: 3,
          best: 40,
          times: TAIL,
          timesLost: 1000,
          sealed: REAL,
        }),
      )
    }
    const mount = (disk) => {
      const page = newPage(createReaderCodec, disk, { name: build })
      page.load()
      page.save()
      return page
    }

    it('keeps a sealed save sealed through every write, seals it no further at this length, and deletes its chunks on a reset', () => {
      const disk = new Disk()
      sealedSeed(disk)
      expect(stored(disk)).toEqual(at('seeded'))
      const page = mount(disk)
      expect(stored(disk)).toEqual(at('mounted'))
      const step = (name, change) => {
        page.update('classic', change)
        expect(stored(disk), name).toEqual(at(name))
        expect(disk.chunkKeys(), name).toHaveLength(steps.get(name).chunkKeys)
      }
      const [t0, t1] = at('3 timed answers').classic.lastTimes
      step('3 timed answers', (s) => ({
        ...s,
        ...counts('3 timed answers'),
        times: [...s.times, t0, t0, t1],
      }))
      step('a wrong answer', (s) => ({ ...s, ...counts('a wrong answer') }))
      const given = at('override in the tail (credit taken back)')
      step('override in the tail (credit taken back)', (s) => ({
        ...s,
        ...counts('override in the tail (credit taken back)'),
        times: [...s.times, given.classic.lastTimes[1]],
      }))
      step('override undone', (s) => ({
        ...s,
        ...counts('override undone'),
        times: s.times.slice(0, -1),
      }))
      // Timing hidden and shown, Amnesic on and off (the session copy, elsewhere), a switch to another
      // preset: none of them changed this key in the real build.
      for (const name of ['timing hidden', 'timing shown again', 'amnesic on', 'amnesic off'])
        expect(at(name), name).toEqual(at('override undone'))
      expect(at('switched to a new preset and answered')).toEqual(at('override undone'))
      // A reload: the sealed save is read back whole, and kept sealed.
      const again = mount(disk)
      expect(again.state.stats.classic.times).toHaveLength(1303)
      expect(stored(disk).classic.sealed).toEqual(REAL)
      expect(at('reloaded and answered').classic.sealed).toEqual(REAL)
      // Reset Stats: the silo saved blank, and the chunks this page knew deleted with it.
      again.reset('classic')
      expect(stored(disk)).toEqual({
        ...at('Reset Stats'),
        classic: { ...at('Reset Stats').classic, lastTimes: [] },
      })
      expect(disk.chunkKeys()).toHaveLength(steps.get('Reset Stats').chunkKeys)
      expect(steps.get('Reset Stats').chunkKeys).toBe(0)
    })

    it('never STARTS sealing: a plain silo played past 1,000 times stays plain', () => {
      const disk = new Disk()
      // The drive's second seed: a 999-time tail whose `sealed` names chunks the reset above deleted.
      disk.put(
        MAIN,
        seed({
          played: 1999,
          good: 1999,
          streak: 3,
          best: 40,
          times: Array.from({ length: 999 }, (_, i) => 2 + (i % 50) / 10),
          timesLost: 1000,
          sealed: REAL,
        }),
      )
      const page = mount(disk)
      expect(stored(disk)).toEqual(at('trim: loaded a 999-time tail'))
      const after = at('trim: 3 timed answers past 1,000')
      for (let i = 1; i <= 3; i++)
        page.update('classic', (s) => ({
          ...s,
          played: 1999 + i,
          good: 1999 + i,
          streak: 3 + i,
          times: [...s.times, after.classic.lastTimes[i < 3 ? 0 : 1]],
        }))
      expect(stored(disk)).toEqual(after)
      expect(after.classic.times).toBe(1002)
      expect('sealed' in after.classic).toBe(false)
      expect(disk.chunkKeys()).toEqual([])
    })
  },
)
