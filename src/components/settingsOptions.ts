// components/settingsOptions.ts — the ⚙ Settings panel's PICKER option arrays.
//
// One array per PillTray tray (components/PillTray), and this is ALL of them, because round-9 made
// the tray the treatment for every picker in the panel (THE PICKER RULE, stated once at the Display
// section of components/SettingsPanel). Order within each array = left→right segment order.
//
// They live here rather than beside the markup for one reason: they were module scope in
// src/main.tsx, which imports the panel — so the panel cannot import them back without a cycle.
// Module scope is also where they belong: they are frozen tables, not state, and re-creating them
// per render would hand PillTray a new options array on every pass.
//
// MODE_LABELS deliberately did NOT come with them: it drives the bar's mode CustomSelect, which is
// not part of the panel and stays in main.tsx.
import type { FormatId } from '../lib/format.js'
import type { InputStyle, DefaultMode } from '../store/settings.js'

// Default Mode — the page a preset OPENS ON (round-21 Q3). Seven choices = the seven entries of the
// bar's mode CustomSelect (main.tsx MODE_LABELS), split across TWO stacked PillTrays reading and
// writing the ONE `defaultMode` setting (the Date Format family pattern): the five practice modes
// on the first row, Lookup + How to Play on the second. Whichever row does not hold the active
// value simply shows no selected segment. The labels are duplicated from MODE_LABELS rather than
// imported because MODE_LABELS deliberately stays in main.tsx (it drives a bar control, not a
// panel picker) — tests/ pins the two together.
export const DEFAULT_MODE_PRIMARY: { value: DefaultMode; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'aox', label: 'MoX' },
  { value: 'deduction', label: 'Deduction' },
  { value: 'flash', label: 'Flash' },
  { value: 'blitz', label: 'Blitz' },
]
export const DEFAULT_MODE_SECONDARY: { value: DefaultMode; label: string }[] = [
  { value: 'lookup', label: 'Lookup' },
  { value: 'guide', label: 'How to Play' },
]

// Date Format — five ids across TWO trays but ONE setting and ONE radiogroup, so whichever half
// doesn't hold the active id simply shows no selected segment. Sharing a group is also why 'MDY'
// and 'DMY' each appear twice: every pill states its half in its accessible name while the visible
// label stays the bare initialism.
export const WRITTEN_FORMATS: { value: FormatId; label: string; ariaLabel: string }[] = [
  { value: 'written-mdy', label: 'MDY', ariaLabel: 'Written MDY' },
  { value: 'written-dmy', label: 'DMY', ariaLabel: 'Written DMY' },
]
export const NUMERIC_FORMATS: { value: FormatId; label: string; ariaLabel: string }[] = [
  { value: 'numeric-mdy', label: 'MDY', ariaLabel: 'Numeric MDY' },
  { value: 'numeric-dmy', label: 'DMY', ariaLabel: 'Numeric DMY' },
  { value: 'numeric-ymd', label: 'YMD', ariaLabel: 'Numeric YMD' },
]
// Input — the day-of-week answer layout. Both names are unique in the panel, so no ariaLabel.
export const INPUT_STYLES: { value: InputStyle; label: string }[] = [
  { value: 'buttons', label: 'Buttons' },
  { value: 'dots', label: 'Dots' },
]
// Rotate Dots CCW — Q3 (round 20): no longer a picker array. The setting is a boolean now
// (store/settings' `rotateDots`), drawn as an On/Off switch like Amnesic/Save Stats rather than a
// PillTray, so there is no options table to keep here — see components/SettingsPanel's Rotate Dots CCW
// block for the control itself and lib/dotLayout's `dotOrientationFor` for the boolean → geometry
// derivation every consumer shares.
// Theme — two independent picks under Use System Settings, one pick ACROSS both rows when it's off
// (see the Theme block in the panel).
export const DARK_THEMES = [
  { value: 'dusk', label: 'Dusk' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'nebula', label: 'Nebula' },
]
export const LIGHT_THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'parchment', label: 'Parchment' },
]
// The Dates section's chance weights. Julian and Jan/Feb offer the same five; Leap Year drops 25%
// because ~1-in-4 IS its natural rate — a "25%" weight there would force nothing. Values are the
// store's own strings ('random' | the percentage), so no mapping is needed anywhere.
const chanceOptions = (...steps: string[]) =>
  steps.map((v) => ({ value: v, label: v === 'random' ? 'Random' : v + '%' }))
export const CHANCE_OPTIONS = chanceOptions('random', '25', '50', '75', '100')
export const LEAP_CHANCE_OPTIONS = chanceOptions('random', '50', '75', '100')
