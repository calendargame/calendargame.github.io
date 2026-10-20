// @vitest-environment jsdom
//
// screenPool.gap.dom — THE COMMIT/EFFECT GAP (Round 26, F1). A Blitz round that ends on its CLOCK —
// a requestAnimationFrame callback, the one ending that is not a tap — commits in one task, and in
// v2.29.0 its Best reconcile and its park were passive effects, which React runs in a LATER task. A
// tap landing between the two (a preset switch, Full Reset) runs to completion first and swaps the
// data under the screens; the round's old effects then ran with the old render's values against the
// NEW data: preset A's result filed in preset B, a Best and a parked round put back after Full Reset's
// wipe. (And the Amnesic pill, which swaps nothing since Amnesic is decided at the close: the round is
// filed and parked as ever.)
//
// ⚠ NOTHING HERE MAY GO THROUGH `act` WHILE THE ROUND ENDS. act flushes every effect before it
// returns, which is exactly the gap these cases exist to open. So the race runs with React's act
// environment OFF and React's own scheduler on real tasks (setImmediate is left REAL below); only the
// clock is faked — requestAnimationFrame and performance.now advance in lockstep, so the countdown
// runs out inside one synchronous advance and its end is scheduled the way a frame schedules it. A
// MutationObserver then presses the control in the microtask after the ended commit reaches the DOM:
// a real task boundary after the commit, before the effects task.
//
// The oracle is the owner's words, not the mechanism: a round belongs to the preset it was played on,
// whatever its Amnesic value while it is played; after Full Reset there is nothing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import { setPresetAmnesic, createPreset, switchPreset } from '../src/store/presetControl.js'
import { usePresets, PRESET_STORE_KEYS, presetKey } from '../src/store/presets.js'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useProgress } from '../src/store/progress.js'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  picker,
  fullResetButton,
  fullResetConfirmCard,
} from './helpers/settingsPanel.jsx'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

const FAKED = [
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'Date',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]

function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const dayBtn = (name) =>
  screen
    .getAllByRole('button', { name })
    .find((b) => !isHidden(b) && b.dataset.key !== undefined) ??
  screen.getAllByRole('button', { name }).find((b) => !isHidden(b))
const ctrl = (name) => screen.getAllByRole('button', { name }).find((b) => !isHidden(b))
const press = (el) => act(() => fireEvent.click(el))
const answerRight = () => press(dayBtn(DAY[wday(...Object.values(readDate()))]))

// Every Best map, as the PERMANENT copy of a preset holds it on the device.
const savedBests = (presetId = 1) => {
  const raw = localStorage.getItem(presetKey(PRESET_STORE_KEYS.progress, presetId))
  const s = raw ? JSON.parse(raw).state : {}
  return {
    blitzBest: s.blitzBest ?? {},
    suddenBest: s.suddenBest ?? {},
    suddenAmBest: s.suddenAmBest ?? {},
    aoxBest: s.aoxBest ?? {},
  }
}
const liveBests = () => {
  const s = useProgress.getState()
  return {
    blitzBest: s.blitzBest,
    suddenBest: s.suddenBest,
    suddenAmBest: s.suddenAmBest,
    aoxBest: s.aoxBest,
  }
}
const parkedSlots = () => Object.keys(JSON.parse(sessionStorage.getItem('cg-round-v3') ?? '{}'))

function pinReadable() {
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
  })
}

// Begin a Per Round round on the Blitz screen and score `score` before the clock runs out.
function playRound(score) {
  act(() => fireEvent.keyDown(window, { key: 'B' }))
  press(ctrl('Begin'))
  for (let i = 0; i < score; i++) answerRight()
}

// THE RACE. Run the round's clock out OUTSIDE act, and in the microtask after the commit that shows
// the round ended (the answer is revealed on the grid), run `between` — the tap that lands in the gap.
// Then let React's own tasks run until nothing is left to do.
async function endOnTheClockThen(between) {
  let fired = 0
  const observer = new MutationObserver(() => {
    if (fired || !document.querySelector('.btn-correct-persist')) return
    fired = 1
    observer.disconnect()
    between()
  })
  observer.observe(document.body, { subtree: true, attributes: true, childList: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try {
    // Sixty-odd seconds of frames in one synchronous advance: the countdown's rAF callback ends the
    // round, and React schedules that render on its own (real) task.
    vi.advanceTimersByTime(61_000)
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    observer.disconnect()
  }
  expect(fired, 'the tap landed between the ended commit and its effects').toBe(1)
  await act(async () => {})
}

describe('the commit/effect gap: a round that ends on its clock, then a tap before its effects run', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: FAKED })
    resetAppState()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('T-F1a: an Amnesic change in the gap changes nothing — the round is filed and parked as ever', async () => {
    mountApp()
    pinReadable()
    act(() => setPresetAmnesic(1, 'full'))
    playRound(3)
    openSettings()
    const off = within(picker('Amnesic')).getByRole('radio', { name: 'Off' })
    await endOnTheClockThen(() => off.click())
    expect(usePresets.getState().activeId).toBe(1)
    expect(
      Object.values(savedBests().blitzBest).map((r) => r.score),
      "the round's Best is saved",
    ).toEqual([3])
    expect(
      Object.values(liveBests().blitzBest).map((r) => r.score),
      'and shown',
    ).toEqual([3])
    expect(parkedSlots(), 'and its round is waiting on screen').toContain('1:blitz')
  })

  it("T-F1b: a preset switch in the gap — preset B's Bests untouched, preset A's round recorded and parked", async () => {
    mountApp()
    pinReadable()
    act(() => {
      createPreset()
    })
    const b = usePresets.getState().presets[1].id
    const bBefore = savedBests(b)
    playRound(2)
    await endOnTheClockThen(() => switchPreset(b))
    expect(usePresets.getState().activeId).toBe(b)
    expect(savedBests(b), "the other preset's Bests are untouched").toEqual(bBefore)
    expect(liveBests(), 'and so are the ones on screen').toEqual(bBefore)
    const a = savedBests(1).blitzBest
    expect(
      Object.values(a).map((r) => r.score),
      "the round's Best is its own preset's",
    ).toEqual([2])
    expect(parkedSlots(), 'and its round is waiting for it there').toContain('1:blitz')
    act(() => switchPreset(1))
    expect(ctrl('Reset'), 'back on the first preset, the ended round is on screen').toBeTruthy()
  })

  it('T-F1c: Full Reset in the gap — no Best and no parked round afterwards', async () => {
    mountApp()
    pinReadable()
    playRound(2)
    openSettings()
    tap(fullResetButton())
    const confirm = within(fullResetConfirmCard()).getByRole('button', { name: 'Full Reset' })
    await endOnTheClockThen(() => {
      confirm.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      confirm.click()
    })
    expect(liveBests().blitzBest, 'no Best on screen').toEqual({})
    expect(savedBests().blitzBest, 'none on the device').toEqual({})
    expect(parkedSlots(), 'and no parked round').toEqual([])
  })
})
