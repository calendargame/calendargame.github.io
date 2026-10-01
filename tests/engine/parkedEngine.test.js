// parkedEngine — THE RESTORE DOOR (engine/parkedEngine's restoreParkedEngine): every parked engine
// state — an ended Blitz round / MoX run (store/sessionRound) and a casual mode's history
// (store/sessionHistory, through engine/parkedHistory) — comes back through it or not at all.
//
// A blob this build cannot read must come back as "nothing parked" and be REPORTED — never throw,
// because the throw lands in a mode screen's mount and the blob outlives the reload: unguarded, a
// mode screen was bricked until the tab was closed. The door has two layers, both pinned here: the
// shape check (the fields the invariant walk and the first render need before they can be asked) and
// the engine's own invariants, run inside a catch.
//
// ⚠ There is no migration to test. The slots this build reads (`cg-round-v2`, `cg-history-v1`) have
// only ever been written in today's engine shape; an older build's shape is refused like any other
// blob that is not a healthy engine state.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { restoreParkedEngine } from '../../src/engine/parkedEngine.js'
import { captureError } from '../../src/observability/sentry.js'
vi.mock('../../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
import { gameReducer, initEngine, correctIndexOf } from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'

const d = (y, m, dd) => ({ y, m, d: dd, _fmt: 'numeric-ymd', _jul: false })
const DATES = [d(2024, 1, 1), d(2024, 2, 2), d(2024, 3, 3), d(2024, 4, 4), d(2024, 5, 5)]

// A reachable state with everything in it: a clean credit, a wrong-then-right, a revealed miss that
// was then overridden to a credit, and a browsed-back position.
function played() {
  let s = initEngine(DATES[0])
  const act = (a) => (s = gameReducer(s, { useJulian: false, saveStats: true, ...a }))
  const answer = (idx, elapsed, nextDate) =>
    act({ type: 'ANSWER', idx, elapsed, tracking: true, nextDate })
  answer(correctIndexOf(s.date, false), 1.5, DATES[1])
  answer((correctIndexOf(s.date, false) + 1) % 7, 0.4, DATES[2])
  answer(correctIndexOf(s.date, false), 0.9, DATES[2])
  act({ type: 'REVEAL', elapsed: 2 })
  act({ type: 'OVERRIDE', tracking: true, nextDate: DATES[3] })
  act({ type: 'BACK' })
  return s
}
// What sessionStorage hands back: the state after a JSON round trip.
const parked = (s = played()) => JSON.parse(JSON.stringify(s))

beforeEach(() => vi.mocked(captureError).mockClear())

describe('restoreParkedEngine — the one door a parked blob comes through', () => {
  it('a healthy parked state comes back exactly, and nothing is reported', () => {
    const s = played()
    expect(checkGameInvariants(s, false)).toEqual([]) // the fixture is a state play reaches
    expect(restoreParkedEngine(parked(s), false, 'blitz')).toEqual(parked(s))
    expect(captureError).not.toHaveBeenCalled()
  })

  const UNREADABLE = [
    ['nothing', () => undefined],
    ['a string', () => 'round'],
    ['no date', () => ({ ...parked(), date: undefined })],
    ['no history', () => ({ ...parked(), stack: undefined })],
    ['a forward stack that is not a list', () => ({ ...parked(), forwardStack: {} })],
    ['a history entry that is not a card', () => ({ ...parked(), stack: [null] })],
    [
      'a history entry with no Override record',
      () => ({ ...parked(), stack: parked().stack.map(({ meta: _m, ...e }) => e) }),
    ],
    ['no Override record on the card on screen', () => ({ ...parked(), card: undefined })],
    ['no grid', () => ({ ...parked(), persistBtns: null })],
    ['no stats', () => ({ ...parked(), stats: undefined })],
    ['no times', () => ({ ...parked(), stats: { ...parked().stats, times: 3 } })],
    // Past the shape check, inside the invariant walk.
    [
      'a history entry that is not a question',
      () => ({
        ...parked(),
        stack: [{ type: 'month', meta: { wrongTime: null, answered: null } }],
      }),
    ],
    ['a score no play reaches', () => ({ ...parked(), stats: { ...parked().stats, good: 99 } })],
    ['a card ledger that does not add up', () => ({ ...parked(), historyBase: 7 })],
    [
      'a times pool the cards do not name',
      () => ({ ...parked(), stats: { ...parked().stats, times: [9, 9] } }),
    ],
  ]
  it.each(UNREADABLE)('%s: null, and one report saying why', (_, make) => {
    expect(restoreParkedEngine(make(), false, 'aox')).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({
      where: 'restore-parked-engine',
      mode: 'aox',
    })
    expect(vi.mocked(captureError).mock.calls[0][1].reason).toEqual(expect.any(String))
  })

  it('an invariant break is reported with what broke', () => {
    restoreParkedEngine({ ...parked(), historyBase: 7 }, false, 'classic')
    const context = vi.mocked(captureError).mock.calls[0][1]
    expect(context.reason).toBe('breaks an engine invariant')
    expect(context.violations.length).toBeGreaterThan(0)
  })
})
