// tests/helpers/syncModel/judge4.js — design-q2-model/judge4.mjs VERBATIM but for three readings of the
// door's spelling (a time is a number; a window's ledger is under `x`; the sync key is packed).
//
// The model's header: design-q2-model/judge4.mjs - two oracles over a model4 world. Neither reads stamps, tags, books, or
// the sync key: only who wrote what, in order, what each older page really did, and the ledgers.
import { SILOS, REGS, ledgerAgg } from './world4.js'
import { unpackSync } from '../../../src/store/syncStamp.js'

// ── MINE: G1-G6 plus the count checks; every loss after an older write is CLASSIFIED, never excused ──
export function judge(w, { anchor = null } = {}) {
  const { ev, born, kills } = w.W
  const f = w.final()
  const ids = (s) => w.idsOf(f[s])
  const r = {
    removedByNew: 0,
    resurrectedByNew: 0,
    regRevertedByNew: 0,
    diverged: 0,
    doubled: 0,
    holderFailed: 0,
    aggBad: 0,
    aggForced: 0,
    forcedSameBase: 0,
    forcedBootLike: 0,
    overrideSeenTogether: 0,
    unseenAfterReset: 0,
    oldLossReapplied: 0,
    oldResurrectionReapplied: 0,
    fullPartition: 0,
    unseenOldChange: 0,
    lostToOldWrite: 0,
    lostToOldConflict: 0,
    regOldCarryWins: 0,
    answers: 0,
    oldAnswers: 0,
    oldAnswersKept: 0,
    writeDouble: 0,
    writeOdd: 0,
    writePassDouble: 0,
    writeDoubleR6: 0,
    writeOddR6: 0,
    forgets: 0,
    forgotten: 0,
    forgetMissed: 0,
    forgetSkipped: 0,
    amLate: 0,
    oldWhileClosed: 0,
    olderCopyStands: 0,
    amTwoLineages: 0,
    oldResetOfBlankView: 0,
  }
  // (every loss or return a NEW write made that this oracle files under a named residual, keyed for the cross-check)
  Object.defineProperty(r, 'named', { value: new Map(), enumerable: false })
  // Counts that disagree with the ledger: a run of NEW writes of one mode, from the write that made the
  // mismatch until one that agrees again. The run is FORCED (R7) when the older write folded just before
  // it read like the bootstrap record or an adopted change without being an extension of it (its first
  // answers are not that record's answers); otherwise every write of the run is bad.
  let aggForced = 0,
    aggBadRun = 0
  {
    const byI = new Map()
    for (const b of w.W.aggBad) byI.set(b.i + ':' + b.s, b)
    for (const s of SILOS) {
      let run = null
      const forcedDelta = new Set()
      for (const e of ev) {
        if (e.kind !== 'N') continue
        const b = byI.get(e.i + ':' + s)
        if (!b) {
          run = null
          continue
        }
        if (run === null) {
          const o = e.lastOld !== null ? ev[e.lastOld] : null
          // R7: read like a record it is not; R6: another lineage wrote on the same base before
          const r7 = !!o && (o.bootLike ?? []).includes(s)
          const r6 =
            !!o &&
            !!o.basis?.[s] &&
            ev.some(
              (q) =>
                q.i < o.i && q.kind === 'O' && q.page !== o.page && q.basis?.[s] === o.basis[s],
            )
          // ...or an older page's copy carrying back, unchanged, the very excess a forced run already showed
          // (the page took it from the device then, and writes it again: an older build re-asserting its copy)
          const carried = !!o && forcedDelta.has(b.delta)
          // R1 (LAG only): a NEW window wrote over an older page's Override of a card in this mode that it had not yet
          // read (inside the read lag); the fold record it left disagrees with the older page about that card, and a
          // later Reset or forget, which leaves the record standing for cards the version no longer holds, folds by it
          const lagOverOverride =
            !!w.W.O.lag &&
            ev.some(
              (ov) =>
                ov.ov &&
                ov.ov.s === s &&
                ov.i < e.i &&
                ev.some(
                  (q) =>
                    q.kind === 'N' &&
                    q.i > ov.i &&
                    q.i < e.i &&
                    q.ver?.[s] &&
                    !(w.W.readsBy ?? []).some(
                      (rd) =>
                        rd.who === q.by && rd.at <= q.i && (w.W.hist[rd.pos]?.ev ?? -1) >= ov.i,
                    ),
                ),
            )
          run = r7 || r6 || carried || lagOverOverride ? 'forced' : 'bad'
        }
        if (run === 'forced') forcedDelta.add(b.delta)
        if (run === 'forced') {
          aggForced++
          if (process.env.WHY)
            console.log('FORCED counts', JSON.stringify(b), 'after old write', e.lastOld)
        } else {
          aggBadRun++
          if (process.env.WHY) console.log('BAD counts', JSON.stringify(b))
        }
      }
    }
  }
  const killedAt = new Map()
  for (const k of kills)
    for (const id of k.ids) if (!killedAt.has(id) || killedAt.get(id) > k.at) killedAt.set(id, k.at)
  const bootLikeAt = (e, x) => e.lastOld !== null && (ev[e.lastOld].bootLike ?? []).includes(x)
  const reapplied = (id, i) => {
    let add = null
    for (const q of ev) if (q.i < i && q.added.includes(id)) add = q
    if (!add || add.kind !== 'O') return false
    return ev.some(
      (q) => q.i < add.i && (q.kind === 'O' || q.kind === 'X') && q.removed.includes(id),
    )
  }
  // the removing window held a copy of the mode WITHOUT the answer when it first read the older write that
  // put it back (its newest version stands against an older page's stale copy of a loss another older write
  // made), and had not held it since that read
  const reasserts = (id, e) => {
    const s = born.get(id)?.s
    let add = null
    for (const q of ev) if (q.i < e.i && q.added.includes(id)) add = q
    const reads = (w.W.heldAtRead ?? []).filter(
      (h) => h.by === e.by && h.s === s && h.at > add.i && h.at <= e.i,
    )
    return reads.length > 0 && reads.every((h) => !(h.q[id] > 0))
  }
  const partition = (id, i) => {
    let add = null
    for (const q of ev) if (q.i < i && q.added.includes(id)) add = q
    if (!add || add.kind !== 'N') return false
    const rm = ev.filter((q) => q.i < add.i && q.kind === 'O' && q.removed.includes(id)).pop()
    return !!rm && w.W.refused.some((k) => k > rm.i && k <= add.i)
  }
  // An older page's Override and a later answer of that page in the same mode, which the removing window
  // never saw apart (no read of the device between the Override's write and the answer's): counts
  // cannot separate a verdict changed further back from the new answers (the design drops that part).
  const ovTogether = (id, b, e) => {
    if (b?.kind !== 'O') return false
    const add = ev.find((q) => q.kind === 'O' && q.added.includes(id))
    if (!add) return false
    // (the Override before or after the answer: either way one read showed both) - or the Override was never
    // turned into a version by ANY new window before that page wrote again (no window could see it alone)
    return ev.some(
      (o) =>
        o.ov &&
        o.ov.s === b.s &&
        o.page === b.lineage &&
        o.i < e.i &&
        (!(w.W.readsBy ?? []).some(
          (r) => r.who === e.by && r.at > Math.min(o.i, add.i) && r.at <= Math.max(o.i, add.i),
        ) ||
          (o.i < add.i && unversionedOverride(o, b))),
    )
  }
  // an older page's Override no new window turned into a version before that page wrote again
  // ...by a window that had READ the device showing it (a window that never saw it cannot have resolved it)
  const sawWrite = (who, o) =>
    (w.W.readsBy ?? []).some((r) => r.who === who && w.W.hist[r.pos]?.ev === o.i)
  const unversionedOverride = (o, b) => {
    const nextOwn = ev.find((q) => q.i > o.i && q.page === b.lineage && q.kind === 'O')
    return !ev.some(
      (q) =>
        q.i > o.i &&
        q.i < (nextOwn?.i ?? Infinity) &&
        q.kind === 'N' &&
        q.ver?.[b.s] &&
        sawWrite(q.by, o),
    )
  }
  // The older page's answer reached the removing window only in a stretch it did not see write by write
  // (asleep, or opened after: the notices since the copy it last saw did not all reach it), while the older
  // page's copy of that mode held cards the newest version did not hold as that page shows them (a Reset
  // removed them, a part was not carried, or the page Overrode one): an Override of one of those could hide
  // in the stretch, so the design drops the part.
  const unseenAfterReset = (id, b, e) => {
    if (b?.kind !== 'O') return false
    const add = ev.find((q) => q.kind === 'O' && q.added.includes(id))
    if (!add) return false
    // the read in which that window FIRST saw the answer (the stretch it came in)
    const rd = (w.W.readsBy ?? []).find((r) => r.who === e.by && r.at > add.i && r.at <= e.i)
    if (!rd || rd.contig.includes(b.s)) return false
    // the older page's earlier cards of this mode: one a NEW write removed (a Reset, or a part not carried)
    // and no NEW write put back before the answer was added
    const mine = add.after[b.s].slice(0, add.after[b.s].indexOf(id))
    const gone = mine.some((c) => {
      const rm = ev.filter((q) => q.kind === 'N' && q.i < add.i && q.removed.includes(c)).pop()
      return (
        !!rm && !ev.some((q) => q.kind === 'N' && q.i > rm.i && q.i < add.i && q.added.includes(c))
      )
    })
    // ...or one whose verdict the older page changed by an Override (the newest version may still hold the old one)
    const flipped = ev.some(
      (o) =>
        o.ov && o.ov.s === b.s && o.page === b.lineage && o.i < add.i && mine.includes(o.ov.id),
    )
    return gone || flipped
  }
  // R2: knowledge of a change held only by windows the device refused - a window READ the change, then
  // its writes were refused, and the write at issue came from a window that never saw the change
  const heldByRefused = (at, i) =>
    (w.W.refusedBy ?? []).some(
      (f) =>
        f.at > at &&
        f.at <= i &&
        (w.W.readsBy ?? []).some((r) => r.who === f.who && r.at > at && r.at <= f.at),
    )
  const heldRemoval = (id, e) =>
    ev.some(
      (rm) =>
        rm.kind === 'O' &&
        rm.i < e.i &&
        rm.removed.includes(id) &&
        sawWrite(e.by, rm) &&
        (w.W.refusedBy ?? []).some((f) => f.who === e.by && f.at > rm.i && f.at <= e.i) &&
        !ev.some((q) => q.i > rm.i && q.i < e.i && q.by === e.by) &&
        ev
          .filter((q) => q.i > rm.i && q.i < e.i && q.kind === 'N' && q.added.includes(id))
          .every((q) => !sawWrite(q.by, rm)),
    )
  const weighedTwo = (b, e) => {
    const prevW = ev.filter((q) => q.kind === 'N' && q.by === e.by && q.i < e.i).pop()?.i ?? -1
    return (w.W.weighed ?? []).some(
      (f) =>
        f.by === e.by &&
        f.s === b.s &&
        f.at > prevW &&
        f.at <= e.i &&
        f.lin.length >= 2 &&
        f.lin.includes(b.lineage),
    )
  }
  const sameBase = (b, i) =>
    b?.kind === 'O' &&
    b.basis &&
    ev.some((q) => q.i < i && q.kind === 'O' && q.page !== b.lineage && q.basis?.[b.s] === b.basis)
  // (Amnesic) the forget's own window start, and whether an answer was on the device then
  const fgAt = (e) => (w.W.forgets ?? []).find((f) => f.at === e.i)
  const amLate = (id, e) => {
    const f = fgAt(e)
    if (!f || id > f.startId) return false
    const st = (w.W.winStarts ?? []).filter((x) => x.id === f.startId).pop()
    // (in a NEW window's version when the window started: an older page's write no new window had folded yet is not)
    const x = born.get(id).s
    const lastV = st ? ev.filter((q) => q.i < st.at && q.kind === 'N' && q.ver?.[x]).pop() : null
    return !!st && !(lastV?.after[x] ?? []).includes(id)
  }
  r.aggBad = aggBadRun
  r.aggForced = aggForced
  // G1: a NEW write removed a live answer
  // (a Reset write is judged too, except for the answers its own Reset removed)
  for (const e of ev)
    if (e.kind === 'N')
      for (const id of e.removed) {
        if ((killedAt.get(id) ?? Infinity) <= e.i) continue
        const b = born.get(id)
        const cls = (k) => {
          r[k]++
          r.named.set('L' + id + '@' + e.i, k)
          if (process.env.CLS) console.log('class', id, 'at', e.i, k)
        }
        // the same answer removed again after the older page's own write carried it back: as first judged
        const prior = [...r.named.entries()]
          .filter(([k]) => k.startsWith('L' + id + '@') && +k.split('@')[1] < e.i)
          .pop()
        const carriedBack =
          prior &&
          ev
            .filter((q) => q.i > +prior[0].split('@')[1] && q.i < e.i && q.added.includes(id))
            .every((q) => q.kind === 'O')
        if (carriedBack) cls(prior[1])
        // (Amnesic) R16: the forget removed an answer given BEFORE its window that was in no new window's version when
        // the window started (a full device held it, or an older page's write no new window had folded yet): it
        // reached the mode after the anchor, so it counts as the window's
        else if (e.why === 'forget' && amLate(id, e)) cls('amLate')
        // (Amnesic) R18: an older page's answer given while every new window was closed - no window saw it come, so
        // the forget, which runs first at the next open, counts it with the session before
        else if (e.why === 'forget' && b?.kind === 'O' && id > (fgAt(e)?.endId ?? Infinity))
          cls('oldWhileClosed')
        // (Amnesic) R6 at the forget: ANOTHER older lineage's copy took the answer away and its own page's next copy
        // brought it back inside the window - the counts read that as the page's new card, folded after the anchor
        else if (
          e.why === 'forget' &&
          b?.kind === 'O' &&
          ev.some(
            (q) => q.kind === 'O' && q.page !== b.lineage && q.i < e.i && q.removed.includes(id),
          )
        )
          cls('amTwoLineages')
        // R6, precisely (v4, V3-F2 / review (1)): another lineage wrote on the same base AND the removing window,
        // since its previous write, weighed a block against a record standing for two lineages, this answer's one
        else if (sameBase(b, e.i) && weighedTwo(b, e)) cls('forcedSameBase')
        else if (bootLikeAt(e, b.s)) cls('forcedBootLike')
        // (v4, review (1): narrowed) ...and the removing write RE-ASSERTS a version written before the older
        // page put the answer back, one that never held it
        else if (reapplied(id, e.i) && reasserts(id, e)) cls('oldLossReapplied')
        else if (partition(id, e.i)) cls('fullPartition')
        // R2: the removing window READ an older page's write that removed the answer, the device then refused
        // it until now, and every new write that put the answer back came from a window that never saw that write
        else if (heldRemoval(id, e)) cls('fullPartition')
        // R2: the Override WAS seen alone, but only by a window the full device then refused
        else if (
          b?.kind === 'O' &&
          ev.some(
            (o) =>
              o.ov &&
              o.ov.s === b.s &&
              o.page === b.lineage &&
              o.i < e.i &&
              unversionedOverride(o, b) &&
              heldByRefused(o.i, e.i),
          )
        )
          cls('fullPartition')
        else if (ovTogether(id, b, e)) cls('overrideSeenTogether')
        else if (unseenAfterReset(id, b, e)) cls('unseenAfterReset')
        else {
          r.removedByNew++
          if (process.env.WHY)
            console.log('BAD removal', id, JSON.stringify(b), 'by ev', e.i, e.by, e.why)
        }
      }
  // (Amnesic) the mode's bytes the forget found were an OLDER page's that no new window had written as a version since
  // (no window was open to fold them before the close): the opener can only pass them through
  const olderBytesAtForget = (x, f) => {
    // the last write before the forget was an older page's, and its copy of the mode is not the newest version a new
    // window wrote (a copy behind it, or one no window could place) - or the newest new write passed older bytes through
    const last = ev.filter((q) => q.i < f.from).pop()
    const lastV = ev.filter((q) => q.i < f.from && q.kind === 'N' && q.ver?.[x]).pop()
    const lastN = ev.filter((q) => q.i < f.from && q.kind === 'N').pop()
    if (lastN && lastN.ver && !lastN.ver[x] && (!lastV || lastN.i > lastV.i)) return true
    if (!last || last.kind !== 'O') return false
    const bs = last.basis?.[x]
    return (
      !bs ||
      !String(bs).startsWith('tag:') ||
      !lastV ||
      lastV.verSt?.[x] !== String(bs).split(':')[1]
    )
  }
  // (Amnesic) the answer was given in an older tab whose copy of the mode was already BEHIND the newest version a new
  // window wrote (its tag names an older one): its cards wait for a holder of the newest to resolve them, and a window
  // that is not one takes the bytes as they are - they enter the mode without a fold, so without an anchor before them
  const behindAtBirth = (b) => {
    if (b.kind !== 'O' || !b.basis) return false
    // (a copy on the bootstrap record: no new window had written the mode in a form its page loaded - nothing to fold onto)
    if (b.basis === 'boot') return true
    if (!String(b.basis).startsWith('tag:')) return false
    const lastV = ev.filter((q) => q.i < b.at && q.kind === 'N' && q.ver?.[b.s]).pop()
    return !!lastV && lastV.verSt?.[b.s] !== String(b.basis).split(':')[1]
  }
  // (the previous forget: before it the mode was restored to a version a new window wrote, whatever stood before)
  const prevForget = (f) => (w.W.forgets ?? []).filter((g) => g.from < f.from).pop()?.from ?? 0
  // G12 (Amnesic, design-amnesic-close.md): a FORGET at a cold open removes every answer given inside the closed
  // window - by any page - judged from the driver's own record, never from the anchors the model keeps
  for (const f of w.W.forgets ?? []) {
    r.forgets++
    const after =
      f.at !== null ? ev[f.at].after : (ev.filter((q) => q.i < f.from).pop()?.after ?? {})
    for (const id of f.F) {
      const b = born.get(id)
      if (!(after[b.s] ?? []).includes(id)) {
        r.forgotten++
        continue
      }
      // R17: the mode was left alone because an older page Overrode, inside the window, a card from before it (the
      // anchor's prefix of times no longer stands): the window's answers in that mode are kept
      const ovBefore = ev.some(
        (o) =>
          o.ov &&
          o.ov.s === b.s &&
          o.i < f.from &&
          born.get(o.ov.id) &&
          o.ov.id <= f.startId &&
          (w.W.winStarts ?? []).some((st) => st.id === f.startId && o.i >= st.at),
      )
      if (f.skipped.includes(b.s) && ovBefore) {
        r.forgetSkipped++
        r.named.set('F' + id, 'forgetSkipped')
      }
      // R19 (an OLDER tab's own answers only): its copy was behind the newest version when it gave the answer, or since
      // the previous forget its copy of the mode took over (one no window could place, or a stale copy that removed new
      // answers), or its copy, behind, was the last write before the forget - the answer entered the mode without a
      // fold inside the window, so no anchor stands before it: it is kept
      else if (
        b.kind === 'O' &&
        (olderBytesAtForget(b.s, f) ||
          behindAtBirth(b) ||
          ev.some(
            (q) =>
              q.i >= prevForget(f) &&
              q.i < f.from &&
              ((q.kind === 'O' && q.basis && q.basis[b.s] == null) ||
                (q.kind === 'O' &&
                  q.removed.some(
                    (r0) =>
                      born.get(r0)?.kind === 'N' &&
                      born.get(r0)?.s === b.s &&
                      (killedAt.get(r0) ?? Infinity) > q.i,
                  ))),
          ))
      ) {
        r.olderCopyStands++
        r.named.set('F' + id, 'olderCopyStands')
      } else {
        r.forgetMissed++
        if (process.env.WHY)
          console.log('BAD forget missed', id, JSON.stringify(b), 'forget at', f.at, 'from', f.from)
      }
    }
  }
  // G2: a NEW write brought back what a Reset, a clear, or an older Full Reset removed
  for (const [id, at] of killedAt) {
    const s = born.get(id)?.s
    if (!s || !ids(s).includes(id)) continue
    // (v5) R4b: the kill was an older page's Reset of a mode that was blank at the update, written in a copy with no tag
    // of this generation in any mode - byte for byte what a page from before the first new save writes as its stale
    // copy of that mode; the new windows' answers there are kept
    const kill = kills.filter((k) => k.ids.has(id) && k.at === at).pop()
    if (kill?.blankView && born.get(id)?.kind === 'N') {
      r.oldResetOfBlankView++
      r.named.set('R' + id, 'oldResetOfBlankView')
      continue
    }
    // (a forget that could not remove it - a named case at the forget - did not kill it: it stays, as filed there)
    if (r.named.has('F' + id)) continue
    let last = null
    for (const e of ev) if (e.i >= at && e.added.includes(id)) last = e
    if (last?.kind !== 'N') continue
    const byOld = ev.some((q) => q.i > at && q.i < last.i && q.kind === 'O' && q.added.includes(id))
    const nextWrite = ev.find((q) => q.i > at)?.i ?? Infinity
    const unseen = ev[at]?.kind === 'O' && !w.W.reads.some((k) => k > at && k <= nextWrite)
    if (byOld) {
      r.oldResurrectionReapplied++
      r.named.set('R' + id, 'oldResurrectionReapplied')
    } else if (unseen) {
      r.unseenOldChange++
      r.named.set('R' + id, 'unseenOldChange')
    } else if (bootLikeAt(last, s)) {
      r.forcedBootLike++
      r.named.set('R' + id, 'forcedBootLike')
    } else if (heldByRefused(at, last.i)) {
      r.fullPartition++
      r.named.set('R' + id, 'fullPartition')
    } else {
      r.resurrectedByNew++
      if (process.env.WHY)
        console.log('BAD resurrection', id, 'killed at', at, 'by ev', last.i, last.by)
    }
  }

  // G3: a NEW write replaced a chosen setting with one chosen earlier (R1; R3 = Q21's Amnesic setting)
  for (const RX of ['R1', 'R3']) {
    const chosenAt = new Map([[0, -1]])
    let cur = { at: -1, chosen: true }
    for (const e of ev) {
      const ch = e.regs[RX]
      if (!ch) continue
      const choice =
        (e.kind === 'N' && (e.why === 'set' || e.heldSet?.includes(RX))) ||
        (e.kind === 'O' && (e.genuine ?? []).includes(RX)) ||
        e.kind === 'X'
      if (choice) {
        chosenAt.set(ch.to, e.i)
        cur = { at: e.i, chosen: true }
        continue
      }
      // an older page's choice no new window ever read before the next write covered it: unseen (R10)
      const unseenChoice = (at) =>
        at >= 0 &&
        ev[at]?.kind === 'O' &&
        !w.W.reads.some((k) => k > at && k <= (ev.find((q) => q.i > at)?.i ?? Infinity))
      if (
        e.kind === 'N' &&
        cur.chosen &&
        (chosenAt.get(ch.to) ?? -2) < cur.at &&
        unseenChoice(cur.at)
      )
        r.unseenOldChange++
      else if (
        e.kind === 'N' &&
        cur.chosen &&
        (chosenAt.get(ch.to) ?? -2) < cur.at &&
        heldByRefused(cur.at, e.i)
      )
        r.fullPartition++
      // R2: the writer read an older page's Full Reset in its middle state (the doc removed: every setting at its
      // factory value) and the device refused it until now; the windows that wrote since never saw that state, and read
      // the rebuilt doc (a field the older build does not know: the newest value carried). Amnesic round, config 26, run 2283
      else if (
        e.kind === 'N' &&
        cur.chosen &&
        (chosenAt.get(ch.to) ?? -2) < cur.at &&
        ev.some(
          (q) =>
            q.why === 'old-remove' && q.i < e.i && heldByRefused(q.i, e.i) && sawWrite(e.by, q),
        )
      )
        r.fullPartition++
      else if (e.kind === 'N' && cur.chosen && (chosenAt.get(ch.to) ?? -2) < cur.at) {
        r.regRevertedByNew++
        if (process.env.WHY) console.log('BAD revert at', e.i, e.by, JSON.stringify(ch))
      }
      cur =
        e.kind === 'O'
          ? { at: chosenAt.get(ch.to) ?? -2, chosen: false }
          : { at: chosenAt.get(ch.to) ?? -2, chosen: true }
    }
  }
  // G4: convergence. (A setting field ABSENT from the doc - an older build that does not know it dropped it -
  // reads as the sync key's newest value, or the factory value with no key: that is what every window shows.)
  const S = w.W.dev.get('side') ? unpackSync(w.W.dev.get('side')) : null
  for (const x of REGS) if (f[x] === undefined) f[x] = S?.at?.[x]?.v ?? 0
  // (...and a stale value an older page put back, equal to the one before the newest change, reads as the newest
  // in every new window - it re-asserts it on its next write, not on a load)
  // (only while the doc is there: with the doc REMOVED - an older build's Full Reset caught between its two writes - every
  // window reads a change to blank everywhere, 2.4, and the factory value is what it shows; Amnesic round, config 26, run 2678)
  if (w.W.dev.has('doc'))
    for (const x of REGS) {
      const a = S?.at?.[x]
      if (a && a.prev && !a.seen && 'R' + f[x] === a.prev.fp) f[x] = a.v
    }
  for (const y of w.W.wins)
    if (y.kind === 'N' && !y.closed)
      for (const x of [...SILOS, ...REGS]) {
        const dv = SILOS.includes(x)
          ? JSON.stringify([f[x].pl, f[x].gd, f[x].sk, f[x].bs, f[x].t])
          : String(f[x])
        const m = y.mem[x].v
        const mv = SILOS.includes(x) ? JSON.stringify([m.pl, m.gd, m.sk, m.bs, m.t]) : String(m)
        if (dv !== mv) r.diverged++
      }
  // G5: no answer counted twice
  for (const s of SILOS) {
    const l = ids(s)
    if (new Set(l).size === l.length) continue
    const dups = l.filter((id, k) => l.indexOf(id) !== k)
    if (ev.some((e) => e.kind === 'O' && (e.bootLike ?? []).includes(s))) r.forcedBootLike++
    // R6: answers of an older page whose base another lineage also wrote on (by base alone they are one block)
    else if (dups.every((id) => sameBase(born.get(id), ev.length))) r.forcedSameBase++
    // (judged below against the per-write verdicts: a double the write that MADE it filed as R6 is R6 at the end too)
    else (r._pendingDbl ??= []).push({ s, dups, l })
  }
  // the counts on the device at the end
  for (const s of SILOS) {
    const L = ledgerAgg(f[s]._a ?? [])
    if (
      f[s].pl !== L.pl ||
      f[s].gd !== L.gd ||
      f[s].t.join() !== L.t.join() ||
      f[s].sk !== L.sk ||
      f[s].bs > L.bs
    ) {
      // (the device's last state is a new write's, already judged above, or an older page's own)
      const last = [...ev].reverse().find((e) => e.kind === 'N')
      if (last && !w.W.aggBad.some((b) => b.i === last.i && b.s === s)) {
        r.aggBad++
        if (process.env.WHY) console.log('BAD final counts', s)
      }
    }
  }
  // G6 and the measured costs
  for (const [id, b] of born) {
    if (b.kind === 'O') {
      r.oldAnswers++
      if (ids(b.s).includes(id)) r.oldAnswersKept++
    }
    if (b.kind !== 'N' || !b.landed) continue
    r.answers++
    if (ids(b.s).includes(id) || killedAt.has(id)) continue
    let last = null
    for (const e of ev) if (e.removed.includes(id)) last = e
    if (!last || last.kind === 'N') continue
    if (last.kind === 'O' && last.foldable?.includes(b.s)) {
      if (
        ev.some(
          (q) =>
            q.i < last.i &&
            q.kind === 'O' &&
            q.page !== last.page &&
            q.basis?.[b.s] &&
            q.basis[b.s] === last.basis?.[b.s],
        )
      )
        r.forcedSameBase++
      else if (anchor && !anchor.closed) {
        r.holderFailed++
        if (process.env.WHY) console.log('BAD holder failed', id, 'removed by', last.i)
      } else r.lostToOldWrite++
    } else r.lostToOldConflict++
  }
  let lastChoice = null,
    stale = false
  for (const e of ev) {
    const ch = e.regs.R1
    if (!ch) continue
    if (
      (e.kind === 'N' && e.why === 'set') ||
      (e.kind === 'O' && (e.genuine ?? []).includes('R1')) ||
      e.kind === 'X'
    ) {
      lastChoice = ch.to
      stale = false
    } else if (e.kind === 'O') stale = true
  }
  if (stale && f.R1 !== lastChoice) r.regOldCarryWins = 1
  // G5 and G11 AT EVERY NEW WRITE (V3-F1), from the driver's log: an answer counted twice in a mode this write
  // wrote as a version; anything the multiset cannot explain (a negative, an answer of another mode or never
  // made, a count or a time no answer accounts for). A double in an older page's bytes passed through
  // untouched is counted apart (the write that made it is judged where it was made).
  // R6, PRECISELY: the anomaly was MADE by a fold of that writer, in that mode, before this write, whose part
  // the multiset shows wrong ONLY in older pages' answers, while two older lineages were in play on the base;
  // a later write that carries the very same wrong entries (nothing more) inherits that verdict.
  const tmOwner = new Map([...born].filter(([, b]) => b.tm).map(([id, b]) => [String(b.tm), id]))
  const idsIn = (b) => [
    ...new Set(
      [...b.dbl, ...b.odd]
        .filter((x) => x !== 'count')
        .map((x) => (typeof x === 'string' && x.startsWith('t:') ? tmOwner.get(x.slice(2)) : x)),
    ),
  ]
  const verdict = new Map() // silo -> [{ ids, r6 }] anomalies already judged
  for (const b of w.W.qBad ?? []) {
    if (b.pass) {
      if (b.dbl.length) r.writePassDouble++
      continue
    }
    const ids = idsIn(b)
    const hasCount = b.odd.includes('count')
    const prevW =
      ev.filter((q) => q.kind === 'N' && q.by === ev[b.i].by && q.i < b.i).pop()?.i ?? -1
    const made =
      !hasCount &&
      ids.length > 0 &&
      ids.every((id) =>
        (w.W.foldLog ?? []).some(
          (f) =>
            f.by === ev[b.i].by &&
            f.s === b.s &&
            f.at > prevW &&
            f.at <= b.i &&
            f.r6 &&
            f.ids.includes(id),
        ),
      )
    const inherited =
      !hasCount &&
      ids.length > 0 &&
      (verdict.get(b.s) ?? []).some((v) => v.r6 && ids.every((id) => v.ids.includes(id)))
    const r6 = made || inherited
    if (r6) {
      ;(verdict.get(b.s) ?? verdict.set(b.s, []).get(b.s)).push({ ids, r6 })
      if (b.dbl.length) r.writeDoubleR6++
      else r.writeOddR6++
      continue
    }
    if (b.dbl.length) {
      r.writeDouble++
      if (process.env.WHY)
        console.log('BAD write', b.i, 'mode', b.s, 'counted twice', b.dbl.join(','))
    } else {
      r.writeOdd++
      if (process.env.WHY)
        console.log('BAD write', b.i, 'mode', b.s, 'unexplained', b.odd.join(','))
    }
  }
  for (const p of r._pendingDbl ?? []) {
    const r6ids = new Set((verdict.get(p.s) ?? []).filter((v) => v.r6).flatMap((v) => v.ids))
    if (p.dups.every((id) => r6ids.has(id))) r.forcedSameBase++
    else {
      r.doubled++
      if (process.env.WHY) console.log('BAD doubled in', p.s, p.l.join('.'))
    }
  }
  delete r._pendingDbl
  r.bad =
    r.removedByNew +
    r.resurrectedByNew +
    r.regRevertedByNew +
    r.diverged +
    r.doubled +
    r.holderFailed +
    r.aggBad +
    r.writeDouble +
    r.writeOdd +
    r.forgetMissed
  return r
}

// ── REVIEWER A's ORACLE (round-one review, review-q2-a/fuzz.mjs), applied verbatim to this world ──
// lostByNew: an answer missing at the end whose LAST removal was a NEW window's write that was not a
// Reset; resurrected: an answer a Reset removed, on the device at the end, last added by a NEW write;
// diverged. No classes, no exemptions.
export function judgeA(w) {
  const { ev, born, kills } = w.W
  const f = w.final()
  // (its own ledger, `_a`, as it was written against - the order of the answers, as the device holds them)
  const ids = (s) => (f[s]?._a ?? []).map((q) => q.id)
  let lostByNew = 0,
    lostAfterReset = 0,
    resurrected = 0,
    diverged = 0
  const flags = []
  const killedAt = new Map()
  for (const k of kills)
    for (const id of k.ids) if (!killedAt.has(id) || killedAt.get(id) > k.at) killedAt.set(id, k.at)
  for (const [id, b] of born) {
    if (ids(b.s).includes(id)) continue
    let rm = null
    for (const e of ev) if (e.removed.includes(id)) rm = e
    if (rm && rm.kind === 'N' && rm.why !== 'reset') {
      lostByNew++
      flags.push({ key: 'L' + id + '@' + rm.i, afterReset: (killedAt.get(id) ?? Infinity) <= rm.i })
      // (the one correction, reported separately: an answer a Reset had ALREADY removed before this write)
      if ((killedAt.get(id) ?? Infinity) <= rm.i) lostAfterReset++
    }
  }
  for (const k of kills)
    for (const id of k.ids) {
      const s = born.get(id)?.s
      if (!s || !ids(s).includes(id)) continue
      let add = null
      for (const e of ev) if (e.i >= k.at && e.added.includes(id)) add = e
      if (add?.kind === 'N') {
        resurrected++
        flags.push({ key: 'R' + id })
      }
    }
  for (const y of w.W.wins)
    if (y.kind === 'N' && !y.closed)
      for (const x of SILOS)
        if (JSON.stringify((y.mem[x].v.x?._a ?? []).map((q) => q.id)) !== JSON.stringify(ids(x)))
          diverged++
  return {
    lostByNew,
    lostAfterReset,
    resurrected,
    diverged,
    flags,
    bad: lostByNew + resurrected + diverged,
    badKillAware: lostByNew - lostAfterReset + resurrected + diverged,
  }
}

// Cross-check: every flag reviewer A's oracle raises is either a Reset-already-removed answer or a loss my
// oracle files under a NAMED residual (R1 lag, R5 older loss re-applied, R6, R7, R2 partition, R10 unseen).
// What is left is UNEXPLAINED and counts as bad.
export function crossCheck(mine, A, { lag = false } = {}) {
  const by = {}
  let unexplained = 0
  for (const f of A.flags) {
    // (an answer a FORGET could not remove - filed under a named case at the forget, `F<id>` - stays on the
    // device, and the next new write carries it: reviewer A's oracle, which counts the forget as a kill of
    // every answer of the window, reads that as a return. It is the case filed at the forget - found porting
    // the Amnesic gate into the suite: the model's own run of config 27 left those flags unexplained)
    const forgetCase = f.key.startsWith('R') ? mine.named.get('F' + f.key.slice(1)) : undefined
    const k = f.afterReset
      ? 'removedAfterReset'
      : (mine.named.get(f.key) ?? forgetCase ?? (lag ? 'R1 lag' : null))
    if (k) by[k] = (by[k] ?? 0) + 1
    else {
      unexplained++
      if (process.env.WHY) console.log('UNEXPLAINED reviewer flag', f.key)
    }
  }
  unexplained += lag ? 0 : A.diverged
  return { by, unexplained }
}
