// @vitest-environment jsdom
//
// Dot Layout (Settings → Display → Dot Layout) — the 7-dot layout's SECOND orientation, and the
// app mark that turns with it.
//
// ⚠ WHAT jsdom CANNOT SAY, stated first so nothing below is read as saying it: there is no layout
// engine here, so not one assertion in this file proves that anything MOVED on screen. Every claim
// is about the instructions the app emits — which grid cell each dot button is placed in, and what
// transform the mark carries. That is the honest boundary, and it is also where the two bugs this
// setting could plausibly ship actually live: a rotation applied to the wrong thing, and a rotation
// applied to the paint but not the data.
//
// WHAT IT DOES LOCK:
//   1. THE INPUT TURNS AS DATA. Each dot's gridRow/gridColumn changes with the setting while DOM
//      order stays Sun..Sat. That pairing is the whole design decision (components/WeekdayAnswer):
//      a CSS transform on the cluster would have moved the pixels and left the keyboard 0–9 path
//      (children[idx]) and the screen-reader walk describing the upright layout. The two halves are
//      asserted together because either alone passes for the wrong implementation.
//   2. THE PICKER. Columns/Rows flips the setting in a weekday mode, and is locked — value
//      preserved — in Deduction, sharing Input's lock because it shares Input's subject.
//   3. THE MARK. The TITLE BAR's W5 glyph turns with the setting; the rotate-back overlay's does
//      NOT, and W5Logo's default is upright. That asymmetry is deliberate and easy to "fix" by
//      accident, which is exactly why it is pinned: the full-screen frames stand next to the static
//      iOS launch PNGs (public/apple-splash-*, pre-renders of index.html's #boot) that can follow
//      nothing, so a frame that turned would flip the mark against a PNG that cannot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { DAY } from '../src/lib/format.js'
import { DOT_CELLS, DOT_MARK_ROTATION } from '../src/lib/dotLayout.js'
import W5Logo from '../src/components/W5Logo.jsx'
import RotateOverlay from '../src/components/RotateOverlay.jsx'
import {
  mountApp,
  openSettings,
  pickerLockState,
  expectLock,
  resetAppState,
} from './helpers/settingsPanel.jsx'

// The mark, wherever it is drawn: the one glyph in the app with the icon's own viewBox.
const MARKS = (root) => Array.from(root.querySelectorAll('svg[viewBox="178 173 146 158"]'))
// A dot button's placement, as the two inline properties WeekdayAnswer writes.
const cellOf = (btn) => ({ r: Number(btn.style.gridRow), c: Number(btn.style.gridColumn) })

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('Dot Layout — the input turns as DATA, not as paint', () => {
  beforeEach(() => {
    resetAppState()
    useSettings.getState().setInputStyle('dots')
  })

  for (const orientation of ['columns', 'rows']) {
    it(`places every dot on its ${orientation} cell while DOM order stays Sun..Sat`, () => {
      useSettings.getState().setDotOrientation(orientation)
      mountApp()
      const grid = screen.getByRole('button', { name: 'Sunday' }).parentElement
      expect(grid.getAttribute('data-answer-grid')).toBe('true')
      const kids = Array.from(grid.children)
      expect(kids).toHaveLength(7)
      kids.forEach((btn, i) => {
        // DOM order — INVARIANT under the turn. This is the half a CSS transform would have left
        // true while breaking nothing visible, so it is asserted in both orientations.
        expect(btn.getAttribute('aria-label')).toBe(DAY[i])
        // Placement — the half that actually changes.
        expect(cellOf(btn)).toEqual(DOT_CELLS[orientation][i])
      })
      // …and no CSS transform is doing the work instead: neither the cluster nor any dot carries one.
      expect(grid.style.transform).toBe('')
      kids.forEach((btn) => expect(btn.style.transform).toBe(''))
    })
  }

  it('re-places the SAME buttons when the setting flips mid-session — nothing remounts or reorders', () => {
    mountApp()
    const grid = screen.getByRole('button', { name: 'Sunday' }).parentElement
    const before = Array.from(grid.children)
    expect(before.map(cellOf)).toEqual(DOT_CELLS.columns.map((c) => c))
    act(() => useSettings.getState().setDotOrientation('rows'))
    const after = Array.from(grid.children)
    // Same element identities, same order — only the placement moved. A remount here would be a
    // real defect: the grid is keyed on gridEpoch precisely so that a RESET, and nothing else,
    // snaps the answer colours back to idle.
    after.forEach((btn, i) => expect(btn).toBe(before[i]))
    expect(after.map((b) => b.getAttribute('aria-label'))).toEqual(DAY)
    expect(after.map(cellOf)).toEqual(DOT_CELLS.rows.map((c) => c))
  })
})

describe('Settings → Dot Layout picker', () => {
  beforeEach(() => {
    resetAppState()
  })

  it('flips between Columns and Rows in a weekday mode, and is not locked', () => {
    mountApp() // opens in Classic (a weekday mode)
    openSettings('key')
    expect(useSettings.getState().dotOrientation).toBe('columns')
    fireEvent.click(screen.getByRole('radio', { name: 'Rows' }))
    expect(useSettings.getState().dotOrientation).toBe('rows')
    fireEvent.click(screen.getByRole('radio', { name: 'Columns' }))
    expect(useSettings.getState().dotOrientation).toBe('columns')
    expectLock('Dot Layout', false)
    expect(screen.getByRole('radio', { name: 'Columns' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Rows' }).getAttribute('aria-checked')).toBe('false')
  })

  // It shares Input's lock because it shares Input's subject — the weekday dot input, which
  // Deduction does not have. Asserted as a PAIR: the two moving apart is the failure this case
  // exists to catch, and neither picker's own state would show it.
  it('is locked (dimmed, value preserved) in Deduction, exactly with Input', () => {
    mountApp()
    act(() => {
      fireEvent.keyDown(window, { key: 'D' }) // switch to Deduction
    })
    openSettings('key')
    expectLock('Dot Layout', true)
    expect(pickerLockState('Dot Layout').offered).toBe(pickerLockState('Input').offered)
    // The PillTray onChange guard keeps the value even if a click is dispatched at a segment.
    fireEvent.click(screen.getByRole('radio', { name: 'Rows' }))
    expect(useSettings.getState().dotOrientation).toBe('columns')
  })

  // Dot Layout is a picker like every other one in the panel, so it is a tray of radios inside a
  // named radiogroup — the panel's stated PICKER RULE. Asserted here rather than assumed because
  // the setting could plausibly have been drawn as the On/Off switch its two values invite.
  it('is a two-segment tray inside a named radiogroup, one tab stop, exactly one lit', () => {
    mountApp()
    openSettings('key')
    const s = pickerLockState('Dot Layout')
    expect(s.segments).toHaveLength(2)
    expect(s.tabStops).toBe(1)
    expect(s.chosen).toEqual(['Columns'])
  })
})

describe('The app mark turns with the setting — and the fixed frames do not', () => {
  beforeEach(() => {
    resetAppState()
  })

  it('leaves the title-bar mark upright on Columns, and turns it a quarter turn anticlockwise on Rows', () => {
    const { container } = mountApp()
    const marks = MARKS(container)
    expect(marks).toHaveLength(1) // the title bar's, and only it — no overlay is mounted
    expect(marks[0].style.transform).toBe('none')
    act(() => useSettings.getState().setDotOrientation('rows'))
    expect(MARKS(container)[0].style.transform).toBe('rotate(-90deg)')
    // Anticlockwise, which in CSS is a NEGATIVE angle — the dots turn the same way, so a sign flip
    // here would leave the mark mirroring the input instead of matching it.
    expect(DOT_MARK_ROTATION.rows).toBe('rotate(-90deg)')
  })

  // The mark stays DECORATIVE through the turn. It carries no accessible name in either
  // orientation — the <h1> beside it is the name — so nothing about the rotation reaches the
  // accessibility tree, which is the licence the CSS transform is used under in the first place.
  it('stays aria-hidden and unfocusable in both orientations', () => {
    const { container } = mountApp()
    for (const orientation of ['columns', 'rows']) {
      act(() => useSettings.getState().setDotOrientation(orientation))
      const mark = MARKS(container)[0]
      expect(mark.getAttribute('aria-hidden')).toBe('true')
      expect(mark.getAttribute('focusable')).toBe('false')
    }
  })

  it('W5Logo defaults to the canonical upright mark — a caller has to ask for the turn', () => {
    useSettings.getState().setDotOrientation('rows')
    const { container } = render(<W5Logo />)
    expect(MARKS(container)[0].style.transform).toBe('none')
  })

  // ★ THE DELIBERATE MISMATCH. RotateOverlay draws the splash's glyph at the splash's size, and the
  // splash is pinned to static PNGs that cannot follow a setting — so this frame keeps the upright
  // mark even while the title bar's has turned. If this case ever fails, read the comment in
  // components/RotateOverlay before "fixing" it: the failure is the intended behaviour being
  // removed, not a bug being found.
  it('the rotate-back overlay keeps the upright mark even on Rows', () => {
    useSettings.getState().setDotOrientation('rows')
    const { container } = render(<RotateOverlay />)
    const mark = MARKS(container)[0]
    expect(mark).toBeDefined()
    expect(mark.style.transform).toBe('none')
  })
})
