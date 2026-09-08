// @vitest-environment jsdom
//
// THE TWO APP-WIDE RULES ABOUT THE BOXES YOU CAN TYPE INTO (round 18, sub-group 1D). Both are
// stated once in src/lib/textEntry.js and reach every box from there, so this file is the net for
// the RULES, not for six copies of a behaviour.
//
//   1. Entering a box highlights everything already in it, so typing replaces the value instead of
//      appending to it. The owner: "when you click/tap into any of them, everything inside is
//      already highlighted and I can just start typing without having to delete or move my cursor".
//   2. Opening any overlay takes the keyboard down. The owner: "when the keyboard is open, doing
//      anything at all should close it" — reported from AoX, where focusing the run length and then
//      opening ⚙ Settings or the mode menu left the keyboard sitting over what he had opened.
//
// ⚠ WHAT THIS FILE CAN AND CANNOT PROVE, said plainly rather than left for a reader to assume.
// jsdom has no layout and no WebKit caret placement, so the SELECTION legs here pin the WIRING —
// which event selects, which one arms, which one deliberately bails — against a caret this file
// moves BY HAND to model what a real tap does. That a selection actually survives a finger on the
// owner's iPhone is device-only truth and nothing in this suite can stand in for it.
//
// ⚠ AND WHY THERE IS NO TEST HERE FOR Show Codes OR How to Play. Rule 2 is one line inside
// pushOverlay (components/useBackButton), the registry EVERY overlay in the app comes through, so
// what needs covering is the registry's CALLERS — App (the ⚙ panel, How to Play), CustomSelect (the
// mode menu), SettingsPanel (the four ⚙ popups) and the five mode screens (Show Codes) — not the
// overlays those callers register. Contriving a route to Show Codes with a box focused would test
// the route, not the rule.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import {
  mountApp,
  resetAppState,
  gear,
  openSettings,
  yearInput,
  openModal,
  makeSaveable,
  tap,
  pressKey,
} from './helpers/settingsPanel.jsx'
import { opensKeyboard, isSelectableField } from '../src/lib/textEntry.js'

beforeEach(resetAppState)
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// The two questions a test asks about a caret, named so the assertions read as English.
const selection = (el) => [el.selectionStart, el.selectionEnd]
const allSelected = (el) =>
  el.value.length > 0 && selection(el).join(',') === `0,${el.value.length}`
// A caret placed at `at` — what WebKit does as the tap's own default action, AFTER focus.
const putCaret = (el, at) => el.setSelectionRange(at, at)

const aoxField = () => screen.getByRole('textbox', { name: 'MoX run length' })
const lookupField = () => document.querySelector('input[placeholder^="e.g.,"]')
const modeTrigger = () => screen.getByRole('button', { name: /^Mode,/ })

// ── EVERY BOX THE APP HAS ────────────────────────────────────────────────────────────────────
// Seven of them, and they are listed here BY ROUTE rather than by selector so this table doubles as
// the inventory rule 1 has to cover. The MoX run length appears twice on purpose: the mode
// screen's own box and the Save Defaults popup's are two different <input>s in two different
// files, not one component rendered twice.
// ⚠ THE SEVENTH — the preset rename field — IS THE FIRST BOX THAT EXISTS ONCE PER ROW rather than
// once, and it reaches this table having added not one line to src/lib/textEntry. That is the
// delegated listener's whole claim (its header states it), so the entry is here to keep the claim
// falsifiable rather than merely asserted.
const BOXES = [
  {
    name: 'the MoX run length (mode screen)',
    reach: () => {
      pressKey('A')
      return aoxField()
    },
  },
  {
    name: 'the ⚙ Earliest Year box',
    reach: () => {
      openSettings()
      return yearInput('min')
    },
  },
  {
    name: 'the ⚙ Latest Year box',
    reach: () => {
      openSettings()
      return yearInput('max')
    },
  },
  {
    name: 'the Lookup date box',
    reach: () => {
      pressKey('L')
      // It is the app's one box that starts EMPTY, so it has to be given something to highlight.
      // Committed through a focus/blur cycle first, so the value under test is a resting one rather
      // than the tail of the edit the assertion is about.
      const el = lookupField()
      act(() => {
        el.focus()
        fireEvent.change(el, { target: { value: '7/4/1776' } })
        el.blur()
      })
      return el
    },
  },
  {
    name: 'a tap-to-type slider readout (Flash speed)',
    reach: () => {
      pressKey('F')
      tap(screen.getByRole('button', { name: 'Edit Flash speed' }))
      return screen.getByRole('textbox', { name: 'Flash speed (seconds)' })
    },
  },
  {
    name: 'the Save Defaults popup’s MoX run length',
    reach: () => {
      openSettings()
      makeSaveable()
      openModal('save')
      return screen.getByRole('textbox', { name: 'MoX Run Length' })
    },
  },
  {
    name: 'a preset rename field (Manage Presets)',
    reach: () => {
      openSettings()
      openModal('presets')
      // The registry always holds at least one preset, so the first row is there on a fresh
      // install and its box already reads "Preset 1" — no seeding needed, unlike the Lookup box.
      return screen.getAllByRole('textbox', { name: 'Preset name' })[0]
    },
  },
]

describe('Rule 1 — entering a box highlights everything already in it', () => {
  it.each(BOXES)('$name', ({ reach }) => {
    mountApp()
    const el = reach()
    // The readout editor arrives already focused (its own mount effect), so re-focusing it would
    // test nothing. Everything else is entered here.
    if (document.activeElement !== el) act(() => el.focus())
    expect(el.value).not.toBe('')
    expect(allSelected(el)).toBe(true)
  })

  // ⚠ THE READOUT EDITOR IS THE ONE THAT PROVES THE RULE IS THE APP'S AND NOT THE COMPONENT'S.
  // SliderValueEditor used to call select() itself, one line after its focus(); round 18 deleted
  // that line, because two statements of one policy is the duplication that lets them drift — and
  // the app-wide one is also the only one that survives a tap on a phone. If the delegated rule
  // were ever unhooked, this is the case that would notice, because nothing local is left to hide
  // it.
  it('the readout editor is selected by the app-wide rule, not by a select() of its own', () => {
    mountApp()
    pressKey('F')
    tap(screen.getByRole('button', { name: 'Edit Flash speed' }))
    const el = screen.getByRole('textbox', { name: 'Flash speed (seconds)' })
    expect(document.activeElement).toBe(el) // it focused itself…
    expect(allSelected(el)).toBe(true) // …and something else highlighted the seed
  })
})

describe('Rule 1 — the tap path, where WebKit places the caret last', () => {
  // A tap on iOS runs focus FIRST and the caret placement AFTER, so a selection made in `focus`
  // alone is collapsed again before the user sees it. The rule therefore arms on pointerdown and
  // re-selects on the click that ends the same press — the last event of the tap, and a user
  // gesture, which is the other thing iOS wants before it honours a programmatic selection.
  // The caret move below is this file standing in for WebKit; jsdom does none of it on its own.
  it('re-selects on the click that completes the press', () => {
    mountApp()
    pressKey('A')
    const el = aoxField()
    act(() => {
      fireEvent.pointerDown(el) // arms: the box does not hold focus yet
      el.focus() // focusin selects…
      putCaret(el, 1) // …and WebKit collapses it to where the finger landed
      fireEvent.click(el)
    })
    expect(allSelected(el)).toBe(true)
  })

  // The counterpart, and the reason the arming is conditional rather than unconditional: once you
  // ARE in a box, a tap has to be able to put the caret somewhere. At pointerdown the focus has not
  // moved yet, so "activeElement is already this box" is exactly the test for "this press is not an
  // entry", and that is the whole guard.
  it('a second tap inside a box you are already in places the caret instead', () => {
    mountApp()
    pressKey('A')
    const el = aoxField()
    act(() => el.focus())
    expect(allSelected(el)).toBe(true)
    act(() => {
      putCaret(el, 1)
      fireEvent.pointerDown(el) // NOT armed — the box already holds the keyboard
      fireEvent.click(el)
    })
    expect(selection(el)).toEqual([1, 1])
  })

  // And the one pointer gesture that carries a finer intent than "I am entering this box". A
  // non-collapsed selection at click time is how the DOM says the press was a drag across the text
  // rather than a tap — the same reading lib/selectionGuard makes of the guide's header drags — so
  // the click leg stands down and leaves the user's range alone.
  it('a drag-select survives the click that ends it', () => {
    mountApp()
    pressKey('A')
    const el = aoxField()
    act(() => {
      fireEvent.pointerDown(el)
      el.focus()
      el.setSelectionRange(0, 1) // the finger dragged across one digit and lifted
      fireEvent.click(el)
    })
    expect(selection(el)).toEqual([0, 1])
  })

  // A press that begins on one thing and ends on another is not an entry either. Without the
  // target check the armed box would be re-selected by whatever click happened to come next.
  it('a press that lands somewhere else never re-selects the armed box', () => {
    mountApp()
    pressKey('A')
    const el = aoxField()
    act(() => {
      fireEvent.pointerDown(el)
      el.focus()
      putCaret(el, 1)
      fireEvent.click(gear()) // the release went to the gear, not to the box
    })
    expect(selection(el)).toEqual([1, 1])
  })
})

describe('Rule 2 — opening an overlay takes the keyboard down', () => {
  // ⚠ EVERY ROUTE HERE OPENS ITS OVERLAY WITHOUT MOVING FOCUS, and that is what makes these tests
  // about the app instead of about the platform. Pressing a <button> does not move focus on iOS or
  // Safari, which is precisely why the keyboard used to survive the gear tap on the owner's phone
  // and never did in desktop Chrome. Firing the press without a focus change reproduces his device.
  const OVERLAYS = [
    {
      name: 'the ⚙ Settings panel (registered by App)',
      box: () => {
        pressKey('A')
        return aoxField()
      },
      open: () => act(() => fireEvent.click(gear())),
    },
    {
      name: 'the mode menu (registered by CustomSelect)',
      box: () => {
        pressKey('A')
        return aoxField()
      },
      open: () => act(() => fireEvent.click(modeTrigger())),
    },
  ]
  it.each(OVERLAYS)('$name', ({ box, open }) => {
    mountApp()
    const el = box()
    act(() => el.focus())
    expect(document.activeElement).toBe(el) // the keyboard is up…
    open()
    expect(document.activeElement).not.toBe(el) // …and it went down with the overlay
    expect(opensKeyboard(document.activeElement)).toBe(false) // …onto nothing that raises another
  })

  // ⚠ THE THIRD CALLER IS NOT IN THE TABLE ABOVE, AND THIS CASE SAYS WHY RATHER THAN PRETENDING.
  // SettingsPanel's four registrations are all proper DIALOGS: each one focuses its own card when
  // it opens, so a year box loses the keyboard whether or not rule 2 exists. Mutation-checked —
  // deleting dismissKeyboard() leaves this green while every other case in this file goes red. It
  // is kept because the BEHAVIOUR is worth pinning (typing a year, then opening Save Defaults,
  // really does put the keyboard away), and it is kept OUT of the rule's table because a case that
  // cannot fail when the rule is removed is not part of the rule's net.
  it('a ⚙ popup, which was already true twice over — the dialog takes focus as well', () => {
    mountApp()
    openSettings()
    makeSaveable()
    const el = yearInput('min')
    act(() => el.focus())
    expect(document.activeElement).toBe(el)
    openModal('save')
    expect(opensKeyboard(document.activeElement)).toBe(false)
  })

  // ⚠ THE SCOPE OF THE RULE, and the thing that keeps it from becoming a nuisance: it is about an
  // overlay OPENING, not about one being open. Every box in the ⚙ panel lives inside an overlay, so
  // an implementation that read "an overlay is up" instead of "an overlay just opened" would take
  // the keyboard away from a year box on the panel's next render and make the panel untypeable.
  // Mutation-checked in exactly that shape — a `useEffect(() => { if (isOpen) dismissKeyboard() })`
  // with no dep array turns this case red and leaves the rest of the file green. (What it does NOT
  // discriminate is the blur's position relative to pushOverlay's already-registered guard: that
  // effect is keyed on [isOpen, id], so an ordinary re-render never calls pushOverlay twice.)
  it('an overlay that is already open does not take the keyboard again', () => {
    mountApp()
    openSettings()
    const el = yearInput('min')
    act(() => el.focus())
    act(() => fireEvent.change(el, { target: { value: '1900' } })) // a render, panel still open
    expect(document.activeElement).toBe(el)
  })

  // The blur is a COMMIT wherever the box commits on blur, which is what makes opening an overlay
  // keep a half-typed value rather than drop it — the same thing tapping away on a desktop always
  // did. The AoX box normalize-commits ('1' clamps up to the Ao2 floor); the Lookup box has no
  // onBlur at all, so its text is simply left standing. Escape is what throws an edit away.
  it('keeps what was typed: the box’s own blur contract runs', () => {
    mountApp()
    pressKey('A')
    const el = aoxField()
    act(() => {
      el.focus()
      fireEvent.change(el, { target: { value: '1' } })
    })
    act(() => fireEvent.click(gear()))
    expect(el.value).toBe('2')
  })
})

describe('The two predicates the rules ask', () => {
  // They are deliberately different sets, and the difference is load-bearing at both call sites: a
  // range slider keeps focus after an adjust and must never be blurred by an overlay opening, and
  // it has no text to highlight either. A button has neither property and must be left alone — the
  // mode menu returns focus to its own trigger when it closes, and a blur there would break it.
  const el = (html) => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild
  }
  it('a text box is both a keyboard and a selection target', () => {
    const input = el('<input type="text" />')
    expect(opensKeyboard(input)).toBe(true)
    expect(isSelectableField(input)).toBe(true)
    // An <input> with no type attribute IS a text input, per the DOM's own default.
    expect(isSelectableField(el('<input />'))).toBe(true)
  })
  it('a range slider and a button are neither', () => {
    for (const html of ['<input type="range" />', '<button></button>', '<input type="checkbox" />'])
      expect([opensKeyboard(el(html)), isSelectableField(el(html))]).toEqual([false, false])
  })
  it('a type the app has no site for still counts as a keyboard, but not as selectable', () => {
    // The deny-list / allow-list split, stated as a case rather than only as a comment: number
    // raises a keyboard, and select() is specified to do nothing on it.
    const number = el('<input type="number" />')
    expect(opensKeyboard(number)).toBe(true)
    expect(isSelectableField(number)).toBe(false)
  })
  it('nothing focused is nothing to blur', () => {
    expect(opensKeyboard(null)).toBe(false)
    expect(isSelectableField(document.body)).toBe(false)
  })
})
