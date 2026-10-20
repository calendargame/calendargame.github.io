// The widest date a card can draw, as the date line is sized for it (lib/dateLineFit, lib/textFit):
// the pure halves — the widest number in a span, digit by digit, for a font's own digit widths, and
// what a card spells as the dates it can show. The browser lane (dateLine) holds the sizes it makes.
import { describe, it, expect } from 'vitest'
import { widestNumberIn } from '../src/lib/textFit.js'
import { dateLineShapes } from '../src/lib/dateLineFit.js'

// A font with uniform digits, and one whose 1 is narrow and 8 the widest (proportional figures).
const EVEN = Array(10).fill(10)
const PROPORTIONAL = [10, 6, 10, 10, 10, 10, 10, 10, 11, 10]
// A number's width, its digits' widths added; and the widest in a span, by trying every number.
const width = (n, widths) => [...String(n)].reduce((sum, d) => sum + widths[+d], 0)
const brute = (lo, hi, widths) => {
  let most = -1
  for (let n = lo; n <= hi; n++) most = Math.max(most, width(n, widths))
  return most
}

describe('widestNumberIn — the widest number a span holds, for a font', () => {
  it('reads a span for what it holds, not as all of its digits the widest', () => {
    expect(widestNumberIn(10000, 11582, PROPORTIONAL)).toBe(10888)
    expect(widestNumberIn(1900, 2100, PROPORTIONAL)).toBe(2088)
    expect(String(widestNumberIn(1, 11582, EVEN))).toHaveLength(5)
    expect(String(widestNumberIn(1, 31, PROPORTIONAL))).toBe('28')
  })
  it('is the widest, as a search of every number finds it, for spans of every shape', () => {
    for (const widths of [EVEN, PROPORTIONAL, [7, 3, 9, 5, 8, 6, 4, 12, 2, 1]])
      for (const [lo, hi] of [
        [1, 9],
        [1, 31],
        [7, 12],
        [95, 1003],
        [1582, 1582],
        [1, 11582],
        [9999, 10001],
      ])
        expect(width(widestNumberIn(lo, hi, widths), widths), `${lo}-${hi}`).toBe(
          brute(lo, hi, widths),
        )
  })
})

describe('dateLineShapes — what a card can show, spelled', () => {
  it('the formats, then the Year Range in effect', () => {
    expect(dateLineShapes([], 'written-mdy', false, 1, 11582)).toBe('written-mdy 1-11582')
    expect(dateLineShapes([], 'numeric-ymd', true, 1900, 2100).split(' ')).toHaveLength(6)
  })
  it('…and the years of held dates the range no longer holds, once each, in order', () => {
    const held = [{ y: 11000, _fmt: 'numeric-ymd' }, { y: 2000 }, { y: 5 }, { y: 11000 }, null]
    expect(dateLineShapes(held, 'written-mdy', false, 1900, 2100)).toBe(
      'written-mdy numeric-ymd 1900-2100 5 11000',
    )
  })
})
