import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stats } from '../engine/gameReducer.js'
import { captureError } from '../observability/sentry.js'
import { checkStatsInvariants } from '../engine/invariants.js'
import { PRESET_STORE_KEYS, mergeOverDefaults } from './presets.js'
import { presetStatsStorage } from './amnesic.js'
import { useSettings } from './settings.js'

// store/progress.ts — saved gameplay progress (Stage D1).
//
// The sibling of the settings store: where everything that should SURVIVE a reload
// lives, persisted to the device. Modeled exactly on settings.ts (same persist
// middleware, same functional-updater setters, same partialize-strips-setters,
// same factory-defaults-reused-by-reset). localStorage key 'cg-progress-v1'.
//
// WHAT PERSISTS (agreed Stage-D scope):
//   • Lifetime stats for the continuous modes — Classic, Flash, and Deduction's
//     three sub-modes (Day/Month/Year). Each is the engine's Stats object.
//   • All-time bests, config-keyed — Blitz per-round (score/streak), per-question
//     sudden death (score only), per-question with Allow Mistakes (score/streak, C3a),
//     and AoX (average/median). These already lived as component state; the store
//     now owns them (and their types).
//
// WHAT DOES *NOT* PERSIST (intentionally — mid-run/round state is discarded):
//   • The engine's live question, history stacks, locked/revealed flags, etc.
//   • Blitz/AoX engine stats — those are per-round/run scores, not lifetime totals;
//     only their bests above persist.
//   • The "new best ★" markers and the override-rollback refs — ephemeral per-session
//     UI state; they stay as local state in the mode components.
//
// ⚠ LOOKUP HISTORY USED TO LIVE HERE AND NO LONGER DOES (Q1, round 20) — it moved to its own
// store/lookupHistory, because it stopped being PRESET data: it is now one shared list read by
// every preset, not one of the four things a preset switch swaps out. See that file's header for
// the full argument. Its old field on THIS store's persisted payload is handled at the bottom of
// this file's `persist` options (the version bump, and why no `migrate` step is needed for it).
//
// Solve-`times` arrays are capped to a rolling window in setModeStats (below) so the
// persisted payload can't grow without bound across sessions.

// All-time best shapes (config-keyed). Moved here from main.tsx so the persisted store
// is the single owner; the mode components import these back.
export interface AoxBest {
  avg: number | null
  avgMed: number | null
  avgRoundId: number | null
  med: number | null
  medAvg: number | null
  medRoundId: number | null
}
export interface BlitzBest {
  score: number
  streak: number
  scoreRoundId: number | null
  streakRoundId: number | null
}
export interface SuddenBest {
  score: number
  roundId: number | null
}

// The five lifetime-stats silos: the continuous modes plus Deduction's three sub-modes.
export type StatsKey = 'classic' | 'flash' | 'dedDay' | 'dedMonth' | 'dedYear'

export type ProgressValues = {
  stats: Record<StatsKey, Stats>
  blitzBest: Record<string, BlitzBest>
  suddenBest: Record<string, SuddenBest>
  // Per-question + Allow Mistakes bests (C3a): the same BlitzBest {score, streak} shape as
  // per-round, keyed by the SAME per-question key string as suddenBest — for per-question,
  // AM-ness is the MAP split (the two variants' record shapes differ), not a key segment.
  // Added as a fresh key space, so no migration and no version bump of its own: an older payload
  // simply lacks the key and zustand's shallow merge leaves the default {} standing.
  suddenAmBest: Record<string, BlitzBest>
  aoxBest: Record<string, AoxBest>
}

type Updater<T> = T | ((prev: T) => T)
export type ProgressState = ProgressValues & {
  setModeStats: (key: StatsKey, v: Updater<Stats>) => void
  setBlitzBest: (v: Updater<Record<string, BlitzBest>>) => void
  setSuddenBest: (v: Updater<Record<string, SuddenBest>>) => void
  setSuddenAmBest: (v: Updater<Record<string, BlitzBest>>) => void
  setAoxBest: (v: Updater<Record<string, AoxBest>>) => void
  resetProgress: () => void
}

const blankStats = (): Stats => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })

// Cap persisted solve-`times` to a rolling window so the saved payload can't grow without bound
// across sessions (avg/median then reflect recent performance). The live engine keeps the full
// in-session array — only the copy written into the store is capped. (Keep the How-to-Play "rolling
// window of the most recent N" wording in sync with this number — GuidePage Stats + Saved Progress.)
const STATS_TIMES_CAP = 1000

// Fresh defaults via a FACTORY (not a shared const): the nested Stats objects/arrays must be
// new each call so resetProgress() never aliases — and so a reset can't mutate live/persisted data.
export const makeProgressDefaults = (): ProgressValues => ({
  stats: {
    classic: blankStats(),
    flash: blankStats(),
    dedDay: blankStats(),
    dedMonth: blankStats(),
    dedYear: blankStats(),
  },
  blitzBest: {},
  suddenBest: {},
  suddenAmBest: {},
  aoxBest: {},
})

// resolve(next, prev): support React-style functional updaters (prev => next), like settings.
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

const PERSISTED_KEYS: (keyof ProgressValues)[] = [
  'stats',
  'blitzBest',
  'suddenBest',
  'suddenAmBest',
  'aoxBest',
]

// v1 → v2: AoX Best keys gain the julianChance dimension (C2). The original key omitted it —
// inconsistent with Blitz/Sudden and with the How-to-Play contract ("Bests are tracked per exact
// configuration"), and it merged genuinely different difficulties when the year range spans
// pre-1582. Old: `n|allowMistakes|fmt|leapChance|janFebChance|minY-maxY|useJulian` (7 segments);
// new inserts julianChance before the year range (Blitz's segment order). The inserted value is the
// user's CURRENT Julian Chance setting — the best available stand-in for the one their records were
// earned under (it's 'random' unless they changed it; the settings store has already hydrated by
// migrate time, since this module imports it). Injective: old keys differing anywhere still differ.
// Exported for tests.
export function migrateAoxBestKeys(
  aoxBest: Record<string, AoxBest>,
  julianChance: string,
): Record<string, AoxBest> {
  const out: Record<string, AoxBest> = {}
  for (const [key, val] of Object.entries(aoxBest)) {
    const seg = key.split('|')
    out[seg.length === 7 ? [...seg.slice(0, 5), julianChance, ...seg.slice(5)].join('|') : key] =
      val
  }
  return out
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      ...makeProgressDefaults(),
      // Per-silo stats setter — replaces just one mode's Stats, leaving the others untouched.
      // Caps the solve-times to the rolling window so storage stays bounded.
      setModeStats: (key, v) =>
        set((s) => {
          const next = resolve(v, s.stats[key])
          const times =
            next.times.length > STATS_TIMES_CAP ? next.times.slice(-STATS_TIMES_CAP) : next.times
          return { stats: { ...s.stats, [key]: times === next.times ? next : { ...next, times } } }
        }),
      setBlitzBest: (v) => set((s) => ({ blitzBest: resolve(v, s.blitzBest) })),
      setSuddenBest: (v) => set((s) => ({ suddenBest: resolve(v, s.suddenBest) })),
      setSuddenAmBest: (v) => set((s) => ({ suddenAmBest: resolve(v, s.suddenAmBest) })),
      setAoxBest: (v) => set((s) => ({ aoxBest: resolve(v, s.aoxBest) })),
      // Wipe all saved progress back to launch defaults. Because the store is persisted, this
      // also overwrites the saved copy — so Full Reset's call here makes the wipe permanent.
      resetProgress: () => set(() => makeProgressDefaults()),
    }),
    {
      // The localStorage key (fixed — the `version` field below gates migrations). It lives in
      // store/presets now, with the other three, so a preset delete can enumerate exactly the four
      // keys it owns. ⚠ THE STRING IS UNCHANGED, deliberately and permanently: preset 1 does not
      // receive a copy of the player's stats and bests, preset 1 IS them. A build that has never
      // heard of presets and one that has therefore agree about preset 1 by construction — which
      // matters here more than anywhere, because live and staging share one browser origin.
      name: PRESET_STORE_KEYS.progress,
      // Presets 2, 3, 4… read and write a namespaced key instead. The `name` above never moves; the
      // adapter rewrites it per read/write from the active preset — and, uniquely among the four
      // stores, decides WHICH STORAGE AREA that key lives in. ★ THIS IS THE ONE STORE AMNESIC
      // TOUCHES, and that is the whole of the CLEARS/KEEPS split: the settings, the per-mode setup
      // and the saved personal defaults keep store/presets' permanent adapter, so an amnesic preset
      // cannot forget any of them however this file changes. See store/amnesic.
      storage: presetStatsStorage<Partial<ProgressState>>(),
      // v4 = lookupHistory LEFT the shape (Q1, round 20 — see store/lookupHistory). The bump
      // still records that change even though nothing here has to REWRITE anything for it: an old
      // payload's `lookupHistory` field is not in PERSISTED_KEYS above any more, so partialize
      // simply stops re-writing it, and `mergeOverDefaults` below spreads the raw persisted object
      // in as its last step regardless — a stray field along for that ride lands on the live state
      // as an inert property nothing in this app reads any more (every consumer moved to the new
      // store), and it is gone from disk the moment anything next calls a setter here. No `migrate`
      // step earns its keep deleting a field that already has zero effect on any behavior; the
      // version bump exists only so a FUTURE migration can tell, from the stored number alone,
      // whether a payload predates the move. tests/progress.dom pins the "loads without throwing,
      // and the stray field does nothing" half of this claim.
      version: 4,
      // Saved-shape migrations — the version-gated REWRITES, run once at hydrate when the stored
      // version is older. Only aoxBest needs one: its keys gained a dimension, information a later
      // read cannot reconstruct.
      migrate: (persisted, version) => {
        const state = persisted as Partial<ProgressValues>
        if (version < 2 && state?.aoxBest && typeof state.aoxBest === 'object') {
          return {
            ...state,
            aoxBest: migrateAoxBestKeys(state.aoxBest, useSettings.getState().julianChance),
          }
        }
        return state
      },
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<ProgressState>,
      // mergeOverDefaults — hydration REPLACES the saved progress rather than patching it over
      // whatever is in memory. At a cold start that is byte-identical to zustand's default merge
      // (memory already holds makeProgressDefaults()); on a PRESET SWITCH it is the whole ballgame,
      // because the default would let a preset with no saved copy of a silo inherit the last
      // preset's stats and bests — and the first answered question would make that inheritance
      // permanent. Argued in full in store/presets.
      // ⚠ ITS LAST STEP SPREADS THE RAW PERSISTED OBJECT IN, unscreened — which is exactly what
      // lets an old payload's stray `lookupHistory` field pass through harmlessly rather than
      // erroring (see the version-bump comment above): there is no per-field allowlist here to
      // reject an unknown key, only ProgressValues' own fields ever being READ back out of the
      // result. A store that still owned a validated-on-every-load field (lookupHistory itself,
      // when this store had it) would compose its own screen on top of this, same as before; this
      // store no longer has one.
      merge: mergeOverDefaults<ProgressValues, ProgressState>(makeProgressDefaults),
      // Tripwire: after the saved copy loads, verify it. Corrupt saved progress (good>played from an
      // old bug, or storage truncation/tampering on a real device) is a silent integrity problem —
      // report it to Sentry (prod only, via captureError). Report-only: behavior is unchanged (the
      // engine still hydrates whatever loaded, and its own tripwire fires too; this just pinpoints
      // that the bad data came from STORAGE rather than live play).
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          captureError(error instanceof Error ? error : new Error(String(error)), {
            tripwire: 'progressRehydrate',
          })
          return
        }
        if (!state) return
        const violations: string[] = []
        for (const key of Object.keys(state.stats ?? {}) as StatsKey[]) {
          violations.push(...checkStatsInvariants(state.stats[key], `saved.${key}`))
        }
        if (violations.length) {
          captureError(new Error(`Saved progress invariant violated: ${violations[0]}`), {
            tripwire: 'progressRehydrate',
            violations,
          })
        }
      },
    },
  ),
)
