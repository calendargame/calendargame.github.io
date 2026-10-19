import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  PRESET_STORE_KEYS,
  presetKey,
  presetFieldsSpec,
  presetDoc,
  presetListed,
  mergeOverDefaults,
  usePresets,
} from './presets.js'
import { readItem, removeItem } from './storageHealth.js'
import { isAmnesicMode, readAmnesicMode, type AmnesicMode } from './amnesicMode.js'
import type { FormatId } from '../lib/format.js'
import { YEAR_MAX_GREGORIAN } from '../lib/calendar.js'
import { isDotRotation, type DotRotation } from '../lib/dotLayout.js'
import { isPageId, type PageId } from '../lib/modes.js'
import { reportedHydration } from './hydrationReport.js'

// settings.js — the ⚙ Settings store (Stage C, Steps 5a + 5b).
//
// Holds the 16 values that live in the Settings popover (13 at the Stage-C extraction; the Input
// style was added Session 10, the Rotate Dots setting in batch group 3, `defaultMode` in
// Round 21). Originally these were useState hooks inside App; centralizing them
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

// defaultMode — the page a preset OPENS ON (round 21). One of the pages in lib/modes' PAGES — the
// practice modes, Lookup, and How to Play ('guide') — and saved by its ID, never by its position
// in that list, so reordering the pages cannot change what a stored value means. It is a per-preset ⚙ setting like the fifteen above it — persisted here, captured by
// Save Defaults (SavedDefaults.settings is a full SettingsValues snapshot, so it rides along with
// no extra wiring) and restored by Reset Settings / Full Reset. It only takes EFFECT on a cold
// open or a preset switch — main.tsx reads it then via readStoredDefaultMode below and calls
// switchMode; nothing else consults it. The app-global "open in which preset" pin is a SEPARATE
// thing and lives on the registry (store/presets' openInPreset), not here — this store is
// per-preset and cannot hold a global.
export type DefaultMode = PageId
// `dotRotation` — Settings → Display → Rotate Dots, a three-way pill: Standard / 45° CCW / 90° CCW
// (round 23). ITS HISTORY, because two older shapes of it are still out there in saved data and
// migrateDotRotation below reads both: it launched as `dotOrientation: 'columns' | 'rows'` (a
// two-option picker), became the boolean `rotateDots` in round 20 (two named options were
// always an on/off shape), and became this when 45° was added. Its type, DotRotation, lives in
// lib/dotLayout, the geometry file, because every geometry table there is indexed by it directly.

// The 16 settings values, then the full store (values + setters). Each setter takes a direct
// value OR a React-style functional updater (prev => next), matching App's setX(v=>!v) call sites.
export type SettingsValues = {
  randomFormat: boolean
  dateFormat: FormatId
  inputStyle: InputStyle
  dotRotation: DotRotation
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
  /** The preset's AMNESIC value (Off / Stats Only / Full - store/amnesicMode; design-q1-q2.md v4, 9). A
   *  field of the settings doc like any other, but NOT one of the 16: it decides which copy of the
   *  saved progress the screens are on, so it is changed only with the work a change implies -
   *  store/presetControl's setPresetAmnesic here, applyAmnesicChange for another window's change - and
   *  no factory reset or snapshot apply below touches it. */
  amnesic: AmnesicMode
  setRandomFormat: (v: Updater<boolean>) => void
  setDateFormat: (v: Updater<FormatId>) => void
  setInputStyle: (v: Updater<InputStyle>) => void
  setDotRotation: (v: Updater<DotRotation>) => void
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
  // Launches Standard — the orientation the app icon, the launch PNGs and every screenshot already
  // show. Both turns are opt-in.
  dotRotation: 'standard',
  // Every preset opens on Classic until the player picks otherwise — the behaviour the app has
  // always had (main.tsx's `mode` useState was hard-coded to "classic"). An absent key on a
  // payload from before `defaultMode` existed merges to exactly this, so v2→v3 needs no migrate function.
  defaultMode: 'classic',
  useJulian: true,
  // The range used while the Julian Calendar setting is OFF (Round 26, Q7) — to every older build on
  // this origin, simply "the range". The Julian-on range is store/julianRange's, in a key of its own.
  minY: 1,
  maxY: YEAR_MAX_GREGORIAN,
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
// counts the STORE's settings only. The Save Defaults snapshot is 21 (these 16 + 4 mode prefs + the
// preset's Amnesic value) and the gear's "modified" comparison is 22 or 21 — both counted in
// main.tsx, at resetSettings and settingsAtDefaults respectively. Do not carry this number over.
// ⚠ THE COMPARISON IS NOT A SUBSET OF THE SNAPSHOT, and round 15 is what changed that: it is 20 or
// 19 of the snapshot's 21 (a dormant theme value is always excluded) PLUS the ⚙ panel's two Year
// Range TEXT BOXES, which live in components/useYearRangeMirrors and are stored nowhere. So a year
// that has been TYPED but not committed counts as "modified" while there is nothing to save for it.
// (Round 22 closed the gap the other way — amnesic was in the snapshot and NOT in the
// comparison, which left Save Defaults unreachable for an amnesic-only change.)
// (…and the preset's Amnesic value: in the same doc, outside the 16 - at SettingsState.)
const PERSISTED_KEYS = [
  ...(Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsValues)[]),
  'amnesic',
] as const

// The two shapes the Rotate Dots setting was saved in before today's `dotRotation` (its history is
// at SettingsValues above). Typed `unknown` because they are read off saved data, never trusted.
export type LegacyDotFields = { dotOrientation?: unknown; rotateDots?: unknown }

// ★ THE ROTATE DOTS MIGRATION — every saved shape the setting has ever had, onto today's
// `dotRotation`, in ONE pure step. Exported and reused by store/userDefaults (whose Save Defaults
// snapshot is a full SettingsValues of its own, which this store's migration can never reach), so
// the two stores cannot disagree about what the rewrite does; tested directly, like progress.ts's
// `migrateAoxBestKeys`.
//   • Both legacy fields are ALWAYS dropped: nothing reads them, and PERSISTED_KEYS (derived from
//     SETTINGS_DEFAULTS) would never re-persist them anyway.
//   • A valid `dotRotation` already present WINS over any legacy field — a payload this build
//     wrote and an older build then re-saved while keeping the unknown field (store/userDefaults'
//     snapshot is persisted whole, so there it survives; see that store's `version` note).
//   • Otherwise a legacy "turned" — `rotateDots: true`, or the original picker's 'rows' — becomes
//     'ccw90', the one turn that existed before 45° did. Anything else becomes NO KEY AT ALL rather
//     than an explicit 'standard': an absent key is exactly what `mergeOverDefaults` (and
//     userDefaults' `effectiveSettingsDefaults`) turn into the factory value, so writing one would
//     only be a second statement of the default.
//   • ⚠ AN UNRECOGNISED `dotRotation` IS DROPPED too, and that is this build being the OLDER build
//     for once: a future build that adds a fourth rotation will bump `version`, and the migration
//     runs on ANY version mismatch — newer included — and screens every value on its way to the
//     store besides (SETTINGS_DOC), so this is what turns a value this build cannot draw into the
//     factory Standard instead of an undefined lookup in DOT_CELLS.
export function migrateDotRotation(
  state: Partial<SettingsValues> & LegacyDotFields,
): Partial<SettingsValues> {
  const { dotOrientation, rotateDots, dotRotation, ...rest } = state
  if (isDotRotation(dotRotation)) return { ...rest, dotRotation }
  return rotateDots === true || dotOrientation === 'rows' ? { ...rest, dotRotation: 'ccw90' } : rest
}

// Through the windows-in-sync door, one slice per setting (store/presets' presetFieldsSpec): another
// window's change to one setting comes in as that setting alone (design 6.2).
// v2 = `dotOrientation` LEFT the shape for the boolean `rotateDots` (round 20).
// v3 = `defaultMode` JOINED the shape (round 21). It needs no rewrite: an absent key on an older
// payload is exactly what `mergeOverDefaults` turns into the factory 'classic', which is the behaviour
// before `defaultMode` existed.
// v4 = `rotateDots` LEFT the shape for the three-way `dotRotation` (round 23).
// ★ THE MIGRATION IS APPLIED AS A DOC IS READ — every read, a load's and another window's save alike
// — whenever the doc names another version, older OR newer. Deliberately not gated on the number:
// migrateDotRotation is a pure, idempotent rewrite keyed on the SHAPE it finds, and it also screens a
// newer build's unknown rotation back to the factory, which a `version < 4` gate would skip (see its
// header). A load writes nothing for it: the doc is saved in this shape with the next change. And it
// is the SCREEN of every value on its way to the store too, so a rotation this build cannot draw that
// reaches it by another road (another window putting the newest value back) is never shown.
// ★ THE AMNESIC VALUE IS A FIELD OF THIS DOC (design 9.1): the last value chosen stays across a real close
// and reopen, and another window's change reaches this one like any setting's (9.2). While the doc has
// no value for it - a preset this build has not saved settings for yet - it is the preset's SAVED
// DEFAULT (store/userDefaults), and a load writes nothing for it. Older builds never write the field
// and every one drops it on its own save (9.2): to the merge an absent field is that build's stale
// copy, and the newest value stands (store/syncCounts).
// A value this build does not know reads as Full: every doubt resolves toward not recording
// (store/amnesicMode).
const screenSettings = (state: Record<string, unknown>) => {
  const out = migrateDotRotation(state as Partial<SettingsValues> & LegacyDotFields) as Record<
    string,
    unknown
  >
  if ('amnesic' in out && !isAmnesicMode(out.amnesic)) out.amnesic = 'full'
  return out
}
export const SETTINGS_DOC = {
  ...presetFieldsSpec({
    kind: 'settings',
    base: PRESET_STORE_KEYS.settings,
    version: 4,
    defaults: SETTINGS_DEFAULTS,
    perPreset: { amnesic: (presetId) => storedAmnesicDefault(presetId) },
    retired: ['dotOrientation', 'rotateDots'],
    migrate: (docState) =>
      migrateDotRotation(docState as Partial<SettingsValues> & LegacyDotFields),
    screen: screenSettings,
  }),
  // ★ ANOTHER WINDOW'S CHANGE OF THE AMNESIC VALUE DOES HERE WHAT THE PILL DOES (design 9.2): the value,
  // and then the reaction - store/presetControl's applyAmnesicChange (the session copy discarded, the
  // stores read again, the screens remounted on the copy now in use), registered below by that file,
  // which imports this one. Every other setting is patched in as it is.
  apply(patch: Record<string, unknown>) {
    const from = useSettings.getState().amnesic
    useSettings.setState(patch as Partial<SettingsState>)
    const to = useSettings.getState().amnesic
    if (to !== from) amnesicReaction?.(from, to)
  },
}
const SETTINGS_DOOR = presetDoc<Partial<SettingsState>>(SETTINGS_DOC)

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      amnesic: 'off',
      setRandomFormat: (v) => set((s) => ({ randomFormat: resolve(v, s.randomFormat) })),
      setDateFormat: (v) => set((s) => ({ dateFormat: resolve(v, s.dateFormat) })),
      setInputStyle: (v) => set((s) => ({ inputStyle: resolve(v, s.inputStyle) })),
      setDotRotation: (v) => set((s) => ({ dotRotation: resolve(v, s.dotRotation) })),
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
      // personal defaults (store/userDefaults) when a snapshot exists, factory only when none
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
      // the PAYLOAD is only as complete as the older build's own `partialize`. For Rotate Dots, in
      // both directions:
      //   • AN OLDER BUILD WRITES, THIS ONE READS: its payload carries `rotateDots` (or, older
      //     still, `dotOrientation`) under its OWN older `version`, so this build's migration
      //     (SETTINGS_DOC) reads it in today's shape — at a load, and at once from that tab's save —
      //     and a turned layout comes back as 90° — the only turn those builds knew. A build from before the setting existed writes neither field, and
      //     that boot reads the factory Standard.
      //   • THIS BUILD WRITES, AN OLDER ONE READS (`dotRotation`, version 4): the older build finds
      //     no `rotateDots` and draws its factory UPRIGHT layout — FAIL-SAFE, never a wrong turn and
      //     never a crash, because it ignores the unknown field outright. But zustand runs that
      //     build's `migrate` on the version mismatch and then RE-SAVES at once through its own
      //     `partialize`, which drops `dotRotation`. A choice made since the windows-in-sync update
      //     is in the doc's sync key, and a field an older build dropped is read as that build's
      //     stale copy — the choice stands (store/syncCounts); one made before it reads back as
      //     Standard after an older build has merely OPENED. Bounded (one setting reverts; nothing
      //     is mis-attributed, no stats are involved) and reachable only from a pre-round-23 tab
      //     still open on the same origin. A legacy `rotateDots` mirror written beside `dotRotation`
      //     would soften it for 90° alone, and would be a shim kept forever for a window that closes
      //     the moment both sites update — so there is none.
      // It is the price of one key serving more than one build in flight, argued in full in
      // store/presets' header.
      name: PRESET_STORE_KEYS.settings,
      // …and this is what makes presets 2, 3, 4… land somewhere else. The `name` above never
      // changes; the storage finds the ACTIVE preset's key at each read and each write.
      // See store/presets for why that beat swapping the name on every switch.
      storage: SETTINGS_DOOR,
      // (its shape history and its migration are at SETTINGS_DOC above: the door reads every doc
      // in today's shape, so the persisted state the store is handed is always this version's)
      version: 4,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<SettingsState>,
      // Hydration REPLACES the settings; it does not patch the saved copy over whatever is in
      // memory. Identical to zustand's default merge at a cold start (where memory already holds
      // SETTINGS_DEFAULTS); the difference shows on a preset switch, where the default would let a
      // preset that has never saved a given setting inherit the last preset's value — including the
      // theme, which would be visible on screen. Argued in full at mergeOverDefaults.
      // (the Amnesic value with them: a preset with no saved settings is on its own saved default, never
      // on the value of the preset just left)
      merge: mergeOverDefaults(() => ({
        ...SETTINGS_DEFAULTS,
        amnesic: storedAmnesicDefault(usePresets.getState().activeId),
      })),
      onRehydrateStorage: reportedHydration('settingsRehydrate'),
    },
  ),
)
SETTINGS_DOOR.attach(useSettings)

// ── THE AMNESIC VALUE OF ANY PRESET ──────────────────────────────────────────────────────────────

let amnesicReaction: ((from: AmnesicMode, to: AmnesicMode) => void) | null = null
/** What another window's change of the active preset's Amnesic value sets off here (presetControl). */
export const onAmnesicAdopt = (fn: (from: AmnesicMode, to: AmnesicMode) => void): void => {
  amnesicReaction = fn
}

/**
 * ★ THE SAVED AMNESIC DEFAULT OF ANY PRESET, read straight off ITS namespaced userDefaults key rather
 * than through the live store (which is only ever the active preset's): what a preset's Amnesic value
 * is while its settings doc holds none (design 9.1). An absent, unreadable or malformed payload is
 * "nothing saved": Off. (store/userDefaults' effectiveAmnesicDefault is the same reading of the live
 * snapshot; both go through store/amnesicMode's readAmnesicMode, the one reader of a stored value.)
 * ⚠ A FUNCTION DECLARATION, hoisted: the store above reads it while it is being created (its hydration's
 * merge, and the doc's default for a preset with no value of its own), before this line is reached.
 */
export function storedAmnesicDefault(presetId: number): AmnesicMode {
  try {
    const raw = readItem(window.localStorage, presetKey(PRESET_STORE_KEYS.userDefaults, presetId))
    if (raw === null) return 'off'
    const envelope: unknown = JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    return readAmnesicMode(
      state && typeof state === 'object' ? ((state as { saved?: unknown }).saved ?? null) : null,
    )
  } catch {
    return 'off'
  }
}

/**
 * One preset's Amnesic value: the active preset's is the store's; any other's is read off its own
 * settings doc (storedAmnesicOf).
 */
export const amnesicOf = (presetId: number): AmnesicMode =>
  presetId === usePresets.getState().activeId
    ? useSettings.getState().amnesic
    : storedAmnesicOf(presetId)

/** A preset's Amnesic value as its own settings doc holds it (through store/storageHealth, so a save the
 *  device refused still counts) - its saved default while that doc holds none. */
export const storedAmnesicOf = (presetId: number): AmnesicMode => {
  try {
    const raw = readItem(window.localStorage, presetKey(PRESET_STORE_KEYS.settings, presetId))
    const envelope: unknown = raw === null ? null : JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    const v =
      state && typeof state === 'object' ? (state as { amnesic?: unknown }).amnesic : undefined
    if (v === undefined) return storedAmnesicDefault(presetId)
    return isAmnesicMode(v) ? v : 'full'
  } catch {
    return storedAmnesicDefault(presetId)
  }
}

/**
 * Write one preset's Amnesic value - the active preset's through the store, any other's into its own
 * settings doc (the door's saveFor: a local change of that doc, synced).
 * ⚠⚠ NOT FOR APP CODE. The value decides which copy of a preset's saved progress is read, so changing
 * it under mounted screens is the 500-cards-becomes-4 bug. Its callers are store/presetControl's
 * setPresetAmnesic, which pairs it with the work the change implies, and the hand-over below.
 */
export function writePresetAmnesic(presetId: number, mode: AmnesicMode): void {
  if (presetId === usePresets.getState().activeId) useSettings.setState({ amnesic: mode })
  else {
    SETTINGS_DOOR.saveFor(presetKey(PRESET_STORE_KEYS.settings, presetId), { amnesic: mode })
    refreshPresetAmnesics()
  }
}

/**
 * Write the active preset's Amnesic value into its settings doc where the doc holds none. A value the
 * doc does not hold IS the preset's saved default (above), so before Save Defaults or Clear Saved
 * Defaults moves that default (store/userDefaults), the value in force is written down: changing a
 * default never changes the value a preset is on, here or in another window of it.
 */
export function pinAmnesic(): void {
  const presetId = usePresets.getState().activeId
  const key = presetKey(PRESET_STORE_KEYS.settings, presetId)
  try {
    const raw = readItem(window.localStorage, key)
    const envelope: unknown = raw === null ? null : JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    if (state && typeof state === 'object' && 'amnesic' in state) return
  } catch {
    /* unreadable: written down below, as for a doc that holds none */
  }
  SETTINGS_DOOR.saveFor(key, { amnesic: useSettings.getState().amnesic })
}

// ★ EVERY LISTED PRESET'S VALUE AS ITS OWN DOC SAYS, held where a list of presets can subscribe to it
// (store/amnesic's useAmnesicModeOf; the active preset's value is the store's). Read again whenever one
// may have moved: a value written here for a preset this page is not on, the preset list or the active
// preset changing, and another window's save of a preset's settings or saved defaults (store/amnesic
// hears the browser's notice - the windows-in-sync door handles the active preset's docs alone).
const readPresetAmnesics = (): Readonly<Record<number, AmnesicMode>> =>
  Object.fromEntries(usePresets.getState().presets.map((p) => [p.id, storedAmnesicOf(p.id)]))
export const usePresetAmnesics = create<{ modes: Readonly<Record<number, AmnesicMode>> }>()(() => ({
  modes: readPresetAmnesics(),
}))
export const refreshPresetAmnesics = (): void => {
  const modes = readPresetAmnesics()
  const now = usePresetAmnesics.getState().modes
  const ids = new Set([...Object.keys(now), ...Object.keys(modes)])
  if ([...ids].some((id) => now[+id] !== modes[+id])) usePresetAmnesics.setState({ modes })
}
usePresets.subscribe(refreshPresetAmnesics)

// ★ THE ONE HAND-OVER (design 9.5). v2.28.0 to v2.29.x held each preset's Amnesic value for the browsing
// session, in sessionStorage (`cg-amnesic-v1`: preset id -> value). A guest playing in such a tab when it
// updates itself reloads into this build in the same session, that record still there: at this FIRST
// load only, a value in it that differs from the preset's own is written as that preset's setting - a
// local change, synced - and the record is removed, so the guest stays a guest. Run as this module loads,
// before any store reads the saved progress (they read the value this writes). Besides the Julian-on
// range's pin (store/julianRange), the only write a load makes.
// (A value the record holds that this build does not know reads as Full: store/amnesicMode.)
const HANDED_OVER_KEY = 'cg-amnesic-v1'
export function handOverSessionAmnesic(): void {
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(HANDED_OVER_KEY)
  } catch {
    return // (no session storage: no older tab's session to hand over)
  }
  if (raw === null) return
  let record: unknown = null
  try {
    record = JSON.parse(raw)
  } catch {
    /* not a record: nothing to hand over */
  }
  if (record && typeof record === 'object' && !Array.isArray(record))
    for (const [id, value] of Object.entries(record)) {
      const presetId = Number(id)
      if (!Number.isInteger(presetId) || !presetListed(presetId)) continue
      const mode: AmnesicMode = isAmnesicMode(value) ? value : 'full'
      if (mode !== amnesicOf(presetId)) writePresetAmnesic(presetId, mode)
    }
  try {
    removeItem(window.sessionStorage, HANDED_OVER_KEY)
  } catch {
    /* refused: it is read again at the next load, and finds nothing different */
  }
}
handOverSessionAmnesic()

// ★ THE defaultMode OF ANY PRESET, read straight off ITS namespaced settings key rather than
// through the live store (which is only ever the ACTIVE preset's — persist scopes it via
// store/presets' presetDoc). The mirror of storedAmnesicDefault below, and
// it exists for the same reason: on a mid-session preset switch, store/presetControl's switchPreset
// writes the registry (firing main.tsx's remount subscription) BEFORE it rehydrates the four
// per-preset stores, so at the instant the subscription reads the incoming preset's opening page
// the live useSettings still holds the OUTGOING preset's values. This reads the incoming preset's
// own payload instead (through store/storageHealth, so a save the device refused still counts).
// main.tsx's cold-open effect uses it too, for one code path.
//
// Reads the persist envelope directly — the same `{ state: {...} }` shape store/presets'
// readStoredRegistry and storedAmnesicDefault below parse. Only `state.defaultMode`
// is consulted, which no migration step touches, so none is reproduced here. An absent, unreadable,
// malformed or out-of-range value is treated as the factory 'classic' — the behaviour before `defaultMode` existed, and
// the correct landing for a payload that cannot be trusted to say where it wanted to open.
// ⚠ The ACTIVE preset's key is the un-namespaced base key (presetKey's identity), so this one path
// covers it too — no special case.
export const readStoredDefaultMode = (presetId: number): DefaultMode => {
  try {
    const raw = readItem(window.localStorage, presetKey(PRESET_STORE_KEYS.settings, presetId))
    if (raw === null) return 'classic'
    const envelope: unknown = JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    const v =
      state && typeof state === 'object' ? (state as { defaultMode?: unknown }).defaultMode : null
    return isPageId(v) ? v : 'classic'
  } catch {
    return 'classic'
  }
}
