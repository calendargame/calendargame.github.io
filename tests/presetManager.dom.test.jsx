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
// ⚠ AND — SPECIFICALLY FOR THE RENAME FIELD'S "CUT SHORT" NOTE — jsdom has no canvas and no widths,
// so no name is ever too long for anything here unless a case says how wide things are. The cases
// that are about the note do exactly that, through tests/helpers/nameRooms: the real app, with the
// name cells given a width and text a width per character. Nothing of lib/presetNameWidth is
// mocked; tests/presetNameWidth.dom owns the measurement itself, in every font and place.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, screen, within, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  openSettings,
  openModal,
  modalCard,
  queryModalCard,
  managePresetsButton,
  modalScrim,
  picker,
  pressBack,
  drainHistory,
  pressDragFromGear,
  pressKey,
  isSettingsOpen,
  tap,
  isOffered,
  isDimmed,
} from './helpers/settingsPanel.jsx'
import { usePresets, PRESET_STORE_KEYS, presetKey } from '../src/store/presets.js'
import {
  createPreset,
  renamePreset,
  setPresetAmnesic,
  switchPreset,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { hasSessionRound } from '../src/store/sessionRound.js'
import { KEYBOARD_ATTR } from '../src/lib/keyboardFocus.js'
import { installNameRooms, PX_PER_CHARACTER } from './helpers/nameRooms.js'
import { NAME_DRAWN_UNITS, NAME_QUOTED_CHARACTERS } from '../src/lib/presetNameText.js'

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
// The row div this file queries by — the name box's OWN parent, i.e. the inner grid row (✕, name
// box, current-preset marker, amnesic marker, grip — in that order since round 23). The OUTER div one level up is components/PresetManager's own
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
// PresetManager's own reasoning: a changed name on a still-FOCUSED element is what a screen reader
// announces after a keyboard move, with nothing else to wire), so — unlike Delete — it
// cannot be looked up by a fixed string: this matches the stable "Reorder NAME, position " prefix and
// leaves the trailing "N of M" free to change out from under a test that just reordered the list.
const reorderHandle = (name) =>
  within(rowOf(name)).getByRole('button', {
    name: new RegExp(`^Reorder ${name}, position \\d+ of \\d+$`),
  })
const registry = () => usePresets.getState()

// The layout a case about the "cut short" note installs (tests/helpers/nameRooms) — taken down
// again after every case, installed or not.
let nameRooms = null
const layOutNameCells = (widthPx) => {
  nameRooms = installNameRooms(widthPx)
  return nameRooms
}

beforeEach(() => {
  resetAppState()
})
afterEach(() => {
  nameRooms?.restore()
  nameRooms = null
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
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // round 21 removed the Close button
    // The section's own text, read off the block the button lives in — the name sits inside a <b>,
    // so it is only whole at the section level.
    expect(managePresetsButton().parentElement.textContent).toContain('You are on Mornings.')
  })

  // ★ A NAME HAS NO LENGTH LIMIT, SO EVERYTHING THAT QUOTES ONE HAS TO COPE WITH A BOOK. The rename
  // box holds the whole name; everything else on this card and in the panel behind it shows a
  // bounded part of it (lib/presetNameText), so no sentence can push a button out of reach and no
  // screen is handed a million characters to lay out.
  describe('a preset whose name is a pasted book', () => {
    const BOOK = 'All work and no play. '.repeat(50_000).trim() // 1,099,999 characters
    const QUOTED = BOOK.slice(0, NAME_QUOTED_CHARACTERS) + '…'
    const withABook = () => {
      act(() => {
        renamePreset(1, BOOK)
        createPreset('Timed')
        useSettings.getState().setSaveStats(false) // preset 1 holds something: deleting it asks
      })
    }

    it('its own box holds every character of it', () => {
      withABook()
      openManager()
      expect(nameBoxes()[0].value).toBe(BOOK)
    })

    it('the ⚙ menu`s "You are on …" quotes its start, and may break it anywhere', () => {
      withABook()
      openManager()
      const section = managePresetsButton().parentElement
      const quoted = section.querySelector('b')
      expect(quoted.textContent).toBe(QUOTED)
      expect(quoted.className).toBe('wrap-anywhere')
      expect(section.textContent).toContain(`You are on ${QUOTED}. The three buttons`)
    })

    it('the delete question quotes its start — as the preset going, and as the one that opens', () => {
      withABook()
      act(() => {
        switchPreset(2)
        useSettings.getState().setSaveStats(false)
      })
      openManager()
      // Preset 2 is the one you are on; deleting it opens the book.
      tap(within(rowOf('Timed')).getByRole('button', { name: 'Delete Timed' }))
      const [going, opens] = confirmCard().querySelectorAll('b')
      expect(going.textContent).toBe('Timed')
      expect(opens.textContent).toBe(QUOTED)
      expect(opens.className).toContain('wrap-anywhere')
      act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
      // …and the book itself going.
      tap(within(rowOf(BOOK)).getByRole('button', { name: /^Delete / }))
      expect(confirmCard().querySelector('b').textContent).toBe(QUOTED)
      expect(confirmCard().textContent.length).toBeLessThan(600)
      expect(within(confirmCard()).getByRole('button', { name: 'Delete' })).toBeTruthy()
    })

    it('the row`s two controls name it by a bounded start, never by all of it', () => {
      withABook()
      openManager()
      const row = rowOf(BOOK)
      for (const control of [
        within(row).getByRole('button', { name: /^Delete / }),
        within(row).getByRole('button', { name: /^Reorder / }),
      ]) {
        const name = control.getAttribute('aria-label')
        expect(name.length).toBeLessThan(NAME_DRAWN_UNITS + 60)
        expect(name).toContain(BOOK.slice(0, 200))
      }
    })

    // ★ A QUOTED NAME PAINTS INSIDE ITS OWN LINES. A name can be a letter under hundreds of
    // accents, which stack upwards out of the line and over whatever is above it. Every sentence
    // that quotes a name draws it with components/QuotedName, which sets each such character in a
    // box of its own that clips it (index.css's .stacked-character) and leaves everything else as
    // the plain text it was. jsdom draws nothing, so the boxes and the rule are the contract here;
    // what it looks like — and that an ordinary name is untouched — was checked in a browser.
    it('every sentence that quotes a name boxes its stacked characters, and nothing else', () => {
      const pile = '\u0301\u0302\u0303'.repeat(100)
      const stacked = `Z${pile}algo w${pile}ith é and 👨‍👩‍👧`
      act(() => {
        renamePreset(1, stacked)
        createPreset('Timed')
      })
      // Its text, its boxes, and — between the boxes — the name's ordinary text, accent and emoji
      // and all, as plain text.
      const expectBoxed = (quoted) => {
        expect(quoted.className).toBe('wrap-anywhere')
        expect(quoted.textContent).toBe(stacked)
        const boxes = [...quoted.querySelectorAll('.stacked-character')]
        expect(boxes.map((box) => box.textContent)).toEqual([`Z${pile}`, `w${pile}`])
        expect([...quoted.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data)).toEqual([
          'algo ',
          'ith é and 👨‍👩‍👧',
        ])
      }
      mountApp()
      openSettings()
      expectBoxed(managePresetsButton().parentElement.querySelector('b')) // "You are on …"
      act(() => {
        switchPreset(2)
        useSettings.getState().setSaveStats(false) // preset 2 holds something: deleting it asks
      })
      openModal('presets')
      tap(within(rowOf('Timed')).getByRole('button', { name: 'Delete Timed' }))
      const [going, opens] = confirmCard().querySelectorAll('b')
      expect(going.textContent).toBe('Timed')
      expect(going.children).toHaveLength(0) // an ordinary name: plain text, exactly as before
      expectBoxed(opens) // "…deleting it opens …"
      const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8')
      const rule = /\.stacked-character\s*\{([^}]*)\}/.exec(css)
      expect(rule).not.toBeNull()
      expect(rule[1]).toMatch(/display:\s*inline-block/) // one line tall, and never wrapped
      expect(rule[1]).toMatch(/overflow:\s*clip/) // …and what leaves it is not painted
    })

    it('nothing on the page outside its box carries the book', () => {
      withABook()
      openManager()
      // No run of it longer than a name slot draws is anywhere in the page's text.
      expect(document.body.textContent).not.toContain(BOOK.slice(0, NAME_DRAWN_UNITS + 2))
      expect(document.body.textContent).toContain(BOOK.slice(0, NAME_QUOTED_CHARACTERS))
      for (const el of document.querySelectorAll('[aria-label]'))
        expect(el.getAttribute('aria-label').length).toBeLessThan(NAME_DRAWN_UNITS + 60)
    })
  })

  it('lists every preset in registry order, marks the active one, and SAYS which are amnesic', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
      createPreset('Practice')
    })
    openManager()
    // Guest (id 3) and Practice (id 4) — presets you are NOT on, which the session's Amnesic values
    // answer for all at once. The manager re-renders off that subscription, so the words appear.
    act(() => setPresetAmnesic(3, 'full'))
    act(() => setPresetAmnesic(4, 'stats'))
    expect(listedNames()).toEqual(['Preset 1', 'Timed', 'Guest', 'Practice'])
    // The current-preset mark is asked for by its sr-only WORDS, never by its glyph: a bare ✓ is a
    // picture, and the words are the whole reason the mark is accessible at all.
    expect(within(rowOf('Preset 1')).getByText('Current preset')).toBeTruthy()
    expect(within(rowOf('Timed')).queryByText('Current preset')).toBeNull()
    // Which presets forget is SPOKEN and not drawn — the same words the switcher's list says, and
    // the two kinds told apart.
    expect(within(rowOf('Guest')).getByText('amnesic').className).toContain('sr-only')
    expect(within(rowOf('Practice')).getByText('amnesic, stats only').className).toContain(
      'sr-only',
    )
    expect(within(rowOf('Timed')).queryByText(/amnesic/)).toBeNull()
    // …and no letter stands in for it anywhere in the list.
    for (const name of listedNames()) expect(within(rowOf(name)).queryByText('A')).toBeNull()
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
  // The note, as it is on screen (the visible copy — a screen reader is given the same words through
  // the card's live region, below).
  const NOTE = 'Some places will show this name cut short.'
  const cutNote = () => within(card()).queryByText(NOTE, { ignore: '[aria-live] *' })
  const announced = () => card().querySelector('[aria-live]').textContent
  // Room for exactly ten characters in the narrowest place a name is shown.
  const TEN = 10 * PX_PER_CHARACTER

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

  // ── Nothing is refused, and a note says when a name will be cut short ───────────────────────
  //
  // The field used to refuse the keystroke that would not fit where names are shown. It is a plain
  // text box now: these cases are that nothing typed is ever altered, and that the note follows the
  // text and the room exactly (tests/presetNameWidth.dom owns the measurement itself).
  it('takes whatever is typed or pasted, however long, and saves exactly that', () => {
    openManager()
    layOutNameCells(TEN)
    const long = 'A name far longer than anywhere could ever show: ' + 'x'.repeat(500)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], long)
    expect(nameBoxes()[0].value).toBe(long)
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe(long)
  })

  it('the field has no length limit of its own, and takes an emoji whole', () => {
    openManager()
    layOutNameCells(TEN)
    expect(nameBoxes()[0].hasAttribute('maxlength')).toBe(false)
    const name = 'Weekend Mornings 👨‍👩‍👧🇨🇦'
    focus(nameBoxes()[0])
    type(nameBoxes()[0], name)
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe(name)
  })

  it('the note appears at the exact character that stops fitting, and goes at the one that fits', () => {
    openManager()
    layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mo') // ten: exactly the room
    expect(cutNote()).toBeNull()
    type(nameBoxes()[0], 'Weekend Mor') // eleven
    expect(cutNote()).toBeTruthy()
    expect(nameBoxes()[0].value).toBe('Weekend Mor') // …and the letter went in all the same
    type(nameBoxes()[0], 'Weekend Morn')
    expect(cutNote()).toBeTruthy()
    type(nameBoxes()[0], 'Weekend Mo') // back to ten
    expect(cutNote()).toBeNull()
  })

  it('is about the name the text would be SAVED as: a trailing space, or an emptied box, raise nothing', () => {
    openManager()
    layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mo') // exactly the room
    type(nameBoxes()[0], 'Weekend Mo ') // …and the space before the next word: trimmed on saving
    expect(cutNote()).toBeNull()
    type(nameBoxes()[0], '   Weekend Mo   ')
    expect(cutNote()).toBeNull()
    type(nameBoxes()[0], 'Weekend Mo x')
    expect(cutNote()).toBeTruthy()
    // An emptied box is about to be "Preset 1" again — eight characters, which fit here.
    type(nameBoxes()[0], '')
    expect(cutNote()).toBeNull()
  })

  it('a stock name is cut only where even its short form is: "Preset 1" is drawn as "P1"', () => {
    openManager()
    layOutNameCells(7 * PX_PER_CHARACTER) // "Preset 1" is eight
    focus(nameBoxes()[0])
    expect(nameBoxes()[0].value).toBe('Preset 1') // the box always holds the stored name
    expect(cutNote()).toBeNull() // …which is shown as "P1", whole
    type(nameBoxes()[0], 'Preset 1!') // no longer a stock name: nine characters, cut
    expect(cutNote()).toBeTruthy()
    type(nameBoxes()[0], 'Preset 12') // stock again: "P12"
    expect(cutNote()).toBeNull()
    type(nameBoxes()[0], '') // about to be "Preset 1" again
    expect(cutNote()).toBeNull()
    nameRooms.resize(1 * PX_PER_CHARACTER) // not even "P1" fits
    expect(cutNote()).toBeTruthy()
  })

  it('a stock name drawn short is still the stored name everywhere it is not a name slot', () => {
    act(() => {
      createPreset()
      useSettings.getState().setSaveStats(false) // preset 1 holds something: deleting it asks
    })
    openManager()
    layOutNameCells(7 * PX_PER_CHARACTER)
    // The slots draw the short forms…
    expect(screen.getByRole('button', { name: /^Preset,/ }).textContent).toContain('P1')
    const openIn = within(document.getElementById('settings-popover')).getByRole('button', {
      name: /^Open in/,
    })
    const drawnByOpenIn = [...openIn.parentElement.querySelectorAll('[data-preset-name-cell]')].map(
      (cell) => cell.firstElementChild.textContent,
    )
    expect(drawnByOpenIn).toEqual(['P1', 'P2', 'P1', 'P2']) // its button's stack, and its list
    // …and nothing else does: the boxes, the two controls beside them, the menu's sentence, and
    // the delete question all say the stored name.
    expect(listedNames()).toEqual(['Preset 1', 'Preset 2'])
    expect(rowButton('Preset 2', 'delete')).toBeTruthy()
    expect(reorderHandle('Preset 2')).toBeTruthy()
    expect(managePresetsButton().parentElement.textContent).toContain('You are on Preset 1.')
    tap(rowButton('Preset 1', 'delete'))
    const [going, opens] = confirmCard().querySelectorAll('b')
    expect(going.textContent).toBe('Preset 1')
    expect(opens.textContent).toBe('Preset 2')
    expect(registry().presets.map((p) => p.name)).toEqual(['Preset 1', 'Preset 2'])
  })

  it('is there the moment a stored name that is already too long is focused', () => {
    act(() => {
      renamePreset(1, 'A name made on a much wider screen')
    })
    openManager()
    layOutNameCells(TEN)
    expect(cutNote()).toBeNull() // nothing is being edited
    focus(nameBoxes()[0])
    expect(cutNote()).toBeTruthy()
    // …and leaving it changes nothing about what is stored.
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('A name made on a much wider screen')
    expect(cutNote()).toBeNull()
  })

  it('follows the room while the field is open — a rotation, a resize', () => {
    openManager()
    const cells = layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings') // sixteen
    expect(cutNote()).toBeTruthy()
    cells.resize(16 * PX_PER_CHARACTER) // the screen turned: there is room now
    expect(cutNote()).toBeNull()
    cells.resize(15 * PX_PER_CHARACTER)
    expect(cutNote()).toBeTruthy()
  })

  it('goes on commit (Enter) and on discard (Escape)', () => {
    openManager()
    layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    expect(cutNote()).toBeTruthy()
    enter(nameBoxes()[0])
    expect(cutNote()).toBeNull()

    focus(nameBoxes()[0])
    expect(cutNote()).toBeTruthy() // the saved name is too long, and its field is open again
    escape(nameBoxes()[0])
    expect(cutNote()).toBeNull()
  })

  it("is only ever under the row being typed into, never another row's", () => {
    act(() => {
      createPreset('Timed')
    })
    openManager()
    layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mornings')
    expect(within(rowOf('Weekend Mornings')).queryByText(NOTE)).toBeTruthy()
    // Moving to the second row blurs the first, which commits it: the long name is saved, and the
    // note is about the row the keyboard is in now, whose name fits.
    focus(nameBoxes()[1])
    expect(cutNote()).toBeNull()
    expect(listedNames()).toEqual(['Weekend Mornings', 'Timed'])
  })

  it('is said to a screen reader once per appearance, through one polite live region', () => {
    openManager()
    layOutNameCells(TEN)
    const region = card().querySelector('[aria-live]')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(card().querySelectorAll('[aria-live]')).toHaveLength(1)
    // The region is there BEFORE there is anything to say: a region that arrives with its words
    // already in it is not reliably read.
    expect(announced()).toBe('')
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Mor')
    expect(announced()).toBe(NOTE)
    // More typing while the note stays is the same element with the same words — nothing a screen
    // reader would say again.
    const words = region.firstChild
    type(nameBoxes()[0], 'Weekend Morni')
    expect(region.firstChild).toBe(words)
    type(nameBoxes()[0], 'Weekend')
    expect(announced()).toBe('')
    type(nameBoxes()[0], 'Weekend Mor')
    expect(announced()).toBe(NOTE) // a new appearance
    // The copy on screen is not read as well.
    expect(cutNote().getAttribute('aria-hidden')).toBe('true')
  })

  it('a pasted book goes in, and its note costs no measuring at all', () => {
    openManager()
    layOutNameCells(TEN)
    const measure = vi.fn(() => ({ width: 0 }))
    const getContext = window.HTMLCanvasElement.prototype.getContext
    window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: measure })
    try {
      const book = 'All work and no play. '.repeat(5_000) // 110,000 characters
      focus(nameBoxes()[0])
      type(nameBoxes()[0], book)
      expect(nameBoxes()[0].value).toBe(book)
      expect(cutNote()).toBeTruthy()
      expect(measure.mock.calls.every(([text]) => text.length < 1000)).toBe(true)
    } finally {
      window.HTMLCanvasElement.prototype.getContext = getContext
    }
  })

  it('a key pressed to an input method is not a verdict on the rename', () => {
    // Enter picks the composed text and Escape abandons it; neither saves or discards the name.
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'にほ')
    act(() => fireEvent.keyDown(nameBoxes()[0], { key: 'Enter', isComposing: true }))
    expect(registry().presets[0].name).toBe('Preset 1')
    act(() => fireEvent.keyDown(nameBoxes()[0], { key: 'Escape', keyCode: 229 }))
    expect(nameBoxes()[0].value).toBe('にほ')
    type(nameBoxes()[0], '日本')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('日本')
  })

  it('an empty name falls back to the default one rather than saving a nameless preset', () => {
    openManager()
    focus(nameBoxes()[0])
    type(nameBoxes()[0], '   ')
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Preset 1')
  })

  it('a name of characters that draw nothing is an empty name too, in the box and in its note', () => {
    openManager()
    layOutNameCells(TEN)
    focus(nameBoxes()[0])
    type(nameBoxes()[0], 'Weekend Morning')
    expect(cutNote()).toBeTruthy()
    // Thirty zero-width spaces and Hangul fillers: more characters than fit, and nothing to draw.
    // It is about to be "Preset 1", which fits, so there is no note.
    type(nameBoxes()[0], '​ㅤ'.repeat(15))
    expect(cutNote()).toBeNull()
    enter(nameBoxes()[0])
    expect(registry().presets[0].name).toBe('Preset 1')
    expect(nameBoxes()[0].value).toBe('Preset 1')
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
// reordering — the DRAG HANDLE (round 20), replacing the ↑/↓ buttons this round removed.
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
    // words) — a move is announced by the handle's own changed name and by nothing else (the
    // card's one live region is for the notes under a name box), so the new position is heard
    // ONLY if the SAME element stays focused across the re-render that follows a move. Proved here, not assumed: focus a handle, move it, and
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

  // ★ THE ROW HAS TWO ORDERS, AND BOTH ARE THE POINT.
  // ON SCREEN it is the iPhone reorder-list convention: the grip is grabbed over and over, the ✕ is
  // destructive (and deletes an untouched preset without asking), so they sit at opposite ends — ✕
  // at the LEFT, grip at the RIGHT, the name and the current-preset mark between them.
  // IN THE MARKUP — the order Tab walks and a screen reader reads — the ✕ comes LAST: name, ✓,
  // grip, ✕. On-screen order in the markup made "Delete <first preset>" the first Tab stop of the
  // popup, one Enter away from deleting an untouched preset unasked.
  describe('the row layout', () => {
    const column = (el) => /(?:^|\s)col-start-(\d)(?:\s|$)/.exec(el.className)?.[1]
    it('reads ✕, name, ✓, grip — left to right on screen, with no column kept for an amnesic mark', () => {
      let guestId
      act(() => {
        guestId = createPreset('Guest').id
      })
      openManager()
      act(() => setPresetAmnesic(guestId, 'full'))
      // jsdom lays nothing out, so "on screen" is read off the grid placement each cell declares.
      // A row's CELLS are its children that take a column; the spoken word for an amnesic preset is
      // positioned out of flow (sr-only) and takes none.
      const onScreen = (name) =>
        [...rowOf(name).children].filter(column).sort((a, b) => column(a) - column(b))
      const cells = onScreen('Preset 1')
      expect(cells.map(column)).toEqual(['1', '2', '3', '4'])
      expect(cells.every((c) => /(?:^|\s)row-start-1(?:\s|$)/.test(c.className))).toBe(true)
      expect(cells[0]).toBe(rowButton('Preset 1', 'delete'))
      expect(cells[1]).toBe(nameBoxes()[0])
      expect(cells[2].textContent).toBe('✓Current preset')
      expect(cells[3]).toBe(reorderHandle('Preset 1'))
      // The amnesic row has exactly the same four cells — the name box loses no width to a marker —
      // and the grid is declared four columns wide, not five.
      const guest = onScreen('Guest')
      expect(guest.map(column)).toEqual(['1', '2', '3', '4'])
      expect(guest[2].textContent).toBe('') // not the current preset; that slot is still reserved
      expect(guest[3]).toBe(reorderHandle('Guest'))
      expect(rowOf('Guest').className).toContain('grid-cols-[auto_minmax(0,1fr)_auto_auto]')
      const spoken = [...rowOf('Guest').children].filter((el) => !column(el))
      expect(spoken.map((el) => [el.className, el.textContent])).toEqual([['sr-only', 'amnesic']])
    })

    it('reads name, ✓, grip, ✕ in the markup — the destructive control is the LAST of its row', () => {
      openManager()
      const kids = [...rowOf('Preset 1').children]
      expect(kids[0]).toBe(nameBoxes()[0])
      expect(kids[2]).toBe(reorderHandle('Preset 1'))
      expect(kids[3]).toBe(rowButton('Preset 1', 'delete'))
    })

    it('opening the popup puts the keyboard on the card, and the first Tab stop is a NAME — never a ✕', () => {
      act(() => {
        createPreset('Scratch') // untouched: its ✕ would delete it without asking
      })
      openManager()
      expect(document.activeElement).toBe(card())
      const stops = [
        ...card().closest('[data-settings-modal]').querySelectorAll('button,input,[tabindex="0"]'),
      ]
      expect(stops[0]).toBe(nameBoxes()[0])
      // The whole cycle, row by row: name, grip, ✕ — and New Preset at the foot.
      expect(stops.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
        'Preset name',
        'Reorder Preset 1, position 1 of 2',
        'Delete Preset 1',
        'Preset name',
        'Reorder Scratch, position 2 of 2',
        'Delete Scratch',
        'New Preset',
      ])
      // …so Enter on the first stop keeps a name; it cannot delete anything.
      act(() => stops[0].focus())
      act(() => fireEvent.keyDown(stops[0], { key: 'Enter' }))
      expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Preset 1', 'Scratch'])
    })

    it('the ✕ keeps its button chrome; the grip is bare — no border, no fill', () => {
      openManager()
      expect(rowButton('Preset 1', 'delete').className).toMatch(/(^|\s)border(\s|$)/)
      expect(rowButton('Preset 1', 'delete').className).toMatch(/surface-toggle/)
      const grip = reorderHandle('Preset 1').className
      expect(grip).not.toMatch(/(^|\s)border(\s|$)/)
      expect(grip).not.toMatch(/surface-/)
      // …but it is still a control: a grab cursor for a mouse, and a focus ring for the keyboard —
      // the app's one ring, drawn on whatever the keyboard is on (tests/keyboardFocus), so the
      // grip asks for nothing. What it must NOT do is switch that ring off: a Tailwind
      // outline utility on :focus is what removed the grip's only keyboard indicator once.
      expect(grip).toMatch(/cursor-grab/)
      expect(grip).not.toMatch(/outline-/)
    })

    it('the cut-short note sits under the NAME, in the row`s own grid, not under the ✕', () => {
      openManager()
      layOutNameCells(3 * PX_PER_CHARACTER)
      const box = nameBoxes()[0]
      act(() => {
        fireEvent.focus(box)
        fireEvent.change(box, { target: { value: 'Weekend' } })
      })
      const note = within(rowOf('Weekend')).getByText('Some places will show this name cut short.')
      expect(note.parentElement.className).toMatch(/col-start-2/) // the notes' own cell
    })
  })

  // ── The list follows a row that is moved or annotated ─────────────────────────────────────────
  // The list is unlimited, so it scrolls — and jsdom lays nothing out, so each row is given a rect
  // from its CURRENT place in the list (40px rows, minus how far the list is scrolled) and the list
  // a box two rows tall. What is proved is the arithmetic and the wiring; how it looks is a device
  // question.
  describe('the list follows the row', () => {
    const ROW = 40
    const list = () => rowOf('Preset 1').parentElement.parentElement
    const layOut = (names, { viewRows = 2, heights = {} } = {}) => {
      const region = list()
      region.getBoundingClientRect = () => ({
        top: 0,
        bottom: viewRows * ROW,
        height: viewRows * ROW,
      })
      Object.defineProperty(region, 'clientHeight', { configurable: true, value: viewRows * ROW })
      for (const name of names) {
        const outer = rowOf(name).parentElement
        outer.getBoundingClientRect = () => {
          const top = [...region.children].indexOf(outer) * ROW - region.scrollTop
          const height = heights[name] ?? ROW
          return { top, bottom: top + height, height }
        }
      }
    }

    it('a keyboard move scrolls the list just far enough to keep the moved row whole in view', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
        createPreset('Fourth')
      })
      openManager()
      layOut(['Preset 1', 'Timed', 'Guest', 'Fourth'])
      const down = () =>
        act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowDown' }))
      const up = () => act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowUp' }))
      down() // second row: still inside the two-row view
      expect(list().scrollTop).toBe(0)
      down() // third row (80 … 120): below the fold → its bottom is brought to the edge
      expect(listedNames()).toEqual(['Timed', 'Guest', 'Preset 1', 'Fourth'])
      expect(list().scrollTop).toBe(40)
      down() // fourth row (120 … 160)
      expect(list().scrollTop).toBe(80)
      up() // back to the third row (80 … 120): already in view, nothing moves
      expect(list().scrollTop).toBe(80)
      up()
      up() // the first row: above the view → its top is brought to the edge
      expect(listedNames()).toEqual(['Preset 1', 'Timed', 'Guest', 'Fourth'])
      expect(list().scrollTop).toBe(0)
    })

    it('a key that moves nothing scrolls nothing', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      layOut(['Preset 1', 'Timed', 'Guest'])
      act(() => {
        list().scrollTop = 40
      })
      act(() => fireEvent.keyDown(reorderHandle('Guest'), { key: 'Home' }))
      expect(list().scrollTop).toBe(40)
    })

    it('the cut-short note appearing on a row at the foot of the view is scrolled into view', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      layOutNameCells(6 * PX_PER_CHARACTER)
      const box = nameBoxes()[1] // the second row: 40 … 98 with its note, in a view 80 tall
      // The row with the note is the taller one: the note takes a second line under its name box.
      // (Laid out by the name it is ABOUT to have: rows are found by what their box holds.)
      act(() => {
        fireEvent.focus(box)
      })
      layOut(['Preset 1', 'Timed', 'Guest'], { heights: { Timed: 58 } })
      act(() => {
        fireEvent.change(box, { target: { value: 'Timed Runs' } })
      })
      expect(
        within(card()).getByText('Some places will show this name cut short.', {
          ignore: '[aria-live] *',
        }),
      ).toBeTruthy()
      expect(list().scrollTop).toBe(18)
    })
  })

  // ── The grip's ring is the keyboard's ─────────────────────────────────────────────────────────
  // A grab focuses the grip from script, and the ring must not be drawn for it: the ring is drawn
  // only while the keyboard is what is being used (lib/keyboardFocus's mark on <html>, which
  // index.css's one ring rule requires — tests/keyboardFocus pins both), and a press is not the
  // keyboard whatever focuses afterwards. The grip used to carry a mark of its own for this. jsdom
  // draws nothing, so the mark is the contract; the real ring was checked in a real browser.
  describe('the grip draws no keyboard ring for a pointer grab', () => {
    const ringed = (name) =>
      document.documentElement.hasAttribute(KEYBOARD_ATTR) &&
      document.activeElement === reorderHandle(name)
    const grab = (name) => {
      const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      Object.defineProperty(e, 'pointerId', { value: 3 })
      Object.defineProperty(e, 'isPrimary', { value: true })
      Object.defineProperty(e, 'pointerType', { value: 'mouse' })
      act(() => reorderHandle(name).dispatchEvent(e))
    }
    const tabTo = (name) => {
      pressKey('Tab')
      act(() => reorderHandle(name).focus())
    }

    it('the keyboard on a grip rings it; a grab does not', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      tabTo('Preset 1')
      expect(ringed('Preset 1')).toBe(true)
      grab('Preset 1')
      expect(document.activeElement).toBe(reorderHandle('Preset 1')) // the grab still focuses it
      expect(ringed('Preset 1')).toBe(false)
    })

    // The case a real browser showed first: the keyboard is on ONE grip when the pointer grabs
    // ANOTHER. The browser counts the scripted focus that follows as keyboard focus.
    it('grabbing a grip while the keyboard is on a different one draws no ring on either', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      tabTo('Preset 1') // the keyboard is here…
      grab('Timed') // …and the pointer takes this one
      expect(document.activeElement).toBe(reorderHandle('Timed'))
      expect(ringed('Timed')).toBe(false)
      expect(ringed('Preset 1')).toBe(false)
    })

    it('a key pressed on a grabbed grip is the keyboard again — the ring is back', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      grab('Preset 1')
      expect(ringed('Preset 1')).toBe(false)
      act(() => fireEvent.keyDown(reorderHandle('Preset 1'), { key: 'ArrowDown' }))
      expect(listedNames()).toEqual(['Timed', 'Preset 1'])
      expect(ringed('Preset 1')).toBe(true)
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

    // ★ ROUND 23 — THE DRAGGED ROW STAYS INSIDE THE LIST. The owner's screenshots showed it
    // sliding up over the popup's description and down past the list's foot. The row is drawn at
    // most as far as the first / last slot, however far the finger goes.
    const transformOf = (name) => rowOf(name).parentElement.style.transform
    it('the dragged row never travels past the first or last slot', () => {
      act(() => {
        createPreset('Timed')
        createPreset('Guest')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed', 'Guest'])
      const handle = reorderHandle('Timed') // center 60; the slots run 20 … 100
      act(() => handle.dispatchEvent(pointerEvt('pointerdown', 60)))
      act(() => handle.dispatchEvent(pointerEvt('pointermove', -400)))
      expect(transformOf('Timed')).toBe('translateY(-40px)') // parked on slot 0, not 460px up
      act(() => handle.dispatchEvent(pointerEvt('pointermove', 900)))
      expect(transformOf('Timed')).toBe('translateY(40px)') // parked on the last slot
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 900)))
      expect(listedNames()).toEqual(['Preset 1', 'Guest', 'Timed'])
      expect(transformOf('Timed')).toBe('translateY(0px)')
    })

    // ★ THE ROW IN THE HAND IS ITS PARTS, NOT A SLAB. Only the two pieces that are boxes at rest —
    // the ✕ button and the name box — are drawn lifted: each turns opaque (held-piece) and gets a
    // shadow box of its own behind it (held-shadow). The ✓ and the grip ride along bare, on an
    // invisible patch of the card's colour (held-ink). The whole-row surface this replaced
    // (row-lifted) drew a rounded shape around the row's empty space too; it must not come back,
    // and neither may the lift before that — a directional boundary shadow plus a scale.
    const heldShadows = (name) =>
      [...rowOf(name).children].filter((c) => /held-shadow/.test(c.className))
    it('the row being dragged lifts its ✕ and its name box, and nothing else, only while it is dragged', () => {
      act(() => {
        createPreset('Timed')
      })
      act(() => switchPreset(2)) // Timed is the current preset: its row carries the ✓
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Timed')
      const pieces = (name) => [
        nameBoxes().find((el) => el.value === name),
        rowButton(name, 'delete'),
      ]
      const marks = (name) => [
        within(rowOf(name)).queryByText('✓'),
        reorderHandle(name).querySelector('svg'),
      ]
      const atRest = (name) => {
        for (const el of pieces(name)) expect(el.className).not.toMatch(/held-/)
        for (const el of marks(name).filter(Boolean))
          expect(el.getAttribute('class') ?? '').not.toMatch(/held-/)
        expect(heldShadows(name)).toHaveLength(0)
      }
      atRest('Timed')
      act(() => handle.dispatchEvent(pointerEvt('pointerdown', 60)))
      for (const el of pieces('Timed')) expect(el.className).toMatch(/(^|\s)held-piece(\s|$)/)
      for (const el of marks('Timed'))
        expect(el.getAttribute('class')).toMatch(/(^|\s)held-ink(\s|$)/)
      // One shadow box per lifted piece, in that piece's own grid cell, hidden from a screen reader.
      const shadows = heldShadows('Timed')
      expect(shadows).toHaveLength(2)
      const cellOf = (el) => el.className.match(/col-start-\d/)[0]
      expect(shadows.map(cellOf).sort()).toEqual(pieces('Timed').map(cellOf).sort())
      for (const el of shadows) expect(el.getAttribute('aria-hidden')).toBe('true')
      // The grip itself stays bare: no fill, no shadow, no lifted piece.
      expect(handle.className).not.toMatch(/held-|surface-/)
      atRest('Preset 1')
      // No surface on the row's own box, and neither of the older lifts.
      for (const el of [rowOf('Timed'), rowOf('Timed').parentElement]) {
        expect(el.className).not.toMatch(/row-lifted|held-|elev-shadow|scale-|rounded/)
      }
      act(() => handle.dispatchEvent(pointerEvt('pointerup', 60)))
      atRest('Timed')
    })

    it('index.css draws the lift on the shadow boxes alone, and the held pieces opaque', () => {
      const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      )
      expect(css).not.toMatch(/row-lifted/)
      const rule = (cls) => new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(css)?.[1]
      // The piece: the resting tint over the card's solid fill — and no shadow of its own.
      expect(rule('held-piece')).toMatch(/var\(--stgl-bg\).*var\(--card-bg\)/)
      expect(rule('held-piece')).not.toMatch(/box-shadow/)
      // The shadow box: behind the row's cells, the theme's own shadow, every side.
      expect(rule('held-shadow')).toMatch(/z-index:-1/)
      expect(rule('held-shadow')).toMatch(/box-shadow:var\(--shadow-lifted\)/)
      expect(css).toMatch(/--shadow-lifted:0 \.1875rem \.75rem rgb\(var\(--shadow-elev-c\)/)
      // The bare marks: the card's colour and nothing that could be seen against it.
      expect(rule('held-ink')).toBe('background:var(--card-bg);box-shadow:0 0 0 2px var(--card-bg)')
      // held-piece has to out-rank the resting surface fills, so it comes after them.
      expect(css.indexOf('.held-piece{')).toBeGreaterThan(css.indexOf('.surface-tray{'))
      expect(css.indexOf('.held-piece{')).toBeGreaterThan(css.indexOf('.surface-toggle{'))
    })

    // ★ THE ✕ IS A DRAWN ICON IN A CENTRING BOX, not a character on a text baseline — which is what
    // left it visibly off-centre in its pill.
    it('the ✕ is an svg drawn in currentColor, centred by its button', () => {
      openManager()
      const btn = rowButton('Preset 1', 'delete')
      expect(btn.textContent).toBe('')
      const svg = btn.querySelector('svg')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.querySelector('path').getAttribute('stroke')).toBe('currentColor')
      expect(btn.className).toMatch(/(^|\s)flex(\s|$)/)
      expect(btn.className).toMatch(/items-center/)
      expect(btn.className).toMatch(/justify-center/)
    })

    // ★ A move or a lift can arrive before the render that follows the press. Found in real
    // Chromium: a press and its first moves dispatched in ONE task moved nothing, because the
    // handlers read the rendered drag, which did not exist yet. They read the live one now.
    it('a press, a move, and a lift in one task still reorder — nothing waits for a render', () => {
      act(() => {
        createPreset('Timed')
      })
      openManager()
      stubRowRects(['Preset 1', 'Timed'])
      const handle = reorderHandle('Preset 1')
      act(() => {
        handle.dispatchEvent(pointerEvt('pointerdown', 20))
        handle.dispatchEvent(pointerEvt('pointermove', 61))
        handle.dispatchEvent(pointerEvt('pointerup', 61))
      })
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
  // ⚠⚠ THE SETTINGS PAYLOAD IS DELIBERATELY NOT `{}` ANY MORE, AND EVERY CASE IN THIS BLOCK
  // DEPENDS ON THAT. An empty state merges to exactly the factory values (store/presets'
  // mergeOverDefaults), so four empty payloads describe a preset that is still FACTORY-FRESH — and
  // its ✕ now deletes on the spot with no question to assert anything about. One ⚙ setting off its
  // default is the smallest honest "this preset holds something", and it is what playing in a
  // preset would genuinely leave behind. The other three keys stay empty: this seed's OTHER job is
  // "all four keys exist, and a delete removes all four", which an empty payload still serves.
  const seedSavedCopy = (id) => {
    for (const base of Object.values(PRESET_STORE_KEYS))
      localStorage.setItem(
        presetKey(base, id),
        base === PRESET_STORE_KEYS.settings
          ? '{"state":{"saveStats":false},"version":1}'
          : '{"state":{},"version":1}',
      )
  }
  const savedCopyKeys = (id) =>
    Object.values(PRESET_STORE_KEYS)
      .map((base) => presetKey(base, id))
      .filter((k) => localStorage.getItem(k) !== null)

  // A second preset that has something to lose — the fixture almost every case below wants, since
  // the confirmation is the subject and a preset holding nothing never shows one.
  const createUsedPreset = (name) => {
    let id
    act(() => {
      id = createPreset(name).id
    })
    seedSavedCopy(id)
    return id
  }

  it('asks first, IN THE SAME DIALOG, with ONE button and no Cancel', () => {
    createUsedPreset('Timed')
    openManager()
    tap(rowButton('Timed', 'delete'))
    // ★ ONE DIALOG, NOT TWO STACKED. The card swaps its own view (components/PresetManager argues
    // why the question is asked in place rather than in a second popup). So the list's title is GONE
    // while the question is up, and there is still exactly one scrim.
    expect(queryModalCard('presets')).toBeNull()
    expect(confirmCard()).toBeTruthy()
    expect(document.querySelectorAll('[data-settings-modal]')).toHaveLength(1)
    // …and the card that is up has taken the keyboard, which is the term that would silently break
    // if focus had been left to the caller's open-only effect.
    expect(document.activeElement).toBe(confirmCard())
    // The question's only control is the destructive one. Asserted as a COUNT, because the claim
    // that replaced Cancel is "every dismiss route comes back here" (the three ladder cases below),
    // and that claim is only honest if there is no second button quietly doing it instead.
    const buttons = within(confirmCard()).getAllByRole('button')
    expect(buttons.map((b) => b.textContent.trim())).toEqual(['Delete'])
    expect(within(confirmCard()).queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  // ── ⚠⚠ THE DISMISSAL LADDER — the three cases the Cancel button's removal RESTS on ────────
  //
  // Cancel was the one in the app that was not merely a third spelling of a dismiss: it returned to
  // the LIST, where a dismiss closed the whole card. So round 22 could not just delete it — every dismiss
  // route had to learn the step it used to buy, or there would be no way out of the question but
  // destroying the card and re-opening it. Each route is asserted separately and each is asserted
  // TWICE OVER (the step back, then the close), because a ladder that only ever took the first step
  // would look identical to a working one in a case that pressed once.
  //
  // The ⚙ panel surviving is part of every one of them: the card is a modal INSIDE the panel, and
  // "the second press closes the card" is a different claim from "the second press closes everything".
  const confirmScrim = () => confirmCard().closest('[data-settings-modal]')
  const openTheQuestion = () => {
    createUsedPreset('Timed')
    openManager()
    tap(rowButton('Timed', 'delete'))
    expect(confirmCard()).toBeTruthy()
  }

  it('ESCAPE steps back to the list (deleting nothing), and a second Escape closes the card', () => {
    openTheQuestion()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(queryConfirmCard()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull() // back on the LIST, card still up
    expect(listedNames()).toEqual(['Preset 1', 'Timed']) // nothing deleted
    expect(registry().presets).toHaveLength(2)
    // Focus follows the view, which is the card's own term (it focuses whichever view it just drew).
    expect(document.activeElement).toBe(card())
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(queryModalCard('presets')).toBeNull() // …and now the card
    expect(isSettingsOpen()).toBe(true) // the panel behind it is untouched
  })

  it('a SCRIM TAP steps back to the list, and a second tap closes the card', () => {
    openTheQuestion()
    tap(confirmScrim())
    expect(queryConfirmCard()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
    expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    tap(modalScrim('presets'))
    expect(queryModalCard('presets')).toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  // ⚠ ANDROID BACK IS THE ROUTE THAT NEEDED MORE THAN THE SHARED HANDLER, and this is the case that
  // proves it: a real Back press POPS its overlay entry before calling the close (components/
  // overlayStack's popstate listener), so a single 'presets' entry whose close merely stepped back
  // would leave the card open with nothing registered — and the SECOND press would find 'settings' on
  // top and take the whole ⚙ panel down with the card. The confirmation therefore registers its own
  // entry ('presets-delete'), and the last two assertions here are what would fail without it.
  it('ANDROID BACK ladders too — the question first, then the card, and the panel survives', async () => {
    openTheQuestion()
    await pressBack()
    expect(queryConfirmCard()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
    expect(listedNames()).toEqual(['Preset 1', 'Timed'])
    await pressBack()
    expect(queryModalCard('presets')).toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  // ⚠⚠ CLOSING EVERYTHING AT ONCE MUST UNWIND EXACTLY WHAT WAS PUSHED (round 22's fixer, F14). With
  // the delete question up, three Back entries are registered — 'settings', 'presets' and the delete question's own
  // 'presets-delete' — and G (or a mode letter) closes the whole ⚙ panel in one commit. Each close
  // used to call history.back() on its own under ONE shared "that was us" flag; in Chromium (measured
  // in a real browser) all three traversals ran, the second popstate was taken for a real Back, and
  // a FOURTH traversal stepped off the app's own first entry — the app navigated away on a key press.
  // jsdom instead coalesces three back() calls into one traversal, which is why nothing here caught
  // it — and why this case is written against a SENTINEL entry pushed before the panel opened: the
  // unwind is correct only if it lands exactly there, whichever way an engine runs the steps.
  it('G closing the panel with the question up lands exactly where the panel opened from', async () => {
    createUsedPreset('Timed')
    mountApp()
    act(() => window.history.pushState({ sentinel: true }, ''))
    openSettings()
    openModal('presets')
    tap(rowButton('Timed', 'delete'))
    expect(confirmCard()).toBeTruthy()
    pressKey('G')
    expect(isSettingsOpen()).toBe(false)
    await drainHistory()
    expect(window.history.state).toEqual({ sentinel: true })
    // …and the next REAL Back press is not eaten by a leftover "that was us" flag: open the panel
    // again and a single Back closes it.
    openSettings()
    await pressBack()
    expect(isSettingsOpen()).toBe(false)
  })

  it('re-opening the manager after a step back shows the LIST, never the question again', () => {
    openTheQuestion()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // back to the list
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // card closed
    openModal('presets')
    expect(queryConfirmCard()).toBeNull()
    expect(queryModalCard('presets')).not.toBeNull()
  })

  it('Delete removes the preset AND its saved copy, and touches no neighbour', () => {
    createUsedPreset('Timed')
    createUsedPreset('Guest')
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
    // The ACTIVE preset is dirtied through the LIVE store rather than by seeding a key, because
    // that is what the ✕ consults for the preset you are standing in (store/presetControl's
    // isPresetFactory reads the live stores for it and storage for every other) — and because it is
    // what a player changing a setting actually does.
    act(() => {
      useSettings.getState().setSaveStats(false)
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
    createUsedPreset('Timed')
    openManager()
    tap(rowButton('Timed', 'delete'))
    expect(within(confirmCard()).queryByText(/You are on this preset/)).toBeNull()
  })

  // ── THE QUESTION IS SKIPPED FOR A PRESET THAT HOLDS NOTHING ─────────────────────────────
  //
  // ★ WHAT MAKES THIS GROUP WORTH HAVING RATHER THAN LEAVING IT TO THE STORE'S OWN UNIT CASES
  // (tests/presets.dom, which owns isPresetFactory's judgement in every shape): these say the ✕
  // ROUTES on that judgement — that a skip really deletes, really leaves the card on the list, and
  // really cannot happen for a preset with something in it. The store test says what the answer is;
  // these say the button asked the question and obeyed it.
  it('a factory-fresh preset is deleted on the spot, with no confirmation at all', () => {
    act(() => {
      createPreset('Scratch')
    })
    openManager()
    tap(rowButton('Scratch', 'delete'))
    // Gone, with the question never drawn…
    expect(queryConfirmCard()).toBeNull()
    expect(listedNames()).toEqual(['Preset 1'])
    expect(registry().presets).toHaveLength(1)
    // …and the card left standing on its LIST, which is where the confirm route lands too — the
    // skip is the same act with the question removed, not a different one.
    expect(queryModalCard('presets')).not.toBeNull()
    expect(isSettingsOpen()).toBe(true)
  })

  // ⚠ THE OWNER'S EXPLICIT CALL, and the one place "holds nothing" is not the same as "untouched":
  // Amnesic is a statement about where stats WOULD be kept, and a preset with none has lost nothing
  // by being deleted. It is also the session's rather than in any of the four stores, so this
  // case is what would fail if a later change started consulting it.
  it('Amnesic on its own does not count as holding something — still no question', () => {
    let id
    act(() => {
      id = createPreset('Guest').id
    })
    openManager()
    act(() => {
      setPresetAmnesic(id, 'full')
    })
    expect(within(rowOf('Guest')).getByText('amnesic')).toBeTruthy() // it really is amnesic
    tap(rowButton('Guest', 'delete'))
    expect(queryConfirmCard()).toBeNull()
    expect(listedNames()).toEqual(['Preset 1'])
  })

  // The negative control for the group above, driven through the UI rather than through storage: a
  // preset you actually played in asks. Without this, a check that answered "factory" for
  // EVERYTHING would pass every case above.
  it('a preset with stats in it still asks — the skip is not a blanket', () => {
    const id = createUsedPreset('Timed')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, id),
      JSON.stringify({
        state: { stats: { classic: { played: 4, good: 3, streak: 1, best: 2, times: [900] } } },
        version: 4,
      }),
    )
    openManager()
    tap(rowButton('Timed', 'delete'))
    expect(confirmCard()).toBeTruthy()
    // Read from the registry, not from the list: the question REPLACES the list view, so there are
    // no rows on screen to count while it is up.
    expect(registry().presets).toHaveLength(2)
  })

  // ── ⚠⚠ THE PRESET YOU ARE ON: WHAT IS ON ITS SCREENS COUNTS (round 22's fixer, a BLOCKER) ─────
  //
  // A Blitz round or MoX run IN PROGRESS is written nowhere — no store, no key, and store/
  // sessionRound parks only ENDED ones — so a check built from storage alone called such a preset
  // factory and the ✕ deleted it, run and all, without the very question that warns about "a Blitz
  // round or MoX run in progress". Each case below leaves every store at its factory values (neither
  // screen saves per-question stats, and nothing here touches a setting), so the SCREEN is the only
  // thing that can make the ✕ ask — which is exactly what these prove.
  const activeFactoryWithNeighbour = () => {
    act(() => {
      createPreset('Spare')
    })
    mountApp()
  }
  const pressDeleteOnActive = () => {
    openSettings()
    openModal('presets')
    tap(rowButton('Preset 1', 'delete'))
  }
  const beginIn = (modeKey) => {
    pressKey(modeKey)
    tap(screen.getByRole('button', { name: 'Begin' }))
  }

  it('a MoX run in progress on the active preset asks first', () => {
    activeFactoryWithNeighbour()
    beginIn('A')
    pressDeleteOnActive()
    expect(confirmCard()).toBeTruthy()
    expect(registry().presets).toHaveLength(2)
  })

  it('a Blitz round in progress — its clock still running under the card — asks first', () => {
    activeFactoryWithNeighbour()
    beginIn('B')
    // An answer, whichever it is: Blitz launches with Allow Mistakes on, so the round keeps going.
    tap(screen.getByRole('button', { name: 'Monday' }))
    pressDeleteOnActive()
    expect(confirmCard()).toBeTruthy()
    expect(registry().presets).toHaveLength(2)
  })

  // ⚠ THE ENDED ROUND THAT COULD NOT BE PARKED. With sessionStorage refusing writes, store/
  // sessionRound's hasSessionRound has nothing to find — but the result is still on screen, and
  // deleting the active preset would remount it away. The screen's own report is what catches it.
  it('an ended MoX run still on screen asks — even when sessionStorage refused to park it', () => {
    const realSetItem = Storage.prototype.setItem
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (this === window.sessionStorage) throw new Error('refused')
      return realSetItem.call(this, k, v)
    })
    try {
      activeFactoryWithNeighbour()
      beginIn('A')
      tap(screen.getByRole('button', { name: 'Reveal' })) // Allow Mistakes off → the run fails
      expect(hasSessionRound(registry().activeId)).toBe(false) // nothing parked…
      pressDeleteOnActive()
      expect(confirmCard()).toBeTruthy() // …and it asks all the same
    } finally {
      refuse.mockRestore()
    }
  })

  // The negative control: without it, a check that answered "not factory" for every active preset
  // would pass the three cases above. And ★ F2 — FOCUS: the skip removes the row whose ✕ had the
  // keyboard, and a removed element drops focus to <body>, behind the scrim and outside the Tab
  // trap. It lands on the card instead — exactly where the confirm route's Delete leaves it.
  it('a truly fresh ACTIVE preset still deletes on the spot, and the keyboard lands on the card', () => {
    activeFactoryWithNeighbour()
    openSettings()
    openModal('presets')
    const cross = rowButton('Preset 1', 'delete')
    act(() => cross.focus())
    tap(cross)
    expect(queryConfirmCard()).toBeNull()
    expect(listedNames()).toEqual(['Spare'])
    expect(registry().activeId).not.toBe(1)
    expect(document.activeElement).toBe(card())
  })

  it('a skipped delete of a preset you are NOT on also leaves the keyboard on the card', () => {
    act(() => {
      createPreset('Scratch')
    })
    openManager()
    const cross = rowButton('Scratch', 'delete')
    act(() => cross.focus())
    tap(cross)
    expect(listedNames()).toEqual(['Preset 1'])
    expect(document.activeElement).toBe(card())
  })

  // ⚠ A LAST PRESET IS NEVER DELETED, FACTORY OR NOT — the withholding guard runs BEFORE the
  // factory test, so the skip cannot become a back door into the one delete the store refuses. The
  // case above it asserts the dim; this asserts the skip route specifically, on a preset that IS
  // factory-fresh and would otherwise have gone without a word.
  it('the skip never reaches the LAST preset, which is factory-fresh on a new device', () => {
    openManager()
    tap(within(card()).getByRole('button', { name: 'Delete Preset 1' }))
    expect(queryConfirmCard()).toBeNull()
    expect(registry().presets).toHaveLength(1)
    expect(listedNames()).toEqual(['Preset 1'])
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

// ── THE LIST'S CLIP BOX REACHES PAST ITS ROWS, SO A HELD ROW KEEPS ITS SHADOW ────────────────────
// A scroll region clips at its own edge, and that edge used to be the last row's bottom: the lift's
// shadow was cut off flat under a row held in the list's last slot (and above one held in the
// first). jsdom lays nothing out and draws no shadow, so what can be pinned here is the arithmetic
// that makes the room without moving a row — the region's padding, the margins that cancel it, the
// height cap's allowance for both, and the wrapper that keeps the margins from leaking into the
// card's own spacing. The picture itself is checked in a real browser each round.
describe('the list reaches one card gap past its rows, above and below', () => {
  const css = readFileSync(resolve('src/index.css'), 'utf8')
  it('padding, cancelling margins, and the cap`s allowance are one number — the card`s row gap', () => {
    openManager()
    const region = nameBoxes()[0].closest('.overflow-y-auto')
    const classes = [...region.classList]
    expect(classes).toContain('py-3') // room inside the clip box…
    expect(classes).toContain('-my-3') // …pulled back out, so no row moves
    expect(classes).toContain('max-h-[calc(45vh_+_1.5rem)]') // …and a long list shows the same 45vh
    expect(classes).toContain('[--fade-reach:0.75rem]') // …and the edge fades know where the rows stop
    expect(region.parentElement.classList.contains('flow-root')).toBe(true) // margins stay inside
    expect(card().classList.contains('space-y-3')).toBe(true) // the gap the reach is taken from
    expect(region.parentElement.parentElement).toBe(card()) // …between the region and its neighbours
  })
  // The reach is for the held row's shadow and for nothing else. While the list scrolls, rows pass
  // through it — and used to be drawn there, in the gaps above and below the list. An edge that is
  // fading (rows past it) hides its reach whole and feathers from where the rows stop; an edge at
  // the list's end has no mask, and that is the only place the shadow needs the room.
  it('a fading edge hides the reach and feathers from where the rows stop', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const mask = (name) => new RegExp(`\\.${name}\\{[^}]*;mask-image:([^}]*)\\}`).exec(code)[1]
    const TOP = 'transparent var(--fade-reach),black calc(var(--fade-reach) + var(--fade-h))'
    const BOTTOM =
      'black calc(100% - var(--fade-reach) - var(--fade-h)),transparent calc(100% - var(--fade-reach))'
    expect(mask('fade-scroll-top')).toBe(`linear-gradient(to bottom,${TOP})`)
    expect(mask('fade-scroll-bottom')).toBe(`linear-gradient(to bottom,${BOTTOM})`)
    expect(mask('fade-scroll-both')).toBe(`linear-gradient(to bottom,${TOP},${BOTTOM})`)
    // Every other scroller has no reach, and its fades are the plain ones they always were.
    expect(code).toContain(':root{--fade-h:.75rem;--shade-ramp:1.5rem;--fade-reach:0px}')
    expect(code.match(/--fade-reach:/g)).toHaveLength(1)
  })
  it('the shadow it makes room for needs no more than that gap on the side it is cut closest', () => {
    // The LIFTED shadow, 0 .1875rem .75rem: it reaches .75 − .1875 = .5625rem above a piece and
    // .75 + .1875 = .9375rem below. The gap is .75rem (LIST_REACH_CLASS's --fade-reach, the same
    // unit), so the top is whole and the bottom loses only the last .1875rem of the blur's tail.
    const shadow = /--shadow-lifted:0 ([\d.]+)rem ([\d.]+)rem /.exec(css)
    expect(shadow).not.toBeNull()
    const [down, blur] = [Number(shadow[1]), Number(shadow[2])]
    const gap = 0.75 // py-3 / [--fade-reach:0.75rem], pinned on the region by the first test here
    expect(blur - down).toBeLessThanOrEqual(gap)
    expect(blur + down - gap).toBeLessThanOrEqual(0.1875)
  })
})
