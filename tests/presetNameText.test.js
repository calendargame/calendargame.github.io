// presetNameText — how much of a preset name the app draws outside the box it is typed in
// (lib/presetNameText). A name has no length limit, so these two functions are what stand between
// a pasted book and every screen that shows a name: pure, and tested here with no DOM at all.
import { describe, it, expect } from 'vitest'
import {
  NAME_DRAWN_UNITS,
  NAME_QUOTED_CHARACTERS,
  isDrawnWhole,
  nameAsDrawn,
  nameAsQuoted,
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

  it('a name of few but enormous characters still ends in an ellipsis when it was cut', () => {
    // Fewer than eighty characters fit in what is read of it — but it is not the whole name.
    const name = ('a' + '́'.repeat(100)).repeat(20) // 20 characters, 2,020 units
    const quoted = nameAsQuoted(name)
    expect(quoted.endsWith('…')).toBe(true)
    expect(name.startsWith(quoted.slice(0, -1))).toBe(true)
  })
})
