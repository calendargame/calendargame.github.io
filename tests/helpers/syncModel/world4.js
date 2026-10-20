// tests/helpers/syncModel/world4.js — design-q2-model/model4.mjs's WORLD, hosting THE REAL DOOR.
// (design-q1-q2.md v4, 14.2.) Copied from the model with its older pages, its device, its driver log and
// its oracle bookkeeping VERBATIM; its new-window merge is REPLACED by store/syncCounts' CountsBook (the
// section marked THE REAL DOOR below). Times are numbers (the door hashes doubles); a tag is the app's
// string; the oracle's view of a tag or a bootstrap summary reads the door's spelling of it. Everything else
// is the model as reviewed.
//
// The model's own header:
//
//
// A silo on disk is what the app stores: { pl, gd, sk, bs, t: [times of timed right answers, in
// order], w?: TAG }. The design may read ONLY those fields. Beside them every silo carries `_a`, a
// ledger of the answers it counts ({ id, r: right?, tm: time | null }) - for the ORACLE, never read by
// a decision. A NEW window's own answers update the counts exactly; everything it learns from an older
// page it learns from counts alone. The oracle then checks every new-window write: counts and times
// equal what its ledger says, and the streak and the Best never above what the ledger can show.
//
// Older pages behave as v2.27-v2.29 do: memory = the disk objects they loaded (tags carried by every
// change - the engine spreads the silo - and dropped by a Reset - a literal); their own cards since
// load can be OVERRIDDEN AT ANY DEPTH (the gameReducer's toggle: good moves by one, the card's time
// leaves or takes its own slot, streak and best are recomputed from the credit sequence with the
// loaded streak as leading credits and the loaded best as a floor); they reload; they rewrite the doc
// at boot; they remove the doc (Full Reset of an Amnesic copy).
//
// v4 (reviewer A, V3-F1): `_a` is labelled by the merge's own slicing, so it cannot prove the merge never
// counts an answer twice. Every silo therefore also carries `_q`, a MULTISET of the answers it counts
// ({ id: how many times }), kept by exact multiset ARITHMETIC on the same operands the counts use (an
// append adds the answer, a fold adds its block minus the block already folded, a Reset empties it). It
// is never read by a decision. The ORACLE decodes it at EVERY new-window write against the DRIVER's own
// log of every answer ever made (`W.born`, kills): an answer counted twice shows as 2, a part folded on
// the wrong record as a negative or a stranger, and the counts must equal what it names.
//
// New windows read the device ONE WRITE AT A TIME (each `storage` notice is handled against the
// window's own copy, which advances one message at a time - reviewer A's E1), so intermediate states
// of an older page's two-write sequence are seen.
//
// (Amnesic, design-amnesic-close.md) the world also holds the app SESSION (every new window closed ends
// it; the next cold open begins the next), the one preset's Amnesic value and its switch-on count, and the
// FORGET a cold open runs first: the real door's CountsBook.forgetWindow, its anchors taken by the door's
// own copy-on-write (`win`: the window the world says play is in now).

import {
  CountsBook,
  blankSilo,
  encodeTag,
  decodeTag,
  isVersion as doorIsVersion,
  extendsSum as doorExtends,
} from '../../../src/store/syncCounts.js'
import { packSync, unpackSync } from '../../../src/store/syncStamp.js'

export const SILOS = ['A', 'B', 'C']
// R3 is Q21's per-preset Amnesic setting: a field no older build knows - some keep it (v2.28.0+'s codec keeps
// unknown fields), some drop it from the settings doc they rewrite
export const REGS = ['R1', 'R2', 'R3']
export const SL = [...SILOS, ...REGS]
export const isSilo = (x) => SILOS.includes(x)
const BOOT = { m: 0, c: 0, t: '~boot', d: 0 }
export const cmp = (a, b) =>
  a.m - b.m || a.c - b.c || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || a.d - b.d
const key = (st) => (typeof st === 'string' ? st : `${st.m}.${st.c}.${st.t}.${st.d}`)
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const BLANK = () => ({ pl: 0, gd: 0, sk: 0, bs: 0, t: [], _a: [], _q: {} })
// (oracle) multiset arithmetic for `_q`
const qAdd = (a, b) => {
  const o = { ...(a ?? {}) }
  for (const [k, n] of Object.entries(b ?? {})) {
    o[k] = (o[k] ?? 0) + n
    if (o[k] === 0) delete o[k]
  }
  return o
}
const qSub = (a, b) => qAdd(a, Object.fromEntries(Object.entries(b ?? {}).map(([k, n]) => [k, -n])))
export const qSize = (q) => Object.values(q ?? {}).reduce((x, n) => x + n, 0)
// ── counts ──
const th = (t) => t.join(',')
// (oracle) the door's own reading of "is this copy that version / an extension of it" (pure predicates on counts)
const asCounts = (m) => ({ pl: m.pl, gd: m.gd, sk: m.sk, bs: m.bs, t: m.t, tl: 0 })
const isVersion = (m, tg) => doorIsVersion(asCounts(m), tg)
const extendsSum = (m, tg) => doorExtends(asCounts(m), tg)
// (oracle) what a ledger shows: counts, times, the trailing run and the longest run
export function ledgerAgg(a) {
  let pl = 0,
    gd = 0,
    sk = 0,
    bs = 0
  const t = []
  for (const q of a) {
    pl++
    if (q.r) {
      gd++
      sk++
      if (sk > bs) bs = sk
      if (q.tm !== null) t.push(q.tm)
    } else sk = 0
  }
  return { pl, gd, sk, bs, t }
}

// (oracle) what the counts hold beyond (or short of) their ledger: played, right, and the times as a multiset
export function countsDelta(o, L) {
  const m = new Map()
  for (const t of o.t) m.set(t, (m.get(t) ?? 0) + 1)
  for (const t of L.t) m.set(t, (m.get(t) ?? 0) - 1)
  return JSON.stringify([
    o.pl - L.pl,
    o.gd - L.gd,
    [...m.entries()].filter(([, n]) => n !== 0).sort(),
  ])
}

// (Amnesic) a silo's anchor as the world's doc spells it: the door's anchor, its ledger beside it
const anchorOfDisk = (a) =>
  a
    ? {
        e: a.e,
        st: a.st ?? null,
        pl: a.pl,
        gd: a.gd,
        sk: a.sk,
        bs: a.bs,
        n: a.n,
        h: a.h,
        tl: a.tl ?? 0,
        x: { _a: clone(a._a ?? []), _q: { ...(a._q ?? {}) } },
      }
    : null
const anchorToDisk = (a) => {
  const { x, ...rest } = a
  return { ...rest, _a: x?._a ?? [], _q: x?._q ?? {} }
}

export function makeWorld(opt = {}) {
  const O = {
    lag: false,
    prevRule: true,
    foldRule: 'v3',
    chgBase: process.env.CHG === '1',
    resetDropsBoot: process.env.RB !== '0',
    anyChangeDropsBoot: process.env.ACDB !== '0',
    strong: process.env.STRONG !== '0',
    tagGen: process.env.TAGGEN === '1',
    atomicSave: process.env.ATOMIC !== '0',
    tagNewest: process.env.TAGNEWEST === '1',
    ...opt,
  }
  const W = {
    dev: new Map(),
    hist: [{ doc: null, side: null }], // every device state, in write order
    wins: [],
    wall: O.wall0 ?? 1_700_000_000_000,
    ids: 0,
    regSeq: 0,
    gens: 0,
    times: 0,
    ev: [],
    born: new Map(),
    kills: [],
    regSet: new Map(),
    refused: [],
    reads: [],
    aggBad: [],
    inexact: 0,
    dropped: 0,
    droppedAnswers: 0,
    carried: 0,
    O,
    // (Amnesic) the app session (every NEW window closed ends it), the one preset's Amnesic value, and the
    // switch-on count (a change away from Off starts a new window)
    sid: 1,
    am: { v: 'off', since: 0 },
    forgets: [],
    winStartId: 0,
  }
  // the Amnesic window answers are anchored in: 'switch' (owner's rule) = since the last switch-on from Off or the
  // app's open, whichever is later; 'open' = since the app opened (then every session is anchored, Off included)
  const curE = () =>
    O.amAnchors === false
      ? null
      : O.amRule === 'open'
        ? 's' + W.sid
        : W.am.v !== 'off'
          ? W.sid + ':' + W.am.since
          : null
  const MUT_COUNTS = ['drop', 'dropOne', 'double']
  const MUT_AM = ['amNoForget', 'amAnchorLate']
  const devState = () => ({ doc: W.dev.get('doc') ?? null, side: W.dev.get('side') ?? null })
  const stateOf = (text) => {
    if (text == null) return Object.fromEntries(SL.map((x) => [x, isSilo(x) ? BLANK() : 0]))
    return JSON.parse(text).state
  }
  // (oracle) the answers a silo counts, from its multiset: an answer counted twice appears twice
  const idsOf = (s) =>
    s && s._q ? Object.entries(s._q).flatMap(([k, n]) => Array(Math.max(0, n)).fill(+k)) : []
  function commit(w, k, text, why, extra = {}) {
    if (w.full || (k === 'side' && w.sideFull)) {
      ;(W.refused.push(W.ev.length), (W.refusedBy ??= []).push({ who: w.name, at: W.ev.length }))
      return false
    }
    const before = W.dev.get(k) ?? null
    if (before === text) return true
    // (v4) a window writing while writes it has not handled are still queued for it (only a lagging copy can):
    // their notices reach it after its own write, older than the copy it now holds - so its next read is not
    // contiguous, whatever the next notice's old value says (LAG, one older page: config 21, run 99)
    if (
      w.kind === 'N' &&
      k === 'doc' &&
      w.view &&
      w.pos < W.hist.length - 1 &&
      O.blindRule !== false
    )
      w.book.blind = true
    if (text === null) W.dev.delete(k)
    else W.dev.set(k, text)
    if (k === 'doc') {
      const a = stateOf(before)
      const b = stateOf(text)
      const { full: _full, ...rest } = extra
      const e = {
        i: W.ev.length,
        by: w.name,
        kind: w.kind,
        why,
        removed: [],
        added: [],
        regs: {},
        lastOld: W.lastOld ?? null,
        ...rest,
      }
      e.after = Object.fromEntries(SILOS.map((x) => [x, idsOf(b[x])])) // (oracle) the ids of each mode after this write
      // (oracle) which modes this NEW write wrote as a version (not an older page's bytes passed through)
      if (w.kind === 'N') {
        const sy = extra.full ?? (text ? JSON.parse(text).sync : null) // (the full envelope: oracle bookkeeping)
        e.ver = Object.fromEntries(SILOS.map((x) => [x, !!sy?.at?.[x] && !sy.at[x].unres]))
        // (oracle) the version each mode was written as: a re-assertion keeps its stamp
        e.verSt = Object.fromEntries(
          SILOS.map((x) => [x, sy?.at?.[x] && !sy.at[x].unres ? key(sy.at[x].st) : null]),
        )
        e.parSt = Object.fromEntries(
          SILOS.map((x) => [x, sy?.at?.[x]?.p?.st ? key(sy.at[x].p.st) : null]),
        )
      }
      if (w.kind === 'O') W.lastOld = e.i
      for (const s of SILOS) {
        const ai = idsOf(a[s]),
          bi = idsOf(b[s])
        for (const id of ai) if (!bi.includes(id)) e.removed.push(id)
        for (const id of bi) if (!ai.includes(id)) e.added.push(id)
      }
      for (const r of REGS) if (a[r] !== b[r]) e.regs[r] = { from: a[r], to: b[r] }
      W.ev.push(e)
      for (const s of SILOS)
        for (const id of idsOf(b[s])) {
          const bn = W.born.get(id)
          if (bn) bn.landed = true
        }
      // (oracle) every NEW write: the counts must be what the ledger shows; never a streak or Best above it
      if (w.kind === 'N')
        for (const s of SILOS) {
          const o = b[s]
          const L = ledgerAgg(o._a ?? [])
          if (o.pl !== L.pl || o.gd !== L.gd || th(o.t) !== th(L.t) || o.sk !== L.sk)
            W.aggBad.push({
              i: e.i,
              s,
              kind: 'counts',
              o: { pl: o.pl, gd: o.gd, sk: o.sk, t: o.t.length },
              L: { pl: L.pl, gd: L.gd, sk: L.sk, t: L.t.length },
              delta: countsDelta(o, L),
            })
          else if (o.bs > L.bs) W.aggBad.push({ i: e.i, s, kind: 'inventedBest' })
        }
      // (oracle, V3-F1) EVERY new write, against the DRIVER's log of answers (W.born: id, mode, its time) - not
      // the merge's labels: an answer counted twice, a count the multiset does not explain, a time that is no
      // answer's or appears twice. `pass` = an older page's bytes this write passed through untouched.
      if (w.kind === 'N')
        for (const s of SILOS) {
          const o = b[s]
          const q = o._q ?? {}
          const dbl = [],
            odd = []
          for (const [id, n] of Object.entries(q)) {
            const bn = W.born.get(+id)
            if (n >= 2) dbl.push(+id)
            if (n < 0 || !bn || bn.s !== s) odd.push(+id)
          }
          const named = new Map(Object.keys(q).map((id) => [W.born.get(+id)?.tm ?? null, +id]))
          const seenT = new Set()
          for (const t of o.t) {
            if (seenT.has(t)) dbl.push('t:' + t)
            seenT.add(t)
            if (!named.has(t)) odd.push('t:' + t)
          }
          if (qSize(q) !== o.pl) odd.push('count')
          if (dbl.length || odd.length)
            (W.qBad ??= []).push({
              i: e.i,
              s,
              dbl,
              odd,
              pass: e.ver ? !e.ver[s] : false,
              mut: !!o._mut,
            })
          if (o._mut) W.mutLanded = (W.mutLanded ?? 0) + 1
        }
    }
    W.hist.push({
      ...devState(),
      ev: k === 'doc' ? W.ev.length - 1 : (W.hist[W.hist.length - 1]?.ev ?? -1),
    }) // (oracle) the doc write it shows
    if (w.view) {
      w.view[k] = text
      w.pos = W.hist.length - 1
    }
    return true
  }

  // ═════════════════════════ a NEW window: THE REAL DOOR (store/syncCounts' CountsBook) ═════════════════════════
  // Everything from here to the older pages is the harness that hosts the real door in the model's world:
  // its device io (this window's copy of the device, one write at a time - the model's `view`), the
  // oracle's ledger and log hooks, and the model's own stepping (step / act). No merge rule is written here.
  const flipsSince = (B, done) => {
    const was = new Map((done?._a ?? []).map((q) => [q.id, q]))
    return (B?._a ?? []).filter(
      (q) => was.has(q.id) && (was.get(q.id).r !== q.r || was.get(q.id).tm !== q.tm),
    )
  }
  const X = (o) => o?.x ?? {}
  const ledger = {
    blank: () => ({ _a: [], _q: {} }),
    apply: (x, op) => ({
      ...x,
      _a: [...(x?._a ?? []), { id: op.id, r: op.r, tm: op.tm }],
      _q: qAdd(x?._q, { [op.id]: 1 }),
    }),
    block: (v, sum) => ({ _a: (X(v)._a ?? []).slice(sum.pl), _q: qSub(X(v)._q, X(sum)._q) }),
    part: (B, done) => ({
      _a: (X(B)._a ?? []).slice(done.k),
      _q: qSub(X(B)._q, X(done)._q),
      fullA: flipsSince(X(B), X(done)),
    }),
    fold: (h, part) => {
      const now = new Map((X(part).fullA ?? []).map((q) => [q.id, q]))
      return {
        _a: [
          ...(X(h)._a ?? []).map((q) => (now.has(q.id) ? clone(now.get(q.id)) : q)),
          ...clone(X(part)._a ?? []),
        ],
        _q: qAdd(X(h)._q, X(part)._q),
      }
    },
    rec: (B) => ({ _a: clone(X(B)._a ?? []), _q: { ...(X(B)._q ?? {}) } }),
    summary: (s) => ({
      _ids: (X(s)._a ?? []).map((q) => q.id + (q.r ? 'r' : 'w')),
      _q: { ...(X(s)._q ?? {}) },
    }),
    tag: (s) => ({ _q: { ...(X(s)._q ?? {}) } }),
    segPart: (resolved, held, B, heldRec) => ({
      _a: (X(resolved)._a ?? []).slice((X(held)._a ?? []).length),
      _q: qSub(X(resolved)._q, X(held)._q),
      fullA: flipsSince(X(B), X(heldRec ?? {})),
    }),
    anchor: (s) => ({ _a: clone(X(s)._a ?? []), _q: { ...(X(s)._q ?? {}) } }),
    anchorSum: (v, sum) => ({
      _a: clone((X(v)._a ?? []).slice(0, sum.pl)),
      _q: { ...(X(sum)._q ?? {}) },
    }),
    restore: (a) => ({ _a: clone(X(a)._a ?? []), _q: { ...(X(a)._q ?? {}) } }),
  }
  // the model's doc as the door reads and writes it: silos in the model's own stored form, the tag inside them
  // as the app spells it (with the oracle's ledger beside it), the envelope and the key as the app packs them
  const SHAPE = {
    silos: SILOS,
    regs: REGS,
    regAbsent: 0,
    parse(text) {
      if (text == null) return null
      const o = JSON.parse(text)
      return { state: o.state ?? {}, sync: o.sync ? unpackSync(JSON.stringify(o.sync)) : null }
    },
    silo(disk) {
      if (!disk) return { v: { ...blankSilo(), x: { _a: [], _q: {} } }, tag: null }
      const x = {
        _a: clone(disk._a ?? []),
        _q: { ...(disk._q ?? {}) },
        ...(disk._mut ? { _mut: true } : {}),
      }
      const t = disk.w ? decodeTag(disk.w.s) : null
      const a = anchorOfDisk(disk.a)
      return {
        v: {
          pl: disk.pl,
          gd: disk.gd,
          sk: disk.sk,
          bs: disk.bs,
          t: [...disk.t],
          tl: 0,
          x,
          ...(a ? { a } : {}),
        },
        tag: t ? { ...t, x: { _q: { ...(disk.w._q ?? {}) } } } : null,
      }
    },
    diskSilo(v, tag) {
      return {
        pl: v.pl,
        gd: v.gd,
        sk: v.sk,
        bs: v.bs,
        t: v.t,
        w: { s: encodeTag(tag), _q: X(tag)._q ?? {} },
        _a: X(v)._a ?? [],
        _q: X(v)._q ?? {},
        ...(v.a ? { a: anchorToDisk(v.a) } : {}),
        ...(X(v)._mut ? { _mut: true } : {}),
      }
    },
    write(state, sync, full) {
      // (O.parity: the model's own doc text, which carries the full envelope beside the compact one - so
      // two writes of the same compact text are still two texts; the app's doc does not)
      return JSON.stringify({
        state,
        sync: JSON.parse(packSync(sync)),
        ...(O.parity ? { _sync: JSON.parse(packSync(full)) } : {}),
      })
    },
    readKey(text) {
      return text == null ? null : unpackSync(text)
    },
    writeKey(k) {
      return packSync(k)
    },
  }
  // (oracle) the full envelope each NEW doc text stands for (the doc itself carries the compact one)
  const fullOf = new Map()
  const fullShape = (x, e) =>
    isSilo(x)
      ? {
          st: e.st,
          fp: e.fp,
          p: e.p ?? null,
          old: e.old ?? {},
          ps: e.ps ?? null,
          ...(e.unres ? { unres: e.unres } : {}),
        }
      : { st: e.st, fp: e.fp, ...(e.unres ? { unres: e.unres } : {}) }
  const canonEnv = (env) =>
    JSON.stringify(
      Object.fromEntries(SL.filter((x) => env.at[x]).map((x) => [x, fullShape(x, env.at[x])])),
    )
  function makeBook(w) {
    const io = {
      view() {
        // the notice's old value: the doc just before the one this copy shows (the model's walk back) - or,
        // with O.missedHasNoOld, nothing at all for a window that slept (a real browser hands it none)
        if (w.noOld)
          return { doc: w.view.doc ?? null, side: w.view.side ?? null, prevDoc: undefined }
        let i = w.pos - 1
        while (i >= 0 && (W.hist[i].doc ?? null) === (w.view.doc ?? null)) i--
        return {
          doc: w.view.doc ?? null,
          side: w.view.side ?? null,
          prevDoc: i >= 0 ? (W.hist[i].doc ?? null) : undefined,
        }
      },
      deviceKey: () => W.dev.get('side') ?? null,
      save(docText, keyText, full) {
        if (w.full || (O.atomicSave !== false && w.sideFull)) {
          W.refused.push(W.ev.length)
          ;(W.refusedBy ??= []).push({ who: w.name, at: W.ev.length })
          return false
        }
        const resets = SILOS.filter((x) => w.book.dirty[x]?.reset && !w.book.dirty[x].forget)
        const forgets = SILOS.filter((x) => w.book.dirty[x]?.forget)
        const before = stateOf(W.dev.get('doc') ?? null)
        const n0 = W.ev.length
        // (a doc text a later write repeats exactly - the door does not write it again - can stand for more than
        // one full envelope: each is what that text means beside the key of its own write)
        ;(fullOf.get(docText) ?? fullOf.set(docText, new Set()).get(docText)).add(canonEnv(full))
        commit(w, 'doc', docText, forgets.length ? 'forget' : resets.length ? 'reset' : w.why, {
          heldSet: REGS.filter((r) => w.book.dirty[r]?.set),
          full,
        })
        if (resets.length && W.ev.length > n0) {
          const after = stateOf(docText)
          W.kills.push({
            at: n0,
            by: w.name,
            ids: new Set(
              resets.flatMap((x) =>
                idsOf(before[x]).filter(
                  (id) => !idsOf(after[x]).includes(id) && id <= (w.resetPressId?.[x] ?? Infinity),
                ),
              ),
            ),
          })
        }
        commit(w, 'side', keyText, 'side')
        return true
      },
    }
    // (v4 Amnesic round: an answer came by ANOTHER older lineage when an older write of another lineage carried
    // it - read from the WORLD, not from this window's memory, which a window opened later, a cold opener above
    // all, never had)
    const viaWorld = (x, id) =>
      W.ev.some(
        (q) =>
          q.kind === 'O' && q.page !== W.born.get(id)?.lineage && (q.after[x] ?? []).includes(id),
      )
    const hooks = {
      ledger,
      mut: MUT_COUNTS.includes(O.mut) ? O.mut : null,
      mutAm: MUT_AM.includes(O.mut) ? O.mut : null,
      onWeigh(book, x, B, done) {
        const linOf = (q) => [
          ...new Set(
            Object.keys(q ?? {})
              .map((id) => W.born.get(+id)?.lineage)
              .filter(Boolean),
          ),
        ]
        ;(W.weighed ??= []).push({
          at: W.ev.length,
          by: w.name,
          s: x,
          lin: [...new Set([...linOf(X(B)._q), ...linOf(X(done)._q)])],
        })
      },
      onFoldBad(book, x, B, done, part, held) {
        const bad = Object.entries(X(part)._q ?? {})
          .filter(([id, n]) => n < 0 || (X(held)._q?.[id] ?? 0) > 0)
          .map(([id]) => +id)
        if (!bad.length) return
        const lin = new Set(
          [...Object.keys(X(B)._q ?? {}), ...Object.keys(X(done)._q ?? {})]
            .map((id) => W.born.get(+id)?.lineage)
            .filter(Boolean),
        )
        const via = (id) => (w.viaOther?.[x] ?? new Set()).has(id) || viaWorld(x, id)
        ;(W.foldLog ??= []).push({
          at: W.ev.length,
          by: w.name,
          s: x,
          ids: bad,
          r6: (lin.size >= 2 || bad.every(via)) && bad.every((id) => W.born.get(id)?.kind === 'O'),
        })
      },
      // (oracle) a replayed fold segment whose part the multiset shows wrong is logged like a fold's (R6 when two
      // older lineages are in play or the ids came through another lineage - Amnesic round, config 27, run 1930)
      onSegFold(book, x, part, held) {
        const bad = Object.entries(X(part)._q ?? {})
          .filter(([id, n]) => n < 0 || (X(held)._q?.[id] ?? 0) > 0)
          .map(([id]) => +id)
        if (!bad.length) return
        const lin = new Set(
          [...Object.keys(X(part)._q ?? {}), ...Object.keys(X(held)._q ?? {})]
            .map((id) => W.born.get(+id)?.lineage)
            .filter(Boolean),
        )
        ;(W.foldLog ??= []).push({
          at: W.ev.length,
          by: w.name,
          s: x,
          ids: bad,
          r6:
            (lin.size >= 2 || bad.every((id) => viaWorld(x, id))) &&
            bad.every((id) => W.born.get(id)?.kind === 'O'),
        })
      },
      onMutFired() {
        W.mutFired = (W.mutFired ?? 0) + 1
      },
      onRead(book, dev) {
        W.reads.push(W.ev.length)
        ;(W.readsBy ??= []).push({
          who: w.name,
          at: W.ev.length,
          pos: w.pos,
          contig: [...(book.contig ?? [])],
        })
        // (oracle) the older answers this read's copy carries that are ANOTHER older lineage's
        const wr = W.ev[W.hist[w.pos]?.ev]
        if (wr && wr.kind === 'O')
          for (const x of SILOS)
            for (const id of Object.keys(X(dev.out[x].v)._q ?? {})) {
              const bn = W.born.get(+id)
              if (bn?.kind === 'O' && bn.lineage !== wr.page)
                ((w.viaOther ??= {})[x] ??= new Set()).add(+id)
            }
      },
      onHeld(book, x, held) {
        ;(W.heldAtRead ??= []).push({
          at: W.ev.length,
          by: w.name,
          s: x,
          q: { ...(X(held)._q ?? {}) },
        })
      },
      onDecode(docText, decoded) {
        const want = fullOf.get(docText)
        if (want && !want.has(canonEnv(decoded))) {
          W.envMismatch = (W.envMismatch ?? 0) + 1
          if (process.env.DENV)
            console.log('ENV want', [...want].join(' | '), '\n    got ', canonEnv(decoded))
        }
      },
      counter(name, n = 1) {
        W[name] = (W[name] ?? 0) + n
      },
    }
    return new CountsBook({ shape: SHAPE, io, tag: w.name, name: w.name, hooks, win: curE })
  }
  // Each notice is handled against the window's copy, which advances ONE write at a time (the model's step).
  function step(w, toEnd) {
    w.why = 'writeback'
    if (toEnd && (w.missed || O.jump)) {
      w.missed = false
      w.pos = W.hist.length - 1
      w.view = { ...W.hist[w.pos] }
      if (O.missedHasNoOld) w.noOld = true
      w.book.handle()
      w.noOld = false
      return
    }
    if (toEnd) {
      let kept = false
      while (w.pos < W.hist.length - 1) {
        w.pos++
        w.view = { ...W.hist[w.pos] }
        kept = w.book.handle(false) || kept
      }
      w.book.handle(true, kept)
      return
    }
    if (w.pos < W.hist.length - 1) {
      w.pos++
      w.view = { ...W.hist[w.pos] }
    }
    w.book.handle()
  }
  function act(w, x, change, why) {
    if (!O.lag) step(w, true) // a player acts on a copy that has caught up
    change()
    w.why = why
    w.book.owes = !w.book.land()
  }
  function newWin(name) {
    const w = { name, kind: 'N', tag: name, frozen: false, closed: false, full: false }
    w.pos = W.hist.length - 1
    w.view = { ...W.hist[w.pos] }
    Object.defineProperty(w, 'mem', { get: () => w.book.mem })
    Object.defineProperty(w, 'owes', { get: () => w.book.owes })
    w.book = makeBook(w)
    w.book.open()
    W.wins.push(w)
    return w
  }

  // ═════════════════════════ an OLDER page ═════════════════════════
  // Per silo: `base` (the loaded counts, tag, ledger) and `hist` (its own cards since, current verdicts).
  function oldSilo(w, s) {
    const b = w.sbase[s]
    const H = w.shist[s]
    let pl = b.pl,
      gd = b.gd
    const t = [...b.t]
    // the credit sequence: the loaded streak as leading credits, then the cards (the engine's withStreaks)
    const seq = [...Array(b.sk).fill(true), ...H.map((c) => c.r)]
    let run = 0,
      best = 0
    for (const c of seq) {
      if (c) {
        run++
        if (run > best) best = run
      } else run = 0
    }
    for (const c of H) {
      pl++
      if (c.r) {
        gd++
        if (c.tm !== null) t.push(c.tm)
      }
    }
    const o = {
      pl,
      gd,
      sk: run,
      bs: Math.max(b.bs, best),
      t,
      _a: [...clone(b._a ?? []), ...H.map((c) => ({ id: c.id, r: c.r, tm: c.tm }))],
      _q: qAdd(b._q, Object.fromEntries(H.map((c) => [c.id, 1]))),
    }
    if (b.w) o.w = b.w
    if (b.a) o.a = b.a
    return o
  }
  function oldState(w) {
    const st = {}
    for (const s of SILOS) st[s] = oldSilo(w, s)
    for (const r of REGS) if (!(r === 'R3' && w.dropsUnknown)) st[r] = w.reg[r]
    return st
  }
  // (oracle bookkeeping) the base each silo's BYTES claim, and whether they read like the bootstrap record
  function oracleView(w) {
    const S = W.dev.get('side') ? unpackSync(W.dev.get('side')) : null
    const doc = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : null
    const tagG =
      O.tagGen && doc ? (SILOS.map((x) => doc.state[x]?.w?.g).find((g) => g) ?? null) : null
    const g = doc?.sync?.g ?? S?.g ?? tagG
    const basis = {},
      bootLike = []
    for (const x of SILOS) {
      const m = oldSilo(w, x)
      const t = m.w ? decodeTag(m.w.s) : null
      const b0 = S && S.g === g ? S.boot?.[x] : null
      const b = b0 ? { ...b0, _ids: b0.x?._ids ?? [] } : null
      const c = null
      if (t && g && t.g === g && t.st.t === BOOT.t && (isVersion(m, t) || extendsSum(m, t))) {
        // (a BOOT-stamped tag stands on the bootstrap record: judged as one)
        basis[x] = 'boot'
        const pref = m._a
          .slice(0, t.pl)
          .map((q) => q.id + (q.r ? 'r' : 'w'))
          .join()
        if ((b && pref !== (b._ids ?? []).join()) || w.resetSince?.[x]) bootLike.push(x)
      } else if (t && g && t.g === g && (isVersion(m, t) || extendsSum(m, t)))
        basis[x] = 'tag:' + key(t.st) + ':' + t.pl
      else if (
        (!t || t.g !== g) &&
        c &&
        c.pl > 0 &&
        (!O.strong || c.n > 0) &&
        (isVersion(m, c) || extendsSum(m, c))
      ) {
        basis[x] = c.id
        if (
          m._a
            .slice(0, c.pl)
            .map((q) => q.id)
            .join() !== (c._ids ?? []).join() ||
          w.resetSince?.[x]
        )
          bootLike.push(x)
      } else if (
        (!t || t.g !== g) &&
        b &&
        b.pl > 0 &&
        (isVersion(m, b) || ((!O.strong || b.n > 0) && extendsSum(m, b)))
      ) {
        basis[x] = 'boot'
        // the page's copy really extends that record only if its first answers ARE the record's answers
        const pref = m._a
          .slice(0, b.pl)
          .map((q) => q.id + (q.r ? 'r' : 'w'))
          .join()
        if (pref !== (b._ids ?? []).join() || w.resetSince?.[x]) bootLike.push(x)
      } else basis[x] = null
    }
    return { basis, bootLike, foldable: SILOS.filter((x) => basis[x] && !w.resetSince?.[x]) }
  }
  const oldWrite = (w, why, extra = {}) =>
    commit(w, 'doc', JSON.stringify({ state: oldState(w) }), why, {
      page: w.name + '#' + w.lineage,
      genuine: extra.genuine ?? [],
      ...oracleView(w),
      ...extra,
    })
  function loadOld(w) {
    w.lineage = (w.lineage ?? -1) + 1
    const st = stateOf(W.dev.get('doc') ?? null)
    w.sbase = {}
    w.shist = {}
    w.reg = {}
    for (const s of SILOS) {
      const d = st[s] ?? BLANK()
      // (a NEW window's pass-through slice is the bytes of an older page's object - loaded as they are)
      w.sbase[s] = {
        pl: d.pl,
        gd: d.gd,
        sk: d.sk,
        bs: d.bs,
        t: [...d.t],
        _a: clone(d._a ?? []),
        _q: { ...(d._q ?? {}) },
        ...(d.w ? { w: clone(d.w) } : {}),
        ...(d.a ? { a: clone(d.a) } : {}),
      }
      w.shist[s] = []
    }
    for (const r of REGS) w.reg[r] = st[r] ?? 0
    w.resetSince = {}
  }
  function oldWin(name) {
    // (V3-F6.1, read in v2.27.3-v2.29.0: settings persist through `partialize` over PERSISTED_KEYS, so EVERY
    // older build drops Q21's field on every settings save)
    const w = { name, kind: 'O', closed: false, dropsUnknown: true }
    loadOld(w)
    W.wins.push(w)
    oldWrite(w, 'old-boot') // every older build rewrites the progress doc at boot (F-D)
    return w
  }
  const newTime = () => ++W.times / 10
  // (oracle) an Amnesic window starts: the newest answer id before it, and what the device held then
  function startWindow() {
    W.winStartId = W.ids
    const st = stateOf(W.dev.get('doc') ?? null)
    ;(W.winStarts ??= []).push({
      id: W.ids,
      at: W.ev.length,
      onDev: Object.fromEntries(SILOS.map((x) => [x, idsOf(st[x])])),
    })
  }
  const api = {
    W,
    newWin,
    oldWin,
    // -- AMNESIC (design-amnesic-close.md) --
    // the preset's value, changed in a NEW window (every window follows a setting; its sync is gated apart)
    setAmnesic(v) {
      if (O.amRule !== 'open' && W.am.v === 'off' && v !== 'off') {
        W.am.since++
        startWindow()
      }
      W.am.v = v
    },
    // the app CLOSES: every new window closed (an older page, if open, is not seen: it holds no lock)
    closeAll() {
      for (const y of W.wins) if (y.kind === 'N') y.closed = true
      W.closing = {
        v: W.am.v,
        E: curE(),
        startId: W.winStartId,
        endId: W.ids,
        sid: W.sid,
        at: W.ev.length,
        sessAt: W.sessAt ?? 0,
      }
    },
    // the next COLD OPEN with no other window alive: a new session; the closed one's forget runs first - the
    // real door's (CountsBook.forgetWindow), in the opener's book, landed as a write like any other
    coldOpen(name) {
      if (W.wins.some((y) => y.kind === 'N' && !y.closed))
        throw new Error('coldOpen with a live window')
      const c = W.closing
      W.closing = null
      // THE FORGET RUNS FIRST, still in the closed session: what the opener finds on the device (an older page's
      // cards no window folded before the close included) belongs to it; only then does the new session begin
      const w = newWin(name)
      const begin = () => {
        W.sid++
        W.sessAt = W.ev.length
        if (W.am.v !== 'off' || O.amRule === 'open') startWindow()
      }
      if (!c || c.v === 'off' || !c.E) {
        begin()
        return w
      }
      // (oracle) WHAT MUST GO, from the driver's own record: every answer given inside the window, by any page
      const F = new Set(
        [...W.born].filter(([id]) => id > c.startId && id <= c.endId).map(([id]) => id),
      )
      step(w, true)
      const n0 = W.ev.length
      const { restored, skipped } = w.book.forgetWindow(c.E)
      const any = restored.length > 0
      w.why = 'forget'
      if (any && !w.book.land()) throw new Error('forget refused (the world opens it with room)')
      // (oracle) the kill takes effect at the forget's write - or, when it had nothing to write, between the write
      // before it and the next one
      W.kills.push({ at: any ? n0 : n0 - 0.5, by: name, ids: F, forget: true })
      W.forgets.push({
        at: any ? W.ev.length - 1 : null,
        from: n0,
        F,
        E: c.E,
        skipped,
        startId: c.startId,
        endId: c.endId,
        closeAt: c.at,
        sessAt: c.sessAt,
        restored,
        startAt: (W.winStarts ?? []).filter((st) => st.id === c.startId).pop()?.at ?? 0,
      })
      begin()
      return w
    },
    deliver(w) {
      if (w.kind === 'O' || w.closed || w.frozen) return
      step(w, !O.lag)
    },
    deliverAll() {
      for (let i = 0; i < 4; i++) for (const w of W.wins) api.deliver(w)
    },
    // r < 0.4 timed right, < 0.7 untimed right, else wrong
    answer(w, s, r = 0.1) {
      const id = ++W.ids
      const a = { id, r: r < 0.7, tm: r < 0.4 ? newTime() : null }
      // a wrong answer to a timed question keeps its time on the card (a toggle to right puts it in the pool)
      const tmOld = w.kind === 'O' ? (a.r ? a.tm : r < 0.85 ? newTime() : null) : a.tm
      W.born.set(id, {
        by: w.name,
        kind: w.kind,
        s,
        tm: tmOld,
        landed: false,
        lineage: w.kind === 'O' ? w.name + '#' + w.lineage : null,
        basis: w.kind === 'O' ? oracleView(w).basis[s] : null,
        at: W.ev.length,
      })
      if (w.kind === 'O') {
        w.shist[s].push({ id, r: a.r, tm: tmOld })
        oldWrite(w, 'old-answer', { genuine: [s] })
      } else {
        const E = curE()
        act(
          w,
          s,
          () => w.book.answer(s, { kind: 'a', id, r: a.r, tm: a.tm, ...(E ? { e: E } : {}) }),
          'answer',
        )
      }
      return id
    },
    reset(w, s) {
      if (w.kind === 'O') {
        const killed = new Set(oldSilo(w, s)._a.map((q) => q.id))
        // (oracle, v5) the copy this Reset writes reads like a page from before the first new save - no tag of
        // any mode, the reset mode blank - in a mode blank at the update: nothing can tell it from that page's
        // stale copy (R4b)
        const key0 = W.dev.get('side') ? unpackSync(W.dev.get('side')) : null
        const gOf = (d) => (d?.w ? decodeTag(d.w.s)?.g : null)
        const viewBlank =
          !!key0 &&
          !SILOS.some((y) => y !== s && gOf(w.sbase[y]) === key0.g) &&
          key0.boot?.[s]?.pl === 0 &&
          !Object.values(key0.old?.[s] ?? {}).some((q) => (q?.k ?? 0) > 0)
        for (const id of idsOf(stateOf(W.dev.get('doc') ?? null)[s])) killed.add(id)
        w.sbase[s] = BLANK() // a literal: the tag goes
        ;(w.resetSince ??= {})[s] = true
        w.shist[s] = []
        const n0 = W.ev.length
        oldWrite(w, 'old-reset', { genuine: [s] })
        W.kills.push({ at: n0, by: w.name, ids: killed, blankView: viewBlank, s })
      } else
        act(
          w,
          s,
          () => {
            // (the newest version this window knows of the mode at the press: only play after it cancels the Reset)
            if (!w.book.dirty[s]?.reset) (w.resetPressId ??= {})[s] = W.ids
            w.book.reset(s)
            // (the fold records are marked when the Reset is WRITTEN: until then the version folds go into is
            // the one before it, which still holds every card they count - and play by another window since
            // cancels the Reset)
          },
          'reset',
        )
    },
    // An Override of one of the older page's OWN cards, `back` cards from its newest (0 = the newest).
    override(w, s, back = 0) {
      if (w.kind !== 'O') return false
      const H = w.shist[s]
      if (back >= H.length) return false
      const c = H[H.length - 1 - back]
      c.r = !c.r
      // the card keeps its own time; it is in the pool only while the card is a credit
      oldWrite(w, 'old-override', { genuine: [s], ov: { s, id: c.id } })
      W.overrides = (W.overrides ?? 0) + 1
      return true
    },
    setReg(w, r) {
      const cur = w.kind === 'O' ? w.reg[r] : w.mem[r].v
      if (r === 'R3' && w.kind === 'O') return null // no older build knows the field
      const val = r === 'R2' ? (cur ? 0 : 1) : (r === 'R3' ? 2000 : 1000) + ++W.regSeq
      if (w.kind === 'O') {
        w.reg[r] = val
        oldWrite(w, 'old-set', { genuine: [r] })
      } else act(w, r, () => w.book.setReg(r, val), 'set')
      return val
    },
    reloadOld(w) {
      loadOld(w)
      oldWrite(w, 'old-boot')
    },
    // An older page's Full Reset under Amnesic: a write that keeps the envelope (writeKept), then the removal
    oldRemoveDoc(w) {
      if (!W.dev.has('doc')) return
      const st = stateOf(W.dev.get('doc'))
      const killed = new Set(SILOS.flatMap((x) => idsOf(st[x])))
      const d = JSON.parse(W.dev.get('doc'))
      commit(w, 'doc', JSON.stringify(d), 'old-kept-middle', {
        page: w.name + '#' + w.lineage,
        genuine: [],
      })
      for (const s of SILOS) {
        w.sbase[s] = BLANK()
        w.shist[s] = []
      }
      for (const r of REGS) w.reg[r] = 0
      const n0 = W.ev.length
      commit(w, 'doc', null, 'old-remove', { page: w.name + '#' + w.lineage, genuine: SL })
      W.kills.push({ at: n0, by: w.name, ids: killed })
    },
    clearAll() {
      const st = stateOf(W.dev.get('doc') ?? null)
      const n0 = W.ev.length
      commit({ name: 'clear', kind: 'X' }, 'doc', null, 'clear')
      W.dev.delete('side')
      W.hist.push(devState())
      W.kills.push({ at: n0, by: 'clear', ids: new Set(SILOS.flatMap((x) => idsOf(st[x]))) })
    },
    freeze(w) {
      w.frozen = true
      w.missed = true
    },
    resume(w) {
      w.frozen = false
      api.deliver(w)
    },
    close(w) {
      w.closed = true
    },
    setFull(w, on) {
      w.full = on
    },
    setSideFull(w, on) {
      w.sideFull = on
    },
    jumpClock(d) {
      W.wall += d
    },
    final: () => stateOf(W.dev.get('doc') ?? null),
    idsOf,
  }
  return api
}
