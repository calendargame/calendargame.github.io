import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'

// store/storageHealth.ts — A SAVE THE DEVICE REFUSES IS NEVER SILENT, AND NEVER GOES ANYWHERE ELSE.
//
// WHY IT EXISTS. Every solve time is kept (store/progress), so the saved data grows with play, and a
// browser gives each site a fixed allowance (~5 MB in Chromium and Safari, shared by every preset).
// When a save does not fit, localStorage.setItem throws a QuotaExceededError — and zustand's persist
// does NOT catch it: the throw came straight out of the store's setter. For the stats that setter
// runs in a mode screen's effect, so a full device did not "stop saving quietly", it put the player
// on the error card on their next answer.
//
// ★ WHAT HAPPENS INSTEAD — the whole mechanism. Every saved value of every persisted store is read,
// written and removed through the three functions below, and a write the device refuses is caught
// and HELD IN MEMORY UNDER THE EXACT PLACE IT WAS FOR: this storage area, this key. From then on:
//   • a READ of that place returns the held value — it is what that place would hold if it had fit.
//     So anything that re-reads saved data inside this page (a preset switch and the switch back, an
//     Amnesic toggle, "is this preset factory-fresh?") sees the player's newest answers, not the
//     older copy on the device;
//   • the next write that DOES fit (or the app itself freeing space — a preset deleted) retries
//     every held value, each to its own place and nowhere else;
//   • REMOVING a place forgets what was held for it: a deleted preset's keys, a guest session being
//     thrown away. A held value can never bring back something the player deleted;
//   • ANOTHER TAB changing a place forgets what was held for it too (placeChangedElsewhere): the
//     held value stands in for what that place would hold if the save had fit, and a save that had
//     fit would have been replaced by the other tab's later one;
//   • the first refusal of an episode opens components/StorageFullNotice, which tells the player
//     what happened and how to make room; it does not reopen on every answer while the device stays
//     full.
// ⚠ WHAT IS STILL LOST, and the notice has to say so: held values live in this page's memory, so
// CLOSING OR RELOADING the app while the device is still full loses them. The app holds its own
// reload for exactly that reason (src/main.tsx's applyUpdate); it cannot hold the player's.
//
// ★ WHY THE HELD VALUE IS KEYED BY ITS DESTINATION, AND NOT RE-MADE FROM THE STORE. The first design
// remembered only WHICH store had been refused and re-saved "what that store holds now" through the
// store's own adapter. That adapter writes to whichever preset is active AT THE MOMENT OF THE RETRY —
// and the retry ran inside the registry write of a preset switch, a preset delete and an Amnesic
// toggle, i.e. after the registry named the incoming preset and before the stores had reloaded. One
// preset's stats were written over another's, and a guest's session over the permanent copy. A value
// held under its own destination has no adapter to be redirected by: the retry is that string, to
// that key, in that area.
//
// ⚠ ONLY A QUOTA REFUSAL IS CAUGHT. Any other storage error is rethrown exactly as before: this file
// answers "the device is full", and swallowing a different failure here would hide it behind a
// notice that says something untrue about it.
// ⚠ live and staging share this origin and therefore this allowance — they read and write the SAME
// keys, so there is one copy of the data, not two; the notice's remedies act on exactly that copy.
// (The other site cannot see a value this page is holding; it sees it once it is saved.)

// Is this the browser saying "no room"? Chromium/Safari name it QuotaExceededError (legacy code 22);
// older Firefox used NS_ERROR_DOM_QUOTA_REACHED (code 1014).
export const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014)

export type StorageHealthState = {
  // Some saved value is being held in memory because its storage refused it.
  unsaved: boolean
  // The notice is up. Opened by the FIRST refusal of an episode (unsaved going false → true), and by
  // the app declining to reload over unsaved data (showStorageNotice); closed only by the player.
  noticeOpen: boolean
  dismissStorageNotice: () => void
}

export const useStorageHealth = create<StorageHealthState>()((set) => ({
  unsaved: false,
  noticeOpen: false,
  dismissStorageNotice: () => set({ noticeOpen: false }),
}))

/**
 * Put the notice back up — for the one caller that has to refuse something BECAUSE data is unsaved
 * (the app's own update reload) and owes the player the reason.
 */
export const showStorageNotice = (): void => useStorageHealth.setState({ noticeOpen: true })

// The refused saves: per storage area, the latest value each key was refused.
const held = new Map<Storage, Map<string, string>>()

const settle = (): void => {
  const unsaved = held.size > 0
  const state = useStorageHealth.getState()
  if (unsaved === state.unsaved) return
  // false → true is a new episode, and a new episode is a new notice.
  useStorageHealth.setState(unsaved ? { unsaved, noticeOpen: true } : { unsaved })
}

const hold = (storage: Storage, key: string, value: string): void => {
  let area = held.get(storage)
  if (!area) held.set(storage, (area = new Map()))
  area.set(key, value)
}

const release = (storage: Storage, key: string): void => {
  const area = held.get(storage)
  if (!area) return
  area.delete(key)
  if (area.size === 0) held.delete(storage)
}

// Try every held value again, each to the place it was refused from. One that still does not fit
// stays held.
const retryHeld = (): void => {
  for (const [storage, area] of [...held])
    for (const [key, value] of [...area]) {
      try {
        storage.setItem(key, value)
      } catch (e) {
        if (!isQuotaError(e)) throw e
        continue
      }
      release(storage, key)
    }
}

/** Save `value` at (storage, key) — or, if the device refuses it, hold it for that place. */
export function writeItem(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch (e) {
    if (!isQuotaError(e)) throw e
    hold(storage, key, value)
    settle()
    return
  }
  release(storage, key)
  retryHeld() // a write just fit, so there may be room for the others now
  settle()
}

/** What (storage, key) holds — the value held for it when its last save was refused. */
export function readItem(storage: Storage, key: string): string | null {
  return held.get(storage)?.get(key) ?? storage.getItem(key)
}

/** Remove (storage, key), and forget anything held for it. */
export function removeItem(storage: Storage, key: string): void {
  release(storage, key)
  storage.removeItem(key)
  settle()
}

/**
 * ★ ANOTHER TAB JUST CHANGED (storage, key) — or cleared the whole area (`key` null). Whatever this
 * page was holding for that place is forgotten.
 * WHY. A held value is this page's save, DELAYED: it goes out at the next retry, which can be long
 * after it was made. If another tab (or the other site on this origin — live and staging share
 * these keys) has saved to the same place in the meantime, the retry would put an OLDER save over a
 * newer one; if the other tab DELETED the place — a preset removed there — the retry would bring it
 * back. Neither can happen to a save that fit: it would simply have been replaced, or removed, by
 * what came after it. Dropping the held value makes a refused save behave exactly like that.
 * It does not make two open tabs agree with each other — each still plays on from what it loaded,
 * and its NEXT save is its own; that is the same last-save-wins as on a device with room.
 */
export function placeChangedElsewhere(storage: Storage, key: string | null): void {
  if (key === null) held.delete(storage)
  else release(storage, key)
  settle()
}
// The browser's own report of it: a `storage` event, which fires in every OTHER same-origin page when
// one changes localStorage (never in the page that made the change).
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.storageArea) placeChangedElsewhere(e.storageArea, e.key)
  })

/**
 * The app itself just FREED space (a preset's keys were removed) — save anything held now, rather
 * than waiting for the player's next change.
 */
export function storageSpaceFreed(): void {
  retryHeld()
  settle()
}

/**
 * zustand's default storage (window.localStorage, opened eagerly exactly as createJSONStorage's own
 * default is, so a browser that throws on the property access still lands on persist's memory-only
 * path) behind the three functions above. For the persisted stores that are not preset-scoped.
 */
export const guardedStorage = (getStorage: () => Storage) => (): StateStorage => {
  const s = getStorage()
  return {
    getItem: (name) => readItem(s, name),
    setItem: (name, value) => writeItem(s, name, value),
    removeItem: (name) => removeItem(s, name),
  }
}

/**
 * Forget every refusal, i.e. "the app was closed". The app never needs this — a close throws the
 * held values away with the page and the next launch starts healthy — but the test harness has no
 * close, so tests/setup/dom.js calls it before every test (the same reason it forgets the browsing
 * session).
 */
export function forgetStorageHealth(): void {
  held.clear()
  useStorageHealth.setState({ unsaved: false, noticeOpen: false })
}
