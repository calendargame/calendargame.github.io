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
export const syncKeyOf = (docKey: string): string => `cg-sync-v1|${docKey}`
export const isSyncKey = (key: string): boolean => key.startsWith('cg-sync-v1|')

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
type StoreApi<S> = { getState: () => S; setState: (partial: Partial<S>) => void }

interface Binding {
  readonly kind: DocKind
  readonly docKey: () => string
  /** A notice for this doc's key or its sync key: merge (no write yet). */
  notice(key: string, oldValue: string | null): void
  /** Write what the notices left owed, and patch the store with what they brought. */
  flush(): void
  /** Read the device as it is now (a return from hidden, a missed notice) and settle. */
  sync(): void
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

export function createDoor(env: DoorEnv) {
  const tag = env.tag ?? randomId(6)
  // 6.5: a HIDDEN window merges into its books at once and patches its stores once, on its return
  // (after its own rounds that ran out have ended - store/windowSync's clocks first).
  let hidden = false
  const adoptOwed = new Set<() => void>()
  const later = env.later ?? ((fn: () => void) => queueMicrotask(fn))
  const bindings: Binding[] = []
  let flushQueued = false
  const queueFlush = () => {
    if (flushQueued) return
    flushQueued = true
    // Notices are handled in the order they come; a window writes once it has handled the last one
    // queued (2.7: an older page's Full Reset writes a middle state and then removes the doc in one
    // task, and the middle state must never be re-asserted over the removal).
    setTimeout(() => {
      flushQueued = false
      for (const b of bindings) b.flush()
    }, 0)
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
        return landBoth(s, docKey, docText, syncKey, keyText)
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
      if (book.owes) holdForDoor(s, docKey, shape.write(book.mem, book.st ?? ZERO), retry)
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
      docKey: () => docKey,
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
      setItem(_name, value) {
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
      },
      removeItem() {
        // (nothing removes the Lookup history's key: a Clear is a list of nothing)
      },
    }
  }

  return {
    tag,
    listStorage,
    /** A `storage` event: the key another window changed, and what it held before. */
    notice(key: string | null, oldValue: string | null) {
      if (key === null) {
        for (const b of bindings) b.sync()
        return
      }
      for (const b of bindings) b.notice(key, oldValue)
    },
    /** Read every doc as the device holds it now, and settle (a return from hidden; 2.7). */
    syncAll() {
      for (const b of bindings) b.sync()
    },
    /** The window went into the background (true) or came back (false: what was owed is patched). */
    setHidden(on: boolean) {
      hidden = on
      if (on) return
      const owed = [...adoptOwed]
      adoptOwed.clear()
      for (const fn of owed) fn()
    },
  }
}

// THE LANDING (2.2): the doc, then its key — both, or neither. If the key is refused, the doc is put
// back ONLY if the device still holds exactly what this window wrote (otherwise another window's write
// is there, newer, and stays); if even the put-back is refused, the doc stays with its envelope naming
// a version the key lacks — readers take the envelope's newer version — and the save is held.
function landBoth(
  s: Storage,
  docKey: string,
  docText: string,
  syncKey: string,
  keyText: string,
): boolean {
  const before = s.getItem(docKey)
  if (before !== docText && !tryWriteItem(s, docKey, docText)) return false
  if (s.getItem(syncKey) === keyText || tryWriteItem(s, syncKey, keyText)) {
    // A write just fit: anything held may fit now too (store/storageHealth) - retried once this save is
    // wholly done, never inside it (a retry is another write, and this save's book is still settling).
    setTimeout(storageSpaceFreed, 0)
    return true
  }
  if (s.getItem(docKey) === docText && before !== docText) {
    try {
      if (before === null) removeItem(s, docKey)
      else if (!tryWriteItem(s, docKey, before))
        captureError(
          new Error('Saved data: a doc could not be put back after its sync key was refused'),
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

const openLocal = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** THIS window's door. */
export const door = createDoor({ storage: openLocal })
