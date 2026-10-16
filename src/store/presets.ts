import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { guardedStorage, readItem, writeItem, tryWriteItem, removeItem } from './storageHealth.js'
import { browsingSessionOpen } from './browsingSession.js'
import { sessionPresetId, recordSessionPreset } from './sessionPreset.js'
import { nameHasInk } from '../lib/presetNameInk.js'

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
//     ⚠ WHAT "AGREE" MEANS, EXACTLY, because it is stronger about the KEYS than about the BYTES.
//     The keys are identical, so neither build can ever read or write the other's preset — that is
//     the loss this design deletes, and it is absolute. The PAYLOAD is a weaker promise, and it is
//     each store's own `partialize` that weakens it: an old build writes back only the fields it
//     knows, so any field a NEWER build added is dropped from the shared key the next time the old
//     build saves, and the new build then reads that field as its factory value. It is bounded
//     (one setting reverts; nothing is mis-attributed and no stats are lost) and it is inherent to
//     two builds sharing one key rather than a fault of this scheme — a copy migration would have
//     had the same interleaving with data loss on top. Today's instance is store/settings'
//     `dotRotation` (the Rotate Dots setting, added after this design shipped as `dotOrientation`,
//     then `rotateDots` in round 20, then three-way in round 23); the note, including the one
//     direction a `migrate` step recovers instead of reverting, is at that store's `name` option.
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
// version is each store's own `version` option. Do not "tidy" them.
export const PRESET_STORE_KEYS = {
  settings: 'cg-settings-v1',
  modePrefs: 'cg-modeprefs-v1',
  progress: 'cg-progress-v1',
  userDefaults: 'cg-userdefaults-v1',
} as const

// The registry's OWN key, and it is deliberately NOT in the record above: it is global, so it must
// never be namespaced, never be deleted with a preset, and never be scoped by the adapter below.
// (Exported for store/storageUsage, which tells the preset NAMES in it apart from the rest.)
export const PRESET_REGISTRY_KEY = 'cg-presets-v1'
// The registry's shape version, as its save is stamped (the store's own `version` option).
const REGISTRY_VERSION = 1

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

/**
 * presetKey read backwards: the preset a key belongs to, from what follows its base name — nothing
 * for the first preset, `~p<id>` for any other — or null when that is neither. The ONE reader of the
 * scheme, for the code that has to sort keys it finds on the device by owner (the sealed solve-time
 * chunks in store/progressStorage, the usage reading in store/storageUsage).
 */
export const presetIdOfSuffix = (suffix: string): number | null =>
  suffix === '' ? FIRST_PRESET_ID : /^~p\d+$/.test(suffix) ? +suffix.slice(2) : null

// ── What a preset is, as a saved value ────────────────────────────────────────────────────────

export type Preset = {
  id: number // allocated once, from `nextId`, and NEVER reused — see normalizeRegistry
  name: string
  // ★ AN OLDER BUILD'S FIELD, CARRIED AND NOT USED. Builds up to v2.27.3 kept a preset's Amnesic
  // switch here, as a boolean, and live and staging share this registry — so such a build may be
  // reading and writing this field in another tab right now. This build keeps each preset's Amnesic
  // setting with the browsing session instead (store/sessionAmnesic) and NEVER CHANGES this field:
  // every registry write below passes each preset's value through as it was read, so nothing this
  // build does can switch an older tab's guest session off, or on. It is read in exactly one place
  // — store/sessionAmnesic's hand-over from an older build — and a new preset is given `false`,
  // which is what an older build's own new preset has.
  amnesic: boolean
}

// The app-GLOBAL "open in" pin: which preset a FRESH app open lands in.
//   'last'      → the preset that was active when the app last closed (the persisted `activeId` is
//                 used as-is).
//   <preset id> → always open in THAT preset, whatever was active last time.
// ★ A FRESH OPEN ONLY. A reload — a browser reload, the app's own update reload, the error card's
// Reload — is the same browsing session (store/browsingSession), and it stays on the preset the
// player was on (store/sessionPreset's record of it), whatever the pin says: a guest playing in an
// Amnesic preset must not be dropped into the pinned (permanent) one by a refresh.
// It lives HERE, on the registry, and not in useSettings, because useSettings is per-preset — a
// "which preset" preference cannot live inside a preset. It is NOT captured by Save Defaults
// (SavedDefaults carries settings, prefs and the Amnesic value — no registry field is in any of those), by
// construction rather than by an exclusion. The `merge` step below is what turns a pin into the
// hydrated `activeId`, so index.html's boot script and every per-preset store agree on the active
// preset from the first frame with no switch and no theme flash — index.html duplicates that one
// resolution (it runs before any module) and tests/bootTheme.dom pins the two together.
export type OpenInPreset = number | 'last'

export type PresetRegistryValues = {
  // ★ ORDER IS THE ARRAY ORDER. A separate `order` field was rejected on sight: it would be a
  // second source of truth for one fact, and the failure it invites (two presets claiming order 2)
  // has no correct resolution.
  presets: Preset[]
  // The preset the app is on. ⚠ AS A SAVED VALUE it answers one question only — "which preset was
  // active LAST", for a fresh open with no pin. The preset a RELOAD lands in is the session's own
  // record (store/sessionPreset), which every change of this value keeps current.
  activeId: number
  // The next id to hand out. Monotonic, never decremented, never reused — the delete-preset-1 case
  // depends on it (see presetControl's deletePreset).
  nextId: number
  // The "open in" pin — see OpenInPreset above. Default 'last'.
  openInPreset: OpenInPreset
}

// ── A stock name, and its two short forms ─────────────────────────────────────────────────────
// A new preset is named "Preset <its number>", and so is one whose name is emptied. A STOCK NAME is
// any name that reads exactly that way — the word, one space, a whole number written the ordinary
// way — whoever typed it, and for whichever preset: a name the player typed that reads "Preset 3"
// is one. Where a stock name would be cut short it is DRAWN in a shorter form — "P3", and where
// even that would be cut, the bare number "3" — and drawn in full again the moment there is room
// (components/PresetSwitcher has the rule, lib/presetNameWidth's stockNameForm the decision).
// ★ DRAWN ONLY: what is stored is never a short form, and nothing here changes a name.
// The default, the test for one, and both short forms are all built from the one word and the one
// pattern below, so they cannot come to disagree about what a stock name looks like.
const STOCK_NAME_WORD = 'Preset'
const STOCK_NAME = new RegExp(`^${STOCK_NAME_WORD} ([1-9][0-9]*)$`)
export const defaultPresetName = (id: number): string => `${STOCK_NAME_WORD} ${id}`
/** The number of a stock name ("Preset 12" → "12") — or null for a name that is not one. */
export const stockNumber = (name: string): string | null => STOCK_NAME.exec(name)?.[1] ?? null
/** The short form of a stock name ("Preset 12" → "P12") — or null for a name that is not one. */
export const shortStockName = (name: string): string | null => {
  const number = stockNumber(name)
  return number && `${STOCK_NAME_WORD[0]}${number}`
}

// ── A copy's name ─────────────────────────────────────────────────────────────────────────────
// What Duplicate Preset (store/presetControl's duplicatePreset) names a copy: the original's name
// and " (2)" — and a name that already ends in " (<number>)" counts on from that number instead,
// so a copy of "Speed (2)" is "Speed (3)", not "Speed (2) (2)". Either way it takes the first number
// from there that no preset in `taken` is already called, so a copy of "Speed" beside "Speed (2)"
// is "Speed (3)". (Names may repeat — nothing depends on their differing — but a copy that read the
// same as a preset already in the list would be no help to anyone.)
// ★ ONLY THE END OF A NAME IS READ, so a pasted book costs no more than a word; and the number is
// counted as a BigInt, so a name ending in a number too big for an ordinary one still counts on
// by exactly one.
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const open = name.lastIndexOf(' (')
  const digits = name.endsWith(')') && open >= 0 ? name.slice(open + 2, -1) : ''
  const counted = /^[1-9][0-9]*$/.test(digits)
  const base = counted ? name.slice(0, open) : name
  let n = counted ? BigInt(digits) + 1n : 2n
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

// Fresh defaults via a FACTORY (the same reasoning as makeProgressDefaults): the nested array must
// be a new one each call, so nothing can alias the registry's list into a reset.
//
// ★ THIS IS ALSO THE "MATERIALISE ON A DEVICE THAT HAS NEVER SEEN PRESETS" ANSWER, and it is a
// no-op by construction: the default registry is exactly one preset, id 1, active. Preset 1's keys
// ARE the existing keys, so nothing is copied, nothing is written, and nothing is touched. Such a
// device does not even gain a `cg-presets-v1` entry — persist only writes on a set, and hydrating
// from an absent payload is not a set. The first write happens when the player creates a second
// preset, which is the first moment the registry says anything a default could not.
// ⚠ `amnesic: false` is the older builds' field (see Preset above), spelled the way such a build
// spells a preset whose data is PERMANENT — which is what the existing data is.
export const makePresetRegistryDefaults = (): PresetRegistryValues => ({
  presets: [{ id: FIRST_PRESET_ID, name: defaultPresetName(FIRST_PRESET_ID), amnesic: false }],
  activeId: FIRST_PRESET_ID,
  nextId: FIRST_PRESET_ID + 1,
  // 'last' is the behaviour every build before round 21 had: use the persisted activeId as-is.
  openInPreset: 'last',
})

// ── A name with nothing in it to see ──────────────────────────────────────────────────────────
// A name is EMPTY when nothing in it would be drawn: a preset named with a zero-width space showed
// as a blank pill and a blank row. TWO QUESTIONS DECIDE IT, in this order, and both are asked here
// (normalizePresetName, below) and nowhere else.
//
// ★ FIRST, THE UNICODE RULE. The pattern below finds one VISIBLE character, which is any character
// that is none of these:
//   • White_Space — every kind of space, tab, and line break — EXCEPT the Ogham space mark
//     (U+1680). Unicode counts it as a space, and it is drawn: it is the stroke an Ogham text is
//     written along. It is the one "space" with something to see, so it is a visible character
//     here, and it is not trimmed from the ends of a name either (outerSpacesTrimmed, below);
//   • Default_Ignorable_Code_Point — Unicode's own list of the characters a display leaves out when
//     it does nothing else with them: the zero-width space, joiner, and non-joiner, the word joiner,
//     the byte-order mark, the soft hyphen, the direction marks and overrides, the variation
//     selectors, the tag characters, and the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0);
//   • Cc — the control characters;
//   • U+2800, the Braille pattern with no dots raised. It is a symbol to Unicode and in none of the
//     three sets above, and it is drawn as an empty cell: the one blank character named by hand,
//     so that the rule alone — which is all there is where nothing can be drawn — still knows it.
// The first three are read from the Unicode tables the browser carries, so they are never a list
// kept here, and they grow with the browser.
// ⚠ NOT "Cf", the format characters as a whole: that category also holds the Arabic number sign and
// its like (U+0600–U+0605, U+06DD, U+070F, U+08E2), which ARE drawn. The format characters that draw
// nothing are in Default_Ignorable_Code_Point already.
//
// ★ THEN, THE INK CHECK — for a name the rule calls visible: drawn in the app's own font on THIS
// device, does it put a single pixel on the screen (lib/presetNameInk)? No table can say that of
// every character: the object replacement character (U+FFFC), the interlinear annotation marks
// (U+FFF9–U+FFFB), a private-use character, or a code point nothing is assigned to yet is drawn as
// whatever the device's fonts make of it — often nothing. So the device is asked, by drawing.
//   • A CHARACTER THE DEVICE HAS NO PICTURE FOR IS DRAWN AS A BOX, and a box is something to see:
//     such a name is kept. Only a device that draws a name as nothing at all calls it empty.
//   • WHERE NOTHING CAN BE DRAWN (no canvas — the test suite's jsdom; or the app's font not yet
//     ready to draw, which lib/presetNameInk checks before it draws), the rule above answers alone,
//     and a name it calls visible is kept: a blank name kept is a blank row, a real name thrown
//     away is the player's text lost.
//   • IT IS THE DEVICE'S ANSWER, AND ONLY EVER FOR WHAT THIS DEVICE SHOWS. Two devices can judge one
//     name differently (fonts differ). A name is judged as it is saved and as it is read, and a
//     name read as empty is shown as the default name WITHOUT the device being rewritten for it
//     (normalizePresetName says how that goes) — so the stored text is never changed on the say-so
//     of the device that happened to read it.
//
// ⚠ ONLY THE WHOLE NAME IS JUDGED. An invisible character inside a name that has something to see
// is left exactly where it is — it is what joins a family emoji, spells a flag, and shapes some
// scripts — so nothing is ever taken out of a name.
const VISIBLE_CHARACTER = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}⠀]|\u1680/u
const hasVisibleCharacter = (text: string): boolean => VISIBLE_CHARACTER.test(text)
// The spaces trimmed from the two ends of a name: what `String.prototype.trim` takes (every
// White_Space character, and the byte-order mark) less the Ogham space mark, which is drawn.
const OUTER_SPACE = /[\p{White_Space}\uFEFF]/u
const isOuterSpace = (unit: string): boolean => unit !== '\u1680' && OUTER_SPACE.test(unit)
// ★ ONE PASS FROM EACH END, AND NOTHING IN BETWEEN IS LOOKED AT — a name can be a book, and a
// pattern anchored to the end of one would go back over every run of spaces inside it. (Every
// character concerned is a single unit, so stepping by unit never lands inside an emoji.)
const outerSpacesTrimmed = (name: string): string => {
  let start = 0
  let end = name.length
  while (start < end && isOuterSpace(name[start])) start++
  while (end > start && isOuterSpace(name[end - 1])) end--
  return name.slice(start, end)
}

// A name, made safe to store: its outer spaces trimmed, and never empty — one that is empty, has
// nothing in it to see (the two questions above), or is not text at all becomes the default name
// for its preset.
// ★ THIS IS THE ONE PLACE THAT DECIDES A NAME IS EMPTY. A rename, a new preset, the note under the
// rename field, a registry read from the device, and therefore the stock-name test that decides how
// a name is drawn (shortStockName, which only ever sees names that came through here) all ask it,
// so they cannot disagree. A name with nothing to see that an older build — or another device —
// saved is therefore SHOWN as the default name, and the device is not rewritten for it: reading
// writes nothing, and the name goes to the device as the default one with the next change to the
// preset list — exactly what has always happened to a stored name of spaces.
// ★ THERE IS NO LENGTH LIMIT, AND NOTHING HERE CUTS A NAME. A name is whatever the player typed or
// pasted, a whole book included; the places that show it shorten what they DRAW (lib/presetNameText,
// and the ellipsis in components/PresetSwitcher), never what is stored. So no part of a name is
// ever sliced off by the unit a string is counted in — which is the only way half an emoji was
// ever made. Two presets may share a name; nothing depends on names being different (a preset is
// its id).
export const normalizePresetName = (name: string, id: number): string => {
  const trimmed = typeof name === 'string' ? outerSpacesTrimmed(name) : ''
  const seen = hasVisibleCharacter(trimmed) && nameHasInk(trimmed, hasVisibleCharacter) !== false
  return seen ? trimmed : defaultPresetName(id)
}

// ★ THE REGISTRY IS READ FROM UNTRUSTED STORAGE, exactly as store/lookupHistory's own list is, and
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
    // ⚠ `=== true` is the older builds' own reading of their field (see Preset above), kept exactly:
    // this build only carries the value, and it must hand back the boolean such a build would have
    // made of what is stored — never a value that build would read differently.
    .map((p) => ({
      id: p.id,
      name: normalizePresetName(p.name, p.id),
      amnesic: p.amnesic === true,
    }))
  // There is always at least one preset. "Zero presets" is not a state the app can render, and it
  // is not a state a player can reach either (deletePreset refuses the last one) — so a payload
  // claiming it is corrupt, and the honest recovery is the default registry, which points straight
  // back at the un-namespaced keys where the player's original data still is.
  if (!presets.length) return makePresetRegistryDefaults()
  const activeId = presets.some((p) => p.id === raw?.activeId) ? raw!.activeId! : presets[0].id
  // The "open in" pin, screened the same way everything else here is: 'last' passes; a preset id
  // passes only while that preset still exists; anything else (a deleted id, a string, a tampered
  // value, or the absent key of a payload from before the pin existed) collapses to 'last'. So a pin whose preset was
  // deleted since it was set self-heals to 'last' on the next hydrate — the mid-session deletePreset
  // also clears it eagerly, but this is the backstop that does not depend on that path running.
  const rawPin = raw?.openInPreset
  const openInPreset: OpenInPreset =
    rawPin === 'last'
      ? 'last'
      : Number.isInteger(rawPin) && presets.some((p) => p.id === rawPin)
        ? (rawPin as number)
        : 'last'
  // ⚠ nextId is forced ABOVE every id in the list, whatever the payload claimed. This is the line
  // that makes "ids are never reused" true even after tampering or a truncated write — and the
  // delete-preset-1 case rests on it: once slot 1 is vacated its un-namespaced keys must never be
  // handed to a different preset.
  const maxId = presets.reduce((m, p) => (p.id > m ? p.id : m), FIRST_PRESET_ID)
  const claimed = Number.isInteger(raw?.nextId) ? (raw!.nextId as number) : 0
  return { presets, activeId, nextId: Math.max(claimed, maxId + 1), openInPreset }
}

// Resolve a normalized registry's ACTIVE preset for this page load. One preset is ASKED FOR, and it
// is the answer when it names a preset that still exists:
//   • on a FRESH open, the "open in" pin ('last', or a pin normalizeRegistry already collapsed to
//     'last', asks for nothing);
//   • on a RELOAD (`freshOpen` false), the preset this session is on (`sessionPreset` —
//     store/sessionPreset's record; null when the session holds none, which is a session an older
//     build started). The pin is not consulted: a reload stays where the player was.
// Otherwise the persisted `activeId` — the preset that was active last. Pure and total, so
// index.html's boot script can mirror it in three lines and the store's `merge` can apply it once at
// hydrate.
export const resolveActiveId = (
  reg: PresetRegistryValues,
  freshOpen: boolean,
  sessionPreset: number | null,
): number => {
  const asked = freshOpen ? reg.openInPreset : sessionPreset
  return typeof asked === 'number' && reg.presets.some((p) => p.id === asked) ? asked : reg.activeId
}

/**
 * The registry AS IT IS ON DISK at this instant — normalized, or null when there is nothing
 * readable there (never saved, a corrupt payload, or a browser that refuses storage).
 *
 * ⚠⚠ IT IS NOT A SECOND SOURCE OF TRUTH AND NO RENDER MAY READ IT. The live registry above is what
 * the app runs on; this reads the same key BEHIND it. It exists for exactly one question, which the
 * in-memory copy cannot answer: has ANOTHER TAB on this origin allocated a preset id since this tab
 * last hydrated? The whole argument is at presetControl's createPreset, which is its only caller —
 * and the reason it must be a fresh READ rather than `usePresets.persist.rehydrate()` is that
 * rehydrating would ADOPT the other tab's registry wholesale, moving the active preset out from
 * under a player mid-run. An id allocation needs one number, not a new reality.
 */
export function readStoredRegistry(): PresetRegistryValues | null {
  try {
    // Through the storage door: a registry save the device refused is held there, and it is what
    // this place would hold had it fit — a preset this page has just made is in it.
    const raw = readItem(window.localStorage, PRESET_REGISTRY_KEY)
    if (raw === null) return null
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object') return null
    const state = (envelope as { state?: unknown }).state
    if (!state || typeof state !== 'object') return null
    // The same unconditional screen the live store's `merge` runs, for the same reason: this is
    // untrusted storage, and normalizeRegistry is what forces nextId above every listed id.
    return normalizeRegistry(state as Partial<PresetRegistryValues>)
  } catch {
    return null
  }
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
  // ⚠⚠ NOT FOR APP CODE. Replaces the whole registry value (all of it but the older builds'
  // `amnesic` field, which it carries — see the store below). Its callers are store/presetControl —
  // which pairs every call with the storage work the change implies — and the test suite. Reaching
  // for it from a component is the 500-cards-becomes-4 bug with extra steps.
  // ⚠ IT IS OBSERVED. src/main.tsx subscribes to this store and remounts the five always-mounted
  // mode screens whenever this call changes `activeId`, synchronously, inside the set below. That is
  // what makes the remount a consequence of the switch rather than a duty of whoever called it —
  // so a future operation that moves the active preset is covered without doing anything.
  applyRegistry: (next: PresetRegistryValues) => void
}

const PERSISTED_KEYS = Object.keys(makePresetRegistryDefaults()) as (keyof PresetRegistryValues)[]
// The part of the registry that is saved: its four values, without the store's own function.
const savedPart = (state: PresetRegistryValues): PresetRegistryValues =>
  Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as PresetRegistryValues
// ★ EACH PRESET'S `amnesic` IS TAKEN FROM THE DEVICE AT THE MOMENT OF THE WRITE, not from this
// page's memory. It is an older build's field (see Preset above), and such a build in another tab
// may have changed it since this page loaded — a guest's session switched on there. Writing back
// the value this page happened to read would switch that session off at the older tab's next
// reload, so every write carries what is stored NOW; a preset the device does not list yet keeps
// the value it was handed.
const withStoredAmnesic = (next: PresetRegistryValues): PresetRegistryValues => {
  const stored = new Map(readStoredRegistry()?.presets.map((p) => [p.id, p.amnesic]))
  return {
    ...next,
    presets: next.presets.map((p) => {
      const amnesic = stored.get(p.id) ?? p.amnesic
      return amnesic === p.amnesic ? p : { ...p, amnesic }
    }),
  }
}

export const usePresets = create<PresetRegistryState>()(
  persist(
    (set) => ({
      ...makePresetRegistryDefaults(),
      applyRegistry: (next) => {
        // The session's own record of the preset it is on moves with every change of it, and
        // FIRST: it is what a reload reads, and it must not depend on the permanent write below
        // landing (store/sessionPreset).
        recordSessionPreset(next.activeId)
        set(() => withStoredAmnesic(next))
      },
    }),
    {
      // ⚠ The default storage, NOT the scoped adapter below. The registry says which preset you are
      // on; scoping it to a preset would make that question unanswerable.
      name: PRESET_REGISTRY_KEY,
      // zustand's default localStorage, behind store/storageHealth: a refused save must never throw
      // out of applyRegistry, and is held for this key until it fits.
      storage: createJSONStorage(guardedStorage(() => window.localStorage)),
      version: REGISTRY_VERSION,
      partialize: (state) => savedPart(state),
      // No `migrate` yet — v1 is the first shape there has ever been, so there is no older payload
      // in existence to rewrite. `openInPreset` (round 21) is additive: normalizeRegistry turns
      // its absent key into 'last', which is the behaviour before the pin existed, so no migrate step is owed. The
      // version field is here so that a future shape change HAS a gate to hang off; the
      // unconditional screen below is what guards the go-forward path, and it is the one that runs
      // on every load at every version.
      // ★ THE PRESET THIS LOAD OPENS IN IS DECIDED HERE, once, at hydrate (resolveActiveId above). On
      // a FRESH open (the browsing-session marker is absent; it is set by App's boot effect, after
      // this) `activeId` becomes the pinned preset when one is set and still exists, else the
      // persisted `activeId`. On a reload the marker is there, and it is the preset the session has
      // on record. Doing it in `merge`
      // rather than in an App effect is what keeps index.html's boot script — which paints the
      // active preset's theme before any module loads and resolves the pin the same way — and
      // every per-preset store's own hydration agreeing on the active preset from the first frame,
      // with no post-mount switchPreset and no theme flash.
      // ⚠ A pin that MOVED the active preset is only in memory after this (hydration writes
      // nothing). App's boot effect puts it on the SESSION's record (store/presetControl's
      // commitSessionPreset), so the reload that follows finds the preset this open landed in —
      // and nothing permanent is written for it.
      merge: (persisted, current) => {
        const norm = normalizeRegistry(persisted as Partial<PresetRegistryValues> | undefined)
        return {
          ...current,
          ...norm,
          activeId: resolveActiveId(norm, !browsingSessionOpen(), sessionPresetId()),
        }
      },
    },
  ),
)

/**
 * Apply `next` — BUT ONLY IF THE DEVICE HAS ROOM TO SAVE IT. Returns false, with nothing changed
 * anywhere, when it does not.
 *
 * ★ FOR A CHANGE THAT CAN BE AS LARGE AS THE PLAYER LIKES: A PRESET'S NAME. A name has no length
 * limit, so a pasted book can be more than the device will ever hold. An ordinary registry write
 * the device refuses is HELD (store/storageHealth) — the app runs on with it, tells the player the
 * device is full, and saves it when room is made. That is right for a change that must not be lost
 * and will fit once something is cleared. It is wrong for this one: a name too big to save can
 * never be saved, so it would be held for ever — and every later registry change (a new preset, a
 * switch, "Open in") rides in that same save and would go unsaved with it. A refused save also
 * teaches the app that the device is FULL at what it holds, which is untrue of a nearly empty
 * device that has just turned down one enormous value.
 * So the save is TRIED first, on its own (tryWriteItem: nothing held, no notice, nothing learned).
 * A browser stores a value whole or not at all, so a refusal leaves the registry on the device
 * exactly as it was. Only when it has landed is the change applied — which saves the same text a
 * second time, through the store's own door, and settles anything that was being held.
 * ⚠ THE TEXT TRIED IS THE TEXT THE STORE THEN SAVES — the same values, in the same order, under the
 * same stamp — so what was seen to fit is what is written. tests/presets.dom pins the two together.
 */
export function applyRegistryIfRoom(next: PresetRegistryValues): boolean {
  // ⚠ ONLY "THE BROWSER GIVES THE APP NO STORAGE" IS PASSED OVER, and only where it shows itself:
  // such a browser throws on the very mention of `localStorage`. The registry lives in memory
  // there (the store took the same path as it loaded), so there is no room to run out of and the
  // change is simply applied. Nothing else is caught: the device refusing for ROOM is
  // tryWriteItem's `false`, and any other failure while saving is a fault that must surface —
  // exactly as it does out of applyRegistry for every other change to the preset list.
  let device: Storage | null = null
  try {
    device = window.localStorage
  } catch {
    /* no storage at all */
  }
  if (device) {
    const saved = JSON.stringify({
      state: savedPart(withStoredAmnesic(next)),
      version: REGISTRY_VERSION,
    })
    if (!tryWriteItem(device, PRESET_REGISTRY_KEY, saved)) return false
  }
  usePresets.getState().applyRegistry(next)
  return true
}

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
// registry below and remounts the five always-mounted mode screens whenever `activeId` changes: those
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
      // Through store/storageHealth, all three: a save the device refuses becomes the storage-full
      // notice instead of a throw out of the store's setter, and is held for THIS preset's key — so
      // a read of that key (the switch back to this preset) returns it, and its retry can only ever
      // land here.
      getItem: (name) => readItem(ls, scoped(name)),
      setItem: (name, value) => writeItem(ls, scoped(name), value),
      removeItem: (name) => removeItem(ls, scoped(name)),
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
// ⚠ The persisted half is spread LAST and unscreened, exactly as before — any store that still
// needs to validate untrusted entries on every load (store/lookupHistory's own normalisation) owns
// that screen itself, in its own `merge`, rather than this shared helper trying to know about it.
export const mergeOverDefaults =
  <V extends object, S>(makeDefaults: () => V) =>
  (persisted: unknown, current: S): S =>
    ({ ...current, ...makeDefaults(), ...(persisted as Partial<S>) }) as S
