import {
  usePresets,
  presetKey,
  normalizePresetName,
  defaultPresetName,
  PRESET_STORE_KEYS,
  FIRST_PRESET_ID,
} from './presets.js'
import type { Preset } from './presets.js'
import { isAmnesic, discardSessionStats } from './amnesic.js'
import { useSettings } from './settings.js'
import { useModePrefs } from './modePrefs.js'
import { useProgress } from './progress.js'
import { useUserDefaults } from './userDefaults.js'

// store/presetControl.ts — the five things you can DO to the set of presets, and the only place
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

// ★ ORDERED, AND THE ORDER IS A REQUIREMENT, NOT A LIST. store/progress' `migrate` reads
// `useSettings.getState().julianChance` to complete a pre-v2 AoX best's key. So settings must
// rehydrate BEFORE progress, or a preset whose saved progress is old enough to need that migration
// would be re-keyed under the preset you just LEFT — a best that then belongs to no configuration
// the player can reach. `Object.values(...)` over a record would have gotten this right by luck
// and lost it the first time someone reordered the record.
const PER_PRESET_STORES = [useSettings, useModePrefs, useProgress, useUserDefaults]

// Reload all four from the active preset's keys, in one synchronous turn.
//
// ⚠ `persist?.` IS NOT DEFENSIVE NOISE. Zustand attaches `api.persist` only when a storage exists;
// in a browser that refuses localStorage the middleware returns before that assignment, so
// `store.persist` is genuinely undefined and an unguarded call would throw. In that browser there
// is nothing to reload anyway — every store is memory-only for the session.
// ⚠ Rehydration writes NOTHING. Zustand's hydrate() lands the loaded state through the RAW `set`,
// not the persist-wrapped one, so reloading a preset that has never been saved does not create its
// keys, and reloading one that has does not rewrite them.
const reloadPresetStores = () => {
  for (const store of PER_PRESET_STORES) store.persist?.rehydrate()
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
  // ⚠ THE SKIP LOOP IS FOR MULTI-TAB, and it is reachable. Two tabs on this origin each hold their
  // own copy of the registry; if the other tab created preset 2 after this tab last read the
  // registry, this tab would allocate 2 as well and the two presets would SHARE a namespace —
  // merging two players' data, which is worse than any amount of registry divergence. Skipping ids
  // whose keys already exist cannot fix the divergence (the lists still differ until a reload) but
  // it does make the data-merging outcome impossible. It doubles as the recovery from a delete that
  // was interrupted with keys still on disk.
  let id = Math.max(reg.nextId, FIRST_PRESET_ID + 1)
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
