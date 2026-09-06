import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stats } from '../engine/gameReducer.js'
import { captureError } from '../observability/sentry.js'
import { checkStatsInvariants } from '../engine/invariants.js'
import { dimEither } from '../lib/calendar.js'
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
//   • Lookup history (the newest LOOKUP_HISTORY_CAP lookups — see addLookupEntry below) — see
//     LookupEntry below: the INPUTS only, never the rendered text (that is derived at paint time
//     from the live settings).
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

// A saved Lookup history entry — the persisted shape, owned HERE (the store is what versions and
// migrates it; it used to be declared in the LookupCard UI component and imported backwards).
// It carries only what the user actually supplied: the parsed date, a stable id for selection, and
// the Oct 5–14, 1582 gap marker. Everything the card SHOWS — the formatted label, the weekday(s) —
// is derived from y/m/d against the LIVE Date Format, so changing it re-renders every row and the
// answer slot together. (Before v3 the rendered text was stored too, and a format change left an
// old-format result sentence above a new-format row.) There is deliberately no calendar field
// either: a pre-reform date is shown in BOTH calendars, so there is nothing per-entry to freeze and
// no way for a stored date to be re-read as a different — or an impossible — one later.
export interface LookupEntry {
  id: string
  y: number
  m: number
  d: number
  isGap?: boolean
}

// The Lookup history WINDOW, and the one function that applies it. Newest to the front, and past
// the cap the oldest simply falls off the end — the same bounded-payload rule STATS_TIMES_CAP
// below states for solve-times, for the same reason (localStorage must not grow without bound
// across sessions). 100 entries of {id,y,m,d} is a few KB.
// The RULE lives here rather than at the one call site because it had two writers and one of them
// was a test: main.tsx's pushLookupHistory and the controlled host in tests/lookupCard.dom each
// wrote `[entry, ...prev].slice(0, 20)` out by hand, so the number lived in three places (this
// comment being the third) and could drift in any of them.
// (Keep the How-to-Play wording in sync with this number — GuidePage's Lookup section states it,
// once. The Saved Progress list carried a second copy for one commit and now just names the thing
// that is saved, which is what that list is for.)
export const LOOKUP_HISTORY_CAP = 100
export const addLookupEntry = (prev: LookupEntry[], entry: LookupEntry): LookupEntry[] =>
  [entry, ...prev].slice(0, LOOKUP_HISTORY_CAP)

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
  lookupHistory: LookupEntry[]
}

type Updater<T> = T | ((prev: T) => T)
export type ProgressState = ProgressValues & {
  setModeStats: (key: StatsKey, v: Updater<Stats>) => void
  setBlitzBest: (v: Updater<Record<string, BlitzBest>>) => void
  setSuddenBest: (v: Updater<Record<string, SuddenBest>>) => void
  setSuddenAmBest: (v: Updater<Record<string, BlitzBest>>) => void
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
  suddenAmBest: {},
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
  'suddenAmBest',
  'aoxBest',
  'lookupHistory',
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

// The lookup-history normalizer, and the ONLY thing that decides what shape a stored entry has.
//
// SHAPE (v3): an entry is {id, y, m, d, isGap?} and nothing else. It used to also carry three
// RENDERED fields (label/weekday/result) — snapshots of how the date read at lookup time, so after
// a Date Format change the result sentence on screen disagreed with the history row right below
// it. LookupCard derives all three now, which makes the stored copies not just redundant but
// wrong, so this drops them. Lossless: y/m/d have been on the entry since the app's first commit
// in this repo, long before the persist store existed (Stage D1).
//
// VALIDATION: the filter asserts exactly what the consumers dereference. LookupCard carries no
// per-field guards of its own any more — the store owns the shape, so the store has to guarantee
// it, or a truncated/tampered payload reaches the card as {id} alone and renders MONTH[NaN] and a
// blank weekday, or trips the mode error boundary. An entry that can't answer "which date?" has
// nothing to show and is dropped.
//
// The date must also be a REAL one, not merely a number-shaped one. This is the same either-calendar
// rule Lookup validates with (dimEither): a date counts if it exists in a calendar it can be read
// in, so pre-reform February keeps Julian's 29th, and February 30 or day 32 exists nowhere and is
// dropped. Without this check a tampered or truncated payload would be ANSWERED rather than refused
// — the card would print a confident weekday for a date that never happened, since the underlying
// day-number arithmetic happily rolls February 30 into March. Whole numbers for the same reason:
// month 1.5 indexes MONTH to `undefined` and day 1.5 produces a weekday belonging to no day.
// Deliberately NOT bounded to Lookup's 1–10000 years: an out-of-range year still names a real date
// and still reads correctly, so there is nothing wrong to drop — unlike an impossible day, which
// can only be answered wrongly.
//
// This runs on EVERY rehydrate (see `merge` below), not just the v2→v3 upgrade: a v3 payload is
// read from the same untrusted localStorage as a v2 one. Exported for tests.
export function normalizeLookupEntries(entries: unknown): LookupEntry[] {
  if (!Array.isArray(entries)) return []
  return entries
    .filter(
      (e): e is LookupEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        Number.isInteger(e.y) &&
        Number.isInteger(e.m) &&
        Number.isInteger(e.d) &&
        e.m >= 1 &&
        e.m <= 12 &&
        e.d >= 1 &&
        e.d <= dimEither(e.y, e.m),
    )
    .map((e) =>
      e.isGap
        ? { id: e.id, y: e.y, m: e.m, d: e.d, isGap: true }
        : { id: e.id, y: e.y, m: e.m, d: e.d },
    )
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
      setLookupHistory: (v) => set((s) => ({ lookupHistory: resolve(v, s.lookupHistory) })),
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
      // v3 = the slim lookup-entry shape. The bump still records that shape change even though
      // `merge` below re-asserts it on every load: it is what tells a FUTURE migration which
      // payloads it is looking at.
      version: 3,
      // Saved-shape migrations — the version-gated REWRITES, run once at hydrate when the stored
      // version is older. Only aoxBest needs one: its keys gained a dimension, information a later
      // read cannot reconstruct. (The lookup-history shape is NOT here; it is normalized
      // unconditionally in `merge`, because a v3 payload is read from the same untrusted storage
      // as a v2 one and version-gating it would leave the go-forward path unguarded.)
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
      // Two guarantees, composed, and they are separate concerns:
      //   • mergeOverDefaults — hydration REPLACES the saved progress rather than patching it over
      //     whatever is in memory. At a cold start that is byte-identical to zustand's default
      //     merge (memory already holds makeProgressDefaults()); on a PRESET SWITCH it is the whole
      //     ballgame, because the default would let a preset with no saved copy of a silo inherit
      //     the last preset's stats and bests — and the first answered question would make that
      //     inheritance permanent. Argued in full in store/presets.
      //   • the lookupHistory screen, which is normalized here rather than in `migrate` so it
      //     covers every load at every version — that is what makes LookupCard's guard-free
      //     rendering safe. Runs after migrate, so a v1/v2 payload arrives already rewritten.
      // ⚠ ORDER: the screen must be applied AFTER the spread, or the saved (unscreened) history
      // would overwrite it.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ProgressValues>
        return {
          ...mergeOverDefaults<ProgressValues, ProgressState>(makeProgressDefaults)(saved, current),
          lookupHistory: normalizeLookupEntries(saved.lookupHistory),
        }
      },
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
