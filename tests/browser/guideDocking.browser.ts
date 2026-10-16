// HOW TO PLAY'S DOCKING LINE, AT REST. A section's header has one place to rest against the top bar
// — the line under it — and three ways to get there: you open the section, you scroll it, or you
// move the keyboard onto it (index.css's #appScroll and .guide-head say why it is one line).
// lib/accordionMotion and lib/guideDock are the arithmetic, proved in tests/accordionMotion and
// tests/guideDock; what they cannot see is a page whose folds and glides really are in flight when
// the next tap lands. That is measured here, once everything has stopped.
//
// ⚠ RESTING VALUES ONLY (support/app's rule). The quick taps below turn Reduce Motion OFF, because
// the defect they guard exists only while something is moving — but nothing asserted is a frame:
// only where the page comes to rest, compared with where the same taps leave it one at a time.
import { test, expect, openApp, settled, switchMode, SAME_PX } from './support/app'
import type { Page } from '@playwright/test'

const head = (page: Page, i: number) => page.locator('[data-guide] .guide-head').nth(i)

interface HeaderAtRest {
  /** The header's top against the line under the bar (0 = on it, negative = above it). */
  offLine: number
  /** How far its section has been scrolled up under it (0 = at its natural spot). */
  depth: number
  open: boolean
}

const read = (page: Page, i: number): Promise<HeaderAtRest> =>
  head(page, i).evaluate((h) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    const wrapper = h.parentElement!
    return {
      offLine: h.getBoundingClientRect().top - line,
      depth:
        h.getBoundingClientRect().top - wrapper.getBoundingClientRect().top - wrapper.clientTop,
      open: h.getAttribute('aria-expanded') === 'true',
    }
  })

const scrollTop = (page: Page) => page.locator('#appScroll').evaluate((sc) => sc.scrollTop)

// Scroll the page so header `i` sits `below` pixels under the line (negative: above it).
const place = (page: Page, i: number, below: number) =>
  head(page, i).evaluate((h, below) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    sc.scrollTop += h.getBoundingClientRect().top - line - below
  }, below)

// Everything has stopped: no panel is folding, and a look a frame later finds the page where it was.
async function atRest(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector('[data-guide]')!.getAnimations({ subtree: true }).length,
      ),
    )
    .toBe(0)
  await expect
    .poll(async () => {
      const before = await scrollTop(page)
      await settled(page)
      return (await scrollTop(page)) === before
    })
    .toBe(true)
}

// Tap the headers in `order`, `gapMs` apart — or, with no gap, each once the page is at rest. The
// taps are the headers' own click, the event a tap produces: a header that a fold has carried off
// screen for a moment can still be the next one tapped by someone faster than the fold.
async function tap(page: Page, order: number[], gapMs: number | null) {
  if (gapMs === null) {
    for (const i of order) {
      await head(page, i).evaluate((h) => (h as HTMLElement).click())
      await atRest(page)
    }
    return
  }
  await page.evaluate(
    ([order, gapMs]) =>
      new Promise<void>((done) => {
        const heads = document.querySelectorAll<HTMLElement>('[data-guide] .guide-head')
        const next = (k: number) => {
          heads[order[k]].click()
          if (k + 1 < order.length) setTimeout(() => next(k + 1), gapMs)
          else done()
        }
        next(0)
      }),
    [order, gapMs] as const,
  )
  await atRest(page)
}

// Open section `docked`, then scroll its section 200px up under its header: docked, text under it.
async function dock(page: Page, docked: number) {
  await place(page, docked, 250)
  await tap(page, [docked], null)
  await place(page, docked, 0)
  await page.locator('#appScroll').evaluate((sc) => (sc.scrollTop += 200))
  await settled(page)
  expect(
    (await read(page, docked)).depth,
    'the first section is docked, text under it',
  ).toBeGreaterThan(100)
}

// Q15. Three headers tapped in quick succession: the first section is still folding away when the
// third is tapped, and the glide the second set going is stopped by it. Planned from where that
// glide happened to have got to, and without the first fold's remainder, the last header came to
// rest a timing-dependent few pixels below the line (the previous header mostly hidden behind the
// bar), or above it with its section's start hidden under it.
for (const [docked, then] of [
  [5, [6, 7]],
  [5, [4, 3]],
] as const) {
  test(`docked ${docked}, then ${then.join(' and ')} tapped 60ms apart: the page rests exactly where the same taps leave it one at a time`, async ({
    page,
    newDevice,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const last = then[then.length - 1]
    const before = then[then.length - 2]

    await openApp(page)
    await switchMode(page, 'guide')
    await dock(page, docked)
    await tap(page, [...then], 60)
    const quick = {
      top: await scrollTop(page),
      last: await read(page, last),
      before: await read(page, before),
    }

    // The same taps one at a time, on another device (this one's session has the guide's place).
    const one = await newDevice()
    await one.emulateMedia({ reducedMotion: 'no-preference' })
    await openApp(one)
    await switchMode(one, 'guide')
    await dock(one, docked)
    await tap(one, [...then], null)
    const slow = {
      top: await scrollTop(one),
      last: await read(one, last),
      before: await read(one, before),
    }

    expect(quick.top, 'the page is scrolled to the same place').toBe(slow.top)
    expect(
      Math.abs(quick.last.offLine - slow.last.offLine),
      'the last header rests in the same place',
    ).toBeLessThan(SAME_PX)
    expect(
      Math.abs(quick.before.offLine - slow.before.offLine),
      'and so does the one before it',
    ).toBeLessThan(SAME_PX)
    // …and that place is the whole of the section just opened, from its header down: nothing of it
    // is hidden under the header, and the header is not above the line.
    expect(quick.last.open, 'the last section tapped is open').toBe(true)
    expect(quick.last.depth, 'none of its section is under its header').toBeLessThan(1)
    expect(quick.last.offLine, 'its header is not above the line').toBeGreaterThan(-1)
  })
}

// Q16. Shift+Tab onto a header that stands above the line. Partly under the bar, the browser's own
// focus scroll brings it to the line; wholly under it, or scrolled away above, both engines CENTRE
// it instead — and a header near the top of the guide was centred past the top: the page went to
// the very top. The guide now brings it to the line itself. (Plain Tab is the app's own key — it
// opens the mode list — so Shift+Tab is how the keyboard walks onto a header.)
for (const [above, what] of [
  [30, 'partly under the bar'],
  [60, 'wholly under the bar'],
  [300, 'scrolled away above the bar'],
] as const) {
  test(`Shift+Tab onto a header ${what} brings it to rest on the line`, async ({ page }) => {
    await openApp(page)
    await switchMode(page, 'guide')
    await place(page, 5, -above)
    await settled(page)
    expect((await read(page, 5)).offLine, 'the header starts above the line').toBeLessThan(
      -above + 1,
    )
    await head(page, 6).evaluate((h) => h.focus({ preventScroll: true }))
    await page.keyboard.press('Shift+Tab')
    await expect(head(page, 5)).toBeFocused()
    await atRest(page)
    const rest = await read(page, 5)
    expect(rest.offLine, 'on the line (a whole pixel, so up to one above it)').toBeGreaterThan(-1)
    expect(rest.offLine, 'on the line, not below it').toBeLessThanOrEqual(SAME_PX)
  })
}

test('Shift+Tab onto a header already below the line moves nothing', async ({ page }) => {
  await openApp(page)
  await switchMode(page, 'guide')
  await place(page, 5, 200)
  await settled(page)
  const before = await scrollTop(page)
  await head(page, 6).evaluate((h) => h.focus({ preventScroll: true }))
  await page.keyboard.press('Shift+Tab')
  await expect(head(page, 5)).toBeFocused()
  await atRest(page)
  expect(await scrollTop(page)).toBe(before)
})
