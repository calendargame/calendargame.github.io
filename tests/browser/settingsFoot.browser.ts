// THE ⚙ MENU'S PINNED FOOT — three information lines (Round 26): Contact; Storage used with Changelog
// at the right; Last Updated with Check for updates at the right. components/controlClasses'
// FOOTER_META_ROW_CLASS says how the two-item lines are built; this is where they are measured.
//   • At EVERY window from 320 to 460 wide and 568 to 956 tall: nothing runs out of the foot, the
//     two items of a line share one line box (same top, same height, the line exactly as tall as
//     them), the first item is hard left and the last hard right, and the gaps between the foot's
//     lines are all equal — including a line a pair has had to break onto.
//   • At every PHONE size: each pair is on ONE line, so the foot is exactly three lines.
// Round 25's foot broke Changelog onto a line of its own on the owner's 430-wide iPhone, 12.7px
// below the line above where every other line sat 2.1px apart; both halves of that are pinned here.
//
// ★ RUN TWICE: AS IT IS, AND WITH THE FOOT'S TEXT A TENTH WIDER. The iPhone's system font sets
// these words wider than the fonts on this lane's machines (Round 25 measured ~7.5% over this
// laptop's), and a CI runner's fonts are different again, so "it fits here" is not "it fits on his
// phone". The foot's font size is raised by a tenth for the second run — rem-relative, so it still
// scales with the window — which stands for a font that much wider.
//
// ⚠ WHERE A PAIR MAY BREAK. Only in a window narrower than any phone and as tall as one (an iPad's
// 320px Slide Over): the root size that height gives cannot fit "Last Updated: …" beside "Check for
// updates" there. The line then breaks, the second item stays at the right, and the gap stays the
// foot's own — which the first half of the sweep holds it to.
import { test, expect, openApp, openSettings, resizeTo, SAME_PX, type Rect } from './support/app'
import type { Locator } from '@playwright/test'

const WIDTHS = Array.from({ length: 15 }, (_, i) => 320 + i * 10)
const HEIGHTS = [568, 640, 700, 760, 820, 880, 956]
// Phones in use (CSS pixels): the narrowest iPhone, the common Androids, every current iPhone.
const PHONES: [number, number][] = [
  [320, 568],
  [360, 640],
  [360, 740],
  [360, 800],
  [375, 667],
  [375, 812],
  [390, 844],
  [393, 852],
  [402, 874],
  [412, 915],
  [414, 896],
  [428, 926],
  [430, 932],
  [440, 956],
]
const FACTORS = [1, 1.1]
// Two boxes laid out on one line can differ by the browsers' grain; a line is a line within this.
const LINE_PX = 0.5

interface Foot {
  content: { left: number; right: number }
  /** Each of the foot's lines as laid out: its own box, and the boxes of the items in it. */
  lines: { box: Rect; items: Rect[] }[]
}

const measure = (foot: Locator, factor: number): Promise<Foot> =>
  foot.evaluate((el, factor) => {
    // An item's place is its box less its side padding: a link's px-1 (the press-drag ring's room)
    // is cancelled by an equal -mx-1, so what is left is where its text sits in the flow.
    const box = (e: Element) => {
      const r = e.getBoundingClientRect()
      const { top, bottom, height } = r
      const cs = getComputedStyle(e)
      const left = r.left + parseFloat(cs.paddingLeft)
      const right = r.right - parseFloat(cs.paddingRight)
      return { left, top, right, bottom, width: right - left, height }
    }
    ;(el as HTMLElement).style.fontSize = factor === 1 ? '' : `calc(0.6875rem * ${factor})`
    const s = getComputedStyle(el)
    const outer = el.getBoundingClientRect()
    return {
      content: {
        left: outer.left + parseFloat(s.paddingLeft),
        right: outer.right - parseFloat(s.paddingRight),
      },
      // The Contact line is one item; each two-item line's items are its children.
      lines: [...el.children].map((line, i) => ({
        box: box(line),
        items: i === 0 ? [box(line)] : [...line.children].map(box),
      })),
    }
  }, factor)

/** The visual lines of the foot, top to bottom: each item, grouped with the items it shares a
 *  line box with. A pair that has broken is two visual lines. */
const visualLines = (foot: Foot) =>
  foot.lines.flatMap(({ items }) => {
    const out: Rect[][] = []
    for (const item of items) {
      const line = out.find((l) => Math.abs(l[0].top - item.top) <= LINE_PX)
      if (line) line.push(item)
      else out.push([item])
    }
    return out
  })

test('the foot’s lines: nothing runs out, each pair on one line box anchored at both ends, and equal gaps between lines', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await openApp(page)
  const foot = (await openSettings(page)).locator('.popover-sticky-footer')
  await expect(foot.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  let broke = 0
  for (const factor of FACTORS)
    for (const height of HEIGHTS)
      for (const width of WIDTHS) {
        await resizeTo(page, width, height)
        const at = `at ${width}×${height}${factor === 1 ? '' : `, text ×${factor}`}`
        const now = await measure(foot, factor)
        for (const [i, { box, items }] of now.lines.entries()) {
          for (const item of items) {
            expect(item.left, `${at}: line ${i + 1} runs out on the left`).toBeGreaterThanOrEqual(
              now.content.left - SAME_PX,
            )
            expect(item.right, `${at}: line ${i + 1} runs out on the right`).toBeLessThanOrEqual(
              now.content.right + SAME_PX,
            )
          }
          if (i === 0) continue
          const [first, last] = [items[0], items[items.length - 1]]
          expect(
            Math.abs(first.left - now.content.left),
            `${at}: line ${i + 1}, hard left`,
          ).toBeLessThanOrEqual(SAME_PX)
          expect(
            Math.abs(last.right - now.content.right),
            `${at}: line ${i + 1}, hard right`,
          ).toBeLessThanOrEqual(SAME_PX)
          const one = Math.abs(first.top - last.top) <= LINE_PX
          if (!one) broke++
          else {
            expect(
              Math.abs(first.height - last.height),
              `${at}: line ${i + 1}, one height`,
            ).toBeLessThanOrEqual(LINE_PX)
            expect(
              Math.abs(box.height - first.height),
              `${at}: line ${i + 1} is as tall as its items`,
            ).toBeLessThanOrEqual(LINE_PX)
          }
        }
        const lines = visualLines(now)
        const gaps = lines
          .slice(1)
          .map(
            (line, i) =>
              Math.min(...line.map((r) => r.top)) - Math.max(...lines[i].map((r) => r.bottom)),
          )
        expect(
          Math.max(...gaps) - Math.min(...gaps),
          `${at}: the gaps between the foot's lines (${gaps.map((g) => g.toFixed(2)).join(', ')})`,
        ).toBeLessThanOrEqual(LINE_PX / 5)
      }
  // The sweep reached the one case the foot allows a break in — or there is nothing to say about it.
  expect(broke, 'windows where a pair broke onto a second line').toBeGreaterThan(0)
})

test('at every phone size each pair is on one line: the foot is three lines', async ({ page }) => {
  test.setTimeout(120_000)
  await openApp(page)
  const foot = (await openSettings(page)).locator('.popover-sticky-footer')
  for (const factor of FACTORS)
    for (const [width, height] of PHONES) {
      await resizeTo(page, width, height)
      const now = await measure(foot, factor)
      expect(
        visualLines(now).length,
        `at ${width}×${height}${factor === 1 ? '' : `, text ×${factor}`}`,
      ).toBe(3)
    }
})
