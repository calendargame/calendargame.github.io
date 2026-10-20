// @vitest-environment jsdom
// sealedChunks — A RESET TAKES EVERY CHUNK OF ITS MODE WITH IT (store/progressStorage, rule a; Round 26's
// review lane). A deep Override re-seals the part of the times it changed under new chunk names, and the
// old chunks are kept (an older tab may still hold a save that names them) - until the mode is reset.
// Then every chunk key of that mode goes with the save that lands the reset, not only the ones this
// window's last save named: before, the ones a re-seal had left stayed on the device for ever.
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { resetAppState } from './helpers/settingsPanel.jsx'
import { useProgress } from '../src/store/progress.js'
import { retimed } from '../src/engine/timesPool.js'
import { chunksCachedIn } from '../src/store/progressStorage.js'

const live = () => useProgress.getState()
const chunks = (silo) =>
  Object.keys(localStorage).filter((k) => k.startsWith('cg-times-v1') && k.includes(`:${silo}:`))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  resetAppState()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

it('a deep Override leaves the chunks it re-sealed away; a Reset of the mode takes every one', () => {
  const times = Array.from({ length: 3000 }, (_, i) => Math.round((1 + (i % 97) / 10) * 1e4) / 1e4)
  live().setModeStats('classic', { played: 3000, good: 3000, streak: 1, best: 9, times })
  live().setModeStats('flash', {
    played: 1500,
    good: 1500,
    streak: 1,
    best: 9,
    times: times.slice(0, 1500),
  })
  const sealed = chunks('classic').length
  expect(sealed).toBeGreaterThan(0)
  // an Override of a card deep in the history: its time taken out, every chunk after it re-sealed
  const s = live().stats.classic
  live().setModeStats('classic', {
    ...s,
    good: s.good - 1,
    times: retimed(s.times, 300, true, null),
  })
  expect(chunks('classic').length).toBeGreaterThan(sealed) // (the re-sealed-away ones are kept)
  act(() => {
    useProgress.persist.rehydrate() // (a reload: this window now knows only the chunks its save names)
  })
  live().setModeStats('classic', { played: 0, good: 0, streak: 0, best: 0, times: [] })
  expect(chunks('classic')).toEqual([])
  expect(chunks('flash').length).toBeGreaterThan(0) // (another mode's are its own)
})

// (the review lane's LOW) the read cache keeps only what is on the device: a chunk the Reset removed is
// out of it too - it used to keep every chunk ever read, for as long as the page lived.
it('the chunks a Reset removes leave the read cache with them', () => {
  const times = Array.from({ length: 3000 }, (_, i) => Math.round((1 + (i % 89) / 10) * 1e4) / 1e4)
  live().setModeStats('classic', { played: 3000, good: 3000, streak: 1, best: 9, times })
  act(() => {
    useProgress.persist.rehydrate() // (a load reads every chunk: the cache holds them)
  })
  const read = chunks('classic').length
  const cached = chunksCachedIn(localStorage)
  expect(cached).toBeGreaterThanOrEqual(read)
  live().setModeStats('classic', { played: 0, good: 0, streak: 0, best: 0, times: [] })
  expect(chunks('classic')).toEqual([])
  expect(chunksCachedIn(localStorage)).toBe(cached - read)
})
