// THE PRESET LIST THE TOP BAR OPENS: exactly as wide as its button — or, where the button is
// narrower than a row can be, the least a row may be — and a name has the same room in a row
// whether or not the list has a scrollbar that takes room.
//
// components/CustomSelect measures all of it (the trigger, a hidden least-row, the scrollbar's own
// width) and jsdom has no widths to measure; round 25 proved it by hand at four window sizes, with
// Chromium's scrollbars both hidden and classic. These are those proofs.
import {
  test,
  expect,
  openApp,
  resizeTo,
  settled,
  topBar,
  expectPageNotWiderThanWindow,
  SAME_PX,
} from './support/app'
import { presetsNamed } from './support/seeds'
import { defaultPresetName } from '../../src/store/presets'
import type { Page } from '@playwright/test'

const stockPresets = (count: number) =>
  presetsNamed(...Array.from({ length: count }, (_, i) => defaultPresetName(i + 1)))

interface OpenList {
  window: number
  /** The button's width, the least a row may be (as measured, before rounding up), the list's. */
  trigger: number
  leastRow: number
  panel: { left: number; right: number; width: number }
  /** The button's own edges: the list hangs from one of them. */
  triggerEdges: { left: number; right: number }
  rows: number
  /** Distinct row widths and name-cell widths in the open list — one of each, if rows agree. */
  rowWidths: number[]
  cellWidths: number[]
  /** The name cell of the hidden copy the app measures a closed list by. */
  gaugeCell: number
  scrolls: boolean
  /** The room the scrollbar takes from the list, and what the app has recorded it as. */
  scrollbar: number
  scrollbarRecorded: string
  /** How far the list can be pushed sideways (after trying): always nothing. */
  sideways: number
  overflowsSideways: number
}

async function openList(page: Page) {
  const { preset } = topBar(page)
  await preset.click()
  await expect(page.getByRole('listbox', { name: 'Preset' })).toBeVisible()
  await settled(page)
}

const measure = (page: Page): Promise<OpenList> =>
  topBar(page).preset.evaluate((trigger) => {
    const wrap = trigger.parentElement!
    const panel = document.querySelector('[role="listbox"]')!
    const list = panel.querySelector<HTMLElement>('[data-drag-scroll]')!
    const rows = [...list.querySelectorAll('[role="option"]')]
    const widths = (els: Element[]) => [
      ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().width * 100) / 100)),
    ]
    list.scrollLeft = 50
    const sideways = list.scrollLeft
    list.scrollLeft = 0
    const box = panel.getBoundingClientRect()
    const edges = wrap.getBoundingClientRect()
    return {
      window: window.innerWidth,
      trigger: edges.width,
      leastRow: wrap.querySelector('[data-select-least-row]')!.getBoundingClientRect().width,
      panel: { left: box.left, right: box.right, width: box.width },
      triggerEdges: { left: edges.left, right: edges.right },
      rows: rows.length,
      rowWidths: widths(rows),
      cellWidths: widths(rows.map((row) => row.querySelector('[data-preset-name-cell]')!)),
      gaugeCell: wrap
        .querySelector('[data-select-row-gauge] [data-preset-name-cell]')!
        .getBoundingClientRect().width,
      scrolls: list.scrollHeight > list.clientHeight,
      scrollbar: list.offsetWidth - list.clientWidth,
      scrollbarRecorded: list.style.getPropertyValue('--scrollbar-w'),
      sideways,
      overflowsSideways: list.scrollWidth - list.clientWidth,
    }
  })

// From the narrowest phone there is (a folded one, 280 wide — there the button is narrower than a
// row can be) up to a desktop.
const WIDTHS = [280, 300, 320, 344, 360, 390, 430, 768, 1280]

test('the list is its button’s width, or the least a row may be, whichever is more — and stays inside the window', async ({
  page,
}) => {
  await openApp(page, { seed: { presets: stockPresets(3) } })
  const seen = { buttonWide: false, rowWide: false }
  for (const width of WIDTHS) {
    await resizeTo(page, width, 844)
    await openList(page)
    const m = await measure(page)
    const at = `at ${width}px`
    expect(m.rows, `${at}: the seeded presets are listed`).toBe(3)
    // The least is the measured row, rounded up to a whole pixel (CustomSelect's listWidth).
    const least = Math.ceil(m.leastRow)
    expect(Math.abs(m.panel.width - Math.max(m.trigger, least)), `${at}: list width`).toBeLessThan(
      SAME_PX,
    )
    if (least > m.trigger) seen.rowWide = true
    else seen.buttonWide = true
    // It hangs from its button: one edge is the button's, and it never leaves the window.
    expect(
      Math.min(
        Math.abs(m.panel.left - m.triggerEdges.left),
        Math.abs(m.panel.right - m.triggerEdges.right),
      ),
      `${at}: an edge shared with the button`,
    ).toBeLessThan(SAME_PX)
    expect(m.panel.left, `${at}: left edge in the window`).toBeGreaterThanOrEqual(0)
    expect(m.panel.right, `${at}: right edge in the window`).toBeLessThanOrEqual(m.window)
    // One row shape: every row is one width, and so is every name's cell.
    expect(m.rowWidths, `${at}: row widths`).toHaveLength(1)
    expect(m.cellWidths, `${at}: name-cell widths`).toHaveLength(1)
    expect(m.overflowsSideways, `${at}: wider inside than out`).toBeLessThanOrEqual(0)
    expect(m.sideways, `${at}: can be pushed sideways`).toBe(0)
    await expectPageNotWiderThanWindow(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  // Both halves of the rule were met: a button wide enough, and one too narrow for a row.
  expect(seen).toEqual({ buttonWide: true, rowWide: true })
})

test('the list follows its button while it is open', async ({ page }) => {
  await openApp(page, { seed: { presets: stockPresets(3) } })
  await openList(page)
  const before = await measure(page)
  await resizeTo(page, 430, 844)
  await expect(page.getByRole('listbox', { name: 'Preset' })).toBeVisible()
  const after = await measure(page)
  expect(after.trigger, 'the button is wider in a wider window').toBeGreaterThan(before.trigger)
  expect(Math.abs(after.panel.width - after.trigger)).toBeLessThan(SAME_PX)
  expect(Math.abs(after.panel.left - after.triggerEdges.left)).toBeLessThan(SAME_PX)
})

// ── Under a scrollbar that takes room ────────────────────────────────────────────────────────
//
// @classic-scrollbar: this also runs in the Chromium project whose scrollbars take room
// (playwright.config.ts). In the other two the scrollbar is drawn over the content, and the same
// assertions hold with nothing to push against.
for (const [width, height] of [
  [390, 420],
  [1280, 420],
]) {
  test(
    `a list long enough to scroll gives a name the room it has without a scrollbar, at ${width}×${height}`,
    {
      tag: '@classic-scrollbar',
    },
    async ({ page, newDevice }, testInfo) => {
      await openApp(page, { viewport: { width, height }, seed: { presets: stockPresets(14) } })
      await openList(page)
      const scrolling = await measure(page)
      expect(scrolling.rows).toBe(14)
      expect(scrolling.scrolls, 'the list is longer than the window, so it scrolls').toBe(true)
      // In the project this test exists for, the scrollbar must really be taking room — or the
      // assertions below have met nothing.
      if (testInfo.project.name === 'chromium-classic-scrollbar')
        expect(scrolling.scrollbar, 'the scrollbar takes room in this project').toBeGreaterThan(0)
      // The app has the scrollbar's real width on record: it is what the rows give back.
      expect(scrolling.scrollbarRecorded).toBe(`${scrolling.scrollbar}px`)

      // The list is still its button's width, cannot be pushed sideways, and every row is one shape.
      expect(Math.abs(scrolling.panel.width - scrolling.trigger)).toBeLessThan(SAME_PX)
      expect(scrolling.overflowsSideways).toBeLessThanOrEqual(0)
      expect(scrolling.sideways).toBe(0)
      expect(scrolling.rowWidths).toHaveLength(1)
      expect(scrolling.cellWidths).toHaveLength(1)
      // A name has the room in a scrolling row that the closed list was measured to have…
      expect(Math.abs(scrolling.cellWidths[0] - scrolling.gaugeCell)).toBeLessThan(SAME_PX)

      // …and the room it has in a list short enough not to scroll at all: the same window on a
      // device with three presets. (Not the same list in a taller window — the root font follows
      // the window's height, so every width on the page would differ for that reason alone.)
      const other = await newDevice()
      await openApp(other, { viewport: { width, height }, seed: { presets: stockPresets(3) } })
      await openList(other)
      const still = await measure(other)
      expect(still.rows).toBe(3)
      expect(still.scrolls, 'three rows do not scroll').toBe(false)
      expect(still.scrollbar).toBe(0)
      expect(still.scrollbarRecorded).toBe('0px')
      expect(Math.abs(still.cellWidths[0] - scrolling.cellWidths[0])).toBeLessThan(SAME_PX)
      // The scrollbar's room comes out of the row and of nothing else: the row is narrower by
      // exactly that much, and the name's cell reaches back across it.
      expect(
        Math.abs(still.rowWidths[0] - scrolling.rowWidths[0] - scrolling.scrollbar),
      ).toBeLessThan(SAME_PX)
      expect(Math.abs(still.panel.width - scrolling.panel.width)).toBeLessThan(SAME_PX)
    },
  )
}
