// Shared types for App and the five mode screens. Extracted verbatim from main.tsx (the main.tsx split)
// so the screens can move out into their own modules without each re-declaring the contract.
import type { Question } from '../engine/gameReducer.js'
import type { FormatId } from '../lib/format.js'
import type { InputStyle } from '../store/settings.js'
import type { DotRotation } from '../lib/dotLayout.js'
import type { useGameEngine } from '../engine/useGameEngine.js'

// --- Shared types for the typed App + mode components (Stage C, TypeScript, final file). ---
export type GenDate = (minY: number, maxY: number) => Question
export type FmtDate = (y: number, m: number, d: number, fmt?: FormatId) => string
// FlashState.n — option count of the grid the flash was born in (set by Deduction, whose grids
// change size; see DeductionMode's gridFlash validity rule). The weekday modes omit it: their
// 7-grid is fixed, so the carried flash is always valid — the designed feedback.
export type FlashState = { type: 'good' | 'bad'; idx: number; n?: number }
export type GameEngine = ReturnType<typeof useGameEngine>
// ★ THE DATE SETTINGS A SCREEN IS HANDED ARE THE ONES IN EFFECT (lib/dateConfig's dateSettingsInEffect,
// computed once in App): minY / maxY are the range played, and `dateDraw` is every date setting a date
// is drawn under — the format bucket, the three chances ('random' wherever one cannot apply), and the
// range — as the one string every comparison, parked `config`, and Best key is built from. So a
// setting that is not in effect never reaches a screen at all, and changing it cannot reset,
// regenerate, or re-file anything. Date Format as stored still comes, for what it is in effect for on
// every page: the order of the codes in Deduction, and the format of a date that carries none of its
// own. (Deduction draws its own puzzles, so it alone is also handed the in-effect leap chances and
// Random Format — DedScreenProps.)
export interface ModeProps {
  visible: boolean
  minY: number
  maxY: number
  useJulian: boolean
  saveStats: boolean
  dateFormat: FormatId
  dateDraw: string
  inputStyle?: InputStyle // day-of-week answer layout (buttons | dots); weekday modes only — Deduction ignores it
  dotRotation?: DotRotation // how far that dot layout is turned (standard | ccw45 | ccw90); read only when inputStyle is 'dots'
  settingsOpen?: boolean //  the ⚙ popover open state — modes defer their settings side-effects to its CLOSE
  clockPaused?: boolean //  true while the rotate-back overlay covers the app — the countdown modes (Flash, Blitz) freeze their live clocks for its duration
  onFreshChange?: (fresh: boolean) => void
}
export interface DedScreenProps extends ModeProps {
  randomFormat: boolean
  leapChance: string // in effect: 'random' wherever it cannot apply
  janFebChance: string // in effect, likewise
}
export interface DedOpts {
  useJulian: boolean
  leapChance: string
  janFebChance: string
  randomFormat: boolean
  dateFormat: FormatId
  abCrossOnly: boolean
  julCrossOnly: boolean
  monthOnly1582: boolean
}
