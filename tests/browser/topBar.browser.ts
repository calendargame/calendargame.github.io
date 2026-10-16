// THE TOP BAR ON A NARROW SCREEN — the owner's rule for when the row runs out of room
// (src/main.tsx's budget block above the bar): the Preset button never goes below its arrows plus
// one digit — the bare number "1", the last form a stock name steps down to — and the Mode button
// gives way instead, its name cut with an "…". Nothing changes where there is room (320 wide and
// up on this lane's fonts): there the Mode button is its own list's width and its name whole.
//
// Below ~292px the Mode button used to be drawn over the right end of the Preset button, and at
// 240 the ⚙ ran off the edge of the screen.
import {
  test,
  expect,
  openApp,
  resizeTo,
  rectOf,
  switchMode,
  topBar,
  SAME_PX,
  type Rect,
} from './support/app'
import type { Page } from '@playwright/test'

// The bar's four controls, as drawn: the logo, the Preset and Mode buttons, and the ⚙.
const controls = async (page: Page) => {
  const bar = topBar(page)
  return {
    logo: await rectOf(page.locator('header svg').first()),
    preset: await rectOf(bar.preset),
    mode: await rectOf(bar.mode),
    gear: await rectOf(bar.settings),
  }
}

// Is the text on show in a button cut — is anything in the label on show wider than its box?
const cut = (button: ReturnType<typeof topBar>['mode']) =>
  button
    .locator('[aria-hidden="false"]')
    .evaluate((label) =>
      [label, ...label.querySelectorAll('*')].some(
        (el) => !el.closest('.sr-only') && el.scrollWidth > el.clientWidth,
      ),
    )

test('from 240 to 320 wide: nothing in the bar overlaps, nothing leaves the screen, and the Preset button keeps room for a "1"', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openApp(page, { viewport: { width: 320, height: 800 } })
  // The Mode button's own width where there is room: its list's width.
  const full = (await rectOf(topBar(page).mode)).width
  let gaveWay = 0
  for (let width = 240; width <= 320; width += 2) {
    await resizeTo(page, width, 800)
    const at = `at ${width}px`
    const { logo, preset, mode, gear } = await controls(page)
    const order: [string, Rect][] = [
      ['logo', logo],
      ['Preset', preset],
      ['Mode', mode],
      ['⚙', gear],
    ]
    for (let i = 1; i < order.length; i++) {
      const [leftName, left] = order[i - 1]
      const [rightName, right] = order[i]
      expect(left.right, `${at}: ${leftName} runs into ${rightName}`).toBeLessThanOrEqual(
        right.left + SAME_PX,
      )
    }
    expect(logo.left, `${at}: the logo is on screen`).toBeGreaterThanOrEqual(0)
    expect(gear.right, `${at}: the ⚙ is on screen`).toBeLessThanOrEqual(width + SAME_PX)
    // The one preset there is is "Preset 1", which a narrow bar draws as "1" — whole.
    // (The cell's first child is what is drawn; a short form's full name is spoken beside it.)
    await expect(
      topBar(page).preset.locator('[aria-hidden="false"] [data-preset-name-cell] > :first-child'),
      at,
    ).toHaveText(/^(Preset 1|P1|1)$/)
    expect(await cut(topBar(page).preset), `${at}: the preset's name is cut`).toBe(false)
    if (mode.width < full - SAME_PX) gaveWay++
  }
  // The sweep reached widths where the Mode button had to give way…
  expect(gaveWay, 'widths where the Mode button gave way').toBeGreaterThan(0)
  // …and where it does, its longest name is cut with an ellipsis, inside the button.
  await resizeTo(page, 240, 800)
  await switchMode(page, 'guide')
  expect(await cut(topBar(page).mode), 'How to Play, at 240px').toBe(true)
  const label = topBar(page).mode.locator('[aria-hidden="false"]')
  expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
  const { preset, mode, gear } = await controls(page)
  expect(preset.right).toBeLessThanOrEqual(mode.left + SAME_PX)
  expect(mode.right).toBeLessThanOrEqual(gear.left + SAME_PX)
})

test('from 320 wide up, the Mode button is its own list’s width and shows its name whole', async ({
  page,
}) => {
  await openApp(page, { viewport: { width: 320, height: 800 } })
  for (const width of [320, 360, 390, 480, 800]) {
    await resizeTo(page, width, 800)
    const mode = topBar(page).mode
    expect(await cut(mode), `at ${width}px: the mode name is cut`).toBe(false)
    // Its list, opened, is the button's width (the Mode button is pinned to its list's width).
    const button = await rectOf(mode)
    await mode.click()
    const list = page.getByRole('listbox', { name: 'Mode' })
    await expect(list).toBeVisible()
    expect(Math.abs((await rectOf(list)).width - button.width), `at ${width}px`).toBeLessThan(
      SAME_PX,
    )
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  }
})
