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
    expect(rest.offLine, 'on the line, not above it').toBeGreaterThanOrEqual(-SAME_PX)
    expect(rest.offLine, 'on the line: the first whole pixel of scroll below it').toBeLessThan(1)
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

// THE DOCKED HEADER'S OWN TOP LINE (the owner's report: a docked header showed no top border — the
// border is its section's, and had gone behind the bar). From the pixel of scroll in which that
// border goes behind the bar, the header draws a 1px line of its own in the border's place; never
// before, so the border is never doubled.
interface TopLine {
  /** Whether the header draws its own top line. */
  on: boolean
  /** The line's box, against the header's. */
  top: number
  height: number
  width: number
  headerWidth: number
  colour: string
  /** The wrapper's own top border colour, and where that border's lower edge is against the line. */
  borderColour: string
  borderBelowLine: number
  fade: number
  offLine: number
  headerShade: number
}
const topLine = (page: Page, i: number): Promise<TopLine> =>
  head(page, i).evaluate((h) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    const before = getComputedStyle(h, '::before')
    const wrapper = h.parentElement!
    return {
      on: before.content !== 'none' && before.content !== 'normal',
      top: parseFloat(before.top),
      height: parseFloat(before.height),
      width: parseFloat(before.width),
      headerWidth: h.getBoundingClientRect().width,
      colour: before.backgroundColor,
      borderColour: getComputedStyle(wrapper).borderTopColor,
      borderBelowLine: wrapper.getBoundingClientRect().top + wrapper.clientTop - line,
      fade: Number(getComputedStyle(document.querySelector('.doc-fade-top')!).opacity),
      offLine: h.getBoundingClientRect().top - line,
      headerShade: Number((h as HTMLElement).style.getPropertyValue('--shade')),
    }
  })

for (const theme of ['dusk', 'parchment'] as const) {
  test(`${theme}: a docked header draws its section's top border flush against the bar, and only while docked`, async ({
    page,
  }) => {
    await openApp(page, { theme })
    await switchMode(page, 'guide')

    // Opened a little under the line: it opens where it stands, its own border showing — no line.
    await place(page, 5, 120)
    await head(page, 5).click()
    await atRest(page)
    const undocked = await topLine(page, 5)
    expect(undocked.borderBelowLine, 'its section’s border is in view').toBeGreaterThan(100)
    expect(undocked.on, 'an undocked header draws no line of its own').toBe(false)

    // Docked, with text under it.
    await place(page, 5, 0)
    await page.locator('#appScroll').evaluate((sc) => (sc.scrollTop += 200))
    await atRest(page)
    const docked = await topLine(page, 5)
    expect(Math.abs(docked.offLine), 'the header is held on the line').toBeLessThanOrEqual(0.5)
    expect(docked.on, 'a docked header draws its top line').toBe(true)
    expect(docked.top, 'at the header’s top').toBe(0)
    expect(docked.height, 'one pixel tall').toBe(1)
    expect(Math.abs(docked.width - docked.headerWidth), 'the header’s whole width').toBeLessThan(
      SAME_PX,
    )
    expect(docked.colour, 'in the border’s own colour').toBe(docked.borderColour)
    expect(docked.fade, 'with the top fade off').toBe(0)
    expect(docked.headerShade, 'and the header’s shadow on').toBe(1)

    // The pixel of scroll in which the border goes behind the bar: for every position around it, the
    // line is on exactly when the border is no longer below the line — never both, never neither.
    const transition = await head(page, 5).evaluate((h) => {
      const sc = document.getElementById('appScroll')!
      const line =
        sc.getBoundingClientRect().top +
        parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
      const w = h.parentElement!
      return sc.scrollTop + (w.getBoundingClientRect().top + w.clientTop - line)
    })
    for (const at of [-2, -1, 0, 1, 2].map((d) => Math.round(transition) + d)) {
      await page.locator('#appScroll').evaluate((sc, at) => (sc.scrollTop = at), at)
      await atRest(page)
      const here = await topLine(page, 5)
      expect(here.on, `scrolled to ${at}: the line is on exactly when the border has gone`).toBe(
        here.borderBelowLine <= 1 / 64,
      )
    }
  })
}

test('a section opened from above the line comes to rest docked, wearing its line with no shadow', async ({
  page,
}) => {
  await openApp(page)
  await switchMode(page, 'guide')
  await place(page, 5, -30)
  await head(page, 5).evaluate((h) => (h as HTMLElement).click())
  await atRest(page)
  const opened = await topLine(page, 5)
  expect(Math.abs(opened.offLine)).toBeLessThanOrEqual(0.5)
  expect(opened.on).toBe(true)
  expect(opened.headerShade, 'nothing is under it yet').toBe(0)
})

test('closed from its docked header, the header is left on the line without a line of its own, under the fade', async ({
  page,
}) => {
  await openApp(page)
  await switchMode(page, 'guide')
  await place(page, 5, 120)
  await head(page, 5).click()
  await atRest(page)
  await place(page, 5, 0)
  await page.locator('#appScroll').evaluate((sc) => (sc.scrollTop += 200))
  await atRest(page)
  expect((await topLine(page, 5)).on).toBe(true)
  await head(page, 5).click()
  await expect(head(page, 5)).toHaveAttribute('aria-expanded', 'false')
  await atRest(page)
  const closed = await topLine(page, 5)
  expect(Math.abs(closed.offLine), 'left on the line').toBeLessThan(1)
  expect(closed.on, 'a closed header is page content: no line of its own').toBe(false)
  expect(closed.fade, 'and the fade is drawn over it').toBe(1)
})
