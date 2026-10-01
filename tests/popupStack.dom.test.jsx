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
  makeSaveable,
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

  // ★ THE NOTICE BELONGS TO NO SCREEN, so no change of screen takes it away — and a key that would
  // change the screen behind it is a key pressed on the page behind a popup. A mode letter, H and G
  // work under a ⚙ popup or a mode screen's popup because the press takes that popup WITH it; under
  // the notice the same press used to change the page behind the dim (H opened How to Play there and
  // gave it the keyboard, and Back then closed the guide from under the notice).
  it('a mode letter, H and G do nothing while the notice is up; it is closed first', () => {
    openNoticeOverPresets()
    for (const key of ['F', 'H', 'G']) pressKey(key)
    expect(currentMode()).toBe('Classic')
    expect(isSettingsOpen()).toBe(true)
    expect(queryModalCard('presets')).not.toBeNull()
    expect(notice()).not.toBeNull()
    expect(document.activeElement).toBe(notice())
    escape() // the notice closes like any popup…
    expect(notice()).toBeNull()
    pressKey('F') // …and the key works again, taking the panel and its popup with it
    expect(currentMode()).toBe('Flash')
    expect(isSettingsOpen()).toBe(false)
    expect(queryModalCard('presets')).toBeNull()
  })

  it('the same over a game screen: H does not open How to Play behind the notice', async () => {
    mountApp()
    act(() => useStorageHealth.setState({ unsaved: true, noticeOpen: true }))
    expect(notice()).not.toBeNull()
    pressKey('H')
    pressKey('L')
    expect(currentMode()).toBe('Classic')
    await pressBack() // Back closes the notice — there is nothing under it to close instead
    expect(notice()).toBeNull()
    expect(currentMode()).toBe('Classic')
  })
})

// ── The top popup keeps the keyboard ─────────────────────────────────────────────────────────────
// Focus that lands outside the popup in front — Tab pressed with nothing focused, which a browser
// walks into the page behind the dim; anything behind it focusing itself — comes straight back.
describe('the popup in front keeps the keyboard', () => {
  it('focus sent to a control behind the popup comes back to its dialog', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    expect(document.activeElement).toBe(modalCard('changelog'))
    act(() => changelogLink().focus()) // a control in the ⚙ panel, behind the dim
    expect(document.activeElement).toBe(modalCard('changelog'))
    act(() => screen.getByRole('button', { name: 'New' }).focus()) // …and one on the page
    expect(document.activeElement).toBe(modalCard('changelog'))
  })

  it('a control INSIDE the popup takes focus normally', () => {
    mountApp()
    openSettings()
    openModal('presets')
    const box = screen.getByRole('textbox', { name: 'Preset name' })
    act(() => box.focus())
    expect(document.activeElement).toBe(box)
  })

  it('with two popups up it is the one in front that keeps it — the one under it does not pull it back', () => {
    openNoticeOverPresets()
    expect(document.activeElement).toBe(notice())
    const box = () => screen.getAllByRole('textbox', { name: 'Preset name' })[0]
    act(() => box().focus()) // a control in the popup underneath
    expect(document.activeElement).toBe(notice())
    escape() // the notice goes, and Manage Presets is in front again
    act(() => box().focus())
    expect(document.activeElement).toBe(box())
  })

  it('closing the popup still hands the keyboard back to what opened it', () => {
    mountApp()
    openSettings()
    act(() => changelogLink().focus())
    tap(changelogLink())
    escape()
    expect(document.activeElement).toBe(changelogLink())
  })
})

// ── …and focus that leaves for NOWHERE comes back too ────────────────────────────────────────────
// Nothing is focused when focus goes nowhere, so no `focusin` reports it — and the rule above, which
// listens for one, never heard. The keyboard was left on <body> behind the scrim: after Enter
// committed a preset rename (the box blurs itself), after a right-click on the dim, and after a
// control was removed while it had the keyboard.
// The popup looks once the browser has settled, not as the signal arrives (components/Popup says
// why), so each case lets a moment pass first.
describe('focus that leaves the popup in front for nowhere comes back to its dialog', () => {
  const settled = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  const nameBox = () => screen.getAllByRole('textbox', { name: 'Preset name' })[0]

  it('Enter commits a preset rename: the box lets go, and the dialog takes the keyboard', async () => {
    mountApp()
    openSettings()
    openModal('presets')
    act(() => nameBox().focus())
    fireEvent.change(nameBox(), { target: { value: 'Weekend' } })
    act(() => void fireEvent.keyDown(nameBox(), { key: 'Enter' }))
    expect(nameBox().value).toBe('Weekend')
    expect(document.activeElement).toBe(document.body) // the box has let go…
    await settled()
    expect(document.activeElement).toBe(modalCard('presets')) // …and the keyboard is not left there
  })

  it('Escape discarding a rename is the same', async () => {
    mountApp()
    openSettings()
    openModal('presets')
    act(() => nameBox().focus())
    fireEvent.change(nameBox(), { target: { value: 'Weekend' } })
    act(() => void fireEvent.keyDown(nameBox(), { key: 'Escape' }))
    await settled()
    expect(queryModalCard('presets')).not.toBeNull() // that Escape was the box's, not the popup's
    expect(document.activeElement).toBe(modalCard('presets'))
  })

  it('a press on the dim that is not a tap — a right-click — does not leave it on <body>', async () => {
    mountApp()
    openSettings()
    openModal('changelog')
    // What a browser does with a press on something that cannot hold focus: whatever had the
    // keyboard loses it, and nothing gains it. (jsdom moves no focus for a press, so the test does.)
    act(() => {
      fireEvent.pointerDown(scrims()[0], { button: 2 })
      document.activeElement.blur()
    })
    expect(document.activeElement).toBe(document.body)
    await settled()
    expect(queryModalCard('changelog')).not.toBeNull() // a right-click closes nothing
    expect(document.activeElement).toBe(modalCard('changelog'))
  })

  it('a control removed while it had the keyboard — a tap-to-type readout closed with Escape', async () => {
    mountApp()
    openSettings()
    makeSaveable()
    openModal('save')
    const card = within(modalCard('save'))
    tap(card.getByRole('button', { name: 'Edit Flash Speed' }))
    const box = card.getByRole('textbox', { name: 'Flash Speed (seconds)' })
    expect(document.activeElement).toBe(box)
    act(() => void fireEvent.keyDown(box, { key: 'Escape' })) // the edit is dropped: the box is gone
    expect(box.isConnected).toBe(false)
    await settled()
    expect(document.activeElement).toBe(modalCard('save'))
  })

  it('…and committed with Enter, which blurs it first', async () => {
    mountApp()
    openSettings()
    makeSaveable()
    openModal('save')
    const card = within(modalCard('save'))
    tap(card.getByRole('button', { name: 'Edit Flash Speed' }))
    const box = card.getByRole('textbox', { name: 'Flash Speed (seconds)' })
    fireEvent.change(box, { target: { value: '1.5' } })
    act(() => void fireEvent.keyDown(box, { key: 'Enter' }))
    await settled()
    expect(card.getByRole('button', { name: 'Edit Flash Speed' }).textContent).toBe('1.5s')
    expect(document.activeElement).toBe(modalCard('save'))
  })

  // ── It only ever acts when NOTHING holds focus, so it cannot fight a control for it ──────────
  it('a text box in the popup keeps the keyboard, and so does the next one focus moves to', async () => {
    mountApp()
    act(() => {
      createPreset('Timed')
    })
    openSettings()
    openModal('presets')
    const [first, second] = screen.getAllByRole('textbox', { name: 'Preset name' })
    act(() => first.focus())
    await settled()
    expect(document.activeElement).toBe(first)
    act(() => second.focus()) // the first box lets go TO the second: something is taking over
    await settled()
    expect(document.activeElement).toBe(second)
  })

  it('a tap-to-type readout swapping to its input, and focus moving from that input to a box', async () => {
    mountApp()
    openSettings()
    makeSaveable()
    openModal('save')
    const card = within(modalCard('save'))
    const readout = card.getByRole('button', { name: 'Edit Flash Speed' })
    act(() => readout.focus()) // a desktop click focuses the button it lands on…
    tap(readout) // …and the button is then replaced by the input, which focuses itself
    await settled()
    const box = card.getByRole('textbox', { name: 'Flash Speed (seconds)' })
    expect(document.activeElement).toBe(box)
    const runLength = card.getByRole('textbox', { name: 'MoX Run Length' })
    act(() => runLength.focus()) // the readout's input commits and is removed as it is left
    await settled()
    expect(document.activeElement).toBe(runLength)
  })

  it('a reorder grip keeps the keyboard through a move', async () => {
    mountApp()
    act(() => {
      createPreset('Timed')
    })
    openSettings()
    openModal('presets')
    const grip = () => screen.getByRole('button', { name: /^Reorder Timed, position/ })
    act(() => grip().focus())
    act(() => void fireEvent.keyDown(grip(), { key: 'ArrowUp' }))
    await settled()
    expect(grip().getAttribute('aria-label')).toMatch(/position 1 of 2$/)
    expect(document.activeElement).toBe(grip())
  })

  it('a box that still holds the keyboard when the WINDOW loses focus keeps it', async () => {
    mountApp()
    openSettings()
    openModal('presets')
    act(() => nameBox().focus())
    // A window losing focus sends the box the same "let go, to nothing" — and leaves it holding
    // the keyboard for when the window comes back.
    act(() => void fireEvent.focusOut(nameBox()))
    await settled()
    expect(document.activeElement).toBe(nameBox())
  })

  it('with two popups up it comes back to the one in front, not the one under it', async () => {
    openNoticeOverPresets()
    act(() => notice().blur())
    expect(document.activeElement).toBe(document.body)
    await settled()
    expect(document.activeElement).toBe(notice())
  })

  it('once the popup has closed, nothing is pulled anywhere', async () => {
    mountApp()
    openSettings()
    openModal('changelog')
    act(() => modalCard('changelog').blur()) // a look is now owed…
    escape() // …and the popup closes before it happens
    expect(queryModalCard('changelog')).toBeNull()
    act(() => document.activeElement.blur())
    await settled()
    expect(document.activeElement).toBe(document.body)
  })
})

// ── A tap outside is a press that starts AND ends on the dim ─────────────────────────────────────
// A click is reported on the nearest element holding both ends of the press, so a press that began
// on the card and was let go over the dim — a selection dragged out of a text box, a button press
// slid off to cancel it — arrives as a click on the scrim. It used to close the popup.
describe('a press that starts on the card and ends on the dim closes nothing', () => {
  const pressOn = (el) => act(() => fireEvent.pointerDown(el))
  const releaseOn = (el) => act(() => fireEvent.click(el))

  it('the popup stays; a real tap on the dim afterwards closes it', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    const scrim = scrims()[0]
    pressOn(modalCard('changelog')) // the press goes down on the card…
    releaseOn(scrim) // …and comes up over the dim: the click lands on the scrim
    expect(queryModalCard('changelog')).not.toBeNull()
    tap(scrim) // down and up on the dim
    expect(queryModalCard('changelog')).toBeNull()
  })

  it('a press on a control inside the card, released on the dim, is the same', () => {
    mountApp()
    openSettings()
    openModal('presets')
    pressOn(screen.getByRole('textbox', { name: 'Preset name' }))
    releaseOn(scrims()[0])
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('an abandoned press on the card does not disarm the next tap on the dim', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    pressOn(modalCard('changelog')) // a press that never became a click (a scroll, a cancel)
    tap(scrims()[0])
    expect(queryModalCard('changelog')).toBeNull()
  })
})

// …and the other direction is the same rule: a press that began on the dim and was let go over the
// card also arrives as a click on the scrim, and it used to close the popup — only where the press
// STARTED was looked at.
describe('a press that starts on the dim and ends on the card closes nothing', () => {
  const pressOn = (el) => act(() => fireEvent.pointerDown(el))
  // The press comes up over `over`; the click that follows lands on `clicked` (the nearest element
  // holding both ends of the press).
  const releaseOn = (over, clicked) =>
    act(() => {
      fireEvent.pointerUp(over)
      fireEvent.click(clicked)
    })

  it('the popup stays; a real tap on the dim afterwards closes it', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    const scrim = scrims()[0]
    pressOn(scrim) // the press goes down on the dim…
    releaseOn(modalCard('changelog'), scrim) // …and comes up over the card
    expect(queryModalCard('changelog')).not.toBeNull()
    pressOn(scrim)
    releaseOn(scrim, scrim) // down and up on the dim
    expect(queryModalCard('changelog')).toBeNull()
  })

  it('released on a control inside the card is the same', () => {
    mountApp()
    openSettings()
    openModal('presets')
    const scrim = scrims()[0]
    pressOn(scrim)
    releaseOn(screen.getByRole('textbox', { name: 'Preset name' }), scrim)
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('a touch tap on the dim that wanders a few pixels still closes it', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    const scrim = scrims()[0]
    // A finger's events stay on the element it landed on, so every one of these is the scrim's.
    act(() => {
      fireEvent.pointerDown(scrim, { pointerType: 'touch', clientX: 20, clientY: 700 })
      fireEvent.pointerMove(scrim, { pointerType: 'touch', clientX: 23, clientY: 702 })
      fireEvent.pointerMove(scrim, { pointerType: 'touch', clientX: 25, clientY: 704 })
      fireEvent.pointerUp(scrim, { pointerType: 'touch', clientX: 25, clientY: 704 })
      fireEvent.click(scrim, { clientX: 25, clientY: 704 })
    })
    expect(queryModalCard('changelog')).toBeNull()
  })

  it('a press that came up over the card without becoming a click does not disarm the next tap', () => {
    mountApp()
    openSettings()
    openModal('changelog')
    const scrim = scrims()[0]
    // A right-click on the card: down and up, and no click follows.
    act(() => {
      fireEvent.pointerDown(modalCard('changelog'), { button: 2 })
      fireEvent.pointerUp(modalCard('changelog'), { button: 2 })
    })
    tap(scrim)
    expect(queryModalCard('changelog')).toBeNull()
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
