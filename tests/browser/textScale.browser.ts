// TEXT THAT USED TO BE FIXED PIXELS, NOW ON THE ROOT'S SCALE (Round 26, Q9): How to Play's body,
// small print, ▼, and <kbd> chips, the ⚙ menu's two heading tiers, and the card's number. Each is written as N rem ÷
// 16.458 — N px exactly at the 16.458px root of a 390×844 phone, where it was tuned, and the same
// share of the root everywhere else.
//   • At 390×844 each is the size it was, to the pixel; at a phone on its side (a 12px root) each is
//     the same share of the smaller root — "scales" measured, not read off a class.
//   • And the rows those sizes sit in still hold, at every window from 320 to 460 wide (and a tablet
//     and a desktop, where the root is largest), as they are and with the converted text a tenth
//     wider (a wider font: the iPhone's is, Round 25 measured ~7.5% over this laptop's): no ⚙ heading
//     breaks onto a second line, and no How to Play section runs out sideways.
// Round 25's pixel-to-rem change grew text on bigger phones and broke a row fitted to the old size
// (the ⚙ foot); the sweeps here are what would have caught that.
// (Lookup's history rows are converted too, and fitted to their room in the device's font: their
// sweep, in three fonts at every phone width, is tests/browser/lookupRows.)
import {
  test,
  expect,
  openApp,
  openSettings,
  resizeTo,
  settled,
  switchMode,
  SAME_PX,
} from './support/app'
import type { Locator } from '@playwright/test'

const STANDARD_ROOT = 16.458

const SIZES: [number, number][] = [
  ...[320, 340, 360, 375, 390, 414, 430, 440, 460].flatMap((w): [number, number][] =>
    [568, 700, 844, 956].map((h): [number, number] => [w, h]),
  ),
  [768, 1024],
  [1280, 1000],
]
const FACTORS = [1, 1.1]
const label = (width: number, height: number, factor: number) =>
  `at ${width}×${height}${factor === 1 ? '' : `, text ×${factor}`}`

const fontPx = (target: Locator) =>
  target.evaluate((el) => ({
    size: parseFloat(getComputedStyle(el).fontSize),
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
  }))

test('each converted size is its old pixel size on a standard phone, and the same share of a smaller root', async ({
  page,
}) => {
  await openApp(page, { viewport: { width: 390, height: 844 } })
  const guide = page.locator('[data-guide]')
  const sites: [what: string, target: () => Locator, px: number][] = [
    ['How to Play body', () => guide.locator('[id^="guide-panel-"]').first(), 13],
    [
      'How to Play small print',
      () => guide.getByText(/^Settings changes apply when you/).first(),
      12,
    ],
    ['How to Play ▼', () => guide.locator('.guide-head > span:last-child').first(), 7],
    ['a <kbd> chip', () => guide.locator('kbd').first(), 11],
    // The card's number ("Q12"), read off the room its corner keeps — set in the number's own type
    // (components/CardNumber's sizer), and there whether or not the number is showing.
    [
      'the card number',
      () => page.locator('.date-line').first().locator('xpath=preceding-sibling::span[1]'),
      11,
    ],
  ]
  const card = page.locator('#settings-popover')
  const panelSites: typeof sites = [
    ['⚙ group heading', () => card.getByText('Global', { exact: true }), 11],
    ['⚙ section heading', () => card.getByText('Display', { exact: true }), 10],
  ]
  for (const [width, height] of [
    [390, 844],
    [568, 320],
  ]) {
    await resizeTo(page, width, height)
    await openSettings(page)
    for (const [what, target, px] of [...panelSites, ...sites]) {
      const { size, root } = await fontPx(target())
      expect(root, `${what}: the window has the root it was chosen for`).toBeCloseTo(
        width === 390 ? STANDARD_ROOT : 12,
        2,
      )
      expect(size, `${what} at ${width}×${height}`).toBeCloseTo((px * root) / STANDARD_ROOT, 2)
    }
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
  }
})

test('every ⚙ heading is one line inside its box, at any window, as it is and a tenth wider', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await openApp(page)
  const panel = await openSettings(page)
  for (const factor of FACTORS)
    for (const [width, height] of SIZES) {
      await resizeTo(page, width, height)
      const at = label(width, height, factor)
      // The headings are the panel's uppercase labels: the two group headings, the three section
      // headings, and the captions over a picker's families.
      const found = await panel.evaluate((card, factor) => {
        const els = [...card.querySelectorAll<HTMLElement>('div, span')].filter(
          (el) =>
            getComputedStyle(el).textTransform === 'uppercase' &&
            el.children.length === 0 &&
            (el.textContent ?? '').trim() !== '',
        )
        return els.map((el) => {
          el.style.fontSize = ''
          if (factor !== 1)
            el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * factor}px`
          const range = document.createRange()
          range.selectNodeContents(el)
          const text = range.getBoundingClientRect()
          const box = el.getBoundingClientRect()
          return {
            label: el.textContent!.trim(),
            lines: range.getClientRects().length,
            textLeft: text.left - box.left,
            textRight: text.right - box.right,
          }
        })
      }, factor)
      expect(found.map((f) => f.label)).toEqual(
        expect.arrayContaining(['Global', 'Per-preset', 'Display', 'Dates', 'Stats']),
      )
      for (const f of found) {
        expect(f.lines, `${at}: "${f.label}" on one line`).toBe(1)
        expect(f.textLeft, `${at}: "${f.label}" inside its box`).toBeGreaterThanOrEqual(-SAME_PX)
        expect(f.textRight, `${at}: "${f.label}" inside its box`).toBeLessThanOrEqual(SAME_PX)
      }
    }
})

test('no How to Play section runs out sideways, at the narrowest and widest phones, as it is and a tenth wider', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await openApp(page)
  await switchMode(page, 'guide')
  const heads = page.locator('[data-guide] .guide-head')
  const count = await heads.count()
  expect(count).toBeGreaterThan(10)
  for (const factor of FACTORS)
    for (const [width, height] of [
      [320, 956],
      [320, 568],
      [460, 956],
    ]) {
      await resizeTo(page, width, height)
      const at = label(width, height, factor)
      for (let i = 0; i < count; i++) {
        const head = heads.nth(i)
        if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
        await expect(head).toHaveAttribute('aria-expanded', 'true')
        const body = page.locator(`#${await head.getAttribute('aria-controls')}`)
        // The body's own size and every <kbd> in it: the converted sizes, a tenth wider.
        await body.evaluate((el, factor) => {
          for (const e of [el, ...el.querySelectorAll<HTMLElement>('kbd')]) {
            e.style.fontSize = ''
            if (factor !== 1)
              e.style.fontSize = `${parseFloat(getComputedStyle(e).fontSize) * factor}px`
          }
        }, factor)
        await settled(page)
        const over = await body.evaluate((el) => {
          const box = el.getBoundingClientRect()
          const out: string[] = []
          for (const e of el.querySelectorAll<HTMLElement>('*')) {
            const r = e.getBoundingClientRect()
            if (r.width === 0) continue
            if (r.right > box.right + 0.05 || r.left < box.left - 0.05)
              out.push(`${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 40)}"`)
          }
          return { out, scroll: el.scrollWidth - el.clientWidth }
        })
        expect(over.out, `${at}: section ${i + 1}`).toEqual([])
        expect(over.scroll, `${at}: section ${i + 1} scrolls sideways`).toBeLessThanOrEqual(0)
      }
    }
})
