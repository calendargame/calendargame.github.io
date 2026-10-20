// amnesicClose — AMNESIC'S FORGET, AT THE APP'S CLOSE, IN A REAL BROWSER (design-amnesic-close.md 2;
// store/amnesicClose). What jsdom cannot show: real Web Locks, held by real documents and let go when a
// window is closed with no event to anyone. Every window of the app open together is one session; the
// close is every one of them gone; a reload is not one; and the forget runs before the next window draws
// anything - so the first thing it shows is the score as it stood when Amnesic was turned on.
import { test, expect, openApp, openSecondWindow, openSettings, answerRight } from './support/app'
import type { BrowserContext, Page } from '@playwright/test'

const score = (p: Page) => p.locator('.panel:visible [data-statval]').first()
// (a window's question is drawn again when the other's answers come in, and for 300 ms after that a press
// answers nothing - windowSync's cue test - so a press is repeated until it counts)
const answerUntil = (p: Page, shown: string) =>
  expect(async () => {
    await answerRight(p)
    await expect(score(p)).toHaveText(shown, { timeout: 500 })
  }).toPass()
const setAmnesic = async (p: Page, label: string) => {
  const panel = await openSettings(p)
  await panel
    .getByRole('radiogroup', { name: 'Amnesic' })
    .getByRole('radio', { name: label })
    .click()
  await p.keyboard.press('Escape')
}
// Another window opened on the device after every window was closed: a new tab, nothing seeded.
const openAfterClose = (context: BrowserContext) => openSecondWindow(context)

test('Full: what both windows played is forgotten when the last one closes — not before, and not on a reload', async ({
  page,
  context,
}) => {
  await openApp(page)
  await answerUntil(page, '1/1') // before the switch-on: kept
  await setAmnesic(page, 'Full')
  await answerUntil(page, '2/2')
  const second = await openSecondWindow(context)
  await expect(score(second)).toHaveText('2/2') // one pool: the first window's play is here
  await answerUntil(second, '3/3')
  await expect(score(page)).toHaveText('3/3')
  // A reload is not a close, and nor is closing one of two windows.
  await second.reload()
  await expect(score(second)).toHaveText('3/3')
  await page.close()
  const third = await openSecondWindow(context)
  await expect(score(third)).toHaveText('3/3')
  // Every window gone: the next one opens on the score from before the switch-on.
  await second.close()
  await third.close()
  const after = await openAfterClose(context)
  await expect(score(after)).toHaveText('1/1')
  // …and the preset is still on Full: a setting.
  const panel = await openSettings(after)
  await expect(
    panel.getByRole('radiogroup', { name: 'Amnesic' }).getByRole('radio', { checked: true }),
  ).toHaveText('Full')
})

test('Off at the close keeps everything, whatever was on before', async ({ page, context }) => {
  await openApp(page)
  await setAmnesic(page, 'Stats Only')
  await answerUntil(page, '1/1')
  await setAmnesic(page, 'Off')
  await page.close()
  const after = await openAfterClose(context)
  await expect(score(after)).toHaveText('1/1')
})

// A RELOAD OF THE ONLY WINDOW is no close: the browser's own navigation entry says `reload`
// (store/amnesicClose's `reloaded`), whatever the tab kept. And the same tab going to the app's address
// again - a navigation, not a reload, with every window of the app gone - is a cold open.
test('Full: reloading the only window forgets nothing; opening the address again in it does', async ({
  page,
}) => {
  await openApp(page)
  await answerUntil(page, '1/1')
  await setAmnesic(page, 'Full')
  await answerUntil(page, '2/2')
  await page.reload()
  await expect(score(page)).toHaveText('2/2')
  await page.goto('about:blank') // (the app's only document gone: every window of it closed)
  await page.goBack() // (back to the app's address: the page loads again, with its sessionStorage)
  await expect(score(page)).toHaveText('1/1')
})
