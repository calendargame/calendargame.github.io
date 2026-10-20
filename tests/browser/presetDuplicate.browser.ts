// DUPLICATE PRESET (Round 26, Q5), in a real browser: the Duplicate button beside New Preset opens a
// list of the presets over the Manage Presets popup, a choice makes a copy DIRECTLY AFTER its
// original, and the list of presets scrolls to show it — however far down a long list it lands.
import {
  test,
  expect,
  openApp,
  openPresetManager,
  rectOf,
  resizeTo,
  settled,
  SAME_PX,
} from './support/app'
import { presetsNamed } from './support/seeds'

test('a copy lands right under its original, and a long list scrolls to show it', async ({
  page,
}) => {
  const names = Array.from({ length: 24 }, (_, i) => `Practice ${i + 1}`)
  await openApp(page, { seed: { presets: presetsNamed(...names) } })
  const dialog = await openPresetManager(page)
  const boxes = dialog.getByRole('textbox', { name: 'Preset name' })
  const list = boxes.first().locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  await expect(boxes).toHaveCount(24)

  const button = dialog.getByRole('button', { name: 'Duplicate' })
  await button.click()
  const menu = page.getByRole('listbox', { name: 'Preset to duplicate' })
  await expect(menu).toBeVisible()
  // The list hangs over the popup, and its rows can be reached and pressed there.
  const choice = menu.getByRole('option', { name: 'Practice 22' })
  await choice.scrollIntoViewIfNeeded()
  await choice.click()
  await expect(menu).toHaveCount(0)
  await expect(boxes).toHaveCount(25)
  await expect(boxes.nth(22)).toHaveValue('Practice 22 (2)')
  await expect(boxes.nth(23)).toHaveValue('Practice 23')
  await settled(page)
  // The copy is on screen inside the list's own box — which had to scroll to show it.
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const [row, region] = await Promise.all([rectOf(boxes.nth(22)), rectOf(list)])
  expect(row.top).toBeGreaterThanOrEqual(region.top - SAME_PX)
  expect(row.bottom).toBeLessThanOrEqual(region.bottom + SAME_PX)
  // The preset you are on is still the first: a copy is not a switch.
  await expect(
    page.locator('header').getByRole('button', { name: /^Preset, Practice 1\b/ }),
  ).toBeVisible()
})

// ★ THE LIST STAYS ON SCREEN, INSIDE THE APP'S SIDE GUTTER (1rem, the top bar's own inset), in any
// font and at any width. It is as wide as its longest name and hangs from the Duplicate button —
// which sits in the right half of its row — so a long name once sent it off the left edge of the
// screen (21px at 320 wide). components/CustomSelect's LIST_GUTTER_REM.
for (const font of [null, 'serif', 'monospace'] as const) {
  test(`the Duplicate list stays inside the side gutter at every width (${font ?? 'the app font'})`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const long = 'A rather long preset name for practising the hardest dates of all'
    await openApp(page, { seed: { presets: presetsNamed('Preset 1', long, 'Speed') } })
    if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
    for (const [width, height] of [
      [280, 653],
      [320, 568],
      [360, 780],
      [390, 844],
      [430, 932],
    ]) {
      await resizeTo(page, width, height)
      const dialog = await openPresetManager(page)
      const button = dialog.getByRole('button', { name: 'Duplicate' })
      await button.click()
      const menu = page.getByRole('listbox', { name: 'Preset to duplicate' })
      await expect(menu).toBeVisible()
      await settled(page)
      const at = `${width}×${height}`
      const [list, trigger, gutter] = await Promise.all([
        rectOf(menu),
        rectOf(button),
        page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
      ])
      expect(list.left, `${at}: the list's left edge`).toBeGreaterThanOrEqual(gutter - SAME_PX)
      expect(width - list.right, `${at}: the list's right edge`).toBeGreaterThanOrEqual(
        gutter - SAME_PX,
      )
      // Where there is room it still hangs from its button's right edge.
      if (list.width <= trigger.right - gutter)
        expect(Math.abs(list.right - trigger.right), `${at}: hangs from its button`).toBeLessThan(
          SAME_PX,
        )
      // The long name is in it, cut short only if the screen is too narrow for it whole.
      await expect(menu.getByRole('option', { name: long })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('#settings-popover')).toHaveCount(0)
    }
  })
}
