// @vitest-environment jsdom
//
// The ⚙ trio's caption fit — Save Defaults / Reset Settings / Full Reset (components/SettingsPanel's
// fitTrioCaptions): one shared size, shrunk no further than eleven twelfths of the panel's text tier;
// past that, a caption too wide for one line takes two, broken at its space. Never cut.
//
// ★ IT IS MEASURED AS LAID-OUT TEXT — a Range over each caption — and the Round 26 review is why: it
// used to read each caption span's scrollWidth, which an inline span does not have (it is 0 in every
// browser), and this file mocked a scrollWidth into existence, so the suite proved a fit that never
// once ran on a real screen. The browser lane (settingsTrio) now holds the real geometry, in three
// fonts and both engines; this file pins the WIRING with a model of text in jsdom, which lays nothing
// out:
//   • a Range's width is its text's length × half the font size of the button the caption is in
//     (its inline size, or the resting 12px of text-xs) — so a measurement follows the size tried;
//   • a trio button is `btnWidth` wide, with no padding or border;
//   • a button's computed font size is its inline size, or 12px — the channel a compounding shrink
//     would travel, so the stability case is a real test of the reset-before-measure guard.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { within, cleanup, fireEvent, act } from '@testing-library/react'
import {
  mountApp,
  openSettings,
  picker,
  pickerLockState,
  resetAppState,
} from './helpers/settingsPanel.jsx'

const rectDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
const rangeRect = Range.prototype.getBoundingClientRect
const origGetComputedStyle = window.getComputedStyle

let btnWidth = 80 // trio-button content width the mocks report; tests vary it to steer the fit

// A pill inside one of the panel's own pickers — the re-render driver the stability case below
// needs. See the comment there for why a store poke will not do.
const pill = (group, label) => within(picker(group)).getByRole('radio', { name: label })
const isTrioButton = (el) => el?.matches?.('button') && el.querySelector('[data-fitlabel]')
const sizeOf = (button) => parseFloat(button.style.fontSize || '12')
const sizes = () =>
  Array.from(document.querySelectorAll('[data-fitlabel]')).map(
    (l) => l.parentElement.style.fontSize,
  )
const wraps = () =>
  Array.from(document.querySelectorAll('[data-fitlabel]')).map((l) => l.style.whiteSpace)

describe('the trio’s caption fit wiring', () => {
  beforeEach(() => {
    resetAppState()
    btnWidth = 80
    Element.prototype.getBoundingClientRect = function () {
      if (isTrioButton(this))
        return { width: btnWidth, height: 20, left: 0, top: 0, right: btnWidth, bottom: 20 }
      return rectDesc.value.call(this)
    }
    Range.prototype.getBoundingClientRect = function () {
      const button = this.startContainer.parentElement?.parentElement
      const width = this.toString().length * sizeOf(button) * 0.5
      return { width, height: 14, left: 0, top: 0, right: width, bottom: 14 }
    }
    window.getComputedStyle = (el, pseudo) => {
      if (isTrioButton(el))
        return {
          fontSize: `${sizeOf(el)}px`,
          paddingLeft: '0px',
          paddingRight: '0px',
          borderLeftWidth: '0px',
          borderRightWidth: '0px',
        }
      return origGetComputedStyle(el, pseudo)
    }
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', rectDesc)
    Range.prototype.getBoundingClientRect = rangeRect
    window.getComputedStyle = origGetComputedStyle
  })

  it('the three trio buttons all wear the text-xs control tier — nothing text-sm, and no twins left', () => {
    mountApp()
    openSettings()
    const labels = Array.from(document.querySelectorAll('[data-fitlabel]'))
    const btns = labels.map((l) => l.parentElement)
    expect(labels.map((l) => l.textContent)).toEqual([
      'Save Defaults',
      'Reset Settings',
      'Full Reset',
    ])
    for (const el of btns) {
      expect(el.className).toContain('text-xs')
      expect(el.className).not.toContain('text-sm')
    }
    // The measurement twins are gone — round 21 froze every caption, so there is nothing to swap.
    expect(document.querySelectorAll('[data-fittwin]')).toHaveLength(0)
  })

  // "Reset Settings" is the widest caption: 14 characters, 84px at 12px in the model.
  it('a little too wide: ONE shared size for all three, on the BUTTON, on one line', () => {
    btnWidth = 80 // 80/84 of the tier: above the floor (11/12)
    mountApp()
    openSettings()
    const fitted = sizes()
    expect(new Set(fitted).size).toBe(1)
    expect(parseFloat(fitted[0])).toBeCloseTo((12 * 80) / 84, 1)
    expect(wraps()).toEqual(['', '', ''])
    // The caption carries no size of its own: it inherits the button's.
    expect(
      Array.from(document.querySelectorAll('[data-fitlabel]')).map((l) => l.style.fontSize),
    ).toEqual(['', '', ''])
  })

  it('too wide for the floor: two lines at the full size, where each word fits', () => {
    btnWidth = 60 // 60/84 is under the floor; the longest word, 8 characters, is 48px
    mountApp()
    openSettings()
    expect(sizes()).toEqual(['', '', ''])
    expect(wraps()).toEqual(['normal', 'normal', 'normal'])
  })

  it('…and where even a word does not fit, smaller still — whole words, never cut', () => {
    btnWidth = 40 // the longest word fits at 40/48 of the tier
    mountApp()
    openSettings()
    expect(new Set(sizes()).size).toBe(1)
    expect(parseFloat(sizes()[0])).toBeCloseTo(10, 1)
    expect(wraps()).toEqual(['normal', 'normal', 'normal'])
  })

  it('the fit is STABLE across re-renders — the shrink never compounds', () => {
    mountApp()
    openSettings()
    const expected = sizes()
    expect(parseFloat(expected[0])).toBeLessThan(12)
    // Any settings interaction re-runs the dep-less fit effect. The reset-before-measure step is
    // what keeps this stable: a version that measured the captions at the size the last pass left
    // would shrink again on every pass.
    //
    // ⚠ THE RE-RENDER IS DRIVEN THROUGH THE PANEL'S OWN CONTROLS. A tap on a pill inside the panel
    // is a re-render the trio's component cannot fail to observe, by construction — where a store
    // poke would only prove App re-rendered, which stops implying the trio did once the panel is
    // a memoisable component of its own. Each tap is CHECKED to have landed, because a stability
    // claim passes trivially when nothing happened.
    const chosen = () => pickerLockState('Jan/Feb Chance on Leap Years').chosen
    act(() => {
      fireEvent.click(pill('Jan/Feb Chance on Leap Years', '25%'))
    })
    expect(chosen()).toEqual(['25%'])
    act(() => {
      fireEvent.click(pill('Jan/Feb Chance on Leap Years', 'Random'))
    })
    expect(chosen()).toEqual(['Random'])
    expect(sizes()).toEqual(expected)
  })
})
