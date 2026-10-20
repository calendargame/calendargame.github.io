// presetNameText — how much of a preset name the app draws outside the box it is typed in
// (lib/presetNameText). A name has no length limit, so these two functions are what stand between
// a pasted book and every screen that shows a name: pure, and tested here with no DOM at all.
import { describe, it, expect } from 'vitest'
import {
  NAME_DRAWN_UNITS,
  NAME_QUOTED_CHARACTERS,
  copyNumberAt,
  copyNumberOf,
  isDrawnWhole,
  nameAsDrawn,
  nameAsQuoted,
  quotedNameParts,
} from '../src/lib/presetNameText.js'

const FAMILY = '👨‍👩‍👧' // three people and two joiners: 8 units, ONE character
const FLAG = '🇨🇦' // two regional letters: 4 units, ONE character
const THUMB = '👍🏽' // an emoji and its skin tone: 4 units, ONE character
const ACCENTED = 'é' // a letter and its accent: 2 units, ONE character
// Is every character of `text` one of `whole` — i.e. was nothing cut through the middle?
const onlyWhole = (text, whole) => text.split(whole).every((rest) => rest === '')
const loneHalf = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

describe('nameAsDrawn — a name as a name slot draws it', () => {
  it('is the name itself, untouched, for anything a slot could ever show', () => {
    for (const name of ['Preset 1', 'Weekend Mornings', '', 'x'.repeat(NAME_DRAWN_UNITS)]) {
      expect(nameAsDrawn(name)).toBe(name)
      expect(isDrawnWhole(name)).toBe(true)
    }
  })

  it('one unit more, and it is the start of the name and an ellipsis', () => {
    const name = 'x'.repeat(NAME_DRAWN_UNITS + 1)
    expect(isDrawnWhole(name)).toBe(false)
    const drawn = nameAsDrawn(name)
    expect(drawn.endsWith('…')).toBe(true)
    expect(name.startsWith(drawn.slice(0, -1))).toBe(true)
    expect(drawn.length).toBeLessThanOrEqual(NAME_DRAWN_UNITS + 1)
  })

  it('a book is cut to the same few hundred characters, and costs no more to cut', () => {
    const book = 'All work and no play. '.repeat(50_000) // 1,100,000 characters
    const started = performance.now()
    const drawn = nameAsDrawn(book)
    expect(performance.now() - started).toBeLessThan(50)
    expect(drawn.length).toBeLessThanOrEqual(NAME_DRAWN_UNITS + 1)
    expect(book.startsWith(drawn.slice(0, -1))).toBe(true)
  })

  it.each([
    ['an emoji family', FAMILY],
    ['a flag', FLAG],
    ['an emoji with a skin tone', THUMB],
    ['an accented letter', ACCENTED],
  ])('never cuts through %s, wherever the cut falls in it', (_, character) => {
    // Shift the run one unit at a time, so the limit lands on every unit of the character in turn.
    for (let lead = 0; lead < character.length; lead++) {
      const name = 'x'.repeat(lead) + character.repeat(NAME_DRAWN_UNITS)
      const drawn = nameAsDrawn(name).slice(0, -1)
      expect(onlyWhole(drawn.slice(lead), character)).toBe(true)
      expect(drawn).not.toMatch(loneHalf)
      // …and it kept all the whole characters there was room for.
      expect(drawn.length).toBeGreaterThan(NAME_DRAWN_UNITS - 2 * character.length)
    }
  })

  it('one character longer than the limit itself is cut inside, but never through an emoji', () => {
    // A letter with a thousand accents is ONE character: there is no whole one to keep.
    const stacked = 'a' + '́'.repeat(NAME_DRAWN_UNITS * 2)
    expect(nameAsDrawn(stacked)).toBe(stacked.slice(0, NAME_DRAWN_UNITS) + '…')
    // The same, built so the limit falls between the two units of an emoji-sized accent mark.
    const mark = '\u{e0100}' // a variation selector outside the basic plane: two units, joins on
    const odd = 'a' + mark.repeat(NAME_DRAWN_UNITS)
    const drawn = nameAsDrawn(odd)
    expect(drawn).not.toMatch(loneHalf)
    expect(drawn.length).toBe(NAME_DRAWN_UNITS) // 511 units of whole code points, and the ellipsis
  })

  it('a half emoji an older build left in a stored name is shown as it is — nothing is rewritten', () => {
    const stored = 'Weeke\ud83d'
    expect(nameAsDrawn(stored)).toBe(stored)
    expect(nameAsQuoted(stored)).toBe(stored)
  })
})

describe('nameAsQuoted — a name as a sentence quotes it', () => {
  it('is the name itself up to the limit, counted in characters a player sees', () => {
    expect(nameAsQuoted('Weekend')).toBe('Weekend')
    expect(nameAsQuoted('x'.repeat(NAME_QUOTED_CHARACTERS))).toBe(
      'x'.repeat(NAME_QUOTED_CHARACTERS),
    )
    // Eighty thumbs are 320 units and still eighty characters.
    expect(nameAsQuoted(THUMB.repeat(NAME_QUOTED_CHARACTERS))).toBe(
      THUMB.repeat(NAME_QUOTED_CHARACTERS),
    )
  })

  it('one character more, and it is the first eighty and an ellipsis', () => {
    expect(nameAsQuoted('x'.repeat(NAME_QUOTED_CHARACTERS + 1))).toBe(
      'x'.repeat(NAME_QUOTED_CHARACTERS) + '…',
    )
    expect(nameAsQuoted(FLAG.repeat(NAME_QUOTED_CHARACTERS + 1))).toBe(
      FLAG.repeat(NAME_QUOTED_CHARACTERS) + '…',
    )
  })

  it('a book is its first eighty characters and an ellipsis, as cheaply as a long name', () => {
    const book = 'All work and no play. '.repeat(50_000)
    const started = performance.now()
    expect(nameAsQuoted(book)).toBe(book.slice(0, NAME_QUOTED_CHARACTERS) + '…')
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('eighty characters means eighty, however many units each one is', () => {
    // It used to read only as much of the name as a name slot draws (512 units) and count what was
    // in that: 81 families (8 units each) were quoted as 63 of them, 81 couples as 33.
    const COUPLE = '👩🏽‍❤️‍💋‍👨🏽' // a kiss, two skin tones: 15 units, ONE character
    for (const character of [FAMILY, FLAG, THUMB, COUPLE, ACCENTED]) {
      expect(nameAsQuoted(character.repeat(NAME_QUOTED_CHARACTERS))).toBe(
        character.repeat(NAME_QUOTED_CHARACTERS),
      )
      expect(nameAsQuoted(character.repeat(NAME_QUOTED_CHARACTERS + 1))).toBe(
        character.repeat(NAME_QUOTED_CHARACTERS) + '…',
      )
      expect(nameAsQuoted(character.repeat(5000))).toBe(
        character.repeat(NAME_QUOTED_CHARACTERS) + '…',
      )
    }
  })

  it('a name of characters far larger than any real one is still bounded, and still ends in an ellipsis', () => {
    // A letter under three hundred accents is ONE character. Eighty of those would be a page of
    // text to lay out, so what is read of a name to quote it has an end too — and when that end
    // comes first, the quote is the whole characters before it.
    const stacked = 'a' + '́'.repeat(300) // 301 units
    const name = stacked.repeat(80) // 80 characters, 24,080 units
    const quoted = nameAsQuoted(name)
    expect(quoted.endsWith('…')).toBe(true)
    expect(name.startsWith(quoted.slice(0, -1))).toBe(true)
    expect(quoted.slice(0, -1).length % 301).toBe(0) // whole characters only
    expect(quoted.length).toBeLessThan(3000)
    expect(quoted.length).toBeGreaterThan(301) // …and more than one of them
    // Few enough of them to be read whole are quoted whole.
    expect(nameAsQuoted(stacked.repeat(5))).toBe(stacked.repeat(5))
  })
})

describe('quotedNameParts — a quoted name, as the pieces it is drawn in', () => {
  const pile = (marks) => '\u0301\u0302\u0303\u0304'.repeat(Math.ceil(marks / 4)).slice(0, marks)
  const texts = (name) => quotedNameParts(name).map((part) => part.text)
  const stacked = (name) =>
    quotedNameParts(name)
      .filter((part) => part.stacked)
      .map((p) => p.text)

  it('an ordinary name is ONE piece of ordinary text — accents, emoji, and every script included', () => {
    for (const name of [
      'Weekend Mornings',
      'Ångström Ếch café',
      'e\u0301 with a combining accent',
      '🎉👨‍👩‍👧🇨🇦 👍🏽',
      'ที่นี่ กรุงเทพฯ',
      'नमस्ते',
      'العَرَبِيَّة',
      'עִבְרִית',
      'བསྒྲུབས', // a tall Tibetan stack
      '',
    ]) {
      expect(quotedNameParts(name)).toEqual(name ? [{ text: name, stacked: false }] : [])
    }
  })

  it('a letter under more accents than any writing puts on one is a piece of its own, marked stacked', () => {
    const name = `Z${pile(300)}algo w${pile(40)}ith`
    expect(quotedNameParts(name)).toEqual([
      { text: `Z${pile(300)}`, stacked: true },
      { text: 'algo ', stacked: false },
      { text: `w${pile(40)}`, stacked: true },
      { text: 'ith', stacked: false },
    ])
  })

  it('the line is drawn above the handful a real letter can carry: eight marks are a letter, nine a pile', () => {
    expect(stacked(`a${pile(8)}b`)).toEqual([])
    expect(stacked(`a${pile(9)}b`)).toEqual([`a${pile(9)}`])
    // Two piles side by side are two boxes, never one that could wrap between them.
    expect(stacked(`a${pile(9)}b${pile(9)}`)).toEqual([`a${pile(9)}`, `b${pile(9)}`])
    // Length alone does not make a pile: a family is eight units and no marks.
    expect(stacked(FAMILY.repeat(3) + '👩🏽‍❤️‍💋‍👨🏽')).toEqual([])
  })

  it('put back together, the pieces are exactly what the sentence quotes', () => {
    const book = `Z${pile(50)}` + 'All work and no play. '.repeat(5_000)
    for (const name of ['Weekend', `Z${pile(300)}algo`, book, FLAG.repeat(200)]) {
      expect(texts(name).join('')).toBe(nameAsQuoted(name))
    }
    expect(texts(book).at(-1).endsWith('…')).toBe(true)
  })
})

describe("a copy's number survives every cut (Round 26)", () => {
  it('copyNumberAt finds the " (<number>)" copyName writes, and nothing else', () => {
    expect(copyNumberAt('Speed (2)')).toBe(5)
    expect(copyNumberAt('Speed (12)')).toBe(5)
    expect(copyNumberAt('a (1 (2)')).toBe(4)
    for (const name of [
      'Speed',
      'Speed (0)',
      'Speed (02)',
      'Speed(2)',
      'Speed ()',
      '(2)',
      'Speed (2x)',
      'Speed (2) ',
      '',
    ])
      expect(copyNumberAt(name), name).toBe(-1)
    expect(copyNumberOf('Speed (2)')).toBe(' (2)')
    // A "number" far longer than any copy count is not kept whole by a cut.
    expect(copyNumberOf(`Speed (${'9'.repeat(40)})`)).toBe('')
  })

  it('nameAsDrawn cuts a long name before its number, and keeps the number whole', () => {
    const copy = `${'x'.repeat(NAME_DRAWN_UNITS)} (2)`
    const drawn = nameAsDrawn(copy)
    expect(drawn.endsWith('… (2)')).toBe(true)
    expect(drawn.length).toBeLessThanOrEqual(NAME_DRAWN_UNITS + 1)
    // …and a name with no number is cut as before.
    expect(nameAsDrawn('x'.repeat(NAME_DRAWN_UNITS + 4)).endsWith('x…')).toBe(true)
  })

  it('nameAsQuoted does the same, in characters', () => {
    const copy = `${'y'.repeat(NAME_QUOTED_CHARACTERS)} (3)`
    const quoted = nameAsQuoted(copy)
    expect(quoted).toBe(`${'y'.repeat(NAME_QUOTED_CHARACTERS - 4)}… (3)`)
  })
})
