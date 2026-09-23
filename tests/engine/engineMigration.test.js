// tests/engine/engineMigration.test.js — old parked rounds still load (round 23 Q6, spec §9).
//
// store/sessionRound parks WHOLE engine states in sessionStorage, and a reload keeps them, so the
// first build with the per-card Override record will meet states written by the two builds before
// it: v2.25.0 (a one-override-per-question engine — `overrideUsed` entries, `capsule` rollback
// snapshots, no undo slot at all) and 44dd83f/HEAD (the same, plus a whole-state `undoCapsule`).
// The blobs below are HAND-BUILT in those exact shapes — field for field what those reducers wrote —
// rather than produced by today's reducer, which can no longer produce them. Each must come back as
// a healthy state (no invariant fires), with its score untouched, and with every card toggleable.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateEngineState, restoreParkedEngine } from '../../src/engine/engineMigration.js'
import { captureError } from '../../src/observability/sentry.js'

vi.mock('../../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
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
  expect(a.stats).toEqual(s.stats) // the times too, in order — each goes back into its own slot
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

// ── Show Codes survives the migration as a two-state fact (second review round, F2) ────────────────
// An old build's crediting Override that HELD on the live card left the card's as-answered
// `calcPenaltyActive` (Show Codes was opened on it) standing on the state. The migration used to
// write `false` into the stored as-answered flags while leaving the state's own `true` in place — so
// the first Undo put back `false`, and the "codes were shown" fact was gone for good: three states,
// not two. The fact belongs to state A, and state O takes today's overridden shape.
describe('migrateEngineState — the as-answered Show Codes flag round-trips', () => {
  const heldCodesCredit = () => ({
    ...baseTop,
    gridEpoch: 0,
    questionId: 0,
    date: D1,
    persistBtns: b([c(D1), 'correct']),
    stats: { played: 1, good: 1, streak: 1, best: 1, times: [] },
    stack: [],
    forwardStack: [],
    backDepth: 0,
    locked: true,
    revealed: false,
    countedWrong: false,
    canOverrideCorrect: true,
    pendingWrongOverride: null,
    overrideUsedThisQ: true,
    calcOpen: false,
    calcPenaltyActive: true,
    browseHasCredit: false,
    prevStatsSnapshot: null,
    wrongTime: 1.5,
    saveStatsThisQ: true,
    liveSolveTime: null,
  })
  const flags = (s) => [s.locked, s.revealed, s.countedWrong, s.calcPenaltyActive]
  const O_CREDIT_FLAGS = [true, false, false, false] // today's overridden-credit shape
  const A_CODES_FLAGS = [true, true, true, true] // a Show-Codes miss, the answer shown

  it('on screen: Override and Undo alternate between exactly two sets of flags', () => {
    let s = migrateEngineState(heldCodesCredit(), false)
    expect(checkGameInvariants(s, false)).toEqual([])
    expect(flags(s)).toEqual(O_CREDIT_FLAGS)
    for (let i = 0; i < 3; i++) {
      s = gameReducer(s, { ...OV, hold: true }) // Undo
      expect(flags(s)).toEqual(A_CODES_FLAGS)
      expect(s.stats.good).toBe(0)
      expect(checkGameInvariants(s, false)).toEqual([])
      s = gameReducer(s, { ...OV, hold: true }) // Override
      expect(flags(s)).toEqual(O_CREDIT_FLAGS)
      expect(s.stats.good).toBe(1)
      expect(checkGameInvariants(s, false)).toEqual([])
    }
  })

  it('parked while browsing: the same card, carried in the isLive entry, comes back the same way', () => {
    // Browsing card 1 (a 1.0s first-try correct); the live card above is parked as the isLive entry.
    const live = heldCodesCredit()
    const blob = {
      ...live,
      date: D2,
      persistBtns: b([c(D2), 'correct']),
      stats: { played: 2, good: 2, streak: 2, best: 2, times: [1.0] },
      forwardStack: [
        {
          isLive: true,
          ...D1,
          btns: live.persistBtns,
          overrideUsed: true,
          capsule: { snapshot: null, wrongTime: 1.5 },
          liveState: {
            locked: true,
            revealed: false,
            countedWrong: false,
            calcPenaltyActive: true,
            canOverrideCorrect: true,
            pendingWrongOverride: null,
            saveStatsFrozen: true,
          },
          hasCredit: true,
          solveTime: null,
        },
      ],
      backDepth: 1,
      overrideUsedThisQ: false,
      calcPenaltyActive: false,
      browseHasCredit: true,
      liveSolveTime: 1.0,
      wrongTime: null,
    }
    let s = migrateEngineState(blob, false)
    expect(checkGameInvariants(s, false)).toEqual([])
    const ls = s.forwardStack[0].liveState
    expect([ls.locked, ls.revealed, ls.countedWrong, ls.calcPenaltyActive]).toEqual(O_CREDIT_FLAGS)
    s = gameReducer(s, { type: 'FORWARD', useJulian: false })
    expect(flags(s)).toEqual(O_CREDIT_FLAGS)
    s = gameReducer(s, { ...OV, hold: true }) // Undo
    expect(flags(s)).toEqual(A_CODES_FLAGS)
    s = gameReducer(s, { ...OV, hold: true }) // Override
    expect(flags(s)).toEqual(O_CREDIT_FLAGS)
    expect(checkGameInvariants(s, false)).toEqual([])
  })
})

// ── The restore door (second review round, F3) ─────────────────────────────────────────────────────
// A blob this build cannot read must come back as "nothing parked" and be reported — never throw,
// because the throw lands in a mode screen's mount and the blob outlives the reload.
describe('restoreParkedEngine — the one door a parked blob comes through', () => {
  beforeEach(() => vi.mocked(captureError).mockClear())

  it('a readable blob, of any build, comes back migrated', () => {
    expect(restoreParkedEngine(v2250(), false, 'blitz')).toEqual(migrateEngineState(v2250(), false))
    const current = migrateEngineState(v2250(), false)
    expect(restoreParkedEngine(current, false, 'blitz')).toEqual(current)
    expect(captureError).not.toHaveBeenCalled()
  })

  const UNREADABLE = [
    ['nothing', () => undefined],
    ['a string', () => 'round'],
    ['no date', () => ({ ...v2250(), date: undefined })],
    ['no history', () => ({ ...v2250(), stack: undefined })],
    ['a forward stack that is not a list', () => ({ ...v2250(), forwardStack: {} })],
    ['a history entry that is not a card', () => ({ ...v2250(), stack: [null] })],
    ['no grid', () => ({ ...v2250(), persistBtns: null })],
    ['no stats', () => ({ ...v2250(), stats: undefined })],
    ['no times', () => ({ ...v2250(), stats: { ...v2250().stats, times: 3 } })],
    // Past the shape check, inside the migration: an overridden Deduction entry with no answer boxes.
    [
      'an entry the migration cannot read',
      () => ({ ...v2250(), stack: [{ type: 'month', overrideUsed: true }] }),
    ],
  ]
  it.each(UNREADABLE)('%s: null, and one report saying why', (_, make) => {
    expect(restoreParkedEngine(make(), false, 'aox')).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({
      where: 'restore-parked-round',
      mode: 'aox',
    })
  })
})

// ── An older build's pool comes back in play order (second review round, F4) ──────────────────────
// Today's engine keeps stats.times as the cards' times in play order — "Last" reads its end. An older
// build appended an Override's time wherever it happened (a browsed Path-1 credit went on the END,
// behind newer cards), so its pool can hold the right times in the wrong order.
describe('migrateEngineState — the times pool is re-laid in play order', () => {
  it('a pool an old Override left out of order comes back in the cards’ order, the mean unmoved', () => {
    const blob = { ...v2250(), stats: { ...v2250().stats, times: [0.9, 1.5] } }
    const s = migrateEngineState(blob, false)
    expect(s.stats.times).toEqual([1.5, 0.9]) // card 1's, then card 3's
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('a pool the cards do not account for is left exactly as it came, for the tripwire to report', () => {
    const blob = { ...v2250(), stats: { ...v2250().stats, times: [0.9, 7] } } // no 1.5 anywhere
    const s = migrateEngineState(blob, false)
    expect(s.stats.times).toEqual([0.9, 7])
    expect(checkGameInvariants(s, false).join(' | ')).toContain('times ledger')
  })
})

// ── A live card an old build's clock timed out on comes back recorded as timed out (F5) ──────────
describe('migrateEngineState — a timed-out live card is recorded as one', () => {
  // v2.25.0, Blitz Per Question: card 1 answered right, card 2 left untouched until its clock ran out.
  const timedOutRound = () => ({
    ...baseTop,
    date: D2,
    questionId: 1,
    persistBtns: b([c(D2), 'correct']),
    stats: { played: 2, good: 1, streak: 0, best: 1, times: [1.2] },
    stack: [
      {
        ...D1,
        btns: b([c(D1), 'correct']),
        overrideUsed: false,
        capsule: { snapshot: snap({ contributedTime: 1.2 }), wrongTime: null },
        hasCredit: true,
        solveTime: 1.2,
      },
    ],
    forwardStack: [],
    backDepth: 0,
    locked: true,
    revealed: true,
    countedWrong: false,
    canOverrideCorrect: false,
    pendingWrongOverride: null,
    overrideUsedThisQ: false,
    prevStatsSnapshot: snap({ played: 1, good: 1, streak: 1, best: 1 }),
    wrongTime: null,
    saveStatsThisQ: true,
    liveSolveTime: null,
  })

  it('on screen: the record says so, and the button still means the card before it', () => {
    const s = migrateEngineState(timedOutRound(), false)
    expect(s.card).toEqual({ wrongTime: null, answered: null, timedOut: true })
    expect(overridePlan(s).target).toBe('retro')
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('parked while browsing: the isLive entry carries the same record', () => {
    const s = migrateEngineState(timedOutRound(), false)
    const parked = gameReducer(s, { type: 'BACK' })
    expect(parked.forwardStack[0].meta.timedOut).toBe(true)
    // …and a blob parked in exactly that shape by the old build migrates to the same thing.
    const { card: _c, ...raw } = parked
    const { meta: _m, ...entry } = parked.forwardStack[0]
    const old = {
      ...raw,
      overrideUsedThisQ: false,
      wrongTime: null,
      forwardStack: [{ ...entry, overrideUsed: false }],
    }
    const m = migrateEngineState(old, false)
    expect(m.forwardStack[0].meta).toEqual({ wrongTime: null, answered: null, timedOut: true })
    expect(checkGameInvariants(m, false)).toEqual([])
  })
})
