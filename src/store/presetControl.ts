import {
  usePresets,
  presetKey,
  normalizePresetName,
  defaultPresetName,
  readStoredRegistry,
  PRESET_STORE_KEYS,
  FIRST_PRESET_ID,
} from './presets.js'
import type { Preset } from './presets.js'
import { isAmnesic, discardSessionStats } from './amnesic.js'
import { useSettings, SETTINGS_DEFAULTS } from './settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from './modePrefs.js'
import { useProgress, makeProgressDefaults } from './progress.js'
import { useUserDefaults, makeUserDefaultsDefaults } from './userDefaults.js'

// store/presetControl.ts — the six things you can DO to the set of presets, and the only place
// allowed to do them.
//
// WHY THIS IS NOT IN store/presets.ts. The registry file holds a saved value and the storage layer
// that reads it; this file holds the operations, because three of them (switching, deleting,
// and turning amnesic on or off) are not registry edits at all — they are a registry edit PLUS four
// store rehydrations, and both halves are load-bearing. Splitting them apart is what makes "did
// only the first half" impossible to write by accident. It is also what keeps the dependency graph one-way: presets.ts knows nothing
// about the four data stores, this file imports all of them, and nothing imports this file back.
//
// ⚠ THERE IS A THIRD PART, AND IT IS DELIBERATELY NOT HERE: remounting the six always-mounted
// screens. It cannot live in a store file — it is React state in src/main.tsx — and it is not an
// argument to these functions either. main.tsx SUBSCRIBES to the registry and remounts whenever
// store/amnesic's `activeDataId` changes — "which preset, and which of its two storage areas its
// stats live in" — so every path into that hazard is covered by construction rather than by a
// caller remembering. It is NOT `activeId`: repointing the preset you are already on at
// sessionStorage is the same hazard without activeId moving at all. The full argument, including
// the required-parameter design this replaced and why the subscription must not be an effect, is at
// switchPreset below.
//
// ⚠ THIS FILE IS THE PROGRAMMATIC API THE UI GROUP DRIVES. There is deliberately no UI, no top bar
// and no settings-panel wiring here — `switchPreset(id)` is the whole call a CustomSelect needs.

// ⚠⚠ THE TWO WAYS A STORE CAN BE POINTED AT A NEW PRESET, and BOTH are needed — see
// reloadPresetStores below, where the second one's absence was a silent isolation failure. A store
// that has storage REHYDRATES; a store that has none is set to the factory values a hydration from
// an absent payload would have produced. The defaults are the SAME factories each store hands its
// own `merge`, imported rather than re-typed, so the two answers to "what does a preset with no
// saved copy hold" cannot drift apart.
type PresetStore<T> = {
  // Optional BY NECESSITY rather than by taste: zustand's type says `persist` is always there, and
  // in a browser that refuses localStorage it is genuinely undefined (argued below).
  persist?: { rehydrate: () => void | Promise<void> }
  setState: (partial: Partial<T>) => void
}
const reloader =
  <T>(store: PresetStore<T>, makeDefaults: () => Partial<T>) =>
  () => {
    if (store.persist) store.persist.rehydrate()
    else store.setState(makeDefaults())
  }

// ★ ORDERED, AND THE ORDER IS A REQUIREMENT, NOT A LIST. store/progress' `migrate` reads
// `useSettings.getState().julianChance` to complete a pre-v2 AoX best's key. So settings must
// rehydrate BEFORE progress, or a preset whose saved progress is old enough to need that migration
// would be re-keyed under the preset you just LEFT — a best that then belongs to no configuration
// the player can reach. `Object.values(...)` over a record would have gotten this right by luck
// and lost it the first time someone reordered the record.
const PER_PRESET_STORES = [
  reloader(useSettings, () => ({ ...SETTINGS_DEFAULTS })),
  reloader(useModePrefs, () => ({ ...MODE_PREFS_DEFAULTS })),
  reloader(useProgress, makeProgressDefaults),
  reloader(useUserDefaults, makeUserDefaultsDefaults),
]

// Reload all four from the active preset's keys, in one synchronous turn.
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
// ⚠ Rehydration writes NOTHING. Zustand's hydrate() lands the loaded state through the RAW `set`,
// not the persist-wrapped one, so reloading a preset that has never been saved does not create its
// keys, and reloading one that has does not rewrite them. The defaults branch writes nothing
// either — there is no storage for it to write to.
const reloadPresetStores = () => {
  for (const reload of PER_PRESET_STORES) reload()
}

// Remove one preset's saved copy — its four keys and nothing else. Derived from the key record
// rather than by scanning localStorage for a pattern, so it cannot sweep up a neighbour, and so a
// fifth per-preset store becomes deletable by the act of being listed there.
// Swallows a refusing localStorage: there is nothing to delete in a browser that has stored nothing.
const clearPresetStorage = (presetId: number) => {
  try {
    for (const baseKey of Object.values(PRESET_STORE_KEYS))
      window.localStorage.removeItem(presetKey(baseKey, presetId))
  } catch {
    /* storage refused — nothing was ever written, so nothing is left behind */
  }
  // …and the SECOND place a preset can have written: an amnesic preset's stats live in
  // sessionStorage under the same key, and "remove exactly its keys and nothing else" has to mean
  // both areas or a deleted preset leaves a session copy behind. Unconditional rather than gated on
  // the flag — the preset is being removed from the registry in the same breath, so there would be
  // nothing left to ask.
  discardSessionStats(presetId)
}

// Is any of this preset's saved data already on disk? Used only when allocating an id — see
// createPreset, which is where the reason it can ever be true is argued.
const presetStorageInUse = (presetId: number): boolean => {
  try {
    return Object.values(PRESET_STORE_KEYS).some(
      (baseKey) => window.localStorage.getItem(presetKey(baseKey, presetId)) !== null,
    )
  } catch {
    return false
  }
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
  const reg = usePresets.getState()
  // ★ IDS ARE ALLOCATED FORWARD AND NEVER REUSED (store/presets' normalizeRegistry forces nextId
  // above every listed id, whatever the payload claimed). That is what lets `presetKey` be a pure
  // function of the id: a namespace, once vacated, is never handed to a different preset.
  // ⚠⚠ MULTI-TAB IS REACHABLE HERE, AND FOR THIS OWNER IT IS ROUTINE: the LIVE PWA and the STAGING
  // site are the same browser origin, so two tabs really do hold two copies of this registry. If
  // the other tab created a preset after this tab last hydrated, an allocation from the in-memory
  // `nextId` alone hands out an id that tab already used, and the two presets SHARE a namespace —
  // two players' data merged, which is worse than any amount of registry divergence.
  // ★ SO THE FLOOR IS THE STORED REGISTRY, NOT THE ONE IN MEMORY. The other tab's `applyRegistry`
  // wrote its `nextId` to disk synchronously, so re-reading the key here sees an id it allocated
  // even for a preset NOBODY HAS OPENED YET — which is the window the skip loop below cannot see
  // into, because a preset's four per-preset keys do not exist until it is first opened, and that
  // is precisely when a just-created preset is most likely to be raced.
  //   The residual window is one synchronous turn (this read, then the write below) instead of the
  //   whole life of the tab. Closing that last sliver would take a lock this platform does not
  //   offer for localStorage; nothing here can be made to wait.
  //   ⚠ IT DOES NOT FIX THE DIVERGENCE, and cannot: this tab still writes back ITS list, so the
  //   other tab's new preset is dropped from the registry until one of them reloads. That is a
  //   listing disagreement between two tabs of the same app, and it heals on any reload; a merged
  //   namespace never heals.
  // ⚠ THE SKIP LOOP STAYS, for the case the stored registry cannot answer either: keys left on disk
  // by a delete that was interrupted between the registry write and the removal. It is also the
  // second net under the sliver above.
  const stored = readStoredRegistry()
  let id = Math.max(reg.nextId, stored?.nextId ?? 0, FIRST_PRESET_ID + 1)
  while (presetStorageInUse(id)) id++
  // A new preset is PERMANENT until somebody says otherwise. Inheriting the current preset's
  // amnesic flag was rejected on sight: creating a preset is not a decision about where its stats
  // are kept, and the one direction of that mistake — a preset that silently forgets — is the one
  // the player would only discover after losing something.
  const preset: Preset = {
    id,
    name: normalizePresetName(name ?? defaultPresetName(id), id),
    amnesic: false,
  }
  usePresets.getState().applyRegistry({
    presets: [...reg.presets, preset],
    activeId: reg.activeId,
    nextId: id + 1,
  })
  return preset
}

/** Rename a preset. An empty or whitespace-only name falls back to the default one. */
export function renamePreset(id: number, name: string): boolean {
  const reg = usePresets.getState()
  if (!reg.presets.some((p) => p.id === id)) return false
  usePresets.getState().applyRegistry({
    ...reg,
    presets: reg.presets.map((p) =>
      p.id === id ? { ...p, name: normalizePresetName(name, id) } : p,
    ),
  })
  return true
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
 * everything about the registry except which preset is live and which of its two storage areas its
 * stats are in, so a player reordering the list mid-run keeps the run. That exclusion is written
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
 *     a callback that bumps five of the six keys — which is the actual failure, silently, on one
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
 *     SYNCHRONOUSLY inside the `applyRegistry` set below, so the six remount-key bumps are already
 *     scheduled before the four rehydrations run and React commits the whole thing at once: the
 *     screens come back ALREADY holding the incoming preset. An effect keyed on activeId would
 *     leave one commit in which the stores hold the new preset while the screens still hold the
 *     old — safe only for as long as no mode screen's stat-mirror effect happens to re-fire in it,
 *     which is a dependency array's business and not a contract anybody signed.
 *   ⚠ WHAT main.tsx MUST **NOT** DO on a switch is the rest of fullReset. resetSettings /
 *     resetProgress / resetModePrefs would overwrite the preset you just opened with defaults — a
 *     switch that wipes its own destination. Only the discard half.
 *
 * ORDER: registry first — which both schedules the remount and means that from this line on no
 * store considers the old preset active — then the four reloads. One synchronous turn, so nothing
 * can write in between: there is no window in which a store is pointed at one preset while holding
 * another's.
 */
export function switchPreset(id: number): boolean {
  const reg = usePresets.getState()
  if (id === reg.activeId || !reg.presets.some((p) => p.id === id)) return false
  usePresets.getState().applyRegistry({ ...reg, activeId: id })
  reloadPresetStores()
  return true
}

/**
 * Make a preset amnesic, or stop. Returns false when there is nothing to do (unknown id, or the
 * flag is already what was asked for).
 *
 * ★★ IT IS THE SAME OPERATION AS switchPreset, WITH A DIFFERENT REASON. Flipping this flag repoints
 * the progress store at the OTHER storage area (store/amnesic's presetStatsStorage), which is
 * structurally identical to repointing it at another preset's keys — and the five always-mounted
 * mode screens hydrate their stats ONCE, at mount, and mirror them back on every change. Leave them
 * mounted across the flip and the next answered question writes the numbers they are still holding
 * into whichever copy is now live. That is the 500-cards-becomes-4 bug with a different trigger, so
 * it gets the identical treatment: registry write first (which schedules the remount, because
 * src/main.tsx is subscribed to store/amnesic's activeDataId and not to activeId alone), then the
 * rehydrations, all in one synchronous turn with no window in between.
 *
 * ★ THE TOGGLE RULE, WHICH IS WHAT MAKES THIS SAFE:
 *     ON  → the saved stats are PARKED, UNTOUCHED; the session starts at ZERO.
 *     OFF → the session's stats are DISCARDED; the saved stats come back exactly as they were.
 *   Both directions are the SAME LINE — discard the session copy, then reload. Turning ON, the
 *   discard is what guarantees a zero start even if this preset was amnesic earlier in the same
 *   browsing session (the store then re-derives from store/amnesic's seed). Turning OFF, it is what
 *   guarantees the session's numbers cannot be reconciled into the permanent ones afterwards:
 *   ⚠⚠ MERGING A SESSION BACK IS BANNED, and this is the line that makes it unwritable — by the
 *   time anything permanent is read again, the session's numbers no longer exist anywhere.
 *
 * ⚠ IT REHYDRATES ALL FOUR STORES, not just progress. Only progress can have moved, so the other
 * three re-read the values they already hold — a genuine no-op, since every one of them writes
 * synchronously on every set and none of them has an unsaved in-memory state to lose. It is
 * reloadPresetStores for the same reason switchPreset uses it: ONE reload path means a fifth
 * per-preset store added later is covered by being listed there, and there is no second, narrower
 * copy for a future change to forget to widen.
 *
 * ⚠ SWITCHING AWAY AND BACK IS NOT A TOGGLE and deliberately keeps the session going: the session
 * copy is keyed per preset and nothing here runs on a switch, so an amnesic preset you left and
 * returned to still has its session. You never closed the app; that is the only event that ends one.
 */
export function setPresetAmnesic(id: number, amnesic: boolean): boolean {
  const reg = usePresets.getState()
  if (!reg.presets.some((p) => p.id === id) || isAmnesic(reg, id) === amnesic) return false
  usePresets.getState().applyRegistry({
    ...reg,
    presets: reg.presets.map((p) => (p.id === id ? { ...p, amnesic } : p)),
  })
  discardSessionStats(id)
  // Only the ACTIVE preset has anything loaded to reload. Flipping the flag on a preset you are not
  // on changes nothing on screen and nothing in memory — it just decides where that preset's stats
  // will be read from the next time it is opened, which is exactly what deletePreset's `wasActive`
  // guard says about the same situation.
  if (id === reg.activeId) reloadPresetStores()
  return true
}

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
  usePresets.getState().applyRegistry({ presets, activeId, nextId: reg.nextId })
  clearPresetStorage(id)
  if (wasActive) reloadPresetStores()
  return true
}
