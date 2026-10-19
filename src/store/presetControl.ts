import {
  usePresets,
  presetKey,
  normalizePresetName,
  applyRegistryIfRoom,
  copyName,
  defaultPresetName,
  readStoredRegistry,
  normalizeRegistry,
  onRegistryAdopt,
  syncRegistry,
  PRESET_STORE_KEYS,
  FIRST_PRESET_ID,
  presetIdOfSuffix,
} from './presets.js'
import type { Preset, PresetRegistryValues } from './presets.js'
import { discardSessionStats, readSessionStats, dataIdOf, bestsIdOf } from './amnesic.js'
import { amnesicModeOf } from './amnesic.js'
import type { AmnesicMode } from './amnesicMode.js'
import {
  isHolding,
  readItem,
  removeItem,
  storageSpaceFreed,
  tryWriteItem,
} from './storageHealth.js'
import { removeProgressCopy, hasTimesKeys, sweepAbandonedTimes } from './progressStorage.js'
import { syncKeysOf, docKeyOfSyncKey } from './syncedDoc.js'
import { recordSessionPreset } from './sessionPreset.js'
import { discardSessionMode } from './sessionMode.js'
import { discardSessionDedType } from './sessionDedType.js'
import { discardSessionRounds, discardSessionRoundsOf, hasSessionRound } from './sessionRound.js'
import {
  discardSessionHistories,
  discardSessionHistoriesOf,
  hasSessionHistory,
} from './sessionHistory.js'
import {
  useSettings,
  SETTINGS_DEFAULTS,
  SETTINGS_DOC,
  writePresetAmnesic,
  onAmnesicAdopt,
} from './settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from './modePrefs.js'
import { useProgress, makeProgressDefaults, migrateProgress } from './progress.js'
import { progressStateUnmarked } from './progressDoc.js'
import { useUserDefaults, makeUserDefaultsDefaults, USER_DEFAULTS_DOC } from './userDefaults.js'
import { useJulianRange, JULIAN_RANGE_DEFAULTS } from './julianRange.js'
import { sameJson } from './json.js'

// store/presetControl.ts — the things you can DO to the set of presets, and the only place allowed
// to do them.
//
// WHY THIS IS NOT IN store/presets.ts. The registry file holds a saved value and the storage layer
// that reads it; this file holds the operations, because three of them (switching, deleting,
// and changing a preset's Amnesic value) are not edits to one saved value at all — they are an edit
// PLUS four store rehydrations, and both halves are load-bearing. Splitting them apart is what makes "did
// only the first half" impossible to write by accident. It is also what keeps the dependency graph one-way: presets.ts knows nothing
// about the four data stores, this file imports all of them, and nothing imports this file back.
//
// ⚠ THERE IS A THIRD PART, AND IT IS DELIBERATELY NOT HERE: remounting the five always-mounted
// mode screens. It cannot live in a store file — it is React state in src/main.tsx — and it is not an
// argument to these functions either. main.tsx SUBSCRIBES to the registry and to the session's
// Amnesic values, and remounts whenever store/amnesic's `activeDataId` changes — "which preset, and
// which copy of its stats" — so every path into that hazard is covered by construction rather than
// by a caller remembering. It is NOT `activeId`: repointing the preset you are already on at
// sessionStorage is the same hazard without activeId moving at all. The full argument, including
// the required-parameter design this replaced and why the subscription must not be an effect, is at
// switchPreset below.
//
// ⚠ THIS FILE IS THE PROGRAMMATIC API THE UI GROUP DRIVES. There is deliberately no UI, no top bar
// and no settings-panel wiring here — `switchPreset(id)` is the whole call a CustomSelect needs.
//
// ★ AND ONE QUESTION, NOT A SEVENTH OPERATION: `isPresetFactory(id, …)` (round 22) asks whether a
// preset holds anything a player could miss, so the delete flow can skip its confirmation for one
// that holds nothing. It reads the same four stores and the same key machinery the operations
// write through — which is precisely why it belongs here and not in the component that asks it: an
// answer derived from a second, parallel idea of what a preset IS could disagree with what
// deletePreset actually removes, and the direction that disagreement destroys data is the one a
// component could not see.

// ⚠⚠ THE TWO WAYS A STORE CAN BE POINTED AT A NEW PRESET, and BOTH are needed — see
// reloadPresetStores below, where the second one's absence was a silent isolation failure. A store
// that has storage REHYDRATES; a store that has none is set to the factory values a hydration from
// an absent payload would have produced. The defaults are the SAME factories each store hands its
// own `merge`, imported rather than re-typed, so the two answers to "what does a preset with no
// saved copy hold" cannot drift apart.
type PresetStore<T> = {
  // Optional BY NECESSITY rather than by taste: zustand's type says `persist` is always there, and
  // in a browser that refuses localStorage it is genuinely undefined (argued below).
  persist?: {
    rehydrate: () => void | Promise<void>
    // The store's own saved-shape version and its own `migrate` — read back from the store rather
    // than imported, so judging an old payload (isPresetFactory) runs the ONE migration there is.
    getOptions: () => {
      version?: number
      migrate?: (state: unknown, version: number) => unknown
      partialize?: (state: T) => unknown
    }
  }
  getState: () => T
  setState: (partial: Partial<T>) => void
}

// ── EVERY PART OF A PRESET, AND WHAT DUPLICATE PRESET DOES WITH IT ─────────────────────────
//
// ★ THE ONE PLACE THAT SAYS WHAT A COPY OF A PRESET HOLDS (duplicatePreset, below). A preset is
// more than its four stores: the browsing session keeps per-preset state of its own. Every part is
// named here with ONE answer — copied, or left behind and why — and the `satisfies` below makes the
// list complete BY CONSTRUCTION for the stores: a per-preset store added to store/presets'
// PRESET_STORE_KEYS does not compile until it has an answer here. tests/presetDuplicate.dom holds
// the rest: it fills a preset's every part, finds every storage key that belongs to it, and fails
// on any key no part here owns — so a new kind of per-preset key (a store's own sync record, say)
// cannot slip past a duplicate unanswered either.
// THE OWNER'S RULE (Round 26, Q5): a copy carries all the settings, the saved defaults, the
// per-mode choices, and the Amnesic value — NOT the stats, the Bests, or the times. A copy is a
// fresh thing to track, and copying times would double what the device holds. (Lookup history is
// in no preset, so it is in no copy either: it is shared already.)
type DuplicateRule = { copied: true } | { copied: false; because: string }
const COPIED: DuplicateRule = { copied: true }
const leftBehind = (because: string): DuplicateRule => ({ copied: false, because })
// The browsing session's per-preset parts (sessionStorage), beside the stores' four.
type SessionPart =
  | 'sessionStats'
  | 'sessionPage'
  | 'sessionDedType'
  | 'sessionRounds'
  | 'sessionHistories'
export const DUPLICATE_RULES = {
  // ── the per-preset stores (store/presets' PRESET_STORE_KEYS) ──
  // Every ⚙ setting of the Per-preset half, Default Mode and the theme among them.
  settings: COPIED,
  // The per-mode setup on each mode's own screen: Deduction's sub-type, the Blitz mode a preset
  // opens in (Per Round / Per Question) and its timers, the MoX run length, Flash's speed, the
  // stat toggles.
  modePrefs: COPIED,
  // Stats, all-time Bests, and solve times (and the sealed chunks of times that go with them).
  progress: leftBehind('stats, Bests, and times: a copy is a fresh thing to track'),
  // The saved personal defaults, the saved Amnesic default among them.
  userDefaults: COPIED,
  // The Year Range used while the Julian Calendar setting is on (store/julianRange) — a ⚙ setting,
  // in a key of its own only so that no older build can drop it.
  julianRange: COPIED,
  // (The Amnesic value is a field of the settings - copied with them; the copy is on the same value,
  // with nothing in its session yet, as any change of the value starts.)
  // ── the browsing session's per-preset parts ──
  // An amnesic preset's session stats (store/amnesic's session copy of the progress store).
  sessionStats: leftBehind('stats: the session copy of what `progress` is'),
  // The page the preset was last showing this session (store/sessionMode): a place the player was,
  // not a choice — the copy opens on its Default Mode, which is copied.
  sessionPage: leftBehind('where the original was this session, not a setting'),
  // The Deduction sub-type this window is on for it (store/sessionDedType): also a place, not a choice -
  // the copy starts from the original's shared sub-type, which is copied with the per-mode setup.
  sessionDedType: leftBehind('the sub-type the original is on in this window, not a setting'),
  // An ended Blitz round or MoX run waiting on screen (store/sessionRound).
  sessionRounds: leftBehind('a result, which belongs to the run that set it'),
  // Parked casual play — a history, an answered question (store/sessionHistory).
  sessionHistories: leftBehind('play, not a setting'),
} satisfies Record<keyof typeof PRESET_STORE_KEYS | SessionPart, DuplicateRule>

// ★ ONE ENTRY PER PER-PRESET STORE, HOLDING EVERY FACT THIS FILE NEEDS ABOUT IT — where its saved
// copy lives, how to point it at a different preset, what it holds when it has no saved copy, what
// it is holding right now (and would save), how to read a saved copy an older build wrote, and
// whether a duplicate carries it. THREE WALKERS read this list (reloadPresetStores just below,
// isPresetFactory, and duplicatePreset further down), and they read the SAME list on purpose: a
// fifth per-preset store added later is reloaded, judged, AND copied or not by the act of being
// listed here, where parallel lists would let it become reloadable but un-checkable — a preset
// holding real data that the delete flow would then destroy without asking.
// ⚠ `makeDefaults` and `readLive` are ERASED to plain records. isPresetFactory compares JSON values
// and has no use for any store's own type; keeping the generic only as far as this factory function
// is what lets four differently-typed stores sit in one array without a cast at each of them.
const presetStore = <T extends object>(
  name: keyof typeof PRESET_STORE_KEYS,
  store: PresetStore<T>,
  makeDefaults: () => Partial<T>,
  // The store's migration where it is not persist's own: a store saved through the windows-in-sync
  // door has its doc read in today's shape by the door (its doc spec's `migrate`).
  docMigrate?: (state: Record<string, unknown>, version: number) => Record<string, unknown>,
  // …and what a saved copy holds that is not one of its values, taken off: the door's tags and write
  // marks inside the progress doc (store/progressDoc), and the settings' Amnesic value - a statement
  // about where stats WOULD go, which isPresetFactory does not consult (the owner's call, there).
  unmarked: (state: Record<string, unknown>) => Record<string, unknown> = (state) => state,
) => ({
  key: PRESET_STORE_KEYS[name],
  // What Duplicate Preset does with this store (DUPLICATE_RULES, above).
  duplicate: DUPLICATE_RULES[name],
  reload: () => {
    if (store.persist) store.persist.rehydrate()
    else store.setState(makeDefaults())
  },
  makeDefaults: () => makeDefaults() as Record<string, unknown>,
  readLive: () => store.getState() as Record<string, unknown>,
  // ★ WHAT THIS STORE WOULD SAVE RIGHT NOW, as the text it saves it in — its own `partialize`, under
  // its own version stamp: the copy duplicatePreset writes for the preset you are ON, which is
  // what is on its screens rather than what was last saved. null where the store has no storage.
  savedText: (): string | null => {
    const options = store.persist?.getOptions()
    if (!options?.partialize) return null
    return JSON.stringify({ state: options.partialize(store.getState()), version: options.version })
  },
  // ★ A SAVED COPY, IN TODAY'S SHAPE — what this preset would actually open holding. A store's
  // migration runs on a saved copy whose version differs, and only for the preset being OPENED;
  // every other preset's keys stay in whatever shape the build that last saved them wrote. So a
  // saved copy from an OLDER version is passed through that same migration here, the store's own.
  // ⚠ null MEANS "THIS BUILD CANNOT VOUCH FOR IT", and isPresetFactory reads null as "ask": a copy
  // with no version, one from a NEWER build (its `migrate` would also run on that, but only to
  // squeeze a shape this build has never seen into one it can draw — which can drop a choice the
  // player really made), a migration that hands back a promise, or anything that is not an object.
  upgradeSaved: (state: unknown, version: unknown): Record<string, unknown> | null => {
    if (!state || typeof state !== 'object' || typeof version !== 'number') return null
    const options = store.persist?.getOptions()
    const current = options?.version ?? 0
    if (version > current) return null
    const migrate = docMigrate ?? options?.migrate
    const upgraded =
      version < current && migrate ? migrate(state as Record<string, unknown>, version) : state
    if (!upgraded || typeof upgraded !== 'object' || upgraded instanceof Promise) return null
    return unmarked(upgraded as Record<string, unknown>)
  },
})

// ★ ORDERED, AND THE ORDER IS A REQUIREMENT, NOT A LIST. store/progress' `migrate` reads
// `useSettings.getState().julianChance` to complete a pre-v2 AoX best's key. So settings must
// rehydrate BEFORE progress, or a preset whose saved progress is old enough to need that migration
// would be re-keyed under the preset you just LEFT — a best that then belongs to no configuration
// the player can reach. `Object.values(...)` over a record would have gotten this right by luck
// and lost it the first time someone reordered the record.
// Named on its own because its saved copy can sit in TWO storage areas (an Amnesic preset's session
// stats are a second payload of this same store — isPresetFactory reads both).
const PROGRESS_STORE = presetStore(
  'progress',
  useProgress,
  makeProgressDefaults,
  migrateProgress,
  progressStateUnmarked,
)
// ★ …AND THE JULIAN-ON YEAR RANGE COMES STRAIGHT AFTER THE SETTINGS, for the same kind of reason: a
// preset that has no pair yet derives one from the Julian-off pair the settings store has just
// loaded (store/julianRange). Its factory value is the pair a factory preset derives, 1-11582 — which
// is also what the no-storage branch below sets, since there every preset's settings are factory.
const PER_PRESET_STORES = [
  presetStore(
    'settings',
    useSettings,
    () => ({ ...SETTINGS_DEFAULTS }),
    SETTINGS_DOC.migrate,
    ({ amnesic: _amnesic, ...values }) => values,
  ),
  presetStore('julianRange', useJulianRange, () => ({ ...JULIAN_RANGE_DEFAULTS })),
  presetStore('modePrefs', useModePrefs, () => ({ ...MODE_PREFS_DEFAULTS })),
  PROGRESS_STORE,
  presetStore('userDefaults', useUserDefaults, makeUserDefaultsDefaults, USER_DEFAULTS_DOC.migrate),
]

// Reload all five from the active preset's keys, in one synchronous turn.
//
// ⚠⚠ THE NO-STORAGE BRANCH IS NOT DEFENSIVE NOISE, AND IT MUST NOT GO BACK TO BEING A SKIP.
// Zustand attaches `api.persist` only when a storage EXISTS; in a browser that refuses localStorage
// (iOS's "Block All Cookies", or any private mode that throws on the property access) the
// middleware returns before that assignment, so `store.persist` is genuinely undefined for all four
// stores at once. The first version of this line was `store.persist?.rehydrate()` and reasoned that
// "there is nothing to reload anyway". That was wrong, and the failure it left was not a crash but
// a LIE: the registry write still fires the screen remount, so the app opened "preset 2" wearing
// preset 1's score and preset 1's theme, and then accumulated every answer of the session onto
// preset 1's numbers — in both directions, all session, presenting one preset's data as another's.
// Nothing reaches disk in that browser, so nothing is permanently lost; what is broken is the one
// promise a preset makes.
// ★ SO A STORE WITH NO STORAGE IS RESET TO ITS FACTORY VALUES, which is not an approximation of a
// rehydrate — it is exactly what one does here. store/presets' mergeOverDefaults turns "no saved
// copy" into the factory values, and a memory-only browser has no saved copy for ANY preset, this
// one included. (`setState` with a partial merges, so each store keeps its own actions.)
// ⚠ Rehydration writes NOTHING — with ONE deliberate exception. Zustand's hydrate() lands the loaded
// state through the RAW `set`, not the persist-wrapped one, so reloading a preset that has never been
// saved does not create its keys, and reloading one that has does not rewrite them. The exception is
// store/julianRange: a preset with no Julian-on pair yet has one derived and PINNED — its key written
// once, a new key and nothing existing rewritten — so that nothing an older build later does to the
// Julian-off pair can move it (that store's header argues it). The defaults branch writes nothing
// either — there is no storage for it to write to.
const reloadPresetStores = () => {
  for (const { reload } of PER_PRESET_STORES) reload()
}

// Remove one preset's saved copy — its five keys, the windows-in-sync keys beside each (design-q1-q2.md
// v4, 8.4: a doc's sync key, and the progress doc's records' key), and nothing else. Derived from the key record
// rather than by scanning localStorage for a pattern, so it cannot sweep up a neighbour, and so a
// fifth per-preset store becomes deletable by the act of being listed there. (The progress key goes
// through store/progressStorage's removeProgressCopy instead of the loop: its sealed chunks of solve
// times are part of that key's copy and go with it, and that function lists exactly this preset's.)
// Swallows a refusing localStorage: there is nothing to delete in a browser that has stored nothing.
// Through store/storageHealth's removeItem, so a save the device REFUSED for one of these keys is
// forgotten with the key — a deleted preset must not be written back out when room appears.
const clearPresetStorage = (presetId: number) => {
  try {
    for (const baseKey of Object.values(PRESET_STORE_KEYS)) {
      const docKey = presetKey(baseKey, presetId)
      if (baseKey !== PRESET_STORE_KEYS.progress) removeItem(window.localStorage, docKey)
      for (const key of syncKeysOf(docKey)) removeItem(window.localStorage, key)
    }
    removeProgressCopy({ area: window.localStorage, presetId })
  } catch {
    /* storage refused — nothing was ever written, so nothing is left behind */
  }
  forgetPresetSession(presetId)
  // Deleting a preset is the likeliest way a player makes room after the storage-full notice, and
  // this is the moment the room appears — so anything a full device refused is re-saved now, not at
  // the player's next change (store/storageHealth).
  storageSpaceFreed()
}

// What a preset leaves in THIS window's browsing session (sessionStorage) - the half of a delete every
// window does for itself: the one that deletes, and every other window when it hears of the delete
// (adoptRegistry, below). Ids are never reused so a leftover is harmless; "remove exactly its keys" is
// the house rule.
function forgetPresetSession(presetId: number): void {
  // An amnesic preset's session copy lives in sessionStorage under the same key, and "remove exactly
  // its keys and nothing else" has to mean both areas or a deleted preset leaves a session copy
  // behind. Unconditional rather than gated on its Amnesic value (which went with its settings doc).
  discardSessionStats(presetId)
  // …and the THIRD place a preset can have written this session: its current-page entry
  // (round 21), in sessionStorage keyed by this id. Ids are never reused so a leftover entry is
  // harmless, but "remove exactly its keys" is the house rule.
  discardSessionMode(presetId)
  // …and its Deduction sub-type in this window (store/sessionDedType), by the same rule.
  discardSessionDedType(presetId)
  // …and the FOURTH: its parked ended round/run (store/sessionRound), one sessionStorage entry per (bests
  // copy, mode) for this id. discardSessionRounds clears both copies' modes in one call — same house
  // rule, same "harmless leftover but remove it anyway" reasoning as the page entry above.
  discardSessionRounds(presetId)
  // …and the FIFTH: its casual modes' parked histories (store/sessionHistory), one sessionStorage
  // entry per (stats copy, silo). When the preset being deleted was the ACTIVE one, the registry
  // write just before this parked its screens on the way out (src/main.tsx's subscription) — so this
  // line is what has the last word: a deleted preset leaves no history behind.
  discardSessionHistories(presetId)
}

/**
 * ANOTHER WINDOW CHANGED THE PRESET LIST (design-q1-q2.md v4, 8.3) — the windows-in-sync door hands
 * every such change here (store/presets' registry door). Renames, moves, new presets, and the "Open in"
 * pin simply show; nothing remounts. A preset deleted there that this window is NOT on leaves this
 * window's session too. The preset this window IS on, deleted there: this window moves to its
 * neighbour - the one after it, or the one before when it was last - exactly as a delete made here
 * moves it (the registry write schedules the remount, src/main.tsx's subscription; then the stores
 * reload). ★ ONLY THIS WINDOW'S OWN SESSION IS TOUCHED: the deleted preset's permanent keys were the
 * deleting window's to remove, and a window never removes saved data on the strength of a list it read.
 */
export function adoptRegistry(patch: Partial<PresetRegistryValues>): void {
  const reg = usePresets.getState()
  const presets = patch.presets ?? reg.presets
  const listed = new Set(presets.map((p) => p.id))
  for (const p of reg.presets)
    if (!listed.has(p.id) && p.id !== reg.activeId) forgetPresetSession(p.id)
  let activeId = reg.activeId
  const moved = !listed.has(activeId)
  if (moved) {
    const at = reg.presets.findIndex((p) => p.id === activeId)
    activeId = (
      reg.presets.slice(at + 1).find((p) => listed.has(p.id)) ??
      reg.presets
        .slice(0, Math.max(0, at))
        .reverse()
        .find((p) => listed.has(p.id)) ??
      presets[0]
    ).id
  }
  usePresets.getState().applyRegistry(
    normalizeRegistry({
      presets,
      activeId,
      nextId: patch.nextId ?? reg.nextId,
      openInPreset: patch.openInPreset ?? reg.openInPreset,
    }),
  )
  if (!moved) return
  forgetPresetSession(reg.activeId)
  reloadPresetStores()
}
onRegistryAdopt(adoptRegistry)

// One preset's saved copy of ONE store, as the raw stored text — or null when there is none (never
// written, or a browser that refuses localStorage, which is the same answer: nothing is there).
// The single place this file composes a namespaced key for a READ, so presetStorageInUse and
// isPresetFactory below cannot come to disagree about which key a preset's data is under.
// Read through store/storageHealth: a preset whose newest save the device refused holds that save
// as far as this page is concerned, and "is it factory-fresh?" must not answer from the older copy.
const readPresetPayload = (baseKey: string, presetId: number): string | null => {
  try {
    return readItem(window.localStorage, presetKey(baseKey, presetId))
  } catch {
    return null
  }
}

// Is any of this preset's saved data already on disk? Used only when allocating an id — see
// createPreset, which is where the reason it can ever be true is argued.
// (Sealed chunks of solve times count: an older build's preset delete removes the four keys and
// leaves those, and a new preset must not be handed a namespace that still holds them.)
const presetStorageInUse = (presetId: number): boolean => {
  if (Object.values(PRESET_STORE_KEYS).some((key) => readPresetPayload(key, presetId) !== null))
    return true
  try {
    return hasTimesKeys({ area: window.localStorage, presetId })
  } catch {
    return false
  }
}

// ── IS A PRESET FACTORY-FRESH? ────────────────────────────────────────────────────────────────
//
// ★★ THE QUESTION, IN THE OWNER'S WORDS: "if it's completely factory with no stats or anything,
// like as if you pressed clear saved defaults then full reset, then we don't need a confirmation
// when deleting that preset." So this answers "does this preset hold ANYTHING a player could miss",
// and components/PresetManager's ✕ skips its confirmation when the answer is no.
//
// ⚠⚠ THE ASYMMETRY THAT DECIDES EVERY JUDGEMENT CALL BELOW. A FALSE NEGATIVE — saying "not factory"
// about a preset that is — costs one confirmation nobody needed, and the player presses Delete. A
// FALSE POSITIVE destroys data with no question asked and no way back. So every branch here that
// cannot be certain answers FALSE, and every "should this count as data" call is resolved toward
// asking. The four places that is load-bearing are marked ⚠ where they occur.
//
// ★ WHY IT IS NOT presetStorageInUse ABOVE. "Has any key at all" is very nearly the right question
// — store/presets' mergeOverDefaults turns "no saved copy" into the factory values, so a preset with
// no keys is factory BY CONSTRUCTION — but it is not sufficient, and the gap is routine rather than
// exotic: a store writes its key the first time anything sets a value, and several of those writes
// land back on the factory value (a toggle flipped and flipped back, a mode screen mirroring blank
// stats on mount). Those presets hold KEYS and no DATA. So the test is per store, and it is
// ABSENT **or** EQUAL TO THAT STORE'S OWN DEFAULTS.

// (Compared with store/json's sameJson — deep, and blind to key order: store/progress' defaults NEST
// (five Stats objects, each carrying a `times` array, beside four empty best-records), so `===` would
// call every fresh preset non-factory, and comparing text would make the answer depend on key ORDER.
// A NaN compares false there — the safe direction: a number that cannot be a stored value means
// "ask".)

// Does one SAVED payload hold nothing but that store's factory values?
//
// ★ IT MIRRORS HYDRATION, WHICH IS WHAT MAKES IT THE RIGHT COMPARISON. Opening a preset runs the
// store's `migrate` on a saved copy from an older version and then merges the result over the
// defaults (`{...defaults, ...persisted}`, store/presets' mergeOverDefaults) — so that composition
// IS what this preset would open holding, and comparing it to the defaults asks exactly "would
// opening this preset show anything but a fresh one". An absent key therefore means the factory
// value, for free, with no key list to maintain.
// ★ THE MIGRATION IS THE STORE'S OWN (`upgradeSaved`, in the store table above), never a second
// copy of it written here. It matters because a preset you are not on keeps the shape of the build
// that last saved it: every preset that existed before Rotate Dots became a three-way setting still
// holds `rotateDots: false` in its settings, and compared UNMIGRATED that one leftover key made an
// untouched preset read as "holds something" — so deleting it asked a question it never used to.
// ⚠ AND AN **EXTRA** KEY, AFTER THE MIGRATION, IS STILL A DIVERGENCE. A field no version of the
// store knows (an old `lookupHistory` on a progress payload, which that store's migrate leaves in
// place) survives the spread as a key the defaults do not have, so the counts differ and the answer
// is "not factory" — a FALSE NEGATIVE by construction: whatever this file cannot account for asks
// first. The same goes for a payload `upgradeSaved` will not vouch for (no version, a newer
// build's).
// ⚠ AN UNPARSEABLE OR MIS-SHAPED ENVELOPE IS ALSO "NOT FACTORY". A truncated or tampered payload
// cannot be trusted to say the preset is empty, and store/amnesic's readEnvelope already treats
// the same corruption the same way. A `migrate` that throws lands in the same catch.
const payloadIsFactory = (
  raw: string | null,
  entry: (typeof PER_PRESET_STORES)[number],
): boolean => {
  if (raw === null) return true
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object') return false
    const { state, version } = envelope as { state?: unknown; version?: unknown }
    const saved = entry.upgradeSaved(state, version)
    if (saved === null) return false
    const defaults = entry.makeDefaults()
    return sameJson({ ...defaults, ...saved }, defaults)
  } catch {
    return false
  }
}

// Is one store, RIGHT NOW, holding nothing but its factory values?
// ⚠ IT PICKS THE DEFAULTS' OWN KEYS RATHER THAN SPREADING THE WHOLE STATE, which is the opposite of
// payloadIsFactory above and is the same faithfulness: a live store also holds its ACTIONS, and
// each store's `partialize` strips exactly these keys back out to persist them. So this compares
// what would be SAVED, where that one compares what was.
const liveIsFactory = (entry: (typeof PER_PRESET_STORES)[number]): boolean => {
  const defaults = entry.makeDefaults()
  const live = entry.readLive()
  const saved: Record<string, unknown> = {}
  for (const key of Object.keys(defaults)) saved[key] = live[key]
  return sameJson(saved, defaults)
}

/**
 * Does this preset hold NOTHING a player could miss — every ⚙ setting at its factory value, the
 * per-mode setup at its, no stats or all-time bests, no saved personal defaults, no parked round,
 * and (for the preset you are on) nothing going on its screens? Bit-identical to a preset that has just been created, in other words, which is why
 * components/PresetManager may delete one without asking.
 *
 * ★★ THE TWO SOURCES, AND WHY BOTH ARE READ. A preset you are NOT on exists only in storage — its
 * values are not in any live store, because the live stores are always the ACTIVE preset's (store/
 * presets' presetDoc). The active preset's truth is the live stores. So:
 *   • EVERY preset is judged on its SAVED copy, active or not.
 *   • The ACTIVE preset is judged on the LIVE stores AS WELL, and both must say factory.
 * Reading both rather than branching is not belt-and-braces, it closes a real false positive: in a
 * browser that refuses localStorage (iOS "Block All Cookies") NOTHING is ever written, so the
 * storage half answers "factory" for a preset that has been played in all session — and the live
 * half is the only thing that knows. For a NON-active preset that same browser genuinely holds
 * nothing (store/presetControl's own no-storage branch resets such a store to the factory values),
 * so "absent means factory" is correct there rather than merely safe.
 *
 * ⚠⚠ THE PROGRESS STORE HAS TWO STORAGE AREAS AND BOTH ARE READ, which is the sharpest false
 * positive this function has to close. While a preset is AMNESIC its stats live in sessionStorage
 * and its real, permanent ones are PARKED in localStorage untouched (store/amnesic) — so the live
 * store shows a zeroed session while the device still holds the player's record. Deleting removes
 * BOTH (clearPresetStorage calls discardSessionStats beside the four key removals), so both have to
 * count: the loop reads the parked copy off localStorage, and the session copy is read after it.
 *
 * ⚠ AMNESIC ITSELF IS NOT CONSULTED, and that is the owner's decided call, not an omission: a
 * preset that is otherwise untouched but is on Stats Only or Full still counts as factory, because
 * nothing is lost by deleting it — the value is a statement about where stats WOULD go, and there
 * are none. (It is a field of the settings doc, taken off before the settings are compared: the
 * settings entry's `unmarked`, above.)
 *
 * ⚠ NEITHER IS THE PRESET'S NAME, OR ITS POSITION IN THE LIST, and the owner's own yardstick is
 * what settles it: "as if you pressed clear saved defaults then full reset". Neither of those
 * buttons touches the name or the order, so a preset renamed to "Weekend" and never played in is
 * exactly the state that recipe produces and is factory by his definition. The confirmation this
 * skips says nothing about a name either — it names the stats, the bests, the
 * per-mode setup, the ⚙ settings and the saved defaults — so skipping it cannot withhold a warning
 * that was ever there. (Both are registry fields anyway, so they are outside what this function
 * reads.)
 *
 * ⚠ THE SESSION PAGE IS DELIBERATELY NOT COUNTED, and it is the one entry in clearPresetStorage
 * that this function skips, so the difference is stated rather than left to be noticed.
 * store/sessionMode records which of the seven pages a preset was last showing THIS session — which
 * every visit writes, and which a full app close throws away on its own. Counting it would mean any
 * preset you had so much as looked at could never be deleted without a question, for a value no
 * player can miss. Every other entry in that function IS counted — parked casual play
 * (store/sessionHistory) only for a preset other than the active one, whose screens `screensFresh`
 * below already speaks for (see the note at its check).
 *
 * ★★ `screensFresh` — THE ONE THING NO STORE AND NO KEY HOLDS: WHAT IS ON THE ACTIVE PRESET'S
 * SCREENS RIGHT NOW. A Blitz round or MoX run IN PROGRESS is written nowhere at all (store/
 * sessionRound parks only ENDED ones, and only when sessionStorage will take them), yet deleting the
 * active preset remounts every screen and throws it away — so a check built from storage alone
 * called a preset with a 7-of-10 MoX run on screen "factory" and deleted it, run and all, without
 * the question that exists to warn about exactly that. The answer is src/main.tsx's aggregate of the
 * five mode screens' own freshness reports (each one's `onFreshChange` — config, stats, history, a
 * live or ended round, its UI toggles), the SAME signal Full Reset's dim reads, handed in by the
 * caller because it is React state this file cannot see. It is REQUIRED rather than defaulted: a
 * default of `true` is precisely the false positive above, waiting for a caller that forgot.
 *   • It is consulted for the ACTIVE preset only. The screens only ever hold the active preset —
 *     every other preset is judged, correctly, on what it left in storage.
 *   • It also covers an ended round on screen that could NOT be parked (sessionStorage refused):
 *     `hasSessionRound` below cannot see that one, and the screen's own report can.
 *   • ⚠ It can only add "not factory", never remove it — the same asymmetry as every term above.
 *     A screen reads un-fresh for a few things no player would call data (a Show Codes panel left
 *     open, say), and each of those costs one unneeded question.
 */
export function isPresetFactory(presetId: number, screensFresh: boolean): boolean {
  const isActive = usePresets.getState().activeId === presetId
  if (isActive && !screensFresh) return false
  for (const entry of PER_PRESET_STORES) {
    if (!payloadIsFactory(readPresetPayload(entry.key, presetId), entry)) return false
    if (isActive && !liveIsFactory(entry)) return false
  }
  // …the amnesic session copy of the stats, the second of the progress store's two areas (above).
  if (!payloadIsFactory(readSessionStats(presetId), PROGRESS_STORE)) return false
  // …and a parked ended Blitz round or MoX run (store/sessionRound), which is a RESULT still on
  // screen rather than a stored setting — per-preset data that lives in neither a store nor a
  // namespaced key.
  if (hasSessionRound(presetId)) return false
  // …and, for a preset that is NOT on screen, parked casual PLAY (store/sessionHistory) — a history,
  // an answered question, a screen setting — which comes back the next time that copy's screens
  // mount. (A preset the player only looked at has parked the questions its screens were waiting on
  // and nothing else; that is not play, and hasSessionHistory does not count it.) The active
  // preset's is skipped rather than counted: it is only ever an older copy of what its screens are
  // holding right now, which `screensFresh` above already judged.
  return isActive || !hasSessionHistory(presetId)
}

/** The preset the app is currently reading and writing. */
export const activePreset = (): Preset => {
  const { presets, activeId } = usePresets.getState()
  // normalizeRegistry guarantees activeId names a listed preset on every load; the fallback covers
  // the one case it cannot — a caller reading between an applyRegistry and its own next line.
  return presets.find((p) => p.id === activeId) ?? presets[0]
}

/**
 * Add a preset. It starts from FACTORY DEFAULTS (it has no saved copy, and store/presets'
 * mergeOverDefaults is what makes "no saved copy" mean the factory values rather than a clone of
 * whatever preset was open). Does NOT switch to it — creating and opening are separate acts, so the
 * caller can offer "create" without yanking the player out of the run they are in.
 */
export function createPreset(name?: string): Preset {
  // ★ IDS ARE ALLOCATED FORWARD AND NEVER REUSED (store/presets' normalizeRegistry forces nextId
  // above every listed id, whatever the payload claimed). That is what lets `presetKey` be a pure
  // function of the id: a namespace, once vacated, is never handed to a different preset.
  // ★ THE REGISTRY IS MERGED WITH THE DEVICE FIRST (design 8.5), so an id another window - the live
  // PWA and the staging site are one browser origin - allocated is known here before this one is
  // drawn, even for a preset nobody has opened yet; and the list written afterwards keeps that
  // window's preset (the registry's membership rule). What is left is two windows allocating inside
  // the same instant of the read lag (design R1).
  // ⚠ THE SKIP LOOP STAYS, for keys left on disk by a delete interrupted between the registry write
  // and the removal (allocatePresetId, below, which duplicatePreset shares).
  const id = allocatePresetId()
  const reg = usePresets.getState() // (after the merge: another window's new presets are in it)
  // A new preset is PERMANENT until somebody says otherwise — its Amnesic value is its own saved
  // default, and it has none: Off (store/settings - a preset with no settings doc yet). Inheriting the
  // current preset's value was rejected on sight: creating a preset is not a decision about where its
  // stats are kept, and the one direction of that mistake — a preset that silently forgets — is the one
  // the player would only discover after losing something. (`amnesic: false` here is the older builds'
  // field, store/presets' Preset: the way such a build spells its own new preset.)
  const preset: Preset = {
    id,
    name: normalizePresetName(name ?? defaultPresetName(id), id),
    amnesic: false,
  }
  usePresets.getState().applyRegistry({
    presets: [...reg.presets, preset],
    activeId: reg.activeId,
    nextId: id + 1,
    // applyRegistry REPLACES the whole value, so every field it does not name is dropped — carry
    // the "open in" pin through unchanged (creating a preset is not a decision about which one to
    // open on).
    openInPreset: reg.openInPreset,
  })
  return preset
}

// The next preset id: above every id any window has handed out (the registry merged with the device
// first), and past any id whose namespace still holds keys (createPreset argues each half).
function allocatePresetId(): number {
  syncRegistry()
  let id = Math.max(usePresets.getState().nextId, FIRST_PRESET_ID + 1)
  while (presetStorageInUse(id)) id++
  return id
}

/**
 * Add a copy of a preset (Duplicate Preset, Round 26 Q5) — DIRECTLY AFTER its original in the list,
 * named the original's name and " (2)" (store/presets' copyName: " (#)" counts on, to the next
 * number no preset has). Returns the new preset; 'unknown' when there is no such preset; or
 * 'no-room' when the device cannot save the copy, and then NOTHING has changed anywhere.
 *
 * ★ WHAT IS COPIED IS DUPLICATE_RULES' ANSWER, and nothing here decides it: each store marked
 * copied, and the session's Amnesic value. The copy's own stats, Bests, and times start empty.
 * ★ THE PRESET YOU ARE ON IS COPIED AS IT IS ON SCREEN — each store's live values, as it would save
 * them now (`savedText`) — and any other preset as it is saved, through store/storageHealth's door,
 * so a save the device refused and is holding counts as saved. A saved copy goes across in the
 * shape it was saved in, version stamp and all, so the copy opens holding exactly what its original
 * would: the store's own migration runs on both alike. A store with nothing saved is not written at
 * all, and the copy has its factory values there, as the original does.
 * ★ DOES NOT SWITCH TO IT, like createPreset: making a preset is not a decision to go there.
 * ★ NOTHING HALF-MADE. The copy's stores are written first, each TRIED (tryWriteItem: nothing held,
 * no notice) — they belong to an id no list names yet, so nothing can read them — and the list last,
 * through applyRegistryIfRoom. If any write is refused, every store written for the copy is removed
 * again and the list is untouched: no copy, and the device as it was.
 * ⚠ A BROWSER THAT GIVES THE APP NO STORAGE has nothing to copy from or to: the copy is listed, in
 * memory, and opens on the factory values — which is also what that browser's every other preset
 * opens on (reloadPresetStores' no-storage branch).
 */
export function duplicatePreset(sourceId: number): Preset | 'unknown' | 'no-room' {
  const id = allocatePresetId()
  const reg = usePresets.getState() // (after the merge)
  const index = reg.presets.findIndex((p) => p.id === sourceId)
  if (index < 0) return 'unknown'
  let device: Storage | null = null
  try {
    device = window.localStorage
  } catch {
    /* no storage at all */
  }
  const written: string[] = []
  const undo = () => {
    for (const key of written) removeItem(device!, key)
  }
  if (device)
    for (const entry of PER_PRESET_STORES) {
      if (!entry.duplicate.copied) continue
      const text =
        sourceId === reg.activeId ? entry.savedText() : savedCopyText(entry.key, sourceId)
      if (text === null) continue
      const key = presetKey(entry.key, id)
      if (!tryWriteItem(device, key, text)) {
        undo()
        return 'no-room'
      }
      written.push(key)
    }
  const taken = new Set(reg.presets.map((p) => p.name))
  const preset: Preset = {
    id,
    name: normalizePresetName(copyName(reg.presets[index].name, taken), id),
    // The older builds' field (store/presets' Preset), as such a build spells its own new preset.
    amnesic: false,
  }
  const presets = [...reg.presets]
  presets.splice(index + 1, 0, preset)
  const listed = applyRegistryIfRoom({
    presets,
    activeId: reg.activeId,
    nextId: id + 1,
    openInPreset: reg.openInPreset,
  })
  if (!listed) {
    undo()
    return 'no-room'
  }
  return preset
}

// A preset's SAVED copy of one store, re-written as the plain `{ state, version }` that store saves
// — its values, never its bytes, so nothing else that happens to ride in a saved text goes across —
// or null when it has nothing saved there or what is there cannot be read.
function savedCopyText(baseKey: string, presetId: number): string | null {
  const raw = readPresetPayload(baseKey, presetId)
  if (raw === null) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || !('state' in saved)) return null
    const { state, version } = saved as { state: unknown; version?: unknown }
    return JSON.stringify({ state, version })
  } catch {
    return null
  }
}

/**
 * Set the app-GLOBAL "open in" pin (round 21) — 'last' (open in whatever preset was active last
 * time) or a specific preset id. Returns false when there is nothing to do (the value is already
 * what was asked for, or a numeric id that names no preset).
 *
 * ★ A REGISTRY EDIT AND NOTHING ELSE, like renamePreset and movePreset — it moves no bytes, changes
 * no `activeId` and rehydrates nothing, so it does NOT remount the screens (store/amnesic's
 * activeDataId is unaffected; src/main.tsx's subscription there is what would have). It still lives
 * here rather than as an action on the store because `applyRegistry` is deliberately the registry's
 * ONE low-level door and this file is the only room it opens into.
 * ⚠ NOT captured by Save Defaults — SavedDefaults carries settings, prefs and the Amnesic value only,
 * none of which is a registry field, so this is outside every snapshot by construction.
 */
export function setOpenInPreset(value: number | 'last'): boolean {
  const reg = usePresets.getState()
  if (value === reg.openInPreset) return false
  if (value !== 'last' && !reg.presets.some((p) => p.id === value)) return false
  usePresets.getState().applyRegistry({ ...reg, openInPreset: value })
  return true
}

/**
 * Put the preset this page load landed in on the SESSION's record — called once per page load, by
 * src/main.tsx's boot effect.
 *
 * WHY IT IS NEEDED. The "open in" pin is applied in the registry's hydrate `merge` (store/presets),
 * and hydration writes nothing: after a pinned fresh open, memory says "preset 2" and nothing else
 * does. A reload must stay on the preset the player is on, and a reload reads the session's record
 * (store/sessionPreset) — so this is the line that makes a refresh right after a pinned open land
 * where the player is.
 * ⚠ A SESSION-STORAGE WRITE, AND NOTHING PERMANENT. It used to be a write of the shared registry,
 * which a device full to the byte refused: the reload then landed in the last visit's preset. The
 * registry's own `activeId` is still written by every CHANGE of preset, and stays what it means to
 * a fresh open with no pin — the preset that was active last.
 */
export const commitSessionPreset = (): void => recordSessionPreset(usePresets.getState().activeId)

/**
 * Clear away what presets that no longer exist left behind — called once per fresh open, by
 * src/main.tsx's cold-open effect.
 *
 * WHY IT IS NEEDED. Deleting a preset in THIS build removes everything of it. An older build on this
 * origin (live and staging share one copy of the data) removes only the four keys it knows, so a
 * preset deleted there leaves behind its sealed chunks of solve times and its Julian-on Year Range
 * (store/julianRange), with nothing pointing at them. (Ids are never reused, so neither could ever
 * be read as another preset's; this is tidying, not a defence.)
 * ⚠ ONLY A PRESET NEITHER REGISTRY KNOWS — the one in memory and the one on the device, which
 * another tab may have added to since this page loaded. The chunks go only when the preset has no
 * progress key either (store/progressStorage's sweepAbandonedTimes checks that half, held saves
 * included). The Year Range goes only while this page is holding no refused save: a registry save
 * held back on a full device is a list the device does not show, which may name the preset.
 */
export function sweepDeletedPresetLeftovers(): void {
  const known = new Set(
    [...usePresets.getState().presets, ...(readStoredRegistry()?.presets ?? [])].map((p) => p.id),
  )
  try {
    const area = window.localStorage
    sweepAbandonedTimes(area, (id) => known.has(id))
    if (isHolding(area)) return
    const base = PRESET_STORE_KEYS.julianRange
    const orphans: string[] = []
    // (which preset a per-preset doc key is - null for any other key)
    const presetOf = (docKey: string): number | null => {
      for (const b of Object.values(PRESET_STORE_KEYS))
        if (docKey.startsWith(b)) {
          const id = presetIdOfSuffix(docKey.slice(b.length))
          if (id !== null) return id
        }
      return null
    }
    for (let i = 0; i < area.length; i++) {
      const key = area.key(i)
      if (!key) continue
      const id = key.startsWith(base) ? presetIdOfSuffix(key.slice(base.length)) : null
      if (id !== null && !known.has(id)) orphans.push(key)
      // ★ …AND THE SYNC KEYS AN OLDER BUILD'S DELETE LEAVES BEHIND (design 8.4): it removes the four doc
      // keys it knows and nothing of this build's. Such a key goes when its preset is in neither registry
      // AND its doc is gone from the device (a doc still there is a preset's, whatever a list says).
      const docKey = docKeyOfSyncKey(key)
      const owner = docKey === null ? null : presetOf(docKey)
      if (docKey !== null && owner !== null && !known.has(owner) && area.getItem(docKey) === null)
        orphans.push(key)
    }
    for (const key of orphans) removeItem(area, key)
  } catch {
    /* storage refused — there is nothing to sweep */
  }
}

/**
 * What became of a rename: the preset now has that name; there is no such preset; or the device
 * had no room to save the name, and nothing was changed.
 */
export type RenameOutcome = 'renamed' | 'unknown' | 'no-room'

/**
 * Rename a preset. An empty name — one with nothing visible in it — falls back to the default one.
 *
 * ★ A NAME THE DEVICE CANNOT SAVE IS REFUSED, NOT HELD ('no-room'). A name may be any length, so it
 * is the one registry change that can be too big to save at all; store/presets' applyRegistryIfRoom
 * says why holding it would be wrong. The preset keeps the name it had, on the device and in memory.
 * ★ THE NAME IT ALREADY HAS IS NOT WRITTEN AGAIN. Entering a name's field and leaving it is a
 * rename to the same name, and a name can be a book: nothing is saved for it.
 */
export function renamePreset(id: number, name: string): RenameOutcome {
  const reg = usePresets.getState()
  const preset = reg.presets.find((p) => p.id === id)
  if (!preset) return 'unknown'
  const next = normalizePresetName(name, id)
  if (next === preset.name) return 'renamed'
  const saved = applyRegistryIfRoom({
    ...reg,
    presets: reg.presets.map((p) => (p.id === id ? { ...p, name: next } : p)),
  })
  return saved ? 'renamed' : 'no-room'
}

/**
 * Move a preset one place along the list — `delta` −1 for up, +1 for down. Returns false when
 * there is nothing to do (unknown id, or it is already at that end).
 *
 * ★ THE ONLY OPERATION IN THIS FILE THAT IS A REGISTRY EDIT AND NOTHING ELSE, and the reason is
 * worth stating because it is what makes it cheap: ORDER IS THE ARRAY ORDER (store/presets rejected
 * a separate `order` field on sight), and `presetKey` is a pure function of a preset's ID, which
 * this never touches. So a reorder moves no bytes — not one storage key changes, nothing rehydrates
 * — and it must NOT remount the screens either: store/amnesic's activeDataId deliberately ignores
 * everything about the registry except which preset is live (and, beside it, that preset's Amnesic
 * value), so a player reordering the list mid-run keeps the run. That exclusion is written
 * down at activeDataId; this function is the second thing relying on it (renaming was the first).
 * ⚠ IT STILL LIVES HERE RATHER THAN AS AN ACTION ON THE STORE, and for the opposite reason to its
 * neighbours: not because it needs the storage work they need, but because `applyRegistry` is
 * deliberately the registry's ONE low-level door and this file is the only room it opens into. A
 * second door on the store — even a harmless one — is what store/presets' "state plus one applier"
 * note refuses, because the next one added would not be harmless.
 *
 * ★★ UP/DOWN CONTROLS, NOT DRAG-TO-REORDER, AND THE PRICE OF THE OTHER ANSWER IS ALREADY PAID.
 * Dragging is the obvious gesture for an ordered list. This app has TWO recorded cases of a pointer
 * gesture that passed in Chromium every time and FAILED on the owner's iPhone (round 11's mode
 * selector, cases A and B), and both were cured by DELETING gesture code rather than by writing
 * more — the platform reason is at the top of components/CustomSelect. There is no drag-reorder
 * machinery in this repo, so introducing some would be a third chance to re-derive that bug, for a
 * list that is realistically two or three rows long. A swap is one array write and cannot fail on
 * a platform.
 */
export function movePreset(id: number, delta: number): boolean {
  const reg = usePresets.getState()
  const from = reg.presets.findIndex((p) => p.id === id)
  const to = from + delta
  // The BOUNDS CHECK is the whole guard, and it is what makes `delta` safe to trust rather than
  // validate: the two call sites pass ±1, and any `to` that falls off either end of the list is
  // refused here — so the worst a wrong delta can do is move a preset to a real position or be
  // told no. `from < 0` covers the unknown id (findIndex's −1), which would otherwise compute a
  // plausible-looking `to` of 0 for delta +1.
  if (from < 0 || to < 0 || to >= reg.presets.length) return false
  const presets = [...reg.presets]
  ;[presets[from], presets[to]] = [presets[to], presets[from]]
  usePresets.getState().applyRegistry({ ...reg, presets })
  return true
}

/**
 * Open a different preset. Returns false when there is nothing to do (unknown id, or already
 * active).
 *
 * ★★ SWITCHING IS STRUCTURALLY A SECOND FULL RESET, AND THE HALF THIS FUNCTION CANNOT DO IS THE
 * SCREEN REMOUNT. Reloading the four stores moves the SAVED data, but the five always-mounted mode
 * screens and the guide hold state of their own — the run in progress, the current question, the
 * timers, and the stats each screen hydrated ONCE ON MOUNT and mirrors back on every change — that
 * no store reload can reach. Leave them mounted across a switch and the very next answered question
 * writes the OLD preset's stats into the NEW preset. That is not a hypothetical: it was reproduced
 * against the real stores, and a device with 500 cards ended up holding 4.
 *
 * ★ WHO DOES THE REMOUNT, AND WHY IT IS NOT AN ARGUMENT TO THIS FUNCTION. The first draft made it a
 * REQUIRED parameter — `switchPreset(id, remountScreens)` — reasoning that TypeScript can refuse a
 * call that forgets it where a comment cannot. Two things beat that:
 *   • it enforces PRESENCE, not correctness. `switchPreset(id, () => {})` type-checks, and so does
 *     a callback that bumps four of the five keys — which is the actual failure, silently, on one
 *     screen. Meanwhile deletePreset has to demand the same callback and then ignore it whenever
 *     the preset being deleted is not the active one, which teaches a reader it is optional.
 *   • it makes the remount a DUTY re-derived at every call site — a future deep link, a multi-tab
 *     sync, the UI that has not been written yet — when it is really a CONSEQUENCE of one fact:
 *     the active preset changed.
 * So src/main.tsx SUBSCRIBES to the registry and remounts whenever store/amnesic's `activeDataId`
 * changes (see `remountScreens` there and the subscription beside it), so setPresetAmnesic below
 * rides the same wire. Every path that can repoint the data — this one, deletePreset,
 * setPresetAmnesic, and anything added later — is covered by construction, and the UI group's
 * switcher is a one-liner: `switchPreset(id)`.
 *   ⚠ A SUBSCRIPTION, NOT AN EFFECT, AND THAT IS THE LOAD-BEARING PART. zustand runs subscribers
 *     SYNCHRONOUSLY inside the `applyRegistry` set below, so the five remount-key bumps are already
 *     scheduled before the four rehydrations run and React commits the whole thing at once: the
 *     screens come back ALREADY holding the incoming preset. An effect keyed on activeId would
 *     leave one commit in which the stores hold the new preset while the screens still hold the
 *     old — safe only for as long as no mode screen's stat-mirror effect happens to re-fire in it,
 *     which is a dependency array's business and not a contract anybody signed. (Since Round 26
 *     such a write would be refused anyway: store/screenPool lets a screen write only to the copy
 *     it was drawn for.)
 *   ⚠ WHAT main.tsx MUST **NOT** DO on a switch is the rest of fullReset. resetSettings /
 *     resetProgress / resetModePrefs would overwrite the preset you just opened with defaults — a
 *     switch that wipes its own destination. Only the discard half.
 *
 * ORDER: registry first — which both schedules the remount and means that from this line on no
 * store considers the old preset active — then the four reloads. One synchronous turn, so nothing
 * can write in between: there is no window in which a store is pointed at one preset while holding
 * another's.
 * ⚠ THAT WINDOW WAS ONCE OPENED FROM INSIDE THIS VERY TURN, by the storage-full retry: the registry
 * write succeeding re-saved "whatever each refused store holds now" through that store's adapter —
 * which already pointed at the INCOMING preset while the stores still held the OUTGOING one. A
 * refused save is now held under its own destination key and retried to that key only
 * (store/storageHealth), so nothing in this turn can write one preset's values under another's; and
 * the reloads below read the outgoing preset's held values back when the player returns to it.
 */
export function switchPreset(id: number): boolean {
  const reg = usePresets.getState()
  if (id === reg.activeId || !reg.presets.some((p) => p.id === id)) return false
  usePresets.getState().applyRegistry({ ...reg, activeId: id })
  reloadPresetStores()
  return true
}

/**
 * Set a preset's Amnesic value — Off, Stats Only or Full: a field of its settings (store/settings,
 * design-q1-q2.md v4, 9), written as any setting is, and then the change's reaction
 * (applyAmnesicChange, below). Returns false when there is nothing to do (unknown id, or the value is
 * already what was asked for).
 *
 * ★★ IT IS THE SAME OPERATION AS switchPreset, WITH A DIFFERENT REASON. Changing the value repoints
 * the progress store (store/progressDoor: the device's copy, or this window's session one) — at the other storage area, or at a
 * different split between the two — which is structurally identical to repointing it at another
 * preset's keys; and the five always-mounted mode screens hydrate their stats ONCE, at mount, and
 * mirror them back on every change. Leave them mounted across the change and the next answered
 * question writes the numbers they are still holding into whichever copy is now live. That is the
 * 500-cards-becomes-4 bug with a different trigger, so it gets the identical treatment: the value
 * first (which schedules the remount, because src/main.tsx is subscribed to store/amnesic's
 * activeDataId), then the rehydrations, all in one synchronous turn with no window in between.
 *
 * ★ THE RULE, WHICH IS WHAT MAKES THIS SAFE — ONE LINE FOR ALL SIX CHANGES: THE SESSION'S COPY IS
 * DISCARDED, THEN EVERYTHING IS READ AGAIN. What the screen shows afterwards follows from what each
 * value keeps where:
 *     → Off         your saved stats and bests come back exactly as they were (plus any Best a
 *                   Stats Only session saved — that is what Stats Only is for).
 *     → Stats Only  the stats start at ZERO; the Bests shown are your saved ones.
 *     → Full        the stats start at ZERO and so do the Bests; everything saved is PARKED,
 *                   untouched.
 *   That holds whichever value it was before. Going between Stats Only and Full is a new session
 *   too: the guest you hand the phone to starts from zero, and what the guest did is not waiting for
 *   you afterwards.
 *   ⚠⚠ MERGING A SESSION BACK IS BANNED, and this is the line that makes it unwritable — by the
 *   time anything permanent is read again, the session's numbers no longer exist anywhere. The one
 *   thing a session ever adds to the permanent copy is a Best set under Stats Only, and that was
 *   saved the moment the round set it, by the storage itself; nothing is carried across here.
 *   ⚠⚠ …AND NEITHER DO THE SESSION'S ROUNDS. An ended Blitz round / MoX run carries the Best records
 *   that stood before it and its round id, and the screen that restores it rebuilds the live Bests
 *   from them — so a guest round that survived a change WAS a merge, by another door (reproduced: it
 *   replaced, lowered or erased permanent bests). The rounds parked against the SESSION's bests are
 *   discarded with the session copy, and store/sessionRound keys every parked round by the bests it
 *   was scored against (store/amnesic's bestsIdOf), so a round can only ever be restored over those.
 *   The round parked against the PERMANENT bests is untouched by every change: it is hidden while
 *   the value is Full and back when it is not, and it stays on screen between Off and Stats Only,
 *   which share those bests.
 *
 * ⚠ IT REHYDRATES ALL FOUR STORES, not just progress. Only progress can have moved, so the other
 * three re-read the values they already hold — a genuine no-op, since every one of them writes
 * synchronously on every set, and a save the device refused is read back from where
 * store/storageHealth holds it, so none of them has an in-memory state to lose. It is
 * reloadPresetStores for the same reason switchPreset uses it: ONE reload path means a fifth
 * per-preset store added later is covered by being listed there, and there is no second, narrower
 * copy for a future change to forget to widen.
 *
 * ⚠ SWITCHING AWAY AND BACK IS NOT A CHANGE and deliberately keeps the session going: the session
 * copy and the value are both keyed per preset and nothing here runs on a switch, so an amnesic
 * preset you left and returned to still has its session. Only closing the app ends a session's numbers
 * (the value itself stays, as every setting does).
 * ⚠ THE ONE THING WRITTEN IS THE VALUE ITSELF, in the preset's settings: it stays across a real close
 * and reopen, and every other window of the preset follows it (store/settings' apply runs
 * applyAmnesicChange there - each window then plays its own session).
 */
export function setPresetAmnesic(id: number, mode: AmnesicMode): boolean {
  const { presets } = usePresets.getState()
  const from = amnesicModeOf(id)
  if (!presets.some((p) => p.id === id) || from === mode) return false
  writePresetAmnesic(id, mode)
  applyAmnesicChange(id, from, mode)
  return true
}

/**
 * ★ WHAT A CHANGE OF A PRESET'S AMNESIC VALUE DOES, wherever the change was made (design 9.2): a tap
 * here (setPresetAmnesic, above, after it writes the value) and another window's change of the same
 * preset (store/settings' apply, after the door patched the value in) run this and nothing else. Its
 * rule is setPresetAmnesic's, argued there: THIS WINDOW'S SESSION COPY IS DISCARDED, THEN EVERYTHING IS
 * READ AGAIN - and the screens remount on the copy now in use (src/main.tsx's subscription, which the
 * value's own change already moved). `from` and `to` are the two values, for the reaction's rules.
 */
export function applyAmnesicChange(id: number, _from: AmnesicMode, _to: AmnesicMode): void {
  const { activeId } = usePresets.getState()
  discardSessionStats(id)
  // …and the rounds parked against the session's bests, which share that copy's lifetime: a guest
  // round must not outlive the guest bests it was scored against, and a fresh guest start must not
  // find the last guest's round. The round parked against the SAVED bests is untouched (above).
  discardSessionRoundsOf(bestsIdOf(id, 'full'))
  // …and, for the same reason, any casual history parked against a session's stats — both spellings
  // of them, since a change between Stats Only and Full starts those stats again. The value written
  // above has just parked the outgoing screens (src/main.tsx's subscription): leaving a session,
  // this throws that away with the rest of it; leaving Off, the same write parked YOUR screens under
  // the saved copy, which this does not touch — that is the history that is waiting when you are
  // back on Off.
  discardSessionHistoriesOf(dataIdOf(id, 'stats'))
  discardSessionHistoriesOf(dataIdOf(id, 'full'))
  // Only the ACTIVE preset has anything loaded to reload. Changing the value of a preset you are not
  // on changes nothing on screen and nothing in memory — it just decides where that preset's stats
  // will be read from the next time it is opened, which is exactly what deletePreset's `wasActive`
  // guard says about the same situation.
  if (id === activeId) reloadPresetStores()
}
// (another window's change of the active preset's value - the only preset whose settings doc the door
// patches here)
onAmnesicAdopt((from, to) => applyAmnesicChange(usePresets.getState().activeId, from, to))

/**
 * Delete a preset and its saved copy. Returns false when there is nothing to do (unknown id) or
 * when it is refused (the last remaining preset — the app has no way to render "no presets", and
 * "delete everything" is what Full Reset is for). Deleting the ACTIVE preset opens its neighbour,
 * which IS a switch — and it gets the screen remount for free, from the same main.tsx subscription
 * that covers switchPreset, because the one thing both operations have in common is that `activeId`
 * changed. Deleting a preset you are not on changes nothing on screen, and nothing remounts.
 *
 * ★★ DELETING PRESET 1 IS THE SPECIAL CASE, AND IT NEEDS NO SPECIAL CODE — that is the payoff of
 * `presetKey(base, 1) === base`. The generic removal below deletes the UN-NAMESPACED keys, which is
 * exactly right: those keys are preset 1's saved copy and nothing else's. What it does need is the
 * consequence stated out loud, because it is permanent:
 *   • A build that has never heard of presets — an old cached build, or the other site on this
 *     shared origin — reads the un-namespaced keys and only those. After this, they are gone, so
 *     that build opens factory-fresh. That is HONEST rather than broken: preset 1's data really was
 *     deleted, and no build that predates presets could ever have shown preset 2's.
 *   • Slot 1 is then vacant FOREVER. Ids are allocated forward and never reused, so no future
 *     preset is written into the un-namespaced keys. If an old build later plays and writes them,
 *     that data belongs to no preset and this app will never show it — bounded, and it is that
 *     build's own data.
 *   • REJECTED: promoting another preset into slot 1 (copying its keys onto the un-namespaced ones)
 *     to keep an ignorant build showing "something". That is the copy-migration this whole design
 *     exists to delete — the half-finished copy, the interleaved-build data loss, the run-twice
 *     hazard — reintroduced for a cosmetic benefit to a build nobody is running.
 *
 * ORDER: registry first, so nothing considers the doomed preset active while its keys are being
 * removed (and, when it was active, so the remount is scheduled before anything else happens); then
 * the keys; then, only if it WAS active, the reload.
 */
export function deletePreset(id: number): boolean {
  const reg = usePresets.getState()
  const index = reg.presets.findIndex((p) => p.id === id)
  if (index < 0 || reg.presets.length <= 1) return false
  const presets = reg.presets.filter((p) => p.id !== id)
  const wasActive = reg.activeId === id
  // The one after it, or the one before when it was last — the neighbour a player's eye is already
  // on, rather than an arbitrary "first".
  const activeId = wasActive ? (reg.presets[index + 1] ?? reg.presets[index - 1]).id : reg.activeId
  // If the "open in" pin named the preset being deleted, drop it back to 'last' — the next cold
  // open would land nowhere otherwise (store/presets' resolveActiveId falls back to activeId,
  // but clearing it here keeps the stored value honest rather than dangling).
  const openInPreset = reg.openInPreset === id ? 'last' : reg.openInPreset
  usePresets.getState().applyRegistry({ presets, activeId, nextId: reg.nextId, openInPreset })
  clearPresetStorage(id)
  if (wasActive) reloadPresetStores()
  return true
}
