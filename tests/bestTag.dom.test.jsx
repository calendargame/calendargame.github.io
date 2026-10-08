// @vitest-environment jsdom
//
// THE BEST ROW'S TAG — "Same Run" / "Different Runs" (MoX), "Same Round" / "Different Rounds"
// (Blitz) — IS SHOWN FOR BOTH WORDINGS OR FOR NEITHER, AND NEVER TAKES A LINE OF ITS OWN.
//
// The owner's rule: if the LONGER wording would be cut off or would overlap anything, both go. So
// the tag's place on the line is always the longer wording's width, whichever is showing, and a tag
// with no room on the readouts' line is not drawn at all — it used to drop to a line of its own and
// make the row taller. It is still SAID: the words stay on the page for a screen reader.
//
// ⚠ WHAT THIS FILE CANNOT SEE: jsdom lays nothing out, so "fits" is not something it can ask. What
// is pinned here is the CONSTRUCTION the result rests on (components/BestReadout's BestLine says why
// each piece is there), in every row that is drawn; that the tag then shows for both wordings or
// neither, never wraps, and never changes the row's height was measured in a real browser at every
// width from 320 to 460, plus 768 and 1280, in both modes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { BestLine, BestColumn } from '../src/components/BestReadout.jsx'
import { useProgress } from '../src/store/progress.js'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'

const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const classes = (el) => [...el.classList]
// The visible mode's Best line: found from its "Best …:" label up to the row's wrapping line.
const bestLine = () => {
  const label = [...document.querySelectorAll('div')].find(
    (el) => !isHidden(el) && /^\s*Best (Score|Mean):/.test(el.firstChild?.nodeValue ?? ''),
  )
  let col = label
  while (!col.classList.contains('min-w-[125px]')) col = col.parentElement
  return col.parentElement.parentElement
}
// A record under EVERY configuration's key, so the test does not restate how a mode composes one.
const everyKey = (rec) =>
  new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? rec : undefined) })
const MODES = [
  {
    mode: 'MoX',
    key: 'A',
    pair: ['Same Run', 'Different Runs'],
    seed: (same) =>
      useProgress.setState({
        aoxBest: everyKey({
          avg: 1.5,
          avgMed: 1.4,
          avgRoundId: 1,
          med: 1.4,
          medAvg: 1.5,
          medRoundId: same ? 1 : 2,
        }),
      }),
  },
  {
    mode: 'Blitz',
    key: 'B',
    pair: ['Same Round', 'Different Rounds'],
    seed: (same) =>
      useProgress.setState({
        blitzBest: everyKey({ score: 5, streak: 3, scoreRoundId: 1, streakRoundId: same ? 1 : 2 }),
      }),
  },
]

// The parts of a line: the readouts' own group, and the tag's place after it (or none).
const parts = (line) => {
  const [readouts, place, ...rest] = line.children
  expect(rest).toEqual([])
  return { readouts, place: place ?? null, words: place ? place.firstElementChild : null }
}

describe('the Best row’s tag — both wordings or neither, and never a line of its own', () => {
  beforeEach(() => resetAppState())
  afterEach(cleanup)

  describe.each(MODES)('$mode', ({ key, pair, seed }) => {
    const open = (same) => {
      mountApp()
      act(() => void fireEvent.keyDown(window, { key }))
      act(() => void seed(same))
      return parts(bestLine())
    }

    it.each([
      [pair[0], true],
      [pair[1], false],
    ])('"%s" stands in the room the LONGER wording needs', (wording, same) => {
      const { place, words } = open(same)
      // The words a reader sees, once, as plain text.
      expect(words.textContent).toBe(wording)
      expect(place.textContent).toBe(wording)
      expect(place.children).toHaveLength(1)
      // The place is sized by the longer wording whichever is showing: drawn by the stylesheet from
      // this attribute, invisible, and no taller than nothing.
      expect(place.dataset.longest).toBe(pair[1])
      expect(classes(place)).toEqual(
        expect.arrayContaining([
          'before:content-[attr(data-longest)]',
          'before:invisible',
          'before:block',
          'before:h-0',
          'whitespace-nowrap',
          'shrink-0',
        ]),
      )
    })

    it('the tag’s place is the same for both wordings, class for class', () => {
      const a = open(true)
      const shape = (p) => [p.place.className, p.place.dataset.longest, p.words.className]
      const same = shape(a)
      cleanup()
      resetAppState()
      expect(shape(open(false))).toEqual(same)
    })

    it('a tag with no room on the readouts’ line adds no line: its place is as tall as the line it is on, and cuts what is outside it', () => {
      const { place, words } = open(false)
      // Out of the flow, so the place's own height is the invisible sizer's — nothing.
      expect(classes(words)).toEqual(expect.arrayContaining(['absolute', 'top-0', 'right-0']))
      expect(classes(place)).toEqual(
        expect.arrayContaining(['relative', 'self-stretch', 'overflow-y-clip']),
      )
      // No fixed height, no margin, and no padding that would give an empty line a size.
      expect(classes(place).filter((c) => /^-?(h|min-h|m[trblxy]?|p[trblxy]?)-/.test(c))).toEqual(
        [],
      )
    })

    it('the line wraps the tag away with no gap under the readouts, and the readouts keep their own', () => {
      const { readouts } = open(true)
      const outer = readouts.parentElement
      expect(classes(outer)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-start']))
      // Between the readouts and the tag: a gap ALONG the line only.
      expect(classes(outer).filter((c) => c.startsWith('gap-'))).toEqual(['gap-x-4'])
      // The readouts wrap among themselves exactly as they did, a full gap apart both ways, take
      // whatever the line has left, and may be narrower than their text when they must wrap.
      expect(classes(readouts)).toEqual(
        expect.arrayContaining(['flex', 'flex-wrap', 'items-start', 'gap-4', 'grow', 'min-w-0']),
      )
      expect(readouts.querySelectorAll('.min-w-\\[125px\\]')).toHaveLength(2)
    })

    it('the words are still on the page for a screen reader, and nothing in the row takes the keyboard', () => {
      const { place, words } = open(false)
      for (let n = words; n !== place.parentElement.parentElement; n = n.parentElement) {
        expect(n.getAttribute('aria-hidden')).toBeNull()
        expect(classes(n).filter((c) => /^(hidden|invisible|sr-only)$/.test(c))).toEqual([])
      }
      const row = place.parentElement.parentElement
      expect(row.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    })

    it('there is no place for a tag until both Bests are on record', () => {
      mountApp()
      act(() => void fireEvent.keyDown(window, { key }))
      const { readouts, place } = parts(bestLine())
      expect(place).toBeNull()
      expect(readouts.querySelectorAll('.min-w-\\[125px\\]')).toHaveLength(2)
    })
  })

  it('the tag’s wording is its mode’s own pair, and the longer of the two is the one reserved', () => {
    for (const [wording, longest] of [
      ['Same Run', 'Different Runs'],
      ['Different Runs', 'Different Runs'],
    ]) {
      const { container } = render(
        <BestLine tag={{ wording, longest }}>
          <BestColumn>Best Score: 1</BestColumn>
        </BestLine>,
      )
      const { place, words } = parts(container.firstElementChild)
      expect([place.dataset.longest, words.textContent]).toEqual([longest, wording])
      cleanup()
    }
  })

  it('How to Play says the tag is left out where there is no room for it, in both modes', () => {
    const guide = readFileSync('src/components/GuidePage.tsx', 'utf8').replace(/\s+/g, ' ')
    const after = (wording) => guide.slice(guide.indexOf(wording), guide.indexOf(wording) + 520)
    for (const wording of ['<i>Different Runs</i> tag', '<i>Different Rounds</i> tag'])
      expect(after(wording)).toMatch(/narrow screen[^.]*left out/)
  })
})
