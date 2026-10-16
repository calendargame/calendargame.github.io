// store/syncList.ts — HOW ONE WINDOW MERGES THE LOOKUP HISTORY WITH THE DEVICE (design-q1-q2.md v4, 4.2).
//
// The Lookup history is one list of entries (each with an id), newest first, shared by every preset. An
// older build writes the WHOLE list from what it loaded on every lookup, Clear, and (v2.26.0) trim to
// 100 — so its next write after another window's Clear used to bring the cleared entries back, and its
// next write after another window's lookup dropped that lookup (reviewer A's V2-F8).
//
// ★ IT IS THE MODEL, PORTED (design-q2-model/model6.mjs; 0 bad runs in 3,000 per configuration; without
// the tombstones 892 bad). The SYNC KEY holds the newest list and the TOMBSTONES — the ids every Clear
// removed (and those an older page's trim removed) — so any window resolves an older page's list:
//   1. an EMPTY older list is that page's Clear: every entry the newest list held is tombstoned;
//   2. otherwise drop from it every tombstoned entry, then UNION ALWAYS: the older list's order for its
//      entries, the newest list's entries it lacks on top, in their order — except, for a full older list
//      (TRIM_AT), the newest list's entries after its last shared one (that page's trim: tombstoned).
// A new window's Clear tombstones what it removed; its new lookup of a tombstoned entry lifts it (the
// player looked it up again). A Clear not yet saved (a full device) is cancelled ONLY BY PLAY: a list
// holding an entry this window did not know at the press, that is not its own lookup since.
// tests/syncedDoc.fuzz6 runs THIS code in the model's world, against the model's oracle.

import { type Stamp, type Clock, cmpStamp, mint, see } from './syncStamp.js'

/** An entry is anything with a string or number id; the list keeps entries whole. */
export type ListEntry = { id: string | number }
export type ListOp<E extends ListEntry> =
  | { clear?: false; id: E['id']; entry: E }
  | { clear: true; removed: E['id'][]; cancelled?: boolean }
/** The sync key: the newest list, as the newest version wrote it, and every id a Clear removed. */
export type ListKey<E extends ListEntry> = { st: Stamp; E: E[]; tomb: E['id'][] }

export interface ListShape<E extends ListEntry> {
  /** The doc's list, and the envelope's stamp (null: no envelope - an older build wrote it). */
  parse(text: string | null): { list: E[]; st: Stamp | null } | null
  write(list: E[], st: Stamp): string
  readKey(text: string | null): ListKey<E> | null
  writeKey(key: ListKey<E>): string
  /** An older build's list at or past this length was trimmed by it (v2.26.0 kept 100). */
  readonly trimAt: number
}
export interface ListIO {
  view(): { doc: string | null; side: string | null }
  save(docText: string, keyText: string): boolean
}
export interface ListHooks {
  onRead?(): void
  counter?(name: 'clearKept'): void
}

const ids = <E extends ListEntry>(l: readonly E[]) => l.map((e) => e.id)

/** The merge (pure): an older page's whole list `W` against the newest list `E` and its tombstones. */
export function resolveList<E extends ListEntry>(
  E: readonly E[],
  tomb: readonly E['id'][],
  W: readonly E[],
  trimAt: number,
): { list: E[]; tomb: E['id'][] } {
  const t = new Set(tomb)
  if (W.length === 0) return { list: [], tomb: [...new Set([...tomb, ...ids(E)])] } // that page's Clear
  const w2 = W.filter((e) => !t.has(e.id))
  const eIds = ids(E)
  const w2Ids = new Set(ids(w2))
  const shared = w2.filter((e) => eIds.includes(e.id))
  // a full older list trimmed what sat after its last shared entry in the newest list
  const lastShared = shared.length ? eIds.indexOf(shared[shared.length - 1].id) : -1
  const trimmed = W.length >= trimAt ? new Set(eIds.slice(lastShared + 1)) : new Set<E['id']>()
  const missing = E.filter((e) => !w2Ids.has(e.id) && !trimmed.has(e.id))
  // (what a trim removed is gone from the history too: another older page's stale list must not bring it back)
  return {
    list: [...missing, ...w2],
    tomb: [...new Set([...tomb, ...[...trimmed].filter((id) => !w2Ids.has(id))])],
  }
}

export class ListBook<E extends ListEntry> {
  readonly shape: ListShape<E>
  readonly io: ListIO
  readonly hooks: ListHooks
  readonly tag: string
  hlc: Clock = { m: 0, c: 0 }
  dirty: ListOp<E>[] = []
  E: E[] = []
  tomb: E['id'][] = []
  mem: E[] = []
  st: Stamp | null = null
  owes = false
  seen: { doc: string | null; side: string | null } = { doc: null, side: null }

  constructor(o: { shape: ListShape<E>; io: ListIO; tag: string; hooks?: ListHooks }) {
    this.shape = o.shape
    this.io = o.io
    this.tag = o.tag
    this.hooks = o.hooks ?? {}
  }

  readDev() {
    const view = this.io.view()
    const doc = this.shape.parse(view.doc)
    const S = this.shape.readKey(view.side)
    let kind: 'boot' | 'stamped' | 'old'
    if (!S) kind = 'boot'
    else if (doc?.st && cmpStamp(doc.st, S.st) >= 0)
      kind = 'stamped' // (the doc lands first, then the key)
    else kind = 'old'
    return { doc, S, kind, list: doc?.list ?? [] }
  }
  merge(): boolean {
    this.hooks.onRead?.()
    const d = this.readDev()
    if (d.S) see(this.hlc, d.S.st)
    if (d.doc?.st) see(this.hlc, d.doc.st)
    if (d.kind === 'boot') {
      this.E = [...d.list]
      this.tomb = []
      this.mem = this.applyOps(this.E, this.dirty)
      return false
    }
    // (v4, V3-F4) a Clear not yet saved is cancelled ONLY by play: the device's list holds an entry this
    // window did not know when it pressed Clear and that is not its own lookup since
    const own = new Set(
      this.dirty
        .filter((op): op is Extract<ListOp<E>, { id: E['id'] }> => !op.clear)
        .map((op) => op.id),
    )
    for (const op of this.dirty)
      if (op.clear && d.list.some((e) => !op.removed.includes(e.id) && !own.has(e.id)))
        op.cancelled = true
    if (this.dirty.some((op) => op.clear && !op.cancelled)) this.hooks.counter?.('clearKept')
    this.dirty = this.dirty.filter((op) => !(op.clear && op.cancelled))
    if (d.kind === 'stamped') {
      const fromKey = cmpStamp(d.S!.st, d.doc!.st!) === 0
      this.E = [...(fromKey ? d.S!.E : d.list)]
      this.tomb = [...d.S!.tomb]
      this.st = d.doc!.st
      this.mem = this.applyOps(this.E, this.dirty)
      return false
    }
    // an older page's whole list, resolved against the newest list the sync key holds
    const r = resolveList(d.S!.E, d.S!.tomb, d.list, this.shape.trimAt)
    this.E = r.list
    this.tomb = r.tomb
    this.mem = this.applyOps(this.E, this.dirty)
    return true
  }
  // own ops: a lookup puts its entry on top (or moves it); a Clear empties
  applyOps(E: readonly E[], ops: readonly ListOp<E>[]): E[] {
    let l = [...E]
    for (const op of ops) {
      if (op.clear) {
        l = []
        continue
      }
      const at = l.find((e) => e.id === op.id) ?? op.entry
      l = [at, ...l.filter((e) => e.id !== op.id)]
    }
    return l
  }
  land(): boolean {
    const before = this.hlc.c
    const beforeM = this.hlc.m
    const st = mint(this.hlc, this.tag)
    let tomb = [...this.tomb]
    for (const op of this.dirty) {
      if (op.clear) tomb = [...new Set([...tomb, ...op.removed])]
      else tomb = tomb.filter((id) => id !== op.id) // looked up again: it lives again
    }
    if (
      !this.io.save(this.shape.write(this.mem, st), this.shape.writeKey({ st, E: this.mem, tomb }))
    ) {
      this.hlc = { m: beforeM, c: before }
      return false
    }
    this.E = [...this.mem]
    this.tomb = tomb
    this.st = st
    this.dirty = []
    const v = this.io.view()
    this.seen = { doc: v.doc, side: v.side }
    return true
  }
  handle(mayLand = true, keptBefore = false): boolean {
    const v = this.io.view()
    const same = v.doc === this.seen.doc && v.side === this.seen.side
    const pending = this.dirty.length > 0 || this.owes || keptBefore
    if (same && !pending) return false
    const kept = same ? false : this.merge()
    this.seen = { doc: v.doc, side: v.side }
    if (!mayLand) return kept
    if (kept || pending) this.owes = !this.land()
    return false
  }
  open(): void {
    this.handle()
  }
  lookup(entry: E): void {
    this.dirty.push({ id: entry.id, entry })
    this.mem = this.applyOps(this.mem, [{ id: entry.id, entry }])
  }
  clear(): void {
    const removed = ids(this.mem)
    this.dirty.push({ clear: true, removed })
    this.mem = []
  }
}
