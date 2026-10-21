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
import { THEMES } from './support/seeds'

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
      // The header's natural spot is its card's top: it draws the card's top border itself.
      depth: h.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
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

// A DOCKED HEADER IS THE TOP OF ITS CARD (the owner's rule, Round 28: "as far up as it can go
// without any of the top border getting cut off" — the card's rounded top edge, full border and
// corners, resting just under the bar, with nothing showing through the corners, and keeping that
// look while the section scrolls beneath it). index.css's .guide-sec says how the card is drawn.
//
// Asserted as RELATIONS between pictures taken at rest on the one machine:
//   • THE TOP OF ITS CARD: the header on the line with its section's text scrolled 200px up beneath
//     it is the very same picture, pixel for pixel, as the same header on the same line with nothing
//     beneath it at all — the section's own top, just arrived there. A square corner, a border cut
//     off by the bar, or a missing one makes the two differ. The docked header's SHADOW is the one
//     thing meant to differ (lib/guideDock's rule: it is on once text is under the header), so for
//     this picture it is set to nothing, exactly as the header wears it before any text is under it.
//   • NOTHING SHOWS THROUGH: docked, the header is the same picture whether the text beneath it is
//     there or not, its shadow and all.
//   • THE CARD'S BOTTOM CLOSES OVER IT: with the header carried up by its section's end — its
//     square bottom down in the card's last radius — the card's two bottom corners are the same
//     pictures as when the header is far up the screen and only the panel's empty foot is there:
//     rounded, with the page beyond the curve. Each picture is of the corner's own square (a radius
//     wide, a radius and the border's row tall), and the two are taken at whole-pixel scroll
//     positions of one layout, so the corner lands on the same fraction of a pixel in both. They
//     may differ by 2/255 in a channel and no more: Chromium blends the foot's coats over a header
//     in a layer of its own and over the panel in the page's, and one pixel half outside the card's
//     edge comes out a level apart between the two. That is a rounding, not a picture.
// The ▼ turns over when a section opens or closes, so it is masked out of every picture.

// The header's own box on screen, the line under the bar, and its card's bottom.
const box = (page: Page, i: number) =>
  head(page, i).evaluate((h) => {
    const sc = document.getElementById('appScroll')!
    const line =
      sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).getPropertyValue('--bar-h'))
    const r = h.getBoundingClientRect()
    const w = h.parentElement!.getBoundingClientRect()
    return { line, x: r.left, y: r.top, width: r.width, height: r.height, cardBottom: w.bottom }
  })

type Clip = { x: number; y: number; width: number; height: number }
type Box = Awaited<ReturnType<typeof box>>

// The card's two bottom corners, each its own square: a radius wide, a radius and a pixel tall.
const corners = async (page: Page, i: number, b: Box) => {
  const r = await head(page, i).evaluate((h) => parseFloat(getComputedStyle(h).borderTopLeftRadius))
  const y = b.cardBottom - r - 1
  return Promise.all([
    page.screenshot({ clip: { x: b.x, y, width: r, height: r + 1 } }),
    page.screenshot({ clip: { x: b.x + b.width - r, y, width: r, height: r + 1 } }),
  ])
}

// The page's own colour, and the colour of one pixel of a picture, both as [r, g, b] as drawn.
const pageColour = (page: Page) =>
  page.evaluate(() => {
    const g = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    g.fillStyle = getComputedStyle(document.documentElement).backgroundColor
    g.fillRect(0, 0, 1, 1)
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  })
const pixelOf = (page: Page, png: Buffer, x: number, y: number) =>
  page.evaluate(
    async ([base64, x, y]) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const g = canvas.getContext('2d', { willReadFrequently: true })!
      g.drawImage(bitmap, 0, 0)
      return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]
    },
    [png.toString('base64'), x, y] as const,
  )

// How many pixels of two same-sized pictures differ by more than `over` (0-255) in any channel.
// Decoded by the page itself, so the lane needs no image library of its own.
const differingPixels = (page: Page, a: Buffer, b: Buffer, over: number) =>
  page.evaluate(
    async ([a, b, over]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const g = canvas.getContext('2d', { willReadFrequently: true })!
        g.drawImage(bitmap, 0, 0)
        return g.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [p, q] = [await pixels(a), await pixels(b)]
      if (p.length !== q.length) return Infinity
      let n = 0
      for (let k = 0; k < p.length; k += 4)
        if (Math.max(...[0, 1, 2].map((c) => Math.abs(p[k + c] - q[k + c]))) > over) n++
      return n
    },
    [a.toString('base64'), b.toString('base64'), over] as const,
  )
const picture = (page: Page, i: number, clip: Clip) =>
  page.screenshot({ clip, mask: [head(page, i).locator('[aria-hidden="true"]')] })

// The panel's text, there or not — nothing else on the page moves.
const showText = (page: Page, i: number, shown: boolean) =>
  page
    .locator('[data-guide] .guide-sec')
    .nth(i)
    .locator('[id^="guide-panel-"]')
    .evaluate((p, shown) => ((p as HTMLElement).style.visibility = shown ? '' : 'hidden'), shown)

for (const theme of THEMES)
  for (const width of [320, 390, 768, 1280])
    test(`${theme}, ${width}px: docked, a header is the top of its card — and carried out, the card's bottom closes under it`, async ({
      page,
    }) => {
      await openApp(page, { theme, viewport: { width, height: 800 } })
      await switchMode(page, 'guide')
      const i = 5
      await place(page, i, 120)
      await head(page, i).click()
      await expect(head(page, i)).toHaveAttribute('aria-expanded', 'true')
      await atRest(page)

      // Just arrived: the header's natural spot a fraction above the line, so the stick holds it ON
      // the line with nothing under it (less than a pixel down its section: no shadow either).
      await place(page, i, -0.5)
      await atRest(page)
      const arrived = await box(page, i)
      expect(Math.abs(arrived.y - arrived.line), 'on the line').toBeLessThanOrEqual(0.5)
      expect((await read(page, i)).depth, 'nothing under it yet').toBeLessThan(1)
      const clip = { x: arrived.x, y: arrived.y, width: arrived.width, height: arrived.height }
      const top = await picture(page, i, clip)
      // …whose corners, beyond the curve, are the page: a pixel in from each top corner of the
      // header's box is well outside the card's rounded corner (a radius in, diagonally, is not).
      const page0 = await pageColour(page)
      expect(await pixelOf(page, top, 1, 1), 'the page beyond the top-left corner').toEqual(page0)
      expect(
        await pixelOf(page, top, Math.floor(clip.width) - 2, 1),
        'the page beyond the top-right corner',
      ).toEqual(page0)

      // Docked, with 200px of the section's text scrolled up beneath it.
      await page.locator('#appScroll').evaluate((sc) => (sc.scrollTop += 200))
      await atRest(page)
      const docked = await box(page, i)
      expect(Math.abs(docked.y - arrived.y), 'held on the line').toBeLessThan(SAME_PX)
      expect((await read(page, i)).depth, 'text under it').toBeGreaterThan(150)
      const withText = await picture(page, i, clip)
      await showText(page, i, false)
      await settled(page)
      expect(await picture(page, i, clip), 'nothing shows through it').toEqual(withText)
      await showText(page, i, true)
      await head(page, i).evaluate((h) => (h as HTMLElement).style.setProperty('--shade', '0'))
      await settled(page)
      expect(await picture(page, i, clip), 'the same picture: the top of its card').toEqual(top)

      // The panel's empty foot, the header far up the screen: the card's bottom 300px under the line.
      await page
        .locator('#appScroll')
        .evaluate(
          (sc, by) => (sc.scrollTop += Math.round(by)),
          docked.cardBottom - docked.line - 300,
        )
      await atRest(page)
      const far = await box(page, i)
      expect(far.cardBottom - (far.y + far.height), 'the header well away').toBeGreaterThan(200)
      const farCorners = await corners(page, i, far)

      // Carried up by its section's end: scrolled a little past the point where the section's last
      // pixel arrives under the header, so the stick holds the header at its section's floor.
      await page
        .locator('#appScroll')
        .evaluate(
          (sc, by) => (sc.scrollTop += Math.round(by) + 2),
          far.cardBottom - far.y - far.height,
        )
      await atRest(page)
      const carried = await box(page, i)
      expect(
        carried.cardBottom - (carried.y + carried.height),
        'the header at its section’s floor: the border’s row below it, and no more',
      ).toBeCloseTo(1, 1)
      const carriedCorners = await corners(page, i, carried)
      const r = await head(page, i).evaluate((h) =>
        parseFloat(getComputedStyle(h).borderTopLeftRadius),
      )
      expect(
        await pixelOf(page, carriedCorners[0], 1, Math.floor(r) - 1),
        'the page beyond the bottom-left corner, the header’s square one under it',
      ).toEqual(page0)
      expect(
        await pixelOf(page, carriedCorners[1], Math.floor(r) - 2, Math.floor(r) - 1),
        'the page beyond the bottom-right corner',
      ).toEqual(page0)
      for (const side of [0, 1] as const)
        expect(
          await differingPixels(page, farCorners[side], carriedCorners[side], 2),
          `the ${side ? 'right' : 'left'} bottom corner: the card's, over the header`,
        ).toBe(0)
    })
