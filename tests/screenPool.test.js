// @vitest-environment jsdom
//
// screenPool — THE ONE DOOR A MODE SCREEN WRITES THROUGH (store/screenPool), and the property it
// exists for: a write names the copy of the data its screen was drawn for, and lands only while that
// copy is the live one. Each of the three ways the live copy moves — a preset switch, an Amnesic
// change, a preset delete — is driven for real through store/presetControl, and every function of
// the door is then called with the copy that was live BEFORE the move (refused, nothing anywhere
// changes) and with the one live after it (written, as the raw setter would).
// (T-F1d of design-q6.md; tests/screenPool.gap.dom is the race the door closes, in the real app.)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createPreset,
  switchPreset,
  setPresetAmnesic,
  deletePreset,
} from '../src/store/presetControl.js'
import { usePresets } from '../src/store/presets.js'
import { useProgress } from '../src/store/progress.js'
import { activeDataId, activeBestsId } from '../src/store/amnesic.js'
import { readSessionRound, writeSessionRound } from '../src/store/sessionRound.js'
import {
  fileRoundResult,
  parkRound,
  unparkRound,
  saveModeStats,
  useScreenEpoch,
} from '../src/store/screenPool.js'
import { ROUND_ID } from './helpers/roundScreen.js'
import { readSessionHistory, writeSessionHistory } from '../src/store/sessionHistory.js'
import { useSwapEpoch } from '../src/lib/unaskedSwap.js'
import { captureError } from '../src/observability/sentry.js'
import { resetAppState } from './helpers/settingsPanel.jsx'

vi.mock('../src/observability/sentry.js', () => ({ captureError: vi.fn() }))

// A round's result, and the record it makes on its own
const ROUND = { score: 7, streak: 7 }
const REC = {
  score: 7,
  scoreStreak: 7,
  scoreRoundId: ROUND_ID(1),
  streak: 7,
  streakScore: 7,
  streakRoundId: ROUND_ID(1),
}
const STATS = { played: 3, good: 2, streak: 1, best: 2, times: [1.5, 2.25] }
const store = () => {
  const { stats, blitzBest, suddenBest, suddenAmBest, aoxBest } = useProgress.getState()
  return JSON.stringify({ stats, blitzBest, suddenBest, suddenAmBest, aoxBest })
}

// Each way the live copy moves, from a state where the copy that is live now can be named.
const MOVES = {
  'a preset switch': () => switchPreset(createPreset().id),
  'an Amnesic change': () => setPresetAmnesic(usePresets.getState().activeId, 'full'),
  'a preset delete': () => {
    const was = usePresets.getState().activeId
    createPreset()
    expect(deletePreset(was)).toBe(true)
  },
}

describe('store/screenPool — a screen writes only to the copy it was drawn for', () => {
  beforeEach(() => resetAppState())

  for (const [what, move] of Object.entries(MOVES)) {
    it(`after ${what}, every write named with the old copy is refused, and with the new one lands`, () => {
      const oldData = activeDataId()
      move()
      const newData = activeDataId()
      const newBests = activeBestsId()
      expect(newData, 'the live copy moved').not.toBe(oldData)
      const before = store()
      writeSessionRound(newBests, 'aox', { b: 2 })
      const parkedBefore = sessionStorage.getItem('cg-round-v2')

      for (const map of ['blitzBest', 'suddenBest', 'suddenAmBest'])
        expect(fileRoundResult(oldData, map, 'k', ROUND_ID(1), ROUND, false)).toBe(false)
      expect(fileRoundResult(oldData, 'aoxBest', 'k', ROUND_ID(1), { avg: 1, med: 1 }, false)).toBe(
        false,
      )
      saveModeStats(oldData, 'classic', useProgress.getState().stats.classic, STATS)
      parkRound(oldData, newBests, 'blitz', { c: 3 })
      unparkRound(oldData, newBests, 'aox')
      expect(store(), 'nothing in the store moved').toBe(before)
      expect(sessionStorage.getItem('cg-round-v2'), 'nothing parked or unparked').toBe(parkedBefore)

      expect(fileRoundResult(newData, 'blitzBest', 'k', ROUND_ID(1), ROUND, false)).toBe(true)
      expect(useProgress.getState().blitzBest.k).toEqual(REC)
      saveModeStats(newData, 'classic', useProgress.getState().stats.classic, STATS)
      expect(useProgress.getState().stats.classic).toEqual(STATS)
      parkRound(newData, newBests, 'blitz', { c: 3 })
      expect(readSessionRound(newBests, 'blitz')).toEqual({ c: 3 })
      unparkRound(newData, newBests, 'aox')
      expect(readSessionRound(newBests, 'aox')).toBe(null)
    })
  }

  it('a round a Reset has since removed files nothing: there is nothing left of it to change', () => {
    const id = activeDataId()
    expect(fileRoundResult(id, 'blitzBest', 'k', ROUND_ID(1), ROUND, false)).toBe(true)
    useProgress.getState().resetProgress() // (Full Reset)
    const before = store()
    // an Override of that round on the screen still showing it, and a take-back of it
    expect(fileRoundResult(id, 'blitzBest', 'k', ROUND_ID(1), { score: 9, streak: 9 }, true)).toBe(
      false,
    )
    expect(fileRoundResult(id, 'blitzBest', 'k', ROUND_ID(1), null, true)).toBe(false)
    expect(store()).toBe(before)
  })
})

// ★ THE SECOND CONDITION (design-q1-q2.md v4, 6.1; Q6's R5): a casual mirror writes only over the
// stats object it last read or wrote. Stats that moved under it — another window's answers merged in
// the gap between a commit and its effects — are never written over: the write is refused, that
// engine is rebuilt on them (its data epoch moves, its park goes first, the grids remount and guard
// the answers), and the refusal is reported once.
describe('store/screenPool — a stale mirror is refused, and its engine rebuilt', () => {
  beforeEach(() => resetAppState())

  it('a write over its own base lands, and the next one carries the new base', () => {
    const id = activeDataId()
    const base = useProgress.getState().stats.classic
    expect(saveModeStats(id, 'classic', base, STATS)).toBe(true)
    expect(useProgress.getState().stats.classic).toBe(STATS)
    const next = { ...STATS, played: 4 }
    expect(saveModeStats(id, 'classic', STATS, next)).toBe(true)
    expect(useProgress.getState().stats.classic).toBe(next)
  })

  it('a write over stats that moved is refused: nothing written, the engine rebuilt, reported once', () => {
    const id = activeDataId()
    const base = useProgress.getState().stats.flash
    const elsewhere = { ...STATS, played: 9, good: 9 }
    useProgress.getState().setModeStats('flash', elsewhere) // (another window's, merged in the gap)
    writeSessionHistory(id, 'flash', '{"parked":1}', true)
    const epochs = useScreenEpoch.getState()
    const swaps = useSwapEpoch.getState().epoch
    vi.mocked(captureError).mockClear()
    expect(saveModeStats(id, 'flash', base, STATS)).toBe(false)
    expect(useProgress.getState().stats.flash).toBe(elsewhere)
    expect(useScreenEpoch.getState()).toEqual({ ...epochs, flash: epochs.flash + 1 }) // that engine's alone
    expect(useSwapEpoch.getState().epoch).toBe(swaps + 1)
    expect(readSessionHistory(id, 'flash')).toBe(null)
    expect(saveModeStats(id, 'flash', base, STATS)).toBe(false)
    expect(vi.mocked(captureError).mock.calls.map(([, ctx]) => ctx.tripwire)).toEqual([
      'staleMirror',
    ])
  })
})
