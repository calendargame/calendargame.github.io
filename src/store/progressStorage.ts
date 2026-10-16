import type { StorageValue } from 'zustand/middleware'
import { presetKey, presetIdOfSuffix, PRESET_STORE_KEYS } from './presets.js'
import {
  readItem,
  writeItem,
  removeItem,
  tryWriteItem,
  storageSpaceFreed,
  changesElsewhere,
} from './storageHealth.js'
import { captureError } from '../observability/sentry.js'
import { isRecord } from './json.js'

// store/progressStorage.ts — HOW THE SAVED PROGRESS IS LAID OUT ON THE DEVICE, so that saving an
// answer costs the same however many solve times a player has.
//
// WHY. Every solve time is kept (store/progress), and the progress save is one key written whole on
// every answer — so a mode with 100,000 times re-wrote ~700 KB per answer. This file is the layer
// between zustand's persist and the storage area that makes the write small again.
//
// ★ THE LAYOUT. The main key keeps its name, its version and its exact shape. A mode ("silo") with
// more than SEAL_ABOVE times keeps only its newest 250–499 in the main key — the TAIL — and its
// older times live in CHUNK keys of exactly CHUNK_TIMES each, which are written once and never
// changed:
//
//     main   cg-progress-v1[~pN]              { …, times: [tail], timesLost: L + n, sealed: { n, ids } }
//     chunk  cg-times-v1[~pN]:<silo>:<j>.<id>  JSON array of the 250 times at positions j·250 …
//
//   • `sealed.ids[j]` names chunk j; `sealed.n` is how many times they hold (ids.length × 250).
//   • The sealed count is ADDED to the stored `timesLost`. That is what makes the layout readable by
//     every older build on this origin (live and staging share one copy of the data): to a build that
//     has never heard of chunks, sealed times look exactly like times the old 1,000 cap trimmed — a
//     state it already handles — and it carries `sealed` and `timesLost` through every write it
//     makes, because every Stats it builds is a spread of the one it read (or a reset, which drops
//     both together).
//   • A chunk's id is a hash of its text, so its NAME says what it holds: two pages that seal the
//     same times produce the same key, a crash between a chunk and the main save leaves a chunk the
//     next save finds and reuses, and no page can ever change what a name another page holds means.
//     A chunk key is written only when absent and is never overwritten.
//   • In memory nothing changes: the store holds every time in one array, `timesLost` is the real
//     legacy gap, and there is no `sealed`. This file adds them on the way out and removes them on
//     the way in.
//
// ★ THE MAIN KEY IS THE ONLY COMMIT POINT. Chunks go to the device first; the main key names a chunk
// only once it is there; anything not named by a main key is ignored by every reader. A chunk the
// device refuses is simply not sealed — those times stay in the tail, nothing is unsaved.
//
// ★ WHAT MAY DELETE A CHUNK — four cases, each by exact key name, and each bound to the storage AREA
// being written (an Amnesic preset's session copy lives in sessionStorage under the same names, and
// nothing here may reach across to the permanent one):
//   a. A RESET SEEN BY THIS PAGE: a silo this page last saved with times is now saved empty. The
//      chunk keys this page knew for it go, once that main save is on the device.
//   b. LEFT BEHIND, SEEN AT LOAD: a silo loads with no `sealed`, yet chunk keys exist for it (an
//      older build reset it, or saved a complete copy over a sealed one). The exact names found are
//      remembered, and at the next main save that lands each is deleted — UNLESS it still spells the
//      times at its position in what was just saved, which is the chunk a sealing save would name.
//   c. removeProgressCopy: the whole copy is going (a preset deleted, a guest session thrown away,
//      Full Reset's wipe of an Amnesic preset's parked stats).
//   d. sweepAbandonedTimes: once per fresh open — a preset that no longer exists and has no main key.
// Chunks that are merely unreachable — a deep Override re-sealed its part under new names, two tabs
// diverged — are KEPT until that silo is reset: an older page may still hold a save that names them.

// ── ★ THE OLDER BUILDS THAT SHARE THE DEVICE (a two-step roll-out, finished in Round 26) ────────
// v2.28.0 shipped the READER of this layout and nothing that could create it; Round 26 turned sealing
// on, for every silo past SEAL_ABOVE times, once every copy of the app on a device could read it.
//   • v2.28.0 and v2.29.x read a sealed save in full and keep sealing it forward as its tail grows,
//     by every rule above — they never START sealing a plain silo, which changes nothing here
//     (tests/fixtures/olderBuilds/progressStorage-v2.29.0.ts is their code, held to what they stored).
//   • v2.27.3 and older read the sealed times as times the old 1,000 cap trimmed, which they already
//     handle: their Mean and Median cover the tail only, until that tab updates. Known and accepted.

/** Times per chunk. Fixed for ever: a chunk's position is its index × this. */
export const CHUNK_TIMES = 250
/**
 * A silo is sealed only past this many times. 1,000 is the old cap: builds up to v2.26.0 test
 * "correct answers ≠ saved times" with no `timesLost`, so sealing below it would hand them a false
 * "Enable and Reset Stats?" they do not have today; above it they are already wrong after a reload.
 */
const SEAL_ABOVE = 1000
/** The chunk keys' base name. Namespaced per preset exactly as the four store keys are. */
const TIMES_KEY = 'cg-times-v1'

// How many chunks a silo of `len` times is sealed into: all but the newest 250–499.
const sealedChunks = (len: number): number =>
  len > SEAL_ABOVE ? Math.floor(len / CHUNK_TIMES) - 1 : 0

/** One copy of the saved progress: a preset's, in one storage area. */
export type ProgressCopy = { area: Storage; presetId: number }

/**
 * The main key of one preset's saved progress — the SAME name in either storage area (the two are
 * separate namespaces, and sharing the spelling is what lets a copy keep its exact shape and
 * `version` stamp wherever it lives).
 */
export const mainKeyOf = (presetId: number): string =>
  presetKey(PRESET_STORE_KEYS.progress, presetId)
// ⚠ WITH THE TRAILING COLON, so preset 1's family is never a prefix of preset 12's.
const familyOf = (presetId: number): string => `${presetKey(TIMES_KEY, presetId)}:`

// cyrb53 — a fast 53-bit string hash. Not cryptographic and does not need to be: a clash is caught
// where it matters (a name already taken by different text gets a numbered suffix, below).
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const chunkText = (times: readonly number[], j: number): string =>
  JSON.stringify(times.slice(j * CHUNK_TIMES, (j + 1) * CHUNK_TIMES))

/** A chunk key taken apart — or null for a key that is not one. Exported for the usage reading. */
export function parseTimesKey(
  key: string,
): { presetId: number; silo: string; index: number; id: string } | null {
  if (!key.startsWith(TIMES_KEY)) return null
  const colon = key.indexOf(':')
  if (colon < 0) return null
  const presetId = presetIdOfSuffix(key.slice(TIMES_KEY.length, colon))
  const rest = key.slice(colon + 1)
  const cut = rest.lastIndexOf(':')
  const dot = rest.indexOf('.', cut + 1)
  if (presetId === null || cut < 0 || dot < 0) return null
  const index = Number(rest.slice(cut + 1, dot))
  if (!Number.isInteger(index) || index < 0) return null
  return { presetId, silo: rest.slice(0, cut), index, id: rest.slice(dot + 1) }
}

const keysUnder = (area: Storage, prefix: string): string[] => {
  const keys: string[] = []
  for (let i = 0; i < area.length; i++) {
    const k = area.key(i)
    if (k !== null && k.startsWith(prefix)) keys.push(k)
  }
  return keys
}

// ── A save the old 1,000-time cap trimmed ─────────────────────────────────────────────────────
//
// Builds up to v2.26.0 saved only the newest 1,000 solve times. A silo they trimmed is recognisable
// exactly: 1,000 times beside MORE than 1,000 correct answers. The older times are gone — nothing
// can bring them back — so the gap is recorded as `timesLost` (engine Stats), which the desync check
// subtracts; every time from here on is kept, so the gap never grows.
// ★ IT IS A STATEMENT ABOUT THE STORED ARRAY, which is why it runs here, on a save as the device
// holds it, and not in the store's `migrate`: for a sealed silo the stored array is the tail, and it
// is the tail such a build trims.
// ⚠ AND IT IS RE-DERIVED, NOT ADDED TO, on every save stamped older than TIMES_KEPT_VERSION. Live
// and staging share one browser origin, i.e. ONE copy of the saved data, so an older build can load
// a current save, trim it again and write it back under its own version — carrying `timesLost`
// along untouched on its `...stats` spreads. `good − 1,000` is then the WHOLE gap again (the earlier
// baseline and any sealed times included), never an increment on top of it; a silo that was NOT
// re-trimmed keeps whatever baseline it carries.
// ⚠ ONE THING IT CANNOT KNOW: whether some of that gap was answers given while timing was hidden
// (the popup's real case). In a trimmed save those are indistinguishable from discarded times, so
// they are folded into the baseline — the only alternative is the false popup this exists to end.
// ⚠ AND ONE SAVE IT CANNOT RECOGNISE, weighed and left: a silo such a build trimmed and then TOOK A
// CREDIT BACK from (an Override), before any newer build had loaded it. It then holds 999 times
// beside 1,000 or more correct answers — and that is, to the character, also how 999 timed answers
// and one given with timing hidden are saved, which is the real mismatch the "Enable and Reset
// Stats?" question exists for. That build writes no field that tells the two apart (a take-back
// lowers the times and the correct answers together, so the gap a trim made simply stays), and it
// asks the same question of the same save itself. Calling every such save "trimmed" would silence
// the question where it is true, for every player who ever hid their timing — the commoner case by
// far, since timing starts hidden. So it is read as the mismatch it is spelled as: one unneeded
// question, in a state only that build can make and already shows it for.
// (tests/progressStorage.fuzz names this exemption where it makes it.)
const LEGACY_TIMES_CAP = 1000
// The saved-shape version in which the cap went — the stamp of the FIRST build that keeps every
// solve time. ⚠ A fact about history, not "the store's current version" (store/progress' `version`,
// which is the same number today and moves on with the next shape change): a save stamped older than
// THIS was written by a build that trims, whatever the current version has become by then.
const TIMES_KEPT_VERSION = 5
// Exported for tests.
export function baselineTrimmedTimes(stats: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, silo] of Object.entries(stats)) {
    const trimmed =
      isRecord(silo) &&
      Array.isArray(silo.times) &&
      silo.times.length === LEGACY_TIMES_CAP &&
      Number.isInteger(silo.good) &&
      (silo.good as number) > LEGACY_TIMES_CAP
    out[key] = trimmed ? { ...silo, timesLost: (silo.good as number) - LEGACY_TIMES_CAP } : silo
  }
  return out
}

// ── Reading one sealed silo ───────────────────────────────────────────────────────────────────

// A chunk's 250 times, or null when the key is missing or does not hold what its name says (the id
// is the hash of the text, so a truncated or altered chunk cannot pass for the real one).
function readChunk(area: Storage, key: string, id: string): number[] | null {
  const text = area.getItem(key)
  if (text === null || hash(text) !== id.split('.')[0]) return null
  try {
    const times: unknown = JSON.parse(text)
    const ok =
      Array.isArray(times) &&
      times.length === CHUNK_TIMES &&
      times.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)
    return ok ? (times as number[]) : null
  } catch {
    return null
  }
}

// `sealed` as a save may carry it, or null when it is not one this file wrote: the count must be
// exactly its chunks' worth, and the stored `timesLost` must cover it (it was added to it).
function validSealed(silo: Record<string, unknown>): string[] | null {
  const sealed = silo.sealed
  if (!isRecord(sealed) || !Array.isArray(sealed.ids) || sealed.ids.length === 0) return null
  if (!sealed.ids.every((id) => typeof id === 'string' && id !== '')) return null
  const n = sealed.ids.length * CHUNK_TIMES
  if (sealed.n !== n || !Number.isInteger(silo.timesLost) || (silo.timesLost as number) < n)
    return null
  return sealed.ids as string[]
}

// What this page knows about one silo of the copy it is on.
type SiloBook = {
  // The times array last loaded or saved — compared by identity first, so a save that did not touch
  // this silo's times costs nothing.
  ref: readonly number[]
  // ids[j] names the chunk holding ref[j·250 …]; empty for a silo that is not sealed.
  ids: string[]
  // Every chunk key this page has read or written for it — what a reset seen here deletes.
  keys: Set<string>
}

// What this page knows about the ONE copy its store is on. Replaced by every load; a save to any
// other copy starts from nothing known.
type Book = {
  area: Storage
  mainKey: string
  family: string
  // The main text last read or written here, and whether it is on the device (false: the device
  // refused it and store/storageHealth is holding it).
  text: string | null
  landed: boolean
  // How many changes other pages had reported to this area when it was last read or written here
  // (store/storageHealth's changesElsewhere).
  heard: number
  silos: Map<string, SiloBook>
  // Chunk keys to delete at the next main save that lands (rules a and b), with the silo each
  // belongs to.
  doomed: Map<string, string>
}

const openBook = (copy: ProgressCopy): Book => ({
  area: copy.area,
  mainKey: mainKeyOf(copy.presetId),
  family: familyOf(copy.presetId),
  text: null,
  landed: true,
  heard: changesElsewhere(copy.area),
  silos: new Map(),
  doomed: new Map(),
})

/**
 * The reader and writer of the saved progress for one page. `load` and `save` are what zustand's
 * persist calls (through store/amnesic's router, which decides which copy); both are synchronous.
 */
export function createProgressCodec<S>() {
  let book: Book | null = null

  /**
   * One copy's saved progress as the store holds it — every silo's times whole — or null when it has
   * none. Writes nothing.
   */
  function load(copy: ProgressCopy): StorageValue<S> | null {
    const b = (book = openBook(copy))
    b.text = readItem(b.area, b.mainKey)
    // Held, not on the device, when the two differ (store/storageHealth returns a refused save).
    b.landed = b.area.getItem(b.mainKey) === b.text
    const found = keysUnder(b.area, b.family)
    const bySilo = new Map<string, string[]>()
    for (const key of found) {
      const silo = parseTimesKey(key)?.silo
      if (silo !== undefined) bySilo.set(silo, [...(bySilo.get(silo) ?? []), key])
    }
    const leftBehind = (silo: string) => {
      for (const key of bySilo.get(silo) ?? []) b.doomed.set(key, silo)
      bySilo.delete(silo)
    }
    const envelope: unknown = b.text === null ? null : JSON.parse(b.text)
    const state = isRecord(envelope) ? envelope.state : undefined
    const stored = isRecord(state) && isRecord(state.stats) ? state.stats : null
    if (!isRecord(envelope) || !isRecord(state) || !stored) {
      // No save here (or one with no stats to speak for any chunk): every chunk key is left behind.
      for (const silo of [...bySilo.keys()]) leftBehind(silo)
      return envelope as StorageValue<S> | null
    }
    const trimmedOnce =
      typeof envelope.version === 'number' && envelope.version < TIMES_KEPT_VERSION
        ? baselineTrimmedTimes(stored)
        : stored
    const stats: Record<string, unknown> = {}
    for (const [name, silo] of Object.entries(trimmedOnce)) {
      stats[name] = silo
      if (!isRecord(silo) || !Array.isArray(silo.times)) {
        bySilo.delete(name) // not a silo this file can read: its chunk keys are not ours to judge
        continue
      }
      const tail = silo.times as number[]
      if (!('sealed' in silo)) {
        b.silos.set(name, { ref: tail, ids: [], keys: new Set() })
        leftBehind(name)
        continue
      }
      // Sealed, or claiming to be: either way its chunk keys stay (rule b is for a PLAIN silo).
      bySilo.delete(name)
      const { sealed: _sealed, timesLost, ...rest } = silo
      const ids = validSealed(silo)
      if (!ids) {
        // Not a `sealed` this file wrote. The stored `timesLost` stands (it already counts whatever
        // was sealed), the tail is the times, and the chunks are left alone.
        captureError(new Error(`Saved progress: ${name} has a malformed sealed record`), {
          tripwire: 'progressSealed',
        })
        stats[name] = timesLost === undefined ? rest : { ...rest, timesLost }
        b.silos.set(name, { ref: tail, ids: [], keys: new Set() })
        continue
      }
      const keys = ids.map((id, j) => `${b.family}${name}:${j}.${id}`)
      const parts: number[][] = []
      // The ids that still name the chunk at their position: every one up to the first unreadable
      // chunk (the times after a gap sit 250 earlier than their old chunk index says).
      let intact = ids.length
      keys.forEach((key, j) => {
        const chunk = readChunk(b.area, key, ids[j])
        if (chunk) parts.push(chunk)
        else intact = Math.min(intact, j)
      })
      const recovered = parts.length * CHUNK_TIMES
      if (parts.length < ids.length)
        captureError(
          new Error(`Saved progress: ${ids.length - parts.length} chunk(s) of ${name} unreadable`),
          { tripwire: 'progressChunks' },
        )
      const times = ([] as number[]).concat(...parts, tail)
      // The times that could not be read stay counted as lost; a gap of zero is ABSENT in memory
      // (engine/parkedHistory compares it with `!==`).
      const lost = (timesLost as number) - recovered
      stats[name] = lost > 0 ? { ...rest, times, timesLost: lost } : { ...rest, times }
      b.silos.set(name, { ref: times, ids: ids.slice(0, intact), keys: new Set(keys) })
    }
    // Chunk keys of a silo the save does not have at all are left behind too.
    for (const silo of [...bySilo.keys()]) leftBehind(silo)
    return { ...envelope, state: { ...state, stats } } as StorageValue<S>
  }

  // The id of chunk `j` of `silo` holding `text`, on the device — found there already, or written
  // now. null when the device has no room for it.
  function ensureChunk(b: Book, silo: string, j: number, text: string, keys: Set<string>) {
    const base = hash(text)
    for (let clash = 0; ; clash++) {
      const id = clash ? `${base}.${clash}` : base
      const key = `${b.family}${silo}:${j}.${id}`
      const there = b.area.getItem(key)
      if (there !== null && there !== text) continue // the name is taken by other text: next suffix
      if (there === null && !tryWriteItem(b.area, key, text)) return null
      keys.add(key)
      return id
    }
  }

  // Does this chunk key still spell the times at its position in `times`, as a sealing save of them
  // would name it?
  function stillSpells(b: Book, key: string, times: readonly number[]): boolean {
    const at = parseTimesKey(key)
    return (
      !!at &&
      at.index < sealedChunks(times.length) &&
      b.area.getItem(key) === chunkText(times, at.index)
    )
  }

  /** Save `value` as one copy's progress. */
  function save(copy: ProgressCopy, value: StorageValue<S>): void {
    const mainKey = mainKeyOf(copy.presetId)
    const samePlace = !!book && book.area === copy.area && book.mainKey === mainKey
    const b = samePlace ? book! : (book = openBook(copy))
    // ★ MAY THE CHUNK IDS THIS PAGE REMEMBERS BE USED WITHOUT LOOKING? Only while the main text is
    // still the one this page last read or wrote: every deletion on this origin either follows a
    // main save that no longer names the chunk, or removes the main key itself, so an unchanged main
    // means its chunks are there. ⚠ TWO EXCEPTIONS, and in both each remembered chunk is looked for:
    //   • THIS PAGE'S OWN LAST SAVE IS BEING HELD (the device refused it): the read returns the held
    //     text whatever another page has done since;
    //   • ANOTHER PAGE HAS BEEN HEARD FROM since this page last looked (`heard`). What this page reads
    //     of another tab's writes can lag them by a moment, so its last save may have compared the
    //     main key with a copy that was already out of date — and then written over it, which makes
    //     the text match again from here on. The other tab's change is still reported (the browser's
    //     `storage` event), and that report is what this asks about: a chunk such a save deleted is
    //     found missing at this page's next save and written again from memory, instead of being
    //     named for ever and found missing at the next load.
    // Asked only when a sealed silo needs the answer (once per save): a save with nothing sealed
    // reads nothing back.
    let trust: boolean | null = null
    const trusted = (): boolean =>
      (trust ??=
        samePlace &&
        readItem(b.area, mainKey) === b.text &&
        ((b.landed && changesElsewhere(b.area) === b.heard) ||
          [...b.silos].every(([silo, s]) =>
            s.ids.every((id, j) => b.area.getItem(`${b.family}${silo}:${j}.${id}`) !== null),
          )))
    const state: unknown = value.state
    const stats = isRecord(state) && isRecord(state.stats) ? state.stats : {}
    const onDisk: Record<string, unknown> = {}
    const saved = new Map<string, readonly number[]>()
    let anySealed = false
    for (const [name, silo] of Object.entries(stats)) {
      onDisk[name] = silo
      if (!isRecord(silo) || !Array.isArray(silo.times)) continue
      const times = silo.times as number[]
      saved.set(name, times)
      const was = b.silos.get(name)
      const keys = was?.keys ?? new Set<string>()
      // A RESET SEEN HERE (rule a): its chunks go once this save is on the device.
      if (was && was.ref.length > 0 && times.length === 0) {
        for (const key of keys) b.doomed.set(key, name)
        keys.clear()
      }
      const target = sealedChunks(times.length)
      // How many remembered ids still name their chunk: all of them when the times are the very
      // array last saved; otherwise every chunk before the first time that differs.
      let kept = 0
      if (was && target > 0 && trusted()) {
        const span = Math.min(was.ids.length * CHUNK_TIMES, was.ref.length, times.length)
        let same = was.ref === times ? span : 0
        while (same < span && was.ref[same] === times[same]) same++
        kept = Math.min(Math.floor(same / CHUNK_TIMES), target)
      }
      const ids = was ? was.ids.slice(0, kept) : []
      while (ids.length < target) {
        const id = ensureChunk(b, name, ids.length, chunkText(times, ids.length), keys)
        if (id === null) break // no room: the rest stays in the tail, and the next save tries again
        ids.push(id)
      }
      b.silos.set(name, { ref: times, ids, keys })
      if (ids.length === 0) continue
      anySealed = true
      const n = ids.length * CHUNK_TIMES
      const gap = typeof silo.timesLost === 'number' ? silo.timesLost : 0
      onDisk[name] = { ...silo, times: times.slice(n), timesLost: gap + n, sealed: { n, ids } }
    }
    // ⚠ A save with nothing sealed is the value itself, spelled exactly as it always was.
    b.text = JSON.stringify(
      anySealed ? { ...value, state: { ...(state as object), stats: onDisk } } : value,
    )
    b.landed = writeItem(b.area, mainKey, b.text)
    b.heard = changesElsewhere(b.area)
    if (!b.landed || b.doomed.size === 0) return
    for (const [key, silo] of b.doomed)
      if (!stillSpells(b, key, saved.get(silo) ?? [])) removeItem(b.area, key)
    b.doomed.clear()
    storageSpaceFreed()
  }

  return { load, save }
}

/**
 * Remove one copy of the saved progress whole — its main key and every chunk key of that preset in
 * THAT area (rule c). Through store/storageHealth's removeItem, so a save the device refused for it
 * is forgotten with it.
 */
export function removeProgressCopy(copy: ProgressCopy): void {
  removeItem(copy.area, mainKeyOf(copy.presetId))
  for (const key of keysUnder(copy.area, familyOf(copy.presetId))) removeItem(copy.area, key)
}

/** Does this preset have chunk keys in this area? (store/presetControl, allocating a preset id.) */
export const hasTimesKeys = (copy: ProgressCopy): boolean =>
  keysUnder(copy.area, familyOf(copy.presetId)).length > 0

/**
 * Rule d, once per fresh open: delete the chunk keys of every preset that `exists` does not vouch
 * for AND that has no main key in this area (none saved, none being held). That is what an older
 * build's preset delete leaves behind — it removes the four keys it knows and no chunk.
 */
export function sweepAbandonedTimes(area: Storage, exists: (presetId: number) => boolean): void {
  const abandoned = new Map<number, boolean>()
  let freed = false
  for (const key of keysUnder(area, TIMES_KEY)) {
    const presetId = parseTimesKey(key)?.presetId
    if (presetId === undefined) continue
    if (!abandoned.has(presetId))
      abandoned.set(presetId, !exists(presetId) && readItem(area, mainKeyOf(presetId)) === null)
    if (!abandoned.get(presetId)) continue
    removeItem(area, key)
    freed = true
  }
  if (freed) storageSpaceFreed()
}
