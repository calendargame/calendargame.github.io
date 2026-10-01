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
//     sudden death (score only), per-question with Allow Mistakes (score/streak),
//     and AoX (average/median). These already lived as component state; the store
//     now owns them (and their types).
//
// WHAT DOES *NOT* PERSIST (intentionally — mid-run/round state is discarded):
//   • The engine's live question, history stacks, locked/revealed flags, etc. — never HERE. (A
//     casual mode's are kept for the browsing session, in sessionStorage: store/sessionHistory. A
//     real close still discards them.)
//   • Blitz/AoX engine stats — those are per-round/run scores, not lifetime totals;
//     only their bests above persist. (An ENDED round or run is kept for the browsing session:
//     store/sessionRound.)
//   • The "new best ★" markers — nothing is stored for them at all: each is read off the round id
//     saved inside the Best record (engine/roundId's isNewBest).
//
// ⚠ LOOKUP HISTORY USED TO LIVE HERE AND NO LONGER DOES (round 20) — it moved to its own
// store/lookupHistory, because it stopped being PRESET data: it is now one shared list read by
// every preset, not one of the four things a preset switch swaps out. See that file's header for
// the full argument. Its old field on THIS store's persisted payload is handled at the bottom of
// this file's `persist` options (the version bump, and why no `migrate` step is needed for it).
//
// ★ EVERY SOLVE TIME IS KEPT, so Mean and Median are all-time numbers and a reload
// shows exactly what the screen showed before it. This store used to keep only the newest 1,000
// saved times while `good` kept counting — which made the "Enable and Reset Stats?" check fire after
// every reload for anyone past 1,000 timed answers, and made a reloaded Mean average a different
// set of solves than the in-visit one. The size that cap was guarding is small once the times are
// short (engine/stats' 0.1 ms grid, ~7 bytes each: ~0.5 MB per mode for 200 answers a day for a
// year), and a save the device refuses to take is reported to the player (store/storageHealth)
// rather than lost in silence. Saves the old cap already trimmed are repaired once, at hydration —
// see the v5 migration below.

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
  // Per-question + Allow Mistakes bests: the same BlitzBest {score, streak} shape as
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

// ── v4 → v5: THE ONE-TIME REPAIR OF A SAVE THE OLD 1,000-TIME CAP TRIMMED ─────────────────────
//
// Builds up to v2.26.0 saved only the newest 1,000 solve times. A silo they trimmed is
// recognisable exactly: 1,000 times beside MORE than 1,000 correct answers. The older times are gone
// — nothing can bring them back — so the gap is recorded ONCE as `timesLost` (engine Stats), which
// the desync check subtracts; every time from here on is kept, so the gap never grows.
// ⚠ AND IT IS RE-DERIVED, NOT ADDED TO, on every v4 payload. Live and staging share one browser
// origin, i.e. ONE copy of the saved data, so an older build can load a v5 save, trim it again and
// write it back as v4 — carrying our `timesLost` along untouched on its `...stats` spreads. `good −
// 1,000` is then the WHOLE gap again (the earlier baseline included), never an increment on top of
// it; a v4 silo that was NOT re-trimmed keeps whatever baseline it carries.
// ⚠ ONE THING IT CANNOT KNOW: whether some of that gap was answers given while timing was hidden
// (the popup's real case). In a trimmed save those are indistinguishable from discarded times, so
// they are folded into the baseline — the only alternative is the false popup this exists to end.
// Exported for tests.
export const LEGACY_TIMES_CAP = 1000
export function baselineTrimmedTimes(stats: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, silo] of Object.entries(stats)) {
    const s = silo as Partial<Stats> | null
    const trimmed =
      !!s &&
      typeof s === 'object' &&
      Array.isArray(s.times) &&
      s.times.length === LEGACY_TIMES_CAP &&
      Number.isInteger(s.good) &&
      (s.good as number) > LEGACY_TIMES_CAP
    out[key] = trimmed ? { ...s, timesLost: (s.good as number) - LEGACY_TIMES_CAP } : silo
  }
  return out
}

// ── v4 → v5, THE OTHER REPAIR: A BEST RECORD THAT SAYS NOTHING IS NOT A RECORD ─────────────────
//
// Every Best map holds a key ONLY for a configuration that has a record (engine/bestMap). Builds up
// to v2.26.0 broke that in one corner: a round or run that set a config's FIRST record and was then
// overridden back below it left the key behind, holding a record of nothing — a MoX record with no
// mean and no median, a Blitz record with a score and streak of 0. On screen it reads as "no record"
// (MoX) or as a Best of 0 nobody earned (Blitz); underneath, it is a key — so Full Reset stayed lit
// with nothing left to reset, and deleting the preset asked about data that was not there.
// Those records are dropped here, where the save crosses into this build's shape, and from then on
// neither door lets one in: no write files one (fileBest takes the key away instead), and no load
// keeps one.
// ⚠ IN THE VERSION-GATED STEP, NOT ON EVERY LOAD, and the shared origin is why that is enough: an
// older build stamps everything it writes with ITS version (it even re-stamps a newer save the
// moment it loads one), so a record like this can only ever arrive inside a pre-v5 payload — which
// is exactly what runs this step, again, every time it happens. It is also the step
// store/presetControl's isPresetFactory judges a preset you are not on through, so a preset whose
// only "data" is one of these reads as untouched without being opened.
// ⚠ ONLY THE EXACT EMPTY SHAPES. Anything else under a Best key — a real record, or something this
// build cannot name — is left exactly as it was found.
// The older build that may still be open on this origin is not harmed: to it a missing key and one
// of these records read the same (it falls back to the same empty record for both).
// Exported for tests.
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const SAYS_NOTHING: { [K in Exclude<keyof ProgressValues, 'stats'>]: (rec: unknown) => boolean } = {
  blitzBest: (r) => isRecord(r) && r.score === 0 && r.streak === 0,
  suddenAmBest: (r) => isRecord(r) && r.score === 0 && r.streak === 0,
  suddenBest: (r) => isRecord(r) && r.score === 0,
  aoxBest: (r) => isRecord(r) && r.avg === null && r.med === null,
}
export function dropEmptyBests(state: Partial<ProgressValues>): Partial<ProgressValues> {
  const out: Record<string, unknown> = { ...state }
  for (const [map, saysNothing] of Object.entries(SAYS_NOTHING)) {
    const saved = out[map]
    if (!isRecord(saved)) continue
    out[map] = Object.fromEntries(Object.entries(saved).filter(([, rec]) => !saysNothing(rec)))
  }
  return out as Partial<ProgressValues>
}

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

// v1 → v2: AoX Best keys gain the julianChance dimension. The original key omitted it —
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
      setModeStats: (key, v) =>
        set((s) => ({ stats: { ...s.stats, [key]: resolve(v, s.stats[key]) } })),
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
      // v5 = every solve time is kept; a save the old 1,000 cap trimmed gains its
      // one-time `timesLost` baseline in `migrate` below — and no Best map holds a record of
      // nothing (dropEmptyBests). The TIMES THEMSELVES ARE NOT REWRITTEN —
      // a legacy time's long float spelling round-trips exactly through JSON, and snapping it onto
      // the new 0.1 ms grid could move a displayed hundredth that sat on a boundary (a Last or a
      // Median, measured at ~0.15%). At most 1,000 such times per silo, ~10 KB, once.
      // ⚠ v5 STILL READS CORRECTLY IN EVERY OLDER BUILD, which matters because live and staging
      // share one saved copy: the times are still seconds, and an older build's `migrate` passes a
      // newer version through untouched. What an older build does WRITE is the trim, which the
      // v4 → v5 step re-derives (above).
      // v4 = lookupHistory LEFT the shape (round 20 — see store/lookupHistory). The bump
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
      version: 5,
      // Saved-shape migrations — the version-gated REWRITES, run once at hydrate when the stored
      // version is older: aoxBest's keys gained a dimension (v2); a trimmed save's lost-times count
      // exists only at the moment the trimmed save is read (v5); and the Best records of nothing an
      // older build left behind are dropped (v5, dropEmptyBests). Zustand re-saves the result at
      // the current version.
      migrate: (persisted, version) => {
        let state = persisted as Partial<ProgressValues>
        if (version < 2 && state?.aoxBest && typeof state.aoxBest === 'object') {
          state = {
            ...state,
            aoxBest: migrateAoxBestKeys(state.aoxBest, useSettings.getState().julianChance),
          }
        }
        if (version < 5 && state && typeof state === 'object') {
          if (state.stats && typeof state.stats === 'object')
            state = {
              ...state,
              stats: baselineTrimmedTimes(state.stats) as ProgressValues['stats'],
            }
          state = dropEmptyBests(state)
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
