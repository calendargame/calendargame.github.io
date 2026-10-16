// @vitest-environment jsdom
//
// presetNameWidth.dom — the DOM/canvas-touching half of lib/presetNameWidth: reading the live room
// in every place a preset name is drawn (readNameRooms), measuring text against a canvas
// (measureTextWidthPx), the decision the rename field's note is drawn from (isCutSomewhere), and
// how the rooms are kept current (watchNameCell, useNameRooms). tests/presetNameWidth.test.js owns
// the PURE comparison (fitsWithinWidth) with fabricated numbers and no jsdom at all.
//
// ⚠⚠ jsdom HAS NO LAYOUT ENGINE AND NO CANVAS. Neither fact is assumed here — both are PROVED, in
// the first two cases below, because the rest of this file's coverage depends on knowing exactly
// how each degrades: getBoundingClientRect always reports 0 (so readNameRooms must find nothing
// on a real cell the same as on a missing one, unless a test fakes the rect), and
// HTMLCanvasElement.getContext('2d') returns null rather than throwing (tests/setup/dom.js
// silences the "not implemented" warning that call would otherwise log).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, act } from '@testing-library/react'

// The module makes its one ResizeObserver as it loads, and the harness's does nothing — so before
// anything is imported, this file swaps in one that remembers what it was handed and can be made to
// report by hand (the last case in the file).
const resizeObservers = vi.hoisted(() => {
  const made = []
  window.ResizeObserver = class {
    constructor(report) {
      this.report = report
      this.observed = new Set()
      made.push(this)
    }
    observe(el) {
      this.observed.add(el)
    }
    unobserve(el) {
      this.observed.delete(el)
    }
    disconnect() {
      this.observed.clear()
    }
  }
  return made
})

import {
  PRESET_NAME_CELL_SELECTOR,
  readNameRooms,
  measureTextWidthPx,
  isCutSomewhere,
  stockNameForm,
  refreshNameRooms,
  watchNameCell,
  useNameRooms,
} from '../src/lib/presetNameWidth.js'
import { NAME_DRAWN_UNITS } from '../src/lib/presetNameText.js'

// A fake 2D context whose measureText is a simple, controllable function of the text AND THE FONT
// — a third of the font's pixel size per character, so 15px text is 5px a character and 12px text
// is 4px — rather than jsdom's real (nonexistent) glyph metrics. The font has to count: the places
// a name is drawn do not share one (a list row's text is larger than the button's), and "which
// place is narrowest" is a question about a width in a font, never about a width alone.
const perChar = (font) => parseFloat(font) / 3
// How wide each character is, in units of the font's ordinary one. Every character is 1 unless a
// test says otherwise — the cases about letters of DIFFERENT widths (a wide "M", a narrow "i") pass
// their own.
const EVERY_LETTER_THE_SAME = () => 1
const installFakeCanvas = (unitsOf = EVERY_LETTER_THE_SAME) => {
  const original = window.HTMLCanvasElement.prototype.getContext
  window.HTMLCanvasElement.prototype.getContext = () => {
    let font = ''
    return {
      set font(value) {
        font = value
      },
      measureText: (text) => ({
        width: [...text].reduce((sum, ch) => sum + unitsOf(ch), 0) * perChar(font),
      }),
    }
  }
  return () => {
    window.HTMLCanvasElement.prototype.getContext = original
  }
}

// The two fonts the cases below set names in: the top-bar button's smaller tier and a list row's
// larger one. Only their SIZES matter to the fake canvas.
const BUTTON_FONT = '12px sans-serif' // 4px a character
const ROW_FONT = '15px sans-serif' // 5px a character

// A minimal stand-in for ONE place a preset name is drawn — an element wearing the hook
// PRESET_NAME_CELL_SELECTOR names, with a faked width and a font — built by hand rather than
// mounting the real controls: this file is about the DOM QUERY and the MEASUREMENT, and jsdom can
// give no element a real width or a computed font whichever component produced the markup.
// (tests/topBar.dom proves the real app's four places all wear the hook.)
const mountNameCell = (widthPx, font = ROW_FONT) => {
  const cell = document.createElement('span')
  cell.setAttribute('data-preset-name-cell', 'true')
  cell.dataset.font = font
  cell.getClientRects = () => [{ width: widthPx }] // it is laid out: it has a box
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
  document.body.appendChild(cell)
  return cell
}
// The computed font, which jsdom does not resolve: each stand-in cell says its own.
const fontSpy = vi
  .spyOn(globalThis, 'getComputedStyle')
  .mockImplementation((el) => ({ font: el.dataset.font ?? '' }))

afterEach(() => {
  document.body.innerHTML = ''
  fontSpy.mockClear()
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

  it('PRESET_NAME_CELL_SELECTOR is the ONE hook, scoped to nothing', () => {
    // Pinned here rather than only exercised indirectly through readNameRooms below: this exact
    // string is the whole cross-component contract. It names the cell and no ancestor, so every
    // place that draws a preset name is measured — the button, a list row, "Open in" — and none can
    // be left out by where it is mounted. (It was scoped to the top-bar button once, which is how a
    // name that fit the button came to be cut short in the list.)
    expect(PRESET_NAME_CELL_SELECTOR).toBe('[data-preset-name-cell]')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('readNameRooms — the cross-component DOM read', () => {
  it('finds a name cell and reports its live width and font when the rect is real', () => {
    mountNameCell(142.5, ROW_FONT)
    expect(readNameRooms()).toEqual([{ widthPx: 142.5, font: ROW_FONT }])
  })

  it('is empty when no element matches the selector at all', () => {
    // Nothing mounted: there is no place to be cut in.
    expect(readNameRooms()).toEqual([])
  })

  it('skips a cell that is not laid out at all (plain unmocked jsdom)', () => {
    // A real cell with no box — the case this suite hits by default whenever the real controls
    // are mounted, and a hidden subtree in a browser: there is no place there to be cut in.
    const cell = document.createElement('span')
    cell.setAttribute('data-preset-name-cell', 'true')
    document.body.appendChild(cell)
    expect(cell.getClientRects()).toHaveLength(0)
    expect(readNameRooms()).toEqual([])
  })

  it('a cell that IS laid out and has no width is a room of nothing — not an unmeasurable one', () => {
    // The narrowest screens: the bar leaves the preset control so little that a row of its list
    // has no room for a name at all. That is the place a name is cut HARDEST. It used to be
    // skipped ("cannot measure"), which turned the verdict to "fits" exactly there.
    mountNameCell(0, ROW_FONT)
    mountNameCell(70, BUTTON_FONT)
    expect(readNameRooms()).toEqual([
      { widthPx: 0, font: ROW_FONT },
      { widthPx: 70, font: BUTTON_FONT },
    ])
    const restore = installFakeCanvas()
    try {
      const rooms = readNameRooms()
      expect(isCutSomewhere('P1', rooms)).toBe(true)
      expect(isCutSomewhere('Preset 1', rooms)).toBe(true) // not even its bare number fits
      expect(stockNameForm([{ name: 'Preset 1' }], rooms)).toBe('number')
    } finally {
      restore()
    }
  })

  it('counts a cell wherever it is mounted — a list row is a place a name is drawn', () => {
    // The read used to be scoped to the top-bar button (`[data-select-trigger] …`) and could not
    // see a row of the list, the one place a name has the least room.
    const row = document.createElement('div')
    row.setAttribute('data-select-row-gauge', '')
    document.body.appendChild(row)
    row.appendChild(mountNameCell(68, ROW_FONT))
    expect(readNameRooms()).toEqual([{ widthPx: 68, font: ROW_FONT }])
  })

  it('keeps ONE room per font — the narrowest cell set in it', () => {
    // Every preset has a cell in each place, all the same width there; and two places can share a
    // font at different widths (the top bar's list and "Open in"'s). The narrowest is the only one
    // that can cut a name the others would show whole.
    mountNameCell(200, ROW_FONT)
    mountNameCell(68, ROW_FONT)
    mountNameCell(120, ROW_FONT)
    expect(readNameRooms()).toEqual([{ widthPx: 68, font: ROW_FONT }])
  })

  it('keeps a room for EACH font, because a width means nothing without one', () => {
    mountNameCell(70, BUTTON_FONT)
    mountNameCell(70, ROW_FONT)
    expect(readNameRooms()).toEqual([
      { widthPx: 70, font: BUTTON_FONT },
      { widthPx: 70, font: ROW_FONT },
    ])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('measureTextWidthPx — degrades to 0 without a real canvas, measures for real with one', () => {
  it('is 0 under plain jsdom (no fake canvas installed)', () => {
    expect(measureTextWidthPx('Weekend', ROW_FONT)).toBe(0)
  })

  it("reports the fake canvas's own width, in the font it is handed, once one is installed", () => {
    const restore = installFakeCanvas()
    expect(measureTextWidthPx('Weekend', ROW_FONT)).toBe('Weekend'.length * 5)
    expect(measureTextWidthPx('Weekend', BUTTON_FONT)).toBe('Weekend'.length * 4)
    expect(measureTextWidthPx('', ROW_FONT)).toBe(0)
    restore()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('isCutSomewhere — is this name shown cut short in at least one place', () => {
  let restoreCanvas = () => {}
  afterEach(() => restoreCanvas())
  const withCanvas = (unitsOf) => {
    restoreCanvas = installFakeCanvas(unitsOf)
  }

  it('nothing is cut where no place can be measured — there is nowhere it is being cut', () => {
    withCanvas()
    expect(isCutSomewhere('A name of any ordinary length at all', [])).toBe(false)
  })

  it('turns at the EXACT character that stops fitting, and back at the one that fits again', () => {
    withCanvas()
    mountNameCell(50) // 10 characters at 5px
    const rooms = readNameRooms()
    expect(isCutSomewhere('Weekend Mo', rooms)).toBe(false) // 10: exactly the room
    expect(isCutSomewhere('Weekend Mor', rooms)).toBe(true) // 11
    expect(isCutSomewhere('Weekend Mo', rooms)).toBe(false) // …and one taken away again
  })

  it('the NARROWEST place governs — a name that fits the button but not a row of its list is cut', () => {
    withCanvas()
    mountNameCell(48, BUTTON_FONT) // 12 characters at 4px
    mountNameCell(50, ROW_FONT) // 10 characters at 5px
    const rooms = readNameRooms()
    expect(isCutSomewhere('Weekend Mo', rooms)).toBe(false)
    expect(isCutSomewhere('Weekend Mor', rooms)).toBe(true) // fits the button, not the row
  })

  it('…and the button governs when it is the tighter place — neither is assumed to be', () => {
    withCanvas()
    mountNameCell(32, BUTTON_FONT) // 8 characters at 4px
    mountNameCell(60, ROW_FONT) // 12 characters at 5px
    const rooms = readNameRooms()
    expect(isCutSomewhere('Weekends', rooms)).toBe(false)
    expect(isCutSomewhere('Weekends!', rooms)).toBe(true)
  })

  it('is a function of the text alone: a narrower letter after a wide one that did not fit, fits', () => {
    // The refusal this replaced had to remember that a letter had been turned away. A note has
    // nothing to remember: each text is judged as it stands.
    withCanvas((ch) => (ch === 'M' ? 2 : ch === 'i' ? 0.5 : 1))
    mountNameCell(45) // 9 ordinary letters
    const rooms = readNameRooms()
    expect(isCutSomewhere('Weekend ', rooms)).toBe(false) // 8
    expect(isCutSomewhere('Weekend M', rooms)).toBe(true) // 8 + 2
    expect(isCutSomewhere('Weekend i', rooms)).toBe(false) // 8 + 0.5
  })

  it('measures the name as a slot lays it out: a run of spaces is drawn as one', () => {
    // A canvas gives every space its width; the screen folds a run of them (and tabs, and line
    // breaks) into a single space. Measured raw, this name would be 13 wide and "cut".
    withCanvas()
    mountNameCell(50) // 10 characters
    const rooms = readNameRooms()
    expect(isCutSomewhere('Week    end', rooms)).toBe(false) // drawn as "Week end": 8
    expect(isCutSomewhere('Week\t\n end', rooms)).toBe(false)
    expect(isCutSomewhere('Week ends on', rooms)).toBe(true) // 12 real characters
    // A no-break space is not folded: it is there to be drawn.
    expect(isCutSomewhere('Week\u00a0\u00a0\u00a0\u00a0end', rooms)).toBe(true)
  })

  it('without a canvas nothing can be measured, so nothing is called cut', () => {
    mountNameCell(10)
    expect(isCutSomewhere('A name far wider than ten pixels', readNameRooms())).toBe(false)
  })

  describe('a name too long to be drawn whole is cut, and is not measured to find that out', () => {
    it('one unit past what a name slot draws: cut, whatever it would have measured', () => {
      const measured = []
      withCanvas((ch) => (measured.push(ch), 0)) // every character is zero wide: it would all "fit"
      mountNameCell(50)
      const rooms = readNameRooms()
      expect(isCutSomewhere('​'.repeat(NAME_DRAWN_UNITS), rooms)).toBe(false)
      expect(measured).toHaveLength(NAME_DRAWN_UNITS)
      measured.length = 0
      expect(isCutSomewhere('​'.repeat(NAME_DRAWN_UNITS + 1), rooms)).toBe(true)
      expect(measured).toHaveLength(0)
    })

    it('a pasted book costs the same as a long name: not one character of it is measured', () => {
      const measured = []
      withCanvas((ch) => (measured.push(ch), 1))
      mountNameCell(50)
      expect(isCutSomewhere('x'.repeat(1_000_000), readNameRooms())).toBe(true)
      expect(measured).toHaveLength(0)
    })

    it('…even where no place can be measured: the slots still draw only its start', () => {
      expect(isCutSomewhere('x'.repeat(NAME_DRAWN_UNITS + 1), [])).toBe(true)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('stock names — "Preset 3" that would be cut is drawn "P3", and "3" where that would be', () => {
  let restoreCanvas = () => {}
  afterEach(() => restoreCanvas())
  const named = (...names) => names.map((name) => ({ name }))

  it('isCutSomewhere judges a stock name by its shortest form, the bare number', () => {
    restoreCanvas = installFakeCanvas()
    mountNameCell(35) // 7 characters
    let rooms = readNameRooms()
    expect(isCutSomewhere('Preset 1', rooms)).toBe(false) // 8, but drawn "P1" or "1"
    expect(isCutSomewhere('Preset 1234567', rooms)).toBe(false) // "1234567": 7
    expect(isCutSomewhere('Preset 12345678', rooms)).toBe(true) // "12345678": 8
    expect(isCutSomewhere('Preset 1!', rooms)).toBe(true) // not a stock name: 9
    document.body.innerHTML = ''
    mountNameCell(5) // one character: not "P1", but "1"
    rooms = readNameRooms()
    expect(isCutSomewhere('Preset 1', rooms)).toBe(false)
    expect(isCutSomewhere('Preset 12', rooms)).toBe(true)
    document.body.innerHTML = ''
    mountNameCell(4) // not even one character
    expect(isCutSomewhere('Preset 1', readNameRooms())).toBe(true)
  })

  it('stockNameForm: full while every stock name fits written in full, short while every "P" form does, the bare number otherwise', () => {
    restoreCanvas = installFakeCanvas()
    mountNameCell(48, BUTTON_FONT) // 12 characters at 4px
    mountNameCell(40, ROW_FONT) // 8 characters at 5px
    let rooms = readNameRooms()
    expect(stockNameForm(named('Preset 1', 'Preset 2'), rooms)).toBe('full')
    expect(stockNameForm(named('Preset 1', 'Preset 10'), rooms)).toBe('short') // 9 in the row
    // A name that is not a stock name is not this rule's business, however long it is.
    expect(stockNameForm(named('Preset 1', 'Weekend Mornings'), rooms)).toBe('full')
    expect(stockNameForm(named('Weekend Mornings'), rooms)).toBe('full')
    // ALL the "P" forms are asked about, and all step down together: "P1234567" is 8, "P12345678"
    // 9 — so one long number takes every stock name to its number, the short ones included.
    expect(stockNameForm(named('Preset 1', 'Preset 1234567'), rooms)).toBe('short')
    expect(stockNameForm(named('Preset 1', 'Preset 12345678'), rooms)).toBe('number')
    // The narrowest screens: the room in a row is two characters, so "P10" is cut and "10" is not.
    document.body.innerHTML = ''
    mountNameCell(10)
    rooms = readNameRooms()
    expect(stockNameForm(named('Preset 1', 'Preset 2'), rooms)).toBe('short')
    expect(stockNameForm(named('Preset 1', 'Preset 10'), rooms)).toBe('number')
    // Where even a number is cut, it is still the number that is drawn (and cut, with an "…"):
    // there is no fourth form.
    document.body.innerHTML = ''
    mountNameCell(1)
    expect(stockNameForm(named('Preset 1'), readNameRooms())).toBe('number')
    // No rooms, no verdict.
    expect(stockNameForm(named('Preset 10'), [])).toBe('full')
  })

  it('answers the same question once: every cell on the page asks it in the same render', () => {
    const measured = []
    restoreCanvas = installFakeCanvas((ch) => (measured.push(ch), 1))
    mountNameCell(40)
    const rooms = readNameRooms()
    const presets = named('Preset 1', 'Preset 2', 'Preset 3')
    expect(stockNameForm(presets, rooms)).toBe('full')
    const once = measured.length
    expect(once).toBeGreaterThan(0)
    for (let cell = 0; cell < 50; cell++) expect(stockNameForm(presets, rooms)).toBe('full')
    expect(measured.length).toBe(once)
    // A new list of presets, or new rooms, is a new question.
    expect(stockNameForm(named('Preset 1', 'Preset 10'), rooms)).toBe('short')
    document.body.innerHTML = ''
    mountNameCell(45)
    expect(stockNameForm(named('Preset 1', 'Preset 10'), readNameRooms())).toBe('full')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the rooms are kept current, and whatever is drawn from them follows', () => {
  // A stand-in for anything that draws from the rooms: it shows how many it was last handed and
  // counts how often it was drawn.
  let draws = 0
  function Reader() {
    const rooms = useNameRooms()
    draws++
    return createElement('output', null, rooms.map((r) => r.widthPx).join(','))
  }
  const shown = () => document.querySelector('output').textContent
  // A real cell, mounted by React with the ref the app's cells use, and given a width.
  const widths = new Map()
  function Cell({ id }) {
    return createElement('span', {
      'data-preset-name-cell': 'true',
      'data-font': ROW_FONT,
      'data-cell': id,
      ref: watchNameCell,
    })
  }
  const original = window.Element.prototype.getBoundingClientRect
  const originalRects = window.Element.prototype.getClientRects
  beforeEach(() => {
    draws = 0
    widths.clear()
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: widths.get(this.dataset?.cell) ?? 0 }
    }
    window.Element.prototype.getClientRects = function () {
      return widths.has(this.dataset?.cell) ? [this.getBoundingClientRect()] : []
    }
  })
  afterEach(() => {
    cleanup()
    window.Element.prototype.getBoundingClientRect = original
    window.Element.prototype.getClientRects = originalRects
    act(() => refreshNameRooms())
  })
  // Everything queued behind a render (the read a mounting cell asks for) has run.
  const settled = () => act(() => Promise.resolve())

  it('a cell that mounts is read without anyone asking, and one that leaves is read out again', async () => {
    widths.set('a', 80)
    const view = render(createElement(Reader))
    expect(shown()).toBe('')
    view.rerender(
      createElement('div', null, createElement(Reader), createElement(Cell, { id: 'a' })),
    )
    await settled()
    expect(shown()).toBe('80')
    view.rerender(createElement('div', null, createElement(Reader)))
    await settled()
    expect(shown()).toBe('')
  })

  it('a window resize reads the rooms again', async () => {
    widths.set('a', 80)
    render(createElement('div', null, createElement(Reader), createElement(Cell, { id: 'a' })))
    await settled()
    expect(shown()).toBe('80')
    widths.set('a', 42) // a rotation: the same cell, narrower
    act(() => void window.dispatchEvent(new Event('resize')))
    expect(shown()).toBe('42')
  })

  it('a reading that matches the last one draws nothing again', async () => {
    widths.set('a', 80)
    render(createElement('div', null, createElement(Reader), createElement(Cell, { id: 'a' })))
    await settled()
    const before = draws
    act(() => void window.dispatchEvent(new Event('resize')))
    act(() => refreshNameRooms())
    expect(draws).toBe(before)
  })

  it('a font that has finished loading draws again even though no room changed', async () => {
    // jsdom has no document.fonts. The same text is a different width in a font that has only just
    // arrived, so this one event must reach the readers whatever the rooms say.
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    try {
      widths.set('a', 80)
      render(createElement('div', null, createElement(Reader), createElement(Cell, { id: 'a' })))
      await settled()
      const before = draws
      act(() => void fonts.dispatchEvent(new Event('loadingdone')))
      expect(draws).toBe(before + 1)
    } finally {
      cleanup() // the last reader lets go of document.fonts before it is taken away
      delete document.fonts
    }
  })

  it('a cell changing size is heard through ONE ResizeObserver that every cell is handed to', async () => {
    widths.set('a', 80)
    widths.set('b', 90)
    render(
      createElement(
        'div',
        null,
        createElement(Reader),
        createElement(Cell, { id: 'a' }),
        createElement(Cell, { id: 'b' }),
      ),
    )
    await settled()
    expect(shown()).toBe('80')
    const watching = resizeObservers.filter((observer) => observer.observed.size > 0)
    expect(watching).toHaveLength(1)
    expect(watching[0].observed.size).toBe(2)
    widths.set('a', 61) // one cell is narrower now, and only the browser's observer knows
    act(() => watching[0].report())
    expect(shown()).toBe('61')
    cleanup()
    expect(watching[0].observed.size).toBe(0) // a cell that is gone is no longer watched
  })
})
