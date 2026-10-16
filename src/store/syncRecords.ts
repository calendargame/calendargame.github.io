// store/syncRecords.ts — HOW ONE WINDOW MERGES THE BEST RECORDS OF A PROGRESS DOC WITH THE DEVICE
// (design-q1-q2.md v4, 4.1: windows stay in sync).
//
// THE PROBLEM. A Best record (a Blitz Best Score and Best Streak, a MoX best mean and median, …) is
// written by every window and every older tab that plays a round. A tab that loaded earlier writes its
// whole stale copy back; an older tab takes back its own round with an Override; a Reset in one window
// must not be undone by another; and a take-back must land on the true next value, not on whatever the
// tab began its round on. This file is the merge: per record, per field, the best of the rounds that
// still stand, held by the first round to reach it.
//
// ★ IT IS THE MODEL, PORTED. Every rule below was found and gated by running design-q2-model's
// model5.mjs (one record, two fields, against older pages that behave as v2.26-v2.29 do) and is ported
// from its new-window half function for function, with the model's names kept so the two can be read
// side by side: readDev, holds, resolve, cancelReset, merge, land, applyOp, insertAlt, removeRound.
// tests/syncedDoc.records.fuzz runs THIS code in the model's world, against the model's own judge.
//
// WHAT A RECORD IS, TO THIS FILE (the FIELD FORM): per field `{ v, c?, id }` — the value, its companion
// (the Best Score round's streak, the best mean's median: the app's records carry one), and the round
// that holds it — plus, where 4.1 keeps them, the RUNNER-UPS `x` (the best values of other rounds since
// the last Reset, so a take-back lands on the true next value), the held-history `hn` (the new windows'
// rounds a new window overrode), and `ol`/`olLoad` (the round the last older literal named for a field,
// and which load it came from). How a record sits in the doc is the caller's (a `RecordShape`).
// What a field's values MEAN is a `RecordSpec`: which are better, which say "no record".
//
// THE DOC-LEVEL STATE. A Reset (the app's Full Reset of the progress doc) and an older tab's Full Reset
// (the doc removed) act on every record at once, so the Reset bounds — `dead` (the round id the
// resetting window would have drawn at its press), `deadIds` (every round it knew then), the Reset
// waiting for room, `gone` — are the book's, and every record reads them.
//
// ⚠ THE ORACLE'S HOOKS ARE THE TEST'S, NEVER THE APP'S (`hooks`): the app passes none, and no decision
// here reads anything a hook supplies.

import { type Stamp, type Clock, cmpStamp, mint, see, cyrb53, canonicalJson } from './syncStamp.js'

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────────

/** One field of a record: the value, its companion, and the round that holds it (`n`: a new window's). */
export type FV = { v: number | null; c?: number | null; id: number | null; n?: true }
/** A record in field form (★ above). */
export type Rec = {
  f: Record<string, FV>
  x?: Record<string, FV[]>
  hn?: Record<string, number[]>
  ol?: Record<string, number | null>
  olLoad?: Record<string, string>
}
/** A new window's op on a record: a round's values (an Override of it: `ov`; a value no record keeps,
 *  `null` or the empty value, takes the round out of that field). */
export type RecOp = {
  id: number
  v: Record<string, { v: number | null; c?: number | null }>
  ov?: true
}

/** What a record's field values mean (the app: per Best map; the fuzz: the model's two counts). */
export interface RecordSpec {
  readonly fields: readonly string[]
  /** A field with no record. */
  readonly empty: number | null
  /** Is `b` strictly better than `a`? */
  better(a: number | null, b: number | null): boolean
  /** Is `v` a value a record keeps (not the empty one)? */
  present(v: number | null): boolean
  /** Are `a` and `b` the same value (as the mode compares them)? */
  same(a: number | null, b: number | null): boolean
}

/** One record as the device shows it (the shape's reading of the doc and its envelope). */
export type RecDisk = {
  /** The record in the doc (null: none), in field form. */
  rec: Rec | null
  /** An object a new build wrote and nobody has changed since (its tag still names its values). */
  tagged: boolean
  /** The doc's envelope entry for it. */
  env: { st: Stamp; fp: string } | null
}
/** One record's entry in the records' key. */
export type RecKeyEntry = { st: Stamp; fp: string; ps: Stamp | null; rec: Rec | null }
/** The records' key: every record's newest version, and the Reset bounds. */
export type RecordsKey = {
  at: Record<string, RecKeyEntry>
  dead: number
  deadSt: Stamp | null
  deadIds: number[]
  hi: number
  gone: number
  open: Record<string, number | null>
}
/** The device, as one read of it shows the records. */
export type RecordsDev = {
  docPresent: boolean
  /** The doc carries an envelope (a writeKept literal keeps the DEVICE's: it says nothing of the page). */
  env: boolean
  /** Which load the stats beside the records come from: a new build's write mark, or none. */
  stTag: Stamp | null
  /** The stats are the bytes from before the first new save (no write mark, not rebuilt). */
  stBoot: boolean
  /** The stats were rebuilt from defaults (an older build's Full Reset). */
  stFresh: boolean
  S: RecordsKey | null
  recs: Record<string, RecDisk>
}
/** What a landing writes for the records (the caller puts them in the doc, its envelope and the key). */
export type RecordsOut = {
  /** Per record: its value in the doc - a version (tagged), a pass-through literal with this window's
   *  rounds on top (untagged, naming them), or the device's bytes left exactly as they are (`keep`). */
  doc: Record<string, RecOutDoc>
  /** Per record: its envelope entry (absent: a pass-through - no version). */
  env: Record<string, { st: Stamp; fp: string }>
  /** The records' key - null when this landing writes no version (every record passes through). */
  key: RecordsKey | null
  /** This landing's stamp (null: no version written). */
  st: Stamp | null
  /** (the book's own: what each version record holds once this lands) */
  mem: Record<string, Rec | null>
  /** (the book's own: the records written as pass-throughs) */
  passed: string[]
}
export type RecOutDoc =
  | { keep?: undefined; rec: Rec | null; tagged: boolean; ops?: RecOp[]; nr?: number[] }
  | { keep: true }

/** The fuzz oracle's hooks (tests/helpers/syncModel/world5). Never set by the app. */
export interface RecordsHooks {
  onMint?(): void
  onLanded?(book: RecordsBook, ops: RecOp[], resets: number | false, st: Stamp): void
  onPassThrough?(book: RecordsBook, ops: RecOp[]): void
  onGone?(book: RecordsBook, bound: number): void
  counter?(name: 'resetKept' | 'xPruned'): void
  /** The model's ablations, for the judge's own test: a rule turned off must be caught. */
  without?: { takeBack?: boolean; alts?: boolean }
}

/** The window's round-id clock (engine/roundId): the highest id it has seen, and the id it would draw. */
export interface RoundClock {
  hi: number
  /** The id a round begun now would get (never consumed). */
  peek(): number
}

/** The number of runner-ups kept per field. */
export const ALT = 3

// ── ROUND IDS THAT ARE NOT THE CLOCK'S (part2-issues #5) ──
// v2.27.3 onward number a round from the wall clock (ms x 1024 plus ten random bits); a new build from its
// hybrid clock (engine/roundId). v2.26.0 numbered them with a COUNTER from 1 per mount of the screen - below
// every Reset's bound, and the same in every load. Such an id means nothing outside the load it came from,
// so a record's reader SCOPES it to that load: what every window holds, writes and kills is
// scopedRoundId(load, counter), at or above SCOPED_ROUND_ID, which no clock reaches for a century (2^52 ms
// x 1024 is the year 2109). A scoped id is never compared with a Reset's bound - only `deadIds`, the rounds
// the resetting window knew, kill it - and it never moves a window's round clock.
/** An id below this is a v2.26.0 counter. */
export const COUNTER_ROUND_ID = 2 ** 40
/** A scoped id (a counter, with the load it came from) is at or above this. */
export const SCOPED_ROUND_ID = 2 ** 52
/** A v2.26.0 counter `n`, scoped to the load `load` (loadKeyOf) it came from. */
export const scopedRoundId = (load: string, n: number): number =>
  SCOPED_ROUND_ID + (parseInt(cyrb53(`${load}#${n}`), 36) % 2 ** 50)
/** Is `id` a round id a Reset's bound and the round clock speak for (a clock's, not a scoped counter)? */
export const clockRoundId = (id: number): boolean => id < SCOPED_ROUND_ID
/** Which load a doc's stats come from: a new build's write mark, the bytes of before the first new save,
 *  or a doc rebuilt from defaults. */
export const loadKeyOf = (stTag: Stamp | null, stBoot: boolean): string =>
  stTag ? `${stTag.m}.${stTag.c}.${stTag.t}` : stBoot ? 'boot' : 'fresh'
const clone = <T>(o: T): T => (o === undefined ? o : (JSON.parse(JSON.stringify(o)) as T))
const cmpSt = cmpStamp

/** A record's fingerprint: every field's value, companion and holder. */
export function fpRec(spec: RecordSpec, r: Rec | null | undefined): string {
  if (!r) return 'none'
  return spec.fields
    .map((f) => {
      const q = r.f[f]
      return `${q.v}${q.c !== undefined ? `~${q.c}` : ''}@${q.id}`
    })
    .join('|')
}
/** The self-verifying tag a new build writes inside a record (issue #1 of part2-issues): the hash of the
 *  record's own values, so a record an older build CHANGED while keeping the tag reads as changed. */
export const recordTag = (values: Record<string, unknown>): string =>
  cyrb53(canonicalJson(Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'w'))))

// One record's state in this window.
type RState = {
  held: Rec | null
  st: Stamp | null
  mem: Rec | null
  dirty: RecOp[]
  unres: { rec: Rec | null } | null
  prov: boolean
  ownRounds: Set<number>
  resetBase: Stamp | null
  playPend: boolean
}

export interface RecordsIO {
  /** The window's copy of the device. */
  view(): RecordsDev
  /** The records' key as the DEVICE holds it right now (a landing builds on it). */
  deviceKey(): RecordsKey | null
}

// ── The book: one window's knowledge of the Best records of one doc ──────────────────────────────

export class RecordsBook {
  readonly spec: RecordSpec
  readonly io: RecordsIO
  readonly hooks: RecordsHooks
  readonly tag: string
  readonly clock: RoundClock
  hlc: Clock = { m: 0, c: 0 }
  recs: Record<string, RState> = {}
  // the doc-level state (★ above)
  dead = 0
  deadSt: Stamp | null = null
  deadIds: number[] = []
  resetPending: number | false = false
  preResetDead = 0
  preResetDeadSt: Stamp | null = null
  preResetDeadIds: number[] = []
  pressKnown: Set<number> = new Set()
  litSeen: Set<number> = new Set()
  goneSt: Stamp | null = null
  goneSeen = 0
  lastRound: number | null = null
  private preHlc: Clock | null = null

  constructor(o: {
    spec: RecordSpec
    io: RecordsIO
    tag: string
    clock: RoundClock
    hooks?: RecordsHooks
  }) {
    this.spec = o.spec
    this.io = o.io
    this.tag = o.tag
    this.clock = o.clock
    this.hooks = o.hooks ?? {}
  }

  // ── field arithmetic ──
  private EMPTY = (): FV => ({ v: this.spec.empty, id: null })
  private order = (a: FV, b: FV): number =>
    this.spec.better(b.v, a.v) ? -1 : this.spec.better(a.v, b.v) ? 1 : 0
  private sameFV = (a: FV, v: { v: number | null; c?: number | null }) =>
    this.spec.same(a.v, v.v) && (a.c ?? null) === (v.c ?? null)
  private top(q: FV | undefined): FV {
    if (!q || !this.spec.present(q.v)) return this.EMPTY()
    return {
      v: q.v,
      ...(q.c !== undefined ? { c: q.c } : {}),
      id: q.id,
      ...(q.n ? { n: true as const } : {}),
    }
  }
  // a field with its runner-ups: insert a round's value (strict improvement takes the top; ties keep order)
  insertAlt(fld: FV, alts: FV[], e: FV): { fld: FV; alts: FV[] } {
    const prev = [fld, ...alts].find((q) => q.id !== null && q.id === e.id)
    const ent: FV = prev?.n || e.n ? { ...e, n: true } : e
    // (v4, V3-F3) a tie stays with the round that got there FIRST - the one already in the list: never
    // decided by round ids, which follow the clocks. A round whose value did not change keeps its place; a
    // round whose value changed reaches its new value now, after the others.
    const all =
      prev && this.sameFV(prev, e)
        ? [fld, ...alts].filter((q) => q.id !== null).map((q) => (q.id === e.id ? ent : q))
        : [...[fld, ...alts].filter((q) => q.id !== null && q.id !== e.id), ent]
    all.sort(this.order) // (stable)
    const alt = this.hooks.without?.alts ? false : true
    return {
      fld: this.top(all[0]),
      alts: alt ? all.slice(1, 1 + ALT).filter((q) => this.spec.present(q.v)) : [],
    }
  }
  removeRound(fld: FV, alts: FV[], id: number): { fld: FV; alts: FV[] } {
    const all = [fld, ...alts].filter((q) => q.id !== null && q.id !== id)
    all.sort(this.order) // (stable: ties keep the order they arrived in)
    return { fld: all[0] ? this.top(all[0]) : this.EMPTY(), alts: all.slice(1) }
  }
  // An op on the held record: a round's value for every field (a new round, or an Override of it)
  applyOp(rec: Rec | null, op: RecOp): Rec | null {
    const F = this.spec.fields
    const r: Rec = rec
      ? clone(rec)
      : {
          f: Object.fromEntries(F.map((f) => [f, this.EMPTY()])),
          x: Object.fromEntries(F.map((f) => [f, [] as FV[]])),
        }
    r.x ??= Object.fromEntries(F.map((f) => [f, [] as FV[]]))
    for (const f of F) {
      const val = op.v[f] ?? { v: this.spec.empty }
      r.x[f] ??= []
      // an Override of a round already counted moves it (up or down); a value no record keeps removes it;
      // the same value again (an op re-applied) leaves it where it stands
      const same = [r.f[f], ...r.x[f]].find((q) => q.id === op.id)
      const cur =
        same && this.sameFV(same, val)
          ? { fld: r.f[f], alts: r.x[f] }
          : this.removeRound(r.f[f], r.x[f], op.id)
      const ent: FV = {
        v: val.v,
        ...(val.c !== undefined ? { c: val.c } : {}),
        id: op.id,
        n: true,
      }
      const nx = this.spec.present(val.v) ? this.insertAlt(cur.fld, cur.alts, ent) : cur
      r.f[f] = nx.fld
      r.x[f] = this.hooks.without?.alts ? [] : nx.alts.slice(0, ALT)
      // (compact) only a round a new window OVERRODE goes in the held-history: every other round's value
      // in any copy is its true one
      if (op.ov) {
        r.hn ??= Object.fromEntries(F.map((g) => [g, [] as number[]]))
        r.hn[f] ??= []
        if (!r.hn[f].includes(op.id)) r.hn[f].push(op.id)
      }
    }
    return F.every((f) => r.f[f].id === null) ? null : r
  }

  // ── round ids and the Reset bounds ──
  private isDead = (id: number) => this.deadIds.includes(id)
  private addDead(ids: Iterable<number> | undefined) {
    this.deadIds = [...new Set([...this.deadIds, ...(ids ?? [])])]
  }
  private knownIdsOf(...recs: (Rec | null | undefined)[]): number[] {
    return recs
      .filter((r): r is Rec => !!r)
      .flatMap((r) =>
        this.spec.fields.flatMap((f) => [
          r.f?.[f]?.id,
          ...(r.x?.[f] ?? []).map((q) => q.id),
          ...(r.hn?.[f] ?? []),
        ]),
      )
      .filter((id): id is number => typeof id === 'number')
  }
  // the highest round id a window knows: every id in what it reads
  private seeIds(rec: Rec | null | undefined) {
    if (!rec) return
    const ids = [
      ...this.spec.fields.flatMap((f) => [
        rec.f?.[f]?.id,
        ...(rec.x?.[f] ?? []).map((q) => q.id),
        ...(rec.hn?.[f] ?? []),
        rec.ol?.[f],
      ]),
    ]
    for (const id of ids)
      if (typeof id === 'number' && clockRoundId(id) && id > this.clock.hi) this.clock.hi = id
  }
  private seeHi(n: number | undefined) {
    if (typeof n === 'number' && n - 1 > this.clock.hi) this.clock.hi = n - 1
  }
  private loadKey(d: RecordsDev): string {
    return loadKeyOf(d.stTag, d.stBoot)
  }
  private newMint(): Stamp {
    this.hooks.onMint?.()
    return mint(this.hlc, this.tag)
  }

  // ── per-record state ──
  rec(k: string): RState {
    return (this.recs[k] ??= {
      held: null,
      st: null,
      mem: null,
      dirty: [],
      unres: null,
      prov: false,
      ownRounds: new Set(),
      resetBase: null,
      playPend: false,
    })
  }
  // what this window shows: its own un-landed rounds on top of what it holds - or, under a Reset waiting
  // for room, on top of the empty record that Reset makes (v4)
  private rebuildMem(r: RState, base: Rec | null): Rec | null {
    return r.dirty.reduce<Rec | null>(
      (m, op) => this.applyOp(m, op),
      this.resetPending ? null : base,
    )
  }
  // (compact) the doc's values with the extras of the version they belong to
  private withExtras(rec: Rec | null, from: Rec | null | undefined): Rec | null {
    if (!rec) return null
    const r: Rec = { f: clone(rec.f) }
    if (from?.x) r.x = clone(from.x)
    if (from?.hn) r.hn = clone(from.hn)
    if (from?.ol) r.ol = clone(from.ol)
    if (from?.olLoad) r.olLoad = clone(from.olLoad)
    return r
  }
  // a window holds the newest version when it holds that version - or when it saw an older page's Full
  // Reset remove the doc that version lived in
  private holds(r: RState, newest: { st: Stamp } | null): boolean {
    return (
      !newest ||
      (!!r.st && cmpSt(r.st, newest.st) === 0) ||
      (!!this.goneSt && cmpSt(this.goneSt, newest.st) === 0)
    )
  }

  // RESOLVE an older page's record against the version held, field by field
  private resolve(r: RState, d: RecordsDev, k: string, kind: string): Rec | null {
    const F = this.spec.fields
    const h = clone(r.held)
    if (kind === 'carry' || kind === 'current') return h
    const disk = d.recs[k]
    // (V2-F4) a record ABSENT from an older page's map is read as a literal with every field empty
    const L: Rec & { ops?: RecOp[] } =
      kind === 'absent' || !disk.rec
        ? { f: Object.fromEntries(F.map((f) => [f, this.EMPTY()])) }
        : (clone(disk.rec) as Rec & { ops?: RecOp[] })
    // (v4) a page that LOADED after the last Reset names only rounds begun after it, whatever their ids
    const loadedAfterReset =
      !d.env &&
      ((!!d.stTag && !!this.deadSt && cmpSt(d.stTag, this.deadSt) >= 0) ||
        (!d.stTag && !d.stBoot && !!this.goneSeen && !this.deadSt && d.stFresh))
    for (const f of F)
      if (
        L.f[f].id !== null &&
        (this.isDead(L.f[f].id!) ||
          (!loadedAfterReset && clockRoundId(L.f[f].id!) && L.f[f].id! < this.dead))
      )
        L.f[f] = this.EMPTY()
    // (every older round a literal names is one this window has seen: its next Reset removes it)
    if (kind !== 'absent') for (const f of F) if (L.f[f].id !== null) this.litSeen.add(L.f[f].id!)
    const out: Rec = h
      ? clone(h)
      : {
          f: Object.fromEntries(F.map((f) => [f, this.EMPTY()])),
          x: Object.fromEntries(F.map((f) => [f, [] as FV[]])),
        }
    out.x ??= Object.fromEntries(F.map((f) => [f, [] as FV[]]))
    for (const f of F) {
      out.x[f] ??= []
      const o = L.f[f]
      // (V2-F3) THE TAKE-BACK. The round the LAST older literal named for this field (`ol`), an older page's,
      // begun after that page last loaded: if this literal no longer names it and names nothing newer, that
      // page took it back. It leaves the record; the runner-ups stand.
      out.ol ??= {}
      const X = out.ol[f] ?? null
      const xe = X !== null ? [out.f[f], ...(out.x[f] ?? [])].find((q) => q.id === X) : null
      // (a writeKept literal - the envelope kept - is BETTER(device, page): it says nothing of the page's
      // own record)
      const kept = d.env
      if (
        !this.hooks.without?.takeBack &&
        !kept &&
        X !== null &&
        X !== o.id &&
        xe &&
        !xe.n &&
        !this.spec.better(xe.v, o.v) &&
        (out.olLoad?.[f] ?? null) === this.loadKey(d)
      ) {
        const cur = this.removeRound(out.f[f], out.x[f], X)
        out.f[f] = cur.fld
        out.x[f] = cur.alts.slice(0, ALT)
      }
      if (!kept) {
        out.ol[f] = o.id
        ;(out.olLoad ??= {})[f] = this.loadKey(d)
      }
      const n2 = out.f[f]
      const known = [n2, ...(out.x[f] ?? [])].find((q) => q.id !== null && q.id === o.id)
      if (
        o.id !== null &&
        this.spec.present(o.v) &&
        !known &&
        !(out.hn?.[f] ?? []).includes(o.id) &&
        !r.ownRounds.has(o.id)
      )
        r.playPend = true
      if (known?.n || (out.hn?.[f] ?? []).includes(o.id!)) continue
      if (o.id !== null && o.id === n2.id) {
        // the same round seen later: its value now (an Override up or down); a drop lands on the runner-ups;
        // the same value again changes nothing (it keeps its place among ties)
        if (this.sameFV(n2, o)) continue
        const cur = this.removeRound(n2, out.x[f], o.id)
        const nx = this.spec.present(o.v)
          ? this.insertAlt(cur.fld, cur.alts, n2.n ? { ...o, n: true } : o)
          : cur
        out.f[f] = nx.fld
        out.x[f] = nx.alts.slice(0, ALT)
      } else if (this.spec.better(n2.v, o.v)) {
        const nx = this.insertAlt(n2, out.x[f], o)
        out.f[f] = nx.fld
        out.x[f] = nx.alts.slice(0, ALT)
      } else if (o.id !== null && this.spec.present(o.v)) {
        // a stale older value: a runner-up candidate only
        const nx = this.insertAlt(n2, out.x[f], o)
        out.f[f] = nx.fld
        out.x[f] = nx.alts.slice(0, ALT)
      }
    }
    // a new window's pass-through literal carries its own rounds as ops: applied exactly
    const res = F.every((f) => out.f[f].id === null) ? null : out
    return (L.ops ?? [])
      .filter((op) => op.id >= this.dead)
      .reduce<Rec | null>((q, op) => this.applyOp(q, op), res)
  }

  // a held Reset cancelled: the bound it set goes; the window keeps the newest bound it knows
  private cancelReset(d: RecordsDev) {
    this.resetPending = false
    if ((d.S?.dead ?? 0) > this.preResetDead) {
      this.dead = d.S!.dead
      this.deadSt = d.S!.deadSt ?? null
    } else {
      this.dead = this.preResetDead
      this.deadSt = this.preResetDeadSt
    }
    this.deadIds = [...this.preResetDeadIds]
    this.addDead(d.S?.deadIds)
    // the window is back on the version it held, its rounds since on top
    for (const r of Object.values(this.recs)) {
      r.mem = this.rebuildMem(r, clone(r.held))
      r.prov = true
    }
  }

  // ── reading the device ──
  /** Every record the window knows or the device names. */
  keys(d: RecordsDev): string[] {
    return [
      ...new Set([
        ...Object.keys(this.recs),
        ...Object.keys(d.recs),
        ...Object.keys(d.S?.at ?? {}),
      ]),
    ]
  }
  private kindOf(d: RecordsDev, k: string) {
    const disk = d.recs[k] ?? { rec: null, tagged: false, env: null }
    const Sk = d.S?.at?.[k] ?? null
    const rec = disk.rec
    // the newest version: the records' key's, or the envelope's when newer (the doc lands first)
    let newest: { st: Stamp; fp: string } | null = Sk ? { st: Sk.st, fp: Sk.fp } : null
    if (disk.env && (!newest || cmpSt(disk.env.st, newest.st) > 0))
      newest = { st: disk.env.st, fp: disk.env.fp }
    let kind: string
    if (!Sk && !disk.env) kind = 'boot'
    else if (!d.docPresent) kind = 'gone'
    else if (
      disk.env &&
      disk.env.fp === fpRec(this.spec, rec) &&
      cmpSt(disk.env.st, newest!.st) === 0 &&
      (!rec || disk.tagged)
    )
      kind = 'stamped'
    else if (rec && disk.tagged)
      kind = newest && newest.fp === fpRec(this.spec, rec) ? 'current' : 'carry'
    else if (!rec) kind = 'absent'
    else kind = 'literal'
    return { rec, newest, kind, Sk }
  }

  /** Merge the device as this window now sees it. True when it changed what this window must write. */
  merge(): boolean {
    const d = this.io.view()
    const F = this.spec.fields
    // ★ THE DOC-LEVEL READ, once: the Reset bounds and the Reset waiting for room
    for (const k of this.keys(d)) {
      const { newest } = this.kindOf(d, k)
      if (newest) see(this.hlc, newest.st)
      this.seeIds(d.recs[k]?.rec)
      this.seeIds(d.S?.at?.[k]?.rec)
    }
    this.seeHi(d.S?.dead)
    this.seeHi((d.S?.hi ?? 0) + 1)
    // (v4, V3-F4) A Reset not yet landed is cancelled ONLY BY PLAY: a version that added a round after the
    // press, or an older page's record naming a round this window does not know.
    if (this.resetPending) {
      const knownIds = new Set([
        ...Object.values(this.recs).flatMap((r) => [...r.ownRounds]),
        ...this.pressKnown,
      ])
      let cancel = false
      for (const k of this.keys(d)) {
        const r = this.rec(k)
        const Sk = d.S?.at?.[k]
        const newerPlay = !!(Sk?.ps && (!r.resetBase || cmpSt(Sk.ps, r.resetBase) > 0))
        const { kind, rec } = this.kindOf(d, k)
        const lit =
          kind === 'literal' && rec
            ? F.some(
                (f) =>
                  rec.f[f].id !== null &&
                  this.spec.present(rec.f[f].v) &&
                  !knownIds.has(rec.f[f].id!),
              )
            : false
        if (newerPlay || lit) cancel = true
      }
      if (cancel) this.cancelReset(d)
      else this.hooks.counter?.('resetKept')
    }
    let changed = false
    let goneDone = false
    for (const k of this.keys(d)) {
      const r = this.rec(k)
      const { rec, newest, kind, Sk } = this.kindOf(d, k)
      if (kind === 'boot') {
        // (the bytes before the first new save are an older page's record: its holders are what it names)
        const rec0 = clone(rec)
        if (rec0 && !d.recs[k]?.tagged) {
          rec0.ol = Object.fromEntries(F.map((f) => [f, rec0.f[f].id]))
          rec0.olLoad = Object.fromEntries(F.map((f) => [f, this.loadKey(d)]))
        }
        r.held = clone(rec0)
        r.st = null
        r.unres = null
        r.dirty = r.dirty.filter((op) => op.id >= this.dead)
        r.mem = this.rebuildMem(r, clone(rec0))
        continue
      }
      if (kind === 'stamped' || kind === 'current') {
        // a new window's version, or an older page's untouched copy of the NEWEST version
        if (
          !r.st ||
          cmpSt(newest!.st, r.st) > 0 ||
          (cmpSt(newest!.st, r.st) === 0 && !this.resetPending)
        ) {
          if (!r.dirty.length && !this.resetPending) {
            r.prov = false
            r.unres = null
          }
          r.held = this.withExtras(rec, Sk && cmpSt(Sk.st, newest!.st) === 0 ? Sk.rec : r.held)
          r.st = newest!.st
          if (Sk && cmpSt(Sk.st, newest!.st) === 0) {
            if ((d.S!.dead ?? 0) > this.dead) {
              this.dead = d.S!.dead
              this.deadSt = d.S!.deadSt ?? null
            }
            this.addDead(d.S!.deadIds)
          }
          r.dirty = r.dirty.filter((op) => op.id >= this.dead)
          r.mem = this.rebuildMem(r, clone(r.held))
        }
        continue
      }
      if (kind === 'gone') {
        // an older page's Full Reset: the record is gone (its rounds are dead); my own ops since stand. Dead:
        // every round below the id this window would draw now (the hybrid clock's bound)
        if (!goneDone) {
          goneDone = true
          const below = this.clock.peek()
          if (below > this.dead) {
            this.dead = below
            this.deadSt = null
          }
          this.hooks.onGone?.(this, below)
          this.addDead([
            ...Object.values(this.recs).flatMap((q) => this.knownIdsOf(q.held, q.mem)),
            ...this.knownIdsOf(...Object.values(d.S?.at ?? {}).map((e) => e.rec)),
            ...Object.values(this.recs).flatMap((q) => [...q.ownRounds]),
          ])
          this.clock.hi = Math.max(this.clock.hi, below - 1)
          this.goneSt = newest?.st ?? null
          this.goneSeen = Math.max(this.goneSeen, below)
        }
        r.held = null
        r.st = null
        r.unres = null
        r.dirty = r.dirty.filter((op) => op.id >= this.dead)
        r.mem = this.rebuildMem(r, null)
        r.prov = true
        changed = true
        continue
      }
      // (Best records are small: the records' key carries the newest record whole - runner-ups and flags
      // with it - so ANY window holds the newest version) - but only for an older copy that loaded something
      // a new build wrote (its stats tag), the bytes from before the first new save, or after a Full Reset
      if (
        !this.resetPending &&
        Sk &&
        (d.stTag || d.stBoot || (d.S?.gone ?? 0) > 0) &&
        !this.holds(r, newest) &&
        cmpSt(Sk.st, newest!.st) === 0
      ) {
        r.held = clone(Sk.rec)
        r.st = Sk.st
        if ((d.S!.dead ?? 0) > this.dead) {
          this.dead = d.S!.dead
          this.deadSt = d.S!.deadSt ?? null
        }
        this.addDead(d.S!.deadIds)
        r.dirty = r.dirty.filter((op) => op.id >= this.dead)
        r.mem = this.rebuildMem(r, clone(r.held))
      }
      if (!this.holds(r, newest)) {
        // only a holder of the newest version may resolve an older record; the bytes pass through. My own
        // rounds since go on top of them as a literal (marked as a new window's), for the holder to resolve.
        r.unres = { rec: clone(rec) }
        r.dirty = r.dirty.filter((op) => op.id >= this.dead)
        r.mem = this.rebuildMem(r, clone(rec))
        continue
      }
      r.unres = null
      const res = this.resolve(r, d, k, kind)
      const same =
        fpRec(this.spec, res) === fpRec(this.spec, r.held) &&
        JSON.stringify(res?.x ?? null) === JSON.stringify(r.held?.x ?? null) &&
        JSON.stringify(res?.ol ?? null) === JSON.stringify(r.held?.ol ?? null) &&
        JSON.stringify(res?.olLoad ?? null) === JSON.stringify(r.held?.olLoad ?? null)
      if (same) {
        if (kind !== 'current') changed = true // re-assert
        continue
      }
      r.held = res
      r.dirty = r.dirty.filter((op) => op.id >= this.dead)
      r.mem = this.rebuildMem(r, clone(res))
      r.prov = true
      changed = true
    }
    return changed
  }

  /** Is anything owed a write (an op, a Reset, a merge's write-back)? */
  owes(): boolean {
    return (
      this.resetPending !== false ||
      Object.values(this.recs).some((r) => r.dirty.length > 0 || r.prov)
    )
  }

  // ── landing ──
  /**
   * What a landing writes now - or null for nothing to write (every record a pass-through with nothing of
   * this window's on it). Nothing changes until `landed`; `refused` puts the clock back.
   */
  prepare(): RecordsOut | null {
    const F = this.spec.fields
    const all = Object.entries(this.recs)
    const pass = (r: RState) => !!r.unres && this.resetPending === false
    // (a pass-through with nothing of mine on it writes nothing; a write of only pass-throughs is no
    // version: no stamp, the records' key untouched)
    const versions = all.filter(([, r]) => !pass(r))
    // (a Reset is a version whoever writes it, records or none: its bounds go in the key)
    const resetting = this.resetPending !== false
    if (!versions.length && !resetting && !all.some(([, r]) => r.dirty.length || r.prov))
      return null
    this.preHlc = { ...this.hlc }
    const st = versions.length || resetting ? this.newMint() : null
    const prevS = this.io.deviceKey()
    const out: RecordsOut = { doc: {}, env: {}, key: null, st, mem: {}, passed: [] }
    for (const [k, r] of all) {
      if (!pass(r)) continue
      if (!r.dirty.length && !r.prov) {
        out.doc[k] = { keep: true }
        continue
      }
      // a pass-through: my rounds on top, as an untagged literal naming them as a new window's; no
      // envelope, the records' key untouched for it (this is not a version)
      out.doc[k] = {
        rec: r.mem ? { f: clone(r.mem.f) } : null,
        tagged: false,
        ops: clone(r.dirty),
        nr: r.dirty.map((op) => op.id),
      }
      out.passed.push(k)
    }
    if (!st) return out
    // (compact) the runner-ups are written only while the holder can still be taken back: an older page's
    // round, or a new window's round on some window's results screen - each window names its own (`open`)
    const open: Record<string, number | null> = {
      ...(prevS?.open ?? {}),
      [this.tag]: this.lastRound,
    }
    // (v4, V3-F6.2) an entry whose round is neither a holder nor a runner-up any more pins nothing
    for (const [t, id] of Object.entries(open))
      if (
        t !== this.tag &&
        id !== null &&
        !versions.some(
          ([, r]) =>
            r.mem &&
            F.some((f) => [r.mem!.f[f], ...(r.mem!.x?.[f] ?? [])].some((q) => q.id === id)),
        )
      )
        delete open[t]
    const live = new Set(Object.values(open).filter((q): q is number => q !== null))
    const key: RecordsKey = {
      at: { ...(prevS?.at ?? {}) },
      dead: this.dead,
      // (a Reset landing now is the bound its own stamp names)
      deadSt: resetting ? st : this.deadSt,
      deadIds: [...this.deadIds],
      hi: Math.max(this.clock.hi, prevS?.hi ?? 0),
      gone: Math.max(this.goneSeen, prevS?.gone ?? 0),
      open,
    }
    out.key = key
    for (const [k, r] of versions) {
      const mem = r.mem ? clone(r.mem) : null
      if (mem)
        for (const f of F) {
          const h = mem.f[f]
          if (h.id !== null && h.n && !live.has(h.id) && mem.x?.[f]?.length) {
            mem.x[f] = []
            this.hooks.counter?.('xPruned')
          }
        }
      out.mem[k] = mem
      const fp = fpRec(this.spec, mem)
      const Sk = prevS?.at?.[k]
      // the record's version: this landing's stamp when it changes the record (its values or the extras
      // the key keeps), else the one it has
      const same =
        !!Sk &&
        !!r.st &&
        cmpSt(Sk.st, r.st) === 0 &&
        Sk.fp === fp &&
        JSON.stringify(Sk.rec) === JSON.stringify(mem) &&
        !r.dirty.length &&
        !r.prov &&
        this.resetPending === false
      const vst = same ? Sk!.st : st
      // (v4) the play stamp: this version's stamp if it adds a ROUND (a new window's round - not an
      // Override - or an older page's round it resolved), else the newest version's
      const ps = r.dirty.some((op) => !op.ov) || r.playPend ? vst : (Sk?.ps ?? null)
      out.doc[k] = { rec: mem ? { f: clone(mem.f) } : null, tagged: true }
      // (every version has its entry - an empty record's included: "nothing", at this version)
      out.env[k] = { st: vst, fp }
      key.at[k] = { st: vst, fp, ps, rec: mem ? clone(mem) : null }
    }
    return out
  }
  /** The landing `out` wrote; the book now holds what it wrote. */
  landed(out: RecordsOut): void {
    const passed = new Set(out.passed)
    if (passed.size)
      this.hooks.onPassThrough?.(
        this,
        out.passed.flatMap((k) => this.recs[k].dirty),
      )
    if (out.st)
      this.hooks.onLanded?.(
        this,
        Object.entries(this.recs)
          .filter(([k]) => k in out.mem)
          .flatMap(([, r]) => r.dirty),
        this.resetPending,
        out.st,
      )
    if (out.st && this.resetPending !== false) this.deadSt = out.st
    for (const [k, r] of Object.entries(this.recs)) {
      if (passed.has(k)) {
        // still not a holder: the bytes on the device are now this literal; my ops stay mine until a version
        // holds them (each later pass-through puts them on top again: applying a round twice is a no-op)
        r.prov = false
        continue
      }
      if (!(k in out.mem)) continue
      r.mem = out.mem[k]
      r.held = clone(r.mem)
      r.st = out.env[k]?.st ?? r.st
      r.dirty = []
      r.prov = false
      r.unres = null
      r.playPend = false
    }
    if (out.st) {
      this.resetPending = false
      this.goneSt = null
    }
    this.preHlc = null
  }
  /** A landing refused: the stamp it minted is forgotten (an un-landed version is no version). */
  refused(): void {
    if (this.preHlc) this.hlc = this.preHlc
    this.preHlc = null
  }

  // ── the window's own acts ──
  /** A round of this window's ended (or an Override changed it: `ov`). */
  op(k: string, op: RecOp): void {
    const r = this.rec(k)
    if (!op.ov) {
      r.ownRounds.add(op.id)
      this.lastRound = op.id
    }
    r.dirty.push(op)
    r.mem = this.applyOp(r.mem, op)
  }
  /** Has a Reset since removed the round `id` (nothing left to Override)? */
  roundDead(id: number): boolean {
    return (clockRoundId(id) && id < this.dead) || this.isDead(id)
  }
  /** This window's Reset of every record (the app's Full Reset of the progress doc). */
  reset(): void {
    // every round this window knows at the press (what it holds and shows)
    if (this.resetPending === false)
      this.pressKnown = new Set(
        Object.values(this.recs).flatMap((r) => this.knownIdsOf(r.held, r.mem)),
      )
    for (const r of Object.values(this.recs)) {
      r.dirty = []
      r.mem = null
      r.prov = true
    }
    this.lastRound = null
    // (a second Reset before the first has landed: one Reset, from the newest version known at the first)
    if (this.resetPending === false) {
      const d = this.io.view()
      for (const [k, r] of Object.entries(this.recs)) {
        const a = this.kindOf(d, k).newest?.st ?? null
        const b = r.st
        r.resetBase = !a ? b : !b ? a : cmpSt(a, b) >= 0 ? a : b
      }
      this.preResetDead = this.dead
      this.preResetDeadSt = this.deadSt
      this.preResetDeadIds = [...this.deadIds]
    }
    // the rounds it removes: every round id below the one this window would draw at the press
    const bound = this.clock.peek()
    this.resetPending = bound
    this.dead = bound
    this.addDead([
      ...this.pressKnown,
      ...Object.values(this.recs).flatMap((r) => [...r.ownRounds]),
      ...this.litSeen,
    ])
    this.litSeen = new Set()
    this.clock.hi = Math.max(this.clock.hi, bound - 1)
  }
}
