// @vitest-environment jsdom
// windowSync.progress — THE SAVED PROGRESS IN TWO WINDOWS (design-q1-q2.md v4: 2, 4.1, 6.1, 8.7). This
// window is the app's own progress store; "another window" is a second windows-in-sync door over the
// same device with a progress store of its own (tests/helpers/otherWindow's progress()), or an OLDER
// build's whole-doc save, and the storage events a browser would send are delivered by hand.
//   • every answer counts once, whichever window made it, and each window shows them all;
//   • another window's answers rebuild only that mode's engine here (store/screenPool's data epoch);
//   • a Best is the best of every window's rounds - a take-back in one hands the field to the next best
//     round, whichever window played it;
//   • a Full Reset in one window is a change every window adopts, and nothing undoes it;
//   • the chunks of solve times a reset or an older build's save leaves behind are cleared with the
//     next save that lands (store/progressStorage's rules a and b, through the door).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { resetAppState } from './helpers/settingsPanel.jsx'
import { otherWindow } from './helpers/otherWindow.js'
import { seedSealed } from './helpers/progressWorld.js'
import { newRoundId } from '../src/engine/roundId.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { useScreenEpoch, fileRoundResult } from '../src/store/screenPool.js'
import { activeDataId } from '../src/store/amnesic.js'
import { useRemoteEpoch } from '../src/store/syncedDoc.js'

const KEY = 'cg-progress-v1'
const FAMILY = 'cg-times-v1'
const live = () => useProgress.getState()
// This window answers in mode `key`, as its screen's mirror saves an answer.
const answer = (key, right = true, time = null) => {
  const s = live().stats[key]
  const streak = right ? s.streak + 1 : 0
  live().setModeStats(key, {
    ...s,
    played: s.played + 1,
    good: s.good + (right ? 1 : 0),
    streak,
    best: Math.max(s.best, streak),
    times: right && time !== null ? [...s.times, time] : s.times,
  })
}
const onDevice = () => JSON.parse(localStorage.getItem(KEY)).state
const chunkKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(FAMILY))
const blitz = (score, streak) => ({ score, streak })
// The rounds of a case, numbered as the app numbers them (engine/roundId: above every round and Reset
// either window has seen - a fixed number could fall below a Reset an earlier case made, and be dead).
let R = []
const ROUND = (i) => (R[i] ??= newRoundId())
const relaunch = () =>
  act(() => {
    useProgress.persist.rehydrate()
  })

beforeEach(() => {
  vi.useFakeTimers()
  resetAppState()
  R = []
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('answers in two windows', () => {
  it('another window’s answers in another mode come in, and this one’s are kept', () => {
    answer('classic', true, 1.5)
    const W = otherWindow()
    W.progress().answer('flash', true, 0.8)
    W.progress().answer('flash', false)
    W.deliver()
    expect(live().stats.classic).toMatchObject({ played: 1, good: 1, times: [1.5] })
    expect(live().stats.flash).toMatchObject({ played: 2, good: 1, streak: 0, times: [0.8] })
    expect(onDevice().stats.classic.played).toBe(1)
    expect(onDevice().stats.flash.played).toBe(2)
  })

  it('both windows answering one mode in turn: every answer counts, once, in both', () => {
    const W = otherWindow()
    answer('classic', true, 1.1)
    W.progress().answer('classic', true, 2.2)
    W.deliver()
    answer('classic', true, 3.3)
    W.progress().answer('classic', false)
    W.deliver()
    const both = { played: 4, good: 3, streak: 0, best: 3, times: [1.1, 2.2, 3.3] }
    expect(live().stats.classic).toEqual(both)
    expect(W.progress().state().stats.classic).toEqual(both)
    expect(onDevice().stats.classic).toMatchObject(both)
  })

  it('another window’s answers rebuild only that mode’s engine here, in the same turn', () => {
    const W = otherWindow()
    const epochs = useScreenEpoch.getState()
    const remote = useRemoteEpoch.getState().progress
    W.progress().answer('dedMonth', true, 4.4)
    W.deliver()
    expect(useScreenEpoch.getState()).toEqual({ ...epochs, dedMonth: epochs.dedMonth + 1 })
    expect(useRemoteEpoch.getState().progress).toBe(remote + 1)
  })
})

describe('Bests in two windows', () => {
  it('a Best another window sets is shown here; a worse round here does not replace it', () => {
    const W = otherWindow()
    W.progress().round('blitzBest', 'k', ROUND(2), blitz(8, 8))
    W.deliver()
    expect(live().blitzBest.k).toMatchObject({ score: 8, scoreRoundId: ROUND(2) })
    fileRoundResult(activeDataId(), 'blitzBest', 'k', ROUND(3), blitz(5, 5), false)
    expect(live().blitzBest.k).toMatchObject({ score: 8, scoreRoundId: ROUND(2) })
    expect(onDevice().blitzBest.k).toMatchObject({ score: 8, scoreRoundId: ROUND(2) })
  })

  it('a round taken back in another window hands the field to this window’s round — the next best', () => {
    fileRoundResult(activeDataId(), 'blitzBest', 'k', ROUND(1), blitz(5, 4), false)
    const W = otherWindow()
    W.progress().round('blitzBest', 'k', ROUND(2), blitz(8, 8))
    W.deliver()
    expect(live().blitzBest.k.scoreRoundId).toBe(ROUND(2))
    W.progress().round('blitzBest', 'k', ROUND(2), null, true) // an Override put it back in play
    W.deliver()
    expect(live().blitzBest.k).toEqual({
      score: 5,
      scoreStreak: 4,
      scoreRoundId: ROUND(1),
      streak: 4,
      streakScore: 5,
      streakRoundId: ROUND(1),
    })
  })

  it('a MoX record is the fastest of both windows’ runs, each metric on its own', () => {
    fileRoundResult(activeDataId(), 'aoxBest', 'k', ROUND(1), { avg: 2.5, med: 2.2 }, false)
    const W = otherWindow()
    W.progress().round('aoxBest', 'k', ROUND(2), { avg: 2.3, med: 2.6 })
    W.deliver()
    expect(live().aoxBest.k).toEqual({
      avg: 2.3,
      avgMed: 2.6,
      avgRoundId: ROUND(2),
      med: 2.2,
      medAvg: 2.5,
      medRoundId: ROUND(1),
    })
  })
})

describe('a Full Reset in another window', () => {
  it('is adopted here at once — the stats and the Bests — and this window’s next answer does not undo it', () => {
    answer('classic', true, 1)
    answer('classic', true, 2)
    fileRoundResult(activeDataId(), 'suddenBest', 'k', ROUND(1), { score: 6 }, false)
    const W = otherWindow()
    W.progress().fullReset()
    W.deliver()
    expect(live().stats.classic).toEqual(makeProgressDefaults().stats.classic)
    expect(live().suddenBest).toEqual({})
    answer('classic', true, 3)
    expect(live().stats.classic).toMatchObject({ played: 1, times: [3] })
    expect(onDevice().stats.classic).toMatchObject({ played: 1, times: [3] })
    expect(onDevice().suddenBest).toEqual({})
    // …and the round this window filed before it is gone: an Override of it changes nothing
    expect(fileRoundResult(activeDataId(), 'suddenBest', 'k', ROUND(1), { score: 9 }, true)).toBe(
      false,
    )
    expect(live().suddenBest).toEqual({})
  })
})

describe('the chunks of solve times', () => {
  const long = (n) => ({
    played: n,
    good: n,
    streak: 3,
    best: 40,
    times: Array.from({ length: n }, (_, i) => 2 + (i % 977) / 100),
  })
  const seed = () => {
    const state = makeProgressDefaults()
    state.stats = { ...state.stats, classic: long(3000) }
    seedSealed({ put: (k, v) => localStorage.setItem(k, v) }, state)
    relaunch()
    expect(live().stats.classic.times).toHaveLength(3000)
    expect(chunkKeys().length).toBeGreaterThan(0)
  }

  it('a Full Reset here takes the reset modes’ chunks with it', () => {
    seed()
    live().resetProgress()
    expect(chunkKeys()).toEqual([])
    expect(onDevice().stats.classic.played).toBe(0)
  })

  it('a Full Reset in another window: its chunks go with the save that wrote it', () => {
    seed()
    const W = otherWindow()
    W.progress().fullReset()
    W.deliver()
    expect(chunkKeys()).toEqual([])
    expect(live().stats.classic.played).toBe(0)
  })

  it('an older build’s save of a sealed mode as a plain one: every time stays, and no chunk is left orphaned', () => {
    seed()
    const W = otherWindow()
    // (an older build that loaded the sealed save whole writes the mode back whole, one answer on)
    W.olderSave(KEY, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        classic: { ...long(3000), played: 3001, good: 3001, times: [...long(3000).times, 9] },
      },
    }))
    W.deliver()
    expect(live().stats.classic.times).toHaveLength(3001)
    answer('flash', true, 1) // this window's next save
    relaunch()
    expect(live().stats.classic.times).toHaveLength(3001)
    expect(live().stats.classic.times.at(-1)).toBe(9)
    // every chunk key on the device is one the saved copy names
    const named = new Set(
      (onDevice().stats.classic.sealed?.ids ?? []).map((id, j) => `${FAMILY}:classic:${j}.${id}`),
    )
    for (const k of chunkKeys()) expect(named.has(k), k).toBe(true)
  })
})
