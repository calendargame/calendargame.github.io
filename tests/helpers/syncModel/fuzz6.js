// tests/helpers/syncModel/fuzz6.js — design-q2-model/fuzz6.mjs VERBATIM (its driver, its oracle), driving the
// world in which the REAL door (store/syncList) plays every new window. The model's ablation ("WITHOUT
// tombstones") is not here: it switched a rule of the MODEL's merge off, and the door has no such switch.
//
// The model's header: node fuzz6.mjs [seeds] [steps] - random search over model6.mjs (the Lookup history), judged against the
// entries themselves: on the device at the end exactly the entries made and not removed by a Clear that
// happened after them (an older page's trim is that page's own behaviour, counted).
import { makeWorld, CAP } from './world6.js'
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function run(seed, cfg, steps = 300) {
  const R = rng(seed)
  const w = makeWorld(cfg.opt ?? {})
  if (cfg.onWorld) cfg.onWorld(w)
  const pick = (a) => a[Math.floor(R() * a.length)]
  const news = [w.newWin('n0'), w.newWin('n1')]
  let n = 2
  const olds = []
  for (let i = 0; i < (cfg.olds ?? 1); i++) olds.push(w.oldWin('old' + i))
  for (let i = 0; i < steps; i++) {
    const live = news.filter((y) => !y.closed)
    const awake = live.filter((y) => !y.frozen)
    const x = R()
    if (x < 0.25 && awake.length) w.lookup(pick(awake), R() < 0.2 ? 1 + Math.floor(R() * 4) : 0)
    else if (x < 0.29 && awake.length) w.clear(pick(awake))
    else if (x < 0.5 && olds.length) w.lookup(pick(olds), R() < 0.2 ? 1 + Math.floor(R() * 4) : 0)
    else if (x < 0.53 && olds.length) w.clear(pick(olds))
    else if (x < 0.58 && olds.length) w.reloadOld(pick(olds))
    else if (x < 0.66) {
      const c = live.filter((y) => !y.frozen)
      if (c.length > 1) w.freeze(pick(c))
    } else if (x < 0.76) {
      const f = live.filter((y) => y.frozen)
      if (f.length) w.resume(pick(f))
    } else if (x < 0.79) {
      if (live.length > 1) pick(live).closed = true
    } else if (x < 0.84) {
      if (live.length < 4) news.push(w.newWin('n' + n++))
    } else if (x < 0.88 && cfg.full) {
      const y = pick(live)
      w.setFull(y, !y.full)
    }
    w.deliverAll()
  }
  for (const y of news) {
    if (y.closed) continue
    w.setFull(y, false)
    y.frozen = false
    y.missed = true
  }
  for (let i = 0; i < 3; i++) w.deliverAll()
  // judge
  const f = w.final()
  const r = { lost: 0, resurrected: 0, trimmed: 0, unseenOldClear: 0, lostOnFull: 0, diverged: 0 }
  const { ev, entries } = w.W
  // an older page's Clear no new window read before that page wrote again (R10)
  // an older page's Clear that no new window turned into a version before that page wrote again (every new
  // window asleep, or refused by a full device): nothing can tell its next list from a stale one (R10/R2)
  const unseenClear = (at) => {
    if (ev[at]?.kind !== 'O') return false
    const nx = ev.find((q) => q.i > at && q.kind === 'O')
    return !!nx && !ev.some((q) => q.i > at && q.i < nx.i && q.kind === 'N')
  }
  for (const [id, e] of entries) {
    const alive = e.cleared === undefined
    const on = f.includes(id)
    if (alive && !on) {
      // an older page's trim removed it (that page's own behaviour, kept by the rule), or its maker never saved it
      const trim = ev.some(
        (q) =>
          q.kind === 'O' &&
          q.list &&
          q.list.length >= CAP &&
          !q.list.includes(id) &&
          q.i > (e.at ?? 0),
      )
      const unsaved = e.kind === 'N' && !ev.some((q) => q.kind === 'N' && q.list?.includes(id))
      // an older page's entry another older page's write removed before any new window held it (R5)
      const add = ev.find((q) => q.list?.includes(id))
      const rmByOld = add && ev.find((q) => q.i > add.i && q.kind === 'O' && !q.list?.includes(id))
      const lastRm = [...ev].reverse().find((q) => q.list && !q.list.includes(id))
      const lostToOld =
        (e.kind === 'O' &&
          rmByOld &&
          !ev.some((q) => q.i > add.i && q.i < rmByOld.i && q.kind === 'N')) ||
        // ...or removed by an older page's write no new window wrote after (none open to resolve it)
        (lastRm?.kind === 'O' && !ev.some((q) => q.i > lastRm.i && q.kind === 'N'))
      if (unsaved) r.lostOnFull++
      else if (lostToOld) r.lostToOldWrite = (r.lostToOldWrite ?? 0) + 1
      else if (trim) r.trimmed++
      else {
        r.lost++
        if (process.env.WHY) console.log('BAD lost', id, JSON.stringify(e))
      }
    }
    if (!alive && on) {
      if (unseenClear(e.cleared)) r.unseenOldClear++
      else if (e.oldRelookup) r.oldRelookupOfCleared = (r.oldRelookupOfCleared ?? 0) + 1
      // an older page's entry no new window ever held before a new window's Clear: that Clear cannot have named it
      else if (
        e.kind === 'O' &&
        !ev.some((q) => q.i < e.cleared && q.kind === 'N' && q.list?.includes(id))
      )
        r.unseenBeforeClear = (r.unseenBeforeClear ?? 0) + 1
      else {
        r.resurrected++
        if (process.env.WHY) console.log('BAD back', id, JSON.stringify(e))
      }
    }
  }
  for (const y of w.W.wins)
    if (y.kind === 'N' && !y.closed && JSON.stringify(y.mem) !== JSON.stringify(f)) r.diverged++
  r.bad = r.lost + r.resurrected + r.diverged
  r.clearKept = w.W.clearKept ?? 0 // (reach: a held Clear left waiting by a newer version with no new entry)
  return r
}
export const cfgs = [
  ['1 old page: lookups, moves to the top, Clears, trims, reloads', { full: true, olds: 1 }],
  ['2 old pages', { full: true, olds: 2 }],
]
