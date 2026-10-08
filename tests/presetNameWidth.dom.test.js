// @vitest-environment jsdom
//
// presetNameWidth.dom — the DOM/canvas-touching half of lib/presetNameWidth's live typing cap
// (round 20): reading the live room in every place a preset name is drawn (readNameRooms),
// measuring text against a canvas (measureTextWidthPx, fitTextToRooms), and the one function
// components/PresetManager actually calls (capCandidateToNameRoom). tests/presetNameWidth.test.js
// owns the PURE decision (fitsWithinWidth) with fabricated numbers and no jsdom at all.
//
// ⚠⚠ jsdom HAS NO LAYOUT ENGINE AND NO CANVAS. Neither fact is assumed here — both are PROVED, in
// the first two cases below, because the rest of this file's coverage depends on knowing exactly
// how each degrades: getBoundingClientRect always reports 0 (so readNameRooms must find nothing
// on a real cell the same as on a missing one, unless a test fakes the rect), and
// HTMLCanvasElement.getContext('2d') returns null rather than throwing (tests/setup/dom.js
// silences the "not implemented" warning that call would otherwise log on every keystroke).
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  readNameRooms,
  measureTextWidthPx,
  fitTextToRooms,
  capCandidateToNameRoom,
} from '../src/lib/presetNameWidth.js'
import { PRESET_NAME_CELL_SELECTOR } from '../src/components/PresetSwitcher.jsx'

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
    // Nothing mounted — the documented fallback path capCandidateToNameRoom takes.
    expect(readNameRooms()).toEqual([])
  })

  it('skips a matched element reporting a non-positive width (plain unmocked jsdom)', () => {
    // A real cell, but with jsdom's own always-zero rect (no mock) — the case this suite hits by
    // default whenever the real controls are mounted alongside PresetManager, and exactly why the
    // fallback exists rather than only covering "cannot find the element at all".
    const cell = document.createElement('span')
    cell.setAttribute('data-preset-name-cell', 'true')
    document.body.appendChild(cell)
    expect(readNameRooms()).toEqual([])
  })

  it('counts a cell wherever it is mounted — a list row is a place a name is drawn', () => {
    // The defect this file's rewrite is for: the read used to be scoped to the top-bar button
    // (`[data-select-trigger] …`) and deliberately could not see a row of the list, the one place a
    // name has the least room.
    const row = document.createElement('div')
    row.setAttribute('data-select-row-gauge', '')
    document.body.appendChild(row)
    row.appendChild(mountNameCell(68, ROW_FONT))
    expect(readNameRooms()).toEqual([{ widthPx: 68, font: ROW_FONT }])
  })

  it('keeps ONE room per font — the narrowest cell set in it', () => {
    // Every preset has a cell in each place, all the same width there; and two places can share a
    // font at different widths (the top bar's list and "Open in"'s). The narrowest is the only one
    // that can refuse a name the others would take.
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
describe('fitTextToRooms — the maxLength-shaped truncation for a paste-sized change', () => {
  it('returns the candidate UNCHANGED when it already fits', () => {
    const restore = installFakeCanvas()
    expect(fitTextToRooms('Hi', [{ font: ROW_FONT, widthPx: 1000 }])).toBe('Hi')
    restore()
  })

  it('trims to the longest prefix that fits, character by character', () => {
    const restore = installFakeCanvas()
    // Room for exactly 5 characters at 5px each is 25px.
    expect(fitTextToRooms('Weekend Mornings', [{ font: ROW_FONT, widthPx: 25 }])).toBe('Weeke')
    restore()
  })

  it('trims to what fits EVERY room — the narrowest governs, each in its own font', () => {
    const restore = installFakeCanvas()
    // The same 40px holds 10 characters of the button's text and only 8 of the row's.
    const rooms = [
      { font: BUTTON_FONT, widthPx: 40 },
      { font: ROW_FONT, widthPx: 40 },
    ]
    expect(fitTextToRooms('Weekend Mornings', rooms)).toBe('Weekend ')
    // …and the order they are listed in decides nothing.
    expect(fitTextToRooms('Weekend Mornings', [...rooms].reverse())).toBe('Weekend ')
    restore()
  })

  it('trims all the way to empty when even one character does not fit', () => {
    const restore = installFakeCanvas()
    expect(fitTextToRooms('W', [{ font: ROW_FONT, widthPx: 1 }])).toBe('')
    restore()
  })

  it('without a real canvas (0-width measurement), nothing is ever trimmed', () => {
    // The documented degradation: a 0-width measurement always "fits" (fitsWithinWidth's own
    // inclusive-boundary case), so fitTextToRooms never has a reason to cut anything under plain
    // jsdom — consistent with capCandidateToNameRoom never reporting `capped` there either.
    expect(fitTextToRooms('Weekend Mornings', [{ font: ROW_FONT, widthPx: 1 }])).toBe(
      'Weekend Mornings',
    )
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('capCandidateToNameRoom — the one call components/PresetManager makes', () => {
  it('accepts a candidate that fits the LIVE room, unchanged', () => {
    const restore = installFakeCanvas()
    mountNameCell(50) // 10 characters at 5px
    expect(capCandidateToNameRoom('Weekend', '', false)).toEqual({ text: 'Weekend', capped: false })
    restore()
  })

  it('trims to fit the LIVE room, and reports capped:true', () => {
    const restore = installFakeCanvas()
    mountNameCell(25) // 5 characters
    expect(capCandidateToNameRoom('Weekend Mornings', '', false)).toEqual({
      text: 'Weeke',
      capped: true,
    })
    restore()
  })

  // ★ THE DEFECT, AS THE OWNER MET IT: a name the top-bar button showed whole was cut short with
  // "…" in the list under it. The limit was the button's room alone; a list row is its own place,
  // with its own room and larger text, and it is the one that governs.
  it('refuses a name that fits the BUTTON but not a row of its LIST', () => {
    const restore = installFakeCanvas()
    // The button: 91px of room at 4px a character — 22 characters. A list row: 68px at 5px — 13.
    const button = document.createElement('button')
    button.setAttribute('data-select-trigger', '')
    document.body.appendChild(button)
    button.appendChild(mountNameCell(91, BUTTON_FONT))
    mountNameCell(68, ROW_FONT)
    expect(capCandidateToNameRoom('Weekend Mornings', '', false)).toEqual({
      text: 'Weekend Morni',
      capped: true,
    })
    expect(capCandidateToNameRoom('Weekend Morni', '', false)).toEqual({
      text: 'Weekend Morni',
      capped: false,
    })
    restore()
  })

  it('…and the button governs when it is the tighter place — neither is assumed to be', () => {
    const restore = installFakeCanvas()
    mountNameCell(40, BUTTON_FONT) // 10 characters
    mountNameCell(200, ROW_FONT) // 40
    expect(capCandidateToNameRoom('Weekend Mornings', '', false).text).toBe('Weekend Mo')
    restore()
  })

  it('un-refuses on a backspace: a shorter candidate that now fits comes back capped:false', () => {
    const restore = installFakeCanvas()
    mountNameCell(25)
    expect(capCandidateToNameRoom('Weekend Mornings', 'Weeke', false).capped).toBe(true)
    expect(capCandidateToNameRoom('Week', 'Weeke', false)).toEqual({ text: 'Week', capped: false })
    restore()
  })

  it('falls back to the safe minimum budget when no cell can be read at all', () => {
    // Nothing mounted, matching PresetManager standalone in a test with no top bar — the fallback
    // path is real, not dead code.
    const restore = installFakeCanvas()
    // A name comfortably under the fallback budget (≈61px, at ≈4.5px a character) is accepted.
    expect(capCandidateToNameRoom('Weekend', '', false).capped).toBe(false)
    // A name well past it is trimmed, proving the fallback budget is finite and actually applied.
    const long = capCandidateToNameRoom('W'.repeat(40), '', false)
    expect(long.capped).toBe(true)
    expect(long.text.length).toBeLessThan(40)
    expect(long.text.length).toBeGreaterThan(0)
    restore()
  })

  it('never trims anything without a real canvas — the whole mechanism degrades to a no-op', () => {
    mountNameCell(10) // a tiny live room…
    // …and yet, with no fake canvas installed, every measurement is 0 and therefore "fits".
    expect(capCandidateToNameRoom('Weekend Mornings', '', false)).toEqual({
      text: 'Weekend Mornings',
      capped: false,
    })
  })

  // ── ONCE A LETTER HAS BEEN REFUSED, THE NAME IS FULL ──────────────────────────────────────
  // Width decides what fits, and letters are not one width — so after a wide letter was refused, a
  // narrower one typed later used to slip in. `full` is the cap's own last `capped`, handed back.
  describe('once an insertion has been refused, every insertion is, until something is taken away', () => {
    // A wide "M", a narrow "i", everything else ordinary: in room for 9 ordinary letters,
    // "Weekend " (8) fits, "Weekend M" (9.5) does not, and "Weekend i" (8.5) would.
    const mixedWidths = (ch) => (ch === 'M' ? 1.5 : ch === 'i' ? 0.5 : 1)
    const ROOM = 45 // 9 ordinary letters at 5px
    // A field, as components/PresetManager drives it: the text and the cap's last answer.
    const field = (text = '') => {
      const state = { text, full: false }
      const edit = (candidate) => {
        const { text: next, capped } = capCandidateToNameRoom(candidate, state.text, state.full)
        state.text = next
        state.full = capped
        return state
      }
      return {
        state,
        edit,
        type: (letters) => [...letters].forEach((ch) => edit(state.text + ch)),
      }
    }

    it('typing "Weekend Mornings" stops at "Weekend " — no later, narrower letter slips in', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      const box = field()
      box.type('Weekend Mornings')
      expect(box.state).toEqual({ text: 'Weekend ', full: true })
      restore()
    })

    it('a full name refuses an insertion that WOULD fit, anywhere in it, typed or pasted', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      expect(capCandidateToNameRoom('Weekend i', 'Weekend ', true)).toEqual({
        text: 'Weekend ',
        capped: true,
      })
      expect(capCandidateToNameRoom('iWeekend ', 'Weekend ', true).text).toBe('Weekend ')
      expect(capCandidateToNameRoom('Weeikend ', 'Weekend ', true).text).toBe('Weekend ')
      // …which is the whole of what `full` changes: the same edit, not full, is taken.
      expect(capCandidateToNameRoom('Weekend i', 'Weekend ', false)).toEqual({
        text: 'Weekend i',
        capped: false,
      })
      restore()
    })

    it('a deletion ends it: the name is no longer full, and the next letter is measured again', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      const box = field()
      box.type('Weekend M')
      expect(box.state).toEqual({ text: 'Weekend ', full: true })
      expect(box.edit('Weekend')).toEqual({ text: 'Weekend', full: false })
      box.type('s')
      expect(box.state).toEqual({ text: 'Weekends', full: false })
      restore()
    })

    it('typing over a selection is not an insertion: what replaces it is measured as usual', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      // Select all, type one letter.
      expect(capCandidateToNameRoom('A', 'Weekend ', true)).toEqual({ text: 'A', capped: false })
      // Select "end ", type "ly": shorter, fits, no longer full.
      expect(capCandidateToNameRoom('Weekly', 'Weekend ', true)).toEqual({
        text: 'Weekly',
        capped: false,
      })
      // Select all, paste something too long: cut to what fits, and full.
      expect(capCandidateToNameRoom('Saturday Night', 'Weekend ', true)).toEqual({
        text: 'Saturday ',
        capped: true,
      })
      restore()
    })

    it('remembers nothing itself — `full` is only ever what the caller hands it', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      expect(capCandidateToNameRoom('Weekend M', 'Weekend ', false).capped).toBe(true)
      // A different field, a fresh edit: the refusal above is not carried into it.
      expect(capCandidateToNameRoom('Wi', 'W', false)).toEqual({ text: 'Wi', capped: false })
      restore()
    })
  })

  // ── AN INSERTION THAT DOES NOT FIT LOSES ITS OWN END, NEVER THE NAME'S ───────────────────
  describe('what does not fit is taken off the insertion, not off the end of the name', () => {
    it('a letter typed into the MIDDLE of a name that has no room is refused, the name untouched', () => {
      const restore = installFakeCanvas()
      mountNameCell(50) // 10 characters
      expect(capCandidateToNameRoom('WeekXend Mo', 'Weekend Mo', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      restore()
    })

    it('a paste keeps as much of its start as fits, where it was pasted', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      // At the end…
      expect(capCandidateToNameRoom('Weekend Mornings', 'Weekend', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      // …and in the middle, where the text after the cursor is kept whole.
      expect(capCandidateToNameRoom('Week-long end', 'Weekend', false)).toEqual({
        text: 'Week-loend',
        capped: true,
      })
      restore()
    })
  })

  // ── A NAME THAT IS ALREADY LONGER THAN THE ROOM ───────────────────────────────────────────
  // It can exist: made on a wider screen, or under an older build's looser limit. It is stored as
  // it is and never cut for being touched — `previous` is what the field held before the edit.
  describe('a name already longer than the room is never cut for being edited', () => {
    const OLD = 'Weekend Mornings' // 16 characters, in room for 10

    it('deleting from it is accepted as typed, not trimmed to what fits', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom('Weekend Morning', OLD, false)).toEqual({
        text: 'Weekend Morning',
        capped: false,
      })
      restore()
    })

    it('changing a letter in it, at the same width, is accepted', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom('Weekend Evenings', OLD, false)).toEqual({
        text: 'Weekend Evenings',
        capped: false,
      })
      restore()
    })

    it('making it WIDER is refused — back to the width it already had, not down to the room', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom(`${OLD}!`, OLD, false)).toEqual({ text: OLD, capped: true })
      restore()
    })

    it('once it has been shortened to fit, the ordinary limit is the limit again', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom('Weekend Mornings', 'Weekend', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      restore()
    })
  })
})
