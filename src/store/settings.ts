import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetKey, presetScopedStorage, mergeOverDefaults } from './presets.js'
import type { FormatId } from '../lib/format.js'
import type { DotOrientation } from '../lib/dotLayout.js'

// settings.js — the ⚙ Settings store (Stage C, Steps 5a + 5b).
//
// Holds the 16 values that live in the Settings popover (13 at the Stage-C extraction; the Input
// style was added Session 10, the Rotate Dots CCW toggle in batch group 3, `defaultMode` in
// round-21 Q3). Originally these were useState hooks inside App; centralizing them
// is the structural groundwork
// for (a) saved-progress and (b) splitting the fused game modes apart later,
// since the modes can read settings from here instead of receiving them all as
// threaded props.
//
// Step 5b — PERSISTENCE: the store is wrapped in Zustand's `persist` middleware,
// so the 16 settings save to the device (localStorage key 'cg-settings-v1') and
// restore on reload. Only the data values are persisted (partialize strips the
// setter functions); Zustand merges the saved values over the fresh store on
// load, so the setters always come from the live code, never from storage. The
// versioned key lets us migrate cleanly if the settings shape ever changes.
//
// DROP-IN CONTRACT: each setter accepts EITHER a direct value OR a functional
// updater (prev => next) — exactly like a React useState setter — so the call
// sites in App that do setUseJulian(v=>!v) keep working verbatim. App binds the
// store fields/setters to the SAME local names it used before, so the ~200 read
// sites and the big settingsAtDefaults / isFullyReset boolean expressions are
// untouched.
//
// NOT in this store (intentionally): minInputVal / maxInputVal — those are
// transient text-input mirror strings, not persisted settings; they stay as
// local useState in App.

// The day-of-week answer input layout: the classic labelled buttons, or the logo's 7-dot grid
// (Settings → Input). Stored as an enum (not a boolean) so more layouts can be added later.
export type InputStyle = 'buttons' | 'dots'

// defaultMode — the page a preset OPENS ON (round-21 Q3). One of the seven entries of the bar's
// mode CustomSelect (main.tsx MODE_LABELS): the five practice modes, Lookup, and How to Play
// ('guide'). It is a per-preset ⚙ setting like the fifteen above it — persisted here, captured by
// Save Defaults (SavedDefaults.settings is a full SettingsValues snapshot, so it rides along with
// no extra wiring) and restored by Reset Settings / Full Reset. It only takes EFFECT on a cold
// open or a preset switch — main.tsx reads it then via readStoredDefaultMode below and calls
// switchMode; nothing else consults it. The app-global "open in which preset" pin is a SEPARATE
// thing and lives on the registry (store/presets' openInPreset), not here — this store is
// per-preset and cannot hold a global.
export type DefaultMode = 'classic' | 'flash' | 'blitz' | 'deduction' | 'aox' | 'lookup' | 'guide'
export const DEFAULT_MODE_VALUES: readonly DefaultMode[] = [
  'classic',
  'flash',
  'blitz',
  'deduction',
  'aox',
  'lookup',
  'guide',
]
export const isDefaultMode = (v: unknown): v is DefaultMode =>
  typeof v === 'string' && (DEFAULT_MODE_VALUES as readonly string[]).includes(v)
// Q3 (round 20): `dotOrientation: DotOrientation` ('columns' | 'rows', a PillTray choice of two
// named options) became `rotateDots: boolean` below — the two options were always an on/off shape,
// and the bug the rename fixes was never in this store at all: main.tsx's W5Logo used to read this
// setting UNCONDITIONALLY, so a player on Buttons could leave it on and the title-bar mark sat
// rotated forever with no dots on screen it corresponded to. DotOrientation itself is unchanged and
// stays exactly where it always lived — lib/dotLayout, the geometry file — and is no longer
// re-exported here: every remaining reader (WeekdayAnswer, W5Logo, GuidePage's DotDiagram,
// modes/modeTypes) imports it straight from there, and lib/dotLayout's `dotOrientationFor` is the
// one place this store's boolean is turned back into that type.

// The 16 settings values, then the full store (values + setters). Each setter takes a direct
// value OR a React-style functional updater (prev => next), matching App's setX(v=>!v) call sites.
export type SettingsValues = {
  randomFormat: boolean
  dateFormat: FormatId
  inputStyle: InputStyle
  rotateDots: boolean
  defaultMode: DefaultMode
  useJulian: boolean
  minY: number
  maxY: number
  leapChance: string
  janFebChance: string
  julianChance: string
  saveStats: boolean
  useSystem: boolean
  darkTheme: string
  lightTheme: string
  manualTheme: string
}
type Updater<T> = T | ((prev: T) => T)
export type SettingsState = SettingsValues & {
  setRandomFormat: (v: Updater<boolean>) => void
  setDateFormat: (v: Updater<FormatId>) => void
  setInputStyle: (v: Updater<InputStyle>) => void
  setRotateDots: (v: Updater<boolean>) => void
  setDefaultMode: (v: Updater<DefaultMode>) => void
  setUseJulian: (v: Updater<boolean>) => void
  setMinY: (v: Updater<number>) => void
  setMaxY: (v: Updater<number>) => void
  setLeapChance: (v: Updater<string>) => void
  setJanFebChance: (v: Updater<string>) => void
  setJulianChance: (v: Updater<string>) => void
  setSaveStats: (v: Updater<boolean>) => void
  setUseSystem: (v: Updater<boolean>) => void
  setDarkTheme: (v: Updater<string>) => void
  setLightTheme: (v: Updater<string>) => void
  setManualTheme: (v: Updater<string>) => void
  /** ⚠ FACTORY reset — restores SETTINGS_DEFAULTS unconditionally. This is NOT the ⚙ panel's
   *  Reset Settings button, which lands on the user's SAVED personal defaults. Read the warning
   *  at the implementation below before calling this from anywhere outside the test suite. */
  resetToFactory: () => void
  applySettings: (values: SettingsValues) => void
}

// The launch defaults — single source of truth, reused by resetToFactory().
// randomFormat launches OFF (Round-2, 2026-07-12, owner-ratified): a newcomer sees one
// consistent format (Written MDY) instead of five rotating ones; Random stays one tap away.
export const SETTINGS_DEFAULTS: SettingsValues = {
  randomFormat: false,
  dateFormat: 'written-mdy',
  inputStyle: 'buttons',
  // Launches upright — the orientation the app icon, the launch PNGs and every screenshot already
  // show. `true` (turned) is the opt-in.
  rotateDots: false,
  // Every preset opens on Classic until the player picks otherwise — the behaviour the app has
  // always had (main.tsx's `mode` useState was hard-coded to "classic"). An absent key on a
  // pre-Q3 payload merges to exactly this, so v2→v3 needs no migrate function.
  defaultMode: 'classic',
  useJulian: true,
  minY: 1,
  maxY: 10000,
  leapChance: 'random',
  janFebChance: 'random',
  julianChance: 'random',
  saveStats: true,
  useSystem: true,
  darkTheme: 'dusk',
  lightTheme: 'light',
  manualTheme: 'dusk',
}

// resolve(next, prev): support React-style functional updaters.
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

// The set of keys we persist — exactly the data values (not the setters). DERIVED from
// SETTINGS_DEFAULTS rather than listed, so the "16" every comment in this file quotes cannot drift
// from the code: add a setting to SETTINGS_DEFAULTS and it is persisted by construction. ⚠ 16 here
// counts the STORE's settings only. The Save Defaults snapshot is 20 (these 16 + 4 mode prefs) and
// the gear's "modified" comparison is 21 or 20 — both counted in main.tsx, at resetSettings and
// settingsAtDefaults respectively. Do not carry this number over to them.
// ⚠ THE COMPARISON IS NOT A SUBSET OF THE SNAPSHOT, and round 15 is what changed that: it is 19 or
// 18 of the snapshot's 20 (a dormant theme value is always excluded) PLUS the ⚙ panel's two Year
// Range TEXT BOXES, which live in components/useYearRangeMirrors and are stored nowhere. So a year
// that has been TYPED but not committed counts as "modified" while there is nothing to save for it.
const PERSISTED_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsValues)[]

// v1 → v2: the picker's old `dotOrientation` ('columns' | 'rows') collapses to the boolean it was
// always describing — 'rows' is the turned/opt-in state, so it becomes `rotateDots: true`;
// 'columns' becomes `false`. The old field name is not carried forward (nothing in this store's
// shape reads it any more, and PERSISTED_KEYS — derived from SETTINGS_DEFAULTS — will never
// re-persist it either). Mirrors progress.ts's `migrateAoxBestKeys`: a small pure rewrite, exported
// so the transformation is tested directly rather than only through a simulated rehydrate. Called
// only once `migrate` below has confirmed `dotOrientation` is actually present.
export function migrateDotOrientation(
  state: Partial<SettingsValues> & { dotOrientation?: DotOrientation },
): Partial<SettingsValues> {
  const { dotOrientation, ...rest } = state
  return { ...rest, rotateDots: dotOrientation === 'rows' }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setRandomFormat: (v) => set((s) => ({ randomFormat: resolve(v, s.randomFormat) })),
      setDateFormat: (v) => set((s) => ({ dateFormat: resolve(v, s.dateFormat) })),
      setInputStyle: (v) => set((s) => ({ inputStyle: resolve(v, s.inputStyle) })),
      setRotateDots: (v) => set((s) => ({ rotateDots: resolve(v, s.rotateDots) })),
      setDefaultMode: (v) => set((s) => ({ defaultMode: resolve(v, s.defaultMode) })),
      setUseJulian: (v) => set((s) => ({ useJulian: resolve(v, s.useJulian) })),
      setMinY: (v) => set((s) => ({ minY: resolve(v, s.minY) })),
      setMaxY: (v) => set((s) => ({ maxY: resolve(v, s.maxY) })),
      setLeapChance: (v) => set((s) => ({ leapChance: resolve(v, s.leapChance) })),
      setJanFebChance: (v) => set((s) => ({ janFebChance: resolve(v, s.janFebChance) })),
      setJulianChance: (v) => set((s) => ({ julianChance: resolve(v, s.julianChance) })),
      setSaveStats: (v) => set((s) => ({ saveStats: resolve(v, s.saveStats) })),
      setUseSystem: (v) => set((s) => ({ useSystem: resolve(v, s.useSystem) })),
      setDarkTheme: (v) => set((s) => ({ darkTheme: resolve(v, s.darkTheme) })),
      setLightTheme: (v) => set((s) => ({ lightTheme: resolve(v, s.lightTheme) })),
      setManualTheme: (v) => set((s) => ({ manualTheme: resolve(v, s.manualTheme) })),
      // ⚠⚠ WHAT THIS IS: a FACTORY reset. It overwrites all 16 settings with SETTINGS_DEFAULTS,
      // unconditionally, ignoring anything the user has saved.
      // ⚠⚠ WHAT THIS IS NOT: the ⚙ panel's "RESET SETTINGS" BUTTON. That button is App's own
      // resetSettings in main.tsx, which restores the user's EFFECTIVE defaults — their SAVED
      // personal defaults (Q7, store/userDefaults) when a snapshot exists, factory only when none
      // does — and additionally restores the two year-range text mirrors and the four capturable
      // mode prefs. Until round 15 this action was itself called `resetSettings`, so the two
      // differed by nothing but their file; the rename is the whole of the fix, and the paragraph
      // below is why it was worth touching sixteen test files to get.
      //   → REACHING FOR THIS ONE FROM APP CODE SILENTLY REVERTS THE WHOLE SAVED-DEFAULTS FEATURE:
      //     the user's saved snapshot survives in its own store, so nothing looks broken, but
      //     "reset" quietly stops meaning what the feature promises. Use applySettings(values) with
      //     effectiveSettingsDefaults instead — that is what App does.
      //   ★ NO APP CODE CALLS THIS. Its only consumers are the test suite's per-case store cleanup
      //     — 51 call sites across 16 files under tests/, one of them tests/helpers/settingsPanel's
      //     resetAppState() — where factory-reset is exactly the wanted semantic.
      // Because the store is persisted, this also overwrites the saved copy back to factory.
      resetToFactory: () => set(() => ({ ...SETTINGS_DEFAULTS })),
      // Apply a full 16-value snapshot in one shot — the values half of what App's Reset Settings
      // and Full Reset restore (the user's SAVED personal defaults via store/userDefaults; the
      // factory SETTINGS_DEFAULTS only when none are saved). This, not resetToFactory above, is the
      // action app code should reach for. Persisted like any set, so the applied values become the
      // stored copy.
      applySettings: (values) => set(() => ({ ...values })),
    }),
    {
      // The localStorage key (versioned for future migrations). It lives in store/presets now, with
      // the other three, because DELETING a preset has to remove exactly its four keys and nothing
      // else — which is only checkable if one place can enumerate them. ⚠ THE STRING IS UNCHANGED,
      // and that is the whole preset design in one line: preset 1 does not receive the existing
      // saved settings, preset 1 IS them.
      // ⚠ THIS STORE IS WHERE THAT PROMISE IS AT ITS WEAKEST, and it is worth stating here rather
      // than leaving to be rediscovered: the live site and staging share this origin, so an OLD
      // build and this one really do interleave on this key. The key they agree about is identical;
      // the PAYLOAD is only as complete as the older build's own `partialize`. A build that still
      // writes the old `dotOrientation` field (pre-Q3) saves its OWN `version: 1` alongside it, so
      // THIS build's `migrate` below still catches it on the next boot here and `rotateDots` comes
      // back correct — the one case the interleaving cannot silently lose. A build from before
      // dotOrientation existed at all writes neither field, and that boot reads the factory
      // `rotateDots: false`, the same silent-revert shape every setting added after launch already
      // has. Nothing is mis-attributed and no stats are involved either way; it is the price of one
      // key serving more than one build in flight, argued in full in store/presets' header.
      name: PRESET_STORE_KEYS.settings,
      // …and this is what makes presets 2, 3, 4… land somewhere else. The `name` above never
      // changes; the adapter rewrites it to the ACTIVE preset's key at each read and each write.
      // See store/presets for why that beat swapping the name on every switch.
      storage: presetScopedStorage<Partial<SettingsState>>(),
      // v2 = dotOrientation LEFT the shape (Q3, round 20 — see the `migrate` step immediately
      // below, and the field's own comment near SettingsValues above).
      // v3 = `defaultMode` JOINED the shape (round-21 Q3). It needs no `migrate` branch: an absent
      // key on a v2 (or older) payload is exactly what `mergeOverDefaults` turns into the factory
      // 'classic', which is the pre-Q3 behaviour. The bump is here only so the version field keeps
      // pace with the shape and a future rewrite has a gate to hang off.
      version: 3,
      // Saved-shape migrations — the version-gated REWRITE, run once at hydrate when the stored
      // version is older. Only dotOrientation → rotateDots needs one: a stored 'rows'/'columns' is
      // information a later read cannot reconstruct from the boolean alone, exactly the shape
      // progress.ts's own v1→v2 aoxBest migration argues in full (this store follows that precedent
      // rather than re-deriving it). `migrate` runs BEFORE `merge` below, so by the time the
      // unscreened persisted-spread in `merge` sees this object it already carries `rotateDots` (or
      // nothing at all, for a payload that never had `dotOrientation` either) — `merge` itself needs
      // no special-casing for the same reason progress.ts's `mergeOverDefaults` needed none for
      // aoxBest: the rewrite already produced the CURRENT shape.
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsValues> & { dotOrientation?: DotOrientation }
        return version < 2 && state && 'dotOrientation' in state
          ? migrateDotOrientation(state)
          : state
      },
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<SettingsState>,
      // Hydration REPLACES the settings; it does not patch the saved copy over whatever is in
      // memory. Identical to zustand's default merge at a cold start (where memory already holds
      // SETTINGS_DEFAULTS); the difference shows on a preset switch, where the default would let a
      // preset that has never saved a given setting inherit the last preset's value — including the
      // theme, which would be visible on screen. Argued in full at mergeOverDefaults.
      merge: mergeOverDefaults(() => SETTINGS_DEFAULTS),
    },
  ),
)

// ★ THE defaultMode OF ANY PRESET, read straight off ITS namespaced settings key rather than
// through the live store (which is only ever the ACTIVE preset's — persist scopes it via
// store/presets' presetScopedStorage). The mirror of store/userDefaults' storedAmnesicDefault, and
// it exists for the same reason: on a mid-session preset switch, store/presetControl's switchPreset
// writes the registry (firing main.tsx's remount subscription) BEFORE it rehydrates the four
// per-preset stores, so at the instant the subscription reads the incoming preset's opening page
// the live useSettings still holds the OUTGOING preset's values. This reads the incoming preset's
// own payload off disk instead. main.tsx's cold-open effect uses it too, for one code path.
//
// Reads the persist envelope directly — the same `{ state: {...} }` shape store/presets'
// readStoredRegistry and store/userDefaults' storedAmnesicDefault parse. Only `state.defaultMode`
// is consulted, which no migration step touches, so none is reproduced here. An absent, unreadable,
// malformed or out-of-range value is treated as the factory 'classic' — the pre-Q3 behaviour, and
// the correct landing for a payload that cannot be trusted to say where it wanted to open.
// ⚠ The ACTIVE preset's key is the un-namespaced base key (presetKey's identity), so this one path
// covers it too — no special case.
export const readStoredDefaultMode = (presetId: number): DefaultMode => {
  try {
    const raw = window.localStorage.getItem(presetKey(PRESET_STORE_KEYS.settings, presetId))
    if (raw === null) return 'classic'
    const envelope: unknown = JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    const v =
      state && typeof state === 'object' ? (state as { defaultMode?: unknown }).defaultMode : null
    return isDefaultMode(v) ? v : 'classic'
  } catch {
    return 'classic'
  }
}
