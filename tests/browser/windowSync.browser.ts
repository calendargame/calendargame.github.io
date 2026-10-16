// windowSync — TWO WINDOWS OF THE APP ON ONE DEVICE, IN A REAL BROWSER (design-q1-q2.md v4, 2.7 and
// 6.2): what one window saves reaches the other through the browser's own `storage` event and the
// windows-in-sync door, with no reload — the part jsdom cannot show, since there the events are
// delivered by hand.
import { test, expect, openApp, openSecondWindow, openSettings } from './support/app'

test('a theme chosen in one window is worn by the other at once, both ways', async ({
  page,
  context,
}) => {
  await openApp(page, { theme: 'midnight' })
  const second = await openSecondWindow(context)
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'midnight')
  const panel = await openSettings(second)
  await panel.getByRole('radio', { name: 'Nebula', exact: true }).click()
  await second.keyboard.press('Escape')
  // The first window was not touched, and not reloaded: it wears the other window's choice.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nebula')
  // …and back the other way, from the first window this time.
  const first = await openSettings(page)
  await first.getByRole('radio', { name: 'Dusk', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dusk')
})
