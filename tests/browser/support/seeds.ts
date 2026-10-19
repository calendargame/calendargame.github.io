// tests/browser/support/seeds — WHAT IS ALREADY SAVED ON THE DEVICE WHEN A TEST OPENS THE APP.
//
// The lane runs the finished site, so it cannot reach into a store the way a Vitest case does; what
// it can do is what a returning player's browser does — hold saved data before the app starts.
// `storageFor` turns a description of that data into the exact text the app itself would have
// written: the same keys, the same `{ state, version }` envelope.
//
// ★ NOTHING HERE IS A SECOND COPY OF THE APP'S OWN FACTS, as far as that can be arranged:
//   • KEYS come from src/store/presets (the app's own constants and its own preset-suffix rule),
//     imported for real. Loading a store module in Node is harmless — with no `window` its persist
//     layer finds no storage and stays in memory.
//   • SHAPES are the stores' own types, so a seed that no longer matches a store fails
//     `npm run typecheck` before any browser starts.
//   • DEFAULTS are the stores' own, so a Best is filed under the configuration the app really
//     opens on.
//   • What IS written here by hand — each envelope's `version`, the two sessionStorage keys, and how
//     a Best's configuration key is spelled — is checked against the running app by
//     tests/browser/seeds.browser.ts, by OBSERVATION: it makes the app save, and compares.
// And every test confirms its seed on screen before measuring (support/app's rule), so a seed the
// app ignored can never pass as a result.
import { PRESET_REGISTRY_KEY, PRESET_STORE_KEYS, presetKey } from '../../../src/store/presets'
import type { PresetRegistryValues } from '../../../src/store/presets'
import { SETTINGS_DEFAULTS, type SettingsValues } from '../../../src/store/settings'
import { MODE_PREFS_DEFAULTS, type ModePrefsValues } from '../../../src/store/modePrefs'
import type { AoxBest, BlitzBest, ProgressValues } from '../../../src/store/progress'
import type { AmnesicMode } from '../../../src/store/amnesicMode'
import { deriveJulianRange, type JulianRangeValues } from '../../../src/store/julianRange'
import { bestKeyTail, dateSettingsInEffect } from '../../../src/lib/dateConfig'

export const THEMES = ['dusk', 'midnight', 'nebula', 'light', 'parchment'] as const
export type Theme = (typeof THEMES)[number]

// The `version` each store stamps its saved copy with today. A seed stamped with an OLDER number
// is still a valid save (the app migrates it on load, as it would a returning player's), so a
// number left behind here cannot break a test silently — and seeds.browser.ts fails until it is
// brought up to date.
export const SAVED_VERSION = {
  settings: 4,
  julianRange: 1,
  modePrefs: 1,
  progress: 5,
  presets: 1,
} as const

// The sessionStorage key that says "this browsing session is under way" (src/store/browsingSession —
// private there, so spelled again here, and held to the app by seeds.browser.ts).
export const SESSION_KEYS = {
  browsingSession: 'cg-browsing-session-v1',
} as const

export interface AppSeed {
  /** The ⚙ menu's values that differ from the defaults (preset 1's). */
  settings?: Partial<SettingsValues>
  /** The Year Range used while the Julian Calendar setting is on (preset 1's). Left out, the app
   *  derives it from `settings`' range on first open, as for any preset that has none
   *  (store/julianRange). */
  julianRange?: JulianRangeValues
  /** The per-mode setup that differs from the defaults (preset 1's). */
  modePrefs?: Partial<ModePrefsValues>
  /** Saved stats and Bests (preset 1's). */
  progress?: Partial<ProgressValues>
  /** The list of presets. Left out, there is the one preset every device starts with. */
  presets?: PresetRegistryValues
  /**
   * The Amnesic value each preset is on — a field of each preset's settings (src/store/settings) —
   * which is how the app comes to open on Stats Only or Full without a test clicking through the pill
   * every time.
   */
  amnesic?: Record<number, AmnesicMode>
}

export interface SeededStorage {
  local: Record<string, string>
  session: Record<string, string>
}

const envelope = (state: object, version: number) => JSON.stringify({ state, version })

/** The storage a device holding `seed` has, as the text the app would have written. */
export function storageFor(seed: AppSeed): SeededStorage {
  const local: Record<string, string> = {}
  const session: Record<string, string> = {}
  if (seed.settings)
    local[PRESET_STORE_KEYS.settings] = envelope(seed.settings, SAVED_VERSION.settings)
  if (seed.julianRange)
    local[PRESET_STORE_KEYS.julianRange] = envelope(seed.julianRange, SAVED_VERSION.julianRange)
  if (seed.modePrefs)
    local[PRESET_STORE_KEYS.modePrefs] = envelope(seed.modePrefs, SAVED_VERSION.modePrefs)
  if (seed.progress)
    local[PRESET_STORE_KEYS.progress] = envelope(seed.progress, SAVED_VERSION.progress)
  if (seed.presets) local[PRESET_REGISTRY_KEY] = envelope(seed.presets, SAVED_VERSION.presets)
  // (into each preset's settings, beside whatever else is seeded there)
  for (const [id, mode] of Object.entries(seed.amnesic ?? {})) {
    const key = presetKey(PRESET_STORE_KEYS.settings, +id)
    const state = local[key] ? (JSON.parse(local[key]) as { state: object }).state : {}
    local[key] = envelope({ ...state, amnesic: mode }, SAVED_VERSION.settings)
  }
  return { local, session }
}

/** A list of presets with these names, in this order, the first one active. */
export const presetsNamed = (...names: string[]): PresetRegistryValues => ({
  presets: names.map((name, i) => ({ id: i + 1, name, amnesic: false })),
  activeId: 1,
  nextId: names.length + 1,
  openInPreset: 'last',
})

// ── Bests ────────────────────────────────────────────────────────────────────────────────────
//
// A Best is filed under the exact configuration it was set on, as one string (modes/AoxMode's
// `bestKey`, modes/BlitzMode's `blitzBk`). These two spell that string for the configuration the app
// opens on — the stores' defaults, with whatever the same seed changes laid over them. The head
// (run length / timer, Allow Mistakes) is the app's spelling, repeated; the date half since Round 26
// is the app's own builder (lib/dateConfig: the date settings IN EFFECT), over the Julian-on Year
// Range a preset with none saved derives (store/julianRange) — which is what a seed gives it.
// seeds.browser.ts plays a real MoX run and a real Blitz round and fails if the record the app
// files is not under the key these give.
const dateConfig = (seed: AppSeed) => {
  const s = { ...SETTINGS_DEFAULTS, ...seed.settings }
  return bestKeyTail(dateSettingsInEffect(s, seed.julianRange ?? deriveJulianRange(s)))
}

export function moxBestKey(seed: AppSeed = {}): string {
  const prefs = { ...MODE_PREFS_DEFAULTS, ...seed.modePrefs }
  return `${prefs.aoxN}|${prefs.aoxAllowMistakes}|${dateConfig(seed)}`
}

export function blitzBestKey(seed: AppSeed = {}): string {
  const prefs = { ...MODE_PREFS_DEFAULTS, ...seed.modePrefs }
  return `${prefs.blitzAllowMistakes ? 'm' : 'n'}${prefs.blitzSec}|${dateConfig(seed)}`
}

/** Saved progress holding one MoX Best for the configuration the app opens on. */
export const moxBest = (best: AoxBest, seed: AppSeed = {}): Partial<ProgressValues> => ({
  aoxBest: { [moxBestKey(seed)]: best },
})

/** Saved progress holding one Blitz (Per Round) Best for the configuration the app opens on. */
export const blitzBest = (best: BlitzBest, seed: AppSeed = {}): Partial<ProgressValues> => ({
  blitzBest: { [blitzBestKey(seed)]: best },
})
