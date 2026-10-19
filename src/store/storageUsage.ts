import { create } from 'zustand'
import { PRESET_STORE_KEYS, PRESET_REGISTRY_KEY, presetIdOfSuffix } from './presets.js'
import { parseTimesKey, CHUNK_TIMES } from './progressStorage.js'
import {
  isHolding,
  tryWriteItem,
  removeItem,
  watchStorage,
  measureRoom,
  useStorageHealth,
  SCRATCH_KEY,
} from './storageHealth.js'
import type { StorageWatcher } from './storageHealth.js'
import { LOOKUP_HISTORY_KEY } from './lookupHistory.js'
import { docKeyOfSyncKey } from './syncedDoc.js'
import { isRecord } from './json.js'
import { isPlayerBusy, isRoundLive, onPlayerFree } from '../lib/playerBusy.js'
import { captureError } from '../observability/sentry.js'

// store/storageUsage.ts — HOW FULL THE DEVICE'S ROOM FOR THIS APP IS, AND WHAT IS FILLING IT.
//
// Every solve time is kept, so the saved data grows with play, and a browser gives a site a fixed
// allowance. store/storageHealth says what happens when a save does not fit; this file is the
// warning BEFORE that: how much is used, the "Storage used" line in ⚙ that shows it, and a popup
// that opens by itself once when usage first passes STORAGE_WARN_PERCENT
// (components/StorageUsagePopup).
//
// ★ HOW MUCH IS USED — A RUNNING COUNT, NEVER A RE-READ. What the allowance counts is every key's
// name plus its text, in characters. The device is counted ONCE when the page loads (one pass over
// its keys); from then on store/storageHealth — the door every save goes through — reports each
// write and each removal AFTER it has landed, with the text now there, and the count moves by
// exactly that difference. Another tab's changes arrive the same way (the browser's `storage`
// event, through the same door). So the figure is right the moment a save lands or a reset, a Clear
// History or a preset delete takes something away — and an answer costs it one addition, however
// much is saved. No write is left out: the one module that writes for itself (src/changelog) names
// each key to the door as it does, and the door reports it like any other.
// It counts localStorage and nothing else: a session copy of an Amnesic preset lives in
// sessionStorage, which has an allowance of its own and empties itself.
//
// ★ WHAT IS FILLING IT is a second, slower reading (readStorageUsage) — it has to look inside the
// saved progress to tell one mode's solve times from another's — and only the popup shows it, so it
// is taken when the popup opens and at no other time. Sorted into who owns what:
//   • a preset's SOLVE TIMES, per mode: the times inside its progress key, and its sealed chunk keys
//     (store/progressStorage). ⚠ Every chunk key counts toward the SIZE, a superseded one included —
//     Reset Stats for that mode is what gets the room back — but the COUNT of times is the ones a
//     save actually names: the sealed count plus the tail.
//   • LOOKUP HISTORY (one list, shared by every preset);
//   • a preset's OTHER data: its Bests, ⚙ settings, per-mode setup and saved defaults;
//   • PRESET NAMES, all of them together: a name may be any length, so a pasted book can be the
//     largest thing on the device. Their text is counted where it sits in the preset list — and in
//     the list's SYNC KEY, which keeps a copy of each name short enough to copy (store/syncCounts'
//     KEY_VALUE_MAX) so windows can put a newer name back over an older build's stale one;
//   • everything else (the rest of the preset list, small markers).
// ★ A SYNC KEY (store/syncedDoc: what lets windows open side by side merge one doc) belongs to the
// owner of its doc: a preset's to that preset, Lookup history's to Lookup history, the preset list's
// to "everything else" less the names in it — so clearing a thing gives back what the breakdown said.
//
// ★ THE LIMIT IS MEASURED, NOT ASSUMED. A browser has no way to ask how much localStorage a site may
// use, and the browsers do not agree (Chromium allows 5,242,880 characters; Safari is documented at
// half that). A percentage of an assumed figure would read "50%" on a device that is full. So the
// app finds out how many MORE characters the device will take (store/storageHealth's measureRoom —
// it writes one scratch key and removes it again), and the limit is what is used plus that. It is
// remembered (LIMIT_KEY) and not measured again unless it is shown to be wrong:
//   • a save the device REFUSES teaches a limit on the spot — what the device holds at that moment —
//     marked as not yet measured, because it is short by up to the size of the refused save.
//     ⚠ ONCE, AT THE REFUSAL THAT BEGINS THE EPISODE, and never again while it lasts. What the
//     device holds goes on changing while a save is held, and the thing that most often changes it
//     is the player making room: taught again then, the "limit" would be the little that is left
//     after a Reset Stats, and the line would read 100% on a device that had just been emptied;
//   • usage found ABOVE the remembered limit means the limit was too low.
// ⚠ WHEN IT IS MEASURED (measureStorageLimit). Measuring stops the page for a moment — tens of
// milliseconds where the first guess is right — so it is done where nobody can be in the middle of
// anything:
//   • AS THE APP STARTS, before its first screen exists (src/main.tsx's entry calls it ahead of the
//     first render — the Loading screen is what is showing). No question has been drawn, so no solve
//     clock can be running, and the "Storage used" line is right the first time it is seen;
//   • WHEN THE PLAYER OPENS ⚙, OR THE BREAKDOWN POPUP — with no flash, run or round under way
//     (lib/playerBusy's isRoundLive; a casual question just waits behind the menu). That is where a
//     limit that has since been shown wrong is put right without waiting for the next start.
// And never while a save is being held: the device is full then, and what a measurement would find
// is the room the held save is about to take.
// ⚠ A DEVICE THAT COULD NOT BE MEASURED has no percentage, and none is shown: `figure` is null, the
// ⚙ line shows a dash, and there is no warning. That includes a device that holds nothing and will
// take nothing: a limit is always more than zero, so a percentage is always a number.
//
// ★ HOW A PERCENTAGE IS WRITTEN — ONE RULE, IN ONE PLACE (percentText). The ⚙ line, the popup's
// title, and every row of the breakdown show one decimal place, and all of them get their text
// from that one function:
//   • THE LAST DIGIT IS CUT, NEVER ROUNDED UP, so a figure is shown only once it has been reached.
//     Rounded, 79.96% would read "80.0%" with no warning beside it, and 99.96% would read "100.0%"
//     on a device that still takes a save. Cut, "80.0%" or more is on screen exactly when the
//     warning is, and "100.0%" exactly when the device is full;
//   • SOMETHING UNDER A TENTH OF A PERCENT READS "<0.1%". "0.0%" beside a thing that is there says
//     it is not; only nothing at all is "0.0%";
//   • the arithmetic is in whole characters, so a figure that sits exactly on a tenth cannot be
//     nudged to the wrong side of it by a fraction the machine cannot hold.
// ★ …AND HOW ONE IS SAID (percentSpoken). "<" has no reliable reading aloud — a screen reader may
// say "less than", name the character, or skip it and read "0.1%", which is a different figure. So
// the one figure written with it has words to be read in its place, "under 0.1%", and they are
// kept here beside the rule that writes the figure: whoever shows a percentage shows it through
// components/StorageUsagePopup's StoragePercent, which asks this file for both. What is on screen
// does not change.
// The warning itself compares the count with the line directly (settle) — it is not read back off
// the text.
//
// ★ THE POPUP OPENS BY ITSELF ONCE PER UPWARD CROSSING — and never while the player is busy
// (lib/playerBusy: a flash, run or round under way, a timed question waiting, or a text box in use).
// The line's colour and the gear's dot change the moment usage crosses (they are read straight off
// the count); the popup waits for the next moment the player is free — or for the player to open ⚙,
// which is stepping away from a casual question by choice (a round, a run or a flash still has to
// end first: it keeps running behind the menu). "Already warned" is written down only when the
// popup has actually opened (WARNED_KEY — on the device, so not on every open, not on a reload, not
// again while usage stays above the line; and for this page as well, in case a full device cannot
// take even that marker). A reading back under the line forgets it, so a later rise is a new
// crossing. Live and staging share one copy of the data, and therefore this marker too: one warning
// per device.

/** The percentage at which the warning starts. */
export const STORAGE_WARN_PERCENT = 80
/**
 * The allowances the browsers document, in characters (keys and values together): Chromium's —
 * confirmed by measurement for this app — and Safari's. They are where the measurement LOOKS FIRST
 * (a right guess is confirmed in two tries); neither is ever taken on trust.
 */
export const DOCUMENTED_LIMITS: readonly number[] = [5_242_880, 2_621_440]
/**
 * The most the measurement will ever try: twice the largest documented allowance. A device that
 * takes even this much is recorded as having exactly this much — which can only make it read
 * FULLER than it is, never emptier — rather than being written to without end.
 */
export const MAX_STORAGE_LIMIT = 10_485_760
// How close the measurement gets when no guess is right: under a tenth of a percent of any limit.
const MEASURE_WITHIN = 4096
const LIMIT_KEY = 'cg-storage-limit-v1'
const WARNED_KEY = 'cg-storage-warned-v1'

/** One owner's share of the storage. `count` is how many times / lookups it holds, where it has one. */
export type UsageRow =
  | { kind: 'times'; presetId: number; silo: string; chars: number; count: number }
  | { kind: 'lookup'; chars: number; count: number }
  | { kind: 'preset'; presetId: number; chars: number }
  // Every preset's name, as saved. `spare` is how much of that shortening the names could give
  // back: all of each name but one character (a name cannot be empty).
  | { kind: 'names'; chars: number; spare: number }
  | { kind: 'other'; chars: number }

export type UsageReading = { used: number; rows: UsageRow[] }

// Which preset a per-preset store key belongs to, and whether it is the progress key — or null for
// a key that is not one of the four.
function parsePresetKey(key: string): { presetId: number; progress: boolean } | null {
  for (const base of Object.values(PRESET_STORE_KEYS)) {
    if (!key.startsWith(base)) continue
    const presetId = presetIdOfSuffix(key.slice(base.length))
    if (presetId !== null) return { presetId, progress: base === PRESET_STORE_KEYS.progress }
  }
  return null
}

// How much of the saved preset list is its presets' NAMES, and how much of that could be given
// back — both nothing for text that is not a preset list. A name is counted as it is written in
// the save (its quotes left out), which is what the device's allowance counts.
function namesIn(registryText: string): { chars: number; spare: number } {
  const size = { chars: 0, spare: 0 }
  try {
    const saved: unknown = JSON.parse(registryText)
    const presets = isRecord(saved) && isRecord(saved.state) ? saved.state.presets : null
    for (const preset of Array.isArray(presets) ? presets : [])
      if (isRecord(preset)) addName(size, preset.name)
  } catch {
    /* unreadable: all of it counts as "everything else" */
  }
  return size
}
// …and in the preset list's sync key: the copy of each name it holds (a slice `name:<id>`'s value).
function namesInSyncKey(keyText: string): { chars: number; spare: number } {
  const size = { chars: 0, spare: 0 }
  try {
    const saved: unknown = JSON.parse(keyText)
    const at = isRecord(saved) && isRecord(saved.at) ? saved.at : {}
    for (const [slice, entry] of Object.entries(at))
      if (slice.startsWith('name:') && isRecord(entry)) addName(size, entry.v)
  } catch {
    /* unreadable: all of it counts as "everything else" */
  }
  return size
}
function addName(size: { chars: number; spare: number }, name: unknown): void {
  if (typeof name !== 'string') return
  const written = JSON.stringify(name).length - 2
  size.chars += written
  // …less its first character as written, which is what a one-character name would still take.
  size.spare += written - (JSON.stringify(Array.from(name)[0] ?? '').length - 2)
}

// How a saved progress spells the start of a mode's solve times.
const TIMES_OPEN = '"times":['

/**
 * What is filling `area`, by owner. Reads only.
 * ★ A MODE'S TIMES ARE MEASURED WHERE THEY SIT IN THE TEXT — from the bracket that opens them to the
 * one that closes them, which the browser finds at the speed it searches a string — and are never
 * written out again to be measured (that cost as much as saving them, per look).
 */
export function readStorageUsage(area: Storage): UsageReading {
  const times = new Map<string, { presetId: number; silo: string; chars: number; count: number }>()
  const presets = new Map<number, number>()
  const lookup = { chars: 0, count: 0 }
  const names = { chars: 0, spare: 0 }
  let other = 0
  let used = 0
  const timesRow = (presetId: number, silo: string) => {
    const id = `${presetId}:${silo}`
    let row = times.get(id)
    if (!row) times.set(id, (row = { presetId, silo, chars: 0, count: 0 }))
    return row
  }
  for (let i = 0; i < area.length; i++) {
    const key = area.key(i)
    if (key === null || key === SCRATCH_KEY) continue
    const text = area.getItem(key) ?? ''
    const chars = key.length + text.length
    used += chars
    // A sync key - and the progress doc's records' key - is counted with its doc.
    const ofDoc = docKeyOfSyncKey(key)
    if (ofDoc === LOOKUP_HISTORY_KEY) {
      lookup.chars += chars
      continue
    }
    if (ofDoc === PRESET_REGISTRY_KEY) {
      const inKey = namesInSyncKey(text)
      names.chars += inKey.chars
      names.spare += inKey.spare
      other += chars - inKey.chars
      continue
    }
    if (ofDoc !== null) {
      const owner = parsePresetKey(ofDoc)
      if (owner) presets.set(owner.presetId, (presets.get(owner.presetId) ?? 0) + chars)
      else other += chars
      continue
    }
    const chunk = parseTimesKey(key)
    if (chunk) {
      timesRow(chunk.presetId, chunk.silo).chars += chars
      continue
    }
    if (key === LOOKUP_HISTORY_KEY) {
      lookup.chars += chars
      try {
        const saved: unknown = JSON.parse(text)
        const history = isRecord(saved) && isRecord(saved.state) ? saved.state.history : null
        if (Array.isArray(history)) lookup.count = history.length
      } catch {
        /* unreadable: its size still counts */
      }
      continue
    }
    if (key === PRESET_REGISTRY_KEY) {
      const inList = namesIn(text)
      names.chars += inList.chars
      names.spare += inList.spare
      other += chars - inList.chars // the rest of the list is nobody's to clear
      continue
    }
    const owner = parsePresetKey(key)
    if (!owner) {
      other += chars
      continue
    }
    let rest = chars
    if (owner.progress) {
      try {
        const saved: unknown = JSON.parse(text)
        const stats = isRecord(saved) && isRecord(saved.state) ? saved.state.stats : null
        // The modes come out of the parse in the order the text spells them, so each one's times
        // are the next ones in the text.
        let at = 0
        for (const [silo, s] of Object.entries(isRecord(stats) ? stats : {})) {
          if (!isRecord(s) || !Array.isArray(s.times)) continue
          const open = text.indexOf(TIMES_OPEN, at)
          const close = text.indexOf(']', open)
          if (open < 0 || close < 0) break // not spelled as a save spells it: the rest is "other data"
          at = close
          const sealed = isRecord(s.sealed) && Array.isArray(s.sealed.ids) ? s.sealed.ids : []
          // The tail's own text, bracket to bracket, and the list that names the chunks.
          const own = close - open - TIMES_OPEN.length + 2 + JSON.stringify(sealed).length
          const row = timesRow(owner.presetId, silo)
          row.chars += own
          row.count += s.times.length + sealed.length * CHUNK_TIMES
          rest -= own
        }
      } catch {
        /* unreadable: the whole key counts as the preset's other data */
      }
    }
    presets.set(owner.presetId, (presets.get(owner.presetId) ?? 0) + rest)
  }
  const rows: UsageRow[] = [
    ...[...times.values()].map((row) => ({ kind: 'times' as const, ...row })),
    ...[...presets].map(([presetId, chars]) => ({ kind: 'preset' as const, presetId, chars })),
  ]
  if (lookup.chars) rows.push({ kind: 'lookup', ...lookup })
  if (names.chars) rows.push({ kind: 'names', ...names })
  if (other) rows.push({ kind: 'other', chars: other })
  rows.sort((a, b) => b.chars - a.chars)
  return { used, rows }
}

/**
 * Would shortening preset names, AND NOTHING ELSE, bring a device holding `rows` back under the
 * warning line? What the breakdown popup's one sentence about names is shown for — only then, so
 * it is never advice that could not work. Raw counts, like the warning itself: everything the
 * device holds, less what the names could give back, against the line.
 */
export function shorterNamesWouldEndWarning(
  rows: readonly UsageRow[],
  limit: number | null,
): boolean {
  if (limit === null) return false
  let held = 0
  let spare = 0
  for (const row of rows) {
    held += row.chars
    if (row.kind === 'names') spare = row.spare
  }
  return spare > 0 && (held - spare) * 100 < STORAGE_WARN_PERCENT * limit
}

// The one figure that is not a number read as it stands — as it is written, and as it is said.
const UNDER_A_TENTH = { written: '<0.1%', spoken: 'under 0.1%' }
/**
 * `chars` as a percentage of `limit`, as the app writes one (the header says why it is this rule):
 * one decimal place, the last digit cut and never rounded up; "<0.1%" for something too small to
 * show a digit; never above "100.0%".
 */
export function percentText(chars: number, limit: number): string {
  const tenths = Math.min(1000, Math.floor((chars * 1000) / limit))
  return chars > 0 && tenths === 0 ? UNDER_A_TENTH.written : `${(tenths / 10).toFixed(1)}%`
}
/**
 * The words a screen reader is given IN PLACE OF a figure percentText wrote — or null when the
 * figure reads aloud as it is written, which every one but "<0.1%" does.
 */
export const percentSpoken = (written: string): string | null =>
  written === UNDER_A_TENTH.written ? UNDER_A_TENTH.spoken : null

export type StorageUsageState = {
  /** The device's limit, in characters — null until it has been measured (or a refusal taught one). */
  limit: number | null
  /** How much of the limit is used, as it is shown (percentText) — null while the limit is not known. */
  figure: string | null
  /** At or past the line: the ⚙ line wears the warning colour and the gear its dot. */
  warning: boolean
  /** What is filling the device, as read when the popup last opened. */
  rows: UsageRow[]
  /** The breakdown popup is up — opened by the ⚙ line, or by itself on a crossing. */
  popupOpen: boolean
  openPopup: () => void
  closePopup: () => void
}

// ── What this page knows about the device ─────────────────────────────────────────────────────
// Every counted key's size, and their sum — null until the first count.
let sizes: Map<string, number> | null = null
let used = 0
// The limit, and whether it was MEASURED (`firm`) or only taught by a refused save. Kept here as
// well as on the device, because a device too full to take the marker still has a limit.
let known: { limit: number; firm: boolean } | null = null
// This crossing's popup has been shown (or the storage-full notice spoke in its place) — the page's
// own copy of WARNED_KEY, for a device that cannot take the marker.
let warnedHere = false
let settling = false
// The app is on screen and this page is keeping the count for it (watchStorageUsage). Only then can
// the popup open by itself: the measurement at the app's start runs before there is a screen.
let watching = false

const parseLimit = (text: string | null): typeof known => {
  const limit = text === null ? NaN : parseInt(text, 10)
  return Number.isFinite(limit) && limit > 0 ? { limit, firm: !text!.endsWith('?') } : null
}

const warned = (area: Storage): boolean => warnedHere || area.getItem(WARNED_KEY) !== null
const markWarned = (area: Storage): void => {
  warnedHere = true
  tryWriteItem(area, WARNED_KEY, '1')
}

/** How many characters the device holds for the app, as this page has counted them. */
export const storageUsed = (): number => used

const measureOwed = (): boolean =>
  !known || !known.firm || (used > known.limit && known.limit < MAX_STORAGE_LIMIT)

export const useStorageUsage = create<StorageUsageState>()((set, get) => ({
  limit: null,
  figure: null,
  warning: false,
  rows: [],
  popupOpen: false,
  openPopup: () => {
    refreshStorageUsage() // the popup shows the device as it is now, counted afresh
    measureStorageLimit() // …against a limit that is right, if one is owed and may be taken now
    try {
      const area = window.localStorage
      // Opened by hand above the line: the player has now seen what the popup would have said.
      if (get().warning) markWarned(area)
      set({ popupOpen: true, rows: readStorageUsage(area).rows })
    } catch {
      set({ popupOpen: true }) // localStorage refused: nothing is saved there to list
    }
  },
  closePopup: () => set({ popupOpen: false }),
}))

// Turn the count into what is shown — the figure, the warning — then see whether the popup is due.
function settle(area: Storage): void {
  if (settling) return // a marker written below is counted by the door; this pass picks it up
  settling = true
  let limit: number | null
  let figure: string | null
  let warning: boolean
  try {
    for (;;) {
      limit = known?.limit ?? null
      figure = limit === null ? null : percentText(used, limit)
      // The count against the line, in whole characters — never the figure, which has lost digits.
      warning = limit !== null && used * 100 >= STORAGE_WARN_PERCENT * limit
      // ⚠ With no limit there is no reading, and no reading is not "back under the line": a crossing
      // already announced stays announced until a percentage says otherwise.
      if (warning || limit === null || !warned(area)) break
      // Back under the line: the crossing is over, and a later rise is a new one.
      warnedHere = false
      removeItem(area, WARNED_KEY)
    }
  } finally {
    settling = false
  }
  const shown = useStorageUsage.getState()
  if (shown.limit !== limit || shown.figure !== figure || shown.warning !== warning)
    useStorageUsage.setState({
      limit,
      figure,
      warning,
      // An open popup keeps its list in step with its headline.
      ...(shown.popupOpen ? { rows: readStorageUsage(area).rows } : null),
    })
  announceStorageWarning()
}

// A save to `area` has just been refused, with nothing held for it before: the device is full at what
// it holds right now, and that is its limit until it can be measured (the header says why this is
// the one moment it is taught). Remembered, so the next open starts from it — best-effort: a full
// device may refuse even that, and it is then learned again at the next episode.
function learnFromRefusal(area: Storage): void {
  if (!sizes || used === 0) return
  tryWriteItem(area, LIMIT_KEY, `${used}?`)
  known = { limit: used, firm: false } // `used` AFTER the marker, if the device took it
  settle(area)
}

/**
 * Open the popup by itself, if a crossing has not been announced yet and this is a moment for it:
 * the player is not busy — or, with `steppedAway` (the player opening ⚙), has no round, run or flash
 * under way.
 * ⚠ It does not open while the device is REFUSING saves: the storage-full notice is the one that
 * speaks then (components/StorageFullNotice — it says more, and it says it now), and the crossing
 * counts as announced.
 */
export function announceStorageWarning(steppedAway = false): void {
  if (!watching) return
  try {
    const area = window.localStorage
    const shown = useStorageUsage.getState()
    if (!shown.warning || shown.popupOpen || warned(area)) return
    const noticeSpeaks = useStorageHealth.getState().unsaved
    if (!noticeSpeaks && (steppedAway ? isRoundLive() : isPlayerBusy())) return
    markWarned(area)
    if (!noticeSpeaks)
      useStorageUsage.setState({ popupOpen: true, rows: readStorageUsage(area).rows })
  } catch {
    /* localStorage refused: nothing is saved there, so there is nothing to warn about */
  }
}

/**
 * Measure the device's limit, if a measurement is owed and this is a moment one may be taken (the
 * header says which moments its three callers are). Counts the device first if this page has not
 * yet. Never throws.
 */
export function measureStorageLimit(): void {
  if (!sizes) refreshStorageUsage()
  try {
    const area = window.localStorage
    if (!sizes || !measureOwed() || useStorageHealth.getState().unsaved || isRoundLive()) return
    const room = measureRoom(
      area,
      MAX_STORAGE_LIMIT - used,
      DOCUMENTED_LIMITS.map((limit) => limit - used),
      MEASURE_WITHIN,
    )
    // ⚠ NOTHING HELD AND NOTHING TAKEN IS NOT A LIMIT OF ZERO — it is a device that told the app
    // nothing (a browser that gives a site no room at all refuses the first character). There is
    // no whole to take a percentage of, so it stays unmeasured: the dash, and another try at the
    // next of the moments above.
    if (used + room === 0) return
    known = { limit: used + room, firm: true }
    tryWriteItem(area, LIMIT_KEY, String(known.limit))
    settle(area) // (the door has already settled it if the marker landed; this is for when it did not)
  } catch (e) {
    captureError(e instanceof Error ? e : new Error(String(e)), { tripwire: 'storageMeasure' })
  }
}

/**
 * Count the device again, from nothing, and act on it. Never throws: a browser that refuses
 * localStorage has nothing saved and stays as it was.
 */
export function refreshStorageUsage(): void {
  try {
    const area = window.localStorage
    const counted = new Map<string, number>()
    let total = 0
    for (let i = 0; i < area.length; i++) {
      const key = area.key(i)
      if (key === null || key === SCRATCH_KEY) continue
      const chars = key.length + (area.getItem(key) ?? '').length
      counted.set(key, chars)
      total += chars
    }
    sizes = counted
    used = total
    known = parseLimit(area.getItem(LIMIT_KEY)) ?? known
    settle(area)
  } catch {
    /* localStorage refused: nothing is saved there */
  }
}

/**
 * A RETURN from a hidden, frozen or restored page (store/windowSync; design-q1-q2.md v4, 13.4): the
 * notices of what other windows saved meanwhile may never have come (queued for a frozen page, missed by
 * a restored one), so the device is counted again - while this page keeps the count at all.
 */
export function recountStorageUsage(): void {
  if (watching) refreshStorageUsage()
}

// The door's reports (store/storageHealth).
const door: StorageWatcher = {
  // (storage, key) now holds `value` — null: it is gone.
  changed: (storage, key, value) => {
    try {
      const area = window.localStorage
      if (storage !== area) return
      if (key === null || !sizes) return refreshStorageUsage()
      const chars = value === null ? 0 : key.length + value.length
      used += chars - (sizes.get(key) ?? 0)
      if (chars) sizes.set(key, chars)
      else sizes.delete(key)
      // Another tab measured, or learned from a refusal: its answer is this device's too.
      if (key === LIMIT_KEY) known = parseLimit(value) ?? known
      settle(area)
    } catch (e) {
      // The count must never be why a save fails: report it, and let the save stand.
      captureError(e instanceof Error ? e : new Error(String(e)), { tripwire: 'storageUsage' })
    }
  },
  refused: (storage) => {
    try {
      if (storage === window.localStorage) learnFromRefusal(storage)
    } catch (e) {
      captureError(e instanceof Error ? e : new Error(String(e)), { tripwire: 'storageUsage' })
    }
  },
}

/**
 * Start keeping the count for this page: the device is counted now, and from here on every save and
 * removal moves it. Called once, by App's boot effect; returns the undo (tests).
 */
export function watchStorageUsage(): () => void {
  watching = true
  const stops = [
    watchStorage(door),
    // The moment a waiting popup may open.
    onPlayerFree(announceStorageWarning),
    // The last held save landing: the notice no longer speaks for a crossing still unannounced.
    useStorageHealth.subscribe((s, was) => {
      if (s.unsaved !== was.unsaved) announceStorageWarning()
    }),
  ]
  refreshStorageUsage()
  // A save refused before the count began (one of the app's own, as it loaded) started its episode
  // unheard: the device is full now, and this is the first this page knows of it.
  try {
    if (isHolding(window.localStorage)) learnFromRefusal(window.localStorage)
  } catch {
    /* localStorage refused */
  }
  return () => {
    stops.forEach((stop) => stop())
    watching = false
  }
}

/**
 * Forget everything this page knows about the device, i.e. "the page was closed" — and take the
 * device to have been measured at `limit` (null: never measured). The app never needs this — a page
 * load starts from nothing known — but the test harness has no page load, so tests/setup/dom.js
 * calls it before every test (the same reason it forgets the storage health), with a limit already
 * known so that an ordinary test is not a device waiting to be measured.
 */
export function forgetStorageUsage(limit: number | null = DOCUMENTED_LIMITS[0]): void {
  sizes = null
  used = 0
  known = limit === null ? null : { limit, firm: true }
  warnedHere = false
  useStorageUsage.setState({
    limit: null,
    figure: null,
    warning: false,
    rows: [],
    popupOpen: false,
  })
}
