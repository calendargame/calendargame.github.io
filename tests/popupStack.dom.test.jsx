// @vitest-environment jsdom
//
// THE APP'S ONE STACK OF OPEN THINGS (components/overlayStack + components/Popup), driven through
// the real app.
//
// Everything a player can open registers in one stack, and the three dismiss gestures, the dim and
// the keyboard are all read off it. What this file pins is the rule that only holds if there IS one
// stack — "the TOP layer, and only the top layer":
//   • Escape, Android Back and a tap outside each close ONE layer, the newest;
//   • however many popups are open, exactly one scrim paints the dim — the top popup's;
//   • the top popup holds the keyboard, and closing it hands the keyboard back to what is under it;
//   • a dropdown list inside the ⚙ panel is a layer of its own: closing it leaves the panel, and its
//     keys work whether or not the press that opened it moved focus (it does not, in Safari).
// It replaced a per-popup Escape listener, a per-layer press-outside listener and a scrim per popup,
// which each closed "their" thing and so closed two things at once the moment two were open: the
// storage-full notice over Manage Presets was the case that showed it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  pressKey,
  pressBack,
  openSettings,
  closeSettings,
  openModal,
  modalCard,
  queryModalCard,
  isSettingsOpen,
  outsideTarget,
  changelogLink,
  currentMode,
  openModeMenu,
  modeMenuOpen,
  yearInput,
  focusYear,
  typeYear,
} from './helpers/settingsPanel.jsx'
import { createPreset } from '../src/store/presetControl.js'
import { useStorageHealth } from '../src/store/storageHealth.js'
import { MODAL_DIM_CLASS } from '../src/components/modalContract.js'

const scrims = () => [...document.querySelectorAll('#root > [data-settings-modal]')]
const dimmed = () => scrims().filter((s) => s.classList.contains(MODAL_DIM_CLASS))
const notice = () => screen.queryByRole('dialog', { name: /isn.t being saved/i })
const escape = () => act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))

// Manage Presets is open over the ⚙ panel, and a save is refused under it: making a preset is a
// registry write, so the storage-full notice opens ON TOP of the manager.
function openNoticeOverPresets() {
  mountApp()
  openSettings()
  openModal('presets')
  const realSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === 'cg-presets-v1')
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    return realSetItem.call(this, key, value)
  })
  act(() => {
    createPreset('Second')
  })
  expect(useStorageHealth.getState().noticeOpen).toBe(true)
}

beforeEach(() => {
  resetAppState()
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

describe('two popups at once — the storage-full notice over Manage Presets', () => {
  it('there are two scrims and ONE dim, and the dim is under the popup in front', () => {
    openNoticeOverPresets()
    expect(scrims()).toHaveLength(2)
    expect(dimmed()).toHaveLength(1)
    // The newest popup is the last child of #root, so it paints in front — and it is the dimmed one.
    expect(dimmed()[0]).toBe(scrims()[1])
    expect(dimmed()[0].contains(notice())).toBe(true)
  })

  it('the popup in front holds the keyboard', () => {
    openNoticeOverPresets()
    expect(document.activeElement).toBe(notice())
  })

  it('one Escape closes ONLY the notice; the dim and the keyboard pass to Manage Presets', () => {
    openNoticeOverPresets()
    escape()
    expect(notice()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
    expect(scrims()).toHaveLength(1)
    expect(dimmed()).toHaveLength(1)
    expect(scrims()[0].contains(document.activeElement)).toBe(true)
    // …and the ladder goes on one layer at a time: the manager, then the panel.
    escape()
    expect(queryModalCard('presets')).toBeNull()
    expect(isSettingsOpen()).toBe(true)
    escape()
    expect(isSettingsOpen()).toBe(false)
  })

  it('a tap outside closes ONLY the notice', () => {
    openNoticeOverPresets()
    tap(scrims()[1])
    expect(notice()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  it('Android Back closes ONLY the notice', async () => {
    openNoticeOverPresets()
    await pressBack()
    expect(notice()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  it('a held Escape is one press — auto-repeat does not peel the layers underneath', () => {
    openNoticeOverPresets()
    escape()
    act(() => {
      for (let i = 0; i < 5; i++) fireEvent.keyDown(document.body, { key: 'Escape', repeat: true })
    })
    expect(queryModalCard('presets')).not.toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  it('a mode letter still works with a popup up — and the notice, which belongs to no screen, stays', () => {
    openNoticeOverPresets()
    pressKey('F')
    expect(currentMode()).toBe('Flash')
    expect(isSettingsOpen()).toBe(false) // the panel went, and Manage Presets with it
    expect(queryModalCard('presets')).toBeNull()
    expect(notice()).not.toBeNull()
    expect(dimmed()).toHaveLength(1)
  })
})

describe('focus goes into a popup and comes back out', () => {
  it('closing a popup returns the keyboard to the control that opened it', () => {
    mountApp()
    openSettings()
    act(() => changelogLink().focus())
    tap(changelogLink())
    expect(document.activeElement).toBe(modalCard('changelog'))
    escape()
    expect(queryModalCard('changelog')).toBeNull()
    expect(document.activeElement).toBe(changelogLink())
  })

  it('a text box that had the keyboard does not get it back — opening anything takes the keyboard down', () => {
    mountApp()
    openSettings()
    focusYear('min')
    typeYear('min', '1900')
    tap(changelogLink()) // a tap that does not move focus, as on iOS
    expect(document.activeElement).toBe(modalCard('changelog'))
    escape()
    expect(document.activeElement).not.toBe(yearInput('min'))
  })
})

describe('a dropdown list inside the ⚙ panel is a layer of its own', () => {
  const trigger = () => screen.getByRole('button', { name: /^Open in,/ })
  const list = () => screen.queryByRole('listbox', { name: 'Open in' })
  function openList() {
    act(() => {
      createPreset('Timed')
    })
    mountApp()
    openSettings('key')
    fireEvent.click(trigger()) // a click that does not itself move focus — a tap, or Safari
    expect(list()).not.toBeNull()
  }

  it('opening the list puts the keyboard on its trigger, so the arrows and Enter work', () => {
    openList()
    expect(document.activeElement).toBe(trigger())
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(list()).toBeNull()
    expect(trigger().textContent).toContain('Preset 1') // one below "Last used"
    expect(isSettingsOpen()).toBe(true)
  })

  it('Escape closes just the list — wherever focus is — and a second Escape closes the panel', () => {
    openList()
    act(() => trigger().blur()) // the keyboard is nowhere in particular
    escape()
    expect(list()).toBeNull()
    expect(isSettingsOpen()).toBe(true)
    expect(document.activeElement).toBe(trigger()) // and it comes back to the trigger
    escape()
    expect(isSettingsOpen()).toBe(false)
  })

  it('a tap outside closes just the list, and a second one closes the panel', () => {
    openList()
    tap(outsideTarget())
    expect(list()).toBeNull()
    expect(isSettingsOpen()).toBe(true)
    tap(outsideTarget())
    expect(isSettingsOpen()).toBe(false)
  })

  it('Android Back closes just the list', async () => {
    openList()
    await pressBack()
    expect(list()).toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  it('picking an option is not a press outside anything — the pick lands and the panel stays', () => {
    openList()
    tap(within(list()).getAllByRole('option')[2])
    expect(list()).toBeNull()
    expect(trigger().textContent).toContain('Timed')
    expect(isSettingsOpen()).toBe(true)
    closeSettings('escape')
    expect(isSettingsOpen()).toBe(false)
  })
})

// ── Lookup's own keys are page shortcuts too ─────────────────────────────────────────────────────
// ↑/↓ walk Lookup's history and Backspace/Delete clear the card (components/LookupCard). They sat
// outside the stack's rules: with a popup open they still acted on the page behind the dim — in
// Manage Presets, ↓ on a reorder grip moved the preset AND the selection behind it, and took the
// keyboard off the grip — and with a dropdown list open they walked the history as well as the list.
describe("Lookup's keys stand aside for whatever is open over the page", () => {
  const field = () => document.querySelector('input[placeholder^="e.g.,"]')
  const lookup = (text) => {
    act(() => fireEvent.change(field(), { target: { value: text } }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
  }
  const answer = () => document.querySelector('.text-sm.min-h-15').textContent
  // Three lookups; the newest (top) row is the selected one.
  function onLookupWithHistory() {
    mountApp()
    pressKey('L')
    lookup('7/4/1776')
    lookup('3/14/1592')
    lookup('1/1/2000')
    expect(answer()).toContain('January 1, 2000')
  }
  const key = (target, k) => act(() => fireEvent.keyDown(target, { key: k }))

  it('with nothing open, ↓ walks the history and Backspace clears the card (the control case)', () => {
    onLookupWithHistory()
    key(document.body, 'ArrowDown')
    expect(answer()).toContain('March 14, 1592')
    key(document.body, 'Backspace')
    expect(field().value).toBe('')
    expect(answer()).not.toContain('1592')
  })

  it('under a popup the keys do nothing to the page behind it', () => {
    act(() => {
      createPreset('Second')
    })
    onLookupWithHistory()
    openSettings()
    openModal('presets')
    const grip = screen.getByRole('button', { name: /^Reorder Preset 1, position 1 of 2$/ })
    act(() => grip.focus())
    key(grip, 'ArrowDown') // the grip's own key: Preset 1 moves down a place…
    expect(screen.getByRole('button', { name: /^Reorder Preset 1, position 2 of 2$/ })).toBe(
      document.activeElement, // …and the keyboard is still on its grip
    )
    expect(answer()).toContain('January 1, 2000') // the selection behind the dim did not move
    key(document.body, 'ArrowDown')
    key(document.body, 'Backspace')
    key(document.body, 'Delete')
    expect(answer()).toContain('January 1, 2000')
    expect(field().value).toBe('1/1/2000')
  })

  it('an open dropdown list keeps its arrows to itself', () => {
    onLookupWithHistory()
    openModeMenu()
    const trigger = document.activeElement
    key(trigger, 'ArrowDown')
    key(trigger, 'ArrowUp')
    expect(modeMenuOpen()).toBe(true)
    expect(document.activeElement).toBe(trigger) // the list still has the keyboard
    expect(answer()).toContain('January 1, 2000') // …and the history behind it was not walked
  })
})
