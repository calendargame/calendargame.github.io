// tests/helpers/syncModel/world6.js — design-q2-model/model6.mjs's WORLD (the Lookup history), hosting THE
// REAL DOOR (store/syncList's ListBook) for every new window. The older pages, the device, and the oracle's
// bookkeeping are the model's VERBATIM; an entry is the app's shape ({ id } here); stamps are the door's
// Lamport stamps instead of the model's one global counter (a window mints above every stamp it has seen,
// which is all the model's ordering ever needed).
//
// The model's header: the Lookup history (one list of entries with unique ids, newest first) under the v3
// rule, against older pages as v2.26-v2.29 behave (reviewer A's V2-F8: a new window's Clear History undone
// by an older page's next lookup). Older pages: memory = the list they loaded. A lookup puts a new entry on
// top (or moves an existing one to the top); Clear empties the list; the list is trimmed to CAP (v2.26.0's
// trim to 100). Every one of those writes the WHOLE list from memory. Reload.
import { ListBook } from '../../../src/store/syncList.js'
import { packSync, unpackSync } from '../../../src/store/syncStamp.js'

export const CAP = 8

export function makeWorld() {
  const W = {
    dev: new Map(),
    hist: [{ doc: null, side: null }],
    wins: [],
    ev: [],
    nid: 0,
    entries: new Map(),
    readsBy: [],
    refused: [],
  }
  const devState = () => ({ doc: W.dev.get('doc') ?? null, side: W.dev.get('side') ?? null })
  const listOf = (text) =>
    text ? JSON.parse(text).l.map((e) => (typeof e === 'object' ? e.id : e)) : null
  function commit(w, k, text, why) {
    if (w.full) {
      W.refused.push({ who: w.name, at: W.ev.length })
      return false
    }
    if ((W.dev.get(k) ?? null) === text) return true
    if (text === null) W.dev.delete(k)
    else W.dev.set(k, text)
    if (k === 'doc')
      W.ev.push({ i: W.ev.length, by: w.name, kind: w.kind, why, list: listOf(text) })
    W.hist.push(devState())
    if (w.view) {
      w.view = devState()
      w.pos = W.hist.length - 1
    }
    return true
  }
  // ═════════ NEW windows: THE REAL DOOR ═════════
  // the doc and the key as the app's door spells them; an older page writes the list without an envelope
  const SHAPE = {
    trimAt: CAP,
    parse(text) {
      if (text == null) return null
      const o = JSON.parse(text)
      return {
        list: o.l.map((e) => (typeof e === 'object' ? e : { id: e })),
        st: o.s ? unpackSync(JSON.stringify(o.s)) : null,
      }
    },
    write: (list, st) => JSON.stringify({ l: list, s: JSON.parse(packSync(st)) }),
    readKey: (text) => (text == null ? null : unpackSync(text)),
    writeKey: (k) => packSync(k),
  }
  function makeBook(w) {
    const io = {
      view: () => ({ doc: w.view.doc ?? null, side: w.view.side ?? null }),
      save(docText, keyText) {
        if (w.full) {
          W.refused.push({ who: w.name, at: W.ev.length })
          return false
        }
        const devBefore = listOf(W.dev.get('doc')) ?? []
        const mem = w.book.mem.map((e) => e.id)
        commit(w, 'doc', docText, w.why)
        // (oracle) a lookup that lands - a held one too - is the player's action: an entry looked up again
        // lives again
        for (const op of w.book.dirty)
          if (!op.clear) {
            const e = W.entries.get(op.id)
            if (e.cleared !== undefined && mem.includes(op.id)) {
              delete e.cleared
              e.kind = 'N'
              e.at = W.ev.length - 1
            }
          }
        // (oracle) a Clear that lands clears what its page showed and what the device held
        for (const op of w.book.dirty)
          if (op.clear)
            for (const id of new Set([
              ...op.removed,
              ...devBefore,
              ...W.ev.slice(0, -1).flatMap((q) => q.list ?? []),
            ]))
              if (!mem.includes(id)) W.entries.get(id).cleared ??= W.ev.length - 1
        commit(w, 'side', keyText, 'side')
        return true
      },
    }
    const hooks = {
      onRead: () => W.readsBy.push({ who: w.name, at: W.ev.length }),
      counter: (name) => (W[name] = (W[name] ?? 0) + 1),
    }
    return new ListBook({ shape: SHAPE, io, tag: w.name, hooks })
  }
  function step(w) {
    w.why = 'writeback'
    if (w.missed) {
      w.missed = false
      w.pos = W.hist.length - 1
      w.view = { ...W.hist[w.pos] }
      w.book.handle()
      return
    }
    let kept = false
    while (w.pos < W.hist.length - 1) {
      w.pos++
      w.view = { ...W.hist[w.pos] }
      kept = w.book.handle(false) || kept
    }
    w.book.handle(true, kept)
  }
  const api = {
    W,
    CAP,
    newWin(name) {
      const w = { name, kind: 'N' }
      w.pos = W.hist.length - 1
      w.view = { ...W.hist[w.pos] }
      Object.defineProperty(w, 'mem', { get: () => w.book.mem.map((e) => e.id) })
      w.book = makeBook(w)
      W.wins.push(w)
      step(w)
      return w
    },
    oldWin(name) {
      const w = { name, kind: 'O' }
      w.l = listOf(W.dev.get('doc')) ?? []
      W.wins.push(w)
      return w
    },
    lookup(w, again) {
      if (w.kind === 'O') {
        const id = again && w.l.length ? w.l[Math.min(again, w.l.length - 1)] : ++W.nid
        if (!W.entries.has(id)) W.entries.set(id, { id, at: W.ev.length, by: w.name, kind: 'O' })
        else if (W.entries.get(id).cleared !== undefined) W.entries.get(id).oldRelookup = true // (oracle) counted
        w.l = [id, ...w.l.filter((x) => x !== id)].slice(0, CAP)
        commit(w, 'doc', JSON.stringify({ l: w.l.map((x) => ({ id: x })) }), 'old-lookup')
        return id
      }
      step(w)
      const id = again && w.mem.length ? w.mem[Math.min(again, w.mem.length - 1)] : ++W.nid
      if (!W.entries.has(id)) W.entries.set(id, { id, at: W.ev.length, by: w.name, kind: 'N' })
      w.book.lookup({ id })
      w.why = 'lookup'
      w.book.owes = !w.book.land()
      return id
    },
    clear(w) {
      if (w.kind === 'O') {
        // (oracle) a Clear is the player clearing THE history: every entry ever saved and what that page shows
        const saved = new Set(W.ev.flatMap((q) => q.list ?? []))
        for (const id of new Set([...w.l, ...saved])) W.entries.get(id).cleared ??= W.ev.length
        w.l = []
        commit(w, 'doc', JSON.stringify({ l: [] }), 'old-clear')
        return
      }
      step(w)
      const removed = [...w.mem]
      for (const id of removed) W.entries.get(id).clearedPending = true
      w.book.clear()
      w.why = 'clear'
      w.book.owes = !w.book.land()
    },
    reloadOld(w) {
      w.l = listOf(W.dev.get('doc')) ?? []
    },
    deliver(w) {
      if (w.kind === 'O' || w.closed || w.frozen) return
      step(w)
    },
    deliverAll() {
      for (let i = 0; i < 3; i++) for (const w of W.wins) api.deliver(w)
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
    final: () => listOf(W.dev.get('doc')) ?? [],
  }
  return api
}
