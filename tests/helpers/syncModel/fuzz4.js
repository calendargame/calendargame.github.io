// tests/helpers/syncModel/fuzz4.js — design-q2-model/fuzz4.mjs VERBATIM (its driver and its 22
// configurations), driving the world in which the REAL door plays every new window.
//
// The model's header: node fuzz4.mjs [seeds] [steps] [configs] - random search over model4.mjs (the v3 merge rule in the
// app's count form), judged by BOTH oracles: mine (judge) and reviewer A's original one (judgeA).
// Older pages Override their own cards at ANY depth, reload, rewrite at boot, remove the doc in two
// writes; new windows read the device one write at a time; the sync key can be refused while the doc
// lands (a full device at the first save); clocks jump by years; storage is cleared.
import { makeWorld, SILOS, REGS } from './world4.js'
import { judge, judgeA, crossCheck } from './judge4.js'
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
  const r = rng(seed)
  const w = makeWorld({
    lag: !!cfg.lag,
    prevRule: cfg.prevRule ?? true,
    wall0: cfg.bigClock ? 9_000_000_000_000 + Math.floor(r() * 1e9) : undefined,
    mut: cfg.mut ?? process.env.MUT ?? null,
    ...(cfg.opt ?? {}),
    ...(process.env.OPT ? JSON.parse(process.env.OPT) : {}),
  })
  const pick = (a) => a[Math.floor(r() * a.length)]
  if (cfg.onWorld) cfg.onWorld(w)
  const olds = []
  if (cfg.trace) {
    let seen = 0
    const show = () => {
      for (; seen < w.W.ev.length; seen++) {
        const e = w.W.ev[seen]
        console.log(
          '     ev',
          e.i,
          e.by,
          e.why,
          e.removed.length ? '-' + e.removed.join('.') : '',
          e.added.length ? '+' + e.added.join('.') : '',
          JSON.stringify(e.regs),
        )
      }
      const f = w.final()
      console.log(
        '       dev',
        SILOS.map(
          (x) =>
            x +
            '[' +
            f[x].pl +
            '/' +
            f[x].gd +
            ' s' +
            f[x].sk +
            ' b' +
            f[x].bs +
            (f[x].w ? '' : ' untagged') +
            '] ' +
            w.idsOf(f[x]).join('.'),
        ).join('  '),
        'R1=' + f.R1,
        'R2=' + f.R2,
      )
    }
    for (const fn of [
      'answer',
      'reset',
      'override',
      'setReg',
      'reloadOld',
      'oldRemoveDoc',
      'clearAll',
      'freeze',
      'resume',
      'close',
      'setFull',
      'setSideFull',
      'jumpClock',
      'newWin',
      'oldWin',
    ]) {
      const orig = w[fn]
      w[fn] = (...args) => {
        const res = orig(...args)
        console.log(
          '#' + fn,
          args
            .map((a) =>
              a && a.name
                ? a.name + (a.full ? '(full)' : '')
                : typeof a === 'number'
                  ? +a.toFixed(3)
                  : a,
            )
            .join(' '),
          res !== undefined && typeof res !== 'object' ? '-> ' + res : '',
        )
        show()
        return res
      }
    }
    const od = w.deliver
    w.deliver = (y) => {
      const n0 = w.W.ev.length
      od(y)
      if (w.W.ev.length > n0) {
        console.log('  (deliver ' + y.name + ')')
        show()
      }
    }
  }
  if (cfg.preEra) {
    for (let i = 0; i < (cfg.olds ?? 1); i++) olds.push(w.oldWin('pre' + i))
    for (let i = 0; i < 12; i++) {
      const o = pick(olds)
      const x = r()
      if (x < 0.55) w.answer(o, pick(SILOS), r())
      else if (x < 0.65) w.override(o, pick(SILOS), Math.floor(r() * 4))
      else if (x < 0.72) w.reset(o, pick(SILOS))
      else if (x < 0.86) w.setReg(o, pick(REGS))
      else w.reloadOld(o)
    }
  }
  let n = 0
  const news = [w.newWin('n' + n++), w.newWin('n' + n++)]
  const anchor = cfg.anchor ? news[0] : null
  if (cfg.sideFullFirst) w.setSideFull(news[0], true) // the sync key refused at the very first save
  if (!cfg.preEra) for (let i = 0; i < (cfg.olds ?? 0); i++) olds.push(w.oldWin('old' + i))
  for (let i = 0; i < 6; i++)
    cfg.regsOnly ? w.setReg(pick(news), 'R1') : w.answer(pick(news), pick(SILOS), r())
  if (cfg.sideFullFirst) w.setSideFull(news[0], false)
  w.deliverAll()
  const ov = cfg.overrides ?? 0.03
  for (let i = 0; i < steps; i++) {
    const live = news.filter((y) => !y.closed)
    const awake = live.filter((y) => !y.frozen)
    const free = live.filter((y) => y !== anchor)
    const x = r()
    if (cfg.regsOnly && x < 0.41) {
      if (awake.length) w.setReg(pick(awake), pick(REGS))
    } else if (x < 0.32 && awake.length) w.answer(pick(awake), pick(SILOS), r())
    else if (x < 0.36 && awake.length) w.reset(pick(awake), pick(SILOS))
    else if (x < 0.42 && awake.length) w.setReg(pick(awake), pick(REGS))
    else if (cfg.regsOnly && x < 0.57) {
      if (olds.length) w.setReg(pick(olds), pick(REGS))
    } else if (x < 0.5 && olds.length) w.answer(pick(olds), pick(SILOS), r())
    else if (x < 0.5 + ov && olds.length) w.override(pick(olds), pick(SILOS), Math.floor(r() * 6))
    else if (x < 0.52 + ov && olds.length) w.reset(pick(olds), pick(SILOS))
    else if (x < 0.55 + ov && olds.length) w.setReg(pick(olds), pick(REGS))
    else if (x < 0.58 + ov && olds.length) {
      if (!cfg.noReload) w.reloadOld(pick(olds))
    } else if (x < 0.59 + ov && olds.length && cfg.remove) w.oldRemoveDoc(pick(olds))
    else if (x < 0.66 + ov) {
      const c = free.filter((y) => !y.frozen)
      if (c.length && awake.length > 1) w.freeze(pick(c))
    } else if (x < 0.74 + ov) {
      const f = live.filter((y) => y.frozen)
      if (f.length) w.resume(pick(f))
    } else if (x < 0.78 + ov) {
      if (free.length && live.length > 1) w.close(pick(free))
    } else if (x < 0.83 + ov) {
      if (live.length < 4) news.push(w.newWin('n' + n++))
    } else if (x < 0.87 + ov && cfg.full) {
      if (free.length) {
        const y = pick(free)
        w.setFull(y, !y.full)
      }
    } else if (x < 0.89 + ov && cfg.sideFull) {
      if (free.length) {
        const y = pick(free)
        w.setSideFull(y, !y.sideFull)
      }
    } else if (x < 0.92 + ov && cfg.clock)
      w.jumpClock(pick([-1e7, -5e9, 1e7, 5e9, -1, -3e11, 3e11]))
    else if (x < 0.935 + ov && cfg.clear) w.clearAll()
    if (cfg.lag) {
      for (const y of news) if (r() < 0.4) w.deliver(y)
    } else w.deliverAll()
  }
  for (const y of news) {
    if (y.closed) continue
    w.setFull(y, false)
    w.setSideFull(y, false)
    if (y.frozen) w.resume(y)
  }
  for (let i = 0; i < 3; i++)
    for (const y of news) {
      if (!y.closed) {
        y.frozen = false
        w.deliver(y)
      }
    }
  w.deliverAll()
  // the end: every open window's copy catches up with the device (a lagging copy moves one write per notice)
  for (let k = 0; k < 100000; k++) {
    const behind = news.filter((y) => !y.closed && y.pos < w.W.hist.length - 1)
    if (!behind.length) break
    for (const y of behind) w.deliver(y)
  }
  w.deliverAll()
  const j = judge(w, { anchor })
  const a = judgeA(w)
  j.A = a
  j.X = crossCheck(j, a, { lag: !!cfg.lag })
  j.dropped = w.W.dropped
  j.droppedAnswers = w.W.droppedAnswers
  j.inexact = w.W.inexact
  j.carried = w.W.carried
  j.overrides = w.W.overrides ?? 0
  j.mutFired = w.W.mutFired ?? 0
  j.mutLanded = w.W.mutLanded ?? 0
  j.resetKept = w.W.resetKept ?? 0
  j.envMismatch = w.W.envMismatch ?? 0
  Object.defineProperty(j, 'world', { value: w, enumerable: false })
  // LAG gates G4, G5 and G8 - and G5 is now judged at every write
  if (cfg.lag) j.bad = j.diverged + j.doubled + j.aggBad + j.writeDouble + j.writeOdd
  return j
}
const base = { full: true, clock: true }
export const cfgs = [
  ['new windows only', { ...base }],
  ['new only + storage cleared + clock 9e12 start', { ...base, clear: true, bigClock: true }],
  ['1 old page', { ...base, olds: 1 }],
  ['1 old page + always-awake new window', { ...base, olds: 1, anchor: true }],
  ['1 old page, never reloads', { ...base, olds: 1, noReload: true, clear: true, bigClock: true }],
  ['  same + always-awake', { ...base, olds: 1, noReload: true, anchor: true }],
  [
    '1 old page + doc removed (2 writes) + cleared + clock',
    { ...base, olds: 1, clear: true, remove: true, bigClock: true },
  ],
  [
    '  same + always-awake',
    { ...base, olds: 1, anchor: true, clear: true, remove: true, bigClock: true },
  ],
  ['OVERRIDES at depth (x5 rate), 1 old page', { ...base, olds: 1, overrides: 0.15 }],
  ['  same + always-awake', { ...base, olds: 1, overrides: 0.15, anchor: true }],
  ['SETTINGS (prev-value rule), 1 old page', { ...base, olds: 1, regsOnly: true, clear: true }],
  ['  same + always-awake', { ...base, olds: 1, regsOnly: true, anchor: true }],
  ['SETTINGS, 2 old pages', { ...base, olds: 2, regsOnly: true }],
  [
    'SYNC KEY refused at first save + later',
    { ...base, olds: 1, sideFullFirst: true, sideFull: true, remove: true },
  ],
  ['2 old pages', { ...base, olds: 2, clear: true, remove: true }],
  ['2 old pages + always-awake', { ...base, olds: 2, anchor: true }],
  ['ROLLOUT: 1 old page from before the update', { ...base, olds: 1, preEra: true }],
  ['ROLLOUT: 1 old page + always-awake', { ...base, olds: 1, preEra: true, anchor: true }],
  [
    'ROLLOUT: 2 old pages + cleared + removed',
    { ...base, olds: 2, preEra: true, clear: true, remove: true },
  ],
  ['ROLLOUT: 2 old pages + always-awake', { ...base, olds: 2, preEra: true, anchor: true }],
  ['LAG (one write at a time, stale acts), new only', { ...base, lag: true, clear: true }],
  [
    'LAG + 1 old page + removed + cleared',
    { ...base, lag: true, olds: 1, clear: true, remove: true },
  ],
]
const keys = [
  'envMismatch',
  'resetKept',
  'writeDouble',
  'writeOdd',
  'writePassDouble',
  'writeDoubleR6',
  'writeOddR6',
  'answers',
  'removedByNew',
  'resurrectedByNew',
  'regRevertedByNew',
  'diverged',
  'doubled',
  'holderFailed',
  'aggBad',
  'aggForced',
  'forcedSameBase',
  'forcedBootLike',
  'overrideSeenTogether',
  'unseenAfterReset',
  'oldLossReapplied',
  'oldResurrectionReapplied',
  'fullPartition',
  'unseenOldChange',
  'lostToOldWrite',
  'lostToOldConflict',
  'regOldCarryWins',
  'overrides',
  'carried',
  'dropped',
  'droppedAnswers',
  'inexact',
  'oldAnswers',
  'oldAnswersKept',
]
export { keys }
