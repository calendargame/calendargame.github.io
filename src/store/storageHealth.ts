import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import { reportWritesTo } from '../changelog.js'

// store/storageHealth.ts — A SAVE THE DEVICE REFUSES IS NEVER SILENT, AND NEVER GOES ANYWHERE ELSE.
//
// WHY IT EXISTS. Every solve time is kept (store/progress), so the saved data grows with play, and a
// browser gives each site a fixed allowance (~5 MB in Chromium and Safari, shared by every preset).
// When a save does not fit, localStorage.setItem throws a QuotaExceededError — and zustand's persist
// does NOT catch it: the throw came straight out of the store's setter. For the stats that setter
// runs in a mode screen's effect, so a full device did not "stop saving quietly", it put the player
// on the error card on their next answer.
//
// ★ WHAT HAPPENS INSTEAD — the whole mechanism. THIS FILE IS THE DOOR TO localStorage: every saved
// value of every persisted store, and every marker a store file keeps beside them, is read, written
// and removed through the functions below. (ONE module writes for itself: src/changelog — its update
// dots and its seen-stamp, nothing a player made. It must stay free of imports, so it cannot call
// in here; it tells this file which key it has just touched instead, and that is reported like any
// other change — see "the one writer outside the door" below. tests/storageDoor pins that it is the
// only one, so nothing else in src/ can start writing around the door.) A write the device refuses
// is caught
// and HELD IN MEMORY UNDER THE EXACT PLACE IT WAS FOR: this storage area, this key. From then on:
//   • a READ of that place returns the held value — it is what that place would hold if it had fit.
//     So anything that re-reads saved data inside this page (a preset switch and the switch back,
//     "is this preset factory-fresh?") sees the player's newest answers, not the older copy on the
//     device;
//   • the next write that DOES fit (or the app itself freeing space — a preset deleted) retries
//     every held value, each to its own place and nowhere else;
//   • REMOVING a place forgets what was held for it: a deleted preset's keys. A held value can never
//     bring back something the player deleted;
//   • ANOTHER TAB changing a place forgets a plain value held for it (placeChangedElsewhere): the
//     held value stands in for what that place would hold if the save had fit, and a save that had
//     fit would have been replaced by the other tab's later one. A place the windows-in-sync door
//     holds — every saved doc of the app — is NOT forgotten: the door merges with the other tab's
//     change and keeps only its own un-landed actions on top of it (holdForDoor, below);
//   • the first refusal of an episode opens components/StorageFullNotice, which tells the player
//     what happened and how to make room; it does not reopen on every answer while the device stays
//     full.
// ⚠ WHAT IS STILL LOST, and the notice has to say so: held values live in this page's memory, so
// CLOSING OR RELOADING this window while the device is still full loses them. The app holds its own
// reload for exactly that reason (src/main.tsx's applyUpdate); it cannot hold the player's.
//
// ★ WHY THE HELD VALUE IS KEYED BY ITS DESTINATION, AND NOT RE-MADE FROM THE STORE. The first design
// remembered only WHICH store had been refused and re-saved "what that store holds now" through the
// store's own adapter. That adapter writes to whichever preset is active AT THE MOMENT OF THE RETRY —
// and the retry ran inside the registry write of a preset switch and a preset delete, i.e. after the
// incoming preset was named and before the stores had reloaded. One preset's stats were written over
// another's. A value
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

// ── What is ON THE DEVICE, reported as it changes ─────────────────────────────────────────────
// Because every write goes through this file, it can say exactly what each one did — which is how
// store/storageUsage keeps "how full is the device" right at the moment something is saved or
// removed, without reading everything back. The watcher is told AFTER the change is on the device:
// (storage, key, the text now there — null for a key that is gone). A refused write changes nothing
// and reports nothing through `changed`. `key` null means "this area changed in a way nobody listed"
// (another tab cleared it): count again.
// `refused` is the other thing only the door can know: an area that was taking every save has just
// refused one — the first of an episode for THAT area, said once, not again for each save refused
// while it lasts. (useStorageHealth's `unsaved` cannot stand in for it: it is one flag for both
// areas, so a device that fills while the session's area is already refusing would never move it.)
export type StorageWatcher = {
  changed: (storage: Storage, key: string | null, value: string | null) => void
  refused: (storage: Storage) => void
}
let watcher: StorageWatcher | null = null
/** Be told of every change to what is on the device. One watcher (store/storageUsage); returns the undo. */
export function watchStorage(next: StorageWatcher): () => void {
  watcher = next
  return () => {
    if (watcher === next) watcher = null
  }
}

// ── The one writer outside the door ───────────────────────────────────────────────────────────
// src/changelog writes and removes its own few keys (it may import nothing, so it cannot call the
// functions below) and names each one as it does. What the key holds NOW is read from the device
// and reported exactly as a write through the door is — so the watcher's count has no key it does
// not hear about. Nothing else happens here on purpose: those writes are best-effort over there, so
// one the device refused changed nothing, is not held, and is not named.
reportWritesTo((key) =>
  watcher?.changed(window.localStorage, key, window.localStorage.getItem(key)),
)

// ── The scratch key ───────────────────────────────────────────────────────────────────────────
// measureRoom (below) finds how much more a storage area will take by writing this one key and
// removing it again. It is not saved data and nothing may ever treat it as such:
//   • it is written and removed RAW, never through writeItem — so it is never held, and the watcher
//     above never hears of it;
//   • a `storage` event for it (another tab measuring) is dropped before anyone is told — it is not
//     "another tab changed your data";
//   • ★ IT MAY NEVER BE THE REASON A SAVE IS REFUSED. It is on the device only for the moment
//     between a write and the remove on the very next line — but another tab's copy of the device
//     can show it for a moment longer, and a crash in that moment would leave it behind. So a save
//     the device refuses while this key exists removes the key and tries once more (tryWriteItem).
// Every reader that walks the device's keys skips it by name.
export const SCRATCH_KEY = 'cg-storage-probe'

const settle = (): void => {
  const unsaved = held.size > 0 || doorHeld.size > 0
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
// stays held. A place the windows-in-sync door holds is retried THROUGH the door (holdForDoor, below).
// (Re-entered by a door retry that lands and so frees room for the others: the outer pass goes on.)
let retrying = false
const retryHeld = (): void => {
  if (retrying) return
  retrying = true
  try {
    for (const [storage, area] of [...held])
      for (const [key, value] of [...area]) {
        if (tryWriteItem(storage, key, value)) release(storage, key)
      }
    for (const [storage, area] of [...doorHeld])
      for (const [key, hold] of [...area]) if (hold.retry()) releaseDoorHold(storage, key)
  } finally {
    retrying = false
  }
}

// ── A save the WINDOWS-IN-SYNC DOOR holds (store/syncedDoc; design-q1-q2.md v4, section 5) ──────────
// Every saved doc goes through that door, which merges with the device before it writes. A save it
// cannot land is therefore never held here as TEXT to be written again blindly — that text was merged
// with the device as it was THEN, and a retry must merge with whatever another window saved since. So
// the door keeps the save itself (its un-landed actions) and registers the place here with a RETRY of
// its own: the door merges and writes. What it registers with it is the text the place would hold had
// the save fitten, so a read of the place inside this page (readItem) still sees the player's newest
// data, exactly as for a held value. The notice, `unsaved`, `isHolding`, and the first-refusal report
// treat both kinds alike; removing the place forgets either; another tab's change forgets NEITHER of the
// door's (the door merges with that change itself — what makes a held save safe to keep).
type DoorHold = { text: string; retry: () => boolean }
const doorHeld = new Map<Storage, Map<string, DoorHold>>()
/** The door could not land (storage, key): hold `text` as what it would hold, with the door's retry. */
export function holdForDoor(
  storage: Storage,
  key: string,
  text: string,
  retry: () => boolean,
): void {
  const first = !held.has(storage) && !doorHeld.has(storage)
  let area = doorHeld.get(storage)
  if (!area) doorHeld.set(storage, (area = new Map()))
  area.set(key, { text, retry })
  settle()
  if (first) watcher?.refused(storage)
}
/** The door landed (storage, key) — or no longer needs to: nothing is held for it. */
export function releaseDoorHold(storage: Storage, key: string): void {
  const area = doorHeld.get(storage)
  if (!area?.delete(key)) return
  if (area.size === 0) doorHeld.delete(storage)
  settle()
}

/**
 * Save `value` at (storage, key) and say whether the device took it. A refusal is NOT held: this is
 * for a value that is only worth having once it is on the device, and whose absence loses nothing —
 * a sealed chunk of solve times (store/progressStorage), which stays in the main save until it fits.
 */
export function tryWriteItem(storage: Storage, key: string, value: string): boolean {
  for (let cleared = false; ; cleared = true) {
    try {
      storage.setItem(key, value)
      break
    } catch (e) {
      if (!isQuotaError(e)) throw e
      // Refused — and if a measurement's scratch key is in the way, it goes and the save is tried
      // once more (see SCRATCH_KEY).
      if (cleared || storage.getItem(SCRATCH_KEY) === null) return false
      storage.removeItem(SCRATCH_KEY)
    }
  }
  watcher?.changed(storage, key, value)
  return true
}

/**
 * How many MORE characters `storage` will take right now (a key's name counts with its text) — up
 * to `most`, and to within `within` characters. Found the only way a browser allows: by trying. It
 * writes the ONE scratch key and removes it again on the next line, every time, so the device is
 * never left holding anything (SCRATCH_KEY says what protects a save from it meanwhile).
 *
 * ★ THE COST IS BOUNDED BY THE ORDER OF THE TRIES. A try that fits costs a write of that size; one
 * that does not fit costs almost nothing (the browser refuses it before storing anything). So:
 *   1. `guesses` first — the sizes the caller expects to be exactly right (the documented allowances
 *      less what is already used). A right guess is confirmed by one write that fits and one, a
 *      character longer, that does not: the exact answer in two tries.
 *   2. then `most` itself — a device that takes even that is not searched any further;
 *   3. then halving what is left, until the answer is known to within `within`.
 * The answer is always a size that was SEEN to fit (or 0), never an estimate above one.
 */
export function measureRoom(
  storage: Storage,
  most: number,
  guesses: readonly number[],
  within: number,
): number {
  const fits = (size: number): boolean => {
    try {
      storage.setItem(SCRATCH_KEY, 'x'.repeat(size - SCRATCH_KEY.length))
      return true
    } catch (e) {
      if (!isQuotaError(e)) throw e
      return false
    } finally {
      storage.removeItem(SCRATCH_KEY)
    }
  }
  storage.removeItem(SCRATCH_KEY) // one a crash left, or another tab's passing through
  // The smallest thing that can be tried is the key with no text at all.
  if (most < SCRATCH_KEY.length || !fits(SCRATCH_KEY.length)) return 0
  let fitting = SCRATCH_KEY.length // the largest size seen to fit
  let refused = most + 1 // the smallest size refused — or, to begin with, simply not to be tried
  const tryAt = (size: number): void => {
    if (size <= fitting || size >= refused) return
    if (fits(size)) fitting = size
    else refused = size
  }
  for (const guess of guesses) {
    tryAt(guess)
    tryAt(guess + 1)
  }
  if (refused - fitting > within) tryAt(most)
  while (refused - fitting > within) tryAt(Math.floor((fitting + refused) / 2))
  return fitting
}

/**
 * Save `value` at (storage, key) — or, if the device refuses it, hold it for that place. Returns
 * whether it is on the device (false: refused, and held).
 */
export function writeItem(storage: Storage, key: string, value: string): boolean {
  if (!tryWriteItem(storage, key, value)) {
    const first = !held.has(storage)
    hold(storage, key, value)
    settle()
    if (first) watcher?.refused(storage)
    return false
  }
  release(storage, key)
  retryHeld() // a write just fit, so there may be room for the others now
  settle()
  return true
}

/** Is any save for this storage area being held — i.e. is THIS area the one that is full? */
export const isHolding = (storage: Storage): boolean => held.has(storage) || doorHeld.has(storage)

/** What (storage, key) holds — the value held for it when its last save was refused. */
export function readItem(storage: Storage, key: string): string | null {
  return (
    doorHeld.get(storage)?.get(key)?.text ?? held.get(storage)?.get(key) ?? storage.getItem(key)
  )
}

/** Remove (storage, key), and forget anything held for it. */
export function removeItem(storage: Storage, key: string): void {
  release(storage, key)
  const area = doorHeld.get(storage)
  if (area?.delete(key) && area.size === 0) doorHeld.delete(storage)
  storage.removeItem(key)
  watcher?.changed(storage, key, null)
  settle()
}

/**
 * ★ ANOTHER TAB JUST CHANGED (storage, key) — or cleared the whole area (`key` null). A plain value
 * this page was holding for that place is forgotten.
 * WHY. A held value is this page's save, DELAYED: it goes out at the next retry, which can be long
 * after it was made. If another tab (or the other site on this origin — live and staging share
 * these keys) has saved to the same place in the meantime, the retry would put an OLDER save over a
 * newer one; if the other tab DELETED the place — a preset removed there — the retry would bring it
 * back. Neither can happen to a save that fit: it would simply have been replaced, or removed, by
 * what came after it. Dropping the held value makes a refused save behave exactly like that.
 * (That is the rule for a PLAIN value — a key with no merge, for which a later save simply wins. The
 * windows-in-sync door's places are not forgotten here: see the note under this function.)
 */
export function placeChangedElsewhere(storage: Storage, key: string | null): void {
  elsewhere.set(storage, changesElsewhere(storage) + 1)
  if (key === null) held.delete(storage)
  else release(storage, key)
  settle()
}
// (A place the windows-in-sync door holds is NOT forgotten here: the door merges with the other tab's
// change and keeps only its own un-landed actions on top of it — see holdForDoor.)
// How many changes other pages have reported to each area.
const elsewhere = new Map<Storage, number>()
/**
 * A number that moves every time ANOTHER page is reported to have changed `storage`. For a reader
 * that remembers what it last saw there (store/progressStorage, which remembers which chunk keys
 * exist): the same number as last time means no other page has been heard from since.
 */
export const changesElsewhere = (storage: Storage): number => elsewhere.get(storage) ?? 0
// The browser's own report of it: a `storage` event, which fires in every OTHER same-origin page when
// one changes localStorage (never in the page that made the change).
// ⚠ Not for a measurement's scratch key (SCRATCH_KEY): that is no change to anyone's data.
// ⚠ The watcher is told what the place holds NOW, read from the device — not the event's own
// `newValue`. An event is delivered after the fact, and this page may have saved to the same place
// since the other one did: the event's text would then be the OLDER of the two, and a count moved by
// it would be wrong by the difference.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (!e.storageArea || e.key === SCRATCH_KEY) return
    placeChangedElsewhere(e.storageArea, e.key)
    watcher?.changed(e.storageArea, e.key, e.key === null ? null : e.storageArea.getItem(e.key))
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
  doorHeld.clear()
  elsewhere.clear()
  useStorageHealth.setState({ unsaved: false, noticeOpen: false })
}
