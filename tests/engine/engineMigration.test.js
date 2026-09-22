// tests/engine/engineMigration.test.js — old parked rounds still load (round 23 Q6, spec §9).
//
// store/sessionRound parks WHOLE engine states in sessionStorage, and a reload keeps them, so the
// first build with the per-card Override record will meet states written by the two builds before
// it: v2.25.0 (a one-override-per-question engine — `overrideUsed` entries, `capsule` rollback
// snapshots, no undo slot at all) and 44dd83f/HEAD (the same, plus a whole-state `undoCapsule`).
// The blobs below are HAND-BUILT in those exact shapes — field for field what those reducers wrote —
// rather than produced by today's reducer, which can no longer produce them. Each must come back as
// a healthy state (no invariant fires), with its score untouched, and with every card toggleable.
import { describe, it, expect } from 'vitest'
import { migrateEngineState } from '../../src/engine/engineMigration.js'
import { gameReducer, overridePlan } from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { wday } from '../../src/lib/calendar.js'

const d = (y, m, dd) => ({ y, m, d: dd, _fmt: 'numeric-ymd', _jul: false })
const D1 = d(2024, 1, 1)
const D2 = d(2024, 2, 2)
const D3 = d(2024, 3, 3)
const D4 = d(2024, 4, 4)
const c = (q) => wday(q.y, q.m, q.d)
const w = (q) => (c(q) + 1) % 7
const b = (...pairs) => Object.fromEntries(pairs)
const snap = (o) => ({
  played: 0,
  good: 0,
  streak: 0,
  best: 0,
  timesLen: 0,
  wasWrong: false,
  contributedTime: null,
  ...o,
})
const baseTop = {
  gridEpoch: 1,
  calcOpen: false,
  calcPenaltyActive: false,
  browseHasCredit: false,
  bestFloor: 0,
  streakCarry: 0,
  historyBase: 0,
  timesBase: 0,
}

// ── v2.25.0: an ENDED Blitz round, Allow Mistakes off, the live card lost on a wrong ───────────────
// card 1 — first-try correct, 1.5s.  card 2 — first-try correct 2.0s, then retro-overridden AWAY
// (Path 5).  card 3 — wrong at 0.9s, then overridden to a credit (Path 3, advanced).  live card 4
// — a wrong answer that ended the round (LOCK_REVEAL after it).
const v2250 = () => ({
  ...baseTop,
  date: D4,
  questionId: 3,
  persistBtns: b([w(D4), 'wrong-prev'], [c(D4), 'correct']),
  stats: { played: 4, good: 2, streak: 0, best: 1, times: [1.5, 0.9] },
  stack: [
    {
      ...D1,
      btns: b([c(D1), 'correct']),
      overrideUsed: false,
      capsule: { snapshot: snap({ contributedTime: 1.5 }), wrongTime: null },
      hasCredit: true,
      solveTime: 1.5,
    },
    {
      ...D2,
      btns: b([c(D2), 'override-wrong']),
      overrideUsed: true,
      capsule: { snapshot: snap({ played: 1, good: 1, contributedTime: 2.0 }), wrongTime: null },
      hasCredit: false,
      solveTime: null,
    },
    {
      ...D3,
      btns: b([c(D3), 'correct']),
      overrideUsed: true,
      capsule: { snapshot: null, wrongTime: null },
      hasCredit: true,
      solveTime: 0.9,
    },
  ],
  forwardStack: [],
  backDepth: 0,
  locked: true,
  revealed: true,
  countedWrong: true,
  canOverrideCorrect: false,
  pendingWrongOverride: null,
  overrideUsedThisQ: false,
  prevStatsSnapshot: snap({ played: 3, good: 2, streak: 1, best: 1, wasWrong: true }),
  wrongTime: 0.4,
  saveStatsThisQ: true,
  liveSolveTime: null,
})

// ── 44dd83f/HEAD: a FAILED MoX run (Mo2), its held completing solve overridden away (Path 2,
// noAdvance), with that Override's whole-state undo capsule still pending ───────────────────────────
const headFailedRun = () => {
  const card1 = {
    ...D1,
    btns: b([c(D1), 'correct']),
    overrideUsed: false,
    capsule: { snapshot: snap({ contributedTime: 1.0 }), wrongTime: null },
    hasCredit: true,
    solveTime: 1.0,
  }
  const before = {
    ...baseTop,
    gridEpoch: 0,
    date: D2,
    questionId: 1,
    persistBtns: b([c(D2), 'correct']),
    stats: { played: 2, good: 2, streak: 2, best: 2, times: [1.0, 1.7] },
    stack: [card1],
    forwardStack: [],
    backDepth: 0,
    locked: true,
    revealed: false,
    countedWrong: false,
    canOverrideCorrect: true,
    pendingWrongOverride: null,
    overrideUsedThisQ: false,
    prevStatsSnapshot: snap({ played: 1, good: 1, streak: 1, best: 1, contributedTime: 1.7 }),
    wrongTime: null,
    saveStatsThisQ: true,
    liveSolveTime: 1.7,
  }
  return {
    ...before,
    persistBtns: b([c(D2), 'override-wrong']),
    stats: { played: 2, good: 1, streak: 0, best: 1, times: [1.0] },
    locked: false,
    countedWrong: true,
    canOverrideCorrect: false,
    overrideUsedThisQ: true,
    prevStatsSnapshot: null,
    liveSolveTime: null,
    undoCapsule: before,
  }
}

// ── 44dd83f/HEAD: an ended Blitz round being BROWSED — the browsed card credited by a Path-1
// Override (capsule pending), the live card (a per-round clock timeout) parked as the isLive entry ──
const headBrowsing = () => ({
  ...baseTop,
  date: D1,
  questionId: 1,
  persistBtns: b([c(D1), 'correct']),
  stats: { played: 1, good: 1, streak: 1, best: 1, times: [0.6] },
  stack: [],
  forwardStack: [
    {
      isLive: true,
      ...D2,
      btns: b([c(D2), 'correct']),
      overrideUsed: false,
      capsule: { snapshot: null, wrongTime: null },
      liveState: {
        locked: true,
        revealed: true,
        countedWrong: false,
        canOverrideCorrect: false,
        pendingWrongOverride: { wrongTime: 0.6 },
        calcPenaltyActive: false,
        saveStatsFrozen: null,
      },
      hasCredit: true,
      solveTime: null,
    },
  ],
  backDepth: 1,
  locked: true,
  revealed: true,
  countedWrong: false,
  canOverrideCorrect: false,
  pendingWrongOverride: null,
  overrideUsedThisQ: true,
  prevStatsSnapshot: null,
  wrongTime: null,
  saveStatsThisQ: true,
  browseHasCredit: true,
  liveSolveTime: 0.6,
  undoCapsule: { note: 'a whole prior GameState — dropped wholesale, never read' },
})

const OV = { type: 'OVERRIDE', useJulian: false, tracking: true, nextDate: D4 }
const sorted = (a) => [...a].sort((x, y) => x - y)

// Toggle whatever the button points at twice: the state must stay healthy through both presses, the
// first must move `good` by exactly one, and the second must put every counter back.
function expectToggleable(s) {
  const plan = overridePlan(s)
  expect(plan).not.toBe(null)
  const o = gameReducer(s, { ...OV, hold: true })
  expect(checkGameInvariants(o, false)).toEqual([])
  expect(o.stats.good).toBe(s.stats.good + (plan.credits ? 1 : -1))
  const a = gameReducer(o, OV)
  expect(checkGameInvariants(a, false)).toEqual([])
  expect({ ...a.stats, times: sorted(a.stats.times) }).toEqual({
    ...s.stats,
    times: sorted(s.stats.times),
  })
}
// Walk every card: toggle it where it stands, then step back to the next one.
function expectEveryCardToggleable(s) {
  let cur = s
  while (cur.forwardStack.length) cur = gameReducer(cur, { type: 'FORWARD', useJulian: false })
  for (;;) {
    expectToggleable(cur)
    if (!cur.stack.length) break
    cur = gameReducer(cur, { type: 'BACK' })
  }
}

describe('migrateEngineState — every legacy shape comes back healthy, scored and toggleable', () => {
  const CASES = [
    ['v2.25.0 — an ended Blitz round with overridden history', v2250],
    ['44dd83f — a failed MoX run with an undo capsule pending', headFailedRun],
    ['44dd83f — an ended round mid-browse, a Path-1 credit pending undo', headBrowsing],
  ]

  it.each(CASES)('%s: no invariant fires, and the score is untouched', (_, make) => {
    const blob = make()
    const s = migrateEngineState(blob, false)
    expect(checkGameInvariants(s, false)).toEqual([])
    expect(s.stats).toEqual(blob.stats)
    expect(s.historyBase).toBe(blob.historyBase)
    expect(s.backDepth).toBe(blob.backDepth)
  })

  it.each(CASES)('%s: every legacy field is gone', (_, make) => {
    const s = migrateEngineState(make(), false)
    const legacy = [
      'undoCapsule',
      'canOverrideCorrect',
      'pendingWrongOverride',
      'prevStatsSnapshot',
      'overrideUsedThisQ',
      'wrongTime',
    ]
    for (const k of legacy) expect(k in s).toBe(false)
    for (const e of [...s.stack, ...s.forwardStack]) {
      expect('overrideUsed' in e).toBe(false)
      expect('capsule' in e).toBe(false)
      if (e.liveState) {
        expect('canOverrideCorrect' in e.liveState).toBe(false)
        expect('pendingWrongOverride' in e.liveState).toBe(false)
      }
    }
  })

  it.each(CASES)('%s: every card can be toggled, both ways', (_, make) => {
    expectEveryCardToggleable(migrateEngineState(make(), false))
  })

  it.each(CASES)('%s: migrating twice is migrating once', (_, make) => {
    const once = migrateEngineState(make(), false)
    expect(migrateEngineState(once, false)).toEqual(once)
  })

  it('an un-overridden card keeps its reds and its first wrong time — exactly', () => {
    const blob = v2250()
    blob.stack[0] = {
      ...D1,
      btns: b([w(D1), 'wrong-prev'], [c(D1), 'correct']),
      overrideUsed: false,
      capsule: { snapshot: snap({ wasWrong: true }), wrongTime: 0.8 },
      hasCredit: false,
      solveTime: null,
    }
    blob.stats = { played: 4, good: 1, streak: 0, best: 1, times: [0.9] }
    const s = migrateEngineState(blob, false)
    expect(s.stack[0].btns).toEqual(blob.stack[0].btns)
    expect(s.stack[0].meta).toEqual({ wrongTime: 0.8, answered: null })
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('an overridden card comes back overridden (reads Undo), its as-answered credit and time intact', () => {
    const s = migrateEngineState(v2250(), false)
    // card 2: overridden AWAY from a 2.0s first-try correct — Undo gives the 2.0s back.
    expect(s.stack[1].meta.answered).toEqual({
      btns: b([c(D2), 'correct']),
      hasCredit: true,
      solveTime: 2.0,
    })
    // card 3: overridden TO a credit. ⚠ Its original reds were destroyed by the old engine and
    // cannot be recovered — it comes back with the answer shown instead (the honest limit).
    expect(s.stack[2].meta.answered).toEqual({
      btns: b([c(D3), 'correct']),
      hasCredit: false,
      solveTime: null,
    })
    expect(s.stack[2].meta.oTime).toBe(0.9)
  })

  it('the live card an old Override left in place is normalised to today’s overridden shape', () => {
    const s = migrateEngineState(headFailedRun(), false)
    expect(s.card.answered).toEqual({
      btns: b([c(D2), 'correct']),
      hasCredit: true,
      solveTime: null, // the old reversal nulled the snapshot that held it — not recoverable
      live: { locked: true, revealed: false, countedWrong: false, calcPenaltyActive: false },
    })
    expect([s.locked, s.revealed, s.countedWrong]).toEqual([true, true, true])
    expect(overridePlan(s)).toEqual({ target: 'live', overridden: true, credits: true }) // reads Undo
  })

  it('an old Path-5 press left its fresh live card flagged "used" — that card is NOT overridden', () => {
    const blob = v2250()
    Object.assign(blob, {
      date: D4,
      persistBtns: {},
      locked: false,
      revealed: false,
      countedWrong: false,
      overrideUsedThisQ: true, // what Path 5 left on the FRESH live card
      saveStatsThisQ: null,
      prevStatsSnapshot: null,
      wrongTime: null,
      stats: { played: 3, good: 2, streak: 1, best: 1, times: [1.5, 0.9] },
    })
    const s = migrateEngineState(blob, false)
    expect(s.card).toEqual({ wrongTime: null, answered: null })
    expect(overridePlan(s).target).toBe('retro')
    expect(checkGameInvariants(s, false)).toEqual([])
  })
})
