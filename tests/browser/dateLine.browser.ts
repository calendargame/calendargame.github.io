// THE DATE ON THE CARD IS ONE LINE, AT ONE SIZE PER SCREEN — five-digit years included (Round 26, Q7).
// With the Julian Calendar setting on, years run to 11582 (and the Julian-off range includes 10000),
// so the widest written date — "September 10, 10000", the widest of every date the lane measured —
// no longer fit a narrow phone's card at the full 1.875rem. index.css's .date-line sets the date at
// 1.875rem or at the card's width over 10.97em, whichever is smaller (a tenth over the widest date in
// WebKit here: the lane's stand-in for an iPhone's wider font). Held here, on the real card, in every
// date format, at the sizes where it is tightest:
//   • the widest date of each format takes ONE line, inside the card, with the card exactly as tall
//     as it is for a short date — so the answer buttons never move;
// ⚠ NOT HELD HERE: the card number ("Q12", top right while browsing back) against the date's letters.
// Measured (Round 26): its letters sit 4-8px into the date line's top at every size, so a date that
// fills the card touches it — the widest five-digit date does at 280×653 and 360×800-956 (0.2-3.9px),
// and so did the widest four-digit date at 360×860 before this rule (about 13px). Where the label
// goes is a layout question for the owner, reported with the round rather than decided here.
// The worst strings are put into the card's own date element: what is measured is how the app's own
// rule sets that text, which no seed can draw on demand (the date shown is random).
// (Lookup's history rows, five-digit years among them, are held by tests/browser/lookupRows.)
import { test, expect, openApp, resizeTo, rectOf, settled } from './support/app'
import { SAME_PX, expectPageNotWiderThanWindow } from './support/app'

const WIDEST = {
  'written-mdy': 'September 10, 10000',
  'written-dmy': '10 September 10000',
  'numeric-mdy': '10/10/10000',
  'numeric-dmy': '10.10.10000',
  'numeric-ymd': '10000-10-10',
}
const SIZES: [number, number][] = [
  [280, 653],
  [320, 568],
  [360, 640],
  [360, 800],
  [360, 860],
  [360, 956],
  [375, 667],
  [375, 812],
  [375, 860],
  [390, 844],
  [390, 956],
  [393, 852],
  [402, 874],
  [412, 915],
  [430, 932],
  [440, 956],
]

// The date element on screen, its card centre, and the card number when it is showing.
const DATE = '.date-line:visible'

test('the widest date of every format is one line in its card, at every phone size, and the card keeps its height', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openApp(page, { seed: { settings: { randomFormat: false, dateFormat: 'written-mdy' } } })
  const date = page.locator(DATE)
  for (const [width, height] of SIZES) {
    await resizeTo(page, width, height)
    const card = date.locator('xpath=../..')
    const set = async (text: string) => {
      await date.evaluate((el, t) => (el.textContent = t), text)
      await settled(page)
    }
    await set('May 1, 1')
    const short = await rectOf(card)
    const lineHeight = await date.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    for (const [format, text] of Object.entries(WIDEST)) {
      await set(text)
      const at = `at ${width}×${height}, ${format} "${text}"`
      const box = await rectOf(date)
      expect(box.height, `${at}: one line`).toBeLessThanOrEqual(lineHeight + SAME_PX)
      const over = await date.evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const text = range.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        return Math.max(text.right - box.right, box.left - text.left)
      })
      expect(over, `${at}: inside the card`).toBeLessThanOrEqual(SAME_PX)
      expect(
        Math.abs((await rectOf(card)).height - short.height),
        `${at}: the card's height`,
      ).toBeLessThanOrEqual(SAME_PX)
    }
    await expectPageNotWiderThanWindow(page)
  }
})
