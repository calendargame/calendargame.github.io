// THE ▲▼ ON A LIST BUTTON, THE ▼ ON A HOW TO PLAY SECTION TITLE, AND THE ✓ ON A LIST'S CHOSEN ROW ARE
// FOR THE EYE ALONE (Round 26 review: a screen reader read "▲ ▼" after every list button). What each
// says is already said to a screen reader — aria-haspopup and aria-expanded on the buttons,
// aria-selected on the row — so the glyphs are hidden from it. Checked in the tree Chromium itself
// hands a screen reader (its debugging protocol; WebKit's Playwright build has no counterpart), on
// every screen that draws one: the top bar, an open list, How to Play, and Manage Presets.
import { test, expect, openApp, openPresetManager, switchMode, topBar } from './support/app'
import type { Page } from '@playwright/test'

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'the accessibility tree is read through Chromium’s DevTools',
)

// Every name or text a screen reader is given that holds one of the glyphs.
async function glyphsSpoken(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: { ignored: boolean; name?: { value?: string } }[]
  }
  await cdp.detach()
  return nodes
    .filter((n) => !n.ignored && /[▲▼✓]/.test(n.name?.value ?? ''))
    .map((n) => n.name!.value!)
}

test('no glyph that is only decoration is read out', async ({ page }) => {
  await openApp(page)
  expect(await glyphsSpoken(page), 'the top bar').toEqual([])
  await topBar(page).mode.click()
  await expect(page.getByRole('listbox', { name: 'Mode' })).toBeVisible()
  expect(await glyphsSpoken(page), 'an open list, its chosen row').toEqual([])
  // …and the chosen row still says it is chosen.
  await expect(page.getByRole('option', { selected: true })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await switchMode(page, 'guide')
  expect(await glyphsSpoken(page), 'How to Play').toEqual([])
  await expect(
    page.getByRole('button', { name: 'What Is Calendar Game?', exact: true }),
  ).toBeVisible()
  await switchMode(page, 'classic')
  await openPresetManager(page)
  expect(await glyphsSpoken(page), 'Manage Presets').toEqual([])
})
