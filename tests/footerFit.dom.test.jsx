// @vitest-environment jsdom
//
// Footer-button caption auto-fit (Round-2) — the ⚙ Save Defaults / Reset Settings / Full Reset
// trio shares ONE font-size so no caption overflows on a narrow phone.
//
// ★ Q7 (round 21) REMOVED THE HIDDEN STATIC TWINS. They existed only because Full Reset's caption
// swapped to "Confirm?" while the two-tap arm was live, which would have shrunk a live measurement
// mid-arm and jiggled the row. Q7 replaced that arm with a ConfirmModal, so every caption in the
// trio is static text now — fitFooterBtns measures the live [data-fitlabel] spans directly, after
// resetting each button's inline fontSize to '' so a re-run of the dep-less effect reads the true
// natural width instead of compounding the previous pass's shrink (12·s, 12·s², … → the floor).
// That is the exact feedback-loop guard StatPanel's fitAll uses.
//
// jsdom has no layout, so this pins the WIRING by feeding fitFooterBtns mock measurements:
//   • a scrollWidth getter — every [data-fitlabel] span reports a 100px natural caption;
//   • a clientWidth getter — each trio button reports btnWidth of content width;
//   • a getComputedStyle shim that MODELS INHERITANCE — a caption's computed fontSize is whatever
//     inline size its button currently carries, or the resting 12px (text-xs, the trio's control
//     tier) when the button carries none. That is exactly the channel the feedback loop travelled,
//     so the stability case below is a real test of the reset-before-measure guard: without it,
//     12 → 11.4 → 10.83 → the 11px legibility floor.
// The pure math is locked in tests/statPanel.test.js; real geometry is on-device per the standing
// lesson.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { within, cleanup, fireEvent, act } from '@testing-library/react'
import {
  mountApp,
  openSettings,
  picker,
  pickerLockState,
  resetAppState,
} from './helpers/settingsPanel.jsx'

const swDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
const cwDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
const origGetComputedStyle = window.getComputedStyle

let btnWidth = 50 // trio-button content width the mocks report; tests vary it to steer the scale

// A pill inside one of the panel's own pickers — the re-render driver the stability case below
// needs. See the comment there for why a store poke will not do.
const pill = (group, label) => within(picker(group)).getByRole('radio', { name: label })

describe('footer-button auto-fit wiring (Round-2, twin-free since Q7)', () => {
  beforeEach(() => {
    resetAppState()
    btnWidth = 50
    // Every [data-fitlabel] span reports a 100px natural caption; the trio buttons report btnWidth
    // of content width. Every other element keeps jsdom's 0 (→ scale 1 no-ops elsewhere).
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.hasAttribute?.('data-fitlabel') ? 100 : 0
      },
    })
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.matches?.('button') && this.querySelector('[data-fitlabel]') ? btnWidth : 0
      },
    })
    // Model inheritance: a caption's computed fontSize is its BUTTON's inline size, or 12px
    // (text-xs) when the button carries none. fitFooterBtns resets the button to '' before reading
    // the base off the caption, so this shim returns 12px on that read — which is the whole point:
    // a version that skipped the reset would read the previous pass's shrink back in.
    window.getComputedStyle = (el, pseudo) => {
      if (el?.hasAttribute?.('data-fitlabel'))
        return { fontSize: el.parentElement?.style.fontSize || '12px' }
      return origGetComputedStyle(el, pseudo)
    }
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    Object.defineProperty(Element.prototype, 'scrollWidth', swDesc)
    Object.defineProperty(Element.prototype, 'clientWidth', cwDesc)
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
    // The measurement twins are gone — Q7 froze every caption, so there is nothing to swap.
    expect(document.querySelectorAll('[data-fittwin]')).toHaveLength(0)
  })

  it('applies ONE shared floored font-size to all three captions when the measurements demand a shrink', () => {
    mountApp()
    openSettings()
    const labels = Array.from(document.querySelectorAll('[data-fitlabel]'))
    expect(labels).toHaveLength(3)
    // scale = min(50/100) = 0.5 → 12px × 0.5 = 6px → floored to the 11px legibility minimum.
    // The fitted size lands on the BUTTON (the caption inherits it) so the line-box strut shrinks
    // with the text and the label stays vertically centered; the span itself carries no inline size.
    expect(labels.map((l) => l.parentElement.style.fontSize)).toEqual(['11px', '11px', '11px'])
    expect(labels.map((l) => l.style.fontSize)).toEqual(['', '', ''])
  })

  it('the fit is STABLE across re-renders — the shrink never compounds toward the floor', () => {
    btnWidth = 95 // scale = 95/100 = 0.95 → 12px × 0.95 = 11.4px, above the 11px floor
    mountApp()
    openSettings()
    const expected = Math.max(11, 12 * 0.95) + 'px'
    const labels = Array.from(document.querySelectorAll('[data-fitlabel]'))
    expect(labels.map((l) => l.parentElement.style.fontSize)).toEqual([
      expected,
      expected,
      expected,
    ])
    // Any settings interaction re-runs the dep-less fit effect. The reset-before-measure step is
    // what keeps this stable: the getComputedStyle shim models inheritance, so a version that read
    // the base off a still-shrunk caption would step 11.4 → 10.83 → 11 (the floor) here.
    //
    // ⚠ THE RE-RENDER IS DRIVEN THROUGH THE PANEL'S OWN CONTROLS. A tap on a pill inside the panel
    // is a re-render the footer's component cannot fail to observe, by construction — where a store
    // poke would only prove App re-rendered, which stops implying the footer did once the panel is
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
    expect(labels.map((l) => l.parentElement.style.fontSize)).toEqual([
      expected,
      expected,
      expected,
    ])
  })
})
