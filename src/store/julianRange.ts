import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetDoc } from './presets.js'
import type { PresetDocSpec } from './presets.js'
import { useSettings } from './settings.js'
import { YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN } from '../lib/calendar.js'

// store/julianRange.ts — THE YEAR RANGE USED WHILE THE JULIAN CALENDAR SETTING IS ON (Round 26, Q7).
//
// The ⚙ panel has two Year Range pairs: one for Julian off (1-10000), one for Julian on (1-11582 —
// years 10001-11582 are modern-calendar years whose last four digits behave like a four-digit year's,
// since 10000 = 25 x 400). The Julian-OFF pair is the settings store's `minY` / `maxY`, unchanged in
// name, shape, and version, so every older build on this origin (the live site and the test site
// share one copy of the data) reads and writes it exactly as it always has — to them it is simply
// "the range". The Julian-ON pair lives HERE, in a key of its own that no older build knows exists.
//
// ★ WHY A KEY OF ITS OWN, NOT TWO MORE FIELDS IN THE SETTINGS BLOB. An older build saves the settings
// blob through its own `partialize`, which keeps only the 16 fields it knows — so a pair kept there
// would be dropped every time the live app changed a theme, and then re-derived: a player who had set
// the Julian-on top year back to 10000 (to see their Bests from that range) would find it at 11582
// again. Here, nothing an older build does can touch it.
//
// ★ THE PAIR AND THE RULE THAT FIRST SETS IT. A preset this build has never opened has no key. The
// first time it is opened the pair is DERIVED from that preset's Julian-off pair (deriveJulianRange:
// the standard 1-10000 becomes 1-11582; any range the player chose is kept, because before this
// release switching Julian on kept the range) and PINNED — written once. From then on the key's
// presence means "already decided" and the pair is whatever is saved, for good: editing the Julian-
// off pair here or in an older tab can never move it. ⚠ THAT WRITE IS THE ONE EXCEPTION to "loading
// a preset writes nothing" (store/presetControl's reloadPresetStores): it creates a new key and
// rewrites nothing that exists, so it migrates no stored data. It is TRIED (the door's trySave —
// nothing held, no notice): on a full device the pair is simply derived again next time, from the
// same Julian-off pair. Through the windows-in-sync door like every per-preset doc, as one slice (the
// pair): another window's change to it comes in as the Julian-on range does when it is typed here.
// ⚠ "An untouched default" cannot be told from a deliberate 1-10000 — the bytes are the same — so a
// player who chose 1-10000 is moved to 1-11582 once, and an edit back to 10000 then sticks.
//
// ★ ONE MODULE READS AND WRITES THE KEY. Everything about the pair — its shape, what is valid, the
// derivation, the pin — is here, so the storage update's cross-window sync can wire it in like the
// other per-preset stores. It is listed in store/presets' PRESET_STORE_KEYS (so deleting a preset,
// "is any of it on disk?", and the storage reading all cover it by being listed) and in
// store/presetControl's PER_PRESET_STORES after the settings store (it derives from the settings just
// loaded) and its DUPLICATE_RULES (a copy carries it). An older build's preset delete removes only the
// four keys it knows, so a cold open sweeps the key of any preset no registry names
// (presetControl's sweepDeletedPresetLeftovers).

export type JulianRangeValues = { julianMinY: number; julianMaxY: number }
export type JulianRangeState = JulianRangeValues & {
  setJulianMinY: (v: number) => void
  setJulianMaxY: (v: number) => void
  applyJulianRange: (v: JulianRangeValues) => void
}

// A new preset's pair, and the derivation's answer for the factory Julian-off pair.
export const JULIAN_RANGE_DEFAULTS: JulianRangeValues = {
  julianMinY: 1,
  julianMaxY: YEAR_MAX_JULIAN,
}

// The pair for a preset that has none yet, from its Julian-off pair.
export const deriveJulianRange = (off: { minY: number; maxY: number }): JulianRangeValues =>
  off.minY === 1 && off.maxY === YEAR_MAX_GREGORIAN
    ? { ...JULIAN_RANGE_DEFAULTS }
    : { julianMinY: off.minY, julianMaxY: off.maxY }

const isYear = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= YEAR_MAX_JULIAN
// A saved pair this build can use: two whole years, 1 <= min <= max <= 11582. Anything else is no
// pair at all (and is derived again), never a guess at what was meant.
export const readJulianRange = (v: unknown): JulianRangeValues | null => {
  if (!v || typeof v !== 'object') return null
  const { julianMinY, julianMaxY } = v as Partial<Record<keyof JulianRangeValues, unknown>>
  return isYear(julianMinY) && isYear(julianMaxY) && julianMinY <= julianMaxY
    ? { julianMinY, julianMaxY }
    : null
}

const VERSION = 1
// Set by `merge` when the preset just loaded had no usable pair, read once by the hydration's end.
let needsPin = false

export const JULIAN_RANGE_DOC: PresetDocSpec = {
  kind: 'julianRange',
  base: PRESET_STORE_KEYS.julianRange,
  version: VERSION,
  defaultOf: () => undefined,
  regs: () => ['range'],
  toSlices: (state) => ({ range: { julianMinY: state.julianMinY, julianMaxY: state.julianMaxY } }),
  fromSlices: (slices) =>
    slices.range && typeof slices.range === 'object' ? { ...slices.range } : {},
  sliceState: (docState) =>
    'julianMinY' in docState || 'julianMaxY' in docState
      ? { range: { julianMinY: docState.julianMinY, julianMaxY: docState.julianMaxY } }
      : {},
  docState: (slices) =>
    slices.range && typeof slices.range === 'object' ? { ...slices.range } : {},
  patchOf: (now) => readJulianRange(now.range),
}
const JULIAN_RANGE_DOOR = presetDoc<JulianRangeValues>(JULIAN_RANGE_DOC)

export const useJulianRange = create<JulianRangeState>()(
  persist(
    (set) => ({
      ...deriveJulianRange(useSettings.getState()),
      setJulianMinY: (julianMinY) => set(() => ({ julianMinY })),
      setJulianMaxY: (julianMaxY) => set(() => ({ julianMaxY })),
      applyJulianRange: (v) => set(() => ({ ...v })),
    }),
    {
      name: PRESET_STORE_KEYS.julianRange,
      storage: JULIAN_RANGE_DOOR,
      version: VERSION,
      // (a copy saved under another version is judged by its fields, like any other: readJulianRange
      // in `merge` - the door hands every doc over at this version)
      partialize: (s) => ({ julianMinY: s.julianMinY, julianMaxY: s.julianMaxY }),
      // The saved pair when there is one; otherwise the derivation, from the settings store — which
      // has just loaded the same preset (it hydrates first, at its creation and in every reload).
      merge: (persisted, current) => {
        const saved = readJulianRange(persisted)
        needsPin = saved === null
        return { ...current, ...(saved ?? deriveJulianRange(useSettings.getState())) }
      },
      // …and the pin, for a pair that was derived.
      onRehydrateStorage: () => (state) => {
        if (!needsPin || !state) return
        needsPin = false
        // (refused: nothing is kept, so the pair is derived again next time)
        JULIAN_RANGE_DOOR.trySave({
          state: { julianMinY: state.julianMinY, julianMaxY: state.julianMaxY },
          version: VERSION,
        })
      },
    },
  ),
)
JULIAN_RANGE_DOOR.attach(useJulianRange)
