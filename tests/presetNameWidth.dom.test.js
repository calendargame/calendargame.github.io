// @vitest-environment jsdom
//
// presetNameWidth.dom — the DOM/canvas-touching half of lib/presetNameWidth's live typing cap
// (round 20): reading the live room in every place a preset name is drawn (readNameRooms),
// measuring text against a canvas (measureTextWidthPx), and the one function
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
describe('capCandidateToNameRoom — the one call components/PresetManager makes', () => {
  // What the cap answers for the TEXT, which is what most cases here are about: the text to show
  // and whether anything was refused. Where it puts the cursor, and what it does with the selection
  // the field hands it, have their own cases at the foot of this block.
  const judge = (candidate, previous, full, replaced = null) => {
    const { text, capped } = capCandidateToNameRoom(candidate, previous, full, replaced)
    return { text, capped }
  }

  it('accepts a candidate that fits the LIVE room, unchanged', () => {
    const restore = installFakeCanvas()
    mountNameCell(50) // 10 characters at 5px
    expect(judge('Weekend', '', false)).toEqual({ text: 'Weekend', capped: false })
    restore()
  })

  it('trims to fit the LIVE room, and reports capped:true', () => {
    const restore = installFakeCanvas()
    mountNameCell(25) // 5 characters
    expect(judge('Weekend Mornings', '', false)).toEqual({
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
    expect(judge('Weekend Mornings', '', false)).toEqual({
      text: 'Weekend Morni',
      capped: true,
    })
    expect(judge('Weekend Morni', '', false)).toEqual({
      text: 'Weekend Morni',
      capped: false,
    })
    restore()
  })

  it('…and the button governs when it is the tighter place — neither is assumed to be', () => {
    const restore = installFakeCanvas()
    mountNameCell(40, BUTTON_FONT) // 10 characters
    mountNameCell(200, ROW_FONT) // 40
    expect(judge('Weekend Mornings', '', false).text).toBe('Weekend Mo')
    restore()
  })

  it('un-refuses on a backspace: a shorter candidate that now fits comes back capped:false', () => {
    const restore = installFakeCanvas()
    mountNameCell(25)
    expect(judge('Weekend Mornings', 'Weeke', false).capped).toBe(true)
    expect(judge('Week', 'Weeke', false)).toEqual({ text: 'Week', capped: false })
    restore()
  })

  it('refuses everything when not even one character fits', () => {
    const restore = installFakeCanvas()
    mountNameCell(1)
    expect(judge('W', '', false)).toEqual({ text: '', capped: true })
    expect(judge('Weekend', '', false)).toEqual({ text: '', capped: true })
    restore()
  })

  it('falls back to the safe minimum budget when no cell can be read at all', () => {
    // Nothing mounted, matching PresetManager standalone in a test with no top bar — the fallback
    // path is real, not dead code.
    const restore = installFakeCanvas()
    // A name comfortably under the fallback budget (≈61px, at ≈4.5px a character) is accepted.
    expect(judge('Weekend', '', false).capped).toBe(false)
    // A name well past it is trimmed, proving the fallback budget is finite and actually applied.
    const long = judge('W'.repeat(40), '', false)
    expect(long.capped).toBe(true)
    expect(long.text.length).toBeLessThan(40)
    expect(long.text.length).toBeGreaterThan(0)
    restore()
  })

  it('never trims anything without a real canvas — the whole mechanism degrades to a no-op', () => {
    mountNameCell(10) // a tiny live room…
    // …and yet, with no fake canvas installed, every measurement is 0 and therefore "fits".
    expect(judge('Weekend Mornings', '', false)).toEqual({
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
        const { text: next, capped } = judge(candidate, state.text, state.full)
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
      expect(judge('Weekend i', 'Weekend ', true)).toEqual({
        text: 'Weekend ',
        capped: true,
      })
      expect(judge('iWeekend ', 'Weekend ', true).text).toBe('Weekend ')
      expect(judge('Weeikend ', 'Weekend ', true).text).toBe('Weekend ')
      // …which is the whole of what `full` changes: the same edit, not full, is taken.
      expect(judge('Weekend i', 'Weekend ', false)).toEqual({
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
      expect(judge('A', 'Weekend ', true)).toEqual({ text: 'A', capped: false })
      // Select "end ", type "ly": shorter, fits, no longer full.
      expect(judge('Weekly', 'Weekend ', true)).toEqual({
        text: 'Weekly',
        capped: false,
      })
      // Select all, paste something too long: cut to what fits, and full.
      expect(judge('Saturday Night', 'Weekend ', true)).toEqual({
        text: 'Saturday ',
        capped: true,
      })
      restore()
    })

    it('remembers nothing itself — `full` is only ever what the caller hands it', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      expect(judge('Weekend M', 'Weekend ', false).capped).toBe(true)
      // A different field, a fresh edit: the refusal above is not carried into it.
      expect(judge('Wi', 'W', false)).toEqual({ text: 'Wi', capped: false })
      restore()
    })
  })

  // ── AN INSERTION THAT DOES NOT FIT LOSES ITS OWN END, NEVER THE NAME'S ───────────────────
  describe('what does not fit is taken off the insertion, not off the end of the name', () => {
    it('a letter typed into the MIDDLE of a name that has no room is refused, the name untouched', () => {
      const restore = installFakeCanvas()
      mountNameCell(50) // 10 characters
      expect(judge('WeekXend Mo', 'Weekend Mo', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      restore()
    })

    it('a paste keeps as much of its start as fits, where it was pasted', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      // At the end…
      expect(judge('Weekend Mornings', 'Weekend', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      // …and in the middle, where the text after the cursor is kept whole.
      expect(judge('Week-long end', 'Weekend', false)).toEqual({
        text: 'Week-loend',
        capped: true,
      })
      restore()
    })
  })

  // ── NEVER HALF A CHARACTER ─────────────────────────────────────────────────────────────────
  // What a player calls one character can be several of the units a string is counted in: an emoji
  // is two, a flag is two emoji-sized letters, a family is three people joined by invisible
  // joiners, an accent can ride behind its letter. Trimming by the unit used to keep the front half
  // of one — a lone half of an emoji measures narrow, "fits", and was saved into the registry.
  describe('what is trimmed is whole characters — an emoji, a flag, a family, an accented letter', () => {
    const GRIN = '\u{1F600}'
    const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    const FLAG = '\u{1F1EF}\u{1F1F5}'
    const THUMB_LIGHT = '\u{1F44D}\u{1F3FB}'
    const THUMB_MEDIUM = '\u{1F44D}\u{1F3FD}'
    const E_ACUTE = 'é'
    // As a real font has it, near enough: an emoji is two letters wide, a joiner is nothing, an
    // accent adds a little, and HALF an emoji (which no font has a picture for) is one letter.
    const emojiWidths = (ch) =>
      ch === '‍' ? 0 : ch === '́' ? 0.5 : ch.codePointAt(0) > 0xffff ? 2 : 1
    const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

    it('an emoji that does not fit is refused whole — never its first half', () => {
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30) // 6 letters: "Weeke" and one more, and an emoji is two
      const typed = judge(`Weeke${GRIN}`, 'Weeke', false)
      expect(typed).toEqual({ text: 'Weeke', capped: true })
      expect(typed.text).not.toMatch(LONE_HALF)
      // …pasted three at a time into room for one and a half, one whole emoji is kept.
      expect(judge(`Wee${GRIN}${GRIN}${GRIN}`, 'Wee', false)).toEqual({
        text: `Wee${GRIN}`,
        capped: true,
      })
      // …and in the middle of a name, where the half used to be left in front of the tail.
      expect(judge(`We${GRIN}eke`, 'Weeke', false)).toEqual({
        text: 'Weeke',
        capped: true,
      })
      restore()
    })

    it('a family is all of its people or none of them', () => {
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30) // "We" and four letters: two of the three people would fit
      expect(judge(`We${FAMILY}`, 'We', false)).toEqual({
        text: 'We',
        capped: true,
      })
      restore()
    })

    it('a flag is both of its letters or neither', () => {
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30) // "Week" and two letters: one of the flag's two
      expect(judge(`Week${FLAG}`, 'Week', false)).toEqual({
        text: 'Week',
        capped: true,
      })
      restore()
    })

    it('an accented letter is not kept with its accent taken off', () => {
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30) // "Weeke" and one letter — but not one letter and its accent
      expect(judge(`Weeke${E_ACUTE}`, 'Weeke', false)).toEqual({
        text: 'Weeke',
        capped: true,
      })
      restore()
    })

    it('what was typed is found between whole characters, not between the halves two of them share', () => {
      // The two thumbs differ only in their LAST unit, so comparing unit by unit put the start of
      // the paste inside the first thumb's skin tone.
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30) // one thumb is four letters wide: room for one, not two
      const pasted = judge(`${THUMB_MEDIUM}${THUMB_LIGHT}`, THUMB_LIGHT, false)
      expect(pasted).toEqual({ text: THUMB_LIGHT, capped: true })
      restore()
    })

    it('a stored name that already holds half an emoji is left exactly as it is', () => {
      // An older build could save one. Nothing rewrites stored text: the half is a character of
      // its own here, kept where it is while the edit around it is judged as usual.
      const restore = installFakeCanvas(emojiWidths)
      mountNameCell(30)
      const OLD = 'Weeke\uD83D'
      expect(judge('Weke\uD83D', OLD, false)).toEqual({
        text: 'Weke\uD83D',
        capped: false,
      })
      expect(judge(`W${GRIN}eeke\uD83D`, OLD, false)).toEqual({
        text: OLD,
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
      expect(judge('Weekend Morning', OLD, false)).toEqual({
        text: 'Weekend Morning',
        capped: false,
      })
      restore()
    })

    it('changing a letter in it, at the same width, is accepted', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(judge('Weekend Evenings', OLD, false)).toEqual({
        text: 'Weekend Evenings',
        capped: false,
      })
      restore()
    })

    it('making it WIDER is refused — back to the width it already had, not down to the room', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(judge(`${OLD}!`, OLD, false)).toEqual({ text: OLD, capped: true })
      restore()
    })

    it('once it has been shortened to fit, the ordinary limit is the limit again', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(judge('Weekend Mornings', 'Weekend', false)).toEqual({
        text: 'Weekend Mo',
        capped: true,
      })
      restore()
    })
  })

  // ── THE TEXT OUTSIDE WHAT WAS REPLACED IS NEVER TOUCHED ───────────────────────────────────
  // An edit that typed or pasted OVER something used to be cut to its longest prefix that fit, so
  // a wide letter typed over a narrow one took the LAST letter of the name with it.
  describe('typing or pasting over a selection loses the new text, never the rest of the name', () => {
    const mixedWidths = (ch) => (ch === 'M' ? 1.5 : ch === 'i' ? 0.5 : 1)
    const ROOM = 40 // 8 ordinary letters at 5px: "Weekend " exactly

    it('a wider letter typed over a narrower one is refused — the name keeps its last letter', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      expect(judge('WMekend ', 'Weekend ', false)).toEqual({ text: 'Weekend ', capped: true })
      // …and a narrower one is simply taken, full or not.
      expect(judge('Wiekend ', 'Weekend ', true)).toEqual({ text: 'Wiekend ', capped: false })
      restore()
    })

    it('…in a name already longer than the room, too: it is not cut for the attempt', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      const OLD = 'Weekend Evenings' // twice the room
      expect(judge('WMekend Evenings', OLD, false)).toEqual({ text: OLD, capped: true })
      restore()
    })

    it('a paste over a selection keeps as much of its start as fits, and everything after it', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      // "ee" selected, "XXXX" pasted: two of the four fit where the two letters were.
      expect(judge('WXXXXkend ', 'Weekend ', false)).toEqual({ text: 'WXXkend ', capped: true })
      restore()
    })

    it('taking away is never refused, even from a full name', () => {
      const restore = installFakeCanvas(mixedWidths)
      mountNameCell(ROOM)
      expect(capCandidateToNameRoom('Weeken', 'Weekend ', true, null)).toEqual({
        text: 'Weeken',
        capped: false,
        selection: null,
      })
      restore()
    })
  })

  // ── WHAT WAS SELECTED, FROM THE FIELD ─────────────────────────────────────────────────────
  // "My Weekend " is what "My " typed in front of "Weekend " leaves, and also what selecting all of
  // it and pasting "My Weekend " leaves. Only the field knows which; it says, and the cap checks.
  describe('the selection the field hands over decides what the edit was, when it can be true', () => {
    const ALL = { start: 0, end: 8 } // the whole of "Weekend "

    it('select all, paste something that ENDS with the name: it is a replacement, cut to fit', () => {
      const restore = installFakeCanvas()
      mountNameCell(40) // 8 letters
      expect(judge('My Weekend ', 'Weekend ', false, ALL)).toEqual({
        text: 'My Weeke',
        capped: true,
      })
      // …on a FULL name as well: something was taken away, so it is measured, not turned away.
      expect(judge('My Weekend ', 'Weekend ', true, ALL)).toEqual({
        text: 'My Weeke',
        capped: true,
      })
      // The same text with a bare cursor in front is three letters added to a name with no room.
      expect(judge('My Weekend ', 'Weekend ', false, { start: 0, end: 0 })).toEqual({
        text: 'Weekend ',
        capped: true,
      })
      restore()
    })

    it('select all, paste something that STARTS with the name', () => {
      const restore = installFakeCanvas()
      mountNameCell(40)
      expect(judge('Weekend Two', 'Weekend ', true, ALL)).toEqual({
        text: 'Weekend ',
        capped: true,
      })
      expect(judge('Weekends!', 'Weekend', true, { start: 0, end: 7 })).toEqual({
        text: 'Weekends',
        capped: true,
      })
      // Without the selection it reads as "s!" added to a full name, and all of it is refused.
      expect(judge('Weekends!', 'Weekend', true)).toEqual({ text: 'Weekend', capped: true })
      restore()
    })

    it('a selection the new text contradicts is ignored, and the texts are read instead', () => {
      const restore = installFakeCanvas()
      mountNameCell(40)
      // A backspace with a bare cursor: nothing was selected, and a letter is gone.
      expect(judge('Weeken ', 'Weekend ', true, { start: 6, end: 6 })).toEqual({
        text: 'Weeken ',
        capped: false,
      })
      // "end" is claimed, but the text in front of it changed: read as a letter added in front.
      expect(judge('XWeekend ', 'Weekend ', true, { start: 4, end: 7 })).toEqual({
        text: 'Weekend ',
        capped: true,
      })
      // Nonsense — backwards, out of range, inside a character — is ignored the same way.
      for (const replaced of [
        { start: 5, end: 2 },
        { start: -1, end: 3 },
        { start: 0, end: 99 },
      ]) {
        expect(judge('Weekend i', 'Weekend ', true, replaced)).toEqual({
          text: 'Weekend ',
          capped: true,
        })
      }
      const GRIN = '\u{1F600}'
      expect(judge(`${GRIN}Xab`, `${GRIN}ab`, true, { start: 1, end: 3 })).toEqual({
        text: `${GRIN}ab`,
        capped: true,
      })
      restore()
    })
  })

  // ── WHERE THE CURSOR BELONGS ──────────────────────────────────────────────────────────────
  // The field is written back to whenever the answer is not what was typed, and a box that is
  // written to drops its cursor at the end. The cap says where it should be instead.
  describe('`selection` — where the cursor goes when the answer is not what was typed', () => {
    it('null when the edit was taken as typed: the cursor is already where the edit left it', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom('Weeks', 'Week', false, null).selection).toBeNull()
      restore()
    })

    it('after a refused letter, the cursor stays where it was typed', () => {
      const restore = installFakeCanvas()
      mountNameCell(50) // 10 letters
      expect(capCandidateToNameRoom('WeekXend Mo', 'Weekend Mo', false, null).selection).toEqual({
        start: 4,
        end: 4,
      })
      restore()
    })

    it('after a refused letter typed over a selection, the selection is as it was', () => {
      const restore = installFakeCanvas((ch) => (ch === 'M' ? 1.5 : 1))
      mountNameCell(50)
      expect(
        capCandidateToNameRoom('WMekend Mo', 'Weekend Mo', false, { start: 1, end: 2 }).selection,
      ).toEqual({ start: 1, end: 2 })
      restore()
    })

    it('after a shortened paste, the cursor is just behind what was kept of it', () => {
      const restore = installFakeCanvas()
      mountNameCell(50)
      expect(capCandidateToNameRoom('Week-long end', 'Weekend', false, null)).toEqual({
        text: 'Week-loend',
        capped: true,
        selection: { start: 7, end: 7 },
      })
      restore()
    })

    it('…counted in the units a text box counts in: an emoji kept is two of them', () => {
      const GRIN = '\u{1F600}'
      const restore = installFakeCanvas((ch) => (ch.codePointAt(0) > 0xffff ? 2 : 1))
      mountNameCell(50) // 10 letters: "Week" and three emoji, each two letters wide
      expect(
        capCandidateToNameRoom(`We${GRIN}${GRIN}${GRIN}${GRIN}${GRIN}ek`, 'Week', false, null),
      ).toEqual({
        text: `We${GRIN}${GRIN}${GRIN}ek`,
        capped: true,
        selection: { start: 8, end: 8 },
      })
      restore()
    })
  })
})
