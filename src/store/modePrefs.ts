import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
// + Allow Mistakes; AoX count (N) + Allow Mistakes + One-By-One; Deduction sub-type; and
// the per-mode show/hide stat toggles (timing/scoring), namespaced per mode since their
// defaults differ (Classic/Deduction launch with timing hidden, Flash with it shown).
// `allowMistakes` is likewise namespaced (blitz*/aox*).
//
// NOT here (intentionally): the current tab — the app always opens to Classic; and any
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
  // AoX
  aoxN: string
  aoxAllowMistakes: boolean
  aoxOneByOne: boolean
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
  setAoxN: (v: Updater<string>) => void
  setAoxAllowMistakes: (v: Updater<boolean>) => void
  setAoxOneByOne: (v: Updater<boolean>) => void
  setDedType: (v: Updater<string>) => void
  setDedTimingOff: (v: Updater<boolean>) => void
  setDedScoringOff: (v: Updater<boolean>) => void
  setClassicTimingOff: (v: Updater<boolean>) => void
  setClassicScoringOff: (v: Updater<boolean>) => void
  resetModePrefs: () => void
}

// The launch defaults — single source of truth (match the components' old useState defaults),
// reused by resetModePrefs(). Timing hidden by default in Classic/Deduction, shown in Flash.
export const MODE_PREFS_DEFAULTS: ModePrefsValues = {
  flashMs: 500,
  flashTimingOff: false,
  flashScoringOff: false,
  blitzSec: 60,
  blitzQSec: 5,
  blitzPerQ: false,
  blitzAllowMistakes: true,
  aoxN: '10',
  aoxAllowMistakes: false,
  aoxOneByOne: false,
  dedType: 'day',
  dedTimingOff: true,
  dedScoringOff: false,
  classicTimingOff: true,
  classicScoringOff: false,
}

// resolve(next, prev): support React-style functional updaters.
const resolve = <T,>(next: Updater<T>, prev: T): T =>
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
      setBlitzAllowMistakes: (v) => set((s) => ({ blitzAllowMistakes: resolve(v, s.blitzAllowMistakes) })),
      setAoxN: (v) => set((s) => ({ aoxN: resolve(v, s.aoxN) })),
      setAoxAllowMistakes: (v) => set((s) => ({ aoxAllowMistakes: resolve(v, s.aoxAllowMistakes) })),
      setAoxOneByOne: (v) => set((s) => ({ aoxOneByOne: resolve(v, s.aoxOneByOne) })),
      setDedType: (v) => set((s) => ({ dedType: resolve(v, s.dedType) })),
      setDedTimingOff: (v) => set((s) => ({ dedTimingOff: resolve(v, s.dedTimingOff) })),
      setDedScoringOff: (v) => set((s) => ({ dedScoringOff: resolve(v, s.dedScoringOff) })),
      setClassicTimingOff: (v) => set((s) => ({ classicTimingOff: resolve(v, s.classicTimingOff) })),
      setClassicScoringOff: (v) => set((s) => ({ classicScoringOff: resolve(v, s.classicScoringOff) })),
      // Reset every mode pref to its launch default in one shot. Because the store is
      // persisted, this also overwrites the saved copy back to defaults (Full Reset).
      resetModePrefs: () => set(() => ({ ...MODE_PREFS_DEFAULTS })),
    }),
    {
      name: 'cg-modeprefs-v1', // localStorage key (versioned for future migrations)
      version: 1,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<ModePrefsState>,
    },
  ),
)
