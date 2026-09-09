// WHERE THE APP'S SAVED DATA LIVES — asked as a QUESTION, never written down as a key.
//
// WHY THIS FILE EXISTS, and it is the same play tests/helpers/settingsPanel.jsx and
// tests/helpers/guideScroller.jsx made before it. Settings PRESETS are coming: several independent
// copies of the app's data on one device, each with its own stats, settings, bests, mode setup and
// theme. Preset 1 IS today's data — its stores keep the localStorage keys they already have — and
// only presets 2, 3, 4… get namespaced ones. So the change about to land is precisely a change to
// WHERE a store reads and writes, and the gate on it is falsifiable and absolute: THE BEHAVIOUR NET
// PASSES WITH ZERO EDITS. A test that had to be edited on the far side of the move would prove
// nothing about the move — only that somebody made it green again.
//
// ★ THE WHOLE TRICK IS THAT NO TEST MAY NAME A KEY. A case that says 'cg-progress-v1' is asserting
// the one implementation detail the change exists to alter, and pinning it would defeat the point
// twice over: it breaks on the change, and while it stands it tempts a reader into believing the
// key IS the contract. The contract is "what you saved is still there when you come back". This
// file is the only place allowed to know how that is spelled, and it works it out by OBSERVATION
// rather than by holding a copy of the constant — see storageKeyFor.
//
// ⚠ THE RULE FOR THIS FILE IS THAT IT MAY CHANGE AND NOTHING ELSE MAY. If the preset work breaks a
// resolution here, fix it HERE.
//
// ⚠ WHAT THIS FILE IS NOT. It is not a place to reach past the app and hand-write a payload for
// convenience. Two seeding helpers exist (seedSaved / seedSavedRaw) and both are for one purpose
// only: standing up a payload that a PREVIOUS RELEASE would have written, which no live API can
// produce any more. Everything else goes through the app's own setters, because a value the app
// never wrote is not evidence about what the app saves.
import { vi } from 'vitest'
import { useSettings } from '../../src/store/settings.js'
import { useModePrefs } from '../../src/store/modePrefs.js'
import { useProgress } from '../../src/store/progress.js'
import { useUserDefaults } from '../../src/store/userDefaults.js'

// ── The four stores, under the names a PLAYER would recognise the data by ─────────────────────
//
// Not "the four zustand stores": the ids below are the four kinds of thing a preset owns, and the
// preset work is free to move any of them into a different store without this file changing. The
// live module singletons — the same instances <App/> uses, which is what lets a case drive the UI
// and then ask this file what reached storage.
export const LIVE_STORES = {
  settings: useSettings, // the ⚙ panel's values, theme included
  modePrefs: useModePrefs, // the per-mode setup that lives ON each mode's screen
  progress: useProgress, // lifetime stats, all-time bests
  userDefaults: useUserDefaults, // the player's saved personal defaults
}
// ⚠ LOOKUP HISTORY IS DELIBERATELY NOT A FIFTH ENTRY HERE (Q1, round 20). It used to live inside
// `progress`, but it is not one of "the four kinds of thing a preset owns" any more — it moved to
// its own store/lookupHistory precisely because it is SHARED across every preset instead of being
// swapped per preset, which is the one fact this whole file's net (and the preset-switch/delete
// contracts built on it) exists to exercise. It joins the build stamp and the two changelog flags
// tests/persistence.dom.test.jsx's own header already names as "WHAT IS DELIBERATELY NOT HERE":
// GLOBAL, not a preset's, and owned by its own test file (tests/lookupHistory.dom) rather than by
// this one.
export const STORE_IDS = Object.keys(LIVE_STORES)

// ── Where a store reads and writes, resolved BY OBSERVATION ───────────────────────────────────
//
// ★ THIS IS THE INDIRECTION THE WHOLE GROUP RESTS ON. The obvious implementation is to import the
// key constants and hand them out. It was rejected: those constants are exactly what the preset
// work replaces, so a helper built on them would go stale in the same commit as the tests it was
// meant to insulate — the indirection would be a layer of misdirection instead.
//
// So the question is answered the way a debugger would answer it: empty the storage, make the store
// flush itself, and look at what appeared. That resolution holds under EVERY namespacing scheme the
// preset work might choose — a dynamic `name`, a prefixing storage adapter, a per-preset storage
// object — because it never assumes how the key is composed, only that writing produces one.
//
// ⚠ NON-DESTRUCTIVE BY CONSTRUCTION, and it has to be: cases call this mid-test with real saved
// data in storage. The full contents are snapshotted and restored byte for byte in a `finally`, and
// the flush writes the store's CURRENT state, so the payload put back is the payload that was
// there. Nothing observable changes.
//
// ⚠ `setState({})` is the flush, and an empty partial is deliberate — zustand merges it, so no
// value moves, while persist's wrapped setState still writes the whole partialized payload. It does
// notify subscribers (v5 builds a new state object for any partial), so with <App/> mounted call it
// inside act() — every helper below that needs a key does its resolving before touching the DOM.
export function storageKeyFor(store) {
  const snapshot = snapshotStorage()
  try {
    localStorage.clear()
    store.setState({})
    const keys = Object.keys(localStorage)
    if (keys.length !== 1)
      throw new Error(
        `storageKeyFor: expected the store to write exactly one place, it wrote ${keys.length} (${keys.join(', ')})`,
      )
    return keys[0]
  } finally {
    restoreStorage(snapshot)
  }
}

// Every place the four stores write, right now. The answer to "did this reset clear exactly what it
// clears" — and, once presets land, to "did switching preset move ALL of it".
export const storageKeys = (stores = LIVE_STORES) =>
  Object.fromEntries(Object.entries(stores).map(([id, store]) => [id, storageKeyFor(store)]))

// ── Reading and seeding what is SAVED ─────────────────────────────────────────────────────────

// The envelope currently on disk for a store, or null when nothing is saved. `.state` is the saved
// values; `.version` is the shape stamp the migration path reads.
export function readSaved(store) {
  const raw = localStorage.getItem(storageKeyFor(store))
  return raw === null ? null : JSON.parse(raw)
}

// The saved VALUES alone — the common case, and it says `null` rather than throwing when nothing
// has been written, because "nothing is saved yet" is a state the app has to survive.
export const readSavedState = (store) => readSaved(store)?.state ?? null

// Put an envelope on disk as if a previous release had written it. ONLY for shapes no live API can
// still produce — an older `version`, or fields since dropped. See the file header.
export function seedSaved(store, state, version) {
  localStorage.setItem(storageKeyFor(store), JSON.stringify({ state, version }))
}

// The same, for a payload that is not valid JSON at all (truncation, tampering, a half-written
// quota failure) — which is the case JSON.stringify cannot express.
export function seedSavedRaw(store, raw) {
  localStorage.setItem(storageKeyFor(store), raw)
}

// Wipe one store's saved copy WITHOUT touching its live state — "this device has never saved
// anything", which is not the same as a reset (a reset writes defaults over the top).
export function clearSaved(store) {
  localStorage.removeItem(storageKeyFor(store))
}

// ── Coming back later ─────────────────────────────────────────────────────────────────────────
//
// TWO RELOADS, because they answer different questions and only one of them is the real one.
//
// reopenApp() is the real one: the module registry is dropped and the store modules are imported
// again, so `create(persist(...))` runs afresh and hydrates from whatever is in storage — a genuine
// cold start, the closest jsdom gets to closing the tab and opening it again. It is what proves a
// value REACHED storage, because the store it returns has never held that value in memory.
// ⚠ THE STORES IT RETURNS ARE NOT THE ONES <App/> HOLDS. A statically-imported App keeps the
// original singletons for the life of the file, so a case that mounts App must not judge it by
// these. Use it for store-level cases and read the handles it returns.
export async function reopenApp() {
  vi.resetModules()
  const [settings, modePrefs, progress, userDefaults] = await Promise.all([
    import('../../src/store/settings.js'),
    import('../../src/store/modePrefs.js'),
    import('../../src/store/progress.js'),
    import('../../src/store/userDefaults.js'),
  ])
  return {
    settings: settings.useSettings,
    modePrefs: modePrefs.useModePrefs,
    progress: progress.useProgress,
    userDefaults: userDefaults.useUserDefaults,
  }
}

// rehydrate() is the reload a MOUNTED app can take: the live singleton re-reads storage in place,
// running the same migrate + merge path a cold start runs. Weaker evidence than reopenApp — the
// store already holds the values, so a merge that silently kept them would pass — so pair it with a
// deliberate in-memory divergence when the claim is about what was WRITTEN, and prefer reopenApp
// wherever no component is mounted.
export const rehydrate = (store) => store.persist.rehydrate()

// ── Storage that refuses ──────────────────────────────────────────────────────────────────────
//
// PRIVACY MODE, in the shape the app actually meets it: touching `localStorage` throws outright.
// That is the browser behaviour zustand's persist explicitly degrades for, and the shape every
// try/catch in src/lib/buildStamp and src/changelog was written against.
//
// ⚠ IT MUST BE INSTALLED BEFORE THE MODULE GRAPH LOADS to be meaningful. persist resolves its
// storage adapter once, when the store is created, so a block installed after the store exists is a
// block the store never sees. Pair it with reopenApp() inside the block, which is the ordering a
// real private-mode launch has.
export function blockStorage() {
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  })
  return () => {
    if (own) Object.defineProperty(window, 'localStorage', own)
    else delete window.localStorage
  }
}

// ── The snapshot/restore pair storageKeyFor is built on ───────────────────────────────────────
// Exported because a case that installs a legacy payload and then wants the storage back exactly as
// it was needs the same two functions, and a second hand-rolled copy would be one drift away from
// silently restoring something else.
export function snapshotStorage() {
  const out = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    out.push([key, localStorage.getItem(key)])
  }
  return out
}

export function restoreStorage(snapshot) {
  localStorage.clear()
  for (const [key, value] of snapshot) localStorage.setItem(key, value)
}
