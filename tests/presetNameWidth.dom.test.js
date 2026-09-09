// @vitest-environment jsdom
//
// presetNameWidth.dom — the DOM/canvas-touching half of lib/presetNameWidth's live typing cap
// (Q6, round 20): reading the switcher's live cell (readSwitcherBudget), measuring text against a
// canvas (measureTextWidthPx, fitTextToWidth), and the one function components/PresetManager
// actually calls (capCandidateToSwitcherWidth). tests/presetNameWidth.test.js owns the PURE
// decision (fitsWithinWidth) with fabricated numbers and no jsdom at all.
//
// ⚠⚠ jsdom HAS NO LAYOUT ENGINE AND NO CANVAS. Neither fact is assumed here — both are PROVED, in
// the first two cases below, because the rest of this file's coverage depends on knowing exactly
// how each degrades: getBoundingClientRect always reports 0 (so readSwitcherBudget must fall back
// on a real switcher element the same as on a missing one, unless a test fakes the rect), and
// HTMLCanvasElement.getContext('2d') returns null rather than throwing (tests/setup/dom.js
// silences the "not implemented" warning that call would otherwise log on every keystroke).
import { describe, it, expect, afterEach } from 'vitest'
import {
  readSwitcherBudget,
  measureTextWidthPx,
  fitTextToWidth,
  capCandidateToSwitcherWidth,
} from '../src/lib/presetNameWidth.js'
import { PRESET_NAME_CELL_SELECTOR } from '../src/components/PresetSwitcher.jsx'

// A fake 2D context whose measureText is a simple, controllable function of the text — proportional
// (WIDTH_PER_CHAR px per character) rather than jsdom's real (nonexistent) glyph metrics, which is
// all a test of the WIRING needs: something deterministic to assert trimming against.
const WIDTH_PER_CHAR = 5
const installFakeCanvas = () => {
  const original = window.HTMLCanvasElement.prototype.getContext
  window.HTMLCanvasElement.prototype.getContext = () => ({
    set font(_v) {
      /* the real canvas reads this on every draw; the fake has nothing to key off */
    },
    measureText: (text) => ({ width: text.length * WIDTH_PER_CHAR }),
  })
  return () => {
    window.HTMLCanvasElement.prototype.getContext = original
  }
}

// A minimal stand-in for the switcher's trigger + name cell — the exact structure
// PRESET_NAME_CELL_SELECTOR (`[data-select-trigger] [data-preset-name-cell]`) is written to match,
// built by hand rather than mounting the real PresetSwitcher: this file is about the DOM QUERY and
// the MEASUREMENT, not about CustomSelect's own rendering, and jsdom cannot give either element a
// real width regardless of which one produced the markup — only a mocked rect can.
const mountFakeSwitcherCell = (widthPx) => {
  const trigger = document.createElement('button')
  trigger.setAttribute('data-select-trigger', '')
  const cell = document.createElement('span')
  cell.setAttribute('data-preset-name-cell', 'true')
  cell.getBoundingClientRect = () => ({
    width: widthPx,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {},
  })
  trigger.appendChild(cell)
  document.body.appendChild(trigger)
  return () => trigger.remove()
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('what jsdom actually does — the two facts the rest of this file relies on', () => {
  it('getBoundingClientRect reports a zero-width rect for any UNMOCKED element', () => {
    const plain = document.createElement('div')
    document.body.appendChild(plain)
    expect(plain.getBoundingClientRect().width).toBe(0)
  })

  it('HTMLCanvasElement.getContext("2d") returns null rather than throwing', () => {
    const canvas = document.createElement('canvas')
    expect(() => canvas.getContext('2d')).not.toThrow()
    expect(canvas.getContext('2d')).toBeNull()
  })

  it('PRESET_NAME_CELL_SELECTOR is scoped to the trigger, never the dropdown', () => {
    // Pinned here rather than only exercised indirectly through readSwitcherBudget below: this
    // exact string is the one piece of the cross-component contract components/PresetSwitcher and
    // this file have to agree on independently of any DOM behaviour.
    expect(PRESET_NAME_CELL_SELECTOR).toBe('[data-select-trigger] [data-preset-name-cell]')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('readSwitcherBudget — the cross-component DOM read', () => {
  it('finds the switcher cell and reports its live width when the rect is real', () => {
    const unmount = mountFakeSwitcherCell(142.5)
    const budget = readSwitcherBudget()
    expect(budget).not.toBeNull()
    expect(budget.widthPx).toBe(142.5)
    expect(typeof budget.font).toBe('string')
    unmount()
  })

  it('returns null when no element matches the selector at all (the "impossible in practice" case)', () => {
    // Nothing mounted — the documented fallback path components/PresetManager's caller uses.
    expect(readSwitcherBudget()).toBeNull()
  })

  it('returns null for a matched element reporting a non-positive width (plain unmocked jsdom)', () => {
    // A real switcher cell, but with jsdom's own always-zero rect (no mock) — the case this suite
    // hits by default whenever the real PresetSwitcher is mounted alongside PresetManager, and
    // exactly why the fallback exists rather than only covering "cannot find the element at all".
    const trigger = document.createElement('button')
    trigger.setAttribute('data-select-trigger', '')
    const cell = document.createElement('span')
    cell.setAttribute('data-preset-name-cell', 'true')
    trigger.appendChild(cell)
    document.body.appendChild(trigger)
    expect(readSwitcherBudget()).toBeNull()
  })

  it('never matches a data-preset-name-cell that is NOT inside a [data-select-trigger] (the dropdown case)', () => {
    // The dropdown's rows carry the same data-preset-name-cell but sit under data-select-group,
    // never data-select-trigger — see components/PresetSwitcher's PRESET_NAME_CELL_SELECTOR export
    // for why that is exactly the scoping that keeps this read off the (differently-sized) menu.
    const panel = document.createElement('div')
    panel.setAttribute('data-select-group', '')
    const cell = document.createElement('span')
    cell.setAttribute('data-preset-name-cell', 'true')
    cell.getBoundingClientRect = () => ({
      width: 999,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON() {},
    })
    panel.appendChild(cell)
    document.body.appendChild(panel)
    expect(readSwitcherBudget()).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('measureTextWidthPx — degrades to 0 without a real canvas, measures for real with one', () => {
  it('is 0 under plain jsdom (no fake canvas installed)', () => {
    expect(measureTextWidthPx('Weekend', '13px sans-serif')).toBe(0)
  })

  it("reports the fake canvas's own width once one is installed", () => {
    const restore = installFakeCanvas()
    expect(measureTextWidthPx('Weekend', '13px sans-serif')).toBe('Weekend'.length * WIDTH_PER_CHAR)
    expect(measureTextWidthPx('', '13px sans-serif')).toBe(0)
    restore()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('fitTextToWidth — the maxLength-shaped truncation for a paste-sized change', () => {
  it('returns the candidate UNCHANGED when it already fits', () => {
    const restore = installFakeCanvas()
    expect(fitTextToWidth('Hi', '13px sans-serif', 1000)).toBe('Hi')
    restore()
  })

  it('trims to the longest prefix that fits, character by character', () => {
    const restore = installFakeCanvas()
    // Budget for exactly 5 characters at WIDTH_PER_CHAR=5 is 25px.
    expect(fitTextToWidth('Weekend Mornings', '13px sans-serif', 25)).toBe('Weeke')
    restore()
  })

  it('trims all the way to empty when even one character does not fit', () => {
    const restore = installFakeCanvas()
    expect(fitTextToWidth('W', '13px sans-serif', 1)).toBe('')
    restore()
  })

  it('without a real canvas (0-width measurement), nothing is ever trimmed', () => {
    // The documented degradation: a 0-width measurement always "fits" (fitsWithinWidth's own
    // inclusive-boundary case), so fitTextToWidth never has a reason to cut anything under plain
    // jsdom — consistent with capCandidateToSwitcherWidth never reporting `capped` there either.
    expect(fitTextToWidth('Weekend Mornings', '13px sans-serif', 1)).toBe('Weekend Mornings')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('capCandidateToSwitcherWidth — the one call components/PresetManager makes', () => {
  it('accepts a candidate that fits the LIVE switcher budget, unchanged', () => {
    const restore = installFakeCanvas()
    const unmount = mountFakeSwitcherCell(50) // 10 characters at WIDTH_PER_CHAR=5
    const result = capCandidateToSwitcherWidth('Weekend')
    expect(result).toEqual({ text: 'Weekend', capped: false })
    unmount()
    restore()
  })

  it('trims to fit the LIVE switcher budget, and reports capped:true', () => {
    const restore = installFakeCanvas()
    const unmount = mountFakeSwitcherCell(25) // 5 characters
    const result = capCandidateToSwitcherWidth('Weekend Mornings')
    expect(result).toEqual({ text: 'Weeke', capped: true })
    unmount()
    restore()
  })

  it('un-refuses on a backspace: a shorter candidate that now fits comes back capped:false', () => {
    const restore = installFakeCanvas()
    const unmount = mountFakeSwitcherCell(25)
    expect(capCandidateToSwitcherWidth('Weekend Mornings').capped).toBe(true)
    expect(capCandidateToSwitcherWidth('Week')).toEqual({ text: 'Week', capped: false })
    unmount()
    restore()
  })

  it('falls back to the safe minimum budget when the switcher cell cannot be read at all', () => {
    // Nothing mounted, matching PresetManager standalone in a test with no top bar — the fallback
    // path components/PresetSwitcher documents as "impossible in practice" but this suite still
    // exercises, per the brief: prove it is real, not dead code.
    const restore = installFakeCanvas()
    // A name comfortably under the fallback budget (≈82px ÷ 5px/char ≈ 16 characters) is accepted.
    expect(capCandidateToSwitcherWidth('Weekend').capped).toBe(false)
    // A name well past it is trimmed, proving the fallback budget is finite and actually applied.
    const long = capCandidateToSwitcherWidth('W'.repeat(40))
    expect(long.capped).toBe(true)
    expect(long.text.length).toBeLessThan(40)
    expect(long.text.length).toBeGreaterThan(0)
    restore()
  })

  it('never trims anything without a real canvas — the whole mechanism degrades to a no-op', () => {
    const unmount = mountFakeSwitcherCell(10) // a tiny live budget…
    // …and yet, with no fake canvas installed, every measurement is 0 and therefore "fits".
    const result = capCandidateToSwitcherWidth('Weekend Mornings')
    expect(result).toEqual({ text: 'Weekend Mornings', capped: false })
    unmount()
  })
})
