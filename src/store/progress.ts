import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stats } from '../engine/gameReducer.js'
import type { LookupEntry } from '../components/LookupCard.jsx'
import { captureError } from '../observability/sentry.js'
import { checkStatsInvariants } from '../engine/invariants.js'

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
//   • All-time bests, config-keyed — Blitz (score/streak), Sudden (per-question),
//     and AoX (average/median). These already lived as component state; the store
//     now owns them (and their types).
//   • Lookup history (the last 20 lookups).
//
// WHAT DOES *NOT* PERSIST (intentionally — mid-run/round state is discarded):
//   • The engine's live question, history stacks, locked/revealed flags, etc.
//   • Blitz/AoX engine stats — those are per-round/run scores, not lifetime totals;
//     only their bests above persist.
//   • The "new best ★" markers and the override-rollback refs — ephemeral per-session
//     UI state; they stay as local state in the mode components.
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
  aoxBest: Record<string, AoxBest>
  lookupHistory: LookupEntry[]
}

type Updater<T> = T | ((prev: T) => T)
export type ProgressState = ProgressValues & {
  setModeStats: (key: StatsKey, v: Updater<Stats>) => void
  setBlitzBest: (v: Updater<Record<string, BlitzBest>>) => void
  setSuddenBest: (v: Updater<Record<string, SuddenBest>>) => void
  setAoxBest: (v: Updater<Record<string, AoxBest>>) => void
  setLookupHistory: (v: Updater<LookupEntry[]>) => void
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
  aoxBest: {},
  lookupHistory: [],
})

// resolve(next, prev): support React-style functional updaters (prev => next), like settings.
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

const PERSISTED_KEYS: (keyof ProgressValues)[] = [
  'stats',
  'blitzBest',
  'suddenBest',
  'aoxBest',
  'lookupHistory',
]

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
      setAoxBest: (v) => set((s) => ({ aoxBest: resolve(v, s.aoxBest) })),
      setLookupHistory: (v) => set((s) => ({ lookupHistory: resolve(v, s.lookupHistory) })),
      // Wipe all saved progress back to launch defaults. Because the store is persisted, this
      // also overwrites the saved copy — so Full Reset's call here makes the wipe permanent.
      resetProgress: () => set(() => makeProgressDefaults()),
    }),
    {
      name: 'cg-progress-v1', // localStorage key (versioned for future migrations)
      version: 1,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<ProgressState>,
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
