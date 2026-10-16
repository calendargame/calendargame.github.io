// LOOKUP'S HISTORY ROWS ARE NEVER CUT, IN WHATEVER FONT THE DEVICE HAS (Round 26; components/
// LookupCard's fitRows says how). Held at every phone width from 280 to 460, in THREE FONTS — the
// machine's own, and its serif and its monospace, put on the page after it opened, so the change of
// font is itself part of what is tested.
//   • The rows are the WIDEST REAL ROWS of each kind, found by measuring in the row's own font: for
//     each month, the widest day and year before the 1582 reform (two readings), after it (one full
//     weekday, years to 11582), the widest February 29 that is no Gregorian date ("G: none" — the
//     row that used to be cut), and the ten dates the reform skipped. Which date is widest depends on
//     the font, so none is named in advance.
//   • Every row's date is whole (its text inside its own box: no ellipsis), its readings are whole
//     and inside the row, every row is one line and the same height, and nothing scrolls sideways.
//   • The rows are all drawn at one size.
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  openApp,
  appReady,
  switchMode,
  resizeTo,
  settled,
  SAME_PX,
  expectPageNotWiderThanWindow,
} from './support/app'
import { dim, YEAR_MAX_JULIAN } from '../../src/lib/calendar'

const WIDTHS = [280, 300, 320, 340, 360, 375, 390, 393, 402, 412, 414, 428, 430, 440, 460]
const HEIGHT = 800
const FONTS = [null, 'serif', 'monospace'] as const

type Entry = { id: string; y: number; m: number; d: number; isGap?: true }

// The widest real rows of each kind, measured in the label's font as the page sets it now.
async function widestEntries(page: Page): Promise<Entry[]> {
  const measure = (texts: string[]) =>
    page
      .locator('ul li[data-row] button span')
      .first()
      .evaluate((el, texts) => {
        const cs = getComputedStyle(el)
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        return texts.map((t) => ctx.measureText(t).width)
      }, texts)
  const widest = async (years: number[]) => {
    const w = await measure(years.map(String))
    return years[w.indexOf(Math.max(...w))]
  }
  const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const dayWidths = await measure(range(1, 31).map(String))
  const widestDay = (most: number) => {
    const w = dayWidths.slice(0, most)
    return w.indexOf(Math.max(...w)) + 1
  }
  const before = await widest(range(1, 1581))
  const leapBefore = await widest(range(1, 1581).filter((y) => y % 4 === 0))
  const noGregorian = await widest(
    range(1, 15)
      .map((c) => c * 100)
      .filter((y) => y % 400 !== 0),
  )
  const after = await widest(range(1583, YEAR_MAX_JULIAN))
  const out: Entry[] = []
  for (const m of range(1, 12)) {
    const y = m === 2 ? leapBefore : before
    out.push({ id: `a${m}`, y, m, d: widestDay(m === 2 ? 29 : dim(y, m)) })
    out.push({ id: `b${m}`, y: after, m, d: widestDay(dim(after, m)) })
  }
  out.push({ id: 'none', y: noGregorian, m: 2, d: 29 })
  for (const d of range(5, 14)) out.push({ id: `gap${d}`, y: 1582, m: 10, d, isGap: true })
  return out
}

async function seedHistory(page: Page, history: Entry[]) {
  await page.evaluate(
    (history) =>
      window.localStorage.setItem(
        'cg-lookup-v1',
        JSON.stringify({ state: { history }, version: 1 }),
      ),
    history,
  )
  await page.reload()
  await appReady(page)
  await switchMode(page, 'lookup')
}

for (const font of FONTS)
  test(`Lookup: no history row is ever cut, at any phone width — ${font ?? "the machine's own font"}`, async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openApp(page, {
      seed: { settings: { randomFormat: false, dateFormat: 'written-mdy', useJulian: true } },
    })
    // A first row to read the rows' font from, in the font under test.
    await seedHistory(page, [{ id: 's', y: 2000, m: 1, d: 1 }])
    const style = font ? `html{font-family:${font} !important}` : ''
    if (style) await page.addStyleTag({ content: style })
    await settled(page)
    const history = await widestEntries(page)
    await seedHistory(page, history)
    if (style) await page.addStyleTag({ content: style })
    await settled(page)
    const list = page.locator('ul:has(> li[data-row])')
    await expect(list.locator('li[data-row]').first()).toBeVisible()
    for (const width of WIDTHS) {
      await resizeTo(page, width, HEIGHT)
      // Every row, a screenful at a time (the list draws only the rows in and near view).
      const seen = new Map<
        number,
        { text: string; problems: string[]; height: number; size: string }
      >()
      await list.evaluate((ul) => (ul.scrollTop = 0))
      for (;;) {
        await settled(page)
        const rows = await list.evaluate((ul) =>
          [...ul.querySelectorAll('li[data-row]')].map((li) => {
            const button = li.querySelector('button')!
            const [label, readings] = [...button.querySelectorAll('span')]
            const inner = button.getBoundingClientRect()
            const cs = getComputedStyle(button)
            const left = inner.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
            const right =
              inner.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight)
            const textOf = (el: Element) => {
              const r = document.createRange()
              r.selectNodeContents(el)
              return r.getBoundingClientRect()
            }
            const problems: string[] = []
            const l = textOf(label)
            const lb = label.getBoundingClientRect()
            if (l.right > lb.right + 0.05 || label.scrollWidth > label.clientWidth)
              problems.push('the date is cut')
            const r = textOf(readings)
            if (r.left < lb.right - 0.05) problems.push('the readings run into the date')
            if (r.right > right + 0.05 || l.left < left - 0.05) problems.push('outside the row')
            if (Math.abs(l.top - r.top) > 2) problems.push('two lines')
            return {
              index: Number((li as HTMLElement).dataset.row),
              text: button.textContent ?? '',
              problems,
              height: inner.height,
              size: getComputedStyle(label).fontSize,
            }
          }),
        )
        for (const r of rows) seen.set(r.index, r)
        const more = await list.evaluate((ul) => {
          if (ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 1) return false
          ul.scrollTop += Math.max(1, ul.clientHeight - 40)
          return true
        })
        if (!more) break
      }
      expect(seen.size, `at ${width} wide: every row was looked at`).toBe(history.length)
      const heights = new Set([...seen.values()].map((r) => r.height.toFixed(2)))
      const sizes = new Set([...seen.values()].map((r) => r.size))
      expect([...heights], `at ${width} wide: every row is one height`).toHaveLength(1)
      expect([...sizes], `at ${width} wide: every row at one size`).toHaveLength(1)
      for (const r of seen.values()) expect(r.problems, `at ${width} wide: "${r.text}"`).toEqual([])
      await expectPageNotWiderThanWindow(page)
      expect(
        await list.evaluate((ul) => ul.scrollWidth - ul.clientWidth),
        `at ${width} wide: the list does not scroll sideways`,
      ).toBeLessThanOrEqual(SAME_PX)
    }
  })

// A FIT NEVER MOVES A ROW (components/LookupCard's ⚠ on the rows' line heights). The list draws only
// the rows in and near view, and stands in for the rest by their count times one row's pitch, which
// it measures again only when its own box resizes. So a fit that arrives WITHOUT a resize — here a
// font put on the page after it opened — must leave every row exactly as tall as it was; otherwise
// the stand-ins keep the old pitch and the rows jump as the list scrolls. Held on a list long
// enough to be windowed: every row, all the way down, sits at its index times the pitch.
test('Lookup: a change of font that refits the rows leaves every row where the list says it is', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openApp(page, {
    viewport: { width: 300, height: 800 },
    seed: { settings: { randomFormat: false, dateFormat: 'written-mdy', useJulian: true } },
  })
  await seedHistory(
    page,
    Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, y: 1300, m: 2, d: 29 })),
  )
  await settled(page)
  const list = page.locator('ul:has(> li[data-row])')
  const rowSize = () =>
    list.evaluate((ul) => {
      const span = ul.querySelector('li[data-row] button span')!
      return {
        size: getComputedStyle(span).fontSize,
        height: ul.querySelector('li[data-row] button')!.getBoundingClientRect().height,
      }
    })
  const before = await rowSize()
  await page.addStyleTag({ content: 'html{font-family:monospace !important}' })
  await settled(page)
  const after = await rowSize()
  // The font change did refit the rows (or this test would hold nothing)…
  expect(after.size, 'the rows were refitted').not.toBe(before.size)
  // …and no row's height moved with it.
  expect(Math.abs(after.height - before.height), "a row's height").toBeLessThanOrEqual(SAME_PX)
  const tops = new Map<number, number>()
  await list.evaluate((ul) => (ul.scrollTop = 0))
  for (;;) {
    await settled(page)
    const drawn = await list.evaluate((ul) => {
      const top = ul.getBoundingClientRect().top - ul.scrollTop
      return [...ul.querySelectorAll<HTMLElement>('li[data-row]')].map((li) => [
        Number(li.dataset.row),
        li.getBoundingClientRect().top - top,
      ])
    })
    for (const [index, top] of drawn) tops.set(index, top)
    const more = await list.evaluate((ul) => {
      if (ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 1) return false
      ul.scrollTop += Math.max(1, ul.clientHeight - 40)
      return true
    })
    if (!more) break
  }
  expect(tops.size, 'every row was looked at').toBe(150)
  const pitch = tops.get(2)! - tops.get(1)!
  for (const [index, top] of tops)
    if (index > 0)
      expect(
        Math.abs(top - tops.get(1)! - (index - 1) * pitch),
        `row ${index}: where the list's pitch puts it`,
      ).toBeLessThanOrEqual(SAME_PX)
})
