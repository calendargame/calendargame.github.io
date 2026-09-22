// @vitest-environment jsdom
//
// overrideButton.dom — THE DOUBLE-TAP GUARD on the Override ⇄ Undo button (components/
// OverrideButton), round 22's fixer.
//
// ★ WHY IT HAS A FILE OF ITS OWN rather than a case inside one mode's suite: the button is ONE
// shared component used by all five modes, and the guard is about the INPUT that reaches it, not
// about anything a mode does with the press. Classic is the fixture here purely because it is the
// launch screen and its Override path is one answer away — the claim is the button's, in every mode.
//
// ⚠⚠ WHAT MAKES THESE CASES MEAN ANYTHING: they press with a REAL POINTER GESTURE — a pointerdown
// followed by a click carrying a click count — because that is exactly the input the guard is scoped
// to. Every other test in this suite clicks programmatically (no pointerdown, `detail` 0), which the
// guard deliberately lets through: the keyboard and assistive routes have never had the accidental
// double-press problem (App drops key repeats outright), and adding a delay to them would be adding
// a fault. So the two halves are asserted here side by side rather than left to be inferred.
import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { readDate, correctDayName } from './helpers/modeScreen.jsx'
import { useSettings } from '../src/store/settings.js'

// The component's window, mirrored here so the cases below read as "a beat later" rather than as a
// magic number. A press exactly this long after the last one is the first that lands (the guard is a
// strict "inside the window"), so these cases also pin the boundary: widen the constant in
// components/OverrideButton without widening this one and they fail.
const DOUBLE_PRESS_MS = 350

const ctrl = (name) => screen.getByRole('button', { name })
const queryCtrl = (name) => screen.queryByRole('button', { name })
// A stat readout on the VISIBLE screen. The hidden modes are display:none but still in the DOM, and
// MoX's strip comes first in document order — so the visibility filter is what makes this Classic's
// number rather than a hidden screen's (the same reader tests/blitz.dom and tests/sessionRound.dom
// carry, for the same reason).
const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const statValue = (label) => {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}
// A REAL tap: the pointerdown a finger or mouse always fires first, then the click the browser
// synthesises from it, carrying a click count. Both signals are what tell the guard this press came
// from a physical gesture.
const tapButton = (el) =>
  act(() => {
    fireEvent.pointerDown(el)
    fireEvent.click(el, { detail: 1 })
  })
// The same press WITHOUT a gesture: what App's O shortcut does (it clicks the element) and what
// assistive technology does.
const clickButton = (el) => act(() => fireEvent.click(el))
const wait = (ms) => act(() => vi.advanceTimersByTime(ms))

// Classic, one question answered correctly: the Override on offer is the retro flip of that entry
// (Path 5), so the score says plainly which presses landed — 1/1 before, 0/1 after an Override, 1/1
// again after its Undo.
const answeredCorrectly = () => {
  mountApp()
  act(() => fireEvent.click(ctrl('New')))
  act(() => fireEvent.click(ctrl(correctDayName(readDate()))))
  expect(statValue('Score')).toBe('1/1')
}

describe('the Override ⇄ Undo button ignores a double-tap', () => {
  beforeEach(() => {
    resetAppState()
    vi.useFakeTimers()
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
    resetAppState()
  })

  it('a second tap inside the window is ignored — the Override stands instead of undoing itself', () => {
    answeredCorrectly()
    tapButton(ctrl('Override'))
    expect(statValue('Score')).toBe('0/1') // the flip landed…
    tapButton(ctrl('Undo')) // …and the second contact of the same double-tap arrives here
    expect(statValue('Score')).toBe('0/1') // …and does nothing
    expect(ctrl('Undo')).toBeInTheDocument() // the button still offers the way back
  })

  it('…and it is symmetric: a double-tap on Undo does not re-Override', () => {
    answeredCorrectly()
    tapButton(ctrl('Override'))
    wait(400) // a deliberate second press, a beat later
    tapButton(ctrl('Undo'))
    expect(statValue('Score')).toBe('1/1')
    tapButton(ctrl('Override')) // the accidental second contact of THAT tap
    expect(statValue('Score')).toBe('1/1')
  })

  it('the toggle stays unlimited — every press a third of a second apart lands, three cycles over', () => {
    answeredCorrectly()
    for (let i = 0; i < 3; i++) {
      tapButton(ctrl('Override'))
      expect(statValue('Score')).toBe('0/1')
      wait(DOUBLE_PRESS_MS)
      tapButton(ctrl('Undo'))
      expect(statValue('Score')).toBe('1/1')
      wait(DOUBLE_PRESS_MS)
    }
    expect(queryCtrl('Override')).toBeInTheDocument()
  })

  it('the very first press of a mount is never swallowed, however long the app has been open', () => {
    answeredCorrectly()
    wait(60_000)
    tapButton(ctrl('Override'))
    expect(statValue('Score')).toBe('0/1')
  })

  // ⚠ THE OTHER HALF OF THE RULE. A press with no pointer gesture behind it — the O shortcut, which
  // clicks this element, and assistive technology, which does the same — is not guarded at all, and
  // deliberately: a key repeat cannot reach it (App drops `e.repeat`), and a person pressing O twice
  // means it twice. This is also why the rest of the suite, which clicks programmatically, is
  // untouched by the guard.
  it('a keyboard or programmatic press is not guarded, even back to back', () => {
    // The O shortcut reaches the button through App's [data-key] walk, which skips anything whose
    // offsetParent is null — that is EVERY element in jsdom's layout-free DOM. So, exactly as
    // tests/classic.dom does for its own O case, offsetParent is given the one rule the walk relies
    // on for the length of this test: null inside a display:none ancestor (the hidden mode screens),
    // a parent otherwise.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        for (let e = this; e; e = e.parentElement) if (e.style?.display === 'none') return null
        return this.parentElement
      },
    })
    onTestFinished(() => Object.defineProperty(HTMLElement.prototype, 'offsetParent', desc))
    answeredCorrectly()
    clickButton(ctrl('Override')) // what assistive technology does
    expect(statValue('Score')).toBe('0/1')
    clickButton(ctrl('Undo')) // …immediately, with no window between them
    expect(statValue('Score')).toBe('1/1')
    act(() => fireEvent.keyDown(window, { key: 'o' })) // and the real shortcut, just as fast
    expect(statValue('Score')).toBe('0/1')
    act(() => fireEvent.keyDown(window, { key: 'o' }))
    expect(statValue('Score')).toBe('1/1')
  })
})
