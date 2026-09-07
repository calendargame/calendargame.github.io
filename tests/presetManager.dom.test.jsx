// @vitest-environment jsdom
//
// presetManager.dom — MANAGING PRESETS (components/PresetManager), the ⚙ menu's fifth modal.
//
// ★ WHAT THIS FILE OWNS AND WHAT IT LEAVES ALONE. It covers the four things this card does — make,
// rename, reorder, delete — and the two cases the brief called out as real and easy to fake:
// deleting the ACTIVE preset, and deleting the LAST one. It does NOT re-test the modal CONTRACT
// (focus on open, Escape, Android Back, the Tab trap, the scrim, the [data-settings-modal] marker):
// this modal is registered in tests/helpers/settingsPanel's MODAL_TITLES, so every MODAL_KEYS loop
// in tests/settingsPanel.lifecycle and tests/settingsPanel.defaults already drives it alongside the
// other four, which is a stronger claim than a copy of those cases here would be — it says this
// modal behaves like the app's other modals, rather than that somebody wrote it four assertions.
// It does not re-test the store either: tests/presets.dom owns what a switch does to saved data.
//
// ⚠⚠ WHAT NO CASE HERE CAN PROVE, said plainly rather than implied. jsdom has NO LAYOUT ENGINE. It
// does not lay out the row's flex box, it does not resolve the card's max-w or the list's max-h, it
// reports every width and height as 0, and it never scrolls. So: whether the three small row
// buttons are comfortable under a thumb, whether a 12-character name fits beside them at 360px,
// whether the list's scroll region ever shows its fades, and whether a newly created preset scrolls
// into view are ALL DEVICE QUESTIONS and only the owner's iPhone can answer them. What is asserted
// below is the structure and the behaviour those outcomes rest on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, within, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  openSettings,
  openModal,
  modalCard,
  queryModalCard,
  managePresetsButton,
  picker,
  pressDragFromGear,
  isSettingsOpen,
  tap,
  isOffered,
  isDimmed,
} from './helpers/settingsPanel.jsx'
import { usePresets, PRESET_STORE_KEYS, presetKey, MAX_PRESET_NAME } from '../src/store/presets.js'
import { createPreset, setPresetAmnesic, switchPreset } from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'

// ── Reaching the card ─────────────────────────────────────────────────────────────────────────

// Open the app, the ⚙ panel and the manager, in the user's order. Every case starts here, so the
// route is stated once — and it is the REAL route (a tap on a real button in a real panel), not a
// state poke, which is what makes "the panel's Presets section actually opens this" a fact the
// whole file rests on rather than a case somebody could delete.
const openManager = () => {
  mountApp()
  openSettings()
  openModal('presets')
}

const card = () => modalCard('presets')
// The confirmation is a VIEW OF THE SAME CARD, not a second dialog, so it is asked for by ITS
// title. Both titles are fixed strings on purpose (components/PresetManager argues why a dialog
// must not rename itself per row), which is what lets both be named here at all.
const CONFIRM_TITLE = 'Delete this preset?'
const confirmCard = () => screen.getByRole('dialog', { name: CONFIRM_TITLE })
const queryConfirmCard = () => screen.queryByRole('dialog', { name: CONFIRM_TITLE })

// ── Reading a row ─────────────────────────────────────────────────────────────────────────────

// The rows, in the order the card draws them — which is the registry's array order, the one and
// only source of truth for "which preset is where" (store/presets rejected a separate `order`
// field on sight). Resolved through the NAME BOXES rather than through a wrapper class, because
// the box is the row's only element the app names.
const nameBoxes = () => within(card()).getAllByRole('textbox', { name: 'Preset name' })
const listedNames = () => nameBoxes().map((el) => el.value)
const rowOf = (name) => nameBoxes().find((el) => el.value === name).parentElement
// A row's three controls, by the accessible name each publishes. Every one of them names the
// PRESET, because a button has no value of its own to be read out — where the name BOX does, which
// is why that one is called only "Preset name". Spelling the three names out here rather than
// composing them from a verb is deliberate: this table is the assertion that they read as English
// ("Move Preset 1 up"), which a `${verb} ${name}` template would silently stop being.
const ROW_ACTION_NAMES = {
  up: (name) => `Move ${name} up`,
  down: (name) => `Move ${name} down`,
  delete: (name) => `Delete ${name}`,
}
const rowButton = (name, action) =>
  within(rowOf(name)).getByRole('button', { name: ROW_ACTION_NAMES[action](name) })
const registry = () => usePresets.getState()

beforeEach(resetAppState)
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  resetAppState()
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the ⚙ panel offers it, and the card reads the registry', () => {
  it('the Presets section sits at the HEAD of the panel, and its button opens the card', () => {
    mountApp()
    openSettings()
    // FIRST, not merely present. The placement carries an argument (components/SettingsPanel: a
    // preset is the CONTAINER every setting under it belongs to, so the section frames the rest of
    // the card), and a section that quietly drifted below Display would leave the panel opening on
    // fifteen settings with nothing saying whose they are. Asserted as DOCUMENT ORDER against the
    // Display section's first picker rather than as an index into a list of headings — the claim is
    // "before the settings", which survives any later reshuffle among the settings themselves.
    const before =
      managePresetsButton().compareDocumentPosition(picker('Date Format')) &
      Node.DOCUMENT_POSITION_FOLLOWING
    expect(before).toBeTruthy()
    expect(queryModalCard('presets')).toBeNull()
    tap(managePresetsButton())
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('a press-drag release on Manage Presets opens the card WITHOUT dismissing the panel', () => {
    // ⚠ THE GESTURE THE OWNER CALLS "one of the most convenient parts of the whole site", and the
    // case that catches the one way this button could be broken while looking fine. The ⚙ card is
    // data-drag-dismiss, so a release on a control inside it clicks the control AND closes the
    // panel — which for a modal opener means the panel unmounts the panel component, and the modal
    // it just opened goes with it. The button opts out with data-drag-stay, exactly as the footer's
    // four modal openers do; without it this reads "panel false, card false" and the gesture looks
    // like a button that does nothing.
    mountApp()
    pressDragFromGear(() => managePresetsButton())
    expect(isSettingsOpen()).toBe(true)
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('the panel names the preset you are on, and follows a rename made inside the card', () => {
    // The line exists so that someone whose finger is over Full Reset can read whose data it is
    // about. A stale name there would be worse than no name at all, so the claim is that it
    // TRACKS — asserted through the app's own rename, not through a store poke.
    openManager()
    const box = nameBoxes()[0]
    act(() => {
      box.focus()
      fireEvent.change(box, { target: { value: 'Mornings' } })
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    tap(within(card()).getByRole('button', { name: 'Close' }))
    // The section's own text, read off the block the button lives in — the name sits inside a <b>,
    // so it is only whole at the section level.
    expect(managePresetsButton().parentElement.textContent).toContain('You are on Mornings.')
  })

  it('lists every preset in registry order, marks the active one, and marks the amnesic ones', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
      setPresetAmnesic(3, true) // Guest — a preset you are NOT on, which only the registry can answer for
    })
    openManager()
    expect(listedNames()).toEqual(['Preset 1', 'Timed', 'Guest'])
    // The two quiet markers are asked for by their sr-only WORDS, never by their glyphs: a bare ✓
    // or A is a picture, and the word is the whole reason each marker is accessible at all.
    expect(within(rowOf('Preset 1')).getByText('Current preset')).toBeTruthy()
    expect(within(rowOf('Timed')).queryByText('Current preset')).toBeNull()
    expect(within(rowOf('Guest')).getByText('Amnesic')).toBeTruthy()
    expect(within(rowOf('Timed')).queryByText('Amnesic')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('New Preset', () => {
  it('appends a preset and does NOT switch to it', () => {
    openManager()
    tap(within(card()).getByRole('button', { name: 'New Preset' }))
    expect(listedNames()).toEqual(['Preset 1', 'Preset 2'])
    // ★ CREATING AND OPENING ARE SEPARATE ACTS (store/presetControl's createPreset contract), so
    // that making a preset cannot yank a player out of the round they are in. The ✓ is the user-
    // visible half of the same claim and is asserted beside the store's.
    expect(registry().activeId).toBe(1)
    expect(within(rowOf('Preset 1')).getByText('Current preset')).toBeTruthy()
    expect(within(rowOf('Preset 2')).queryByText('Current preset')).toBeNull()
  })

  it('the new preset starts from FACTORY DEFAULTS, not from a copy of the one you are on', () => {
    // The owner's call, and the case that would catch a "duplicate the current preset" creeping in.
    // Julian Calendar is the evidence: it ships ON, so turning it OFF here makes preset 1 visibly
    // unlike the factory, and a preset that opened holding a copy would arrive with it off too.
    // Nothing in the card implements this — store/presets' mergeOverDefaults is what turns "no
    // saved copy" into the factory values instead of whatever was in memory — which is exactly why
    // it is worth an assertion: the guarantee lives one layer down and could be lost without this
    // file changing at all.
    act(() => {
      useSettings.getState().setUseJulian(false)
    })
    openManager()
    tap(within(card()).getByRole('button', { name: 'New Preset' }))
    // The switch is store/presetControl's, not a route this file is about — tests/presetSwitch.dom
    // owns what a switch does, and the top bar's control is tests/presetSwitcher.dom's.
    act(() => {
      switchPreset(2)
    })
    expect(useSettings.getState().useJulian).toBe(true)
    act(() => {
      switchPreset(1)
    })
    expect(useSettings.getState().useJulian).toBe(false) // …and preset 1 kept its own answer
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('renaming', () => {
  const type = (box, text) => act(() => fireEvent.change(box, { target: { value: text } }))
  const enter = (box) => act(() => fireEvent.keyDown(box, { key: 'Enter' }))
  const escape = (box) => act(() => fireEvent.keyDown(box, { key: 'Escape' }))
  const focus = (box) => act(() => box.focus())

  it('Enter commits, and a blur commits', () => {
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Mornings')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Mornings')
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Evenings')
    act(() => nameBoxes()[0].blur())
    expect(registry().presets[0].name).toBe('Evenings')
  })

  it('Escape DISCARDS the edit, keeps the card up, and does not close the ⚙ panel', () => {
    // ⚠ THIS IS THE ⚙ YEAR BOXES' BUG, RE-ASKED. Their round-14 defect was that clearing the
    // pending text and blurring landed in ONE React batch, so the onBlur that followed still saw
    // the PRE-discard text and committed the very edit Escape was throwing away — invisible unless
    // you look at what was saved, because the field itself did revert. The card flushes the
    // discard before the blur; this asserts the STORE, which is the half that was lying.
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Throwaway')
    escape(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Preset 1')
    expect(nameBoxes()[0].value).toBe('Preset 1')
    // …and the press was consumed on the way, so neither the card nor the panel goes with it.
    expect(queryModalCard('presets')).not.toBeNull()
    expect(document.getElementById('settings-popover')).not.toBeNull()
  })

  it('coming back to the app does not throw away a half-typed name', () => {
    // ⚠ THE ONE CASE THE onFocus GUARD EXISTS FOR, and it is easy to mistake for dead code. Moving
    // between rows always BLURS first, and a blur commits and clears the pending edit — so inside
    // the app the guard is silent. What it covers is a browser re-firing focus on the element that
    // already had it when the WINDOW comes back (iOS does it on every app switch): a focus with no
    // blur in front of it. Delivered here as exactly that — focusin alone, which is the event React
    // listens to — so deleting the guard turns this red.
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Half')
    act(() => fireEvent.focusIn(nameBoxes()[0]))
    expect(nameBoxes()[0].value).toBe('Half')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Half')
  })

  it('caps the name at MAX_PRESET_NAME as it is typed', () => {
    openManager()
    focus(nameBoxes()[0])
    // maxLength is the BROWSER's half and jsdom does not apply it to a programmatic write, so what
    // this drives is the onChange slice — which is the half that actually holds for a paste.
    type(nameBoxes()[0], 'Monday morning practice')
    expect(nameBoxes()[0].value).toHaveLength(MAX_PRESET_NAME)
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Monday morni')
    // The other half is declared on the element, where a real browser reads it.
    expect(nameBoxes()[0].getAttribute('maxlength')).toBe(String(MAX_PRESET_NAME))
  })

  it('an empty name falls back to the default one rather than saving a nameless preset', () => {
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], '   ')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Preset 1')
  })

  it('renaming one row leaves every other row alone', () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    focus(nameBoxes()[1])
    type(nameBoxes()[1], 'Sprints')
    enter(nameBoxes()[1])
    expect(listedNames()).toEqual(['Preset 1', 'Sprints'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('reordering', () => {
  it('Move down and Move up swap a preset with its neighbour, and change no data', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
    })
    openManager()
    tap(rowButton('Preset 1', 'down'))
    expect(listedNames()).toEqual(['Timed', 'Preset 1', 'Guest'])
    tap(rowButton('Preset 1', 'up'))
    expect(listedNames()).toEqual(['Preset 1', 'Timed', 'Guest'])
    // ★ ORDER IS PRESENTATION AND NOTHING ELSE. Ids are what storage keys are derived from
    // (store/presets' presetKey is a pure function of the id), so a reorder must not renumber
    // anything — if it did, two presets would trade saved copies in silence.
    expect(registry().presets.map((p) => p.id)).toEqual([1, 2, 3])
    expect(registry().activeId).toBe(1)
  })

  it('the ends are withheld in all three ways at once — drawn, announced, and inert', () => {
    // The app's convention (controlClasses' NOT_OFFERED_BTN_CLASS): the class DRAWS it unavailable,
    // aria-disabled ANNOUNCES it, and the handler guard is what is TRUE. Asked as one claim,
    // because any one of them alone passes for a control that is greyed and still fires.
    act(() => {
      createPreset('Timed')
    })
    openManager()
    const up = rowButton('Preset 1', 'up')
    expect(isOffered(up)).toBe(false)
    expect(isDimmed(up)).toBe(true)
    expect(up.getAttribute('aria-disabled')).toBe('true')
    tap(up) // reaches the handler — the app uses aria-disabled precisely so it still can
    expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    const down = rowButton('Timed', 'down')
    expect(isOffered(down)).toBe(false)
    tap(down)
    expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    // …and the two that are NOT at an end are offered, so the case above is a withholding and not
    // a control that never works.
    expect(isOffered(rowButton('Preset 1', 'down'))).toBe(true)
    expect(isOffered(rowButton('Timed', 'up'))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('deleting', () => {
  const seedSavedCopy = (id) => {
    for (const base of Object.values(PRESET_STORE_KEYS))
      localStorage.setItem(presetKey(base, id), '{"state":{},"version":1}')
  }
  const savedCopyKeys = (id) =>
    Object.values(PRESET_STORE_KEYS)
      .map((base) => presetKey(base, id))
      .filter((k) => localStorage.getItem(k) !== null)

  it('asks first, IN THE SAME DIALOG, and Cancel goes back to the list changing nothing', () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    tap(rowButton('Timed', 'delete'))
    // ★ ONE DIALOG, NOT TWO STACKED. The card swaps its own view (components/PresetManager argues
    // why nested modals were refused: two capture-phase Escape handlers on document would take each
    // other down). So the list's title is GONE while the question is up, and there is still exactly
    // one scrim marked for App's click-outside rule.
    expect(queryModalCard('presets')).toBeNull()
    expect(confirmCard()).toBeTruthy()
    expect(document.querySelectorAll('[data-settings-modal]')).toHaveLength(1)
    // …and the card that is up has taken the keyboard, which is the term that would silently break
    // if focus had been left to the caller's open-only effect.
    expect(document.activeElement).toBe(confirmCard())
    tap(within(confirmCard()).getByRole('button', { name: 'Cancel' }))
    expect(queryConfirmCard()).toBeNull()
    expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    expect(document.activeElement).toBe(card())
  })

  it('Delete removes the preset AND its saved copy, and touches no neighbour', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
    })
    seedSavedCopy(2)
    seedSavedCopy(3)
    openManager()
    tap(rowButton('Timed', 'delete'))
    tap(within(confirmCard()).getByRole('button', { name: 'Delete' }))
    expect(listedNames()).toEqual(['Preset 1', 'Guest'])
    expect(savedCopyKeys(2)).toEqual([])
    expect(savedCopyKeys(3)).toHaveLength(Object.keys(PRESET_STORE_KEYS).length)
    // Back on the list, with the question gone.
    expect(queryConfirmCard()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('deleting the ACTIVE preset says so first, then opens the neighbour it named', () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    tap(rowButton('Preset 1', 'delete'))
    // The extra sentence appears only for the preset you are standing in, and it NAMES the
    // successor — "you will be moved" without saying where is the half of the truth that helps
    // least. deletePreset picks the row after, or the row before when this was the last.
    expect(within(confirmCard()).getByText(/You are on this preset/)).toBeTruthy()
    expect(within(confirmCard()).getByText('Timed')).toBeTruthy()
    tap(within(confirmCard()).getByRole('button', { name: 'Delete' }))
    expect(registry().activeId).toBe(2)
    expect(listedNames()).toEqual(['Timed'])
    expect(within(rowOf('Timed')).getByText('Current preset')).toBeTruthy()
  })

  it('deleting a preset you are NOT on says nothing about being moved', () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    tap(rowButton('Timed', 'delete'))
    expect(within(confirmCard()).queryByText(/You are on this preset/)).toBeNull()
  })

  it('the LAST preset cannot be deleted — withheld three ways, with the reason on screen', () => {
    // deletePreset refuses the last one outright (the app has no way to render "no presets"), so
    // the control has to say so rather than fail silently on the press.
    openManager()
    const del = within(card()).getByRole('button', { name: 'Delete Preset 1' })
    expect(isOffered(del)).toBe(false)
    expect(isDimmed(del)).toBe(true)
    expect(del.getAttribute('aria-disabled')).toBe('true')
    tap(del)
    expect(queryConfirmCard()).toBeNull() // inert: it does not even reach the question
    expect(registry().presets).toHaveLength(1)
    // A dim states THAT a control is unavailable and can never state WHY, so the card does.
    expect(within(card()).getByText(/There is always at least one preset/)).toBeTruthy()
  })

  it('the reason line and the withholding both lift the moment a second preset exists', () => {
    openManager()
    tap(within(card()).getByRole('button', { name: 'New Preset' }))
    expect(within(card()).queryByText(/There is always at least one preset/)).toBeNull()
    expect(isOffered(within(card()).getByRole('button', { name: 'Delete Preset 1' }))).toBe(true)
    expect(isOffered(within(card()).getByRole('button', { name: 'Delete Preset 2' }))).toBe(true)
  })
})
