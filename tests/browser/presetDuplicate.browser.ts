// DUPLICATE PRESET (Round 26, Q5), in a real browser: the Duplicate button beside New Preset opens a
// list of the presets over the Manage Presets popup, a choice makes a copy DIRECTLY AFTER its
// original, and the list of presets scrolls to show it — however far down a long list it lands.
import { test, expect, openApp, openPresetManager, rectOf, settled, SAME_PX } from './support/app'
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
