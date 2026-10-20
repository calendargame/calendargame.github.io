import type { PersistStorage, StorageValue } from 'zustand/middleware'
import type { DocKind, StoreApi } from './syncedDoc.js'
import {
  CountsBook,
  siloFp,
  siloFpOf,
  withTimes,
  type Envelope,
  type Op,
  type Silo,
} from './syncCounts.js'
import { RecordsBook, type RecOp, type Rec, type RecordsDev } from './syncRecords.js'
import { type Clock, type Stamp, newClock, mint, packSync, randomId } from './syncStamp.js'
import { createProgressCodec, type ProgressCopy } from './progressStorage.js'
import {
  PROGRESS_SILOS,
  progressShape,
  parseProgress,
  recordsDev,
  readRecKey,
  composeRecords,
  siloOfStats,
  statsOfSilo,
  markText,
  type ProgressRecKey,
} from './progressDoc.js'
import { BEST_MAPS, recordSpec, toRec, fromRec, type BestMap } from './bestRecords.js'
import { holdForDoor, releaseDoorHold } from './storageHealth.js'
import { roundClock } from '../engine/roundId.js'
import { timesHash, timesHashAppended } from '../engine/timesPool.js'
import { sameJson, isRecord } from './json.js'
import type { Stats } from '../engine/gameReducer.js'

// store/progressDoor.ts — THE SAVED PROGRESS THROUGH THE WINDOWS-IN-SYNC DOOR (design-q1-q2.md v4: 2, 4, 6.1,
// 8.2, 9.3). The progress store persists through this: one CountsBook for the five modes' stats and one
// RecordsBook per Best map, over one doc (store/progressDoc says how the doc maps onto them), landed whole -
// the doc (its chunks first), then the silos' sync key, then the records' key - or not at all.
//
// ★ ONE POOL, WHATEVER THE AMNESIC VALUE (design-amnesic-close.md): every answer, round, and Best is the
// device's, merged and written like any other. What Amnesic changes is kept INSIDE the merge: play in an
// Amnesic window anchors the slice it changes (store/syncCounts, store/syncRecords - `spec.win` names the
// window), and the forget at the next cold open puts the anchored slices back (store/amnesicClose).
// ★ A ROUND'S RESULT IS AN OP (`round`), never a record built here or on the screen: the round's own values,
// applied to the merged record (store/syncRecords' runner-ups make a take-back land on the true next value).
// ★ ANOTHER WINDOW'S CHANGE (adopt) patches exactly the slices that moved: a mode's stats (and that mode's
// engine is rebuilt on them - `spec.rebase`, store/screenPool's data epoch, in the same turn), a Best map's
// changed records. Every other slice keeps its object.
// ★ A FULL RESET (`fullReset`) writes the factory doc as a change every other window adopts - stats and
// Bests alike (8.7).

type ProgressState = {
  stats: Record<string, unknown>
  blitzBest: Record<string, unknown>
  suddenBest: Record<string, unknown>
  suddenAmBest: Record<string, unknown>
  aoxBest: Record<string, unknown>
}

/** What the door needs of the store and the app (store/progress). */
export type ProgressSpec = {
  /** The active preset, its progress key, and any preset's. */
  presetId(): number
  key(): string
  keyOf(presetId: number): string
  /** The Amnesic window play on preset `presetId` is anchored in now - null when none (store/amnesicClose). */
  win(presetId: number): string | null
  version: number
  /** The store's migration, applied to a doc saved at another version as it is read. */
  migrate(state: Record<string, unknown>, version: number): Record<string, unknown>
  /** The store's factory values. */
  defaults(): ProgressState
  /** May this doc be written (8.2: its preset is listed)? */
  gate(key: string): boolean
  /** A mode's stats came in from another window: that engine is rebuilt on them (store/screenPool). */
  rebase(silo: string): void
}

/** What the door hands this binding (store/syncedDoc's createDoor). */
export type DoorKit = {
  tag: string
  area(): Storage | null
  later(fn: () => void): void
  queueFlush(): void
  outer<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R
  /** A held save's retry, run only outside the door's calls (put off to the outermost one's return). */
  heldRetry(fn: () => boolean): () => boolean
  hidden(): boolean
  owe(fn: () => void): void
  bumpRemote(kind: DocKind): void
  register(binding: {
    kind: DocKind
    notice(key: string, oldValue: string | null, newValue: string | null): void
    flush(): void
    sync(): void
    forget(): void
  }): void
  landAll(s: Storage, writes: { key: string; text: string }[]): boolean
  syncKeyOf(docKey: string): string
  recordsKeyOf(docKey: string): string
}

export type ProgressStorage<S> = PersistStorage<S> & {
  attach(store: StoreApi<S>): void
  /** A round's result on one record of the active copy: `op` (store/bestRecords' roundOp). */
  round(map: BestMap, setup: string, op: RecOp): void
  /** Has a Reset since removed round `id` from the active copy's Bests (nothing left to Override)? */
  roundGone(map: BestMap, id: number): boolean
  /** Full Reset of the active preset's progress (8.7). */
  fullReset(): void
  /**
   * AMNESIC'S FORGET of preset `presetId`'s window `e` (design-amnesic-close.md 1; store/amnesicClose runs
   * it at a cold open): every mode anchored in it back to its anchor, and under Full (`full`) every Best
   * record too - written as one version, like any save. `touched`: something was anchored in the window
   * (put back, or a mode the forget had to leave - R17); `done`: nothing more to do (it landed, or there
   * was nothing to write) - false when the device refused it (held, and retried like any save).
   */
  forget(presetId: number, e: string, full: boolean): { touched: boolean; done: boolean }
  /**
   * Run `write` - a screen's save of mode `x`'s stats - with `at`: the stats as they stood after an
   * earlier card, with every Override since applied (engine/gameReducer's statsAtCard). An Override in it
   * of a card from before the mode's Amnesic window is a correction, not play in the window: it is made
   * on the window's anchor too, so the forget keeps it (design-amnesic-close.md 1).
   */
  correcting(x: string, at: (played: number) => Stats | null, write: () => void): void
}

type Landing = {
  outs: Partial<Record<BestMap, ReturnType<RecordsBook['prepare']>>>
  wl: Stamp | null
  prevKey: ProgressRecKey | null
  recKeyText: string | null
}
type Entry = {
  key: string
  syncKey: string
  recKey: string
  presetId: number
  copy: () => ProgressCopy | null
  counts: CountsBook
  recs: Record<BestMap, RecordsBook>
  rclock: Clock
  codec: ReturnType<typeof createProgressCodec<ProgressState>>
  parsed(text: string | null): ReturnType<typeof parseProgress>
  last: ProgressState | null
  kept: boolean
  prev: { forDoc: string | null; old: string | null | undefined }
  recSeen: { doc: string | null; rec: string | null }
  landing: Landing | null
  // The silos Amnesic's forget has put back and the next landing seals (their cut chunks go -
  // store/progressStorage's rule e).
  cut: Set<string>
}

const blankState = (spec: ProgressSpec): ProgressState => spec.defaults()
const isDefaults = (s: ProgressState, spec: ProgressSpec) =>
  sameJson(
    {
      ...s,
      stats: Object.fromEntries(PROGRESS_SILOS.map((x) => [x, siloFp(siloOfStats(s.stats?.[x]))])),
    },
    (() => {
      const d = blankState(spec)
      return {
        ...d,
        stats: Object.fromEntries(PROGRESS_SILOS.map((x) => [x, siloFp(siloOfStats(d.stats[x]))])),
      }
    })(),
  )

// What a mode's stats did, from what the store held to what it holds now: one answer (right, with its time
// or untimed, or wrong), a Reset, or anything else - an Override at any depth, or two answers in one save -
// as one whole-slice change (store/syncCounts' `rep`, which lands only on exactly what it was made on).
// ★ READ OFF FINGERPRINTS, NOTHING MADE: each candidate answer's silo is its counts and the hash its
// times would have (engine/timesPool's timesHashAppended) - never a pool built to be compared, which
// cost a sort of every time on each answer (the review lane's HIGH). The pool the store already made
// goes with the answer to the book (store/syncCounts' withTimes).
function opsOf(prev: Silo, next: Silo): { reset: true } | { ops: Op[] } | null {
  const nextFp = siloFp(next)
  if (siloFp(prev) === nextFp) return null
  if (next.pl === 0 && next.gd === 0 && next.t.length === 0 && prev.pl > 0) return { reset: true }
  const wrong = { ...prev, pl: prev.pl + 1, sk: 0 }
  const sk = prev.sk + 1
  const right = { ...prev, pl: prev.pl + 1, gd: prev.gd + 1, sk, bs: Math.max(prev.bs, sk) }
  const n = prev.t.length
  if (siloFpOf(wrong, n, timesHash(prev.t)) === nextFp)
    return { ops: [{ kind: 'a', r: false, tm: null }] }
  if (siloFpOf(right, n, timesHash(prev.t)) === nextFp)
    return { ops: [{ kind: 'a', r: true, tm: null }] }
  if (next.t.length === n + 1) {
    const tm = next.t[n]
    if (siloFpOf(right, n + 1, timesHashAppended(prev.t, tm)) === nextFp)
      return { ops: [withTimes({ kind: 'a', r: true, tm }, next.t)] }
  }
  return { ops: [{ kind: 'rep', from: prev, to: next }] }
}

// What a record became, from what the store held to what it holds now, when the change came from a write
// of the map itself (a seed, a copy - never a round: rounds come as ops): an op per round that holds a
// field now (its values where it holds one), and a take-back of every round that held one and holds none.
function recordOps(map: BestMap, before: Rec | null, after: Rec | null): RecOp[] {
  const spec = recordSpec(map)
  const ops = new Map<number, RecOp>()
  const empty = { v: spec.empty }
  for (const f of spec.fields) {
    const q = after?.f[f]
    if (!q || q.id === null || !spec.present(q.v)) continue
    const op = ops.get(q.id) ?? {
      id: q.id,
      v: Object.fromEntries(spec.fields.map((g) => [g, empty])),
    }
    op.v[f] = { v: q.v, ...(q.c !== undefined ? { c: q.c } : {}) }
    ops.set(q.id, op)
  }
  for (const f of spec.fields) {
    const q = before?.f[f]
    if (q && q.id !== null && !ops.has(q.id))
      ops.set(q.id, {
        id: q.id,
        v: Object.fromEntries(spec.fields.map((g) => [g, empty])),
        ov: true,
      })
  }
  return [...ops.values()]
}

const PARSED_KEPT = 4
export function makeProgressStorage<S>(kit: DoorKit, spec: ProgressSpec): ProgressStorage<S> {
  const entries = new Map<string, Entry>()
  let store: StoreApi<S> | null = null
  let adopting = false
  // (a screen's save of one mode's stats in progress, and how to read them as they stood after an earlier
  // card - ★ correcting)
  let correction: { x: string; at: (played: number) => Stats | null } | null = null
  const area = () => kit.area()
  // AN OVERRIDE OF A CARD FROM BEFORE THE MODE'S AMNESIC WINDOW is a correction, not play in it: the
  // window's anchor - the stats as they stood just before the window - is read again with the Override
  // applied, and the whole-slice change carries it (store/syncCounts' `ca`). An Override of a card INSIDE
  // the window reads the anchor back unchanged; a point the screen's history does not reach (every card it
  // holds is after the anchor) gives nothing to correct.
  const corrected = (
    e: Entry,
    x: string,
    op: Extract<Op, { kind: 'rep' }>,
    at: (played: number) => Stats | null,
  ): void => {
    const a = (e.counts.mem[x]?.v as Silo | undefined)?.a
    const s = a ? at(a.pl) : null
    if (!a || !s) return
    const v = siloOfStats(s)
    op.ca = {
      e: a.e,
      st: a.st,
      pl: v.pl,
      gd: v.gd,
      sk: v.sk,
      bs: v.bs,
      n: v.t.length,
      h: timesHash(v.t),
      tl: a.tl,
    }
  }

  const make = (key: string, presetId: number): Entry => {
    const syncKey = kit.syncKeyOf(key)
    const recKey = kit.recordsKeyOf(key)
    // (the last few texts read, parsed: a notice reads the device's text, the one it replaced, and the one
    // this window last saw - three texts, each read again by every map's records - and a parse expands
    // every mode's solve times from their chunks)
    const cache = new Map<string | null, ReturnType<typeof parseProgress>>()
    const e = {
      key,
      syncKey,
      recKey,
      presetId,
      copy: () => {
        const s = area()
        return s ? { area: s, presetId } : null
      },
      rclock: newClock(),
      codec: createProgressCodec<ProgressState>(),
      last: null,
      kept: false,
      prev: { forDoc: null, old: undefined },
      recSeen: { doc: null, rec: null },
      landing: null,
      cut: new Set(),
    } as unknown as Entry
    e.parsed = (text) => {
      const known = cache.get(text)
      if (known) {
        cache.delete(text)
        cache.set(text, known) // (the most recent last)
        return known
      }
      const s = area()
      const p = s
        ? parseProgress(s, presetId, text, spec.migrate, spec.version)
        : { env: null, version: null }
      cache.set(text, p)
      if (cache.size > PARSED_KEPT) cache.delete(cache.keys().next().value!)
      return p
    }
    const shape = progressShape({
      parsed: (t) => e.parsed(t),
      compose: (silos, sync, full) => compose(e, silos, sync, full),
    })
    const win = () => spec.win(presetId)
    e.counts = new CountsBook({
      shape,
      tag: kit.tag,
      win,
      io: {
        view: () => {
          const s = area()
          const doc = s?.getItem(key) ?? null
          return {
            doc,
            side: s?.getItem(syncKey) ?? null,
            prevDoc: e.prev.forDoc === doc ? e.prev.old : undefined,
          }
        },
        deviceKey: () => area()?.getItem(syncKey) ?? null,
        save: (doc, keyText) => save(e, doc as StorageValue<ProgressState>, keyText),
      },
    })
    e.counts.open()
    e.recs = {} as Record<BestMap, RecordsBook>
    for (const map of BEST_MAPS)
      e.recs[map] = new RecordsBook({
        spec: recordSpec(map),
        tag: kit.tag,
        clock: roundClock,
        hlc: e.rclock,
        win,
        io: { view: () => recView(e, map), deviceKey: () => deviceRecKey(e)?.maps?.[map] ?? null },
      })
    mergeRecords(e)
    return e
  }
  const deviceRecKey = (e: Entry) => readRecKey(area()?.getItem(e.recKey) ?? null)
  const countsG = (e: Entry): string | null =>
    e.counts.shape.readKey(area()?.getItem(e.syncKey) ?? null)?.g ?? null
  const recView = (e: Entry, map: BestMap): RecordsDev => {
    const s = area()
    return recordsDev(map, e.parsed(s?.getItem(e.key) ?? null).env, deviceRecKey(e), countsG(e))
  }
  // the records' merge, when the device moved since they last read it
  const mergeRecords = (e: Entry): boolean => {
    const s = area()
    const view = { doc: s?.getItem(e.key) ?? null, rec: s?.getItem(e.recKey) ?? null }
    if (view.doc === e.recSeen.doc && view.rec === e.recSeen.rec) return false
    let changed = false
    for (const map of BEST_MAPS) changed = e.recs[map].merge() || changed
    e.recSeen = view
    return changed
  }
  const recordsOwe = (e: Entry) => BEST_MAPS.some((m) => e.recs[m].owes())
  const owing = (e: Entry) =>
    e.counts.owes || Object.keys(e.counts.dirty).length > 0 || recordsOwe(e)

  // ── writing ──
  // The doc as a landing writes it: the silos the CountsBook hands over - each it writes as a version with
  // this landing's write mark - and every Best map as the landing's records say.
  // (the object, never a text: save seals it - its solve times into chunks - and spells the text itself)
  function compose(
    e: Entry,
    silos: Record<string, unknown>,
    sync: Envelope,
    full: Envelope,
  ): StorageValue<ProgressState> {
    const L = e.landing!
    const s = area()
    const device = e.parsed(s?.getItem(e.key) ?? null).env
    const { maps, rec } = composeRecords(L.outs, device, L.prevKey)
    const stats: Record<string, unknown> = {}
    for (const x of PROGRESS_SILOS) {
      const v = silos[x]
      const entry = full.at[x] as { unres?: Stamp } | undefined
      stats[x] = L.wl && isRecord(v) && entry && !entry.unres ? { ...v, wl: markText(L.wl) } : v
    }
    L.recKeyText = recKeyText(e, L, e.counts.g)
    return {
      state: { stats, ...maps } as unknown as ProgressState,
      version: spec.version,
      sync: {
        ...(JSON.parse(packSync(sync)) as object),
        ...(Object.keys(rec).length ? { rec } : {}),
      },
    } as StorageValue<ProgressState>
  }
  // The records' key a landing writes - or null when it is what the device has.
  const recKeyText = (e: Entry, L: Landing, g: string | null): string | null => {
    const maps = { ...(L.prevKey?.maps ?? {}) }
    let moved = false
    for (const map of BEST_MAPS) {
      const k = L.outs[map]?.key
      if (k) {
        maps[map] = k
        moved = true
      }
    }
    const gen = g ?? L.prevKey?.g ?? 'g' + kit.tag + randomId(6)
    // (no record anywhere yet: no key; one that already says this: none written)
    if (!moved && (!L.prevKey || L.prevKey.g === gen)) return null
    return packSync({ g: gen, maps })
  }
  // The landing's writes, in order: the doc (sealed - its chunks first), the silos' key, the records' key.
  function save(e: Entry, doc: StorageValue<ProgressState>, keyText: string): boolean {
    const s = area()
    const copy = e.copy()
    if (!s || !copy) return true
    // (the copy as the device has it, so the chunks a reset or an older build's plain save left are judged)
    e.codec.follow(copy)
    const sealed = e.codec.seal(copy, doc, e.cut)
    e.cut = new Set() // (a landing the device refuses keeps them doomed in the codec, for the next)
    const before = s.getItem(e.key)
    const writes = [
      { key: e.key, text: sealed.text },
      { key: e.syncKey, text: keyText },
      ...(e.landing?.recKeyText ? [{ key: e.recKey, text: e.landing.recKeyText }] : []),
    ]
    const ok = kit.landAll(s, writes)
    sealed.finish(ok)
    if (ok) e.prev = { forDoc: sealed.text, old: before }
    return ok
  }
  // One landing of everything owed: the records prepared, the write mark minted after them (so it is above
  // every version they write - a page that loaded this doc loaded after them), the CountsBook landing the
  // doc that carries both.
  function land(e: Entry): boolean {
    const outs: Landing['outs'] = {}
    const clock0 = { ...e.rclock }
    for (const map of BEST_MAPS) outs[map] = e.recs[map].prepare()
    const wl = mint(e.rclock, kit.tag)
    e.landing = { outs, wl, prevKey: deviceRecKey(e), recKeyText: null }
    const ok = e.counts.land()
    for (const map of BEST_MAPS) {
      const out = outs[map]
      if (!out) continue
      if (ok) e.recs[map].landed(out)
      else e.recs[map].refused()
    }
    if (!ok) Object.assign(e.rclock, clock0)
    else e.recSeen = { doc: area()?.getItem(e.key) ?? null, rec: area()?.getItem(e.recKey) ?? null }
    e.landing = null
    return ok
  }
  // ── settling: merge, then land what is owed ──
  const activeEntry = (): Entry | null => entries.get(spec.key()) ?? null
  const open = (key: string, presetId = spec.presetId()): Entry => {
    const had = entries.get(key)
    if (had && owing(had)) return had
    const e = make(key, presetId)
    entries.set(key, e)
    return e
  }
  const settle = (e: Entry, mayLand: boolean, keptBefore = false): boolean => {
    const kept = e.counts.handle(false, keptBefore)
    const rkept = mergeRecords(e)
    if (!mayLand) return kept || rkept
    if (kept || rkept || keptBefore || owing(e)) {
      if (!spec.gate(e.key)) {
        // (8.2) the doc's preset is gone: nothing is written for it, and nothing it owed is kept
        const s = area()
        if (s) releaseDoorHold(s, e.key)
        entries.delete(e.key)
        return false
      }
      e.counts.owes = !land(e)
    }
    hold(e)
    return false
  }
  const hold = (e: Entry) => {
    const s = area()
    if (!s) return
    if (owing(e)) {
      // (what a read of the key shows while the save is held: the doc as this window holds it)
      const held = { ...blankState(spec), ...booksState(e) }
      holdForDoor(
        s,
        e.key,
        JSON.stringify({ state: held, version: spec.version }),
        kit.heldRetry(() => {
          settle(e, true)
          adopt(e)
          return !owing(e)
        }),
      )
      return
    }
    releaseDoorHold(s, e.key)
    if (e !== activeEntry()) entries.delete(e.key)
  }

  // ── the store's side ──
  const storeState = (): ProgressState => store!.getState() as unknown as ProgressState
  const recordOf = (e: Entry, map: BestMap, setup: string) =>
    fromRec(map, e.recs[map].recs[setup]?.mem ?? null, false)
  // what the books hold, as the store holds it
  const booksState = (e: Entry): Partial<ProgressState> => {
    const out: Partial<ProgressState> = {}
    out.stats = Object.fromEntries(
      PROGRESS_SILOS.map((x) => [x, statsOfSilo(e.counts.mem[x].v as Silo)]),
    )
    for (const map of BEST_MAPS) {
      const m: Record<string, unknown> = {}
      for (const k of Object.keys(e.recs[map].recs)) {
        const r = recordOf(e, map, k)
        if (r) m[k] = r
      }
      out[map] = m
    }
    return out
  }
  const adopt = (e: Entry) => {
    if (!store || e !== activeEntry()) return
    if (kit.hidden()) {
      kit.owe(() => adopt(e))
      return
    }
    const cur = storeState()
    const patch: Partial<ProgressState> = {}
    const moved: string[] = []
    const stats = { ...cur.stats }
    for (const x of PROGRESS_SILOS) {
      const v = e.counts.mem[x].v as Silo
      if (siloFp(v) !== siloFp(siloOfStats(cur.stats[x]))) {
        stats[x] = statsOfSilo(v)
        moved.push(x)
      }
    }
    if (moved.length) patch.stats = stats
    for (const map of BEST_MAPS) {
      const next = { ...cur[map] }
      let changed = false
      for (const k of new Set([...Object.keys(e.recs[map].recs), ...Object.keys(cur[map])])) {
        const r = recordOf(e, map, k)
        if (sameJson(r, cur[map][k])) continue
        if (r === undefined) delete next[k]
        else next[k] = r
        changed = true
      }
      if (changed) patch[map] = next
    }
    if (!Object.keys(patch).length) return
    adopting = true
    try {
      store.setState(patch as unknown as Partial<S>)
    } finally {
      adopting = false
    }
    e.last = { ...cur, ...patch } as ProgressState
    for (const x of moved) spec.rebase(x)
    kit.bumpRemote('progress')
  }

  const binding = {
    kind: 'progress' as DocKind,
    notice(key: string, oldValue: string | null, newValue: string | null) {
      for (const e of entries.values()) {
        if (key !== e.key && key !== e.syncKey && key !== e.recKey) continue
        if (key === e.key) e.prev = { forDoc: newValue, old: oldValue }
        e.kept = settle(e, false) || e.kept
        kit.queueFlush()
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
  kit.register(binding)

  return {
    attach(s) {
      store = s
    },
    getItem: kit.outer((): StorageValue<S> | null => {
      const key = spec.key()
      const e = open(key)
      const s = area()
      const docText = s?.getItem(key) ?? null
      if (docText === null && !e.counts.g) {
        e.last = blankState(spec)
        return null
      }
      const state = { ...blankState(spec), ...booksState(e) } as ProgressState
      e.last = state
      return { state: state as unknown as S, version: spec.version }
    }),
    setItem: kit.outer((_name: string, value: StorageValue<S>) => {
      const next = value.state as unknown as ProgressState
      if (adopting) {
        const e = activeEntry()
        if (e) e.last = next
        return
      }
      const e = entries.get(spec.key()) ?? open(spec.key())
      const prev = e.last ?? blankState(spec)
      e.last = next
      const fix = correction
      correction = null
      settle(e, false) // catch up with the device first (a notice may not have come yet)
      // A Full Reset by way of the store (every value back to the factory's): every silo and every Best
      if (isDefaults(next, spec) && !isDefaults(prev, spec)) {
        for (const x of PROGRESS_SILOS) e.counts.reset(x)
        for (const map of BEST_MAPS) e.recs[map].reset()
      } else {
        for (const x of PROGRESS_SILOS) {
          const d = opsOf(siloOfStats(prev.stats[x]), siloOfStats(next.stats[x]))
          if (!d) continue
          if ('reset' in d) e.counts.reset(x)
          else
            for (const op of d.ops) {
              if (op.kind === 'rep' && fix?.x === x) corrected(e, x, op, fix.at)
              e.counts.answer(x, op)
            }
        }
        for (const map of BEST_MAPS)
          for (const k of new Set([
            ...Object.keys(prev[map] ?? {}),
            ...Object.keys(next[map] ?? {}),
          ])) {
            if (sameJson(prev[map]?.[k], next[map]?.[k])) continue
            const before = toRec(map, prev[map]?.[k], 'store', `${map}|${k}`)
            const after = toRec(map, next[map]?.[k], 'store', `${map}|${k}`)
            for (const op of recordOps(map, before, after)) e.recs[map].op(k, op)
          }
      }
      settle(e, true)
      kit.later(() => adopt(e))
    }),
    removeItem() {
      // (a preset's progress is removed with its preset - store/presetControl)
    },
    round: kit.outer((map: BestMap, setup: string, op: RecOp) => {
      if (!store) return
      const e = entries.get(spec.key()) ?? open(spec.key())
      settle(e, false)
      e.recs[map].op(setup, op)
      settle(e, true)
      adopt(e)
    }),
    roundGone(map, id) {
      const e = activeEntry()
      return !!e && e.recs[map].roundDead(id)
    },
    forget: kit.outer((presetId: number, win: string, full: boolean) => {
      const key = spec.keyOf(presetId)
      const e = entries.get(key) ?? open(key, presetId)
      settle(e, false) // (the device as it is now: an older tab's cards since included)
      const { restored: silos, skipped } = e.counts.forgetWindow(win)
      for (const x of silos) e.cut.add(x)
      const recs = full ? BEST_MAPS.flatMap((map) => e.recs[map].forgetWindow(win)) : []
      const touched = silos.length + skipped.length + recs.length > 0
      if (!silos.length && !recs.length) {
        hold(e) // (nothing to write: an entry for another preset goes with it)
        return { touched, done: true }
      }
      if (!spec.gate(e.key)) {
        entries.delete(e.key)
        return { touched, done: true }
      }
      e.counts.owes = !land(e)
      hold(e)
      adopt(e)
      return { touched, done: !e.counts.owes }
    }),
    correcting(x, at, write) {
      correction = { x, at }
      try {
        write()
      } finally {
        correction = null
      }
    },
    fullReset: kit.outer(() => {
      const key = spec.key()
      const e = entries.get(key) ?? open(key)
      settle(e, false)
      // the doc's factory values as a change every window adopts
      for (const x of PROGRESS_SILOS) e.counts.reset(x)
      for (const map of BEST_MAPS) e.recs[map].reset()
      if (!spec.gate(e.key)) entries.delete(e.key)
      else {
        e.counts.owes = !land(e)
        hold(e)
      }
      if (!store) return
      adopting = true
      try {
        store.setState(blankState(spec) as unknown as Partial<S>)
      } finally {
        adopting = false
      }
      e.last = blankState(spec)
    }),
  }
}
