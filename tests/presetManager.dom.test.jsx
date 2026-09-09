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
// buttons are comfortable under a thumb, whether a typed name fits beside them at 360px, whether
// the list's scroll region ever shows its fades, and whether a newly created preset scrolls into
// view are ALL DEVICE QUESTIONS and only the owner's iPhone can answer them. What is asserted below
// is the structure and the behaviour those outcomes rest on.
// ⚠ AND — SPECIFICALLY FOR THE RENAME FIELD'S WIDTH CAP (Q6, round 20) — lib/presetNameWidth's own
// measurement is MOCKED in this file rather than exercised for real: jsdom has no canvas either
// (verified in tests/presetNameWidth.dom, which owns the real mechanism end to end, fake canvas and
// all), so what belongs here is narrower — does PresetManager's onChange call that function with
// the typed candidate and TRUST its answer, does the width-language note track `capped` for the
// right row and no other, does it clear on commit and on discard. The measurement itself is a
// different file's claim to make.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// The mock: onChange's ONE call into lib/presetNameWidth, controllable per test. Defaults to
// "everything fits, unchanged" (the shape every case that is not ABOUT the cap wants), so cases
// which do not mention it at all keep typing exactly what they type — the pre-Q6 behaviour, and
// the same reason a mock with a sane default beats a mock every case must configure.
const presetNameWidth = vi.hoisted(() => ({
  capCandidateToSwitcherWidth: vi.fn((candidate) => ({ text: candidate, capped: false })),
}))
vi.mock('../src/lib/presetNameWidth.js', () => presetNameWidth)

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
// The row div this file queries by — the name box's OWN parent, i.e. the inner flex row (checkmark,
// name box, amnesic marker, handle, ✕). The OUTER div one level up is components/PresetManager's own
// ref target for measuring the row's real position and applying its live drag transform — nothing in
// this file needs that one, since jsdom cannot lay it out anyway (the pointer-wiring cases below stub
// getBoundingClientRect directly on it, reached via `rowOf(name).parentElement`).
const rowOf = (name) => nameBoxes().find((el) => el.value === name).parentElement
// The row's remaining named controls. Delete names the preset outright ("Delete Weekend"), because a
// button has no value of its own to be read out — where the name BOX does, which is why that one is
// called only "Preset name".
const ROW_ACTION_NAMES = {
  delete: (name) => `Delete ${name}`,
}
const rowButton = (name, action) =>
  within(rowOf(name)).getByRole('button', { name: ROW_ACTION_NAMES[action](name) })
// The reorder handle. Its accessible name carries the row's CURRENT POSITION (components/
// PresetManager's own reasoning: with no aria-live anywhere in this app, a changed name on a still-
// FOCUSED element is what a screen reader announces after a keyboard move), so — unlike Delete — it
// cannot be looked up by a fixed string: this matches the stable "Reorder NAME, position " prefix and
// leaves the trailing "N of M" free to change out from under a test that just reordered the list.
const reorderHandle = (name) =>
  within(rowOf(name)).getByRole('button', {
    name: new RegExp(`^Reorder ${name}, position \\d+ of \\d+$`),
  })
const registry = () => usePresets.getState()

beforeEach(() => {
  resetAppState()
  // Back to the "everything fits, unchanged" default before every case — a test that configures
  // its own answer does so inside itself, and must not leak it into the next one.
  presetNameWidth.capCandidateToSwitcherWidth.mockReset()
  presetNameWidth.capCandidateToSwitcherWidth.mockImplementation((candidate) => ({
    text: candidate,
    capped: false,
  }))
})
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
  // The EXACT note text, never a loose substring — "display" alone also matches unrelated prose
  // elsewhere in the mounted app (the ⚙ panel's date-format copy, the guide). This is also the
  // width-language claim itself: the whole point is that it never mentions a character count.
  const capNote = () => screen.queryByText("That's as long as this name can display.")

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

  // ── The live, pixel-width typing cap (Q6, round 20) ─────────────────────────────────────────
  //
  // lib/presetNameWidth is MOCKED for this whole file (see the ⚠ at the top) — these cases are
  // about the WIRING: does every keystroke reach it with the raw candidate, does the field show
  // what it returns rather than the raw typed text, does the width-language note track its
  // `capped` flag for the right row and clear at the right moments. tests/presetNameWidth.dom owns
  // whether the real measurement is CORRECT.
  it('calls the width cap on every keystroke, with the typed candidate, and shows what it returns', () => {
    openManager()
    presetNameWidth.capCandidateToSwitcherWidth.mockImplementation((candidate) => ({
      text: candidate.toUpperCase(), // a deliberately-wrong echo, so the field must be SHOWING it
      capped: false,
    }))
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'weekend')
    expect(presetNameWidth.capCandidateToSwitcherWidth).toHaveBeenCalledWith('weekend')
    // The field shows the FUNCTION's answer, not the raw keystroke — proving onChange trusts it
    // rather than mirroring the event value straight through.
    expect(nameBoxes()[0].value).toBe('WEEKEND')
  })

  it('shows a WIDTH-language note exactly while the field is capped, never a character count', () => {
    openManager()
    presetNameWidth.capCandidateToSwitcherWidth.mockImplementation((candidate) => ({
      text: candidate.slice(0, 5),
      capped: candidate.length > 5,
    }))
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Week')
    expect(capNote()).toBeNull() // fits — no note yet
    type(nameBoxes()[0], 'Weekend')
    expect(capNote()).toBeTruthy()
    // …and a backspace back under budget un-refuses it, exactly like `capped` going false again.
    type(nameBoxes()[0], 'Week')
    expect(capNote()).toBeNull()
  })

  it('clears the note on commit (Enter) and on discard (Escape)', () => {
    openManager()
    presetNameWidth.capCandidateToSwitcherWidth.mockReturnValue({ text: 'Weeke', capped: true })
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    expect(capNote()).toBeTruthy()
    enter(nameBoxes()[0])
    expect(capNote()).toBeNull()

    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    expect(capNote()).toBeTruthy()
    escape(nameBoxes()[0])
    expect(capNote()).toBeNull()
  })

  it("does not leak one row's capped note onto another row", () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    presetNameWidth.capCandidateToSwitcherWidth.mockReturnValue({ text: 'Weeke', capped: true })
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    expect(capNote()).toBeTruthy()
    // Moving to the second row blurs the first (which commits and clears the flag via
    // commitRename) before this row's own onFocus seeds a fresh edit — onFocus never calls the
    // width cap at all, only onChange does, so there is nothing here FOR a leak to ride in on.
    focus(nameBoxes()[1])
    expect(capNote()).toBeNull()
  })

  it('the trimmed text is what actually gets SAVED, exactly as typed for a fit that never trims', () => {
    openManager()
    presetNameWidth.capCandidateToSwitcherWidth.mockReturnValue({ text: 'Weeke', capped: true })
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Weeke')
  })

  it('maxLength stays on the element as a coarser, independent backstop', () => {
    // The store's own hard ceiling (store/presets' MAX_PRESET_NAME) — no longer sized to fit the
    // switcher exactly, but still the last line of defence if the live width cap cannot run at
    // all. The width cap is mocked in this file, so this case only pins the ATTRIBUTE itself, not
    // which of the two cuts actually catches a given keystroke.
    openManager()
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
// reordering — the DRAG HANDLE (Q7, round 20), replacing the ↑/↓ buttons this round removed.
//
// Three groups: the KEYBOARD path (ArrowUp/ArrowDown on the handle — fully provable in jsdom, no
// layout needed), the POINTER path (a real pointerdown → pointermove → pointerup/cancel sequence
// against the actual handlers, jsdom's getBoundingClientRect limitation worked around the same way
// tests/presetNameWidth.dom does — stub the method per element rather than trust a real layout),
// and the handle's own STRUCTURE (touch-action, no disabled state). None of this can prove the
// gesture FEELS right — that is a device-only question, stated at the top of this file.
describe('reordering', () => {
  describe('the keyboard path', () => {
    it('ArrowDown and ArrowUp on the handle swap a preset with its neighbour, and change no data', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowDown' }))
      expect(listedNames()).toEqual(['Timed', 'Preset 1', 'Guest'])
      act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowUp' }))
      expect(listedNames()).toEqual(['Preset 1', 'Timed', 'Guest'])
      // ★ ORDER IS PRESENTATION AND NOTHING ELSE. Ids are what storage keys are derived from
      // (store/presets' presetKey is a pure function of the id), so a reorder must not renumber
      // anything — if it did, two presets would trade saved copies in silence.
      expect(registry().presets.map((p) => p.id)).toEqual([1, 2, 3])
      expect(registry().activeId).toBe(1)
    })

    it('boundary presses at either end are silent no-ops — no disabled visual, matching the design', () => {
      // The handle has no end it cannot move toward the way the old buttons did (movePreset's own
      // bounds check is the only guard, silently refusing rather than the handler pre-checking) —
      // so this asks for the ABSENCE of aria-disabled too, not only that the press does nothing.
      act(() => {
        createPreset('Timed')
      })
      openManager()
      const first = reorderHandle('Preset 1')
      expect(first.hasAttribute('aria-disabled')).toBe(false)
      act(() => fireEvent.keyDown(first, { key: 'ArrowUp' }))
      expect(listedNames()).toEqual(['Preset 1', 'Timed'])
      const last = reorderHandle('Timed')
      expect(last.hasAttribute('aria-disabled')).toBe(false)
      act(() => fireEvent.keyDown(last, { key: 'ArrowDown' }))
      expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    })

    it('the accessible name carries the CURRENT position, and updates after a move', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      expect(reorderHandle('Preset 1').getAttribute('aria-label')).toBe(
        'Reorder Preset 1, position 1 of 3',
      )
      act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowDown' }))
      expect(reorderHandle('Preset 1').getAttribute('aria-label')).toBe(
        'Reorder Preset 1, position 2 of 3',
      )
    })

    // ★★ THE ONE PIECE OF THE ACCESSIBILITY STORY THAT SILENTLY FAILS IF WRONG (the brief's own
    // words) — this app uses NO aria-live anywhere (SettingsPanel's Check-for-updates button
    // argues why), so the new position is announced ONLY if the SAME element stays focused across
    // the re-render that follows a move. Proved here, not assumed: focus a handle, move it, and
    // check document.activeElement is the handle for that SAME preset at its NEW position — not
    // merely "a handle", and not <body>.
    it('focus survives a keyboard reorder onto the SAME preset`s handle at its new position', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      const handle = reorderHandle('Preset 1')
      act(() => handle.focus())
      expect(document.activeElement).toBe(handle)
      act(() => fireEvent.keyDown(handle, { key: 'ArrowDown' }))
      const movedHandle = reorderHandle('Preset 1')
      expect(document.activeElement).toBe(movedHandle)
      expect(movedHandle.getAttribute('aria-label')).toBe('Reorder Preset 1, position 2 of 3')
      // Two more moves, back-to-back, to prove it is not a one-shot coincidence.
      act(() => fireEvent.keyDown(movedHandle, { key: 'ArrowDown' }))
      expect(document.activeElement).toBe(reorderHandle('Preset 1'))
      expect(document.activeElement.getAttribute('aria-label')).toBe(
        'Reorder Preset 1, position 3 of 3',
      )
    })

    it('preventDefault keeps the arrow keys from also scrolling the modal', () => {
      openManager()
      const evt = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
      reorderHandle('Preset 1').dispatchEvent(evt)
      expect(evt.defaultPrevented).toBe(true)
    })
  })

  describe('the handle`s own structure', () => {
    it('touch-action:none sits on the handle only — never the row, never the list container', () => {
      openManager()
      expect(reorderHandle('Preset 1').style.touchAction).toBe('none')
      expect(rowOf('Preset 1').style.touchAction).toBe('')
      expect(rowOf('Preset 1').parentElement.style.touchAction).toBe('')
      // The scroll region — components/scrollRegion's SCROLL_REGION_CLASS div wrapping every row.
      expect(rowOf('Preset 1').parentElement.parentElement.style.touchAction).toBe('')
    })

    it('is a div with role="button", never a native <button>', () => {
      // The reason is mechanical, not cosmetic (components/PresetManager's own comment on the
      // handle): lib/pointerGestures' global press-drag controller latches onto anything a bare
      // `closest('button')` finds, so a real <button> here would be swept into that unrelated,
      // document-level gesture system on every press. Asserted directly on the tag, which is the
      // one thing a role attribute cannot fake.
      openManager()
      expect(reorderHandle('Preset 1').tagName).toBe('DIV')
    })
  })

  // ── The pointer path — a real pointerdown/pointermove/pointerup(-or-cancel) sequence ─────────
  describe('the pointer path', () => {
    // jsdom has NO LAYOUT ENGINE — getBoundingClientRect reports a zero rect for every element
    // unless stubbed (the same limitation tests/presetNameWidth.dom works around the same way:
    // override the method on the specific element rather than trust a real layout). Each row is
    // given a FABRICATED, evenly-spaced rect — the exact shape lib/presetReorder's own pure tests
    // already prove the arithmetic against — so what this group proves is the WIRING: does a real
    // gesture on the handle end up calling movePreset the right number of times, in the right
    // direction. Whether the drag LOOKS right is a device-only question (top of this file).
    const ROW_HEIGHT = 40
    const stubRowRects = (names) => {
      names.forEach((name, i) => {
        const top = i * ROW_HEIGHT
        // The OUTER div — one level up from `rowOf`'s inner flex row — is components/PresetManager's
        // own ref target (rowRefs), and so the element beginDrag actually measures.
        rowOf(name).parentElement.getBoundingClientRect = () => ({
          top,
          bottom: top + ROW_HEIGHT,
          height: ROW_HEIGHT,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
        })
      })
    }
    // jsdom ships NO PointerEvent constructor — the exact limitation tests/helpers/settingsPanel's
    // own pointerEvent() works around, by the same recipe: a hand-built MouseEvent carrying
    // pointerId/isPrimary/pointerType/clientY, which is everything the real guards and handlers
    // below read. `button: 0` so the mouse-button guard in beginDrag passes.
    const pointerEvt = (type, clientY) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })
      Object.defineProperty(e, 'pointerId', { value: 7 })
      Object.defineProperty(e, 'isPrimary', { value: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      return e
    }

    it('a full drag past a neighbour reorders the presets, and touches no id', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      // Preset 1 / Timed / Guest start at centers 20 / 60 / 100.
      stubRowRects(['Preset 1', 'Timed', 'Guest'])
      const handle = reorderHandle('Preset 1')
      act(() => handle.dispatchEvent(pointerEvt('pointerdown', 20)))
      // Drags Preset 1's own center from 20 to 85 — past Timed's center (60) and Guest's (100) is
      // still ahead, resolving to the last slot.
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 85)))
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 85)))
      expect(listedNames()).toEqual(['Timed', 'Guest', 'Preset 1'])
      // ★ ORDER IS PRESENTATION AND NOTHING ELSE. The ARRAY order changed (that is the whole
      // point), but no preset traded its id for another's — ids are what storage keys are derived
      // from (store/presets' presetKey is a pure function of the id), so a reorder renumbering one
      // would mean two presets silently trading saved copies.
      const byId = Object.fromEntries(registry().presets.map((p) => [p.id, p.name]))
      expect(byId).toEqual({ 1: 'Preset 1', 2: 'Timed', 3: 'Guest' })
    })

    // ★★ THE INVARIANT THE fix to lib/presetReorder exists for: a drag that goes somewhere and
    // then comes BACK to exactly where it started, released there, must change nothing — not "the
    // neighbouring slot", nothing. Before that fix, `targetIndexForCenter` treated landing exactly
    // on a row's OWN resting center as having already passed it, so even a round-trip back to the
    // start previewed (and, on release, committed) a swap nothing asked for.
    it('a drag that returns to its own start slot before releasing changes nothing', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Preset 1')
      act(() => handle.dispatchEvent(pointerEvt('pointerdown', 20)))
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 50))) // partway toward Timed
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 20))) // …and back to exactly the start
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 20)))
      expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    })

    it('pointercancel commits wherever the preview currently sits, exactly like pointerup', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Preset 1')
      act(() => handle.dispatchEvent(pointerEvt('pointerdown', 20)))
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 61)))
      act(() => handle.dispatchEvent(pointerEvt('pointercancel', 61)))
      expect(listedNames()).toEqual(['Timed', 'Preset 1'])
    })

    it('a non-primary pointer (a second finger) cannot start a drag', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Preset 1')
      const e = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientY: 20,
      })
      Object.defineProperty(e, 'pointerId', { value: 9 })
      Object.defineProperty(e, 'isPrimary', { value: false }) // the guard this case exists to prove
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      act(() => handle.dispatchEvent(e))
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 61)))
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 61)))
      expect(listedNames()).toEqual(['Preset 1', 'Timed']) // no drag ever latched, nothing moved
    })

    it('a right mouse button cannot start a drag', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Preset 1')
      const e = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientY: 20,
      })
      Object.defineProperty(e, 'pointerId', { value: 9 })
      Object.defineProperty(e, 'isPrimary', { value: true })
      Object.defineProperty(e, 'pointerType', { value: 'mouse' }) // the guard only applies to mice
      act(() => handle.dispatchEvent(e))
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 61)))
      expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    })
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
