// @vitest-environment jsdom
//
// Dot Layout (Settings → Display → Dot Layout) — the 7-dot layout's SECOND orientation, the ⚙
// switch that picks it, and the app mark that turns with it.
//
// ⚠ WHAT jsdom CANNOT SAY, stated first so nothing below is read as saying it: there is no layout
// engine here, so not one assertion in this file proves that anything MOVED on screen. Every claim
// is about the instructions the app emits — which grid cell each dot button is placed in, and what
// transform the mark carries. That is the honest boundary, and it is also where the two bugs this
// setting could plausibly ship actually live: a rotation applied to the wrong thing, and a rotation
// applied to the paint but not the data.
//
// Q3 (round 20) REWROTE THIS FILE'S MIDDLE AND FOOT. The store field is now the boolean
// `rotateDots` (store/settings), not the two-valued `dotOrientation` picker this file used to drive
// directly — `dotOrientationFor` (lib/dotLayout) is the one place the boolean is turned back into
// the geometry's own 'columns' | 'rows' type, and every consumer derives through it. Two things
// changed shape, not just name:
//   1. THE PANEL CONTROL. What used to be a two-option PillTray (Columns / Rows) is now an On/Off
//      switch, on the same footing as Amnesic and Save Stats — see 'Settings → Dot Layout switch'.
//   2. THE MARK'S GATE. main.tsx's W5Logo used to read `dotOrientation` UNCONDITIONALLY, so a
//      player on Buttons could leave the setting on and the title-bar mark sat turned forever with
//      no dots anywhere on screen it corresponded to. It now also requires `inputStyle==='dots'` —
//      see 'The title-bar mark only turns while Input is Dots', which is the fix this round shipped.
//
// WHAT IT STILL LOCKS, unchanged in SHAPE from the picker it replaced:
//   1. THE INPUT TURNS AS DATA. Each dot's gridRow/gridColumn changes with the setting while DOM
//      order stays Sun..Sat. That pairing is the whole design decision (components/WeekdayAnswer):
//      a CSS transform on the cluster would have moved the pixels and left the keyboard 0–9 path
//      (children[idx]) and the screen-reader walk describing the upright layout. The two halves are
//      asserted together because either alone passes for the wrong implementation.
//   2. THE SWITCH. It flips in a weekday mode with Dots chosen, and is locked — value preserved —
//      in the two states where there are no dots to turn: Deduction (sharing Input's lock, because
//      it shares Input's subject) and any mode while Input is on Buttons.
//   3. THE MARK. The TITLE BAR's W5 glyph turns with the setting WHILE Input is Dots; the
//      rotate-back overlay's does NOT, and W5Logo's default is upright. That asymmetry is
//      deliberate and easy to "fix" by accident, which is exactly why it is pinned: the full-screen
//      frames stand next to the static iOS launch PNGs (public/apple-splash-*, pre-renders of
//      index.html's #boot) that can follow nothing, so a frame that turned would flip the mark
//      against a PNG that cannot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { DAY } from '../src/lib/format.js'
import { DOT_CELLS, DOT_MARK_ROTATION } from '../src/lib/dotLayout.js'
import W5Logo from '../src/components/W5Logo.jsx'
import RotateOverlay from '../src/components/RotateOverlay.jsx'
import {
  mountApp,
  openSettings,
  pickPill,
  expectLock,
  settingSwitch,
  switchState,
  toggleSwitch,
  isOffered,
  isDimmed,
  drawnUnavailable,
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
      useSettings.getState().setRotateDots(orientation === 'rows')
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
    act(() => useSettings.getState().setRotateDots(true))
    const after = Array.from(grid.children)
    // Same element identities, same order — only the placement moved. A remount here would be a
    // real defect: the grid is keyed on gridEpoch precisely so that a RESET, and nothing else,
    // snaps the answer colours back to idle.
    after.forEach((btn, i) => expect(btn).toBe(before[i]))
    expect(after.map((b) => b.getAttribute('aria-label'))).toEqual(DAY)
    expect(after.map(cellOf)).toEqual(DOT_CELLS.rows.map((c) => c))
  })
})

// ── The persisted-shape migration (Q3, round 20) ────────────────────────────────────────────────
//
// The pure rewrite (`migrateDotOrientation`) is unit-tested in settings.test.js (Node); this is the
// WIRING half — a stored v1 payload actually reaching it via useSettings.persist.rehydrate(), the
// same zustand entry point a real reload takes — mirroring exactly how progress.test.js /
// progress.dom.test.js split the same concern for migrateAoxBestKeys. No app mount needed: this is
// the store against real (jsdom) localStorage, nothing more.
describe('settings store — v1 dotOrientation payload rehydrates through the migration', () => {
  beforeEach(() => {
    resetAppState()
  })

  it('a stored v1 payload with dotOrientation "rows" loads as rotateDots: true', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = { state: { ...oldShape, dotOrientation: 'rows', minY: 1600 }, version: 1 }
    localStorage.setItem('cg-settings-v1', JSON.stringify(v1))
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.rotateDots).toBe(true)
    // Everything else passed through untouched, and the old field name did not tag along.
    expect(s.minY).toBe(1600)
    expect(s).not.toHaveProperty('dotOrientation')
  })

  it('a stored v1 payload with dotOrientation "columns" loads as rotateDots: false', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = { state: { ...oldShape, dotOrientation: 'columns' }, version: 1 }
    localStorage.setItem('cg-settings-v1', JSON.stringify(v1))
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().rotateDots).toBe(false)
  })

  it('a v1 payload from BEFORE dotOrientation existed (neither field) loads the factory default', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = { state: oldShape, version: 1 } // no dotOrientation at all — an even older build
    localStorage.setItem('cg-settings-v1', JSON.stringify(v1))
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().rotateDots).toBe(false)
  })

  it('a current-version (v2) payload rehydrates unchanged — no migration re-fires', async () => {
    const v2 = {
      state: { ...SETTINGS_DEFAULTS, rotateDots: true, dateFormat: 'numeric-ymd' },
      version: 2,
    }
    localStorage.setItem('cg-settings-v1', JSON.stringify(v2))
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.rotateDots).toBe(true)
    expect(s.dateFormat).toBe('numeric-ymd')
  })
})

describe('Settings → Dot Layout switch', () => {
  beforeEach(() => {
    resetAppState()
  })

  // Every case below wants the switch LIVE, and the panel's launch state is not: Input starts on
  // Buttons, where Dot Layout is locked because there is nothing on screen it could turn (see the
  // Buttons case at the foot of this describe). Chosen through the panel rather than written into
  // the store, so the setup is the gesture a player makes.
  const chooseDots = () => pickPill('Input', 'Dots')

  it('flips between Off and On in a weekday mode, and is not locked', () => {
    mountApp() // opens in Classic (a weekday mode)
    openSettings('key')
    chooseDots()
    expect(useSettings.getState().rotateDots).toBe(false)
    expect(switchState('Dot Layout')).toBe('Off')
    toggleSwitch('Dot Layout')
    expect(useSettings.getState().rotateDots).toBe(true)
    expect(switchState('Dot Layout')).toBe('On')
    toggleSwitch('Dot Layout')
    expect(useSettings.getState().rotateDots).toBe(false)
    expect(switchState('Dot Layout')).toBe('Off')
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(true)
  })

  // It shares Input's mode lock because it shares Input's subject — the weekday dot input, which
  // Deduction does not have. Asserted as a PAIR: the two moving apart is the failure this case
  // exists to catch, and neither control's own state would show it.
  // ⚠ THE PAIR IS ABOUT THIS CONDITION ONLY, and the two are NOT interchangeable: Dot Layout has a
  // second lock Input does not (Buttons — the case below), because Input chooses whether there are
  // dots at all and cannot lock itself out.
  it('is locked (dimmed, value preserved) in Deduction, exactly with Input', () => {
    mountApp()
    openSettings('key')
    chooseDots() // …so the lock this case reads is the MODE's, not the Buttons one
    expectLock('Input', false)
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(true)
    act(() => {
      fireEvent.keyDown(window, { key: 'D' }) // switch to Deduction
    })
    openSettings('key')
    expectLock('Input', true)
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(false)
    expect(drawnUnavailable(settingSwitch('Dot Layout'))).toBe(true)
    // The onClick guard behind the switch keeps the value even if a press is dispatched at it.
    toggleSwitch('Dot Layout')
    expect(useSettings.getState().rotateDots).toBe(false)
  })

  // ★ THE SECOND LOCK, and the one the setting SHIPPED WITHOUT round 19: with Input on Buttons
  // there are no dots on screen to turn, so the only thing this switch could still move is the
  // title-bar mark — a control whose whole visible effect is somewhere else, permanently, with
  // nothing it corresponds to. The owner's requirement is that the mark turn WITH THE INPUT. So the
  // switch locks exactly as it does in Deduction: same dim, value preserved.
  it('is locked while the answer input is Buttons, and unlocks the moment Dots is chosen', () => {
    mountApp() // Classic, Input at its factory Buttons
    openSettings('key')
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(false)
    expectLock('Input', false) // …and Input itself stays live, or there would be no way out
    // The guard behind the lock holds: a press dispatched at the switch changes nothing.
    toggleSwitch('Dot Layout')
    expect(useSettings.getState().rotateDots).toBe(false)
    chooseDots()
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(true)
    toggleSwitch('Dot Layout')
    expect(useSettings.getState().rotateDots).toBe(true)
    // …and going back to Buttons re-locks it with the pick intact, rather than resetting it.
    pickPill('Input', 'Buttons')
    expect(isOffered(settingSwitch('Dot Layout'))).toBe(false)
    expect(switchState('Dot Layout')).toBe('On')
    expect(useSettings.getState().rotateDots).toBe(true)
  })

  // Dot Layout is a SWITCH like Amnesic and Save Stats, not a picker — asserted here rather than
  // assumed, because the setting used to be drawn as a two-option tray and a rewrite that left a
  // PillGroup/PillTray behind would pass every value-level test above while getting the CONTROL
  // KIND wrong. Same contract, checked the same way tests/amnesic.dom checks Amnesic's: the lock
  // announces on the button (aria-disabled), the dim is drawn on an ANCESTOR of the button rather
  // than the button itself (opacity would otherwise multiply through two layers), and nothing here
  // uses pointer-events-none — a keyboard user reaches the button and is told why it does nothing.
  it('matches the Amnesic switch contract exactly: aria-disabled, an ancestor dim, no pointer-events-none', () => {
    mountApp() // Input starts on Buttons — Dot Layout starts locked
    openSettings('key')
    expect(settingSwitch('Dot Layout').getAttribute('aria-disabled')).toBe('true')
    expect(isDimmed(settingSwitch('Dot Layout'))).toBe(false) // not on the button itself
    expect(settingSwitch('Dot Layout').className).not.toMatch(/(^|\s)pointer-events-none(\s|$)/)
    expect(settingSwitch('Dot Layout').className).toMatch(/(^|\s)cursor-not-allowed(\s|$)/)
    expect(drawnUnavailable(settingSwitch('Dot Layout'))).toBe(true) // an ancestor carries the dim
    chooseDots()
    expect(settingSwitch('Dot Layout').getAttribute('aria-disabled')).toBeNull()
    expect(drawnUnavailable(settingSwitch('Dot Layout'))).toBe(false)
  })
})

// ── The mark (Q3's actual bug fix) ──────────────────────────────────────────────────────────────
describe('The title-bar mark only turns while Input is Dots — and the fixed frames never turn', () => {
  beforeEach(() => {
    resetAppState()
  })

  // ★ THE BUG THIS ROUND FIXES, stated as its own case rather than folded into the pair below: the
  // mark used to read `rotateDots` (then `dotOrientation`) unconditionally, so a player on Buttons
  // could leave Dot Layout on and the mark sat turned forever with no dots anywhere on screen it
  // corresponded to.
  it('stays upright with Dot Layout on, while Input is Buttons', () => {
    const { container } = mountApp() // Classic, Input at its factory Buttons
    act(() => useSettings.getState().setRotateDots(true))
    expect(MARKS(container)[0].style.transform).toBe('none')
  })

  it('turns the moment Input becomes Dots, with Dot Layout already on', () => {
    const { container } = mountApp()
    act(() => useSettings.getState().setRotateDots(true))
    act(() => useSettings.getState().setInputStyle('dots'))
    expect(MARKS(container)[0].style.transform).toBe('rotate(-90deg)')
  })

  it('leaves the mark upright on Off, and turns it a quarter turn anticlockwise on On, while Input is Dots', () => {
    const { container } = mountApp()
    act(() => useSettings.getState().setInputStyle('dots'))
    const marks = MARKS(container)
    expect(marks).toHaveLength(1) // the title bar's, and only it — no overlay is mounted
    expect(marks[0].style.transform).toBe('none')
    act(() => useSettings.getState().setRotateDots(true))
    expect(MARKS(container)[0].style.transform).toBe('rotate(-90deg)')
    // Anticlockwise, which in CSS is a NEGATIVE angle — the dots turn the same way, so a sign flip
    // here would leave the mark mirroring the input instead of matching it.
    expect(DOT_MARK_ROTATION.rows).toBe('rotate(-90deg)')
  })

  it('snaps back upright the moment Input returns to Buttons, even though Dot Layout stays on', () => {
    const { container } = mountApp()
    act(() => useSettings.getState().setInputStyle('dots'))
    act(() => useSettings.getState().setRotateDots(true))
    expect(MARKS(container)[0].style.transform).toBe('rotate(-90deg)')
    act(() => useSettings.getState().setInputStyle('buttons'))
    expect(MARKS(container)[0].style.transform).toBe('none')
    expect(useSettings.getState().rotateDots).toBe(true) // the setting itself is untouched
  })

  // The mark stays DECORATIVE through the turn, in every combination of the two settings that gate
  // it. It carries no accessible name in any state — the <h1> beside it is the name — so nothing
  // about the rotation reaches the accessibility tree, which is the licence the CSS transform is
  // used under in the first place.
  it('stays aria-hidden and unfocusable in every combination of Dot Layout and Input', () => {
    const { container } = mountApp()
    for (const rotate of [false, true]) {
      for (const style of ['buttons', 'dots']) {
        act(() => {
          useSettings.getState().setRotateDots(rotate)
          useSettings.getState().setInputStyle(style)
        })
        const mark = MARKS(container)[0]
        expect(mark.getAttribute('aria-hidden')).toBe('true')
        expect(mark.getAttribute('focusable')).toBe('false')
      }
    }
  })

  it('W5Logo defaults to the canonical upright mark — a caller has to ask for the turn', () => {
    useSettings.getState().setRotateDots(true)
    const { container } = render(<W5Logo />)
    expect(MARKS(container)[0].style.transform).toBe('none')
  })

  // ★ THE DELIBERATE MISMATCH. RotateOverlay draws the splash's glyph at the splash's size, and the
  // splash is pinned to static PNGs that cannot follow a setting — so this frame keeps the upright
  // mark even while the title bar's has turned. If this case ever fails, read the comment in
  // components/RotateOverlay before "fixing" it: the failure is the intended behaviour being
  // removed, not a bug being found.
  it('the rotate-back overlay keeps the upright mark even with Dot Layout on and Input on Dots', () => {
    useSettings.getState().setRotateDots(true)
    useSettings.getState().setInputStyle('dots')
    const { container } = render(<RotateOverlay />)
    const mark = MARKS(container)[0]
    expect(mark).toBeDefined()
    expect(mark.style.transform).toBe('none')
  })
})
