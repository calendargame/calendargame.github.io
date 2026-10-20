// @vitest-environment jsdom
// answerCost.measure — scripts/measureAnswerCost.mjs's measurement (run by that script; not collected by
// the test suite, which runs *.test.* files only). See the script for what it measures and why.
import { it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { act } from '@testing-library/react'
import { resetAppState } from '../helpers/settingsPanel.jsx'
import { otherWindow } from '../helpers/otherWindow.js'
import { useProgress } from '../../src/store/progress.js'
import { gameReducer, initEngine, correctIndexOf } from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { calcLast, calcAvg, calcMed, solveTimeFromMs } from '../../src/engine/stats.js'

const TIMES = Number(process.env.MEASURE_TIMES ?? 100_000)
const ANSWERS = Number(process.env.MEASURE_ANSWERS ?? 200)
const now = () => performance.now()
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
// (the door's writes and merges settle in timers and microtasks: run them all)
const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
  vi.runOnlyPendingTimers()
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

it('what an answer costs, and what another window’s answer costs here', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  resetAppState()
  await settle()
  // A seeded generator, so two runs measure the same pool.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0
    return seed / 2 ** 32
  }
  const date = () => ({ y: 1600 + Math.floor(rand() * 400), m: 1 + Math.floor(rand() * 12), d: 1 })
  const times = Array.from({ length: TIMES }, () => solveTimeFromMs(500 + rand() * 20_000))
  useProgress
    .getState()
    .setModeStats('classic', { played: TIMES, good: TIMES, streak: 3, best: 40, times })
  await settle()
  // a reload: the store holds the pool as loaded from the device
  act(() => {
    useProgress.persist.rehydrate()
  })
  await settle()
  let state = initEngine(date(), useProgress.getState().stats.classic)
  const parts = { reducer: [], invariants: [], strip: [], 'save (store + door)': [] }
  for (let i = 0; i < ANSWERS; i++) {
    const t0 = now()
    state = gameReducer(state, {
      type: 'ANSWER',
      idx: correctIndexOf(state.date, false),
      useJulian: false,
      elapsed: solveTimeFromMs(500 + rand() * 20_000),
      tracking: true,
      saveStats: true,
      nextDate: date(),
    })
    const t1 = now()
    if (checkGameInvariants(state, false).length) throw new Error('invariant broken')
    const t2 = now()
    calcLast(state.stats.times) + calcAvg(state.stats.times) + calcMed(state.stats.times)
    const t3 = now()
    useProgress.getState().setModeStats('classic', state.stats)
    await settle()
    const t4 = now()
    parts.reducer.push(t1 - t0)
    parts.invariants.push(t2 - t1)
    parts.strip.push(t3 - t2)
    parts['save (store + door)'].push(t4 - t3)
  }
  // another window's answers, heard here
  const W = otherWindow()
  const notice = { 'notice: same mode': [], 'notice: another mode': [] }
  for (let i = 0; i < 30; i++) {
    for (const [mode, key] of [
      ['classic', 'notice: same mode'],
      ['flash', 'notice: another mode'],
    ]) {
      W.progress().answer(mode, true, 1.25)
      const t0 = now()
      W.deliver()
      await settle()
      notice[key].push(now() - t0)
    }
  }
  const all = { ...parts, ...notice }
  const total = ['reducer', 'invariants', 'strip', 'save (store + door)']
    .map((k) => median(all[k]))
    .reduce((a, b) => a + b, 0)
  writeFileSync(
    process.env.MEASURE_OUT ?? 'answerCost.json',
    JSON.stringify({
      times: TIMES,
      answers: ANSWERS,
      median: {
        ...Object.fromEntries(Object.entries(all).map(([k, a]) => [k, median(a)])),
        'an answer in all': total,
      },
    }),
  )
  // (and the app's own answer path is still right: the saved pool is every time, in order)
  const saved = useProgress.getState().stats.classic
  if (saved.times.length !== TIMES + ANSWERS + 30) throw new Error('times lost')
}, 1_800_000)
