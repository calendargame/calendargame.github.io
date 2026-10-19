// store/syncedDoc.ts — THE DOOR EVERY SAVED DOC GOES THROUGH, so that windows of the app stay in sync
// (design-q1-q2.md v4, D1 and 2.6-2.7).
//
// THE ROOT CAUSE IT REMOVES. A persisted store used to write its WHOLE copy of the data on every save,
// so a window that had loaded earlier saved over something newer from another window ("last save
// wins"). Every persisted localStorage doc now goes through this one door instead. Before every write,
// and on every notice that another window wrote, it merges that doc with the device — store/syncCounts
// for counts and settings, store/syncList for the Lookup history — and writes only what it can prove:
// this window's own un-landed actions re-applied on top of the newest version.
//
// HOW A STORE MEETS IT. A store's zustand `persist` storage is an adapter made here. Its getItem opens
// the doc's BOOK (what this window knows of the doc) and hands the store what the book holds; its
// setItem works out what the store's change WAS — diffed against the store's previous value, never
// against the book (B V8: a book can move while its store waits) — records it as actions, and lands
// it. When the merge brings in another window's change, the store is PATCHED with exactly the changed
// slices (adopt), and the door bumps that doc's `remoteEpoch` in the same turn (6.2: a remote change
// does in each screen what the same local change does there).
//
// ★ A LOAD WRITES NOTHING, AND AN IDLE WINDOW WRITES NOTHING (G7). Opening a book is a read; a notice
// of a change that leaves nothing of this window's to land writes nothing.
// ★ A REFUSED WRITE IS KEPT AS ACTIONS, NOT TEXT (5). The book keeps its un-landed actions;
// store/storageHealth is told the place is held (the storage-full notice, `unsaved`) with the door's own
// retry, which merges with the device as it is THEN before it writes.
// ⚠ ONE DOOR PER WINDOW (`door`, below). Tests make their own with createDoor, over a storage of their
// own, to play two windows in one process.

import { ListBook, type ListEntry, type ListOp, type ListShape } from './syncList.js'
import {
  CountsBook,
  type CountsIO,
  type CountsShape,
  type Envelope,
  type SyncKey,
} from './syncCounts.js'
import { sameJson } from './json.js'
// (types only: store/progressDoor builds the progress binding ON this door's kit - store/progress calls it
// with `progressKit` - so this file never loads it, and the module cycle through the presets door it would
// close does not exist)
import type { DoorKit } from './progressDoor.js'
import { type Stamp, ZERO, packSync, unpackSync, randomId } from './syncStamp.js'
import {
  holdForDoor,
  releaseDoorHold,
  tryWriteItem,
  removeItem,
  storageSpaceFreed,
} from './storageHealth.js'
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { create } from 'zustand'
import { captureError } from '../observability/sentry.js'

/** The sync key of a doc: no older build reads or writes it. */
export const SYNC_KEY_PREFIX = 'cg-sync-v1|'
export const syncKeyOf = (docKey: string): string => `${SYNC_KEY_PREFIX}${docKey}`
export const isSyncKey = (key: string): boolean => key.startsWith(SYNC_KEY_PREFIX)
// …and the progress doc's second one, its Best records' key (store/progressDoc), beside the first.
const RECORDS_KEY_SUFFIX = '|rec'
export const recordsKeyOf = (docKey: string): string => `${syncKeyOf(docKey)}${RECORDS_KEY_SUFFIX}`
/** The doc a sync key (or a records' key) belongs to - null for a key that is neither. */
export const docKeyOfSyncKey = (key: string): string | null => {
  if (!isSyncKey(key)) return null
  const rest = key.slice(SYNC_KEY_PREFIX.length)
  return rest.endsWith(RECORDS_KEY_SUFFIX) ? rest.slice(0, -RECORDS_KEY_SUFFIX.length) : rest
}
/** Every key the door keeps beside a doc: its sync key, and its records' key (a doc may have none). */
export const syncKeysOf = (docKey: string): string[] => [syncKeyOf(docKey), recordsKeyOf(docKey)]

// ── remoteEpoch: "this doc changed because ANOTHER window changed it" (6.2, B V3) ─────────────────
// One number per doc kind, bumped in the same turn as the store patch it explains. A screen that has
// to react to a remote change the way it reacts to the same local one (components/useSettingsCloseEffect's
// third case, a silo's engine rebase) keys on it — never on "changed while the panel was closed", which
// local changes also do.
export type DocKind =
  | 'progress'
  | 'settings'
  | 'modePrefs'
  | 'userDefaults'
  | 'julianRange'
  | 'registry'
  | 'lookup'
export const useRemoteEpoch = create<Record<DocKind, number>>()(() => ({
  progress: 0,
  settings: 0,
  modePrefs: 0,
  userDefaults: 0,
  julianRange: 0,
  registry: 0,
  lookup: 0,
}))
const bumpRemote = (kind: DocKind) =>
  useRemoteEpoch.setState((s) => ({ ...s, [kind]: s[kind] + 1 }))

// ── The stores' side ──────────────────────────────────────────────────────────────────────────
export type StoreApi<S> = { getState: () => S; setState: (partial: Partial<S>) => void }

interface Binding {
  readonly kind: DocKind
  /** A notice for this doc's key or its sync key - what it held before, and holds now: merge (no write yet). */
  notice(key: string, oldValue: string | null, newValue: string | null): void
  /** Write what the notices left owed, and patch the store with what they brought. */
  flush(): void
  /** Read the device as it is now (a return from hidden, a missed notice) and settle. */
  sync(): void
  /** Forget every book ("the page was closed": the test harness, which has no close). */
  forget(): void
}

export interface DoorEnv {
  /** The storage area the docs live in — null when the browser refuses it. */
  storage(): Storage | null
  /** This window's tag (in every stamp it mints). */
  tag?: string
  /** Run `fn` after the current store update has returned (a patch never runs inside a `set`). */
  later?(fn: () => void): void
}

export type Door = ReturnType<typeof createDoor>

/** How a counts-and-settings doc maps onto its store (countsStorage). */
export type CountsSpec = {
  kind: DocKind
  /** The doc's key now (a per-preset doc: the active preset's) - null when there is none. */
  key: () => string | null
  /** The store's persist version, written into the doc as every build writes it. */
  version: number
  /** What the store holds for a slice where the doc has no value (its factory value) - and what a
   *  doc this window writes says for it, so a doc is always whole. `key`: the doc's (a per-preset
   *  doc's default can be that preset's own - store/presets' presetFieldsSpec `perPreset`). */
  defaultOf(x: string, key?: string): unknown
  /** The doc's slices, given every slice name seen (this window's, the device doc's, the key's). */
  regs: (seen: readonly string[]) => readonly string[]
  /** The store's persisted state as slice values, and back (what getItem hands the store). */
  toSlices(state: Record<string, unknown>): Record<string, unknown>
  fromSlices(slices: Record<string, unknown>): Record<string, unknown>
  /** A doc's stored state as slice values, and back (how the slices sit in the doc's text). */
  sliceState(docState: Record<string, unknown>): Record<string, unknown>
  docState(slices: Record<string, unknown>): Record<string, unknown>
  /** The store patch that brings another window's change in (`now`: every slice as the store would
   *  hold it; `changed`: the slices that moved) - null for nothing to patch. */
  patchOf(now: Record<string, unknown>, changed: readonly string[]): Record<string, unknown> | null
  /** How the patch reaches the store, where that is more than a setState (the preset registry's: a
   *  window whose preset was deleted elsewhere moves off it, store/presetControl's adoptRegistry). */
  apply?(patch: Record<string, unknown>): void
  /** This doc's own rules after a merge (the preset registry's membership, design 8.1): slice values to
   *  set, as the store would hold them - or null. */
  reconcile?(
    before: Record<string, unknown>,
    now: Record<string, unknown>,
    device: Record<string, unknown> | null,
  ): Record<string, unknown> | null
  /** May this doc be written now (design 8.2: a per-preset doc only while its preset is listed)? A doc
   *  that may not is not written, and what this window had not landed of it is dropped. */
  gate?(key: string): boolean
  /** A slice whose value carries its own version tag (store/syncCounts' CountsShape.tagged). */
  tagged?(x: string, v: unknown): boolean
  /** The slices the store holds (default: every one): a slice it does not (a field a newer build
   *  wrote) is never changed by the store's saves - it is kept as the doc has it. */
  owned?(x: string): boolean
  /** A doc saved at another version (an older build's shape) in this build's shape: applied as the
   *  doc is READ, so every merge, and the store, only ever see this build's shape. */
  migrate?(docState: Record<string, unknown>, version: number): Record<string, unknown>
}
export type CountsStorage<S> = PersistStorage<S> & {
  attach(store: StoreApi<S>): void
  /** Save `value` only if the device takes it now; false - nothing changed anywhere (2.6's trySave). */
  trySave(value: StorageValue<S>): boolean
  /** Change some slices of the doc at `key` (another preset's), as a local change of that doc. */
  saveFor(key: string, patch: Record<string, unknown>): void
  /** Write the doc at `key` for a preset not listed yet (a copy being made) only if the device takes
   *  it now; false - nothing written, nothing held. */
  trySaveNew(key: string, values: Record<string, unknown>): boolean
  /** Merge the active doc with the device now (the registry before an allocation, 8.5). */
  syncNow(): void
  /** Merge the active doc with the device now and return its slices; the store is patched after the
   *  caller's turn (the registry, read by a per-preset doc's gate in the middle of that doc's save). */
  mergeNow(): Record<string, unknown> | null
  /** The active doc's slices as this window's book holds them (null: not opened). */
  slices(): Record<string, unknown> | null
}
type CountsEntry = {
  key: string
  syncKey: string
  shape: CountsShape
  book: CountsBook
  last: Record<string, unknown> | null
  kept: boolean
  prev: { forDoc: string | null; old: string | null | undefined }
  refresh: () => void
}

export function createDoor(env: DoorEnv) {
  const tag = env.tag ?? randomId(6)
  // 6.5: a HIDDEN window merges into its books at once and patches its stores once, on its return
  // (after its own rounds that ran out have ended - store/windowSync's clocks first).
  let hidden = false
  const adoptOwed = new Set<() => void>()
  const later = env.later ?? ((fn: () => void) => queueMicrotask(fn))
  const bindings: Binding[] = []
  // ★ A WRITE THAT FITS MAY MEAN ROOM FOR WHAT IS HELD (store/storageHealth's storageSpaceFreed) - and
  // the held saves are retried the moment the door's OUTERMOST call returns: never inside it (a retry
  // is another save, and the book that just landed is still settling; another doc's retry landing in
  // the middle of this one's would be read back as another window's write), never a turn later (the
  // player's next save would race it).
  let depth = 0
  let freed = false
  const landed = () => {
    freed = true
  }
  const outer =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      depth++
      try {
        return fn(...a)
      } finally {
        depth--
        if (depth === 0 && freed) {
          freed = false
          storageSpaceFreed()
        }
      }
    }
  // A HELD SAVE'S RETRY (store/storageHealth's holdForDoor) runs only OUTSIDE the door's calls. A write this
  // window makes inside one through store/storageHealth (the session copy, a chunk's removal) can free room,
  // and storageHealth retries what it holds at once - but a retry landing there would act on a store in the
  // middle of a change (a setter's new value not yet in its book: the retry's adopt would put the old one
  // back). Inside a call it is put off to the moment the outermost one returns, as a landing's is.
  const heldRetry = (fn: () => boolean) => (): boolean => {
    if (depth > 0) {
      freed = true
      return false
    }
    return outer(fn)()
  }
  let flushQueued = false
  const queueFlush = () => {
    if (flushQueued) return
    flushQueued = true
    // Notices are handled in the order they come; a window writes once it has handled the last one
    // queued (2.7: an older page's Full Reset writes a middle state and then removes the doc in one
    // task, and the middle state must never be re-asserted over the removal).
    setTimeout(
      outer(() => {
        flushQueued = false
        for (const b of bindings) b.flush()
      }),
      0,
    )
  }

  // ── THE LOOKUP HISTORY (store/syncList; design 4.2) ──
  function listStorage<E extends ListEntry, S extends Record<string, unknown>>(spec: {
    kind: DocKind
    key: string
    version: number
    field: keyof S & string
    normalize: (entries: unknown) => E[]
    trimAt: number
  }): PersistStorage<S> & { attach(store: StoreApi<S>): void; book(): ListBook<E> | null } {
    const docKey = spec.key
    const syncKey = syncKeyOf(docKey)
    const shape: ListShape<E> = {
      trimAt: spec.trimAt,
      parse(text) {
        if (text == null) return null
        try {
          const o = JSON.parse(text) as { state?: Record<string, unknown>; sync?: unknown }
          const st = o.sync
            ? ((unpackSync(JSON.stringify(o.sync)) as { st?: Stamp }).st ?? null)
            : null
          return { list: spec.normalize(o.state?.[spec.field]), st }
        } catch {
          return { list: [], st: null }
        }
      },
      write: (list, st) =>
        JSON.stringify({
          state: { [spec.field]: list },
          version: spec.version,
          sync: JSON.parse(packSync({ st })),
        }),
      readKey(text) {
        if (text == null) return null
        try {
          const k = unpackSync(text) as { st: Stamp; E: unknown; tomb: E['id'][] }
          return { st: k.st, E: spec.normalize(k.E), tomb: Array.isArray(k.tomb) ? k.tomb : [] }
        } catch {
          return null
        }
      },
      writeKey: (k) => packSync(k),
    }
    let store: StoreApi<S> | null = null
    let book: ListBook<E> | null = null
    let last: E[] | null = null
    // a notice merged something this window still has to write back (flush)
    let kept = false
    const area = () => env.storage()
    const io = {
      view: () => {
        const s = area()
        return { doc: s?.getItem(docKey) ?? null, side: s?.getItem(syncKey) ?? null }
      },
      save(docText: string, keyText: string) {
        const s = area()
        if (!s) return true
        return landBoth(s, docKey, docText, syncKey, keyText, landed)
      },
    }
    const open = (): ListBook<E> => {
      if (!book) {
        book = new ListBook<E>({ shape, io, tag })
        book.open()
      }
      return book
    }
    // A (re)hydration: the book is read afresh from the device - unless it still owes a save, whose
    // actions are kept and merged instead.
    const reopen = (): ListBook<E> => {
      if (book?.owes) {
        book.handle(true)
        return book
      }
      book = null
      return open()
    }
    const sameList = (a: readonly E[], b: readonly E[]) =>
      a.length === b.length && a.every((e, i) => JSON.stringify(e) === JSON.stringify(b[i]))
    // what the store's change WAS, as actions on the list
    const diff = (prev: readonly E[], next: readonly E[]): ListOp<E>[] => {
      if (sameList(prev, next)) return []
      if (next.length === 0) return [{ clear: true, removed: prev.map((e) => e.id) }]
      const [top, ...rest] = next
      const without = prev.filter((e) => e.id !== top.id)
      if (sameList(rest, without)) return [{ id: top.id, entry: top }]
      // anything else: what the store now holds, spelled as a Clear and the lookups that rebuild it
      return [
        { clear: true, removed: prev.map((e) => e.id) },
        ...[...next].reverse().map((e) => ({ id: e.id, entry: e })),
      ]
    }
    const adopt = () => {
      if (!store || !book) return
      if (hidden) {
        adoptOwed.add(adopt)
        return
      }
      const now = book.mem
      const shown = (store.getState()[spec.field] as E[] | undefined) ?? []
      if (sameList(now, shown)) return
      last = now
      store.setState({ [spec.field]: now } as unknown as Partial<S>)
      bumpRemote(spec.kind)
    }
    const settle = () => {
      const s = area()
      if (!s || !book) return
      if (book.owes)
        holdForDoor(s, docKey, shape.write(book.mem, book.st ?? ZERO), heldRetry(retry))
      else releaseDoorHold(s, docKey)
    }
    const retry = (): boolean => {
      if (!book) return true
      book.handle(true)
      adopt()
      return !book.owes
    }
    const binding: Binding = {
      kind: spec.kind,
      notice(key) {
        if (!book || (key !== docKey && key !== syncKey)) return
        kept = book.handle(false) || kept
        queueFlush()
      },
      flush() {
        if (!book) return
        book.handle(true, kept)
        kept = false
        adopt()
        settle()
      },
      sync() {
        if (!book) return
        book.handle(true)
        adopt()
        settle()
      },
      forget() {
        book = null
        last = null
        kept = false
      },
    }
    bindings.push(binding)
    return {
      attach(s: StoreApi<S>) {
        store = s
      },
      book: () => book,
      getItem(): StorageValue<S> | null {
        const b = reopen()
        last = spec.normalize(b.mem)
        return { state: { [spec.field]: last } as unknown as S, version: spec.version }
      },
      setItem: outer((_name: string, value: StorageValue<S>) => {
        const b = open()
        const next = spec.normalize((value.state as Record<string, unknown>)[spec.field])
        const prev = last ?? []
        last = next
        const ops = diff(prev, next)
        if (!ops.length && !b.owes) return
        // catch up with the device first (a notice may not have come yet), then the change, then land
        b.handle(false)
        for (const op of ops) {
          if (op.clear) b.clear()
          else b.lookup(op.entry)
        }
        b.owes = !b.land()
        settle()
        if (!sameList(b.mem, next)) later(adopt)
      }),
      removeItem() {
        // (nothing removes the Lookup history's key: a Clear is a list of nothing)
      },
    }
  }

  // ── COUNTS AND SETTINGS (store/syncCounts): every doc but the Lookup history ──
  // A doc's slices come from the store's persisted state and go back into it (the spec's toSlices /
  // fromSlices); how they sit inside the doc's text is the doc's own (sliceState / docState). A
  // per-preset doc has one book per preset's key: the store is on the active preset's, and a book it
  // left with a save still owed stays, detached, merging and retrying until that save lands (5).
  function countsStorage<S>(spec: CountsSpec): CountsStorage<S> {
    const entries = new Map<string, CountsEntry>()
    let store: StoreApi<S> | null = null
    let adopting = false

    const area = () => env.storage()
    // what the store holds for a slice whose value the book has - its default where the doc has none
    const asStored = (x: string, v: unknown, key: string) =>
      v === undefined ? spec.defaultOf(x, key) : v
    const valuesOf = (e: CountsEntry): Record<string, unknown> =>
      Object.fromEntries(e.book.SL.map((x) => [x, asStored(x, e.book.mem[x].v, e.key)]))
    const make = (key: string): CountsEntry => {
      const syncKey = syncKeyOf(key)
      const e = {
        key,
        syncKey,
        last: null,
        kept: false,
        prev: { forDoc: null, old: undefined },
      } as unknown as CountsEntry
      let regs: readonly string[] = []
      const shape: CountsShape = {
        silos: [],
        get regs() {
          return regs
        },
        absentOf: (x) => spec.defaultOf(x, key),
        ...(spec.tagged ? { tagged: spec.tagged } : {}),
        parse(text) {
          if (text == null) return null
          try {
            const o = JSON.parse(text) as { state?: unknown; sync?: unknown; version?: unknown }
            let docState =
              o.state && typeof o.state === 'object' ? (o.state as Record<string, unknown>) : {}
            if (spec.migrate && typeof o.version === 'number' && o.version !== spec.version)
              docState = spec.migrate(docState, o.version)
            const sync = o.sync ? (unpackSync(JSON.stringify(o.sync)) as Envelope) : null
            return { state: spec.sliceState(docState), sync }
          } catch {
            return { state: {}, sync: null }
          }
        },
        silo: () => {
          throw new Error('syncedDoc: this doc has no silos')
        },
        diskSilo: () => {
          throw new Error('syncedDoc: this doc has no silos')
        },
        write: (state, sync) =>
          JSON.stringify({
            state: spec.docState(
              Object.fromEntries(Object.entries(state).map(([x, v]) => [x, asStored(x, v, key)])),
            ),
            version: spec.version,
            sync: JSON.parse(packSync(sync)),
          }),
        readKey(text) {
          if (text == null) return null
          try {
            return unpackSync(text) as SyncKey
          } catch {
            return null
          }
        },
        writeKey: (k) => packSync(k),
      }
      // The slices the doc has NOW: the doc's own rule over every name this window holds, the device's
      // doc shows, and the device's key names.
      e.refresh = () => {
        const s = area()
        const dev = shape.parse(s?.getItem(key) ?? null)?.state ?? {}
        const k = shape.readKey(s?.getItem(syncKey) ?? null)
        regs = spec.regs([
          ...Object.keys(e.book?.mem ?? {}),
          ...Object.keys(e.last ?? {}),
          ...Object.keys(dev),
          ...Object.keys(k?.at ?? {}),
        ])
      }
      const io: CountsIO = {
        view: () => {
          e.refresh()
          const s = area()
          const doc = s?.getItem(key) ?? null
          return {
            doc,
            side: s?.getItem(syncKey) ?? null,
            prevDoc: e.prev.forDoc === doc ? e.prev.old : undefined,
          }
        },
        deviceKey: () => area()?.getItem(syncKey) ?? null,
        save(docText, keyText) {
          const s = area()
          if (!s) return true
          const before = s.getItem(key)
          const ok = landBoth(s, key, docText, syncKey, keyText, landed)
          if (ok) e.prev = { forDoc: docText, old: before }
          return ok
        },
      }
      e.shape = shape
      e.refresh()
      e.book = new CountsBook({ shape, io, tag })
      e.book.open()
      // This doc's own rules apply to what a window opens on as well (an older tab's delete of a preset
      // is read at a load) - as an action this window will land with its next write, never at the load
      // itself (G7).
      const fix = spec.reconcile?.(
        valuesOf(e),
        valuesOf(e),
        shape.parse(area()?.getItem(key) ?? null)?.state ?? null,
      )
      if (fix) for (const [x, v] of Object.entries(fix)) e.book.setReg(x, v)
      return e
    }
    const activeEntry = (): CountsEntry | null => {
      const key = spec.key()
      return key === null ? null : (entries.get(key) ?? null)
    }
    const owing = (e: CountsEntry) => e.book.owes || Object.keys(e.book.dirty).length > 0
    const open = (key: string): CountsEntry => {
      const had = entries.get(key)
      // a (re)hydration reads the doc afresh - unless the book still owes a save (its actions stay)
      if (had && owing(had)) return had
      const e = make(key)
      entries.set(key, e)
      return e
    }
    // merge with the device, put right what this doc's own rules say, and land what is owed
    const settle = (e: CountsEntry, mayLand: boolean, keptBefore = false): boolean => {
      const before = valuesOf(e)
      let kept = e.book.handle(false, keptBefore)
      const fix = spec.reconcile?.(
        before,
        valuesOf(e),
        e.shape.parse(area()?.getItem(e.key) ?? null)?.state ?? null,
      )
      if (fix)
        for (const [x, v] of Object.entries(fix))
          if (!sameJson(asStored(x, e.book.mem[x]?.v, e.key), v)) {
            e.book.setReg(x, v)
            kept = true
          }
      if (!mayLand) return kept
      if (kept || keptBefore || owing(e)) {
        if (spec.gate && !spec.gate(e.key)) {
          // (8.2) the doc's preset is gone: nothing is written for it, and nothing it owed is kept
          const s = area()
          if (s) releaseDoorHold(s, e.key)
          entries.delete(e.key)
          return false
        }
        e.book.owes = !e.book.land()
      }
      hold(e)
      return false
    }
    const hold = (e: CountsEntry) => {
      const s = area()
      if (!s) return
      if (e.book.owes) {
        const text = JSON.stringify({ state: spec.docState(valuesOf(e)), version: spec.version })
        holdForDoor(
          s,
          e.key,
          text,
          heldRetry(() => {
            settle(e, true)
            adopt(e)
            return !e.book.owes
          }),
        )
        return
      }
      releaseDoorHold(s, e.key)
      // a detached book whose save has landed is let go
      if (e !== activeEntry()) entries.delete(e.key)
    }
    const adopt = (e: CountsEntry) => {
      if (!store || e !== activeEntry()) return
      if (hidden) {
        adoptOwed.add(() => adopt(e))
        return
      }

      const now = valuesOf(e)
      const shown = e.last ?? {}
      const changed = Object.keys(now).filter((x) => !sameJson(now[x], shown[x]))
      const patch = changed.length ? spec.patchOf(now, changed) : null
      if (!patch || !Object.keys(patch).length) return
      adopting = true
      try {
        if (spec.apply) spec.apply(patch)
        else store.setState(patch as Partial<S>)
      } finally {
        adopting = false
      }
      bumpRemote(spec.kind)
    }
    const binding: Binding = {
      kind: spec.kind,
      notice(key, oldValue, newValue) {
        for (const e of entries.values()) {
          if (key !== e.key && key !== e.syncKey) continue
          if (key === e.key) e.prev = { forDoc: newValue, old: oldValue }
          e.kept = settle(e, false) || e.kept
          queueFlush()
        }
      },
      flush() {
        for (const e of [...entries.values()]) {
          const kept = e.kept
          e.kept = false
          settle(e, true, kept)
          adopt(e)
        }
      },
      sync() {
        for (const e of [...entries.values()]) {
          e.prev = { forDoc: null, old: undefined }
          settle(e, true)
          adopt(e)
        }
      },
      forget() {
        entries.clear()
      },
    }
    bindings.push(binding)
    // what the store's change WAS: the slices whose values moved since the store's previous value
    const changesOf = (e: CountsEntry, value: StorageValue<S>): string[] => {
      const next = spec.toSlices(value.state as Record<string, unknown>)
      const prev = e.last ?? valuesOf(e)
      e.last = next
      return [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter(
        (x) => (spec.owned?.(x) ?? true) && !sameJson(prev[x], next[x]),
      )
    }
    return {
      attach(s) {
        store = s
      },
      getItem(): StorageValue<S> | null {
        const key = spec.key()
        if (key === null) return null
        const e = open(key)
        e.last = valuesOf(e)
        const docText = area()?.getItem(key) ?? null
        if (docText === null && !e.book.g) return null
        // (in this build's shape whatever version the doc was saved at: spec.migrate, as it is read)
        return {
          state: spec.fromSlices(
            Object.fromEntries(e.book.SL.map((x) => [x, e.book.mem[x].v])),
          ) as S,
          version: spec.version,
        }
      },
      setItem: outer((_name: string, value: StorageValue<S>) => {
        const key = spec.key()
        if (key === null) return
        const e = entries.get(key) ?? open(key)
        if (adopting) {
          e.last = spec.toSlices(value.state as Record<string, unknown>)
          return
        }
        const changed = changesOf(e, value)
        if (!changed.length && !owing(e)) return
        settle(e, false) // catch up with the device first (a notice may not have come yet)
        const next = e.last!
        e.refresh()
        for (const x of changed) e.book.setReg(x, next[x])
        settle(e, true)
        const now = valuesOf(e)
        if (Object.keys(now).some((x) => !sameJson(now[x], next[x]))) later(() => adopt(e))
      }),
      removeItem() {
        // (a store's own doc is removed with its preset - store/presetControl, through removeDoc)
      },
      // A change of some slices of the doc at `key` - another preset's doc, written as a local change of
      // it (merged with the device first; held if the device refuses it) without that preset being
      // opened: a value one preset's pill sets for another (store/settings' writePresetAmnesic).
      saveFor: outer((key: string, patch: Record<string, unknown>) => {
        const e = entries.get(key) ?? open(key)
        settle(e, false)
        e.refresh()
        for (const [x, v] of Object.entries(spec.toSlices(patch))) e.book.setReg(x, v)
        settle(e, true)
        if (e === activeEntry()) later(() => adopt(e))
      }),
      // ★ A DOC FOR A PRESET NOT LISTED YET (design 8.6: a duplicate's stores, written as VALUES through
      // the door - fresh versions, fresh stamps, the doc's own generation - never bytes). 8.2's gate is
      // for a preset the list has dropped; this one is about to be listed (store/presetControl lists it
      // the moment every store of it is on the device, and takes them back off if the list will not fit).
      // Tried like trySave: refused, nothing is written and nothing held.
      trySaveNew: outer((key: string, values: Record<string, unknown>): boolean => {
        const e = entries.get(key) ?? open(key)
        settle(e, false)
        e.refresh()
        const memBefore = { ...e.book.mem }
        const dirtyBefore = { ...e.book.dirty }
        for (const [x, v] of Object.entries(spec.toSlices(values))) e.book.setReg(x, v)
        const ok = e.book.land()
        if (!ok) {
          e.book.mem = memBefore
          e.book.dirty = dirtyBefore
        }
        if (e !== activeEntry()) entries.delete(e.key)
        return ok
      }),
      trySave: outer((value: StorageValue<S>): boolean => {
        const key = spec.key()
        if (key === null) return true
        const e = entries.get(key) ?? open(key)
        const lastBefore = e.last
        const changed = changesOf(e, value)
        if (!changed.length) return true
        settle(e, false)
        const next = e.last!
        e.refresh()
        const memBefore = { ...e.book.mem }
        const dirtyBefore = { ...e.book.dirty }
        for (const x of changed) e.book.setReg(x, next[x])
        if (spec.gate && !spec.gate(e.key)) {
          entries.delete(e.key) // (8.2: nothing is written for a preset that is gone)
          return false
        }
        if (e.book.land()) {
          hold(e)
          return true
        }
        e.book.mem = memBefore
        e.book.dirty = dirtyBefore
        e.last = lastBefore
        return false
      }),
      syncNow: outer(() => {
        const e = activeEntry()
        if (!e) return
        settle(e, true)
        adopt(e)
      }),
      mergeNow: outer((): Record<string, unknown> | null => {
        const key = spec.key()
        if (key === null) return null
        const e = entries.get(key) ?? open(key)
        settle(e, true)
        later(() => adopt(e))
        return valuesOf(e)
      }),
      slices() {
        const e = activeEntry()
        return e ? valuesOf(e) : null
      },
    }
  }

  // ── THE SAVED PROGRESS (store/progressDoor): its own binding, on this door's machinery (the kit) ──
  const progressKit: DoorKit = {
    tag,
    area: () => env.storage(),
    later,
    queueFlush,
    outer,
    heldRetry,
    hidden: () => hidden,
    owe: (fn) => adoptOwed.add(fn),
    bumpRemote,
    register: (b) => {
      bindings.push(b)
    },
    landAll: (s, writes) => landAll(s, writes, landed),
    syncKeyOf,
    recordsKeyOf,
  }
  return {
    tag,
    listStorage,
    countsStorage,
    progressKit,
    /** A `storage` event: the key another window changed, what it held before, and what it holds now. */
    notice: outer((key: string | null, oldValue: string | null, newValue: string | null = null) => {
      if (key === null) {
        for (const b of bindings) b.sync()
        return
      }
      for (const b of bindings) b.notice(key, oldValue, newValue)
    }),
    /** Read every doc as the device holds it now, and settle (a return from hidden; 2.7). */
    syncAll: outer(() => {
      for (const b of bindings) b.sync()
    }),
    /**
     * Forget every book, i.e. "the page was closed". The app never needs this - a close drops the
     * books with the page - but the test harness has no close, so tests/setup/dom.js calls it before
     * every test (as it forgets the storage health).
     */
    forget() {
      for (const b of bindings) b.forget()
      adoptOwed.clear()
      hidden = false
    },
    /** The window went into the background (true) or came back (false: what was owed is patched). */
    setHidden: outer((on: boolean) => {
      hidden = on
      if (on) return
      const owed = [...adoptOwed]
      adoptOwed.clear()
      for (const fn of owed) fn()
    }),
  }
}

// THE LANDING (2.2): the doc, then its key (and, for the progress doc, the records' key after it) — all,
// or none. A write already on the device is not made again. If a later write is refused, each earlier one
// is put back ONLY if the device still holds exactly what this window wrote (otherwise another window's
// write is there, newer, and stays); if even the put-back is refused, the doc stays with its envelope
// naming a version the keys lack — readers take the envelope's newer version — and the save is held.
function landAll(s: Storage, writes: { key: string; text: string }[], landed: () => void): boolean {
  const before = writes.map((w) => s.getItem(w.key))
  let wrote = false
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    if (before[i] === w.text) continue
    if (tryWriteItem(s, w.key, w.text)) {
      wrote = true
      continue
    }
    for (let j = i - 1; j >= 0; j--) {
      const p = writes[j]
      if (before[j] === p.text || s.getItem(p.key) !== p.text) continue
      try {
        if (before[j] === null) removeItem(s, p.key)
        else if (!tryWriteItem(s, p.key, before[j]!))
          captureError(
            new Error('Saved data: a write could not be put back after a later one was refused'),
            {
              tripwire: 'syncPutBack',
            },
          )
      } catch {
        /* the put-back itself refused: the envelope names the newer version (2.2) */
      }
    }
    return false
  }
  // (a write just fit: what is held is retried once the door's outermost call returns)
  if (wrote) landed()
  return true
}
const landBoth = (
  s: Storage,
  docKey: string,
  docText: string,
  syncKey: string,
  keyText: string,
  landed: () => void,
): boolean =>
  landAll(
    s,
    [
      { key: docKey, text: docText },
      { key: syncKey, text: keyText },
    ],
    landed,
  )

const openLocal = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** THIS window's door. */
export const door = createDoor({ storage: openLocal })
