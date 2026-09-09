import { describe, it, expect, beforeEach } from 'vitest'
import { useProgress, makeProgressDefaults, migrateAoxBestKeys } from '../src/store/progress.js'

// progress.test.js — the saved-progress store (Stage D1). Mirrors settings.test.js.
// Locks the contract: (1) empty defaults (blank stats for all five silos, empty
// bests); (2) setModeStats updates one silo without disturbing the
// others and supports a functional updater; (3) the best setters accept
// direct values AND React-style functional updaters; (4) resetProgress restores
// FRESH defaults (no aliasing). Persistence (localStorage) is verified in-browser,
// like the settings store, since jsdom/node storage timing differs from the runtime.
// ⚠ Lookup history (setLookupHistory, normalizeLookupEntries) left this store for its own —
// store/lookupHistory — in Q1, round 20; tests/lookupHistory.test.js and .dom.test.js own its
// contract now, unit and persisted halves alike, the same split this file keeps for its own values.

const blank = { played: 0, good: 0, streak: 0, best: 0, times: [] }

describe('progress store', () => {
  beforeEach(() => {
    useProgress.getState().resetProgress()
  })

  it('starts empty: blank stats for all five silos, no bests', () => {
    const s = useProgress.getState()
    for (const k of ['classic', 'flash', 'dedDay', 'dedMonth', 'dedYear']) {
      expect(s.stats[k]).toEqual(blank)
    }
    expect(s.blitzBest).toEqual({})
    expect(s.suddenBest).toEqual({})
    expect(s.suddenAmBest).toEqual({})
    expect(s.aoxBest).toEqual({})
  })

  it('setModeStats updates one silo and leaves the others blank', () => {
    useProgress
      .getState()
      .setModeStats('classic', { played: 5, good: 4, streak: 2, best: 3, times: [1.1, 2.2] })
    const s = useProgress.getState()
    expect(s.stats.classic).toEqual({ played: 5, good: 4, streak: 2, best: 3, times: [1.1, 2.2] })
    expect(s.stats.flash).toEqual(blank)
    expect(s.stats.dedDay).toEqual(blank)
  })

  it('setModeStats accepts a functional updater', () => {
    useProgress
      .getState()
      .setModeStats('flash', { played: 1, good: 1, streak: 1, best: 1, times: [] })
    useProgress
      .getState()
      .setModeStats('flash', (prev) => ({ ...prev, played: prev.played + 1, good: prev.good + 1 }))
    expect(useProgress.getState().stats.flash).toEqual({
      played: 2,
      good: 2,
      streak: 1,
      best: 1,
      times: [],
    })
  })

  it('best setters accept direct values and functional updaters', () => {
    useProgress
      .getState()
      .setBlitzBest({ k1: { score: 7, streak: 5, scoreRoundId: 1, streakRoundId: 1 } })
    expect(useProgress.getState().blitzBest.k1.score).toBe(7)
    useProgress.getState().setSuddenBest((p) => ({ ...p, k2: { score: 3, roundId: 2 } }))
    expect(useProgress.getState().suddenBest.k2.score).toBe(3)
    // The per-Q + Allow Mistakes map (C3a) — BlitzBest-shaped, its own silo.
    useProgress
      .getState()
      .setSuddenAmBest({ k4: { score: 6, streak: 4, scoreRoundId: 3, streakRoundId: 3 } })
    expect(useProgress.getState().suddenAmBest.k4.score).toBe(6)
    useProgress
      .getState()
      .setSuddenAmBest((p) => ({ ...p, k5: { ...p.k4, streak: 5, streakRoundId: 4 } }))
    expect(useProgress.getState().suddenAmBest.k5.streak).toBe(5)
    expect(useProgress.getState().suddenAmBest.k4.streak).toBe(4)
    useProgress.getState().setAoxBest((p) => ({
      ...p,
      k3: { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 },
    }))
    expect(useProgress.getState().aoxBest.k3.avg).toBe(1.5)
  })

  it('resetProgress restores fresh defaults, even after changes (no aliasing)', () => {
    const g = useProgress.getState
    g().setModeStats('classic', { played: 9, good: 9, streak: 9, best: 9, times: [9] })
    g().setBlitzBest({ k: { score: 1, streak: 1, scoreRoundId: 1, streakRoundId: 1 } })
    g().setSuddenAmBest({ k: { score: 1, streak: 1, scoreRoundId: 1, streakRoundId: 1 } })
    g().resetProgress()
    const s = g()
    expect(s.stats.classic).toEqual(blank)
    expect(s.blitzBest).toEqual({})
    expect(s.suddenAmBest).toEqual({})
    // The factory returns fresh nested objects — mutating live state must not leak into defaults.
    s.stats.classic.times.push(1)
    expect(makeProgressDefaults().stats.classic.times).toEqual([])
  })
})

// ── v1 → v2 migration: AoX Best keys gain the julianChance dimension (C2) ────────
// The original AoX key omitted julianChance (Blitz/Sudden include it; How-to-Play documents it as a
// bucket dimension), so v2 inserts it. The pure rewrite is unit-tested here; the full
// localStorage → rehydrate path is covered in progress.dom.test.js (needs jsdom storage).
describe('progress store — migrateAoxBestKeys (v1 → v2)', () => {
  const rec = { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 }

  it('inserts the julianChance segment before the year range (Blitz segment order)', () => {
    const out = migrateAoxBestKeys(
      { '10|false|numeric-ymd|random|random|1583-10000|true': rec },
      'random',
    )
    expect(out).toEqual({ '10|false|numeric-ymd|random|random|random|1583-10000|true': rec })
  })

  it('uses the CALLER-supplied julianChance (the user’s live setting at migrate time)', () => {
    const out = migrateAoxBestKeys({ '5|true|random|random|natural|1-2025|true': rec }, 'always')
    expect(Object.keys(out)).toEqual(['5|true|random|random|natural|always|1-2025|true'])
  })

  it('distinct old keys stay distinct (injective), values preserved untouched', () => {
    const a = { ...rec, avg: 1.1 }
    const b = { ...rec, avg: 2.2 }
    const out = migrateAoxBestKeys(
      {
        '10|false|numeric-ymd|random|random|1583-10000|true': a,
        '10|true|numeric-ymd|random|random|1583-10000|true': b,
      },
      'random',
    )
    expect(Object.keys(out)).toHaveLength(2)
    expect(out['10|false|numeric-ymd|random|random|random|1583-10000|true']).toEqual(a)
    expect(out['10|true|numeric-ymd|random|random|random|1583-10000|true']).toEqual(b)
  })

  it('leaves an already-8-segment key untouched (idempotent on re-run)', () => {
    const newKey = '10|false|numeric-ymd|random|random|always|1583-10000|true'
    const once = migrateAoxBestKeys({ [newKey]: rec }, 'random')
    expect(once).toEqual({ [newKey]: rec })
  })

  it('empty map → empty map', () => {
    expect(migrateAoxBestKeys({}, 'random')).toEqual({})
  })
})
