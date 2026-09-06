// Shared types for App and the five mode screens. Extracted verbatim from main.tsx (Q1 phase 1)
// so the screens can move out into their own modules without each re-declaring the contract.
import type { Question } from '../engine/gameReducer.js'
import type { FormatId } from '../lib/format.js'
import type { InputStyle } from '../store/settings.js'
import type { DotOrientation } from '../lib/dotLayout.js'
import type { useGameEngine } from '../engine/useGameEngine.js'

// --- Shared types for the typed App + mode components (Stage C, TypeScript, final file). ---
export type GenDate = (minY: number, maxY: number) => Question
export type FmtDate = (y: number, m: number, d: number, fmt?: FormatId) => string
// FlashState.n — option count of the grid the flash was born in (set by Deduction, whose grids
// change size; see DeductionMode's gridFlash validity rule). The weekday modes omit it: their
// 7-grid is fixed, so the carried flash is always valid — the designed feedback.
export type FlashState = { type: 'good' | 'bad'; idx: number; n?: number }
export type GameEngine = ReturnType<typeof useGameEngine>
export interface ModeProps {
  visible: boolean
  minY: number
  maxY: number
  useJulian: boolean
  saveStats: boolean
  dateFormat: FormatId
  randomFormat: boolean
  inputStyle?: InputStyle // day-of-week answer layout (buttons | dots); weekday modes only — Deduction ignores it
  dotOrientation?: DotOrientation // which way that dot layout is turned (columns | rows); read only when inputStyle is 'dots'
  leapChance: string
  janFebChance: string
  julianChance: string
  settingsOpen?: boolean //  the ⚙ popover open state — modes defer their settings side-effects to its CLOSE
  clockPaused?: boolean //  Q11: true while the rotate-back overlay covers the app — the countdown modes (Flash, Blitz) freeze their live clocks for its duration
  onFreshChange?: (fresh: boolean) => void
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
