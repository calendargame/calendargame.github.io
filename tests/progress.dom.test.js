// @vitest-environment jsdom
//
// progress.dom.test.js — the saved-progress store against REAL (jsdom) localStorage, end to end.
// The VERSION-GATED migration (`migrate`) runs once per upgrade and only where a read cannot
// reconstruct the information — today just the v1 → v2 aoxBest key rewrite. (The lookup-history
// screen this file used to also prove — an UNCONDITIONAL `merge` step, since every load reads the
// same untrusted localStorage a stale one does — left with the field itself in Q1, round 20; it is
// tests/lookupHistory.dom's claim now, against store/lookupHistory's own key.)
// The pure rewrites are unit-tested in progress.test.js (Node); this file proves the wiring, via
// useProgress.persist.rehydrate() — the same zustand entry point a real reload takes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { useSettings } from '../src/store/settings.js'

const rec = { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 }

describe('progress store — v1 envelope rehydrates through the migration', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useProgress.getState().resetProgress()
  })

  it('a stored v1 payload loads with AoX keys migrated under the LIVE julianChance setting', async () => {
    const v1 = {
      state: {
        stats: makeProgressDefaults().stats,
        blitzBest: {
          'n60|numeric-ymd|random|random|random|1583-10000|true': {
            score: 4,
            streak: 3,
            scoreRoundId: 1,
            streakRoundId: 1,
          },
        },
        suddenBest: {},
        aoxBest: { '10|false|numeric-ymd|random|random|1583-10000|true': rec },
      },
      version: 1,
    }
    localStorage.setItem('cg-progress-v1', JSON.stringify(v1))
    useSettings.getState().setJulianChance('always') // the live setting the migration must read
    await useProgress.persist.rehydrate()
    const s = useProgress.getState()
    // The AoX record moved to the 8-segment key, with the live julianChance inserted.
    expect(s.aoxBest).toEqual({
      '10|false|numeric-ymd|random|random|always|1583-10000|true': rec,
    })
    // Everything else passed through untouched.
    expect(s.blitzBest['n60|numeric-ymd|random|random|random|1583-10000|true']?.score).toBe(4)
    expect(s.stats.classic).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
  })

  it('a current-version (v3) payload rehydrates unchanged — no migration re-fires', async () => {
    const newKey = '10|false|numeric-ymd|random|random|random|1583-10000|true'
    const v3 = {
      state: { ...makeProgressDefaults(), aoxBest: { [newKey]: rec } },
      version: 3,
    }
    localStorage.setItem('cg-progress-v1', JSON.stringify(v3))
    await useProgress.persist.rehydrate()
    const s = useProgress.getState()
    expect(s.aoxBest).toEqual({ [newKey]: rec })
  })

  // ── lookupHistory LEFT THE SHAPE (Q1, round 20 — v3 → v4) ────────────────────────────────────
  // The four cases that used to stand here proved the OLD lookup-history migration/screening — a
  // v2 payload losing its rendered fields, a corrupt entry refused, a wrong-typed field landing as
  // []. That behaviour still exists, just for a different key now (store/lookupHistory's own
  // normalizeLookupEntries, exercised against 'cg-lookup-v1' in tests/lookupHistory.dom) — this
  // file's job is narrower now: prove that a v3-or-older payload which still carries the OLD
  // `lookupHistory` field loads cleanly, since this app never migrates a field forward by copying
  // it out of an abandoned key (store/lookupHistory's header argues why at length). The field is
  // simply along for the ride through mergeOverDefaults' unscreened final spread (see the version
  // comment on this store's `persist` options) — inert, since nothing in this app reads
  // useProgress().lookupHistory any more, and gone from disk the instant anything next saves here.
  it('an old payload that still carries lookupHistory loads without error, and the field does nothing', async () => {
    const stale = {
      state: {
        ...makeProgressDefaults(),
        aoxBest: { '10|false|numeric-ymd|random|random|random|1583-10000|true': rec },
        // The pre-move shape, rendered fields and all — exactly what a device that last saved
        // before Q1/round 20 still has sitting in its 'cg-progress-v1' payload.
        lookupHistory: [
          { id: 'e1', y: 1776, m: 7, d: 4, label: 'July 4, 1776', weekday: 'Thursday' },
        ],
      },
      version: 3,
    }
    localStorage.setItem('cg-progress-v1', JSON.stringify(stale))
    await expect(useProgress.persist.rehydrate()).resolves.not.toThrow()
    const s = useProgress.getState()
    // Everything this store still owns is intact and unaffected by the stray field…
    expect(s.aoxBest).toEqual({
      '10|false|numeric-ymd|random|random|random|1583-10000|true': rec,
    })
    // …and the field itself is not part of the TYPED contract any more: ProgressState no longer
    // declares it, so no app code can read it back through useProgress — the only thing left to
    // assert is that reading it did not crash, which the resolves.not.toThrow() above already did.
    // A second setter call proves the store is fully usable afterwards, and (via partialize, which
    // no longer lists the key) drops the stray field from the saved copy on this very write.
    s.setAoxBest({})
    const saved = useProgress.persist.getOptions().partialize(useProgress.getState())
    expect(saved).not.toHaveProperty('lookupHistory')
  })

  // C3a no-migration pin: suddenAmBest was ADDED as a fresh key space (v2 stayed v2). A payload
  // saved before it existed simply lacks the key — zustand's shallow merge must leave the default
  // {} standing, with every pre-existing silo untouched. If this ever fails, a real migration
  // became necessary.
  it('a stored payload WITHOUT suddenAmBest hydrates with the default {} (no migration needed)', async () => {
    const state = {
      ...makeProgressDefaults(),
      blitzBest: {
        'm60|numeric-ymd|random|random|random|1583-10000|true': {
          score: 4,
          streak: 3,
          scoreRoundId: 1,
          streakRoundId: 1,
        },
      },
      suddenBest: {
        '10|numeric-ymd|random|random|random|1583-10000|true': { score: 2, roundId: 1 },
      },
    }
    delete state.suddenAmBest // the pre-C3a payload shape
    localStorage.setItem('cg-progress-v1', JSON.stringify({ state, version: 2 }))
    await useProgress.persist.rehydrate()
    const s = useProgress.getState()
    expect(s.suddenAmBest).toEqual({})
    expect(s.blitzBest['m60|numeric-ymd|random|random|random|1583-10000|true']?.score).toBe(4)
    expect(s.suddenBest['10|numeric-ymd|random|random|random|1583-10000|true']?.score).toBe(2)
  })

  // The write-path twin of the pin above: partialize must persist every data silo — including
  // suddenAmBest (C3a) — and never a setter function. (Asserted here rather than in the Node file:
  // zustand only attaches the .persist API when a storage exists, i.e. under jsdom.)
  it('partialize persists every data value — including suddenAmBest (C3a) — and no setters', () => {
    const out = useProgress.persist.getOptions().partialize(useProgress.getState())
    expect(Object.keys(out).sort()).toEqual([
      'aoxBest',
      'blitzBest',
      'stats',
      'suddenAmBest',
      'suddenBest',
    ])
    for (const v of Object.values(out)) expect(typeof v).not.toBe('function')
  })
})

// ── C2 Part 4: the save/rehydrate ROUND-TRIP fuzz + corruption tolerance ─────────────────────────
// The persisted progress store is the only place saved stats can silently corrupt across sessions.
// Two nets: (1) a round-trip fuzz — random valid progress states written as a stored envelope must
// rehydrate EXACTLY (no field lost, re-keyed, capped, or coerced); (2) corruption tolerance — a
// damaged payload (truncated JSON, wrong shapes, impossible scores) must never crash hydration (the
// app must still boot; the rehydrate tripwire reports impossible saved scores instead of throwing).
describe('progress store — save/rehydrate round-trip fuzz + corruption tolerance (C2)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useProgress.getState().resetProgress()
  })

  function mulberry32(a) {
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const randStats = (rnd) => {
    const played = Math.floor(rnd() * 200)
    const good = Math.floor(rnd() * (played + 1))
    const streak = Math.floor(rnd() * (good + 1))
    const best = streak + Math.floor(rnd() * (good - streak + 1))
    const times = Array.from({ length: Math.min(good, Math.floor(rnd() * 40)) }, () => rnd() * 9)
    return { played, good, streak, best, times }
  }
  const randKey = (rnd) =>
    `${2 + Math.floor(rnd() * 99)}|${rnd() < 0.5}|numeric-ymd|random|random|random|${1500 + Math.floor(rnd() * 100)}-${3000 + Math.floor(rnd() * 100)}|${rnd() < 0.5}`

  it('random valid progress states survive the stored-envelope round trip EXACTLY (60 seeds)', async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(seed)
      const values = {
        stats: {
          classic: randStats(rnd),
          flash: randStats(rnd),
          dedDay: randStats(rnd),
          dedMonth: randStats(rnd),
          dedYear: randStats(rnd),
        },
        blitzBest: Object.fromEntries(
          Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [
            randKey(rnd) + i,
            {
              score: Math.floor(rnd() * 50),
              streak: Math.floor(rnd() * 50),
              scoreRoundId: rnd() < 0.3 ? null : Math.floor(rnd() * 9),
              streakRoundId: rnd() < 0.3 ? null : Math.floor(rnd() * 9),
            },
          ]),
        ),
        suddenBest: Object.fromEntries(
          Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => [
            randKey(rnd) + i,
            { score: Math.floor(rnd() * 50), roundId: rnd() < 0.3 ? null : Math.floor(rnd() * 9) },
          ]),
        ),
        suddenAmBest: Object.fromEntries(
          Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => [
            randKey(rnd) + i,
            {
              score: Math.floor(rnd() * 50),
              streak: Math.floor(rnd() * 50),
              scoreRoundId: rnd() < 0.3 ? null : Math.floor(rnd() * 9),
              streakRoundId: rnd() < 0.3 ? null : Math.floor(rnd() * 9),
            },
          ]),
        ),
        aoxBest: Object.fromEntries(
          Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => [
            randKey(rnd) + i,
            {
              avg: rnd() * 9,
              avgMed: rnd() * 9,
              avgRoundId: 1 + Math.floor(rnd() * 9),
              med: rnd() * 9,
              medAvg: rnd() * 9,
              medRoundId: 1 + Math.floor(rnd() * 9),
            },
          ]),
        ),
      }
      // Stamped with the CURRENT version: this is the round trip of a save this build wrote, which
      // must come back exactly. (An older build's save goes through `migrate`, which is allowed to
      // change it — a random Best of 0 here is precisely what the v4 → v5 step drops — and has its
      // own cases below.)
      const version = useProgress.persist.getOptions().version
      localStorage.setItem('cg-progress-v1', JSON.stringify({ state: values, version }))
      await useProgress.persist.rehydrate()
      const s = useProgress.getState()
      expect(s.stats, `seed ${seed}`).toEqual(values.stats)
      expect(s.blitzBest, `seed ${seed}`).toEqual(values.blitzBest)
      expect(s.suddenBest, `seed ${seed}`).toEqual(values.suddenBest)
      expect(s.suddenAmBest, `seed ${seed}`).toEqual(values.suddenAmBest)
      expect(s.aoxBest, `seed ${seed}`).toEqual(values.aoxBest)
    }
  })

  it('corrupt payloads never crash hydration (the app must still boot)', async () => {
    const corrupt = [
      '{truncated', // invalid JSON
      'null',
      '{"state":null,"version":2}',
      '{"state":{"stats":"nope"},"version":2}', // wrong type
      '{"state":{"stats":{"classic":{"played":1,"good":7,"streak":9,"best":0,"times":[1]}}},"version":2}', // impossible scores → tripwire reports, still loads
      '{"version":2}', // no state at all
      JSON.stringify({ state: { aoxBest: { 'short|key': { avg: 1 } } }, version: 1 }), // v1 with a non-7-segment key → migration passes it through
    ]
    for (const payload of corrupt) {
      localStorage.setItem('cg-progress-v1', payload)
      await expect(useProgress.persist.rehydrate(), payload).resolves.not.toThrow()
    }
    // And the store is still usable afterwards.
    useProgress.getState().resetProgress()
    useProgress
      .getState()
      .setModeStats('classic', { played: 1, good: 1, streak: 1, best: 1, times: [1] })
    expect(useProgress.getState().stats.classic.played).toBe(1)
  })

  // ★ EVERY SOLVE TIME IS KEPT (round 23). This case used to pin the opposite — a 1,000-time
  // rolling window on the write path — and that window was the bug: it trimmed the saved times while
  // the correct-answer count kept growing, so after a reload `good !== times.length` was true for
  // every player past 1,000 timed answers (a false "Enable and Reset Stats?") and a reloaded Mean
  // averaged a different set of solves than the one on screen a moment earlier.
  it('every solve time is kept on the WRITE path — nothing is trimmed', () => {
    const times = Array.from({ length: 1500 }, (_, i) => i / 10)
    useProgress
      .getState()
      .setModeStats('classic', { played: 1500, good: 1500, streak: 1, best: 1, times })
    expect(useProgress.getState().stats.classic.times).toEqual(times)
    const saved = JSON.parse(localStorage.getItem('cg-progress-v1'))
    expect(saved.state.stats.classic.times).toEqual(times)
  })
})

// ── v4 → v5: the times the OLD 1,000-cap discarded are recorded once, as a baseline ─────────────
// A save the old cap trimmed holds exactly 1,000 times and more correct answers than that; the
// older times are gone for good. So hydration records the gap ONCE (`timesLost`) and the desync
// check subtracts it — no false popup, ever — and every time from here on is kept.
describe('progress store — v4 → v5 legacy baseline for saves the 1,000-cap trimmed', () => {
  beforeEach(() => {
    localStorage.clear()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    localStorage.clear()
    useProgress.getState().resetProgress()
  })
  const t1000 = Array.from({ length: 1000 }, (_, i) => 1 + i / 1000)
  const seedV4 = (stats) =>
    localStorage.setItem(
      'cg-progress-v1',
      JSON.stringify({ state: { ...makeProgressDefaults(), stats }, version: 4 }),
    )

  it('a trimmed silo (1,000 times, good > 1,000) gains timesLost = good − 1,000, and is re-saved at v5', async () => {
    const trimmed = { played: 1600, good: 1500, streak: 3, best: 40, times: t1000 }
    seedV4({ ...makeProgressDefaults().stats, flash: trimmed })
    await useProgress.persist.rehydrate()
    const s = useProgress.getState()
    expect(s.stats.flash).toEqual({ ...trimmed, timesLost: 500 })
    expect(s.stats.classic).toEqual(makeProgressDefaults().stats.classic) // untouched silo
    const saved = JSON.parse(localStorage.getItem('cg-progress-v1'))
    expect(saved.version).toBe(5)
    expect(saved.state.stats.flash.timesLost).toBe(500)
    expect(saved.state.stats.flash.times).toEqual(t1000) // the kept times are NOT rewritten
  })

  it('an untrimmed silo gains no baseline — its own counts are already exact', async () => {
    const whole = { played: 900, good: 850, streak: 1, best: 9, times: t1000.slice(0, 840) }
    const exactly = { played: 1000, good: 1000, streak: 1, best: 9, times: t1000 }
    seedV4({ ...makeProgressDefaults().stats, classic: whole, dedDay: exactly })
    await useProgress.persist.rehydrate()
    const s = useProgress.getState()
    expect(s.stats.classic).toEqual(whole)
    expect(s.stats.dedDay).toEqual(exactly)
  })

  it('a baseline already carried in a v4 payload (an older build re-saved newer data) is kept', async () => {
    const carried = {
      played: 800,
      good: 710,
      streak: 1,
      best: 9,
      times: t1000.slice(0, 400),
      timesLost: 300,
    }
    seedV4({ ...makeProgressDefaults().stats, dedYear: carried })
    await useProgress.persist.rehydrate()
    expect(useProgress.getState().stats.dedYear).toEqual(carried)
  })

  it('an older build re-trimming a silo that already had a baseline: the baseline is the WHOLE gap again', async () => {
    const retrimmed = { played: 2400, good: 2300, streak: 1, best: 9, times: t1000, timesLost: 500 }
    seedV4({ ...makeProgressDefaults().stats, classic: retrimmed })
    await useProgress.persist.rehydrate()
    expect(useProgress.getState().stats.classic.timesLost).toBe(1300)
  })

  it('a v5 payload is never re-baselined, whatever its counts', async () => {
    const v5 = { played: 1600, good: 1500, streak: 3, best: 40, times: t1000 } // a genuine desync
    localStorage.setItem(
      'cg-progress-v1',
      JSON.stringify({
        state: { ...makeProgressDefaults(), stats: { ...makeProgressDefaults().stats, flash: v5 } },
        version: 5,
      }),
    )
    await useProgress.persist.rehydrate()
    expect(useProgress.getState().stats.flash).toEqual(v5)
  })
})

// ── v4 → v5: the Best records of NOTHING an older build left behind are dropped ────────────────
// Builds up to v2.26.0 left a key behind when a round or run that set a config's first record was
// overridden back below it: a MoX record with no mean and no median, a Blitz record of 0 and 0.
// Underneath, each is a key in a Best map — so Full Reset stayed lit and the preset read as
// played-in. They go as the save loads; every real record stays exactly as it was.
describe('progress store — v4 → v5 drops the empty Best records an older build saved', () => {
  beforeEach(() => {
    localStorage.clear()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    localStorage.clear()
    useProgress.getState().resetProgress()
  })
  const emptyMox = {
    avg: null,
    avgMed: null,
    avgRoundId: null,
    med: null,
    medAvg: null,
    medRoundId: null,
  }
  const zeroBlitz = { score: 0, streak: 0, scoreRoundId: 3, streakRoundId: 3 }
  const realBlitz = { score: 4, streak: 0, scoreRoundId: 5, streakRoundId: null }
  const seed = (bests, version) =>
    localStorage.setItem(
      'cg-progress-v1',
      JSON.stringify({ state: { ...makeProgressDefaults(), ...bests }, version }),
    )

  it('an all-null MoX record and zero Blitz records are gone after the load, and from the re-save', async () => {
    seed(
      {
        aoxBest: { emptied: emptyMox, kept: rec },
        blitzBest: { emptied: zeroBlitz, kept: realBlitz },
        suddenAmBest: { emptied: zeroBlitz },
        suddenBest: { emptied: { score: 0, roundId: 2 }, kept: { score: 1, roundId: 2 } },
      },
      4,
    )
    await useProgress.persist.rehydrate()
    const bestsOf = (s) => ({
      aoxBest: s.aoxBest,
      blitzBest: s.blitzBest,
      suddenAmBest: s.suddenAmBest,
      suddenBest: s.suddenBest,
    })
    const expected = {
      aoxBest: { kept: rec },
      blitzBest: { kept: realBlitz },
      suddenAmBest: {},
      suddenBest: { kept: { score: 1, roundId: 2 } },
    }
    expect(bestsOf(useProgress.getState())).toEqual(expected)
    const saved = JSON.parse(localStorage.getItem('cg-progress-v1'))
    expect(saved.version).toBe(5)
    expect(bestsOf(saved.state)).toEqual(expected)
  })

  it('a save holding nothing else comes back equal to a brand-new one', async () => {
    seed({ aoxBest: { emptied: emptyMox }, blitzBest: { emptied: zeroBlitz } }, 4)
    await useProgress.persist.rehydrate()
    const { stats, blitzBest, suddenBest, suddenAmBest, aoxBest } = useProgress.getState()
    expect({ stats, blitzBest, suddenBest, suddenAmBest, aoxBest }).toEqual(makeProgressDefaults())
  })

  it('a record with one metric, and anything this build cannot name, is left exactly as found', async () => {
    const half = { ...emptyMox, med: 2.5, medAvg: 2.6, medRoundId: 9 }
    seed({ aoxBest: { half, odd: 'not a record', none: null } }, 4)
    await useProgress.persist.rehydrate()
    expect(useProgress.getState().aoxBest).toEqual({ half, odd: 'not a record', none: null })
  })
})
