// tests/helpers/syncModel/world5.js — design-q2-model/model5.mjs's WORLD (one Best record, two fields, against
// older pages that behave as v2.26-v2.29 do), hosting THE REAL RECORDS BOOK (design-q1-q2.md v4, 4.1 and 14.2).
// Copied from the model with its older pages, its device, its driver log and its oracle bookkeeping VERBATIM;
// its new-window merge is REPLACED by store/syncRecords' RecordsBook (the section marked THE REAL BOOK below).
// The doc's envelope and the records' key are the book's spelling; the oracle reads them through that.
//
// TWO THINGS THE MODEL DID NOT HAVE, both off by default so the model's own configurations run unchanged:
//   • `spreadOld`: an older page that builds a CHANGED record as a spread of the one it holds, keeping the tag
//     - and that, on a take-back, leaves a field with the round that beat it, at the value it held before
//     (v2.26.0 does both: tests/fixtures/olderBuilds/sync-v2.26.0.json, `roundBeats`, `takeBack`,
//     `takeBackBelow`; part2-issues #1);
//   • `selfTag`: the record's tag names the values it was written with (store/syncRecords' recordTag) - the
//     app's form, which is what reads a spreading page's changed record as the change it is;
//   • `counterIds`: an older page that numbers its rounds with a COUNTER from 1 per load (v2.26.0 does:
//     part2-issues #5). Its ids are scoped to the load they came from as the app's reader scopes them
//     (store/syncRecords' scopedRoundId), and the oracle knows each such round by its scoped id. Two loads
//     with no new write between them alias (a named residual: `counterIdReuse`).
// Every OTHER round id is a clock's: the model's numbers, offset into the app's clock range (2^40 and up),
// so a counter can be told from them as the app tells it.
//
// The model's own header:
//
// What a record is on disk: { f: { s: { v, id }, k: { v, id } }, w?: TAG, x?: ALTS }.
//   - `v` the value, `id` the round that holds it (unique round ids; ties stay with the earlier holder).
//   - `w` (new builds) the version stamp of the record; older builds keep it on an UNCHANGED object
//     (fileBest keeps the object) and drop it on any literal (a changed record, betterBlitzBest, writeKept).
// The doc also holds a stats silo `st` with its own tag (old pages carry it; it tells which version an older
// page loaded - V2-F4's "unless the old page's own silo tags prove it loaded before those records existed").
//
// Older pages: memory = the doc they loaded. A round: `pre` = the record at Begin; at the end the record is
// rebuilt from `pre` (better wins per field, strict). An Override on the results screen changes that round's
// value: rebuilt from `pre` again (so a take-back hands the field back to `pre`'s holder). A save rewrites
// the doc from memory (envelope dropped). Some saves go through writeKept (envelope KEPT; every record the
// page changed is BETTER(theirs, mine) as a fresh literal). Full Reset under Stats Only: writeKept with the
// Best map emptied, then the doc removed - two writes. Reload.
import {
  RecordsBook,
  fpRec as bookFp,
  recordTag,
  scopedRoundId,
  loadKeyOf,
  COUNTER_ROUND_ID,
} from '../../../src/store/syncRecords.js'

export const FIELDS = ['s', 'k']
export const SPEC = {
  fields: FIELDS,
  empty: 0,
  better: (a, b) => b > a,
  present: (v) => v > 0,
  same: (a, b) => a === b,
}
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const fpRec = (r) => bookFp(SPEC, r)
// per field: a strict improvement takes the field; a tie stays with the earlier holder
const better = (a, b) => (b.v > a.v ? b : a)
const EMPTY = () => ({ v: 0, id: null })
// the record's own values, as the self-verifying tag hashes them
const valuesOf = (rec) => ({ f: rec.f })
const R = 'r' // the one record

export function makeWorld(opt = {}) {
  const O = { spreadOld: false, selfTag: false, counterIds: false, ...opt }
  const W = {
    dev: new Map(),
    hist: [{ doc: null, side: null }],
    wins: [],
    wall: 1_000,
    rounds: new Map(),
    ev: [],
    refused: [],
    readsBy: [],
    nid: 0,
    seq: 0,
  }
  const tick = () => ++W.wall
  const devState = () => ({ doc: W.dev.get('doc') ?? null, side: W.dev.get('side') ?? null })
  // (oracle) a round's value changes (its arrival on the device is noted when the device shows it - reachOf)
  const setVal = (Rr, v) => {
    Rr.v = { ...v }
  }
  function reachOf(rec, whole = false, by = null) {
    // (a new window's version names every round that still stands, runner-ups included: one it no longer
    // names has left, and arrives again if it comes back)
    if (whole)
      for (const Rr of W.rounds.values())
        for (const f of FIELDS)
          if (
            Rr.reach?.[f] &&
            !(rec && [rec.f[f], ...(rec.x?.[f] ?? [])].some((q) => q.id === Rr.id))
          )
            delete Rr.reach[f]
    if (!rec) return
    for (const f of FIELDS)
      for (const q of [rec.f[f], ...(rec.x?.[f] ?? [])]) {
        const Rr = q.id !== null ? W.rounds.get(q.id) : null
        // (an older page's copy shows its OWN rounds as they now are; another window's round it shows only as it
        // loaded it - a stale value, which reaches nothing)
        if (by && by.kind === 'O' && Rr && Rr.page !== by.name) continue
        if (Rr && Rr.reach?.[f]?.v !== q.v) (Rr.reach ??= {})[f] = { v: q.v, at: W.ev.length - 1 }
      }
  }
  function commit(w, k, text, why, extra = {}) {
    if (w.full) {
      W.refused.push({ who: w.name, at: W.ev.length })
      return false
    }
    if ((W.dev.get(k) ?? null) === text) return true
    if (text === null) W.dev.delete(k)
    else W.dev.set(k, text)
    if (k === 'doc') {
      const d = text ? JSON.parse(text) : null
      W.ev.push({
        i: W.ev.length,
        by: w.name,
        kind: w.kind,
        why,
        rec: d?.b ? clone(d.b) : null,
        docGone: !d,
        ...extra,
      })
      reachOf(scopeRec(d?.b, d), false, w)
    }
    if (k === 'side' && text) reachOf(JSON.parse(text).at?.[R]?.rec ?? null, true, w)
    W.hist.push(devState())
    if (w.view) {
      w.view = devState()
      w.pos = W.hist.length - 1
    } // a window does not get notices of its own writes
    return true
  }
  // ── rounds (oracle bookkeeping): every round's latest value per field, and whether a Reset killed it ──
  // (v4, V3-F3) ROUND IDS. An older build draws one from the wall clock and never goes backwards within a page
  // load. A NEW build draws it from the HYBRID clock: max(wall clock, the highest round id it has seen + 1).
  // `seq` is the DRIVER's real order of rounds, for the oracle only (no decision reads it).
  const SCALE = 64
  const BASE = COUNTER_ROUND_ID
  const newRound = (w) => {
    const seq = ++W.seq
    W.wall++
    // (a counter page: its next counter, known to the oracle by the id the app's reader scopes it to)
    if (w.counter) {
      w.ctr += 1
      const id = scopedRoundId(pageLoad(w), w.ctr)
      if (W.rounds.has(id)) (W.aliases ??= new Set()).add(id)
      W.rounds.set(id, {
        id,
        seq,
        page: w.name,
        kind: w.kind,
        at: W.ev.length,
        v: { s: 0, k: 0 },
        dead: false,
        seen: false,
        disk: w.ctr,
      })
      return id
    }
    let id = Math.max(
      BASE + W.wall * SCALE + (seq % SCALE),
      w.kind === 'N' ? w.clock.hi + 1 : (w.lastId ?? 0) + 1,
    )
    while (W.rounds.has(id)) id++ // (the app's ten random bits; ids never collide)
    if (w.kind === 'N') w.clock.hi = id
    else w.lastId = id
    W.nid = Math.max(W.nid, id)
    W.rounds.set(id, {
      id,
      seq,
      page: w.name,
      kind: w.kind,
      at: W.ev.length,
      v: { s: 0, k: 0 },
      dead: false,
      seen: false,
    })
    return id
  }
  // the id an older page writes for its round: a counter page's counter, every other page's id itself
  const diskId = (w, id) => (w.counter ? W.rounds.get(id).disk : id)
  // which load a page's doc came from, as the app reads it off the doc's stats
  const pageLoad = (w) => loadKeyOf(w.stTag?.st ?? null, !w.stTag && w.stLn === 'boot')
  const docLoad = (doc) =>
    loadKeyOf(doc?.st?.w?.st ?? null, !!doc && !doc.st?.w && doc.st?.ln === 'boot')
  // a record as the app's reader holds it: every counter (an id below the clock range) scoped to the doc's load
  function scopeRec(rec, doc) {
    if (!rec) return rec
    const out = clone(rec)
    for (const f of FIELDS)
      if (out.f[f].id !== null && out.f[f].id < BASE)
        out.f[f].id = scopedRoundId(docLoad(doc), out.f[f].id)
    return out
  }

  // ═════════ NEW windows: THE REAL BOOK ═════════
  // The doc: { b: record | null, st: { w: { st } } | { ln }, sync?: { st, fp } }; the records' key: the book's.
  // A record a new window wrote carries `w`: 1 (the model's bare mark), or - `selfTag` - the hash of its values.
  const tagOf = (rec) => (O.selfTag ? recordTag(valuesOf(rec)) : 1)
  const tagged = (rec) => !!rec?.w && (!O.selfTag || rec.w === recordTag(valuesOf(rec)))
  function devOf(view) {
    const doc = view.doc ? JSON.parse(view.doc) : null
    const side = view.side ? JSON.parse(view.side) : null
    const raw = doc?.b ?? null
    // (the tag is checked on the record as written; its ids are then read as the app's reader reads them)
    const b = scopeRec(raw, doc)
    return {
      docPresent: !!doc,
      env: !!doc?.sync,
      stTag: doc?.st?.w?.st ?? null,
      stBoot: !!doc && !doc.st?.w && doc.st?.ln === 'boot',
      stFresh: !!doc && !doc.st?.w && doc.st?.ln === 'fresh',
      S: side,
      recs: {
        [R]: {
          rec: b ? { f: b.f, ...(b.ops ? { ops: b.ops } : {}) } : null,
          tagged: tagged(raw),
          env: doc?.sync ? { st: doc.sync.st, fp: doc.sync.fp } : null,
        },
      },
    }
  }
  const asOp = (id, v, ov) => ({
    id,
    v: { s: { v: v.s }, k: { v: v.k } },
    ...(ov ? { ov: true } : {}),
  })
  const valOf = (op) => ({ s: op.v.s.v, k: op.v.k.v })
  function land(w, why) {
    if (w.full) {
      W.refused.push({ who: w.name, at: W.ev.length })
      return false
    }
    const out = w.book.prepare()
    if (!out) return true
    const cur = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : {}
    const o = out.doc[R]
    if (!out.st) {
      // a pass-through with my rounds on top: an untagged literal naming them as a new window's, no envelope,
      // the records' key untouched (this is not a version)
      const lit = o.rec ? { f: clone(o.rec.f), nr: o.nr, ops: clone(o.ops) } : null
      if (!commit(w, 'doc', JSON.stringify({ b: lit, st: cur.st ?? {} }), why)) {
        w.book.refused()
        return false
      }
      w.book.landed(out)
      w.seen = devState()
      return true
    }
    const rec = o.rec ? { f: clone(o.rec.f) } : null
    if (rec) rec.w = tagOf(rec)
    const env = out.env[R]
    const doc = { b: rec, st: { w: { st: out.st } }, sync: { st: env.st, fp: env.fp } }
    if (
      !commit(
        w,
        'doc',
        JSON.stringify(doc),
        out.key && w.book.resetPending !== false ? 'reset' : why,
        { st: out.st },
      )
    ) {
      w.book.refused()
      return false
    }
    commit(w, 'side', JSON.stringify(out.key), 'side')
    w.book.landed(out)
    w.seen = devState()
    return true
  }
  function syncView(w, mayLand = true, keptBefore = false) {
    const same = w.view.doc === w.seen.doc && w.view.side === w.seen.side
    const pending = w.book.owes() || w.owes || keptBefore
    if (same && !pending) return false
    const kept = same ? false : w.book.merge()
    w.seen = { doc: w.view.doc, side: w.view.side }
    if (!mayLand) return kept
    if (kept || pending) w.owes = !land(w, 'writeback')
    return false
  }
  function step(w) {
    if (w.missed) {
      w.missed = false
      w.pos = W.hist.length - 1
      w.view = { ...W.hist[w.pos] }
      syncView(w)
      return
    }
    let kept = false
    while (w.pos < W.hist.length - 1) {
      w.pos++
      w.view = { ...W.hist[w.pos] }
      kept = syncView(w, false) || kept
    }
    syncView(w, true, kept)
  }
  function newWin(name) {
    const w = { name, kind: 'N', owes: false }
    w.clock = { hi: 0, peek: () => Math.max(BASE + (W.wall + 1) * SCALE, w.clock.hi + 1) }
    w.book = new RecordsBook({
      spec: SPEC,
      tag: name,
      clock: w.clock,
      io: {
        view: () => devOf(w.view),
        deviceKey: () => (W.dev.get('side') ? JSON.parse(W.dev.get('side')) : null),
      },
      hooks: {
        onMint: () => tick(),
        onLanded: (_b, ops, resets) => {
          // (oracle) a Reset that LANDS kills every round begun before it was PRESSED, in the driver's real order
          if (resets) {
            for (const Rr of W.rounds.values()) if (Rr.seq < w.resetPressSeq) Rr.dead = true
            ;(W.resetLog ??= []).push({ seq: w.resetPressSeq, bound: resets })
          }
          for (const op of ops) {
            const Rr = W.rounds.get(op.id)
            Rr.saved = valOf(op)
            Rr.savedSeq ??= ++W.seq
          }
        },
        onPassThrough: (_b, ops) => {
          for (const op of ops) {
            const Rr = W.rounds.get(op.id)
            Rr.saved = valOf(op)
            Rr.savedSeq ??= ++W.seq
          }
        },
        onGone: (_b, below) => {
          ;(W.resetLog ??= []).push({ seq: W.frSeq ?? W.seq, bound: below, fr: true })
        },
        counter: (n) => {
          if (n === 'resetKept') W.resetKept = (W.resetKept ?? 0) + 1
          else W.xPruned = (W.xPruned ?? 0) + 1
        },
        ...(O.without ? { without: O.without } : {}),
      },
    })
    w.pos = W.hist.length - 1
    w.view = { ...W.hist[w.pos] }
    w.seen = { doc: null, side: null }
    w.mem = () => w.book.recs[R]?.mem ?? null
    w.book.rec(R) // (the model's window has its one record from the start)
    W.wins.push(w)
    step(w)
    return w
  }

  // ═════════ OLDER pages ═════════
  function loadOld(w) {
    const doc = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : null
    w.rec = doc?.b ? clone(doc.b) : null
    w.stTag = doc?.st?.w ?? null
    w.stLn = doc ? (doc.st?.ln ?? null) : 'boot' // nothing saved yet: the bytes of before the update
    // (oracle) a page that loads a REBUILT doc (no tag) carries that rebuild's origin
    w.freshAt = !w.stTag && w.stLn === 'fresh' ? (doc?._freshAt ?? W.ev.length) : null
    w.changed = false
    w.round = null
    w.ctr = 0 // (a counter page numbers from 1 again in every load)
  }
  const oldDoc = (w, rec) =>
    JSON.stringify({ b: rec, st: w.stTag ? { w: w.stTag } : { ln: w.stLn ?? 'fresh' } })
  // an older build's record after a round (or an Override of it): rebuilt from `pre`, a literal when changed -
  // or (`spreadOld`, v2.26.0) a SPREAD of the record it holds, the tag riding along: a field the round beat is
  // the round's; one it held and no longer beats stays with it at the value `pre` had (v2.26.0's take-back)
  function rebuild(pre, id, v, w) {
    const p = pre ?? { f: { s: EMPTY(), k: EMPTY() } }
    if (!w.spread) {
      const lit = { f: { s: better(p.f.s, { v: v.s, id }), k: better(p.f.k, { v: v.k, id }) } }
      if (FIELDS.every((f) => lit.f[f].id === null || lit.f[f].v === 0)) return null
      return lit
    }
    const cur = w.rec ?? p
    const f = {}
    for (const fl of FIELDS)
      f[fl] =
        v[fl] > p.f[fl].v
          ? { v: v[fl], id }
          : cur.f[fl].id === id
            ? { v: Math.max(p.f[fl].v, v[fl]), id }
            : p.f[fl]
    if (FIELDS.every((fl) => f[fl].id === null || f[fl].v === 0)) return null
    return w.rec ? { ...clone(w.rec), f } : { f }
  }
  const sameLit = (a, b) => fpRec(a) === fpRec(b)
  // (oracle) a round's value per field, as far as any record can know it: what its page's record says it is.
  // A spreading page (v2.26.0) keeps a field it beat with its round at the value `pre` had after a take-back
  // - that is the value its round then holds there, the value its own screen shows as the round's Best.
  const claimed = (w, lit, id, v) =>
    w.spread && lit
      ? Object.fromEntries(FIELDS.map((f) => [f, lit.f[f].id === id ? lit.f[f].v : v[f]]))
      : v

  const api = {
    W,
    newWin,
    oldWin(name) {
      const first = !W.wins.some((y) => y.kind === 'O')
      const w = {
        name,
        kind: 'O',
        spread: O.spreadOld === true || (O.spreadOld === 'one' && first),
        counter: O.counterIds === true || (O.counterIds === 'one' && first),
      }
      loadOld(w)
      W.wins.push(w)
      return w
    },
    deliver(w) {
      if (w.kind === 'O' || w.closed || w.frozen) return
      step(w)
    },
    deliverAll() {
      for (let i = 0; i < 3; i++) for (const w of W.wins) api.deliver(w)
    },
    // a round that ends with values {s, k}
    round(w, s, k) {
      if (w.kind === 'O') {
        const id = newRound(w)
        const pre = clone(w.rec)
        const lit = rebuild(pre, diskId(w, id), { s, k }, w)
        const Rr = W.rounds.get(id)
        setVal(Rr, claimed(w, lit, diskId(w, id), { s, k }))
        // per field, the round is visible only once a literal naming it for that field reaches the device
        Rr.visibleOld = Object.fromEntries(
          FIELDS.map((f) => [f, !!lit && lit.f[f].id === diskId(w, id)]),
        )
        Rr.freshAt = w.freshAt ?? null // (oracle) the rebuild this page's doc came from, if it is a rebuilt one
        w.round = { id, pre }
        if (!sameLit(lit, pre)) {
          w.rec = lit
          w.changed = true
        }
        // fileBest keeps an unchanged object (tag and all)
        commit(w, 'doc', oldDoc(w, w.rec), 'old-round', { page: w.name, roundId: id })
        return id
      }
      step(w)
      const id = newRound(w)
      setVal(W.rounds.get(id), { s, k })
      w.book.op(R, asOp(id, { s, k }))
      w.owes = !land(w, 'round')
      return id
    },
    // an Override on the results screen of the page's LAST round: its values change (down = a take-back)
    override(w, s, k) {
      if (w.kind === 'O') {
        if (!w.round) return false
        const { id, pre } = w.round
        const lit = rebuild(pre, diskId(w, id), { s, k }, w)
        setVal(W.rounds.get(id), claimed(w, lit, diskId(w, id), { s, k }))
        // (oracle) a round taken back below the record the page began it on is no longer shown by ANY record
        for (const f of FIELDS)
          W.rounds.get(id).visibleOld[f] = !!lit && lit.f[f].id === diskId(w, id)
        if (!sameLit(lit, w.rec)) {
          w.rec = lit
          w.changed = true
        }
        commit(w, 'doc', oldDoc(w, w.rec), 'old-override', { page: w.name, roundId: id })
        return true
      }
      if (!w.book.lastRound) return false
      step(w)
      // a round a Reset has removed since (here or in another window) has nothing left to Override
      if (w.book.roundDead(w.book.lastRound)) {
        w.book.lastRound = null
        return false
      }
      const id = w.book.lastRound
      setVal(W.rounds.get(id), { s, k })
      w.book.op(R, asOp(id, { s, k }, true))
      w.owes = !land(w, 'override')
      return true
    },
    // v2.28.0+ writeKept: the device's doc with every record this page changed as BETTER(theirs, mine)
    // - a fresh literal even when nothing changed (V2-F9) - and the envelope KEPT
    oldKept(w) {
      if (w.counter) return // (v2.26.0 has no writeKept: Stats Only came with v2.28.0)
      const doc = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : null
      if (!doc) return
      if (w.changed) {
        const t = doc.b ?? { f: { s: EMPTY(), k: EMPTY() } }
        const m = w.rec ?? { f: { s: EMPTY(), k: EMPTY() } }
        doc.b = { f: { s: better(t.f.s, m.f.s), k: better(t.f.k, m.f.k) } }
        if (FIELDS.every((f) => doc.b.f[f].id === null)) doc.b = null
      }
      commit(w, 'doc', JSON.stringify(doc), 'old-kept', { page: w.name })
    },
    // Full Reset under Stats Only: writeKept with the Best map EMPTIED (stats and envelope kept), then removal
    oldFullReset(w) {
      if (w.counter) return // (nor this Full Reset: it is Stats Only's, v2.28.0+)
      const doc = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : null
      // (oracle) a Full Reset kills every round - when it removes a doc; with no doc on the device it does nothing
      // any window could see (a round a full device kept a window from saving is that window's, as before)
      if (doc)
        for (const Rr of W.rounds.values())
          if (!Rr.dead) {
            Rr.dead = true
            Rr.killedBy = { page: w.name, at: W.ev.length }
          }
      W.frSeq = ++W.seq
      W.ev.push({ i: W.ev.length, by: w.name, kind: 'K', why: 'kill' })
      if (doc) {
        doc.b = null
        commit(w, 'doc', JSON.stringify(doc), 'old-fullreset-middle', { page: w.name })
      }
      commit(w, 'doc', null, 'old-fullreset-remove', { page: w.name })
      w.rec = null
      w.changed = false
      w.round = null
      w.stTag = null
      w.stLn = 'fresh' // rebuilt from defaults: no tag
      w.freshAt = W.ev.length // (oracle) when this page's doc was rebuilt
    },
    oldSave(w) {
      commit(w, 'doc', oldDoc(w, w.rec), 'old-save', { page: w.name })
    },
    reloadOld(w) {
      loadOld(w)
      w.lastId = 0
      commit(w, 'doc', oldDoc(w, w.rec), 'old-boot', { page: w.name })
    },
    // (v4) the device clock moves (set back or forward); stamps and new rounds follow the hybrid clock
    jumpClock(dt) {
      W.wall = Math.max(1, W.wall + dt)
    },
    // a new window's Reset of this Best
    reset(w) {
      step(w)
      // (oracle) the window's own rounds not yet saved are gone with its Reset, whatever becomes of the Reset
      for (const op of w.book.recs[R]?.dirty ?? [])
        if (!W.rounds.get(op.id).saved) W.rounds.get(op.id).dead = true
      const was = w.book.resetPending
      w.book.reset()
      if (was === false) w.resetPressSeq = ++W.seq // (oracle) the press in the driver's real order
      w.owes = !land(w, 'reset')
    },
    freeze(w) {
      w.frozen = true
      w.missed = true
    },
    resume(w) {
      w.frozen = false
      api.deliver(w)
    },
    setFull(w, on) {
      w.full = on
    },
    final: () => {
      const doc = W.dev.get('doc') ? JSON.parse(W.dev.get('doc')) : null
      return doc ? scopeRec(doc.b, doc) : null
    },
    fpRec,
  }
  return api
}
