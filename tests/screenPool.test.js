// @vitest-environment jsdom
//
// screenPool — THE ONE DOOR A MODE SCREEN WRITES THROUGH (store/screenPool), and the property it
// exists for: a write names the copy of the data its screen was drawn for, and lands only while that
// copy is the live one. Each of the three ways the live copy moves — a preset switch, an Amnesic
// change, a preset delete — is driven for real through store/presetControl, and every function of
// the door is then called with the copy that was live BEFORE the move (refused, nothing anywhere
// changes) and with the one live after it (written, as the raw setter would).
// (T-F1d of design-q6.md; tests/screenPool.gap.dom is the race the door closes, in the real app.)
import { describe, it, expect, beforeEach } from 'vitest'
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
  fileRoundBest,
  roundBests,
  parkRound,
  unparkRound,
  saveModeStats,
} from '../src/store/screenPool.js'
import { resetAppState } from './helpers/settingsPanel.jsx'

const REC = { score: 7, streak: 7, scoreStreak: 7, streakScore: 7, scoreRound: 1, streakRound: 1 }
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

      expect(roundBests(oldData), 'no floor is read from a copy that is not live').toBe(null)
      for (const map of ['blitzBest', 'suddenBest', 'suddenAmBest', 'aoxBest'])
        fileRoundBest(oldData, map, (prev) => ({ ...prev, k: REC }))
      saveModeStats(oldData, 'classic', STATS)
      parkRound(oldData, newBests, 'blitz', { c: 3 })
      unparkRound(oldData, newBests, 'aox')
      expect(store(), 'nothing in the store moved').toBe(before)
      expect(sessionStorage.getItem('cg-round-v2'), 'nothing parked or unparked').toBe(parkedBefore)

      expect(roundBests(newData), 'the live copy is read').not.toBe(null)
      fileRoundBest(newData, 'blitzBest', (prev) => ({ ...prev, k: REC }))
      expect(useProgress.getState().blitzBest.k).toEqual(REC)
      saveModeStats(newData, 'classic', STATS)
      expect(useProgress.getState().stats.classic).toEqual(STATS)
      parkRound(newData, newBests, 'blitz', { c: 3 })
      expect(readSessionRound(newBests, 'blitz')).toEqual({ c: 3 })
      unparkRound(newData, newBests, 'aox')
      expect(readSessionRound(newBests, 'aox')).toBe(null)
    })
  }

  it('roundBests hands back the four Best maps of the live copy, as the store holds them', () => {
    const id = activeDataId()
    fileRoundBest(id, 'aoxBest', () => ({ x: { avg: 1, med: 1, avgRound: 2, medRound: 2 } }))
    const { blitzBest, suddenBest, suddenAmBest, aoxBest } = useProgress.getState()
    expect(roundBests(id)).toEqual({ blitzBest, suddenBest, suddenAmBest, aoxBest })
  })
})
