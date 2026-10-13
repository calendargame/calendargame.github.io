// THE BEST ROW'S TAG — "Same Run" / "Different Runs" (MoX), "Same Round" / "Different Rounds"
// (Blitz) — IS SHOWN FOR BOTH WORDINGS OR FOR NEITHER, NEVER WRAPS, AND NEVER CHANGES THE ROW'S
// HEIGHT, at every window width from 320 to 460 and at 768 and 1280.
//
// components/BestReadout's BestLine builds this by layout alone (the tag's place is always the
// longer wording's width; a place with no room goes to a line with no height), and
// tests/bestTag.dom holds the classes it is built from. jsdom cannot ask whether it WORKS — that
// was measured by hand in round 25 — and this is that measurement, kept.
//
// ⚠ NOT COVERED: a readout carrying its ★ (a new Best). The star shows only while the run that set
// the Best is on screen, which no saved data can stand up; the readouts here are as wide as a
// returning player's, not as wide as one who has just set a record.
import { test, expect, openApp, resizeTo, statsBlock, switchMode, SAME_PX } from './support/app'
import { blitzBest, moxBest } from './support/seeds'
import type { PageId } from '../../src/lib/modes'
import type { ProgressValues } from '../../src/store/progress'
import type { Page } from '@playwright/test'

// Every phone width there is, one pixel at a time (the tag comes and goes inside this range), then
// a tablet and a desktop.
const WIDTHS: [width: number, height: number][] = [
  ...Array.from({ length: 141 }, (_, i): [number, number] => [320 + i, 844]),
  [768, 1024],
  [1280, 800],
]

interface Case {
  mode: PageId
  name: string
  /** What the readouts say once the seed is on screen — the proof the app took the seed. */
  shows: string
  wordings: [same: string, different: string]
  progress: (same: boolean) => Partial<ProgressValues>
}

const mox = (name: string, seconds: number, shows: string): Case => ({
  mode: 'aox',
  name,
  shows,
  wordings: ['Same Run', 'Different Runs'],
  progress: (same) =>
    moxBest({
      avg: seconds,
      avgMed: seconds - 0.24,
      avgRoundId: 1,
      med: seconds - 0.24,
      medAvg: seconds,
      medRoundId: same ? 1 : 2,
    }),
})
const blitz = (name: string, score: number): Case => ({
  mode: 'blitz',
  name,
  shows: `Best Score: ${score}`,
  wordings: ['Same Round', 'Different Rounds'],
  progress: (same) =>
    blitzBest({ score, streak: score, scoreRoundId: 1, streakRoundId: same ? 1 : 2 }),
})

const CASES: Case[] = [
  mox('times under ten seconds', 2.34, 'Best Mean: 2.34s'),
  mox('times over ten seconds', 12.34, 'Best Mean: 12.34s'),
  mox('times over a minute', 72.34, 'Best Mean: 1m 12.34s'),
  blitz('two-digit scores', 12),
  blitz('four-digit scores', 1234),
]

interface Measured {
  width: number
  /** The wording on the page (it is always there, drawn or not — a screen reader says it). */
  words: string
  /** Is the tag drawn? Its place has height exactly when it is on the readouts' line. */
  shown: boolean
  rowHeight: number
  /** The line's height less the readouts' own: what the tag adds. Always nothing. */
  added: number
  /** How many lines the words take. */
  wordLines: number
  /**
   * How far the words' line reaches outside their place, above or below: cut part-way if more than
   * nothing. The LINE, not the text's own box — a font's box is as tall as the font says, a pixel
   * more than the line at some sizes, and that pixel is empty.
   */
  cut: number
  /** The space between the end of the last readout's text and the words, when on its line. */
  gap: number
  /** How far the words stop short of the row's right padding edge (negative = past it). */
  inset: number
}

const measure = (page: Page, width: number): Promise<Measured> =>
  statsBlock(page).bests.evaluate((row, width) => {
    const line = row.querySelector(':scope > div')!
    const [readouts, place] = [...line.children]
    const words = place.firstElementChild!
    const textOf = (el: Element) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return range
    }
    const placeBox = place.getBoundingClientRect()
    const wordsLine = words.getBoundingClientRect()
    const wordsBox = textOf(words).getBoundingClientRect()
    const shown = placeBox.height > 0
    const columns = [...readouts.children].filter((el) => el.getAttribute('aria-hidden') === null)
    const lastColumn = columns[columns.length - 1]
    const sameLine = (r: DOMRect) => r.top < wordsBox.bottom && r.bottom > wordsBox.top
    const textEnd = Math.max(
      ...[...textOf(lastColumn).getClientRects()].filter(sameLine).map((r) => r.right),
    )
    const padRight = parseFloat(getComputedStyle(row).paddingRight)
    return {
      width,
      words: words.textContent ?? '',
      shown,
      rowHeight: row.getBoundingClientRect().height,
      added: line.getBoundingClientRect().height - readouts.getBoundingClientRect().height,
      wordLines: textOf(words).getClientRects().length,
      cut: shown
        ? Math.max(placeBox.top - wordsLine.top, wordsLine.bottom - placeBox.bottom, 0)
        : 0,
      gap: shown ? wordsBox.left - textEnd : Infinity,
      inset: row.getBoundingClientRect().right - padRight - wordsBox.right,
    }
  }, width)

async function sweep(page: Page, c: Case, same: boolean): Promise<Measured[]> {
  await openApp(page, { seed: { progress: c.progress(same) } })
  await switchMode(page, c.mode)
  const { bests } = statsBlock(page)
  // The seed is on screen: the readouts say the seeded Best, and the tag says this wording.
  await expect(bests).toContainText(c.shows)
  await expect(bests.locator('[data-longest]')).toHaveText(c.wordings[same ? 0 : 1])
  const out: Measured[] = []
  for (const [width, height] of WIDTHS) {
    await resizeTo(page, width, height)
    out.push(await measure(page, width))
  }
  return out
}

for (const c of CASES) {
  test(`${c.mode === 'aox' ? 'MoX' : 'Blitz'}, ${c.name}: the tag is shown for both wordings or neither, on one line, and adds no height`, async ({
    page,
    newDevice,
  }) => {
    test.setTimeout(240_000)
    // The two wordings side by side — two devices, one save each — swept together.
    const [same, different] = await Promise.all([
      sweep(page, c, true),
      sweep(await newDevice(), c, false),
    ])

    for (const [i, a] of same.entries()) {
      const b = different[i]
      const at = `at ${a.width}px`
      expect(a.words, at).toBe(c.wordings[0])
      expect(b.words, at).toBe(c.wordings[1])
      // Both or neither — and the row is the same height whichever wording is up.
      expect(b.shown, `"${b.words}" shown ${at}, as "${a.words}" is`).toBe(a.shown)
      expect(Math.abs(b.rowHeight - a.rowHeight), `row height ${at}`).toBeLessThanOrEqual(SAME_PX)
      for (const m of [a, b]) {
        const which = `"${m.words}" ${at}`
        // Never a line of its own: the line is exactly as tall as the readouts.
        expect(Math.abs(m.added), `${which}: height the tag adds`).toBeLessThanOrEqual(SAME_PX)
        expect(m.wordLines, `${which}: lines`).toBe(1)
        // Drawn whole or not at all, clear of the readout before it, inside the row.
        expect(m.cut, `${which}: cut part-way`).toBeLessThanOrEqual(SAME_PX)
        if (m.shown) {
          expect(m.gap, `${which}: space after the last readout`).toBeGreaterThan(0)
          expect(m.inset, `${which}: inside the row`).toBeGreaterThanOrEqual(-SAME_PX)
        }
      }
    }
    // The sweep met the tag: at desktop width it is drawn, for both wordings.
    expect(same[same.length - 1].shown, 'the tag is drawn at 1280px').toBe(true)
  })
}

test('the sweep crosses the width where the tag goes: the longest readouts lose it on a narrow phone and keep it on a wide one', async ({
  page,
}) => {
  // Without this the five sweeps above could pass with the tag shown at every width (or at none),
  // having never met the edge the rule is about.
  const c = CASES[2]
  await openApp(page, { seed: { progress: c.progress(false) } })
  await switchMode(page, c.mode)
  await expect(statsBlock(page).bests).toContainText(c.shows)
  await resizeTo(page, 320, 844)
  expect((await measure(page, 320)).shown, 'at 320px').toBe(false)
  await resizeTo(page, 1280, 800)
  expect((await measure(page, 1280)).shown, 'at 1280px').toBe(true)
})
