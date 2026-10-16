// THE TOP BAR'S HEIGHT, FOLLOWED WITH NOTHING RAISED (Round 26, Q14). src/main.tsx measures the
// fixed bar and writes --bar-h, which places everything under it: where the page's content starts,
// the line How to Play's headers dock on, the top fade. It is written from the bar's own
// ResizeObserver, and until Round 26 every change of the bar's height made the browser log
// "ResizeObserver loop completed with undelivered notifications" — the scroller, sized by --bar-h,
// sat at the bar's own depth in the page, so its change could not be reported in the frame it
// happened in. The box main.tsx now puts round the scroller is the fix; this proves it, in both
// engines, across the window changes that move the bar's height (the root font follows the window),
// and with a How to Play section docked under the bar while the screen turns.
//
// The lane fails any test on an error the page raised or logged (support/app), so "nothing raised"
// is checked at the end of each test without being written down; what is asserted here is where
// things REST once the window has changed: --bar-h is the bar's height to the browser's own grain,
// and what it places sits exactly there.
import { test, expect, openApp, resizeTo, settled, switchMode, SAME_PX } from './support/app'
import type { Page } from '@playwright/test'

// What --bar-h says against the bar it measures, and where the page's content starts.
const barNow = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('header')!.getBoundingClientRect()
    const scroller = document.getElementById('appScroll')!
    return {
      barBottom: bar.bottom,
      written: parseFloat(document.documentElement.style.getPropertyValue('--bar-h')),
      contentTop: (scroller.firstElementChild as HTMLElement).getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
    }
  })

const WINDOWS: [number, number][] = [
  [390, 600],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1280, 800],
  [360, 740],
]

test('every window size: --bar-h is the bar’s height, and the page starts right under it', async ({
  page,
}) => {
  await openApp(page)
  for (const [width, height] of WINDOWS) {
    await resizeTo(page, width, height)
    const now = await barNow(page)
    expect(Math.abs(now.written - now.barBottom), `${width}×${height}: --bar-h`).toBeLessThan(
      SAME_PX,
    )
    expect(now.scrollTop).toBe(0)
    expect(Math.abs(now.contentTop - now.barBottom), `${width}×${height}: content`).toBeLessThan(
      SAME_PX,
    )
  }
})

test('How to Play, a section open and docked under the bar, turned and turned back: still on the line', async ({
  page,
}) => {
  await openApp(page)
  await switchMode(page, 'guide') // the bar grows here: How to Play gives it a little more room below
  const head = page.locator('[data-guide] .guide-head').nth(5)
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  // Scroll well into the open section, so its header is docked on the line under the bar.
  await head.evaluate((h) => {
    const sc = document.getElementById('appScroll')!
    const line = document.querySelector('header')!.getBoundingClientRect().bottom
    sc.scrollTop += h.getBoundingClientRect().top - line + 200
  })
  await settled(page)
  for (const [width, height] of [
    [844, 390],
    [390, 844],
  ]) {
    await resizeTo(page, width, height)
    const now = await barNow(page)
    expect(Math.abs(now.written - now.barBottom), `${width}×${height}: --bar-h`).toBeLessThan(
      SAME_PX,
    )
    const offLine = (await head.boundingBox())!.y - now.barBottom
    expect(Math.abs(offLine), `${width}×${height}: the docked header is on the line`).toBeLessThan(
      SAME_PX,
    )
  }
})
