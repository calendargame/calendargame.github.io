// store/syncCounts.ts — HOW ONE WINDOW MERGES A DOC OF COUNTS AND SETTINGS WITH THE DEVICE
// (design-q1-q2.md v4, sections 2.2-2.8: windows stay in sync).
//
// THE PROBLEM IT SOLVES. Each window used to keep its own copy of the saved data and write the WHOLE
// copy back on every save, so a window that loaded earlier saved over something newer from another
// window ("last save wins"). This file is the merge that replaces that: before every write, and on
// every notice that another window wrote, the window works out what the device provably holds, slice
// by slice, and writes only what it can prove — its own un-landed actions re-applied on top of the
// newest version, and an older build's change taken where it is provably a change.
//
// ★ IT IS THE MODEL, PORTED. Every rule below was found and gated by running design-q2-model's
// model4.mjs (3,000 seeds x 22 configurations x 300 steps, 0 bad runs) and is ported from it function
// for function, with the model's names kept so the two can be read side by side: readDev,
// classifyReg, classifySilo, blockOf, fold, consistent, foldPart, adoptAll, takeDevice, holdsV,
// sibling, merge, rebaseDirty, playSince, land, syncView (here `handle`). tests/syncedDoc.fuzz runs
// THIS code in the model's world, against the model's oracle (judge4) — that is the gate, not the
// model's own copy of the rules.
//
// WHAT A DOC IS, TO THIS FILE. A set of SLICES, each either:
//   • a SILO — a mode's lifetime stats in COUNT form: played, right, streak, best, the times of the
//     timed right answers in order, and the legacy gap (`tl`, the stored `timesLost`). Older builds
//     change a silo only by spreading it (an answer, an Override of one of their own cards at any
//     depth: the tag inside rides along) or by a literal (a Reset: the tag goes). design 2.4-2.5.
//   • a REG — one setting-like value (a ⚙ setting, a mode pref, a name). No tag can ride inside it;
//     the prev-value rule (2.4) tells an older page's stale copy from its genuine change.
// How a doc's text maps onto its slices is the caller's (a `CountsShape`): store/syncedDoc's progress
// and settings shapes for the app, the model's own flat shape for the fuzz.
//
// WHERE THE SYNC DATA LIVES (2.2). The ENVELOPE `sync` inside the doc (atomic with the content; older
// builds drop it on a whole-copy save), the SYNC KEY `cg-sync-v1|<doc key>` no older build touches
// (every slice's newest version; the bootstrap summaries; the fold records), and a TAG `w` inside every
// silo a new window writes. The doc lands first and the key second, or neither (the caller's `io`).
//
// ⚠ THE LEDGER AND THE OBSERVER ARE THE TEST'S, NEVER THE APP'S. The fuzz's oracle keeps, inside every
// silo, a ledger of the answers it counts (`x`), updated by exact arithmetic on the same operands the
// counts use — and logs what each window weighed and read. Both are optional hooks here (`hooks`); the
// app passes none, and no decision in this file ever reads `x`.

import {
  type Stamp,
  type Clock,
  ZERO,
  BOOT,
  cmpStamp as cmp,
  stampKey as key,
  mint,
  see,
  canonicalJson,
  encodeStamp,
  decodeStamp,
  cyrb53,
} from './syncStamp.js'
import { timesHash, timesHashAppended, prefixHash, appended } from '../engine/timesPool.js'

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────────

/** A silo in count form. `x` is the fuzz oracle's ledger (never read by a decision). */
export type Silo = {
  pl: number
  gd: number
  sk: number
  bs: number
  t: number[]
  tl: number
  x?: unknown
}
/** The tag inside a silo a new window wrote: which version, and the counts it had then. */
export type Tag = {
  g: string
  st: Stamp
  pl: number
  gd: number
  sk: number
  bs: number
  n: number
  h: string
  tl: number
  x?: unknown
}
/** A summary of a silo's counts (the bootstrap record). */
export type Summary = {
  pl: number
  gd: number
  sk: number
  bs: number
  n: number
  h: string
  tl: number
  x?: unknown
}
/** A block: an older page's cards after the summary its copy stands on. */
type Block = { k: number; g: number; t: number[]; sk: number; bs: number; x?: unknown }
/** A fold record: the part of an older page's block already folded into a version (2.5.4). */
export type FoldRec = {
  k: number
  g: number
  n: number
  t: number[]
  s: number
  b: number
  st: Stamp | null | 'land'
  ih?: boolean
  asOld?: boolean
  x?: unknown
}
type Part = { k: number; g: number; t: number[]; sk: number; x?: unknown }
/** One un-landed action on a silo: an answer, or a whole-slice replacement (an Override). */
export type Op =
  | { kind: 'a'; r: boolean; tm: number | null; id?: number }
  | { kind: 'rep'; from: Silo; to: Silo }
type Dirty = { reset: boolean; ops: Op[]; set?: boolean }
type Seg =
  | { own: Op[] }
  | { base: string; from: number; to: number; part: Part; rec: FoldRec; own?: undefined }
type ParentSum = { st: Stamp; pl: number; ext: Seg[] | null }

export type SiloEntry = {
  st: Stamp
  fp: string
  p?: ParentSum | null
  old?: Record<string, FoldRec>
  ps?: Stamp | null
  unres?: Stamp
}
export type RegEntry = { st: Stamp; fp: string; unres?: Stamp }
export type Envelope = { g: string; at: Record<string, SiloEntry | RegEntry | 0> }
export type KeyEntry = {
  st: Stamp
  fp: string | null
  ps?: Stamp | null
  p?: ParentSum | null
  v?: unknown
  prev?: { fp: string } | null
  seen?: boolean
}
/** The sync key, as this file reads and writes it (the caller packs it to text). */
export type SyncKey = {
  g: string
  at: Record<string, KeyEntry>
  boot: Record<string, Summary | null>
  old: Record<string, Record<string, FoldRec>>
}

/** How a doc's text maps onto its slices (store/syncedDoc's shapes; the fuzz's flat one). */
export interface CountsShape {
  readonly silos: readonly string[]
  readonly regs: readonly string[]
  /** The doc's slices as stored, and its envelope — or null for a doc that is not there. */
  parse(text: string | null): { state: Record<string, unknown>; sync: Envelope | null } | null
  /** A stored silo as counts (blank when absent), and the tag inside it (null when none). */
  silo(disk: unknown): { v: Silo; tag: Tag | null }
  /** A stored silo as a text that is equal exactly when two stored silos are (default: its JSON) - for
   *  a shape whose silos hold long pools, a fingerprint that does not spell them out. */
  diskFp?(disk: unknown): string
  /** The stored form of a silo this window writes as a version, its tag inside. */
  diskSilo(v: Silo, tag: Tag): unknown
  /** The doc as written: `state` per slice (stored form), `sync` the envelope (compact). `full` is the
   *  whole envelope it stands for, for a shape that wants it (only the fuzz's parity check ever does).
   *  Its text, for a shape whose io.save writes that text; whatever its io.save takes, for one that does
   *  more on the way (the saved progress seals its solve times into chunks first, from the object -
   *  never from a text spelled out only to be read back). The book hands it to io.save and to nothing
   *  else. */
  write(state: Record<string, unknown>, sync: Envelope, full: Envelope): unknown
  /** Read the sync key's text (null: none, or unreadable). */
  readKey(text: string | null): SyncKey | null
  writeKey(key: SyncKey): string
  /** What a setting reads as where the doc has no value for it: the value every build's store holds
   *  then, so an older page's save of it reads as the same value (the app: each setting's default,
   *  `absentOf`; the model: 0, `regAbsent`). */
  readonly regAbsent?: unknown
  absentOf?(x: string): unknown
  /** A setting whose value carries its own version tag (the saved defaults' `w`, design 4): true when `v`
   *  is an object a new build wrote and nobody has changed since - its tag still names its own values. */
  tagged?(x: string, v: unknown): boolean
}

/** The fuzz oracle's hooks (store/syncedDoc's tests): a ledger beside the counts, and a log. */
export interface CountsHooks {
  ledger?: {
    blank(): unknown
    apply(x: unknown, op: Op): unknown
    block(v: Silo, sum: Summary | Tag): unknown
    part(B: Block, done: FoldRec): unknown
    fold(h: Silo, part: Part): unknown
    rec(B: Block): unknown
    summary(s: Silo): unknown
    tag(s: Silo): unknown
    segPart(resolved: Silo, held: Silo, B: Block, heldRec: FoldRec | undefined): unknown
  }
  /** The model's planted merge bugs (mut4.mjs), for the oracle's own test. Never set by the app. */
  mut?: 'drop' | 'dropOne' | 'double' | null
  onWeigh?(book: CountsBook, x: string, B: Block, done: FoldRec): void
  onFoldBad?(book: CountsBook, x: string, B: Block, done: FoldRec, part: Part, held: Silo): void
  onMutFired?(): void
  onRead?(book: CountsBook, dev: Dev): void
  onDecode?(docText: string, decoded: Envelope): void
  onHeld?(book: CountsBook, x: string, held: Silo): void
  onResetLanded?(book: CountsBook, resets: string[], state: Record<string, unknown>): void
  onRefused?(book: CountsBook): void
  onLanded?(book: CountsBook, full: Envelope): void
  counter?(
    name: 'inexact' | 'dropped' | 'droppedAnswers' | 'carried' | 'resetKept',
    n?: number,
  ): void
}

/** What a book reads and writes the device through (store/syncedDoc's door; the fuzz's world). */
export interface CountsIO {
  /** The window's copy of the device: the doc and the key as it last read them, and the doc text
   *  just before that one (the notice's old value), when it knows it. */
  view(): { doc: string | null; side: string | null; prevDoc: string | null | undefined }
  /** Land the doc, then the key — both, or neither (false: refused, nothing changed). `full` is the
   *  whole envelope this write stands for (the compact one in the doc leaves out what the key says). */
  save(doc: unknown, keyText: string, full: Envelope): boolean
  /** The key as the DEVICE holds it right now (land builds on it, as the model's land reads W.dev). */
  deviceKey(): string | null
}

type Mem = { v: unknown; st: Stamp }
type Disk = Record<string, unknown>
type Classified = {
  kind: 'boot' | 'stamped' | 'current' | 'change' | 'carry' | 'block' | 'carryReg'
  st?: Stamp
  p?: ParentSum | null
  old?: Record<string, FoldRec>
  base?: Stamp | string | null
  sum?: Summary | Tag
  odd?: boolean
  val?: unknown
  newestOld?: Record<string, FoldRec>
  ps?: Stamp | null
  newestPs?: Stamp | null
}
type DevSlice = Classified & {
  v: unknown
  disk: unknown
  newest: { st: Stamp; fp: string | null } | null
}
export type Dev = {
  out: Record<string, DevSlice>
  g: string | null
  S: SyncKey | null
  sync: Envelope | null
  docPresent: boolean
}

// ── Counts ────────────────────────────────────────────────────────────────────────────────────────

/** A setting's value longer than this (as JSON) is not copied into the sync key: only its fingerprint. */
export const KEY_VALUE_MAX = 4096
const NO_VALUE = Symbol('no value')
const clone = <T>(o: T): T => (o === undefined ? o : (JSON.parse(JSON.stringify(o)) as T))
const isStampBase = (b: unknown): b is Stamp => typeof b === 'object' && b !== null
const sameTimes = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((t, i) => Object.is(t, b[i]))
const startsWith = (a: readonly number[], prefix: readonly number[]): boolean =>
  prefix.length <= a.length && prefix.every((t, i) => Object.is(t, a[i]))

export const blankSilo = (): Silo => ({ pl: 0, gd: 0, sk: 0, bs: 0, t: [], tl: 0 })

/** A silo's fingerprint: its counts, its legacy gap, and the hash of its times. */
export const siloFp = (s: Silo): string => siloFpOf(s, s.t.length, timesHash(s.t))
/** A silo's fingerprint from its counts, the number of its times and their hash - for a silo that has
 *  not been made (store/progressDoor reads an answer off two saves without building the third). */
export const siloFpOf = (c: Omit<Silo, 't' | 'x'>, n: number, h: string): string =>
  `L${c.pl}|${c.gd}|${c.sk}|${c.bs}|${c.tl}|${n}|${h}`

// ★ AN ANSWER'S POOL, MADE ONCE. An answer op names its time; the pool it makes is the store's, already
// made by the engine (engine/timesPool's appended, its Summary and sorted buffer with it). A caller that
// has that pool hands it over with the op (withTimes), and the book takes it instead of appending the
// time to its own copy - a second append from the same pool would have to sort it afresh (a sorted
// buffer is handed on once). It is taken only when it is exactly that append (its count and its hash);
// an op without one (a held op re-applied on another pool) appends as before.
const OP_TIMES = new WeakMap<Op, readonly number[]>()
export function withTimes<O extends Op>(op: O, times: readonly number[]): O {
  OP_TIMES.set(op, times)
  return op
}
const timesOfOp = (op: Op & { kind: 'a' }, prev: readonly number[]): number[] => {
  const made = OP_TIMES.get(op)
  return made &&
    made.length === prev.length + 1 &&
    timesHash(made) === timesHashAppended(prev, op.tm!)
    ? (made as number[])
    : appended(prev, op.tm!)
}
/** A setting's fingerprint: its value, spelled one way - and, past a few characters, the hash of that
 *  (a preset's name has no length limit, and a fingerprint is written in the envelope and the key). */
export const regFp = (v: unknown): string => {
  if (v === undefined) return 'R~'
  const text = canonicalJson(v)
  return text.length <= 24 ? `R${text}` : `H${cyrb53(text)}`
}

// does s equal the version summary tg names?
const isVersion = (s: Silo, tg: Tag | Summary): boolean =>
  s.pl === tg.pl &&
  s.gd === tg.gd &&
  s.sk === tg.sk &&
  s.bs === tg.bs &&
  s.tl === tg.tl &&
  s.t.length === tg.n &&
  timesHash(s.t) === tg.h
// does s extend summary tg as appends-or-own-overrides (the tagged prefix untouched)? Necessary for a
// genuine extension (the block is the page's own cards after the summary): 0 <= right <= cards, times
// only of right cards, the streak what the block's verdicts allow, the Best never below the summary's.
const extendsSum = (s: Silo, tg: Tag | Summary): boolean => {
  const k = s.pl - tg.pl
  const g = s.gd - tg.gd
  const nt = s.t.length - tg.n
  if (!(k > 0 && g >= 0 && g <= k && nt >= 0 && nt <= g && s.bs >= tg.bs && s.tl === tg.tl))
    return false
  if (prefixHash(s.t, tg.n) !== tg.h) return false
  return g === k ? s.sk === tg.sk + k : s.sk < k
}

// ── The book: one window's knowledge of one doc ──────────────────────────────────────────────────

export class CountsBook {
  readonly shape: CountsShape
  readonly io: CountsIO
  readonly hooks: CountsHooks
  readonly tag: string
  readonly name: string
  hlc: Clock = { m: 0, c: 0 }
  g: string | null = null
  // per slice
  mem: Record<string, Mem> = {}
  base: Record<string, Mem> = {}
  dirty: Record<string, Dirty> = {}
  prov: Record<string, boolean> = {}
  unres: Record<string, Stamp> = {}
  raw: Record<string, unknown> = {}
  parent: Record<string, Stamp | null> = {}
  parentV: Record<string, Silo> = {}
  oldApplied: Record<string, Record<string, FoldRec>> = {}
  boot: Record<string, Summary | null> = {}
  bootPend: Record<string, Summary | null> = {}
  landPend: Record<string, { b: string; fp: string; asOld: boolean }> = {}
  segs: Record<string, Seg[]> = {}
  heldOld: Record<string, Record<string, FoldRec>> = {}
  contig: Set<string> | null = null
  playPend: Record<string, boolean> = {}
  psHeld: Record<string, Stamp | null> = {}
  knownPs: Record<string, Stamp> = {}
  pressPs: Record<string, Stamp | null> = {}
  resetBase: Record<string, Stamp> = {}
  recCache: Record<string, Record<string, FoldRec>> = {}
  newestOldCache: Record<string, Record<string, FoldRec>> = {}
  unresBase: Record<string, Stamp | string | null> = {}
  unresBlock: Record<
    string,
    { base: Stamp | string; sum: Summary | Tag; old: Record<string, FoldRec> }
  > = {}
  rebased: Record<string, { st: Stamp | null; v: Silo }> = {}
  seenNewest: Record<string, boolean> = {}
  owes = false
  seen: { doc: string | null; side: string | null } = { doc: null, side: null }
  /** Set by the io when this window wrote while writes it had not handled were still queued for it. */
  blind = false

  constructor(o: {
    shape: CountsShape
    io: CountsIO
    tag: string
    name?: string
    hooks?: CountsHooks
  }) {
    this.shape = o.shape
    this.io = o.io
    this.tag = o.tag
    this.name = o.name ?? o.tag
    this.hooks = o.hooks ?? {}
  }
  // THE SLICES, as the shape names them NOW: a doc whose slices come and go (the preset registry - one
  // name per preset) names a new one the moment it appears; it starts as "nothing known" (stamp ZERO),
  // so whatever the device says of it wins.
  get SL(): readonly string[] {
    const sl = [...this.shape.silos, ...this.shape.regs]
    for (const x of sl)
      if (!this.mem[x]) {
        const v = this.isSilo(x) ? this.blank() : this.absent(x)
        this.mem[x] = { v, st: ZERO }
        this.base[x] = { v, st: ZERO }
      }
    return sl
  }
  isSilo = (x: string): boolean => this.shape.silos.includes(x)
  // One stored silo as a comparable text: the shape's own (a long pool by its hash) or its JSON.
  diskFp = (d: unknown): string =>
    this.shape.diskFp ? this.shape.diskFp(d) : (JSON.stringify(d) ?? 'undefined')
  absent = (x: string): unknown =>
    this.shape.absentOf ? this.shape.absentOf(x) : this.shape.regAbsent
  fpOf = (x: string, v: unknown): string => (this.isSilo(x) ? siloFp(v as Silo) : regFp(v))

  // ── the counts algebra, with the oracle's ledger beside it ──
  blank(): Silo {
    const s = blankSilo()
    if (this.hooks.ledger) s.x = this.hooks.ledger.blank()
    return s
  }
  // ⚠ SILO VALUES ARE NEVER CHANGED IN PLACE, here or anywhere in this file: every change makes a new
  // object (and a new times array, through engine/timesPool, which keeps the hash beside it) - so the
  // book can hold the same value in `mem`, `base` and what it read, with no copies of a long history.
  applyOps(s: Silo, ops: readonly Op[]): Silo {
    let o: Silo = s
    for (const a of ops) {
      if (a.kind === 'rep') {
        // A whole-slice change (an Override): it lands only on exactly the value it was made on — on
        // anything else it is a true conflict (another window built on the answer since), dropped.
        if (siloFp(o) === siloFp(a.from)) o = a.to
        continue
      }
      const n: Silo = { ...o }
      if (this.hooks.ledger) n.x = this.hooks.ledger.apply(o.x, a)
      n.pl++
      if (a.r) {
        n.gd++
        n.sk++
        if (n.sk > n.bs) n.bs = n.sk
        if (a.tm !== null) n.t = timesOfOp(a, o.t)
      } else n.sk = 0
      o = n
    }
    return o
  }
  tagOf(st: Stamp, s: Silo): Tag {
    const tg: Tag = {
      g: this.g!,
      st,
      pl: s.pl,
      gd: s.gd,
      sk: s.sk,
      bs: s.bs,
      n: s.t.length,
      h: timesHash(s.t),
      tl: s.tl,
    }
    if (this.hooks.ledger) tg.x = this.hooks.ledger.tag(s)
    return tg
  }
  summ(s: Silo): Summary {
    const o: Summary = {
      pl: s.pl,
      gd: s.gd,
      sk: s.sk,
      bs: s.bs,
      n: s.t.length,
      h: timesHash(s.t),
      tl: s.tl,
    }
    if (this.hooks.ledger) o.x = this.hooks.ledger.summary(s)
    return o
  }
  memOfDisk(x: string, d: unknown): unknown {
    if (!this.isSilo(x)) return d === undefined ? this.absent(x) : d
    if (d === undefined || d === null) return this.blank()
    return this.shape.silo(d).v
  }

  // ── reading the device (2.4) ──
  readDev(): Dev {
    const view = this.io.view()
    const docT = view.doc ?? null
    const sideT = view.side ?? null
    const doc = this.shape.parse(docT)
    const S = this.shape.readKey(sideT)
    let sync = doc?.sync ?? null
    if (sync) {
      // (2.2 compact) the envelope, decoded: an entry it does not carry is the key's
      const full: Envelope = { g: sync.g, at: { ...(sync.at ?? {}) } }
      if (S && S.g === sync.g)
        for (const x of this.SL)
          if (full.at[x] === undefined && S.at?.[x]) full.at[x] = this.fullEntry(x, S)
      for (const x of this.SL) if (full.at[x] === 0) delete full.at[x]
      this.hooks.onDecode?.(docT!, full)
      sync = full
    }
    const state = doc ? doc.state : {}
    const g = sync?.g ?? S?.g ?? null
    const Sg = S && S.g === g ? S : null
    // (v5) does an OLDER page's own write carry a tag of this generation in ANY mode? None: that page
    // loaded before the first new save (only an older page's own write - no envelope - speaks for when the
    // page loaded; a new window's write may carry older bytes it passed through beside its own tagged modes)
    const olderTagged =
      !sync &&
      this.SL.some((y) => {
        if (!this.isSilo(y) || state[y] === undefined || state[y] === null) return false
        const t = this.shape.silo(state[y]).tag
        return !!t && t.g === g
      })
    const out: Record<string, DevSlice> = {}
    for (const x of this.SL) {
      const disk = doc ? state[x] : undefined
      const v = this.memOfDisk(x, disk)
      const rec = (sync?.at?.[x] as SiloEntry | RegEntry | undefined) ?? null
      const sAt = Sg ? (Sg.at?.[x] ?? null) : null
      let newest: { st: Stamp; fp: string | null } | null = sAt ? { st: sAt.st, fp: sAt.fp } : null
      if (rec && !rec.unres && (!newest || cmp(rec.st, newest.st) > 0))
        newest = { st: rec.st, fp: rec.fp }
      // (every version's fold records this window reads are kept by stamp: a version written later on top
      // of an older page's copy of one of them inherits that version's history)
      if (this.isSilo(x) && rec && !rec.unres && (rec as SiloEntry).old)
        this.recCache[key(rec.st)] = clone((rec as SiloEntry).old!)
      if (this.isSilo(x) && sAt && Sg!.old?.[x]) this.recCache[key(sAt.st)] = clone(Sg!.old[x])
      if (this.isSilo(x) && sAt && Sg!.old?.[x]) this.newestOldCache[x] = clone(Sg!.old[x])
      if (rec?.unres && (!newest || cmp(rec.unres, newest.st) > 0))
        newest = { st: rec.unres, fp: null }
      let c: Classified
      if (!sync && !Sg) c = { kind: 'boot', st: BOOT }
      else if (rec && !rec.unres && this.fpOf(x, v) === rec.fp)
        c = {
          kind: 'stamped',
          st: rec.st,
          p: (rec as SiloEntry).p ?? null,
          old: (rec as SiloEntry).old ?? {},
        }
      else if (!doc && Sg)
        c = { kind: 'change' } // an older page REMOVED the key (its Full Reset)
      // a setting field ABSENT from an older page's doc is one that build does not know: the newest stands
      else if (
        !this.isSilo(x) &&
        disk === undefined &&
        sAt &&
        this.newestValue(x, sAt) !== NO_VALUE
      )
        c = { kind: 'carryReg', st: sAt.st, val: this.newestValue(x, sAt) }
      // (2.2 compact) a setting with no entry in the envelope or the key is one no new window has changed
      // since the update: the device's value is its value
      else if (!this.isSilo(x) && Sg && !sAt && !rec) c = { kind: 'boot', st: BOOT }
      else if (!this.isSilo(x)) c = this.classifyReg(x, v, sAt)
      else c = this.classifySilo(x, disk, v as Silo, newest, Sg, g, olderTagged)
      if (this.isSilo(x) && c.kind !== 'stamped' && c.kind !== 'boot')
        c.newestOld =
          Sg && newest && Sg.at?.[x] && cmp(Sg.at[x].st, newest.st) === 0 ? (Sg.old?.[x] ?? {}) : {}
      if (c.kind === 'current' && this.isSilo(x)) c.old = c.newestOld
      // (v4) the PLAY STAMP of the version the device names: what a held Reset is weighed against
      if (this.isSilo(x)) {
        c.ps =
          (rec && !rec.unres && c.kind === 'stamped' ? (rec as SiloEntry).ps : null) ??
          (sAt && (c.kind === 'stamped' || c.kind === 'current') ? sAt.ps : null) ??
          null
        c.newestPs = sAt?.ps ?? null
      }
      out[x] = { v, disk, newest, ...c }
    }
    return { out, g, S: Sg, sync, docPresent: !!doc }
  }
  // (2.2 compact) one slice's envelope entry in a canonical shape, and the entry the key implies for it
  entryShape(x: string, e: SiloEntry | RegEntry): unknown {
    return this.isSilo(x)
      ? {
          st: e.st,
          fp: e.fp,
          p: (e as SiloEntry).p ?? null,
          old: (e as SiloEntry).old ?? {},
          ps: (e as SiloEntry).ps ?? null,
          ...(e.unres ? { unres: e.unres } : {}),
        }
      : { st: e.st, fp: e.fp, ...(e.unres ? { unres: e.unres } : {}) }
  }
  fullEntry(x: string, S: SyncKey): SiloEntry | RegEntry {
    const a = S.at[x]
    return this.isSilo(x)
      ? { st: a.st, fp: a.fp as string, p: a.p ?? null, old: S.old?.[x] ?? {}, ps: a.ps ?? null }
      : { st: a.st, fp: a.fp as string }
  }
  // A SETTING written by an older page (no tag can ride inside a setting).
  classifyReg(x: string, v: unknown, sAt: KeyEntry | null): Classified {
    if (sAt && this.fpOf(x, v) === sAt.fp) return { kind: 'current', st: sAt.st }
    // A TAGGED value that is not the newest is a version a new build wrote, carried unchanged by an
    // older page (however many versions back): the newest stands. Changed by an older page, its tag no
    // longer names its values, and it is that page's change (below).
    if (sAt && this.shape.tagged?.(x, v)) {
      const val = this.newestValue(x, sAt)
      if (val !== NO_VALUE) return { kind: 'carryReg', st: sAt.st, val }
    }
    // (V2-F6) THE VALUE JUST BEFORE THE NEWEST CHANGE is that page's stale copy - unless an older page
    // has been seen holding the newest value since it was set (then it may have set the old value back)
    if (
      sAt &&
      sAt.prev &&
      !sAt.seen &&
      this.fpOf(x, v) === sAt.prev.fp &&
      this.newestValue(x, sAt) !== NO_VALUE
    )
      return { kind: 'carryReg', st: sAt.st, val: this.newestValue(x, sAt) }
    return { kind: 'change' }
  }
  // The newest value of a setting, to put back over an older page's stale copy: the key's - or, for a
  // value too long to be copied into the key (KEY_VALUE_MAX), this window's own when it holds that very
  // version; otherwise none can be put back (part2-issues #4: the older page's copy then stands).
  newestValue(x: string, sAt: KeyEntry): unknown {
    if ('v' in sAt) return sAt.v
    const mine = this.mem[x]?.v
    return this.fpOf(x, mine) === sAt.fp ? mine : NO_VALUE
  }
  classifySilo(
    x: string,
    disk: unknown,
    v: Silo,
    newest: { st: Stamp; fp: string | null } | null,
    S: SyncKey | null,
    g: string | null,
    olderTagged = true,
  ): Classified {
    const t0 = disk === undefined || disk === null ? null : this.shape.silo(disk).tag
    const tag = t0 && t0.g === g ? t0 : null
    // (v4) the bootstrap summary as THIS window knows it: one it has retired (an adopted change not yet in
    // the key, its save held on a full device) is retired here too - in the generation it was made in
    const ownPend = this.g === g
    const boot = S
      ? ownPend && x in this.bootPend
        ? this.bootPend[x]
        : (S.boot?.[x] ?? null)
      : null
    if (tag) {
      // (a slice no new window changed since the bootstrap carries the BOOT stamp: its base IS the
      // bootstrap record)
      const tb: Stamp | string = tag.st.t === BOOT.t ? 'BOOT' : tag.st
      if (isVersion(v, tag)) {
        if (newest && cmp(tag.st, newest.st) < 0) return { kind: 'carry', base: tb }
        return { kind: 'current', st: tag.st }
      }
      if (extendsSum(v, tag)) return { kind: 'block', base: tb, sum: tag }
      // (V2-F1) still tagged but not an extension: kept as the older page's own change to ITS part,
      // never a whole-copy CHANGE
      return { kind: 'block', base: tb, sum: tag, odd: true }
    }
    // (v5, the review lane's (b): R4 in its commonest form) A BLANK copy of a mode that was BLANK AT THE
    // BOOTSTRAP, in an older page's own write with no tag of this generation in ANY mode (it reads as a
    // page from before the first new save, which never saw the new answers there), is that page's stale
    // copy of the bootstrap - a carry - unless older cards were already folded into this mode (the SYNC
    // KEY's fold records: every window reads the same, so all decide alike); then a blank copy may be that
    // page's Reset, read as before. (An older page's whole copy adopted as a change retires the bootstrap
    // record - retireBoot - so a mode that had one never reaches here. An older tab answering the blank
    // mode ITSELF stays R4: its untagged copy cannot be placed, design 2.8; its Reset of such a mode, in a
    // copy with no tag anywhere, is R4b.) The bootstrap is read as the KEY records it: a window's own
    // retirement still unsaved is knowledge the device refused, and a carry folds nothing.
    const bootKey = S?.boot?.[x] ?? null
    if (v.pl === 0 && !olderTagged && bootKey && bootKey.pl === 0) {
      const folded = Object.values(S?.old?.[x] ?? {}).some((q) => (q?.k ?? 0) > 0)
      if (!folded) return newest ? { kind: 'carry', base: 'BOOT' } : { kind: 'current', st: BOOT }
    }
    if (v.pl === 0) return { kind: 'change' } // untagged and empty: a reset (or older than any new write)
    if (boot && boot.pl > 0 && isVersion(v, boot))
      return newest ? { kind: 'carry', base: 'BOOT' } : { kind: 'current', st: BOOT }
    if (boot && boot.pl > 0 && boot.n > 0 && extendsSum(v, boot))
      return { kind: 'block', base: 'BOOT', sum: boot }
    return { kind: 'change' }
  }

  // A CHANGE adopted (an older page's whole copy): from now on no copy can be trusted to extend the
  // bootstrap bytes, and (v5) a blank copy can no longer read as an older page's stale copy of a blank
  // bootstrap - the mode's bootstrap record retires.
  retireBoot(x: string): void {
    if (this.isSilo(x) && this.boot?.[x]) {
      this.boot[x] = null
      this.bootPend[x] = null
    }
  }

  // ── FOLDING an older page's block, from counts alone (2.5.4) ──
  blockOf(v: Silo, sum: Summary | Tag): Block {
    const B: Block = { k: v.pl - sum.pl, g: v.gd - sum.gd, t: v.t.slice(sum.n), sk: v.sk, bs: v.bs }
    if (this.hooks.ledger) B.x = this.hooks.ledger.block(v, sum)
    return B
  }
  recOf(B: Block, st: Stamp | null | 'land'): FoldRec {
    const r: FoldRec = { k: B.k, g: B.g, n: B.t.length, t: [...B.t], s: B.sk, b: B.bs, st }
    if (this.hooks.ledger) r.x = this.hooks.ledger.rec(B)
    return r
  }
  fold(
    x: string,
    held: Mem,
    d: DevSlice,
  ): { v: Silo; rec: FoldRec | null; exactOld?: boolean; dropped?: boolean } {
    const hv = held.v as Silo
    const dv = d.v as Silo
    const B = this.blockOf(dv, d.sum!)
    const done: FoldRec = this.oldApplied[x]?.[this.baseKey(d.base!)] ?? {
      k: 0,
      g: 0,
      n: 0,
      t: [],
      s: d.sum!.sk,
      b: d.sum!.bs,
      st: null,
    }
    this.hooks.onWeigh?.(this, x, B, done)
    // the newest-card or deeper Override, carried EXACTLY: the pool is still the very version the fold
    // made and that version was exactly the older page's view (nothing else in it since its base)
    const asOldNow =
      (isStampBase(d.base) && cmp(held.st, d.base) === 0) ||
      (!!done.st && done.st !== 'land' && !!done.asOld && cmp(held.st, done.st) === 0)
    if (asOldNow) {
      if (
        B.k !== done.k ||
        B.g !== done.g ||
        !sameTimes(B.t, done.t) ||
        B.sk !== done.s ||
        B.bs !== done.b
      )
        this.hooks.counter?.('carried')
      return { v: dv, rec: { ...this.recOf(B, 'land'), ih: true }, exactOld: true }
    }
    const dk = B.k - done.k
    const okPrefix = B.t.length >= done.n && startsWith(B.t, done.t)
    if (
      dk === 0 &&
      B.g === done.g &&
      okPrefix &&
      B.t.length === done.n &&
      B.sk === done.s &&
      B.bs === done.b
    )
      return { v: hv, rec: null } // nothing new
    // (v4) A BLOCK THE RECORD ALREADY COVERS - fewer cards, its times a prefix of the record's - is an
    // EARLIER copy of this lineage (bytes a lagging window passed through, or a stale read), never news
    if (dk < 0 && B.g <= done.g && B.t.length <= done.n && startsWith(done.t, B.t))
      return { v: hv, rec: null }
    // (V2-F5, A5) a record whose cards are NOT all in the version held cannot absorb an Override of one
    // of them: folded then only from a CONTIGUOUS read (2.5.8)
    const safe = done.ih !== false || !!this.contig?.has(x)
    if (dk > 0 && okPrefix && consistent(B, done) && safe) {
      const part: Part = { k: dk, g: B.g - done.g, t: B.t.slice(done.n), sk: B.sk }
      if (this.hooks.ledger) part.x = this.hooks.ledger.part(B, done)
      this.hooks.onFoldBad?.(this, x, B, done, part, hv)
      const MUT = this.hooks.mut ?? null
      if (MUT === 'drop' || (MUT === 'dropOne' && part.k === 1 && part.g === 1)) {
        this.hooks.onMutFired?.()
        return { v: { ...hv, x: markMut(hv.x) }, rec: { ...this.recOf(B, 'land'), ih: true } }
      }
      const v = this.foldPart(hv, part)
      if (MUT === 'double' && part.k === 1) {
        this.hooks.onMutFired?.()
        const v2 = this.foldPart(v, part)
        return { v: { ...v2, x: markMut(v2.x) }, rec: { ...this.recOf(B, 'land'), ih: true } }
      }
      return { v, rec: { ...this.recOf(B, 'land'), ih: true } }
    }
    // not foldable: the held version stands; this block is accounted for as it now stands
    this.hooks.counter?.('dropped')
    this.hooks.counter?.('droppedAnswers', Math.max(0, dk))
    return {
      v: hv,
      rec: { ...this.recOf(B, done.st && done.st !== 'land' ? done.st : null), ih: false },
      dropped: true,
    }
  }
  // the part appended to the held counts
  foldPart(h: Silo, part: Part): Silo {
    const o: Silo = {
      pl: h.pl + part.k,
      gd: h.gd + part.g,
      sk: 0,
      bs: h.bs,
      t: [...h.t, ...part.t],
      tl: h.tl,
    }
    if (this.hooks.ledger) o.x = this.hooks.ledger.fold(h, part)
    if (part.g === part.k) {
      o.sk = h.sk + part.k
      o.bs = Math.max(h.bs, o.sk)
    } else if (part.g === 0) o.sk = 0
    else {
      o.sk = part.sk // the trailing run lies inside the part: it holds a wrong answer
      o.bs = Math.max(h.bs, part.sk) // never above a run the part provably holds
      this.hooks.counter?.('inexact')
    }
    return o
  }
  baseKey(b: Stamp | string): string {
    return typeof b === 'string' ? b : key(b)
  }

  // ── taking what the device shows ──
  adoptAll(dev: Dev): void {
    this.mem = {}
    this.base = {}
    this.dirty = {}
    this.prov = {}
    this.unres = {}
    this.raw = {}
    this.parent = {}
    this.parentV = {}
    this.oldApplied = {}
    this.boot = clone(dev.S ? (dev.S.boot ?? {}) : {})
    this.g = dev.g
    this.bootPend = {} // (the retirements of the generation left behind)
    for (const x of this.SL) {
      const d = dev.out[x]
      this.takeDevice(x, d)
      if (d.kind === 'boot' && this.isSilo(x)) this.boot[x] = this.summ(d.v as Silo)
    }
  }
  takeDevice(x: string, d: DevSlice): void {
    delete this.prov[x]
    delete this.unres[x]
    delete this.raw[x]
    delete this.unresBlock[x]
    this.parent[x] = null
    delete this.parentV[x]
    if (this.isSilo(x)) this.oldApplied[x] = clone(d.old ?? {})
    // (v4) the play stamp of what is now held; an adopted older copy holding answers is play
    if (this.isSilo(x)) {
      if (d.kind === 'change') {
        if ((d.v as Silo).pl > 0) this.playPend[x] = true
      } else if (
        d.kind === 'block' &&
        d.newest &&
        isStampBase(d.base) &&
        cmp(d.base, d.newest.st) === 0
      ) {
        this.psHeld[x] = d.newestPs ?? null
        if ((d.v as Silo).pl > d.sum!.pl) this.playPend[x] = true
      } else this.psHeld[x] = d.ps ?? null
    }
    if (d.kind === 'stamped' || d.kind === 'current' || d.kind === 'boot') {
      this.mem[x] = { v: d.v, st: d.st! }
      this.parent[x] = d.p?.st ?? null
    } else if (d.kind === 'carryReg') {
      // a setting's stale copy: the newest value comes back (its value is in the sync key)
      this.mem[x] = { v: d.val, st: d.st! }
    } else if (d.kind === 'change') {
      this.retireBoot(x)
      this.parent[x] = d.newest?.st ?? null
      this.mem[x] = { v: d.v, st: { ...(d.newest?.st ?? ZERO), d: 1 } }
      this.prov[x] = true
    } else if (
      d.kind === 'block' &&
      d.newest &&
      isStampBase(d.base) &&
      cmp(d.base, d.newest.st) === 0
    ) {
      // an older page's own cards on the NEWEST version: its own counts are the result
      this.oldApplied[x] = clone(d.newestOld ?? {})
      this.parent[x] = d.newest.st
      this.noteApplied(x, d.base, {
        ...this.recOf(this.blockOf(d.v as Silo, d.sum!), 'land'),
        asOld: true,
      })
      this.mem[x] = { v: d.v, st: { ...d.newest.st, d: 1 } }
      this.prov[x] = true
      this.landPend[x] = { b: key(d.base), fp: this.fpOf(x, d.v), asOld: true }
    } else {
      // a proven carry, or a block on an older base: only a holder of the newest version may resolve it
      const nst = d.newest?.st ?? ZERO
      this.mem[x] = { v: d.v, st: { ...nst, d: -1 } }
      this.unres[x] = nst
      this.raw[x] = d.disk
      this.unresBase[x] = d.base ?? null
      if (d.kind === 'block')
        this.unresBlock[x] = {
          base: d.base!,
          sum: d.sum!,
          old:
            isStampBase(d.base) && d.newest && cmp(d.base, d.newest.st) === 0
              ? clone(d.newestOld ?? {})
              : isStampBase(d.base)
                ? clone(this.recCache[key(d.base)] ?? this.newestOldCache[x] ?? {})
                : {},
        }
    }
    this.base[x] = { v: this.mem[x].v, st: this.mem[x].st }
  }
  noteApplied(x: string, base: Stamp | string, rec: FoldRec & { st?: FoldRec['st'] }): void {
    const k = this.baseKey(base)
    const prev = this.oldApplied[x]?.[k]
    ;(this.oldApplied[x] ??= {})[k] = {
      ...rec,
      st: rec.st === undefined ? (prev?.st ?? null) : rec.st,
    }
  }
  holdsV(x: string, held: Mem, newest: { st: Stamp; fp: string | null } | null): boolean {
    return (
      !!newest &&
      !this.unres[x] &&
      held.st.d >= 0 &&
      (cmp(held.st, newest.st) > 0 ||
        (cmp(held.st, newest.st) === 0 &&
          (newest.fp === null || newest.fp === this.fpOf(x, held.v))))
    )
  }

  // The sibling rule (2.5.6): my UN-WRITTEN version meets a version written meanwhile from the same
  // written parent; the sibling's parent record lists exactly what it appended - re-applied exactly.
  sibling(x: string, held: Mem, d: DevSlice): { v: Silo; old: Record<string, FoldRec> } | null {
    const myP = this.parent?.[x]
    if (
      !this.isSilo(x) ||
      !this.prov[x] ||
      !myP ||
      myP.d !== 0 ||
      d.kind !== 'stamped' ||
      !d.p ||
      !d.p.ext ||
      d.p.st.d !== 0
    )
      return null
    if (
      cmp(d.p.st, myP) !== 0 ||
      cmp(d.st!, held.st) <= 0 ||
      this.fpOf(x, d.v) === this.fpOf(x, held.v)
    )
      return null
    const mineOld = this.oldApplied[x] ?? {}
    let v = held.v as Silo
    const old = clone(mineOld)
    for (const seg of d.p.ext) {
      if (seg.own) {
        v = this.applyOps(v, seg.own)
        continue
      }
      // a fold segment: only the part of it this version lacks
      const have = old[seg.base]?.k ?? seg.from
      if (have >= seg.to) continue
      if (have > seg.from) return null // partly overlapping folds cannot be separated: the sibling stands
      v = this.foldPart(v, seg.part)
      old[seg.base] = { ...seg.rec, st: null }
    }
    return { v, old }
  }

  // ── THE MERGE (2.5) ──
  merge(): { kept: string[] } {
    const dev = this.readDev()
    this.hooks.onRead?.(this, dev)
    const kept: string[] = []
    for (const x of this.SL) {
      see(this.hlc, dev.out[x].st)
      if (dev.out[x].newest) see(this.hlc, dev.out[x].newest!.st)
    }
    // another generation: take the device whole - and write back what taking it re-asserted or stamped
    if (this.g && dev.g !== this.g) {
      this.adoptAll(dev)
      return { kept: this.SL.filter((x) => dev.out[x].kind === 'carryReg' || this.prov[x]) }
    }
    if (!this.g && dev.g) this.g = dev.g
    if (dev.S) this.boot = { ...clone(dev.S.boot ?? {}), ...this.bootPend }
    // (V2-F6) an older page seen holding a setting's newest value: from now on its old value may be a
    // real choice
    const seenNow: string[] = []
    for (const x of this.shape.regs) {
      const d = dev.out[x]
      if (
        !dev.sync &&
        dev.docPresent &&
        d.kind === 'current' &&
        dev.S?.at?.[x] &&
        !dev.S.at[x].seen
      ) {
        this.seenNewest[x] = true
        seenNow.push(x)
      }
    }
    kept.push(...seenNow)
    for (const x of this.SL) {
      let d = dev.out[x]
      const dirty = this.dirty[x]
      const held = dirty ? this.base[x] : this.mem[x]
      if (this.isSilo(x) && (d.ps || d.newestPs)) {
        const p = (d.ps ?? d.newestPs)!
        if (!this.knownPs[x] || cmp(p, this.knownPs[x]) > 0) this.knownPs[x] = p
      }
      if (this.isSilo(x)) this.hooks.onHeld?.(this, x, this.mem[x].v as Silo)
      if (d.kind === 'boot') {
        if (!dirty && this.fpOf(x, this.mem[x].v) !== this.fpOf(x, d.v)) this.takeDevice(x, d)
        else if (!dirty && this.isSilo(x)) this.mem[x] = { v: d.v, st: this.mem[x].st }
        if (this.isSilo(x)) this.boot[x] = this.summ(d.v as Silo)
        if (dirty && this.fpOf(x, d.v) !== this.fpOf(x, held.v)) this.rebaseDirty(x, d, true)
        continue
      }
      if (d.kind === 'carryReg') {
        // The prev-value rule speaks for the sync key's newest version. A window holding a NEWER version
        // than the sync key names knows the key is stale: the device agreeing with it is current,
        // anything else is a change.
        if (cmp(held.st, d.st!) > 0) {
          if (this.fpOf(x, held.v) === this.fpOf(x, d.v)) continue
          d = { ...d, kind: 'change' }
          if (!dirty) {
            this.takeDevice(x, d)
            kept.push(x)
          } else this.rebaseDirty(x, d)
          continue
        }
        // any window may put a setting's newest value back: the value itself is in the sync key
        if (!dirty) {
          this.takeDevice(x, d)
          kept.push(x)
        }
        continue
      }
      let resolved: Silo | null = null
      let recMoved = false // (a fold record is part of its version: a record changed on an unchanged value is a NEW version)
      if ((d.kind === 'carry' || d.kind === 'block') && this.holdsV(x, held, d.newest)) {
        if (d.kind === 'carry') resolved = held.v as Silo
        else {
          const rb = JSON.stringify(this.oldApplied[x]?.[this.baseKey(d.base!)] ?? null)
          const r = this.fold(x, held, d)
          resolved = r.v
          if (r.rec) {
            this.noteApplied(x, d.base!, {
              ...r.rec,
              st: r.rec.st === 'land' ? (dirty ? null : 'land') : r.rec.st,
            })
            if (r.rec.st === 'land' && !dirty)
              this.landPend[x] = {
                b: this.baseKey(d.base!),
                fp: this.fpOf(x, r.v),
                asOld: !!r.exactOld,
              }
          }
          if (r.exactOld && this.landPend[x]) this.landPend[x].asOld = true
          recMoved = JSON.stringify(this.oldApplied[x]?.[this.baseKey(d.base!)] ?? null) !== rb
          const hv = held.v as Silo
          if (resolved !== held.v && this.fpOf(x, resolved) !== this.fpOf(x, hv)) {
            const B = this.blockOf(d.v as Silo, d.sum!)
            const heldRec = this.heldOld?.[x]?.[this.baseKey(d.base!)]
            const part: Part = {
              k: resolved.pl - hv.pl,
              g: resolved.gd - hv.gd,
              t: resolved.t.slice(hv.t.length),
              sk: resolved.sk,
            }
            if (this.hooks.ledger) part.x = this.hooks.ledger.segPart(resolved, hv, B, heldRec)
            ;(this.segs[x] ??= []).push({
              base: this.baseKey(d.base!),
              from: heldRec?.k ?? 0,
              to: (d.v as Silo).pl - d.sum!.pl,
              part,
              rec: this.oldApplied[x][this.baseKey(d.base!)],
            })
          }
        }
      }
      if (dirty) {
        const now = resolved ?? d.v
        // Equal counts mean the same value only for a NEW window's version (its stamp names the content).
        if (
          this.fpOf(x, now) === this.fpOf(x, held.v) &&
          (resolved || !this.isSilo(x) || d.kind === 'stamped' || d.kind === 'current')
        ) {
          // (v4) equal counts under a held Reset: a NEWER version with the same counts may still be play
          if (
            this.isSilo(x) &&
            !resolved &&
            dirty.reset &&
            (d.kind === 'stamped' || d.kind === 'current') &&
            cmp(d.st!, this.base[x].st) > 0 &&
            this.playSince(x, d)
          ) {
            this.rebaseDirty(x, d, true)
            continue
          }
          if (this.isSilo(x) && !resolved) {
            // (the fold records travel with the version: a newer version of the same value brings its own)
            if (d.kind === 'stamped' && cmp(d.st!, this.base[x].st) > 0 && d.old)
              this.oldApplied[x] = clone(d.old)
            this.base[x] = { v: d.v, st: this.base[x].st }
            if (!dirty.reset)
              this.mem[x] = { v: this.applyOps(d.v as Silo, dirty.ops), st: this.mem[x].st }
            if (d.kind === 'stamped' && d.st!.d === 0 && cmp(d.st!, this.base[x].st) !== 0)
              this.rebased[x] = { st: d.st!, v: d.v as Silo }
          }
          if (resolved) kept.push(x)
          continue
        }
        if (d.kind === 'stamped' && cmp(d.st!, this.base[x].st) < 0 && this.base[x].st.d >= 0)
          continue
        const sibD = !resolved ? this.sibling(x, held, d) : null
        if (sibD) {
          this.oldApplied[x] = sibD.old
          this.rebaseDirty(
            x,
            {
              ...d,
              kind: 'stamped',
              st: { ...d.st!, d: d.st!.d + 1 },
              v: sibD.v,
              old: clone(sibD.old),
              p: null,
            },
            this.playSince(x, d),
          )
          this.prov[x] = true
          this.parent[x] = d.st!
          kept.push(x)
          continue
        }
        const prevParent = this.parent?.[x] ?? null
        this.rebaseDirty(
          x,
          resolved
            ? {
                ...d,
                kind: 'stamped',
                st: { ...held.st, d: held.st.d + 1 },
                v: resolved,
                old: clone(this.oldApplied[x] ?? {}),
                p: null,
              }
            : d,
          resolved ? resolved.pl > (held.v as Silo).pl : this.playSince(x, d),
        )
        if (resolved) {
          this.prov[x] = true
          this.parent[x] = held.st.d === 0 ? held.st : prevParent
          kept.push(x)
        }
        continue
      }
      const mine = this.mem[x]
      if (resolved) {
        if (this.fpOf(x, resolved) !== this.fpOf(x, mine.v) || recMoved) {
          this.mem[x] = { v: resolved, st: { ...mine.st, d: mine.st.d + 1 } }
          this.prov[x] = true
          if (held.st.d === 0) {
            this.parent[x] = held.st
            this.parentV[x] = held.v as Silo
          }
        }
        this.base[x] = { v: this.mem[x].v, st: this.mem[x].st }
        kept.push(x)
        continue
      }
      const sib = this.sibling(x, mine, d)
      if (sib) {
        this.mem[x] = { v: sib.v, st: { ...d.st!, d: d.st!.d + 1 } }
        this.parent[x] = d.st!
        this.parentV[x] = d.v as Silo
        this.oldApplied[x] = sib.old
        this.base[x] = { v: sib.v, st: this.mem[x].st }
        kept.push(x)
        continue
      }
      if (this.fpOf(x, mine.v) === this.fpOf(x, d.v) && d.kind !== 'block' && d.kind !== 'carry') {
        // (equal counts are the same value to the app; the oracle's ledger follows the newer version only)
        if (
          this.isSilo(x) &&
          !((d.kind === 'stamped' || d.kind === 'current') && cmp(d.st!, mine.st) < 0)
        )
          this.mem[x] = { v: d.v, st: this.mem[x].st }
        if (d.kind === 'change') {
          // (v5, 2.4) a change on content equal to what this window holds is still a change adopted:
          // the bootstrap record retires on EVERY path (the model skipped this one: an older tab's Reset
          // of its own adopted answers then read as a stale blank copy - Amnesic run 24/520)
          this.retireBoot(x)
          const above = { ...(d.newest?.st ?? ZERO), d: 1 }
          if (cmp(above, this.mem[x].st) > 0) this.mem[x] = { v: this.mem[x].v, st: above }
          this.prov[x] = true
          delete this.unres[x]
          delete this.raw[x]
          kept.push(x)
        }
        if ((d.kind === 'stamped' || d.kind === 'current') && cmp(d.st!, mine.st) > 0) {
          this.mem[x] = { v: this.mem[x].v, st: d.st! }
          if (this.isSilo(x) && d.old) this.oldApplied[x] = clone(d.old)
          delete this.prov[x]
          delete this.unres[x]
          delete this.raw[x]
          this.parent[x] = d.p?.st ?? null
        }
        this.base[x] = { v: this.mem[x].v, st: this.mem[x].st }
        continue
      }
      if (d.kind === 'stamped' || d.kind === 'current') {
        if (cmp(d.st!, mine.st) < 0 && mine.st.d >= 0 && !this.unres[x]) kept.push(x)
        else this.takeDevice(x, d)
        continue
      }
      if (!(this.unres[x] && JSON.stringify(this.raw[x]) === JSON.stringify(d.disk)))
        this.takeDevice(x, d)
      if (this.prov[x]) kept.push(x)
    }
    return { kept }
  }
  rebaseDirty(x: string, d: DevSlice, play = true): void {
    const dirty = this.dirty[x]
    if (this.isSilo(x)) {
      // (v4, V3-F4) a Reset not yet landed is cancelled ONLY by possible play since it was pressed
      if (dirty.reset && !play) {
        this.hooks.counter?.('resetKept')
        this.takeDevice(x, d)
        this.mem[x] = { v: this.applyOps(this.blank(), dirty.ops), st: this.mem[x].st }
        this.base[x] = { v: d.v, st: this.base[x].st }
        return
      }
      dirty.reset = false // a Reset not yet landed, under play by another window since: cancelled
      this.takeDevice(x, d)
      if (dirty.ops.length === 0) delete this.dirty[x]
      else {
        this.mem[x] = { v: this.applyOps(d.v as Silo, dirty.ops), st: this.mem[x].st }
        this.base[x] = { v: d.v, st: this.base[x].st }
        this.rebased[x] = {
          st: d.kind === 'stamped' && d.st!.d === 0 ? d.st! : null,
          v: d.v as Silo,
        }
      }
    } else {
      this.takeDevice(x, d)
      delete this.dirty[x]
    }
  }
  // (v4) does the device content show play since this window's held Reset was pressed?
  playSince(x: string, d: DevSlice): boolean {
    if (!this.isSilo(x)) return true
    if (d.kind === 'stamped' || d.kind === 'current')
      return !!d.ps && key(d.ps) !== (this.pressPs[x] ? key(this.pressPs[x]!) : null)
    // an older page's whole copy the counts cannot place: it may hold answers made after the press
    return true
  }

  // ── WRITING (2.5.7) ──
  land(): boolean {
    const before = this.snapshot()
    if (!this.g) this.g = this.newGeneration()
    // the parent of every version written now, and EXACTLY what it appended to that parent
    for (const x of this.SL)
      if (this.dirty[x] && this.unres[x]) {
        const ub = this.unresBlock[x]
        // the version written here stands on the older page's copy of a version: it inherits THAT
        // version's fold records (as read when this window saw it)
        const ubase = this.unresBase[x]
        if (this.isSilo(x) && !ub && ubase && isStampBase(ubase))
          this.oldApplied[x] = clone(this.recCache[key(ubase)] ?? this.newestOldCache[x] ?? {})
        if (ub) {
          this.oldApplied[x] = clone(ub.old)
          const B = this.blockOf(this.memOfDisk(x, this.raw[x]) as Silo, ub.sum)
          this.noteApplied(x, ub.base, this.recOf(B, null))
        }
        delete this.unres[x]
        delete this.raw[x]
        delete this.unresBlock[x]
      }
    const parentSum: Record<string, ParentSum> = {}
    for (const x of this.shape.silos) {
      let pst = this.parent?.[x] ?? null
      let pv: Silo | null = this.parentV?.[x] ?? null
      let ext: Seg[] | null = null
      if (this.dirty[x]) {
        const rb = this.rebased[x]
        pst = rb ? rb.st : this.base[x].st.d === 0 ? this.base[x].st : null
        pv = rb ? rb.v : (this.base[x].v as Silo)
        // (a whole-slice change - an Override - is no append: the sibling rule cannot re-apply it)
        const replaces = this.dirty[x].ops.some((op) => op.kind === 'rep')
        ext =
          this.dirty[x].reset || replaces
            ? null
            : [...(this.segs[x] ?? []), { own: this.dirty[x].ops }]
      } else if (this.prov[x] && this.segs[x]) ext = this.segs[x]
      if (pst && pst.d === 0 && pv) parentSum[x] = { st: pst, pl: pv.pl, ext }
    }
    const provNow = { ...this.prov }
    // stamps are minted for this write; a refused write keeps none of them (restore, below)
    for (const x of this.SL)
      if (this.dirty[x] || this.prov[x])
        this.mem[x] = { v: this.mem[x].v, st: mint(this.hlc, this.tag) }
    for (const [x, p] of Object.entries(this.landPend)) {
      const a = this.oldApplied[x]?.[p.b]
      if (a && a.st === 'land') {
        a.st = !this.dirty[x] && this.fpOf(x, this.mem[x].v) === p.fp ? this.mem[x].st : null
        if (p.asOld && a.st) a.asOld = true
      }
    }
    // a Reset written now: the cards every fold record of that mode counts are gone from the version
    for (const x of this.shape.silos)
      if (this.dirty[x]?.reset)
        for (const r of Object.values(this.oldApplied[x] ?? {})) r.ih = false
    // (v4) each mode's play stamp: this write's stamp if it adds answers, else the held version's
    const ps: Record<string, Stamp | null> = {}
    const keyText = this.io.deviceKey()
    const prevKey = this.shape.readKey(keyText)
    const later = (a: Stamp | null, b: Stamp | null) =>
      !a ? (b ?? null) : !b ? a : cmp(a, b) >= 0 ? a : b
    for (const x of this.shape.silos) {
      const adds =
        // (an Override is no play: V3-F4)
        (this.dirty[x]?.ops ?? []).some((op) => op.kind === 'a') ||
        (this.segs[x] ?? []).some(
          (sg) =>
            ('part' in sg && (sg.part?.k ?? 0) > 0) || ('own' in sg && (sg.own?.length ?? 0) > 0),
        ) ||
        !!this.playPend[x]
      ps[x] =
        adds && (this.dirty[x] || this.prov[x])
          ? this.mem[x].st
          : later(
              this.psHeld[x] ?? null,
              prevKey && prevKey.g === this.g ? (prevKey.at?.[x]?.ps ?? null) : null,
            )
    }
    const state: Disk = {}
    const at: Record<string, SiloEntry | RegEntry> = {}
    for (const x of this.SL) {
      const m = this.mem[x]
      if (this.unres[x]) {
        state[x] = this.raw[x]
        at[x] = { st: m.st, fp: this.fpOf(x, m.v), unres: this.unres[x] }
      } else {
        state[x] = this.isSilo(x)
          ? this.shape.diskSilo(m.v as Silo, this.tagOf(m.st, m.v as Silo))
          : m.v
        at[x] = this.isSilo(x)
          ? {
              st: m.st,
              fp: this.fpOf(x, m.v),
              p: parentSum[x] ?? null,
              old: this.oldApplied[x] ?? {},
              ps: ps[x],
            }
          : { st: m.st, fp: this.fpOf(x, m.v) }
      }
      // (2.2 compact) a setting still at its value from before the update carries no entry anywhere -
      // nor one this window knows nothing of (stamp ZERO: a slice it has just begun to name, as the
      // preset list's do as presets come and go). An entry at ZERO is no version: written, it read as
      // older than "no entry" to one window and newer to another, and the two wrote it in and out
      // for ever (tests/syncedDoc.registry.fuzz found the loop).
      if (!this.isSilo(x) && !this.unres[x] && (cmp(m.st, BOOT) === 0 || cmp(m.st, ZERO) === 0))
        delete at[x]
    }
    // (2.2 compact) THE ENVELOPE CARRIES ONLY WHAT THE SYNC KEY DOES NOT ALREADY SAY
    const keyEntry = (x: string) =>
      prevKey && prevKey.g === this.g && prevKey.at?.[x] ? this.fullEntry(x, prevKey) : null
    const atC: Record<string, SiloEntry | RegEntry | 0> = Object.fromEntries(
      Object.entries(at).filter(
        ([x, e]) =>
          JSON.stringify(keyEntry(x) && this.entryShape(x, keyEntry(x)!)) !==
          JSON.stringify(this.entryShape(x, e)),
      ),
    )
    for (const x of this.SL) if (!at[x] && keyEntry(x)) atC[x] = 0
    const docText = this.shape.write(state, { g: this.g!, at: atC }, { g: this.g!, at })
    const resets = this.shape.silos.filter((x) => this.dirty[x]?.reset)
    // the sync key: the newest version of every slice, a setting's value and the value before it
    const prevS = prevKey
    const sAt: Record<string, KeyEntry> = {}
    for (const x of this.SL) {
      const p = prevS && prevS.g === this.g ? prevS.at?.[x] : null
      if (this.unres[x]) {
        sAt[x] = p && cmp(p.st, this.unres[x]) >= 0 ? p : { st: this.unres[x], fp: null }
        continue
      }
      if (!at[x]) continue
      sAt[x] = {
        st: at[x].st,
        fp: at[x].fp,
        ...(this.isSilo(x)
          ? { ps: (at[x] as SiloEntry).ps ?? null, p: (at[x] as SiloEntry).p ?? null }
          : {}),
      }
      if (!this.isSilo(x)) {
        // (the value itself, to put back over a stale copy - not when it is too long to copy: a preset's
        // name has no length limit, and a second copy of a book would halve what the device can hold)
        if (canonicalJson(this.mem[x].v).length <= KEY_VALUE_MAX) sAt[x].v = this.mem[x].v
        const changed = !p || p.fp !== at[x].fp
        // (the value before it: the previous entry's - or, the first change since the update, the value
        // the window held before it, which every older page then held)
        sAt[x].prev = changed
          ? p
            ? { fp: p.fp! }
            : { fp: this.fpOf(x, this.base[x].v) }
          : (p?.prev ?? null)
        // an older page that already holds the newest value can set the previous one back on purpose
        sAt[x].seen = changed ? !!provNow[x] : !!(p?.seen || this.seenNewest[x])
      }
    }
    const nextKey: SyncKey = {
      g: this.g!,
      at: sAt,
      boot: this.boot,
      old: Object.fromEntries(this.shape.silos.map((x) => [x, this.oldApplied[x] ?? {}])),
    }
    const landed = this.io.save(docText, this.shape.writeKey(nextKey), { g: this.g!, at })
    if (!landed) {
      // A refused write changes nothing: every stamp it minted, every record it moved, and every
      // pass-through it took up are as they were (an un-landed version is no version).
      this.restore(before)
      this.hooks.onRefused?.(this)
      return false
    }
    if (resets.length) this.hooks.onResetLanded?.(this, resets, state)
    this.hooks.onLanded?.(this, { g: this.g!, at })
    this.bootPend = {}
    for (const x of this.SL) this.base[x] = { v: this.mem[x].v, st: this.mem[x].st }
    this.psHeld = {
      ...this.psHeld,
      ...Object.fromEntries(this.shape.silos.filter((x) => !this.unres[x]).map((x) => [x, ps[x]])),
    }
    this.playPend = {}
    for (const x of this.shape.silos)
      if (ps[x] && (!this.knownPs[x] || cmp(ps[x]!, this.knownPs[x]) > 0)) this.knownPs[x] = ps[x]!
    this.dirty = {}
    this.prov = {}
    this.landPend = {}
    this.segs = {}
    this.parentV = {}
    this.rebased = {}
    this.seenNewest = {}
    const v = this.io.view()
    this.seen = { doc: v.doc ?? null, side: v.side ?? null }
    return true
  }
  // What land changes before it knows whether the device takes the write — put back if it does not.
  snapshot() {
    return {
      g: this.g,
      hlc: { ...this.hlc },
      mem: { ...this.mem },
      unres: { ...this.unres },
      raw: { ...this.raw },
      unresBlock: { ...this.unresBlock },
      oldApplied: clone(this.oldApplied),
    }
  }
  restore(s: ReturnType<CountsBook['snapshot']>): void {
    this.g = s.g
    this.hlc = s.hlc
    this.mem = s.mem
    this.unres = s.unres
    this.raw = s.raw
    this.unresBlock = s.unresBlock
    this.oldApplied = s.oldApplied
  }
  newGeneration(): string {
    return 'g' + this.tag + Math.floor(Math.random() * 1e9).toString(36)
  }

  // ── NOTICES (2.7): the window's copy moved; handle it ──
  handle(mayLand = true, keptBefore = false): boolean {
    const view = this.io.view()
    const same = (view.doc ?? null) === this.seen.doc && (view.side ?? null) === this.seen.side
    const pending = Object.keys(this.dirty).length > 0 || this.owes || keptBefore
    if (same && !pending) return false
    this.heldOld = clone(this.oldApplied)
    // (2.5.8) a notice carries the old value: per mode, contiguous when it shows the mode exactly as this
    // window last saw it (asked only when there is a device change to merge: a save of this window's own
    // with the device as it last read it has nothing to place)
    if (!same) {
      const prevS =
        view.prevDoc === undefined
          ? null
          : (this.shape.parse(view.prevDoc)?.state ?? blankState(this))
      const seenS = this.shape.parse(this.seen.doc)?.state ?? blankState(this)
      this.contig = new Set(
        prevS
          ? this.shape.silos.filter((x) => this.diskFp(prevS[x]) === this.diskFp(seenS[x]))
          : [],
      )
      if (this.blind && !same) {
        this.contig = new Set()
        this.blind = false
      }
    }
    const { kept } = same ? { kept: [] } : this.merge()
    this.contig = null
    this.seen = { doc: view.doc ?? null, side: view.side ?? null }
    if (!mayLand) return kept.length > 0
    if (kept.length || pending) this.owes = !this.land()
    return false
  }
  /** Open the book on what the device shows now (a new window's first read). */
  open(): void {
    const dev = this.readDev()
    for (const x of this.SL) {
      see(this.hlc, dev.out[x].st)
      if (dev.out[x].newest) see(this.hlc, dev.out[x].newest!.st)
    }
    this.adoptAll(dev)
    const v = this.io.view()
    this.seen = { doc: v.doc ?? null, side: v.side ?? null }
  }

  // ── a player's actions ──
  answer(x: string, op: Op): void {
    this.mem[x] = { v: this.applyOps(this.mem[x].v as Silo, [op]), st: this.mem[x].st }
    ;(this.dirty[x] ??= { reset: false, ops: [] }).ops.push(op)
  }
  reset(x: string): void {
    // (the newest version this window knows of the mode at the press: only play after it cancels the Reset)
    if (!this.dirty[x]?.reset) {
      this.resetBase[x] = this.mem[x].st
      this.pressPs[x] = this.knownPs[x] ?? null
    }
    this.mem[x] = { v: this.blank(), st: this.mem[x].st }
    this.dirty[x] = { reset: true, ops: [] }
  }
  setReg(x: string, v: unknown): void {
    void this.SL // (a slice the shape has just begun to name starts as "nothing known")
    this.mem[x] = { v, st: this.mem[x]?.st ?? ZERO }
    this.base[x] ??= { v: this.absent(x), st: ZERO }
    this.dirty[x] = { reset: false, ops: [], set: true }
  }
  /** Whether a held Reset of this slice is pressed and waiting (for the oracle's kills). */
  resetPending(x: string): boolean {
    return !!this.dirty[x]?.reset
  }
}

const markMut = (x: unknown): unknown =>
  x && typeof x === 'object' ? { ...(x as object), _mut: true } : { _mut: true }
const blankState = (b: CountsBook): Record<string, unknown> => {
  const s: Record<string, unknown> = {}
  for (const x of b.shape.silos) s[x] = undefined
  return s
}

function consistent(B: Block, done: FoldRec): boolean {
  const dk = B.k - done.k
  const dg = B.g - done.g
  const nt = B.t.length - done.n
  if (dk <= 0 || dg < 0 || dg > dk || nt > dg) return false
  if (dg === dk) return B.sk === done.s + dk && B.bs === Math.max(done.b, B.sk)
  if (dg === 0) return B.sk === 0 && B.bs === done.b && nt === 0
  return B.sk < dk && B.sk <= dg && B.bs >= Math.max(done.b, B.sk)
}

// ── THE TAG AS STORED (2.2): one string, `<g>|<stamp>|<played>|<right>|<streak>|<best>|<n>|<hash>|<lost>` ──
export function encodeTag(tg: Tag): string {
  return [tg.g, encodeStamp(tg.st), tg.pl, tg.gd, tg.sk, tg.bs, tg.n, tg.h, tg.tl].join('|')
}
/** A stored tag read back — or null for anything that is not one this build wrote. */
export function decodeTag(text: unknown): Tag | null {
  if (typeof text !== 'string') return null
  const p = text.split('|')
  if (p.length !== 9) return null
  const st = decodeStamp(p[1])
  const n = p.slice(2, 7).map(Number)
  const tl = Number(p[8])
  if (
    !st ||
    !p[0] ||
    !p[7] ||
    !n.every((v) => Number.isSafeInteger(v) && v >= 0) ||
    !Number.isSafeInteger(tl)
  )
    return null
  return { g: p[0], st, pl: n[0], gd: n[1], sk: n[2], bs: n[3], n: n[4], h: p[7], tl }
}
export { isVersion, extendsSum }
