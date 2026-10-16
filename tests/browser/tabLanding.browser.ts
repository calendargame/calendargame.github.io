// WHERE THE KEYBOARD LANDS ON EVERY SCREEN. The app scrolls one area (#appScroll) under a fixed top
// bar, and the line under the bar is the usable top of every screen (index.css's #appScroll). A
// control the keyboard steps back onto while it stands above that line must come to rest just under
// the bar — the same line How to Play's section titles rest on (guideDocking.browser.ts holds those).
// The browsers keep that promise by themselves only for a control PARTLY under the bar; one WHOLLY
// behind it, or scrolled away above it, they count as not visible at all and CENTRE — the page
// jumped half a screen, or to the very top. lib/barLine puts it on the line instead.
//
// A short window, so every screen here scrolls; the controls are whatever the screen really has in
// its keyboard order, found from the page, never from a class a test might be about.
import { test, expect, openApp, settled, switchMode, SAME_PX } from './support/app'
import type { Page } from '@playwright/test'

const SHORT = { width: 360, height: 300 }

// The screen's own keyboard stops inside #appScroll, in order, that are not inside a scroller of
// their own (a list that scrolls by itself is that list's business, not the page's).
const markStops = (page: Page) =>
  page.evaluate(() => {
    const sc = document.getElementById('appScroll')!
    const inOwnScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== sc; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return true
      }
      return false
    }
    const stops = [
      ...sc.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !(el as HTMLButtonElement).disabled &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !inOwnScroller(el),
    )
    stops.forEach((el, i) => el.setAttribute('data-lane-stop', String(i)))
    return stops.length
  })

const stop = (page: Page, i: number) => page.locator(`[data-lane-stop="${i}"]`)

// The stop's top against the line under the bar (0 = on it, negative = above it).
const offLine = (page: Page, i: number) =>
  stop(page, i).evaluate((el) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    return el.getBoundingClientRect().top - line
  })

// Scroll the page so stop `i`'s top sits `below` pixels under the line (negative: above it).
const place = (page: Page, i: number, below: number) =>
  stop(page, i).evaluate((el, below) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    sc.scrollTop += el.getBoundingClientRect().top - line - below
  }, below)

const scrollTop = (page: Page) => page.locator('#appScroll').evaluate((sc) => sc.scrollTop)

// A stop that can be scrolled `above` px over the line, shorter than that (so it is WHOLLY over
// it), and the stop after it in keyboard order on screen below the line when it is — so Shift+Tab
// from that one lands on this one.
async function pickPair(page: Page, above: number): Promise<[number, number] | null> {
  const n = await markStops(page)
  for (let i = 0; i + 1 < n; i++) {
    await place(page, i, -above)
    await settled(page)
    if (Math.abs((await offLine(page, i)) + above) >= 1) continue
    const height = await stop(page, i).evaluate((el) => el.getBoundingClientRect().height)
    if (height >= above) continue
    const next = await offLine(page, i + 1)
    const room = await page.evaluate(() => window.innerHeight)
    if (next < 0 || next > room / 2) continue
    return [i, i + 1]
  }
  return null
}

// Wholly under the bar (45px over the line: every stop here is shorter than that), and scrolled
// away above it (85px: off the top of the window altogether) — the second only where the screen
// has a stop with a gap that wide after it, so the next stop is still on screen to step back from.
for (const [screen, above, what] of [
  ['classic', 45, 'wholly under the bar'],
  ['classic', 85, 'scrolled away above the bar'],
  ['deduction', 45, 'wholly under the bar'],
  ['deduction', 85, 'scrolled away above the bar'],
  ['blitz', 45, 'wholly under the bar'],
  ['aox', 45, 'wholly under the bar'],
] as const) {
  test(`${screen}: Shift+Tab onto a control ${what} brings it to rest just under the bar`, async ({
    page,
  }) => {
    await openApp(page, { viewport: SHORT })
    await switchMode(page, screen)
    const pair = await pickPair(page, above)
    expect(pair, `${screen} has a control that can be scrolled ${above}px over the line`).not.toBe(
      null,
    )
    const [target, from] = pair!
    await place(page, target, -above)
    await settled(page)
    expect(await offLine(page, target), 'the control starts above the line').toBeLessThan(
      -above + 1,
    )
    await stop(page, from).evaluate((el) => el.focus({ preventScroll: true }))
    await page.keyboard.press('Shift+Tab')
    await expect(stop(page, target)).toBeFocused()
    await settled(page)
    await settled(page)
    const rest = await offLine(page, target)
    expect(rest, 'on the line, not above it').toBeGreaterThanOrEqual(-SAME_PX)
    expect(rest, 'on the line: the first whole pixel of scroll below it').toBeLessThan(1)
  })
}

test('Shift+Tab onto a control already below the line moves nothing', async ({ page }) => {
  await openApp(page, { viewport: SHORT })
  await switchMode(page, 'classic')
  const n = await markStops(page)
  expect(n, 'Classic has keyboard stops').toBeGreaterThan(2)
  await place(page, 1, 40)
  await settled(page)
  const before = await scrollTop(page)
  await stop(page, 2).evaluate((el) => el.focus({ preventScroll: true }))
  await page.keyboard.press('Shift+Tab')
  await expect(stop(page, 1)).toBeFocused()
  await settled(page)
  await settled(page)
  expect(await scrollTop(page)).toBe(before)
})
