import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetScopedStorage, mergeOverDefaults } from './presets.js'

// modePrefs.ts — the per-mode SETUP store (Stage D follow-up, 2026-06-05).
//
// The ⚙ Settings store persists the menu values; the progress store persists
// stats/bests/Lookup history. This third store persists the per-mode setup controls
// that live ON each mode's screen (outside the ⚙ menu) — they're preferences too, so
// for a practice tool they should be remembered between visits, exactly like the menu
// settings. Previously each was a local useState inside its mode component and reset
// every visit.
//
// What it holds: Flash reveal speed; Blitz round/per-question timers + Per-Round/Question
// + Allow Mistakes; the AoX run length + Allow Mistakes + One-by-One; Deduction sub-type; and
// the per-mode show/hide stat toggles (timing/scoring), namespaced per mode since their
// defaults differ (Classic/Deduction launch with timing hidden, Flash with it shown). Those
// three non-round toggles feed useGameEngine's `timingOff` (timing actually pauses while hidden,
// with the desync-arm on re-enable). Blitz and AoX instead carry a VISUAL-ONLY timing toggle
// (blitzTimingOff/aoxTimingOff, launch SHOWN, Q8): it blanks the timing trio's display but never
// stops the engine clock — round/run timing is structural (the score/average is the mode), so
// there is no arm/reset and hiding can never desync. `allowMistakes` is likewise namespaced
// (blitz*/aox*).
//
// NOT here (intentionally): the current page — a preset's opening page is the `defaultMode` ⚙
// setting in store/settings, and its live session page is store/sessionMode (round-21 Q3); and any
// mid-game state — a half-finished timed run can't fairly resume.
//
// Same pattern as settings.ts: Zustand `persist` (localStorage 'cg-modeprefs-v1',
// versioned), each setter accepts a direct value OR a React-style functional updater
// (prev => next) so the components' setX(v=>!v) calls keep working, partialize strips
// the setters, and resetModePrefs() (called by App's Full Reset) overwrites the saved
// copy back to the launch defaults.

export type ModePrefsValues = {
  // Flash
  flashMs: number
  flashTimingOff: boolean
  flashScoringOff: boolean
  // Blitz
  blitzSec: number
  blitzQSec: number
  blitzPerQ: boolean
  blitzAllowMistakes: boolean
  blitzTimingOff: boolean // VISUAL-ONLY (Q8): blanks the timing trio; the engine keeps timing
  // AoX
  aoxN: string
  aoxAllowMistakes: boolean
  aoxOneByOne: boolean
  aoxTimingOff: boolean // VISUAL-ONLY (Q8): blanks the LIVE trio; a completed run still shows its result
  // Deduction
  dedType: string
  dedTimingOff: boolean
  dedScoringOff: boolean
  // Classic
  classicTimingOff: boolean
  classicScoringOff: boolean
}
type Updater<T> = T | ((prev: T) => T)
export type ModePrefsState = ModePrefsValues & {
  setFlashMs: (v: Updater<number>) => void
  setFlashTimingOff: (v: Updater<boolean>) => void
  setFlashScoringOff: (v: Updater<boolean>) => void
  setBlitzSec: (v: Updater<number>) => void
  setBlitzQSec: (v: Updater<number>) => void
  setBlitzPerQ: (v: Updater<boolean>) => void
  setBlitzAllowMistakes: (v: Updater<boolean>) => void
  setBlitzTimingOff: (v: Updater<boolean>) => void
  setAoxN: (v: Updater<string>) => void
  setAoxAllowMistakes: (v: Updater<boolean>) => void
  setAoxOneByOne: (v: Updater<boolean>) => void
  setAoxTimingOff: (v: Updater<boolean>) => void
  setDedType: (v: Updater<string>) => void
  setDedTimingOff: (v: Updater<boolean>) => void
  setDedScoringOff: (v: Updater<boolean>) => void
  setClassicTimingOff: (v: Updater<boolean>) => void
  setClassicScoringOff: (v: Updater<boolean>) => void
  resetModePrefs: () => void
  applyPrefs: (partial: Partial<ModePrefsValues>) => void
}

// The launch defaults — single source of truth, reused by resetModePrefs(). Timing hidden by
// default in Classic/Deduction, shown in Flash; Blitz and AoX launch with their VISUAL-ONLY
// timing SHOWN (blitzTimingOff/aoxTimingOff false — Q8). The Flash reveal (2s) and Blitz
// per-question countdown (10s) launch at beginner-friendly lengths (Round-2 timer audit,
// 2026-07-12, owner-ratified — a newcomer doing the mental method needs the headroom; elites
// turn them down).
export const MODE_PREFS_DEFAULTS: ModePrefsValues = {
  flashMs: 2000,
  flashTimingOff: false,
  flashScoringOff: false,
  blitzSec: 60,
  blitzQSec: 10,
  blitzPerQ: false,
  blitzAllowMistakes: true,
  blitzTimingOff: false,
  aoxN: '10',
  aoxAllowMistakes: false,
  aoxOneByOne: false,
  aoxTimingOff: false,
  dedType: 'day',
  dedTimingOff: true,
  dedScoringOff: false,
  classicTimingOff: true,
  classicScoringOff: false,
}

// resolve(next, prev): support React-style functional updaters.
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

// The set of keys we persist — exactly the data values (not the setters).
const PERSISTED_KEYS = Object.keys(MODE_PREFS_DEFAULTS) as (keyof ModePrefsValues)[]

export const useModePrefs = create<ModePrefsState>()(
  persist(
    (set) => ({
      ...MODE_PREFS_DEFAULTS,
      setFlashMs: (v) => set((s) => ({ flashMs: resolve(v, s.flashMs) })),
      setFlashTimingOff: (v) => set((s) => ({ flashTimingOff: resolve(v, s.flashTimingOff) })),
      setFlashScoringOff: (v) => set((s) => ({ flashScoringOff: resolve(v, s.flashScoringOff) })),
      setBlitzSec: (v) => set((s) => ({ blitzSec: resolve(v, s.blitzSec) })),
      setBlitzQSec: (v) => set((s) => ({ blitzQSec: resolve(v, s.blitzQSec) })),
      setBlitzPerQ: (v) => set((s) => ({ blitzPerQ: resolve(v, s.blitzPerQ) })),
      setBlitzAllowMistakes: (v) =>
        set((s) => ({ blitzAllowMistakes: resolve(v, s.blitzAllowMistakes) })),
      setBlitzTimingOff: (v) => set((s) => ({ blitzTimingOff: resolve(v, s.blitzTimingOff) })),
      setAoxN: (v) => set((s) => ({ aoxN: resolve(v, s.aoxN) })),
      setAoxAllowMistakes: (v) =>
        set((s) => ({ aoxAllowMistakes: resolve(v, s.aoxAllowMistakes) })),
      setAoxOneByOne: (v) => set((s) => ({ aoxOneByOne: resolve(v, s.aoxOneByOne) })),
      setAoxTimingOff: (v) => set((s) => ({ aoxTimingOff: resolve(v, s.aoxTimingOff) })),
      setDedType: (v) => set((s) => ({ dedType: resolve(v, s.dedType) })),
      setDedTimingOff: (v) => set((s) => ({ dedTimingOff: resolve(v, s.dedTimingOff) })),
      setDedScoringOff: (v) => set((s) => ({ dedScoringOff: resolve(v, s.dedScoringOff) })),
      setClassicTimingOff: (v) =>
        set((s) => ({ classicTimingOff: resolve(v, s.classicTimingOff) })),
      setClassicScoringOff: (v) =>
        set((s) => ({ classicScoringOff: resolve(v, s.classicScoringOff) })),
      // Reset every mode pref to its launch default in one shot. Because the store is
      // persisted, this also overwrites the saved copy back to defaults (Full Reset).
      resetModePrefs: () => set(() => ({ ...MODE_PREFS_DEFAULTS })),
      // Apply a partial value snapshot over the current state — App's Full Reset pushing the four
      // SAVED personal defaults (Flash speed, both Blitz timers, the AoX run length — store/userDefaults) back
      // over the factory resetModePrefs() it just ran; keys not in the partial keep their values.
      applyPrefs: (partial) => set(() => ({ ...partial })),
    }),
    {
      // The localStorage key, unchanged, now enumerated in store/presets alongside the other three
      // so a preset delete can remove exactly its own — and unchanged because preset 1 IS this
      // saved mode setup rather than a copy of it. The adapter beside it is what sends presets 2,
      // 3, 4… to a namespaced key without this `name` ever moving.
      name: PRESET_STORE_KEYS.modePrefs,
      storage: presetScopedStorage<Partial<ModePrefsState>>(),
      version: 1,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<ModePrefsState>,
      // Hydration replaces the mode setup rather than patching it over memory — at a cold start
      // identical to zustand's default, on a preset switch the difference between a new preset
      // opening on the factory Blitz timer and it inheriting the last preset's. See mergeOverDefaults.
      merge: mergeOverDefaults(() => MODE_PREFS_DEFAULTS),
    },
  ),
)
