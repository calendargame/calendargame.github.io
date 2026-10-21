// THE "NOT IN EFFECT" LOOK, AND THE YEAR RANGE ROW (Round 26, Q7 and its sweep).
//   • CONTRAST: a ⚙ setting not in effect is drawn STRIPED — a hatched housing, the chosen option
//     tinted instead of filled — with its text at full strength, because it is still a control a
//     player uses (the faded look, opacity .6, fails 4.5:1 in the two light themes, and stays only
//     for what cannot be used). Measured from the colours the browser resolved, in all five themes:
//     the chosen option's label on its tint, an unchosen option's label, and a Year Range box's
//     year — each at least 4.5:1 against what is really behind it.
//   • NO RING BUT THE KEYBOARD'S: the chosen option of a striped setting is shown by its tint alone,
//     the same in every striped setting at every moment — at rest, after taps, and after the
//     keyboard has gone — and the only ring any of its options wears is the keyboard focus ring,
//     on the one the keyboard is on, while the keyboard is in use. (The owner's iPhone, v2.30.2:
//     the chosen option wore a 1px accent ring that the focus rule took away from whichever option
//     a tap had just focused, so Date Format's choice was ringed while Rotate Dots' was not.)
//   • THE YEAR RANGE ROW: four boxes, two pairs, one row, at the sizes where it is tightest — 360 and
//     375 wide and tall enough that the WIDTH sets the root size (360×860, 375×860), a folding
//     phone's cover (280×653), the root at its 12px floor (320×568), the largest phone (430×932),
//     and 360 and 390 wide from 800 to 956 tall. The four share one top, none of them cuts "10000" or
//     "11582", nothing scrolls sideways, and the row is the same height with Julian on and off.
// Resting values only: Reduce Motion is on for the lane.
import {
  test,
  expect,
  openApp,
  openSettings,
  resizeTo,
  rectOf,
  settled,
  THEMES,
} from './support/app'
import { SAME_PX, expectPageNotWiderThanWindow } from './support/app'
import type { Locator, Page } from '@playwright/test'

// The WCAG contrast of an element's text against what is drawn behind it: every background from
// the element out to the first opaque one, painted in order onto one pixel, then the text colour
// over that — so a see-through text colour and a see-through tint are both counted as they show.
// (Painting on a canvas also resolves any colour syntax the browser reports.)
const contrastOf = (target: Locator) =>
  target.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.canvas.width = ctx.canvas.height = 1
    const alphaOf = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data[3]
    }
    // A not-in-effect housing is hatched (index.css's .tray-dormant): text that crosses a hatch line
    // has that line behind it, so the line is counted as a layer too — the harder of the two cases.
    const layers: string[] = []
    for (let n: Element | null = el; n; n = n.parentElement) {
      const hatch = n.classList.contains('tray-dormant')
        ? getComputedStyle(n).getPropertyValue('--dormant-hatch').trim()
        : ''
      if (hatch) layers.unshift(hatch)
      const bg = getComputedStyle(n).backgroundColor
      if (alphaOf(bg) === 0) continue
      layers.unshift(bg)
      if (alphaOf(bg) === 255) break
    }
    ctx.clearRect(0, 0, 1, 1)
    for (const c of layers) {
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
    }
    const bg = [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    const fg = [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  })

for (const theme of THEMES)
  test(`${theme}: the text of a setting not in effect reads at 4.5:1 or more`, async ({ page }) => {
    // Factory settings: Input on Buttons puts Rotate Dots out of effect, and Julian on puts the
    // Julian-off Year Range pair out of use.
    await openApp(page, { theme })
    const panel = await openSettings(page)
    const rotate = panel.getByRole('radiogroup', { name: 'Rotate Dots' })
    const chosen = rotate.getByRole('radio', { checked: true })
    const other = rotate.getByRole('radio', { checked: false }).first()
    const box = panel.getByRole('textbox', { name: 'Latest Year, Julian Off' })
    await expect(chosen).toHaveClass(/pill-dormant-on/) // the look this measures, not another
    await expect(box).toHaveClass(/tray-dormant/)
    const figures = {
      chosen: await contrastOf(chosen),
      unchosen: await contrastOf(other),
      yearBox: await contrastOf(box),
    }
    test.info().annotations.push({
      type: 'contrast',
      description: `${theme}: chosen ${figures.chosen.toFixed(2)}, unchosen ${figures.unchosen.toFixed(2)}, year box ${figures.yearBox.toFixed(2)}`,
    })
    for (const [what, ratio] of Object.entries(figures))
      expect(ratio, `${theme}: ${what}`).toBeGreaterThanOrEqual(4.5)
    // ★ AND IT LOOKS NOT IN EFFECT (Round 26 review: the two Year Range pairs barely differed): the
    // pair not in use is hatched, the pair in use is not, and nothing hatches a live box.
    const live = panel.getByRole('textbox', { name: 'Latest Year, Julian On' })
    const hatched = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(await hatched(box), `${theme}: the pair not in use`).toMatch(/repeating-linear-gradient/)
    expect(await hatched(live), `${theme}: the pair in use`).toBe('none')
  })

// The options of a striped setting that wear a ring of any kind — a visible outline (one whose
// colour is see-through draws nothing: that is index.css's :focus rule) or a box shadow — by name.
const ringedIn = (group: Locator) =>
  group.getByRole('radio').evaluateAll((radios) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.canvas.width = ctx.canvas.height = 1
    const shows = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data[3] > 0
    }
    return radios
      .filter((el) => {
        const cs = getComputedStyle(el)
        const outline =
          cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && shows(cs.outlineColor)
        return outline || cs.boxShadow !== 'none'
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent)
  })

test.describe('a striped setting’s options', () => {
  test.use({ hasTouch: true })
  for (const theme of THEMES)
    test(`${theme}: no ring but the keyboard's — at rest, after taps, after the keyboard has gone`, async ({
      page,
    }) => {
      // Random Format on puts Date Format out of effect (on Classic, where the app opens), and the
      // factory Input, Buttons, puts Rotate Dots out of effect: two striped settings at once.
      await openApp(page, { theme, seed: { settings: { randomFormat: true } } })
      const panel = await openSettings(page)
      const format = panel.getByRole('radiogroup', { name: 'Date Format' })
      const rotate = panel.getByRole('radiogroup', { name: 'Rotate Dots' })
      const groups = { 'Date Format': format, 'Rotate Dots': rotate }
      for (const group of Object.values(groups))
        await expect(group.getByRole('radio', { checked: true })).toHaveClass(/pill-dormant-on/)
      const rings = async (page: Page, when: string, keyboardOn: string[] = []) => {
        await settled(page)
        const seen = (await Promise.all(Object.values(groups).map(ringedIn))).flat()
        expect(seen, `${theme}, ${when}: the options wearing a ring`).toEqual(keyboardOn)
      }
      await rings(page, 'at rest')
      // A tap, on the target brought to the middle of the menu's list first: the bottom of the list
      // runs under the pinned foot, and a touch there lands on the foot's side of the edge.
      const tap = async (target: Locator) => {
        await target.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await settled(page)
        await target.tap()
      }
      // A tap on another option chooses it, and focuses it (components/PillTray).
      await tap(rotate.getByRole('radio', { name: '90° CCW' }))
      await expect(rotate.getByRole('radio', { name: '90° CCW' })).toBeChecked()
      await rings(page, 'after a tap in Rotate Dots')
      await tap(format.getByRole('radio', { name: 'Written DMY' }))
      await expect(format.getByRole('radio', { name: 'Written DMY' })).toBeChecked()
      await rings(page, 'after a tap in Date Format')
      // A tap on the option already chosen: focus moves, nothing else changes.
      await tap(rotate.getByRole('radio', { name: '90° CCW' }))
      await rings(page, 'after a tap on the chosen option')
      // The keyboard: an arrow walks the choice along, and the option it lands on wears the ring.
      await page.keyboard.press('ArrowLeft')
      await expect(rotate.getByRole('radio', { name: '45° CCW' })).toBeChecked()
      await rings(page, 'with the keyboard on 45° CCW', ['45° CCW'])
      // …and a tap puts it away, wherever the tap lands: on an option, or on the menu's own text.
      await tap(format.getByRole('radio', { name: 'Written MDY' }))
      await rings(page, 'after the keyboard, a tap on an option')
      await page.keyboard.press('ArrowRight')
      await expect(format.getByRole('radio', { name: 'Written DMY' })).toBeChecked()
      await rings(page, 'with the keyboard on Written DMY', ['Written DMY'])
      await tap(panel.getByText('Rotate Dots', { exact: true }))
      await rings(page, 'after the keyboard, a tap on a label')
    })
})

const ROW_SIZES: [number, number][] = [
  [360, 860],
  [375, 860],
  [280, 653],
  [320, 568],
  [430, 932],
  ...[800, 844, 900, 956].flatMap((h): [number, number][] => [
    [360, h],
    [390, h],
  ]),
]
const FONTS = [null, 'serif', 'monospace'] as const
const BOX_NAMES = [
  'Earliest Year, Julian Off',
  'Latest Year, Julian Off',
  'Earliest Year, Julian On',
  'Latest Year, Julian On',
]

// The year's own width, set as the box sets it — its family, size, weight, and figures (a canvas
// cannot be told to use tabular figures, so the text is laid out) — against the room inside its
// padding.
const fitOf = (box: Locator) =>
  box.evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el)
    const span = document.createElement('span')
    span.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;white-space:pre'
    for (const p of [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'fontStretch',
      'fontVariantNumeric',
      'fontFeatureSettings',
      'letterSpacing',
    ] as const)
      span.style[p] = cs[p]
    span.textContent = el.value
    document.body.append(span)
    const need = span.getBoundingClientRect().width
    span.remove()
    // (From the box's own float width: clientWidth is whole pixels, and would under-count.)
    const room =
      el.getBoundingClientRect().width -
      ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight']
        .map((p) => parseFloat(cs[p as 'paddingLeft']))
        .reduce((a, b) => a + b, 0)
    return { text: el.value, need, room }
  })

for (const font of FONTS)
  test(`the Year Range row: four boxes on one line, no year cut, nothing sideways, one height with Julian on or off — ${font ?? "the machine's own font"}`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    // The widest years each pair can hold: 10000 with Julian off, 11582 with it on.
    await openApp(page, {
      seed: {
        settings: { minY: 10000, maxY: 10000 },
        julianRange: { julianMinY: 11582, julianMaxY: 11582 },
      },
    })
    if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
    const panel = await openSettings(page)
    const boxes = BOX_NAMES.map((name) => panel.getByRole('textbox', { name }))
    if (font) expect(await boxes[0].evaluate((el) => getComputedStyle(el).fontFamily)).toBe(font)
    const julian = panel.getByRole('button', { name: 'Julian Calendar (pre-Oct 15, 1582)' })
    // box → its cell → its pair's boxes → the pair → the row
    const row = boxes[0].locator('xpath=../../../..')
    for (const [width, height] of ROW_SIZES) {
      await resizeTo(page, width, height)
      const at = `at ${width}×${height}`
      const tops = await Promise.all(boxes.map(async (b) => (await rectOf(b)).top))
      for (const t of tops)
        expect(Math.abs(t - tops[0]), `${at}: the four boxes' tops`).toBeLessThanOrEqual(SAME_PX)
      for (const [i, b] of boxes.entries()) {
        const fit = await fitOf(b)
        expect(fit.text).toBe(i < 2 ? '10000' : '11582')
        expect(
          fit.need,
          `${at}: "${fit.text}" in box ${i + 1} (${fit.room.toFixed(1)}px of room)`,
        ).toBeLessThanOrEqual(fit.room)
      }
      await expectPageNotWiderThanWindow(page)
      const onHeight = (await rectOf(row)).height
      await julian.click()
      await settled(page)
      expect(
        Math.abs((await rectOf(row)).height - onHeight),
        `${at}: the row's height, Julian off vs on`,
      ).toBeLessThanOrEqual(SAME_PX)
      await julian.click()
      await settled(page)
    }
  })

// WHAT GIVES WAY when four boxes cannot fit one row (a font or a text size far wider than any the
// app was drawn in — here the boxes' text at two and a half times its size): the row wraps, the
// Julian On pair under the Julian Off one, each pair whole on its line — and still no year is cut
// and nothing scrolls sideways.
test('the Year Range row: where four boxes cannot fit one row, each pair goes whole onto a line of its own', async ({
  page,
}) => {
  await openApp(page, {
    seed: {
      settings: { minY: 10000, maxY: 10000 },
      julianRange: { julianMinY: 11582, julianMaxY: 11582 },
    },
  })
  // The boxes and their sizers (each box's cell holds both), and nothing else.
  await page.addStyleTag({
    content: `#settings-popover span:has(> input[aria-label*=", Julian O"]) > *{font-size:2.5em !important}`,
  })
  const panel = await openSettings(page)
  const boxes = BOX_NAMES.map((name) => panel.getByRole('textbox', { name }))
  for (const [width, height] of [
    [360, 800],
    [390, 844],
  ] as [number, number][]) {
    await resizeTo(page, width, height)
    const at = `at ${width}×${height}`
    const r = await Promise.all(boxes.map((b) => rectOf(b)))
    expect(
      Math.abs(r[0].top - r[1].top),
      `${at}: Julian Off's two boxes share a line`,
    ).toBeLessThanOrEqual(SAME_PX)
    expect(
      Math.abs(r[2].top - r[3].top),
      `${at}: Julian On's two boxes share a line`,
    ).toBeLessThanOrEqual(SAME_PX)
    expect(r[2].top, `${at}: Julian On's pair is under Julian Off's`).toBeGreaterThan(r[0].bottom)
    for (const b of boxes) {
      const fit = await fitOf(b)
      expect(
        fit.need,
        `${at}: "${fit.text}" (${fit.room.toFixed(1)}px of room)`,
      ).toBeLessThanOrEqual(fit.room)
    }
    await expectPageNotWiderThanWindow(page)
  }
})
