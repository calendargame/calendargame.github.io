// @vitest-environment jsdom
//
// Rotate Dots (Settings → Display → Rotate Dots: Standard / 45° CCW / 90° CCW) — the 7-dot layout's
// three rotations, the ⚙ picker that chooses one, the saved-data migration onto it, the CSS that
// draws the 45° lattice, and the app mark that turns with it.
//
// ⚠ WHAT jsdom CANNOT SAY, stated first so nothing below is read as saying it: there is no layout
// engine here, so not one assertion in this file proves that anything MOVED on screen. Every claim
// is about the instructions the app emits — which grid cell each dot button is placed in, which
// lattice the cluster declares, and what transform the mark carries. That is the honest boundary,
// and it is also where the bugs this setting could plausibly ship actually live: a rotation applied
// to the wrong thing, and a rotation applied to the paint but not the data. (The 45° layout's real
// geometry — sizes, hit areas, clipping — was measured in a real browser when it was built; the
// CSS block below pins the rules that produced those measurements.)
//
// ITS HISTORY, since three generations of it are still in saved data: a two-option picker
// (`dotOrientation`: Columns / Rows), then an On/Off switch (round 20's boolean `rotateDots`), then
// this three-way picker (round 23's `dotRotation`). lib/dotLayout's DotRotation is the ONE type
// both the setting and the geometry use — there is no translation layer left to test.
//
// WHAT IT LOCKS:
//   1. THE INPUT TURNS AS DATA. Each dot's gridRow/gridColumn changes with the setting while DOM
//      order stays Sun..Sat. That pairing is the whole design decision (components/WeekdayAnswer):
//      a CSS transform on the cluster would have moved the pixels and left the keyboard 0–9 path
//      (children[idx]) and the screen-reader walk describing the standard layout. The two halves
//      are asserted together because either alone passes for the wrong implementation.
//   2. THE MIGRATION, WIRED. Every saved shape reaches today's through the store's own rehydrate —
//      on preset 1's key, AND on another preset's namespaced keys, settings and saved defaults both.
//   3. THE PICKER. It chooses in a weekday mode with Dots chosen, and is locked — value preserved —
//      in the two states where there are no dots to turn: Deduction (sharing Input's lock, because
//      it shares Input's subject) and any mode while Input is on Buttons.
//   4. THE MARK. The TITLE BAR's W5 glyph turns with the setting WHILE Input is Dots; the
//      rotate-back overlay's does NOT, and W5Logo's default is Standard. That asymmetry is
//      deliberate and easy to "fix" by accident, which is exactly why it is pinned: the full-screen
//      frames stand next to the static iOS launch PNGs (public/apple-splash-*, pre-renders of
//      index.html's #boot) that can follow nothing, so a frame that turned would flip the mark
//      against a PNG that cannot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import { createPreset, switchPreset } from '../src/store/presetControl.js'
import { MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { DAY } from '../src/lib/format.js'
import {
  DOT_CELLS,
  DOT_MARK_ROTATION,
  DOT_ROTATIONS,
  DIAGONAL_DOT_SCALE,
} from '../src/lib/dotLayout.js'
import { DOT_ROTATION_OPTIONS } from '../src/components/settingsOptions.js'
import W5Logo from '../src/components/W5Logo.jsx'
import RotateOverlay from '../src/components/RotateOverlay.jsx'
import {
  mountApp,
  openSettings,
  pickPill,
  expectLock,
  pickerChosen,
  resetAppState,
} from './helpers/settingsPanel.jsx'

// The mark, wherever it is drawn: the one glyph in the app with the icon's own viewBox.
const MARKS = (root) => Array.from(root.querySelectorAll('svg[viewBox="178 173 146 158"]'))
// A dot button's placement, as the two inline properties WeekdayAnswer writes.
const cellOf = (btn) => ({ r: Number(btn.style.gridRow), c: Number(btn.style.gridColumn) })
// The settings snapshot as a pre-round-23 build saved it: no `dotRotation`.
const { dotRotation: _drop, ...PRE_Q6 } = SETTINGS_DEFAULTS
const LABEL = { standard: 'Standard', ccw45: '45° CCW', ccw90: '90° CCW' }

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('Rotate Dots — the input turns as DATA, not as paint', () => {
  beforeEach(() => {
    resetAppState()
    useSettings.getState().setInputStyle('dots')
  })

  for (const rotation of DOT_ROTATIONS) {
    it(`places every dot on its ${rotation} cell while DOM order stays Sun..Sat`, () => {
      useSettings.getState().setDotRotation(rotation)
      mountApp()
      const grid = screen.getByRole('button', { name: 'Sunday' }).parentElement
      expect(grid.getAttribute('data-answer-grid')).toBe('true')
      // The cluster names its rotation — the one hook index.css's 45° lattice hangs off.
      expect(grid.getAttribute('data-dot-rotation')).toBe(rotation)
      const kids = Array.from(grid.children)
      expect(kids).toHaveLength(7)
      kids.forEach((btn, i) => {
        // DOM order — INVARIANT under the turn. This is the half a CSS transform would have left
        // true while breaking nothing visible, so it is asserted in every rotation.
        expect(btn.getAttribute('aria-label')).toBe(DAY[i])
        // Placement — the half that actually changes.
        expect(cellOf(btn)).toEqual(DOT_CELLS[rotation][i])
      })
      // …and no inline transform is doing the work instead: neither the cluster nor any dot
      // carries one. (45°'s hit-area turn lives on the ::after in index.css — see below.)
      expect(grid.style.transform).toBe('')
      kids.forEach((btn) => expect(btn.style.transform).toBe(''))
    })
  }

  it('re-places the SAME buttons when the setting changes mid-session — nothing remounts or reorders', () => {
    mountApp()
    const grid = screen.getByRole('button', { name: 'Sunday' }).parentElement
    const before = Array.from(grid.children)
    expect(before.map(cellOf)).toEqual([...DOT_CELLS.standard])
    for (const rotation of ['ccw45', 'ccw90', 'standard']) {
      act(() => useSettings.getState().setDotRotation(rotation))
      const after = Array.from(grid.children)
      // Same element identities, same order — only the placement moved. A remount here would be a
      // real defect: the grid is keyed on gridEpoch precisely so that a RESET, and nothing else,
      // snaps the answer colours back to idle.
      after.forEach((btn, i) => expect(btn).toBe(before[i]))
      expect(after.map((b) => b.getAttribute('aria-label'))).toEqual(DAY)
      expect(after.map(cellOf)).toEqual([...DOT_CELLS[rotation]])
      expect(grid.getAttribute('data-dot-rotation')).toBe(rotation)
    }
  })
})

// ── The CSS that draws the 45° lattice (index.css) ──────────────────────────────────────────────
//
// jsdom applies no stylesheet, so this reads the rules as text — the same approach
// tests/answerHitPad takes for --answer-gap. What it pins is exactly what the real-browser
// measurement at build time depended on.
describe('index.css — the 45° lattice is one scoped override; Standard and 90° are untouched', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  const decls = (selector) => {
    const at = css.split('}').find((chunk) => chunk.trim().startsWith(`${selector}{`))
    return at === undefined ? null : at.slice(at.indexOf('{') + 1)
  }
  const D45 = '.dot-cluster[data-dot-rotation="ccw45"]'

  it('the shared rules are exactly as before 45° existed — Standard and 90° stay pixel-identical', () => {
    expect(decls('.dot-cluster')).toBe(
      '--dot-frac:.72;inline-size:min(var(--ans-h),100%);aspect-ratio:1;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);place-items:center',
    )
    expect(decls('.dot-btn')).toBe(
      '--hit-bd:1px;position:relative;inline-size:calc(var(--dot-frac) * 100%);aspect-ratio:1;border-radius:50%;border-width:var(--hit-bd);border-style:solid',
    )
    expect(decls('.dot-btn::after')).toBe(
      'content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);inline-size:calc((100% + 2 * var(--hit-bd)) / var(--dot-frac));aspect-ratio:1',
    )
    // Nothing names the other two rotations: they need no rule of their own.
    expect(css).not.toMatch(/data-dot-rotation="(standard|ccw90)"/)
  })

  it('45° declares a 5×5 lattice, shrunk by the SAME scale lib/dotLayout gives the mark', () => {
    const d = decls(D45)
    // minmax(0,…), not a bare 1fr: a 45° dot is ~1.018 tracks across, and a bare fr track floors
    // at its content — the rows grew to fit the dots, which stretched the cluster ~4px taller than
    // wide (measured in a real browser before this was fixed).
    expect(d).toMatch(/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/)
    expect(d).toMatch(/grid-template-rows:repeat\(5,minmax\(0,1fr\)\)/)
    // The one number CSS cannot import — checked against DIAGONAL_DOT_SCALE, as --answer-gap is
    // checked against ANSWER_GRID_GAP.
    expect(Number(/--dot-scale:([\d.]+)/.exec(d)?.[1])).toBe(DIAGONAL_DOT_SCALE)
    // Lattice side = box × 5k/(3√2), the rest split as padding either side.
    expect(d).toContain(
      'padding:calc(min(var(--ans-h),100%) * (1 - 5 * var(--dot-scale) / (3 * 1.41421356)) / 2)',
    )
    // The owner-approved ~75–80%.
    expect(DIAGONAL_DOT_SCALE).toBeGreaterThanOrEqual(0.75)
    expect(DIAGONAL_DOT_SCALE).toBeLessThanOrEqual(0.8)
  })

  it('45° dots are --dot-frac of their TURNED cell, and each hit area is that cell turned — a diamond, clipped to the box', () => {
    expect(decls(`${D45} .dot-btn`)).toBe('inline-size:calc(var(--dot-frac) * 1.41421356 * 100%)')
    expect(decls(`${D45} .dot-btn::after`)).toBe('transform:translate(-50%,-50%) rotate(45deg)')
    expect(decls(D45)).toMatch(/clip-path:inset\(0\)/)
  })

  // The arithmetic behind "fits, with room for the drag ring", from the constants themselves: in
  // units of the box, a lattice track is 5k/(3√2)/5, the outermost dot centre sits 2 tracks out,
  // and a dot is 0.72·√2 tracks across.
  it('at that scale the outermost dot clears the box edge by more than the 2px drag ring', () => {
    const k = DIAGONAL_DOT_SCALE
    const track = k / (3 * Math.SQRT2)
    const outerEdge = 2 * track + (0.72 * Math.SQRT2 * track) / 2
    const clearance = 0.5 - outerEdge // as a fraction of the box
    expect(clearance).toBeGreaterThan(0.02) // ≥ ~4.7px on the ~236px phone box
    // …while each diamond's tip (3 tracks out) DOES pass the box — which is why it is clipped.
    expect(3 * track).toBeGreaterThan(0.5)
  })
})

// ── The persisted-shape migration, WIRED (round 23) ──────────────────────────────────────────
//
// The pure rewrite (`migrateDotRotation`) is unit-tested in settings.test.js (Node); this is the
// WIRING half — stored payloads actually reaching it via useSettings.persist.rehydrate(), the same
// zustand entry point a real reload takes. store/userDefaults' copy of the same wiring is
// tests/userDefaults.dom's.
describe('settings store — every saved shape of Rotate Dots rehydrates through the migration', () => {
  beforeEach(() => {
    resetAppState()
  })
  const store = (state, version) =>
    localStorage.setItem('cg-settings-v1', JSON.stringify({ state, version }))
  const stored = () => JSON.parse(localStorage.getItem('cg-settings-v1'))

  it('a v3 payload (round 20–22) with rotateDots: true loads as 90° CCW, and is re-saved in today’s shape', async () => {
    store({ ...PRE_Q6, rotateDots: true, minY: 1600 }, 3)
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.dotRotation).toBe('ccw90')
    expect(s.minY).toBe(1600) // everything else passed through untouched
    expect(s).not.toHaveProperty('rotateDots')
    expect(stored().version).toBe(4)
    expect(stored().state).not.toHaveProperty('rotateDots')
    expect(stored().state.dotRotation).toBe('ccw90')
  })

  it('a v3 payload with rotateDots: false loads the factory Standard', async () => {
    store({ ...PRE_Q6, rotateDots: false }, 3)
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().dotRotation).toBe('standard')
  })

  it('a v1 payload with the ORIGINAL dotOrientation "rows" loads as 90° CCW', async () => {
    store({ ...PRE_Q6, dotOrientation: 'rows' }, 1)
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.dotRotation).toBe('ccw90')
    expect(s).not.toHaveProperty('dotOrientation')
  })

  it('a payload from BEFORE the setting existed (neither field) loads the factory Standard', async () => {
    store(PRE_Q6, 1)
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().dotRotation).toBe('standard')
  })

  it('a current-version (v4) payload rehydrates unchanged — 45° survives', async () => {
    store({ ...SETTINGS_DEFAULTS, dotRotation: 'ccw45', dateFormat: 'numeric-ymd' }, 4)
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.dotRotation).toBe('ccw45')
    expect(s.dateFormat).toBe('numeric-ymd')
  })

  // ★ THIS BUILD AS THE OLDER ONE. A future build that adds a rotation bumps the version; zustand
  // still runs this build's migrate on the mismatch, which screens the value this build cannot draw
  // — so the answer grid falls back to Standard instead of looking up an undefined layout.
  it('a NEWER-version payload with a rotation this build does not know falls back to Standard, and the app still draws', async () => {
    useSettings.getState().setInputStyle('dots')
    store({ ...SETTINGS_DEFAULTS, inputStyle: 'dots', dotRotation: 'ccw30' }, 99)
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().dotRotation).toBe('standard')
    mountApp()
    const grid = screen.getByRole('button', { name: 'Sunday' }).parentElement
    expect(Array.from(grid.children).map(cellOf)).toEqual([...DOT_CELLS.standard])
  })

  // ★ EVERY PRESET, not just preset 1. Presets 2+ keep their own namespaced keys, and nothing
  // rewrites them in bulk: each is migrated by its own store's rehydrate when the preset is opened.
  // This proves that path reaches BOTH per-preset stores that hold the setting — the live settings
  // and the Save Defaults snapshot — on a preset that last saved under a pre-round-23 build.
  it('another preset’s OWN keys — settings and saved defaults — migrate when that preset is opened', async () => {
    const p2 = createPreset('Other').id
    const PREFS = {
      flashMs: MODE_PREFS_DEFAULTS.flashMs,
      blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
      blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
      aoxN: MODE_PREFS_DEFAULTS.aoxN,
    }
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, p2),
      JSON.stringify({ state: { ...PRE_Q6, rotateDots: true, minY: 1700 }, version: 3 }),
    )
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.userDefaults, p2),
      JSON.stringify({
        state: {
          saved: { settings: { ...PRE_Q6, rotateDots: true }, prefs: PREFS, amnesic: false },
        },
        version: 2,
      }),
    )
    await act(async () => {
      switchPreset(p2)
    })
    expect(useSettings.getState().minY).toBe(1700) // it really is preset 2's payload on screen
    expect(useSettings.getState().dotRotation).toBe('ccw90')
    expect(useUserDefaults.getState().saved.settings.dotRotation).toBe('ccw90')
    expect(useUserDefaults.getState().saved.settings).not.toHaveProperty('rotateDots')
    // …and both namespaced keys were rewritten in place, at today's versions.
    const s2 = JSON.parse(localStorage.getItem(presetKey(PRESET_STORE_KEYS.settings, p2)))
    const u2 = JSON.parse(localStorage.getItem(presetKey(PRESET_STORE_KEYS.userDefaults, p2)))
    expect([s2.version, s2.state.dotRotation, 'rotateDots' in s2.state]).toEqual([
      4,
      'ccw90',
      false,
    ])
    expect([u2.version, u2.state.saved.settings.dotRotation]).toEqual([3, 'ccw90'])
  })
})

describe('Settings → Rotate Dots picker', () => {
  beforeEach(() => {
    resetAppState()
  })

  // Every case below that wants the picker LIVE has to put Input on Dots first: the panel launches
  // with Input on Buttons, where Rotate Dots is locked because there is nothing on screen it could
  // turn. Chosen through the panel rather than written into the store, so the setup is the gesture a
  // player makes.
  const chooseDots = () => pickPill('Input', 'Dots')

  it('offers exactly Standard / 45° CCW / 90° CCW, in that order, over the three DotRotation values', () => {
    expect(DOT_ROTATION_OPTIONS.map((o) => o.value)).toEqual([...DOT_ROTATIONS])
    expect(DOT_ROTATION_OPTIONS.map((o) => o.label)).toEqual(['Standard', '45° CCW', '90° CCW'])
  })

  it('chooses each rotation in a weekday mode, and is not locked', () => {
    mountApp() // opens in Classic (a weekday mode)
    openSettings('key')
    chooseDots()
    expectLock('Rotate Dots', false)
    expect(pickerChosen('Rotate Dots')).toEqual(['Standard'])
    for (const rotation of ['ccw45', 'ccw90', 'standard']) {
      pickPill('Rotate Dots', LABEL[rotation])
      expect(useSettings.getState().dotRotation).toBe(rotation)
      expect(pickerChosen('Rotate Dots')).toEqual([LABEL[rotation]])
    }
  })

  // It shares Input's mode lock because it shares Input's subject — the weekday dot input, which
  // Deduction does not have. Asserted as a PAIR: the two moving apart is the failure this case
  // exists to catch. ⚠ THE PAIR IS ABOUT THIS CONDITION ONLY: Rotate Dots has a second lock Input
  // does not (Buttons — the case below), because Input chooses whether there are dots at all and
  // cannot lock itself out.
  it('is locked (value preserved) in Deduction, exactly with Input', () => {
    mountApp()
    openSettings('key')
    chooseDots() // …so the lock this case reads is the MODE's, not the Buttons one
    pickPill('Rotate Dots', '45° CCW')
    expectLock('Input', false)
    expectLock('Rotate Dots', false)
    act(() => {
      fireEvent.keyDown(window, { key: 'D' }) // switch to Deduction
    })
    openSettings('key')
    expectLock('Input', true)
    expectLock('Rotate Dots', true)
    // PillTray's guard behind the lock keeps the value even if a press is dispatched at a pill.
    pickPill('Rotate Dots', '90° CCW')
    expect(useSettings.getState().dotRotation).toBe('ccw45')
    expect(pickerChosen('Rotate Dots')).toEqual(['45° CCW'])
  })

  // ★ THE SECOND LOCK: with Input on Buttons there are no dots on screen to turn, so the only thing
  // this picker could still move is the title-bar mark — a control whose whole visible effect is
  // somewhere else, with nothing it corresponds to. So it locks exactly as it does in Deduction.
  it('is locked while the answer input is Buttons, and unlocks the moment Dots is chosen', () => {
    mountApp() // Classic, Input at its factory Buttons
    openSettings('key')
    expectLock('Rotate Dots', true)
    expectLock('Input', false) // …and Input itself stays live, or there would be no way out
    pickPill('Rotate Dots', '45° CCW') // the guard behind the lock holds
    expect(useSettings.getState().dotRotation).toBe('standard')
    chooseDots()
    expectLock('Rotate Dots', false)
    pickPill('Rotate Dots', '90° CCW')
    expect(useSettings.getState().dotRotation).toBe('ccw90')
    // …and going back to Buttons re-locks it with the pick intact, rather than resetting it.
    pickPill('Input', 'Buttons')
    expectLock('Rotate Dots', true)
    expect(pickerChosen('Rotate Dots')).toEqual(['90° CCW'])
    expect(useSettings.getState().dotRotation).toBe('ccw90')
  })
})

// ── The mark ────────────────────────────────────────────────────────────────────────────────────
describe('The title-bar mark only turns while Input is Dots — and the fixed frames never turn', () => {
  beforeEach(() => {
    resetAppState()
  })

  it('carries each rotation’s transform: none, an eighth turn scaled like the input, a quarter turn', () => {
    // Anticlockwise, which in CSS is a NEGATIVE angle — the dots turn the same way, so a sign flip
    // here would leave the mark mirroring the input instead of matching it.
    expect(DOT_MARK_ROTATION).toEqual({
      standard: 'none',
      ccw45: `rotate(-45deg) scale(${DIAGONAL_DOT_SCALE})`,
      ccw90: 'rotate(-90deg)',
    })
  })

  // Round 20's bug, stated as its own case: the mark used to read the setting unconditionally, so a
  // player on Buttons could leave it turned and the mark sat turned forever with no dots anywhere on
  // screen it corresponded to.
  it('stays Standard with a rotation chosen, while Input is Buttons', () => {
    const { container } = mountApp() // Classic, Input at its factory Buttons
    for (const rotation of ['ccw45', 'ccw90']) {
      act(() => useSettings.getState().setDotRotation(rotation))
      expect(MARKS(container)[0].style.transform).toBe('none')
    }
  })

  it('follows every rotation while Input is Dots, and snaps back the moment Input returns to Buttons', () => {
    const { container } = mountApp()
    act(() => useSettings.getState().setInputStyle('dots'))
    const marks = MARKS(container)
    expect(marks).toHaveLength(1) // the title bar's, and only it — no overlay is mounted
    for (const rotation of DOT_ROTATIONS) {
      act(() => useSettings.getState().setDotRotation(rotation))
      expect(MARKS(container)[0].style.transform).toBe(DOT_MARK_ROTATION[rotation])
    }
    act(() => useSettings.getState().setDotRotation('ccw45'))
    act(() => useSettings.getState().setInputStyle('buttons'))
    expect(MARKS(container)[0].style.transform).toBe('none')
    expect(useSettings.getState().dotRotation).toBe('ccw45') // the setting itself is untouched
  })

  // The mark stays DECORATIVE through the turn, in every combination of the two settings that gate
  // it. It carries no accessible name in any state, so nothing about the rotation reaches the
  // accessibility tree — which is the licence the CSS transform is used under in the first place.
  it('stays aria-hidden and unfocusable in every combination of Rotate Dots and Input', () => {
    const { container } = mountApp()
    for (const rotation of DOT_ROTATIONS) {
      for (const style of ['buttons', 'dots']) {
        act(() => {
          useSettings.getState().setDotRotation(rotation)
          useSettings.getState().setInputStyle(style)
        })
        const mark = MARKS(container)[0]
        expect(mark.getAttribute('aria-hidden')).toBe('true')
        expect(mark.getAttribute('focusable')).toBe('false')
      }
    }
  })

  it('W5Logo defaults to the canonical Standard mark — a caller has to ask for the turn', () => {
    useSettings.getState().setDotRotation('ccw45')
    const { container } = render(<W5Logo />)
    expect(MARKS(container)[0].style.transform).toBe('none')
  })

  // ★ THE DELIBERATE MISMATCH. RotateOverlay draws the splash's glyph at the splash's size, and the
  // splash is pinned to static PNGs that cannot follow a setting — so this frame keeps the standard
  // mark even while the title bar's has turned. If this case ever fails, read the comment in
  // components/RotateOverlay before "fixing" it: the failure is the intended behaviour being
  // removed, not a bug being found.
  it('the rotate-back overlay keeps the Standard mark even with a rotation chosen and Input on Dots', () => {
    useSettings.getState().setDotRotation('ccw45')
    useSettings.getState().setInputStyle('dots')
    const { container } = render(<RotateOverlay />)
    const mark = MARKS(container)[0]
    expect(mark).toBeDefined()
    expect(mark.style.transform).toBe('none')
  })
})
