// @vitest-environment jsdom
//
// STORAGE FULL × PRESETS AND AMNESIC — a save the device refused must never land anywhere but the
// place it was for, and must not be lost while the app stays open.
//
// What went wrong (round 23's review, reproduced here as it was found): a refused save was remembered
// only as "this STORE is unsaved", and the next write that fit re-saved "whatever that store holds
// now" through the store's own adapter. A preset switch, a preset delete and an Amnesic toggle all
// write the registry FIRST — which fits — while the stores still hold the outgoing preset or copy and
// the adapter already points at the incoming one. So a 500-card preset was overwritten with a 4-card
// one, and a guest's session was written over the permanent stats. And with the save refused outright
// (no retry at all), a switch away and back re-read the older copy off the device and the newest
// answers were gone, under a notice that said they were kept until the app closed.
//
// The rule now (store/storageHealth): a refused save is held under its own destination — read back
// from there, retried to there, forgotten when that place is deleted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'
import { useProgress } from '../src/store/progress.js'
import { useSettings } from '../src/store/settings.js'
import { presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
  isPresetFactory,
} from '../src/store/presetControl.js'
import { useStorageHealth } from '../src/store/storageHealth.js'

const realSetItem = Storage.prototype.setItem
const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const stats = (n) => ({
  played: n,
  good: n,
  streak: n,
  best: n,
  times: Array.from({ length: n }, (_, i) => 1 + (i % 7) / 10),
})
const progressKey = (id = 1) => presetKey(PRESET_STORE_KEYS.progress, id)
const savedClassic = (id = 1, area = localStorage) =>
  JSON.parse(area.getItem(progressKey(id)) ?? 'null')?.state?.stats?.classic
const liveClassic = () => useProgress.getState().stats.classic

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

// localStorage as a real device models it: one allowance for everything, and a write is refused when
// the total would pass it.
describe('a full device (one shared allowance)', () => {
  let cap
  const used = () => {
    let n = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      n += k.length + (localStorage.getItem(k) ?? '').length
    }
    return n
  }
  beforeEach(() => {
    resetAppState()
    cap = Infinity
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage) {
        const old = this.getItem(key)
        const delta = (old === null ? key.length : 0) + String(value).length - (old?.length ?? 0)
        if (used() + delta > cap) throw quota()
      }
      return realSetItem.call(this, key, value)
    })
  })

  // Preset 2 is the player's main preset (500 cards); preset 1 a small one (3), holding one more
  // answer the full device refused.
  function fillWithAnUnsavedAnswer() {
    const main = createPreset('Main')
    useProgress.getState().setModeStats('classic', stats(3))
    switchPreset(main.id)
    useProgress.getState().setModeStats('classic', stats(500))
    switchPreset(1)
    cap = used() // exactly full
    useProgress.getState().setModeStats('classic', stats(4))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    expect(savedClassic(1).played).toBe(3)
    return main
  }

  it('a preset switch never writes the outgoing preset over the incoming one — and the way back keeps the unsaved answer', () => {
    const main = fillWithAnUnsavedAnswer()
    switchPreset(main.id)
    expect(savedClassic(main.id).played).toBe(500)
    expect(liveClassic().played).toBe(500)
    switchPreset(1)
    expect(liveClassic().played).toBe(4) // the refused answer is still there
    expect(useStorageHealth.getState().unsaved).toBe(true)
  })

  it('deleting the preset you are on never writes it into its neighbour, and forgets its unsaved data', () => {
    const main = fillWithAnUnsavedAnswer()
    deletePreset(1)
    expect(savedClassic(main.id).played).toBe(500)
    expect(liveClassic().played).toBe(500)
    expect(localStorage.getItem(progressKey(1))).toBe(null) // …and it was not written back out
    expect(useStorageHealth.getState().unsaved).toBe(false) // nothing is left waiting
  })

  it('deleting ANOTHER preset makes room, and the unsaved answer is saved — to its own preset', () => {
    const main = fillWithAnUnsavedAnswer()
    deletePreset(main.id)
    expect(savedClassic(1).played).toBe(4)
    expect(liveClassic().played).toBe(4)
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('an unsaved settings change stays with its own preset', () => {
    const main = createPreset('Main')
    switchPreset(main.id)
    useSettings.getState().setMinY(1900)
    switchPreset(1)
    useSettings.getState().setMinY(1600)
    cap = used()
    useSettings.getState().setMinY(16000) // one character longer → refused
    expect(useStorageHealth.getState().unsaved).toBe(true)
    switchPreset(main.id)
    expect(useSettings.getState().minY).toBe(1900)
    switchPreset(1)
    expect(useSettings.getState().minY).toBe(16000)
  })

  it('a preset holding only unsaved play is not factory-fresh', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    cap = used()
    useProgress.getState().setModeStats('classic', stats(2))
    expect(localStorage.getItem(progressKey(p2.id))).toBe(null) // never reached the device
    switchPreset(1)
    expect(isPresetFactory(p2.id, true)).toBe(false)
  })
})

describe('a full session area, and the Amnesic toggle', () => {
  let refuseSession
  beforeEach(() => {
    resetAppState()
    sessionStorage.clear()
    refuseSession = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.sessionStorage && refuseSession && key === progressKey()) throw quota()
      return realSetItem.call(this, key, value)
    })
  })

  it("Amnesic off: the guest's unsaved session is thrown away, never written over the permanent stats", () => {
    useProgress.getState().setModeStats('classic', stats(500)) // the owner's permanent stats
    setPresetAmnesic(1, true)
    expect(liveClassic().played).toBe(0)
    useProgress.getState().setModeStats('classic', stats(2))
    refuseSession = true
    useProgress.getState().setModeStats('classic', stats(3))
    expect(useStorageHealth.getState().unsaved).toBe(true)
    setPresetAmnesic(1, false)
    expect(savedClassic().played).toBe(500)
    expect(liveClassic().played).toBe(500)
    expect(useStorageHealth.getState().unsaved).toBe(false)
    // …and a later guest starts from zero: the refused session did not come back.
    refuseSession = false
    setPresetAmnesic(1, true)
    expect(liveClassic().played).toBe(0)
    expect(savedClassic(1, sessionStorage)).toBeUndefined()
  })

  it("a switch away and back keeps a guest's unsaved session", () => {
    const p2 = createPreset()
    setPresetAmnesic(1, true)
    refuseSession = true
    useProgress.getState().setModeStats('classic', stats(3))
    switchPreset(p2.id)
    switchPreset(1)
    expect(liveClassic().played).toBe(3)
  })
})

describe('on the mounted app', () => {
  const pinReadable = () =>
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
      s.setMaxY(10000)
    })
  const answerRight = () => tap(screen.getByRole('button', { name: correctDayName(readDate()) }))

  it('answers given while the device is full survive a switch to another preset and back', () => {
    resetAppState()
    mountApp()
    pinReadable()
    tap(screen.getByRole('button', { name: 'New' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === progressKey()) throw quota()
      return realSetItem.call(this, key, value)
    })
    answerRight()
    answerRight()
    expect(statValue('Score')).toBe('2/2')
    let p2
    act(() => {
      p2 = createPreset()
    })
    act(() => switchPreset(p2.id))
    expect(statValue('Score')).toBe('0/0')
    act(() => switchPreset(1))
    expect(statValue('Score')).toBe('2/2')
  })
})
