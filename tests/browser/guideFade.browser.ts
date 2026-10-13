// HOW TO PLAY'S TOP FADE, AT REST. The page's top fade says "text is sliding under the top bar". A
// section's header docks against the bar while its section is open and scrolled, and takes that edge
// over — so:
//   • an OPEN header docked on the line: the fade is OFF (0), and the bar's own shadow with it;
//   • a CLOSED header resting on the line: the fade is ON (1) — a closed header is just more of the
//     page, and the page is sliding under the bar (the owner's ruling);
//   • nothing scrolled: off.
// lib/guideDock is the arithmetic and tests/guideDock proves it for every position; what it cannot
// see is the page — that the header really docks where the arithmetic assumes, and what the fade's
// opacity really is once everything has stopped. That is measured here.
//
// ⚠ RESTING VALUES ONLY (support/app's rule). How the fade gets from one value to the other while a
// section glides — the hand-off round 25 traced frame by frame — is deliberately not asserted: a
// frame trace is a property of the machine it ran on.
import { test, expect, openApp, settled, switchMode, SAME_PX } from './support/app'
import type { Locator, Page } from '@playwright/test'

interface Rest {
  /** The fade's drawn opacity, and the share of its shadow the bar is keeping (they are one number). */
  fade: number
  bar: number
  scrollTop: number
  /** The header's top against the line under the bar (0 = on the line), and whether it is open. */
  offLine: number
  open: boolean
  /** The header's own shadow strength. */
  headerShade: number
  /** The distance over which an edge's shadow comes on (the app's --shade-ramp), in pixels. */
  ramp: number
}

const scroller = (page: Page) => page.locator('#appScroll')
const header = (page: Page, i: number) => page.locator('[data-guide] .guide-head').nth(i)

const read = (page: Page, head: Locator): Promise<Rest> =>
  head.evaluate((h) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--shade-ramp)'
    document.body.appendChild(probe)
    const ramp = probe.getBoundingClientRect().height
    probe.remove()
    return {
      fade: Number(getComputedStyle(document.querySelector('.doc-fade-top')!).opacity),
      bar: Number(
        document.querySelector<HTMLElement>('.htp-sticky-bar')!.style.getPropertyValue('--shade'),
      ),
      scrollTop: sc.scrollTop,
      offLine: h.getBoundingClientRect().top - line,
      open: h.getAttribute('aria-expanded') === 'true',
      headerShade: Number((h as HTMLElement).style.getPropertyValue('--shade')),
      ramp,
    }
  })

// Scroll the page so `head` sits `below` pixels under the line (0 = on it).
const place = (head: Locator, below: number) =>
  head.evaluate((h, below) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    sc.scrollTop += h.getBoundingClientRect().top - line - below
  }, below)

// The page at rest: the value has been reached, and looking again changes nothing — a real one-pixel
// scroll there and back makes every tracker re-read the page, and they must come to the same answer.
async function atRest(page: Page, head: Locator, want: Partial<Rest>, what: string): Promise<Rest> {
  await expect.poll(async () => (await read(page, head)).fade, what).toBe(want.fade)
  await settled(page)
  const first = await read(page, head)
  for (const nudge of [1, -1]) {
    await scroller(page).evaluate((sc, by) => (sc.scrollTop += by), nudge)
    await settled(page)
  }
  const again = await read(page, head)
  expect(again, `${what}: the same after the page is looked at again`).toEqual(first)
  expect(first, what).toMatchObject(want)
  // One number for the two cues about the bar's edge: the fade is drawn as the bar's shadow is.
  expect(first.fade, `${what}: the fade and the bar's shadow agree`).toBe(first.bar)
  return first
}

for (const [width, height] of [
  [390, 844],
  [1280, 800],
]) {
  test(`at ${width}×${height}: off with nothing scrolled, on over a closed header on the line, off under an open docked header, and on again once that header is closed`, async ({
    page,
  }) => {
    await openApp(page, { viewport: { width, height } })
    await switchMode(page, 'guide')
    // A section far enough down the page that reaching it scrolls past the fade's ramp.
    const head = header(page, 5)
    await expect(head).toHaveAttribute('aria-expanded', 'false')

    // Nothing scrolled: nothing is under the bar.
    await atRest(page, head, { fade: 0, scrollTop: 0 }, 'at the top of the page')

    // A CLOSED header resting exactly on the line.
    await place(head, 0)
    const closed = await atRest(page, head, { fade: 1, open: false }, 'a closed header on the line')
    // (Put there by this test's own scrolling, and a scroll position is a whole number of pixels:
    // "on the line" is to the nearest one. A header the APP holds there, below, is held exactly.)
    expect(Math.abs(closed.offLine), 'the closed header is on the line').toBeLessThan(1)
    expect(closed.scrollTop, 'the page is scrolled past the fade’s ramp').toBeGreaterThan(
      closed.ramp,
    )
    expect(closed.headerShade, 'a closed header casts no shadow').toBe(0)

    // The same header OPEN and docked: opened from a little under the line, then the section
    // scrolled well under it.
    await place(head, 120)
    await head.click()
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    await settled(page)
    await place(head, 0)
    await scroller(page).evaluate((sc) => (sc.scrollTop += 200))
    const docked = await atRest(
      page,
      head,
      { fade: 0, open: true },
      'an open header docked on the line',
    )
    expect(Math.abs(docked.offLine), 'the open header is held on the line').toBeLessThan(SAME_PX)
    expect(docked.headerShade, 'the docked header wears the shadow instead').toBe(1)

    // Closed from its docked header: it is left on the line, closed, and the fade is the page's again.
    await head.click()
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    const reclosed = await atRest(page, head, { fade: 1, open: false }, 'the header closed again')
    // (To the nearest pixel again: with the section gone, where the header rests is a scroll position.)
    expect(Math.abs(reclosed.offLine), 'it is left on the line').toBeLessThan(1)
    expect(reclosed.headerShade).toBe(0)
  })
}
