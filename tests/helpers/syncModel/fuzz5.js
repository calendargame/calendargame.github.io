// tests/helpers/syncModel/fuzz5.js — design-q2-model/fuzz5.mjs VERBATIM (its driver, its judge, and its
// configurations), driving the world in which the REAL records book plays every new window (world5.js) -
// plus the configurations for the two things the model did not have: an older page that SPREADS the record it
// changes (v2.26.0), with the model's bare tag (its hole, part2-issues #1) and with the app's self-verifying one.
//
// The model's header: node fuzz5.mjs [seeds] [steps] [configs] - random search over model5.mjs (one Best
// record, two fields), judged against the rounds themselves: the record must be the best of the live rounds
// the device ever showed, held by the first round to reach it.
import { makeWorld, FIELDS, OTHER } from './world5.js'
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function judge5(w) {
  const r = {
    wrongValue: 0,
    wrongHolder: 0,
    deadHolder: 0,
    diverged: 0,
    unseenFullReset: 0,
    staleSecondPage: 0,
  }
  const { rounds, ev } = w.W
  // An older page's Full Reset that no new window turned into a version before that page wrote again (every
  // new window asleep, or refused by a full device): the sync key still names the record it destroyed (R10/R2)
  let unseenFR = false
  for (const e of ev) {
    if (e.why !== 'old-fullreset-remove') continue
    const next = ev.find(
      (q) =>
        q.i > e.i &&
        q.kind === 'O' &&
        q.why !== 'old-fullreset-middle' &&
        q.why !== 'old-fullreset-remove',
    )
    const covered = ev.some((q) => q.i > e.i && (!next || q.i < next.i) && q.kind === 'N')
    if (!covered && next) unseenFR = true
  }
  const f = w.final()
  for (const fl of FIELDS) {
    // a new window's round counts as last SAVED (a window closed on a full device loses what it never saved)
    const live = [...rounds.values()].filter(
      (q) => !q.dead && (q.kind === 'N' ? !!q.saved : q.visibleOld?.[fl]),
    )
    const val = (q) => (q.kind === 'N' ? q.saved[fl] : q.v[fl])
    let best = { v: 0, id: null }
    // (v4) "first": the round whose value reached the DEVICE first (a tie stays with it), then the driver's real
    // order of rounds (`seq`) - never the ids, which follow the clocks
    const reachAt = (q) => (q.reach?.[fl]?.v === val(q) ? q.reach[fl].at : Infinity)
    for (const q of live.sort((a, b) => reachAt(a) - reachAt(b) || a.seq - b.seq))
      if (val(q) > best.v) best = { v: val(q), id: q.id }
    const got = f ? f.f[fl] : { v: 0, id: null }
    if (got.v === best.v && got.id === best.id) continue
    if (unseenFR && (got.v > best.v || (got.id !== null && rounds.get(got.id)?.dead))) {
      r.unseenFullReset++
      continue
    }
    // the device ends on an older page's doc REBUILT by its Full Reset, and no new window wrote after it: only a
    // window holding the newest version could resolve it, and none was open (R5: lost to an older write)
    const lastDoc = [...ev].reverse().find((q) => q.why && q.why !== 'kill')
    if (lastDoc?.kind === 'O' && w.W.wins.find((y) => y.name === lastDoc.by)?.stLn === 'fresh') {
      r.noHolderAfterFullReset = (r.noHolderAfterFullReset ?? 0) + 1
      continue
    }
    // (v4) R10, precisely: an older page REBUILT by its own Full Reset (its doc carries no tag) keeps naming a
    // round it played since, after ANOTHER older page's later Full Reset killed it - a rebuilt doc cannot say
    // which Full Reset it followed (no clock may be asked)
    const G = got.id !== null ? rounds.get(got.id) : null
    // (the page's doc was a REBUILT one - its own Full Reset, or a reload of another's rebuilt doc - from a rebuild
    // EARLIER than the Full Reset that killed the round)
    if (
      G?.dead &&
      G.kind === 'O' &&
      G.killedBy &&
      G.killedBy.page !== G.page &&
      G.freshAt !== null &&
      G.freshAt !== undefined &&
      G.freshAt < G.killedBy.at
    ) {
      r.twoFullResets = (r.twoFullResets ?? 0) + 1
      continue
    }
    // (v4) THE ROUND-ID LEFTOVER, precisely: a Reset (or a Full Reset seen) can bound only by round ids, and a round
    // can sit on the wrong side of that bound for its real order - begun after it with an id below, or before
    // with an id above - only if (a) an older build numbered it (by the wall clock), or (b) a new window began it
    // before the Reset but could not save it until after (a full device), so the Reset's window never saw it
    // and its id came from a hybrid clock running ahead of the one that drew the bound
    const misSided = (q) =>
      !!q &&
      q.disk === undefined &&
      (w.W.resetLog ?? []).some(
        (L) => q.seq > L.seq !== q.id >= L.bound && (q.kind === 'O' || !(q.savedSeq <= L.seq)),
      )
    // (part2-issues #5) a v2.26.0 COUNTER round: never compared with a Reset's bound, only killed by the rounds
    // the resetting window knew - so one begun before a Reset whose window never saw it stands; and two loads
    // with no new write between them number their rounds alike (their ids alias)
    if ([got.id, best.id].some((id) => id !== null && w.W.aliases?.has(id))) {
      r.counterIdReuse = (r.counterIdReuse ?? 0) + 1
      continue
    }
    if (G?.disk !== undefined && G.dead) {
      r.counterIdUnseen = (r.counterIdUnseen ?? 0) + 1
      continue
    }
    if (misSided(G) || misSided(best.id !== null ? rounds.get(best.id) : null)) {
      r.idOrder = (r.idOrder ?? 0) + 1
      continue
    }
    if (got.id !== null && rounds.get(got.id)?.dead) {
      r.deadHolder++
      if (process.env.WHY)
        console.log('BAD dead holder', fl, JSON.stringify(got), 'truth', JSON.stringify(best))
      continue
    }
    // classes: an older page's round whose literal reached the device only in a stretch no new window saw;
    // a second older page's stale literal (it never saw the first page's round) read as a take-back
    const olds = new Set([...rounds.values()].filter((q) => q.kind === 'O').map((q) => q.page))
    // (R12: with two older pages, one's stale literal reads as a take-back of the other's round, and that
    // round's page can put it back through writeKept - either the expected or the shown holder is an older round)
    if (
      olds.size > 1 &&
      ((best.id !== null && rounds.get(best.id).kind === 'O') ||
        (got.id !== null && rounds.get(got.id)?.kind === 'O'))
    ) {
      r.staleSecondPage++
      continue
    }
    if (got.v !== best.v) {
      r.wrongValue++
      if (process.env.WHY)
        console.log('BAD value', fl, JSON.stringify(got), 'truth', JSON.stringify(best))
    } else {
      r.wrongHolder++
      if (process.env.WHY)
        console.log('BAD holder', fl, JSON.stringify(got), 'truth', JSON.stringify(best))
    }
  }
  for (const y of w.W.wins)
    if (y.kind === 'N' && !y.closed && w.fpRec(y.mem()) !== w.fpRec(f)) r.diverged++
  // (v5) G13: a field's COMPANION is its holder's - one of the values that round's other field ever had -
  // or unknown (null); never another round's
  if (f)
    for (const fl of FIELDS) {
      const e = f.f[fl]
      if (e.id === null || e.c === undefined || e.c === null) {
        if (e.id !== null && e.c === null) r.companionUnknown = (r.companionUnknown ?? 0) + 1
        continue
      }
      const Rr = rounds.get(e.id)
      const ok =
        !!Rr && [...(Rr.vals ?? []), Rr.v, Rr.saved ?? Rr.v].some((v) => v && v[OTHER[fl]] === e.c)
      if (!ok) {
        r.wrongCompanion = (r.wrongCompanion ?? 0) + 1
        if (process.env.WHY) console.log('BAD companion', fl, JSON.stringify(e))
      }
    }
  r.bad = r.wrongValue + r.wrongHolder + r.deadHolder + r.diverged + (r.wrongCompanion ?? 0)
  return r
}
export function run(seed, cfg, steps = 300) {
  const R = rng(seed)
  const w = makeWorld(cfg.opt ?? {})
  const pick = (a) => a[Math.floor(R() * a.length)]
  const val = () => Math.floor(R() * 8)
  const news = [w.newWin('n0'), w.newWin('n1')]
  let n = 2
  const olds = []
  for (let i = 0; i < (cfg.olds ?? 1); i++) olds.push(w.oldWin('old' + i))
  for (let i = 0; i < steps; i++) {
    const live = news.filter((y) => !y.closed)
    const awake = live.filter((y) => !y.frozen)
    const x = R()
    if (x < 0.22 && awake.length) w.round(pick(awake), val(), val())
    else if (x < 0.3 && awake.length) w.override(pick(awake), val(), val())
    else if (x < 0.32 && awake.length && cfg.resets) w.reset(pick(awake))
    else if (x < 0.5 && olds.length) w.round(pick(olds), val(), val())
    else if (x < 0.6 && olds.length) w.override(pick(olds), val(), val())
    else if (x < 0.65 && olds.length) w.oldKept(pick(olds))
    else if (x < 0.69 && olds.length) w.oldSave(pick(olds))
    else if (x < 0.72 && olds.length) w.reloadOld(pick(olds))
    else if (x < 0.735 && olds.length && cfg.fullReset) w.oldFullReset(pick(olds))
    else if (x < 0.8) {
      const c = live.filter((y) => !y.frozen)
      if (c.length > 1) w.freeze(pick(c))
    } else if (x < 0.88) {
      const f = live.filter((y) => y.frozen)
      if (f.length) w.resume(pick(f))
    } else if (x < 0.91) {
      if (live.length > 1) {
        const y = pick(live)
        y.closed = true
      }
    } else if (x < 0.95) {
      if (live.length < 4) news.push(w.newWin('n' + n++))
    } else if (x < 0.98 && cfg.full) {
      const y = pick(live)
      w.setFull(y, !y.full)
    }
    // (v4, V3-F3) the device clock set back or forward - by a little or by a lot
    else if (x < 0.995 && cfg.clock) w.jumpClock(pick([-3, -40, -400, 3, 40, 400]))
    w.deliverAll()
  }
  for (const y of news) {
    if (y.closed) continue
    w.setFull(y, false)
    y.frozen = false
    y.missed = true
  }
  for (let i = 0; i < 3; i++) w.deliverAll()
  if (cfg.dump) cfg.dump(w)
  const j = judge5(w)
  j.runnerUpsDropped = w.W.xPruned ?? 0 // (reach: the compact form's runner-up rule acted)
  j.resetKept = w.W.resetKept ?? 0 // (reach: a held Reset left waiting by a newer version that added no play)
  return j
}
const base = { full: true, clock: true }
export const cfgs = [
  [
    '1 old page: rounds, take-backs (Overrides down and up), writeKept, saves, reloads',
    { ...base, olds: 1 },
  ],
  ['  + new-window Resets', { ...base, olds: 1, resets: true }],
  [
    '  + Full Reset under Stats Only (the middle state, then the removal)',
    { ...base, olds: 1, resets: true, fullReset: true },
  ],
  ['2 old pages, all of the above', { ...base, olds: 2, resets: true, fullReset: true }],
  // (the app's form: the record's tag names its own values)
  [
    '1 old page that SPREADS a changed record (v2.26.0), the self-verifying tag, all of the above',
    { ...base, olds: 1, resets: true, fullReset: true, opt: { spreadOld: true, selfTag: true } },
  ],
  [
    '2 old pages, one of each kind, the self-verifying tag, all of the above',
    { ...base, olds: 2, resets: true, fullReset: true, opt: { spreadOld: 'one', selfTag: true } },
  ],
  // (v2.26.0 whole: it spreads, and it numbers its rounds with a counter from 1 per load - part2-issues #5)
  [
    '1 v2.26.0 page (spreads, counts its rounds from 1), the self-verifying tag, all of the above',
    {
      ...base,
      olds: 1,
      resets: true,
      fullReset: true,
      opt: { spreadOld: true, counterIds: true, selfTag: true },
    },
  ],
  [
    'a v2.26.0 page and a v2.29.0 page, the self-verifying tag, all of the above',
    {
      ...base,
      olds: 2,
      resets: true,
      fullReset: true,
      opt: { spreadOld: 'one', counterIds: 'one', selfTag: true },
    },
  ],
]
// The judge's own test: a rule turned off, and the spreading page with the model's bare tag, must be caught.
export const ablations = [
  [
    'WITHOUT the take-back rule (V2-F3 as v2 had it), 1 old page',
    { ...base, olds: 1, opt: { without: { takeBack: true } } },
  ],
  [
    'WITHOUT runner-ups (take-back lands on the old literal only), 1 old page',
    { ...base, olds: 1, resets: true, opt: { without: { alts: true } } },
  ],
  [
    '1 old page that SPREADS a changed record, the model’s BARE tag (part2-issues #1)',
    { ...base, olds: 1, resets: true, fullReset: true, opt: { spreadOld: true } },
  ],
  // (v5, the review lane's (c)) a spreading page keeps the old holder's companion beside a new holder: with
  // no holder id written beside each companion (the v4 form), a reader shows another round's number
  [
    '1 old page that SPREADS a changed record, WITHOUT the holder id beside each companion (the v4 form)',
    {
      ...base,
      olds: 1,
      resets: true,
      fullReset: true,
      opt: { spreadOld: true, selfTag: true, cid: false },
    },
  ],
]
