// @vitest-environment jsdom
// olderBuilds.progressDoor — AN OLDER BUILD'S REAL SAVES OF THE PROGRESS DOC, MET BY THE WINDOWS-IN-SYNC
// DOOR (design-q1-q2.md v4, 2.4, 4.1, 10: "Progress main: carries tags and `sealed` through answers and
// Overrides, drops them on a reset; ... v2.26.0 re-saves at its version 4 on load").
// The older builds' writes are the ones they really made (tests/fixtures/olderBuilds/sync-<build>.json,
// recorded by tests/fixtures/olderBuilds/syncDrive.dom.test.jsx.txt running each build over one seeded
// device): answers and an Override at depth in Classic, a Reset of Classic, a Blitz round that beats the
// record and one taken back below it on its results screen, and (v2.28.0+) a Full Reset under Stats Only.
// Here the device starts as that build left it at its boot (its own save, no envelope - the bytes of
// before any new save), this window loads it and plays, and the older tab - open since before, on the
// copy it loaded - then writes exactly what it wrote. Its change is taken; this window's stands.
// A mode that was BLANK at the bootstrap, played in this window, then written again blank by an older tab
// opened before the first new save as it answers ANOTHER mode: its blank is that tab's stale copy of the
// bootstrap, and this window's answers stand (design v5, 2.4 - R4 in its commonest form, closed;
// part2-issues #10). (Still R4: that tab answering the blank mode itself - its untagged copy cannot be
// placed.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from '@testing-library/react'
import { otherWindow } from './helpers/otherWindow.js'
import { resetAppState } from './helpers/settingsPanel.jsx'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { fileRoundResult } from '../src/store/screenPool.js'
import { usePresets } from '../src/store/presets.js'
import { door } from '../src/store/syncedDoc.js'
import { newRoundId } from '../src/engine/roundId.js'

const BUILDS = ['v2.26.0', 'v2.27.3', 'v2.28.0', 'v2.29.0']
const PROGRESS = 'cg-progress-v1'
// The drive's two Blitz set-ups: the one its rounds were played on, and one it never touched.
const KEY = 'm60|numeric-ymd|random|random|random|1583-10000|true'
const OTHER = 'm30|numeric-ymd|random|random|random|1583-10000|true'
const recorded = (build) =>
  JSON.parse(readFileSync(resolve(__dirname, `fixtures/olderBuilds/sync-${build}.json`), 'utf8'))
const live = () => useProgress.getState()
const relaunch = () =>
  act(() => {
    useProgress.persist.rehydrate()
  })

beforeEach(() => {
  vi.useFakeTimers()
  resetAppState()
  // (a device only the older build has written: not even this build's Full Reset copy)
  localStorage.clear()
  door.forget()
})
afterEach(() => vi.useRealTimers())

describe.each(BUILDS)('%s’s own saves of the progress doc, over this window’s play', (build) => {
  const seen = recorded(build)
  const progressWrites = (...steps) =>
    steps.flatMap((step) => seen[step]).filter((w) => w.key === PROGRESS)
  // The device as that build left it at its boot, and this window's load of it.
  const start = () => {
    const boot = progressWrites('boot').at(-1).value
    localStorage.setItem(PROGRESS, JSON.stringify(boot))
    relaunch()
    expect(live().stats.classic.played).toBe(10)
    return boot
  }
  // This window answers Classic once, right, in 1.5 s - on top of the copy it loaded.
  const answerClassic = () => {
    const s = live().stats.classic
    live().setModeStats('classic', {
      played: s.played + 1,
      good: s.good + 1,
      streak: s.streak + 1,
      best: Math.max(s.best, s.streak + 1),
      times: [...s.times, 1.5],
    })
  }
  // The older tab writes what it wrote, each write heard here as it lands.
  const olderWrites = (writes) => {
    const W = otherWindow()
    for (const w of writes) {
      W.write(PROGRESS, w.op === 'remove' ? null : JSON.stringify(w.value))
      W.deliver()
    }
    return writes.at(-1)
  }

  // ★ BOTH TABS' CLASSIC ANSWERS COUNT. The older tab extends the copy it loaded - the bootstrap, whose
  // solve times prove it (2.4: a BLOCK on the bootstrap) - so its answers are folded onto this window's,
  // and this window's answer is not lost to its whole-copy save.
  it('its Classic answers, and its Override at depth and back, are added to this window’s Classic answer', () => {
    start()
    answerClassic()
    const last = olderWrites(progressWrites('answers', 'overrideAtDepth', 'overrideBack'))
    const theirs = last.value.state.stats.classic
    const both = live().stats.classic
    expect(both.played).toBe(theirs.played + 1)
    expect(both.good).toBe(theirs.good + 1)
    expect(both.times).toEqual(expect.arrayContaining([...theirs.times, 1.5]))
    expect(both.times).toHaveLength(theirs.times.length + 1)
    // …and the device says so with this window's next save
    live().setModeStats('dedDay', { played: 1, good: 0, streak: 0, best: 0, times: [] })
    relaunch()
    expect(live().stats.classic).toEqual(both)
    expect(live().stats.dedDay.played).toBe(1)
  })

  // ★ R4 IN ITS COMMONEST FORM, CLOSED (design v5, 2.4; the review lane's (b)): Flash was blank at the
  // bootstrap; this window plays it; the older tab - opened before the first new save - answers Classic,
  // and its whole copy carries Flash blank. That is its stale copy of the bootstrap, not a Reset.
  it('its Classic answers leave this window’s answers in a mode that was blank at the update as they are', () => {
    start()
    live().setModeStats('flash', { played: 2, good: 1, streak: 1, best: 1, times: [0.9] })
    olderWrites(progressWrites('answers'))
    expect(live().stats.flash).toMatchObject({ played: 2, good: 1, times: [0.9] })
    live().setModeStats('dedDay', { played: 1, good: 0, streak: 0, best: 0, times: [] })
    relaunch()
    expect(live().stats.flash).toMatchObject({ played: 2, good: 1, times: [0.9] })
  })

  it('its Reset of Classic, made after this window’s answer, is taken: Classic is blank', () => {
    start()
    answerClassic()
    olderWrites(progressWrites('answers', 'overrideAtDepth', 'overrideBack', 'reset'))
    expect(live().stats.classic).toEqual(makeProgressDefaults().stats.classic)
    live().setModeStats('dedDay', { played: 1, good: 0, streak: 0, best: 0, times: [] })
    relaunch()
    expect(live().stats.classic).toEqual(makeProgressDefaults().stats.classic)
  })

  it('its round that beats the record is taken; this window’s Best on another set-up stands', () => {
    start()
    const mine = newRoundId()
    fileRoundResult(
      usePresets.getState().activeId,
      'blitzBest',
      OTHER,
      mine,
      { score: 12, streak: 12 },
      null,
    )
    olderWrites(progressWrites('roundBelow', 'roundBeats'))
    expect(live().blitzBest[KEY]).toMatchObject({ score: 7, streak: 7 })
    expect(live().blitzBest[OTHER]).toMatchObject({ score: 12, scoreRoundId: mine })
  })

  it('its round taken back below the record on its results screen hands the record back', () => {
    start()
    const mine = newRoundId()
    fileRoundResult(
      usePresets.getState().activeId,
      'blitzBest',
      OTHER,
      mine,
      { score: 12, streak: 12 },
      null,
    )
    olderWrites(progressWrites('takeBackBeats', 'takeBack', 'takeBackBelow'))
    // (v2.26.0 keeps the field with its own round at the old value - part2-issues #6 - and the later
    // builds put the old holder back: either way the record is 5 and 4 again)
    expect(live().blitzBest[KEY]).toMatchObject({ score: 5, streak: 4 })
    expect(live().blitzBest[OTHER]).toMatchObject({ score: 12, scoreRoundId: mine })
  })

  if (build >= 'v2.28.0')
    it('its Full Reset under Stats Only (the doc removed) is taken here at once, and nothing undoes it', () => {
      start()
      answerClassic()
      fileRoundResult(
        usePresets.getState().activeId,
        'blitzBest',
        OTHER,
        newRoundId(),
        { score: 12, streak: 12 },
        null,
      )
      olderWrites(progressWrites('fullResetKept'))
      expect(live().stats).toEqual(makeProgressDefaults().stats)
      expect(live().blitzBest).toEqual({})
      answerClassic()
      relaunch()
      expect(live().stats.classic).toMatchObject({ played: 1, times: [1.5] })
      expect(live().blitzBest).toEqual({})
    })
})
