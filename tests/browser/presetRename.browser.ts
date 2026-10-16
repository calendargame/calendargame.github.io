// LEAVING A NAME BOX BY BACK OR ESCAPE (Q17) — what becomes of a name typed into Manage Presets'
// rename box when the box is left without Enter or a tap elsewhere:
//   • BACK (Android's Back button, a browser's Back, a back-swipe) KEEPS IT, exactly as leaving the
//     box any other way does, and then closes the popup — Back is "leave", and a name typed and
//     then silently thrown away is the defect this replaced. A name the device has no room to
//     save is refused as any other way of leaving refuses it: the popup STAYS, with the note
//     under the row, and the next Back closes it.
//   • ESCAPE THROWS IT AWAY and the popup stays — the desktop convention for an edit, and what
//     How to Play has always said ("Esc throws it away"); a second Escape closes the popup.
// The lane drives Back as the browser's own history step (page.goBack), which is what each of
// those gestures is to a web page.
import { test, expect, openApp, openPresetManager, topBar } from './support/app'
import { expectStockNameShown } from './support/presetNameCells'
import type { Page } from '@playwright/test'

const savedNames = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('cg-presets-v1')
    return raw && (JSON.parse(raw).state.presets as { name: string }[]).map((p) => p.name)
  })

// The name cell the top bar's control is showing (it holds every preset's; the one on show is not
// aria-hidden), and the words drawn in it.
const nameCellInBar = (page: Page) =>
  topBar(page).preset.locator('[aria-hidden="false"] [data-preset-name-cell]')
const shownInBar = (page: Page) => nameCellInBar(page).locator('> :first-child')

test('Back with a name typed in the box keeps the name, and closes the popup', async ({ page }) => {
  await openApp(page)
  const dialog = await openPresetManager(page)
  const box = dialog.getByRole('textbox', { name: 'Preset name' })
  await box.click()
  await box.fill('Evenings')
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(shownInBar(page)).toHaveText('Evenings')
  expect(await savedNames(page)).toEqual(['Evenings'])
  // The ⚙ menu under it is still open: one Back closed one thing.
  await expect(page.locator('#settings-popover')).toBeVisible()
})

test('Escape with a name typed in the box throws it away, and leaves the popup open', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openPresetManager(page)
  const box = dialog.getByRole('textbox', { name: 'Preset name' })
  await box.click()
  await box.fill('Evenings')
  await page.keyboard.press('Escape')
  await expect(box).toHaveValue('Preset 1')
  await expect(box).not.toBeFocused()
  await expect(dialog).toBeVisible()
  expect(await savedNames(page)).toBeNull() // nothing was ever saved
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Back with a name too big for the device to save: refused as any way of leaving the box refuses it — the popup stays, with the note', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openPresetManager(page)
  const box = dialog.getByRole('textbox', { name: 'Preset name' })
  // A device with little room left: one that refuses any save of more than 100,000 characters,
  // as a browser does when its allowance for this site is all but used. (A name bigger than a
  // whole allowance cannot be typed in every engine: WebKit's text boxes hold 524,288 characters,
  // and its allowance is more.)
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (value.length > 100_000) throw new DOMException('no room', 'QuotaExceededError')
      return setItem.call(this, key, value)
    }
  })
  await box.click()
  await box.fill('n'.repeat(200_000))
  await page.goBack()
  await expect(
    dialog
      .getByText('This device has no room to save that name, so it was not changed.', {
        exact: true,
      })
      .and(page.locator('[aria-hidden="true"]')),
  ).toBeVisible()
  await expect(box).toHaveValue('Preset 1')
  await expect(box).not.toBeFocused()
  expect(await savedNames(page)).toBeNull()
  // The Back was spent on the news; the next one closes the popup, and the ⚙ menu is still there.
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#settings-popover')).toBeVisible()
  await expectStockNameShown(page, nameCellInBar(page), 'Preset 1')
})
