// THE DATE ON THE CARD IS ONE LINE, AT ONE SIZE PER CARD, AND NEVER TOUCHES THE CARD NUMBER — in
// whatever font the device has (Round 26, Q7; components/DateLine and lib/dateLineFit say how).
// Held here, on the real card, at the phone sizes where it is tightest, in THREE FONTS: the
// machine's own, and its serif and its monospace — two more every machine has, set very
// differently from it and from each other (monospace is wider than any system font). Each is put on
// the page after it opened, so the change of font is itself part of what is tested: the size must
// follow it with no reload.
//   • THE WIDEST REAL DATE of each format the card can show — found by measuring, in the page's own
//     font, every year, day, and month the card can draw, never named in advance (which date is
//     widest depends on the font) — takes ONE line, inside the date's room, with the card exactly as
//     tall as for a short date, so the answer buttons never move;
//   • every date on the card is drawn at the same size, and that size is the LARGEST the rule
//     allows: the full 1.875rem, or the widest date fills its room (a size chosen smaller than it
//     need be is as much a failure as one too big);
//   • THE CARD NUMBER ("Q1" while browsing back — and every number of the digit count its corner is
//     kept for: as many digits as the count has now) never meets the date's letters: the owner's
//     ruling, held as no overlap between the number's box and the date's;
//   • and that corner grows a digit only when the count does: the date keeps its size from one
//     question to the next, and gives a little - only where it would otherwise meet the number - at
//     the card that takes the count from 99 to 100;
//   • the date stays CENTRED on the card: its room stops short of the card's two sides by the same
//     inset;
//   • and the size is chosen for the formats the card can show: all five while Random Format is
//     on, the one Date Format sets when it is off.
// The widest strings are put into the card's own date element: what is measured is how the app's
// own rule sets that text, which no seed can draw on demand (the date shown is random).
import type { Locator, Page } from '@playwright/test'
import {
  test,
  expect,
  openApp,
  resizeTo,
  rectOf,
  settled,
  SAME_PX,
  expectPageNotWiderThanWindow,
} from './support/app'
import { DAY, MONTH, fmt, type FormatId } from '../../src/lib/format'
import { FORMAT_IDS } from '../../src/lib/modeFormat'
import { dim, isJulianDate, wday, wdayJulian, YEAR_MAX_JULIAN } from '../../src/lib/calendar'

const SIZES: [number, number][] = [
  [280, 653],
  [320, 568],
  [360, 640],
  [360, 800],
  [360, 860],
  [375, 667],
  [375, 812],
  [390, 844],
  [393, 852],
  [402, 874],
  [412, 915],
  [430, 932],
  [440, 956],
]
const FONTS = [null, 'serif', 'monospace'] as const
const DATE = '.date-line:visible'

// Put the page in another of the machine's fonts, as a stylesheet would.
async function useFont(page: Page, font: (typeof FONTS)[number]) {
  if (!font) return
  await page.addStyleTag({ content: `html{font-family:${font} !important}` })
  await settled(page)
}

// The date on screen, read in any of the five formats, answered right (the default settings: Julian
// before the 1582 changeover) — so the mode moves on, and the card can be browsed back to.
async function answerRight(page: Page) {
  const shown = (await page.locator(DATE).textContent()) ?? ''
  const month = (name: string) => MONTH.indexOf(name) + 1
  const read: [RegExp, (g: string[]) => number[]][] = [
    [/^(\w+) (\d+), (\d+)$/, ([, mo, d, y]) => [+y, month(mo), +d]],
    [/^(\d+) (\w+) (\d+)$/, ([, d, mo, y]) => [+y, month(mo), +d]],
    [/^(\d+)\/(\d+)\/(\d+)$/, ([, m, d, y]) => [+y, +m, +d]],
    [/^(\d+)\.(\d+)\.(\d+)$/, ([, d, m, y]) => [+y, +m, +d]],
    [/^(\d+)-(\d+)-(\d+)$/, ([, y, m, d]) => [+y, +m, +d]],
  ]
  const hit = read.map(([re, f]) => [re.exec(shown), f] as const).find(([g]) => g)
  expect(hit, `a date in one of the five formats, not "${shown}"`).toBeDefined()
  const [y, m, d] = hit![1]([...hit![0]!])
  const weekday = DAY[isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)]
  await page.locator('[data-answer-grid]:visible').getByRole('button', { name: weekday }).click()
}

// The widest real dates of each format, in the date line's own font as it is now: every year the
// card can draw (1 to 11582), every day each month has (29 in February, for the Julian leap years),
// and every month, measured — then the three widest of each format, for the real line to be held to.
async function widestDates(date: Locator, formats: readonly FormatId[]) {
  const years = Array.from({ length: YEAR_MAX_JULIAN }, (_, i) => String(i + 1))
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1))
  const measure = (texts: string[]) =>
    date.evaluate((el, texts) => {
      const cs = getComputedStyle(el)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      return texts.map((t) => ctx.measureText(t).width)
    }, texts)
  const yearWidths = await measure(years)
  const year = +years[yearWidths.indexOf(Math.max(...yearWidths))]
  const dayWidths = await measure(days)
  const widestDay = (m: number) => {
    const most = m === 2 ? 29 : dim(2001, m)
    const w = dayWidths.slice(0, most)
    return w.indexOf(Math.max(...w)) + 1
  }
  const out: Record<string, string[]> = {}
  for (const format of formats) {
    const candidates = MONTH.map((_, i) => fmt(year, i + 1, widestDay(i + 1), format))
    const widths = await measure(candidates)
    out[format] = candidates
      .map((text, i) => ({ text, w: widths[i] }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 3)
      .map((c) => c.text)
  }
  return out
}

const CONFIGS: { name: string; randomFormat: boolean; dateFormat: FormatId }[] = [
  { name: 'Random Format on', randomFormat: true, dateFormat: 'written-mdy' },
  { name: 'Date Format numeric-ymd', randomFormat: false, dateFormat: 'numeric-ymd' },
  { name: 'Date Format written-dmy', randomFormat: false, dateFormat: 'written-dmy' },
]

for (const font of FONTS)
  for (const config of CONFIGS)
    test(`${font ?? "the machine's own font"}, ${config.name}: the widest date of every format is one line, the largest size that fits, clear of the card number, and the card keeps its height`, async ({
      page,
    }) => {
      test.setTimeout(240_000)
      await openApp(page, {
        seed: {
          settings: { randomFormat: config.randomFormat, dateFormat: config.dateFormat },
        },
      })
      await useFont(page, font)
      const date = page.locator(DATE)
      if (font) expect(await date.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(font)
      // One card answered and browsed back to: the card number shows.
      await answerRight(page)
      await page.locator('[data-key="ArrowLeft"]:visible').click()
      const card = date.locator('xpath=../..')
      const number = card.locator('xpath=./span').filter({ hasText: /^Q\d+$/ })
      await expect(number).toBeVisible()
      const formats = config.randomFormat ? FORMAT_IDS : [config.dateFormat]
      for (const [width, height] of SIZES) {
        await resizeTo(page, width, height)
        const at = `${config.name}, at ${width}×${height}`
        const set = async (text: string) => {
          await date.evaluate((el, t) => (el.textContent = t), text)
          await settled(page)
        }
        await set('May 1, 1')
        const short = await rectOf(card)
        const lineHeight = await date.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
        const size = await date.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        const full = await page.evaluate(
          () => 1.875 * parseFloat(getComputedStyle(document.documentElement).fontSize),
        )
        // Centred: the room stops short of the card's two sides by the same inset.
        const room = await rectOf(date)
        const cardBox = await rectOf(card)
        expect(
          Math.abs(room.left - cardBox.left - (cardBox.right - room.right)),
          `${at}: the date's room is centred on the card`,
        ).toBeLessThanOrEqual(SAME_PX)
        expect(size, `${at}: never above the full size`).toBeLessThanOrEqual(full + SAME_PX)
        const texts = Object.entries(await widestDates(date, formats)).flatMap(([format, t]) =>
          t.map((text) => ({ format, text })),
        )
        // Every text measured where the app sets it, in one pass (a change of text changes no size,
        // so nothing has to settle between them): its line, its letters, its size, the card; and
        // against each, the card number as it is and as every number its corner is kept for (the
        // rows of the corner's own sizer: "Q" and each digit, as many as the count has).
        const seen = await date.evaluate(
          (el, { texts }) => {
            const labels = (el.previousElementSibling?.textContent ?? '').split('\n')
            const card = el.parentElement!.parentElement!
            const number = [...card.children].find((c) => /^Q\d+$/.test(c.textContent ?? ''))!
            const keepDate = el.textContent
            const keepNumber = number.textContent
            const out = texts.map(({ text }) => {
              el.textContent = text
              const range = document.createRange()
              range.selectNodeContents(el)
              const ink = range.getBoundingClientRect()
              const box = el.getBoundingClientRect()
              const clear = [keepNumber, ...labels].map((label) => {
                number.textContent = label
                const n = number.getBoundingClientRect()
                return {
                  label,
                  apart:
                    n.right <= ink.left + 0.05 ||
                    n.left >= ink.right - 0.05 ||
                    n.bottom <= ink.top + 0.05 ||
                    n.top >= ink.bottom - 0.05,
                }
              })
              number.textContent = keepNumber
              return {
                height: box.height,
                over: Math.max(ink.right - box.right, box.left - ink.left),
                inkWidth: ink.width,
                size: parseFloat(getComputedStyle(el).fontSize),
                cardHeight: card.getBoundingClientRect().height,
                touching: clear.filter((c) => !c.apart).map((c) => c.label),
              }
            })
            el.textContent = keepDate
            return out
          },
          { texts },
        )
        let widestInk = 0
        for (const [i, r] of seen.entries()) {
          const what = `${at}, ${texts[i].format} "${texts[i].text}"`
          widestInk = Math.max(widestInk, r.inkWidth)
          expect(r.height, `${what}: one line`).toBeLessThanOrEqual(lineHeight + SAME_PX)
          expect(r.over, `${what}: inside its room`).toBeLessThanOrEqual(SAME_PX)
          expect(r.size, `${what}: one size for every date on the card`).toBe(size)
          expect(
            Math.abs(r.cardHeight - short.height),
            `${what}: the card's height`,
          ).toBeLessThanOrEqual(SAME_PX)
          expect(r.touching, `${what}: clear of the card number`).toEqual([])
        }
        // The largest size the rule allows: the full size, or the widest date fills its room.
        // (The rule sizes for the widest SHAPE — each digit the font's widest — so a font with
        // figures of different widths leaves the widest real date a little short of the room.)
        if (size < full - SAME_PX)
          expect(widestInk, `${at}: the widest date fills its room`).toBeGreaterThanOrEqual(
            room.width * 0.97,
          )
        await expectPageNotWiderThanWindow(page)
      }
    })

const BLANK = { played: 0, good: 0, streak: 0, best: 0, times: [] as number[] }

// ★ THE CORNER FOLLOWS THE COUNT (the owner's ruling): a card number of as many digits as the count has
// now. From the 98th card to the 99th the date keeps its size exactly; at the 100th the corner gains a
// digit, and the date may give a little - never more than its own room needs, and never on a card wide
// enough for the date to clear the corner anyway; and every number of the new count's digits stays clear.
for (const [width, height] of [
  [280, 653],
  [360, 800],
  [430, 932],
] as const)
  test(`at ${width}×${height}: the date keeps its size from one card to the next, and gives only as the count gains a digit`, async ({
    page,
  }) => {
    await openApp(page, {
      viewport: { width, height },
      seed: {
        settings: { randomFormat: true, dateFormat: 'written-mdy' },
        progress: {
          stats: {
            classic: { played: 97, good: 97, streak: 0, best: 0, times: [] },
            flash: BLANK,
            dedDay: BLANK,
            dedMonth: BLANK,
            dedYear: BLANK,
          },
        },
      },
    })
    const date = page.locator(DATE)
    const size = () => date.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const corner = () =>
      date.evaluate((el) => (el.previousElementSibling?.textContent ?? '').split('\n')[0])
    expect(await corner()).toBe('Q00') // the 98th card
    const at98 = await size()
    await answerRight(page)
    expect(await corner()).toBe('Q00') // the 99th
    expect(await size()).toBe(at98)
    await answerRight(page)
    expect(await corner()).toBe('Q000') // the 100th: one more digit kept
    const at100 = await size()
    expect(at100).toBeLessThanOrEqual(at98)
    const full = await page.evaluate(
      () => 1.875 * parseFloat(getComputedStyle(document.documentElement).fontSize),
    )
    // (a card wide enough for the widest date to clear the corner at full size keeps the full size)
    if (at98 >= full - SAME_PX) {
      const room = await rectOf(date)
      const widest = await date.evaluate((el) => el.scrollWidth)
      if (widest <= room.width) expect(at100).toBe(at98)
    }
    await expectPageNotWiderThanWindow(page)
  })
