// @vitest-environment jsdom
//
// STORAGE FULL IS NEVER SILENT (round 23 Q3).
//
// Every solve time is kept now, so the saved data grows with play, and a device's storage for this
// site is finite (~5 MB in Chromium and Safari). When the browser refuses a save it throws a
// QuotaExceededError out of localStorage.setItem — and zustand's persist does not catch it: the
// throw came straight out of the store setter, i.e. out of the mode screen's effect, and the player
// met the error card. What must happen instead, and what this file pins:
//   • play goes on — the refused save costs nothing on screen;
//   • the player is TOLD, once per episode, in plain words, with what to do about it;
//   • once there is room again, what is on screen is saved without the player having to redo it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useStorageHealth } from '../src/store/storageHealth.js'
import { storageKeyFor } from './helpers/persistence.js'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
const answerCorrect = () =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: correctDayName(readDate()) }))
  })
const notice = () => screen.queryByRole('dialog', { name: /isn.t being saved/i })

// The device's storage, full: every write of THIS key is refused the way a browser refuses it.
let full = new Set()
const realSetItem = Storage.prototype.setItem
function fillStorageFor(key) {
  full.add(key)
}
function makeRoom() {
  full = new Set()
}

describe('storage full — play goes on, and the player is told', () => {
  let progressKey
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useModePrefs.getState().resetModePrefs()
    progressKey = storageKeyFor(useProgress)
    full = new Set()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full.has(key))
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    vi.restoreAllMocks()
  })

  it('a refused save does not stop play, and opens the notice once', () => {
    mountApp()
    fillStorageFor(progressKey)
    answerCorrect()
    expect(statValue('Score')).toBe('1/1') // play went on
    expect(notice()).not.toBeNull()
    expect(notice().textContent).toMatch(/Manage Presets/)
    expect(notice().textContent).toMatch(/Reset Stats/)
    // Dismissed the way every info popup here is: a tap on the scrim.
    act(() => {
      fireEvent.click(notice().closest('[data-settings-modal]'))
    })
    expect(notice()).toBeNull()
    answerCorrect() // still refused — but the player already knows; no nagging on every answer
    expect(statValue('Score')).toBe('2/2')
    expect(notice()).toBeNull()
  })

  it('once there is room again, what is on screen is saved — and a later refusal tells the player again', () => {
    mountApp()
    fillStorageFor(progressKey)
    answerCorrect()
    answerCorrect()
    act(() => {
      fireEvent.click(notice().closest('[data-settings-modal]'))
    })
    expect(
      JSON.parse(localStorage.getItem(progressKey) ?? 'null')?.state?.stats?.classic?.good ?? 0,
    ).toBe(0)
    makeRoom()
    answerCorrect() // the next save goes through, with everything on screen in it
    expect(JSON.parse(localStorage.getItem(progressKey)).state.stats.classic.good).toBe(3)
    expect(useStorageHealth.getState().unsaved).toBe(false)
    fillStorageFor(progressKey)
    answerCorrect()
    expect(notice()).not.toBeNull() // a new episode is a new notice
  })

  it("a save that frees room retries another store's refused save straight away", () => {
    mountApp()
    fillStorageFor(progressKey)
    answerCorrect() // progress refused
    makeRoom()
    // Something ELSE saves successfully (here a setting) — proof the device has room again.
    act(() => useSettings.getState().setMinY(1600))
    expect(JSON.parse(localStorage.getItem(progressKey)).state.stats.classic.good).toBe(1)
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })
})
