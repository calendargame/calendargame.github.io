import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'

// store/storageHealth.ts — A SAVE THE DEVICE REFUSES IS NEVER SILENT (round 23 Q3).
//
// WHY IT EXISTS NOW. Every solve time is kept (store/progress), so the saved data grows with play,
// and a browser gives each site a fixed allowance (~5 MB in Chromium and Safari, shared by every
// preset). When a save does not fit, localStorage.setItem throws a QuotaExceededError — and zustand's
// persist does NOT catch it: the throw came straight out of the store's setter. For the stats that
// setter runs in a mode screen's effect, so a full device did not "stop saving quietly", it put the
// player on the error card on their next answer.
//
// ★ WHAT HAPPENS INSTEAD, the whole mechanism in four sentences. Every persisted store's writes go
// through guardedSetItem below. A quota refusal is caught there — the in-memory state, which the
// screen is showing, is untouched, so play simply goes on — and the store is remembered as UNSAVED.
// The first refusal of an episode opens components/StorageFullNotice, which tells the player what
// happened and how to make room; it does not reopen on every answer while the device stays full.
// The next save that SUCCEEDS (or the next time this app itself frees space) re-saves every
// unsaved store from what it holds now, so nothing the player did while full has to be redone.
//
// ⚠ ONLY A QUOTA REFUSAL IS CAUGHT. Any other storage error is rethrown exactly as before: this file
// answers "the device is full", and swallowing a different failure here would hide it behind a
// notice that says something untrue about it.
// ⚠ THE RE-SAVE WRITES EACH STORE'S *CURRENT* STATE THROUGH ITS OWN ADAPTER, never a remembered
// value under a remembered key. A remembered write would be the dangerous version: the preset it was
// for may since have been switched away from or DELETED, and replaying it would resurrect a deleted
// preset's key or write one preset's numbers into another's. A store's own flush can only ever
// write the active preset's copy of what that store holds right now.
// ⚠ live and staging share this origin and therefore this allowance — they read and write the SAME
// keys, so there is one copy of the data, not two; the notice's remedies act on exactly that copy.

// Is this the browser saying "no room"? Chromium/Safari name it QuotaExceededError (legacy code 22);
// older Firefox used NS_ERROR_DOM_QUOTA_REACHED (code 1014).
export const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014)

export type StorageHealthState = {
  // Some store holds state its storage refused — i.e. it lives in memory only until there is room.
  unsaved: boolean
  // The notice is up. Opened by the FIRST refusal of an episode (unsaved going false → true), closed
  // only by the player.
  noticeOpen: boolean
  dismissStorageNotice: () => void
}

export const useStorageHealth = create<StorageHealthState>()((set) => ({
  unsaved: false,
  noticeOpen: false,
  dismissStorageNotice: () => set({ noticeOpen: false }),
}))

// Each persisted store's flush, by its persist `name` — the one string every write of that store
// carries whichever preset it lands in. Registered by the store's own module (registerPersistFlush),
// because this file cannot import the stores: they import it.
const flushes = new Map<string, () => void>()
// The stores whose latest state a refusal left unsaved.
const unsavedNames = new Set<string>()
let retrying = false

/** Register how to re-save one persisted store from its current state (its persist `setState({})`). */
export function registerPersistFlush(name: string, flush: () => void): void {
  flushes.set(name, flush)
}

// Re-save every unsaved store, then settle `unsaved`. Each flush comes back through guardedSetItem,
// which drops the store from the set on success or keeps it on another refusal; `retrying` stops
// those nested calls from starting a second pass or settling the flag mid-pass.
function resaveUnsaved(): void {
  if (retrying) return
  retrying = true
  try {
    for (const name of [...unsavedNames]) flushes.get(name)?.()
  } finally {
    retrying = false
  }
  if (unsavedNames.size === 0 && useStorageHealth.getState().unsaved)
    useStorageHealth.setState({ unsaved: false })
}

/**
 * Perform one persisted store's write, turning a quota refusal into the unsaved state + notice
 * instead of a throw. `name` is the store's persist name.
 */
export function guardedSetItem(name: string, write: () => void): void {
  try {
    write()
  } catch (e) {
    if (!isQuotaError(e)) throw e
    unsavedNames.add(name)
    if (!useStorageHealth.getState().unsaved)
      useStorageHealth.setState({ unsaved: true, noticeOpen: true })
    return
  }
  unsavedNames.delete(name)
  resaveUnsaved() // a write just fit, so there may be room for the others now
}

/**
 * The app itself just FREED space (a preset's keys were removed) — re-save anything unsaved now,
 * rather than waiting for the player's next change.
 */
export const storageSpaceFreed = (): void => resaveUnsaved()

/**
 * zustand's default storage (window.localStorage, opened eagerly exactly as createJSONStorage's own
 * default is, so a browser that throws on the property access still lands on persist's memory-only
 * path) with its writes guarded. For the persisted stores that are not preset-scoped.
 */
export const guardedStorage = (getStorage: () => Storage) => (): StateStorage => {
  const s = getStorage()
  return {
    getItem: (name) => s.getItem(name),
    setItem: (name, value) => guardedSetItem(name, () => s.setItem(name, value)),
    removeItem: (name) => s.removeItem(name),
  }
}

/**
 * Forget every refusal, i.e. "the app was closed". The app never needs this — a close throws the
 * in-memory state away and the next launch starts healthy — but the test harness has no close, so
 * tests/setup/dom.js calls it before every test (the same reason it forgets the browsing session).
 */
export function forgetStorageHealth(): void {
  unsavedNames.clear()
  useStorageHealth.setState({ unsaved: false, noticeOpen: false })
}
