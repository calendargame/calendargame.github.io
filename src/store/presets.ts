import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// store/presets.ts — THE PRESET REGISTRY, and the storage layer every per-preset store sits on.
//
// WHAT A PRESET IS. Several independent copies of the app on one device, csTimer-style: each preset
// carries its OWN stats, bests, ⚙ settings, mode setup, saved personal defaults — and its own THEME
// (the owner was explicit that nothing, not even the theme, stays global). Switching preset is
// switching apps.
//
// ★★ THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM: THERE IS NO MIGRATION. Preset 1 does not
// RECEIVE the existing saved data — preset 1 *IS* the existing saved data. Its four stores keep the
// exact localStorage keys they have always had, byte for byte, and only presets 2, 3, 4… get
// namespaced ones. `presetKey` below is written so that this is an IDENTITY rather than a special
// case: the key for preset 1 is the base key with nothing appended.
//   → WHAT THAT DELETES, rather than manages: the copy step, the half-finished copy, the run-twice
//     data loss, the doubled storage, and the clean-up pass that would have had to follow.
//   → ⚠ WHY IT MATTERS *HERE* SPECIFICALLY, and this is not theoretical. The live site and the
//     staging site are THE SAME BROWSER ORIGIN, and preset builds reach staging first, so an old
//     build and a new build genuinely interleave on one set of keys. A copy-into-preset-1 migration
//     was reproduced losing 20 cards silently on exactly that interleaving. With "preset 1 IS the
//     data", a build that has never heard of presets and a build that has agree about preset 1 BY
//     CONSTRUCTION — because the un-namespaced keys are the only thing "your data" could possibly
//     mean to a build that has never heard of presets.
//
// WHAT LIVES IN THIS FILE, and why they live together:
//   • the REGISTRY store — the list of presets and which one is active. It is GLOBAL: it is the
//     thing that says which preset you are on, so it cannot itself live inside a preset.
//   • the KEY MATH (`presetKey`) and the SCOPED STORAGE ADAPTER the four per-preset stores persist
//     through. The adapter reads the registry, so keeping both here means the dependency is one
//     way and inside one file rather than a cycle across two.
//   • `mergeOverDefaults`, the hydration rule that makes a switch safe (argued at its definition).
// What does NOT live here: anything that CHANGES which preset you are on. That is store/presetControl
// — because switching is not a registry edit, it is a registry edit plus four rehydrations plus a
// screen remount, and splitting it out is what stops a caller from doing only the first third.

// ── The keys a preset is made of ──────────────────────────────────────────────────────────────
//
// ★ THE FOUR BASE KEYS LIVE HERE, not in the four store files, and that is deliberate: DELETING a
// preset has to remove exactly its keys and nothing else, which is only checkable if something can
// enumerate them. Enumerating them by scanning localStorage for a pattern would be the fragile
// version (it would sweep up anything that happened to match); deriving them from this record is
// exact, and a fifth per-preset store added later becomes deletable by the act of being listed.
// ⚠ The `-v1` in these strings is the ORIGINAL key version and is frozen history — the live shape
// version is each store's own `version` option (progress is on 3). Do not "tidy" them.
export const PRESET_STORE_KEYS = {
  settings: 'cg-settings-v1',
  modePrefs: 'cg-modeprefs-v1',
  progress: 'cg-progress-v1',
  userDefaults: 'cg-userdefaults-v1',
} as const

// The registry's OWN key, and it is deliberately NOT in the record above: it is global, so it must
// never be namespaced, never be deleted with a preset, and never be scoped by the adapter below.
const PRESET_REGISTRY_KEY = 'cg-presets-v1'

// The first preset's id, which is also the id whose keys are the un-namespaced ones.
export const FIRST_PRESET_ID = 1

// ★ THE WHOLE NAMESPACING SCHEME, and the identity is the point: presetKey(base, 1) === base. A
// reader can therefore verify the "preset 1 is the existing data" promise by looking at one
// expression instead of tracing a migration.
//   WHY A SUFFIX rather than a prefix: it leaves the base key intact and legible at the front, so
//   'cg-progress-v1~p3' still sorts and reads next to its own preset-1 twin in devtools.
//   WHY `~p`: `~` appears nowhere else in this app's key namespace (every existing key uses
//   hyphens), so a namespaced key can never be mistaken for — or collide with — a base key that a
//   future store might introduce.
// ⚠ ONE OTHER PLACE COMPOSES THIS KEY, and it cannot import this function: index.html's pre-React
// boot script, which paints the saved theme on the first frame and therefore has to find the ACTIVE
// preset's settings payload before any module has loaded. tests/bootTheme.dom runs that script
// against seeded storage and compares its answer to this function's, so the two cannot drift.
export const presetKey = (baseKey: string, presetId: number): string =>
  presetId === FIRST_PRESET_ID ? baseKey : `${baseKey}~p${presetId}`

// ── What a preset is, as a saved value ────────────────────────────────────────────────────────

export type Preset = {
  id: number // allocated once, from `nextId`, and NEVER reused — see normalizeRegistry
  name: string
}

export type PresetRegistryValues = {
  // ★ ORDER IS THE ARRAY ORDER. A separate `order` field was rejected on sight: it would be a
  // second source of truth for one fact, and the failure it invites (two presets claiming order 2)
  // has no correct resolution.
  presets: Preset[]
  activeId: number
  // The next id to hand out. Monotonic, never decremented, never reused — the delete-preset-1 case
  // depends on it (see presetControl's deletePreset).
  nextId: number
}

export const MAX_PRESET_NAME = 24

export const defaultPresetName = (id: number): string => `Preset ${id}`

// Fresh defaults via a FACTORY (the same reasoning as makeProgressDefaults): the nested array must
// be a new one each call, so nothing can alias the registry's list into a reset.
//
// ★ THIS IS ALSO THE "MATERIALISE ON A DEVICE THAT HAS NEVER SEEN PRESETS" ANSWER, and it is a
// no-op by construction: the default registry is exactly one preset, id 1, active. Preset 1's keys
// ARE the existing keys, so nothing is copied, nothing is written, and nothing is touched. Such a
// device does not even gain a `cg-presets-v1` entry — persist only writes on a set, and hydrating
// from an absent payload is not a set. The first write happens when the player creates a second
// preset, which is the first moment the registry says anything a default could not.
export const makePresetRegistryDefaults = (): PresetRegistryValues => ({
  presets: [{ id: FIRST_PRESET_ID, name: defaultPresetName(FIRST_PRESET_ID) }],
  activeId: FIRST_PRESET_ID,
  nextId: FIRST_PRESET_ID + 1,
})

// A player-typed name, made safe to store and to render: trimmed, length-capped, and never empty.
export const normalizePresetName = (name: string, id: number): string =>
  (typeof name === 'string' ? name.trim().slice(0, MAX_PRESET_NAME) : '') || defaultPresetName(id)

// ★ THE REGISTRY IS READ FROM UNTRUSTED STORAGE, exactly as store/progress' lookupHistory is, and
// it gets the same treatment for the same reason: the screen is UNCONDITIONAL, not version-gated,
// because a current-shape payload comes out of the same localStorage a tampered or truncated one
// does. The stakes are higher here than anywhere else in the app — an activeId naming a preset that
// does not exist would point the storage adapter at a namespace nothing owns, and the player would
// open the app to a blank one with their real data still on disk and no way to reach it.
export function normalizeRegistry(
  raw: Partial<PresetRegistryValues> | undefined,
): PresetRegistryValues {
  const seen = new Set<number>()
  const presets = (Array.isArray(raw?.presets) ? raw.presets : [])
    .filter((p): p is Preset => !!p && Number.isInteger(p.id) && p.id >= FIRST_PRESET_ID)
    .filter((p) => !seen.has(p.id) && (seen.add(p.id), true))
    .map((p) => ({ id: p.id, name: normalizePresetName(p.name, p.id) }))
  // There is always at least one preset. "Zero presets" is not a state the app can render, and it
  // is not a state a player can reach either (deletePreset refuses the last one) — so a payload
  // claiming it is corrupt, and the honest recovery is the default registry, which points straight
  // back at the un-namespaced keys where the player's original data still is.
  if (!presets.length) return makePresetRegistryDefaults()
  const activeId = presets.some((p) => p.id === raw?.activeId) ? raw!.activeId! : presets[0].id
  // ⚠ nextId is forced ABOVE every id in the list, whatever the payload claimed. This is the line
  // that makes "ids are never reused" true even after tampering or a truncated write — and the
  // delete-preset-1 case rests on it: once slot 1 is vacated its un-namespaced keys must never be
  // handed to a different preset.
  const maxId = presets.reduce((m, p) => (p.id > m ? p.id : m), FIRST_PRESET_ID)
  const claimed = Number.isInteger(raw?.nextId) ? (raw!.nextId as number) : 0
  return { presets, activeId, nextId: Math.max(claimed, maxId + 1) }
}

// ── The registry store ────────────────────────────────────────────────────────────────────────
//
// ★ STATE PLUS ONE APPLIER, and no per-operation actions — which is the opposite of the other four
// stores in this folder, on purpose. Two of the four things you can do to this registry (making a
// preset active, removing one) are NOT safe on their own: they have to be paired with rehydrating
// every per-preset store, and removal with deleting that preset's keys. An `setActivePreset` action
// sitting on the store would be a one-line way to corrupt a player's data — it would look done, and
// the next question answered would write the old preset's stats into the new one. So the store
// exposes ONE deliberately low-level door, the operations are pure functions over the value
// (below), and store/presetControl is the only place that opens the door.
export type PresetRegistryState = PresetRegistryValues & {
  // ⚠⚠ NOT FOR APP CODE. Replaces the whole registry value. Its callers are store/presetControl —
  // which pairs every call with the storage work the change implies — and the test suite. Reaching
  // for it from a component is the 500-cards-becomes-4 bug with extra steps.
  // ⚠ IT IS OBSERVED. src/main.tsx subscribes to this store and remounts the six always-mounted
  // screens whenever this call changes `activeId`, synchronously, inside the set below. That is
  // what makes the remount a consequence of the switch rather than a duty of whoever called it —
  // so a future operation that moves the active preset is covered without doing anything.
  applyRegistry: (next: PresetRegistryValues) => void
}

const PERSISTED_KEYS = Object.keys(makePresetRegistryDefaults()) as (keyof PresetRegistryValues)[]

export const usePresets = create<PresetRegistryState>()(
  persist(
    (set) => ({
      ...makePresetRegistryDefaults(),
      applyRegistry: (next) => set(() => ({ ...next })),
    }),
    {
      // ⚠ The default storage, NOT the scoped adapter below. The registry says which preset you are
      // on; scoping it to a preset would make that question unanswerable.
      name: PRESET_REGISTRY_KEY,
      version: 1,
      partialize: (state) =>
        Object.fromEntries(
          PERSISTED_KEYS.map((k) => [k, state[k]]),
        ) as Partial<PresetRegistryState>,
      // No `migrate` yet — v1 is the first shape there has ever been, so there is no older payload
      // in existence to rewrite. The version field is here so that a future shape change HAS a
      // gate to hang off; the unconditional screen below is what guards the go-forward path, and it
      // is the one that runs on every load at every version.
      merge: (persisted, current) => ({
        ...current,
        ...normalizeRegistry(persisted as Partial<PresetRegistryValues> | undefined),
      }),
    },
  ),
)

// ── Where a per-preset store actually reads and writes ────────────────────────────────────────
//
// ★ THE NAMESPACING MECHANISM, and the alternative it beat. The obvious implementation is to swap
// each store's persist `name` when the active preset changes (`persist.setOptions({ name })`). It
// was rejected:
//   • it needs FOUR key rewrites at every switch, each of which is a chance to miss a store, and a
//     missed store is silent — that store simply keeps writing into the preset you just left;
//   • it leaves the key composition duplicated at four call sites;
//   • worst, it opens a window. Between "name swapped" and "state rehydrated" the store holds the
//     OLD preset's values pointed at the NEW preset's key, and any write in that window overwrites
//     real data with the wrong preset's.
// Instead the `name` NEVER changes — it stays the base key, forever, in the store file where it has
// always been — and this adapter rewrites it to the active preset's key at the moment of each read
// and each write. There is no window at all: the swap IS the registry write, and the very next
// storage call already goes to the new preset.
//
// ⚠ WHAT HAPPENS TO A STORE THAT IS ALREADY MOUNTED WHEN THE ACTIVE PRESET CHANGES — the question
// this design has to answer out loud. Its `name` is unaffected, so its next WRITE lands in the new
// preset automatically; but its in-memory state is still the OLD preset's until something reloads
// it. That is why presetControl.switchPreset rehydrates all four synchronously in the same tick
// (nothing can write in between — this is one JS turn), and why src/main.tsx SUBSCRIBES to the
// registry below and remounts the six always-mounted screens whenever `activeId` changes: those
// screens hold gameplay state of their own that no store reload can reach, and without the remount
// the next answered question writes the old preset's stats into the new preset. That was PROVEN
// against the real stores: a device with 500 cards ended up with 4.
//
// ⚠ ORDERING: this adapter asks the registry for `activeId` on every call, so the registry must
// exist before any per-preset store hydrates. It does, and by construction rather than by luck —
// every per-preset store imports this module, so ESM finishes evaluating this file (registry
// included, hydrated synchronously from localStorage) before that store's `create` runs.
//
// ⚠ PRIVATE MODE: `window.localStorage` is read EAGERLY, inside the factory, so that a browser
// which throws on the property access throws where zustand's createJSONStorage catches it — which
// returns `undefined` and puts the store on persist's in-memory-only path. Building the object
// lazily instead would let the throw escape into every getItem/setItem, i.e. into hydration and
// into every setState. This mirrors zustand's own default storage exactly; it is why the app
// survives locked-down browsing today, and it must keep doing so.
export const presetScopedStorage = <T>() =>
  createJSONStorage<T>(() => {
    const ls = window.localStorage
    const scoped = (name: string) => presetKey(name, usePresets.getState().activeId)
    return {
      getItem: (name) => ls.getItem(scoped(name)),
      setItem: (name, value) => ls.setItem(scoped(name), value),
      removeItem: (name) => ls.removeItem(scoped(name)),
    }
  })

// ── The hydration rule that makes switching safe ──────────────────────────────────────────────
//
// ★ HYDRATION REPLACES THE SAVED DATA; IT DOES NOT PATCH IT OVER WHATEVER IS IN MEMORY. Zustand's
// default merge is `{...current, ...persisted}`, which is correct exactly once — at a cold start,
// where `current` IS the factory defaults. On a PRESET SWITCH the same expression is a data leak:
// `current` is the preset you just left, `persisted` is the preset you just opened, and every key
// the new preset has not saved yet quietly inherits the old preset's value. A brand-new preset —
// which decision 3 says starts from FACTORY DEFAULTS — would open holding a copy of the preset you
// came from, and its first write would make that copy permanent.
//
// So the defaults go in the middle, unconditionally: current (for the actions) → factory values →
// the saved copy. At a cold start this is byte-identical to the default merge, because `current`
// already equals the factory values; at a switch it is the difference between a fresh preset and a
// clone. It also closes a smaller pre-existing hole on the same line: a `persist.rehydrate()` on a
// live store used to keep in-memory values for any key the payload lacked.
//
// ⚠ The persisted half is spread LAST and unscreened, exactly as before — per-store screening
// (progress' lookupHistory normalisation) still belongs to that store's own merge, which composes
// this one rather than replacing it.
export const mergeOverDefaults =
  <V extends object, S>(makeDefaults: () => V) =>
  (persisted: unknown, current: S): S =>
    ({ ...current, ...makeDefaults(), ...(persisted as Partial<S>) }) as S
