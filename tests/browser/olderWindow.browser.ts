// olderWindow — A WINDOW OF THE OLDER VERSION BESIDE A WINDOW OF THIS ONE, ON ONE DEVICE (design-q1-q2.md
// v4, 14.4 (14)). The older build is the one live while this one was made (support/oldSite), served at
// `old/` on the same origin, so the two share every saved key exactly as a tab left open across an
// update and a tab of the new version do. The older build knows nothing of the windows-in-sync door: it writes its whole copy of a doc
// from what it loaded. What this build's window promises in front of one (section 2.1) is what is
// asserted here:
//   G6 - with a new window awake and holding the newest version, an older page's stale copy or its
//        appended answers never cost a new answer;
//   G2 - a new window's write never brings back what a Reset or a Clear removed;
//   G3 - a new window's write never replaces a setting a player chose with one chosen earlier, and an
//        older window's own change stands (section 16, decision 1);
//   G4 - once both have heard everything, a new window holds what the device holds (the older window
//        catches up when it is reloaded).
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  openApp,
  appReady,
  answerRight,
  answerRightOld,
  openOlderWindow,
  openSettings,
  openPresetManager,
  switchMode,
} from './support/app'

// Look a date up on the Lookup page, written the way its box asks for (its example says which order).
async function lookUp(p: Page, [y, m, d]: string[]) {
  const box = p.locator('input[placeholder^="e.g.,"]:visible')
  const example = (await box.getAttribute('placeholder')) ?? ''
  const text = example.includes('/')
    ? `${m}/${d}/${y}`
    : example.includes('.')
      ? `${d}.${m}.${y}`
      : `${y}-${m}-${d}`
  await box.fill(text)
  await box.press('Enter')
}
const score = (p: Page) => p.locator('.panel:visible [data-statval]').first()
const next = (p: Page) =>
  p.getByRole('button', { name: 'New', exact: true }).and(p.locator(':visible')).click()
// One more right answer in this build's window. Another window's change can replace the question
// here, and for 300 ms after that a press answers nothing (lib/unaskedSwap) - so a press is repeated
// until the score shows it.
const answerUntil = (p: Page, shown: string) =>
  expect(async () => {
    await answerRight(p)
    await expect(score(p)).toHaveText(shown, { timeout: 500 })
  }).toPass()

// ⚠ The older window opens AFTER the new one's first save, so what it loads carries the door's sync
// data: G6's case. One that opened before any new window had saved the mode holds a copy no window can
// date - residual R4 (design 2.8): its copy stands, and the new window's answers in that mode since
// are lost. That case is the design's, not asserted here.
test('G6: an older window’s answer is added to a newer window’s, and the newer one’s are never lost', async ({
  page,
  context,
}) => {
  await openApp(page)
  await answerUntil(page, '1/1')
  const old = await openOlderWindow(context)
  await expect(score(old)).toHaveText('1/1')
  // Two more answers in the new window. The older one does not hear of them: it still shows 1/1.
  await next(page)
  await answerUntil(page, '2/2')
  await next(page)
  await answerUntil(page, '3/3')
  await expect(score(old)).toHaveText('1/1')
  // One answer in the older window: it writes its whole copy - two answers - over the device's three.
  await answerRightOld(old)
  await expect(score(old)).toHaveText('2/2')
  // The new window keeps its three and adds the older window's one, and puts all four on the device.
  await expect(score(page)).toHaveText('4/4')
  await old.reload()
  await appReady(old)
  await expect(score(old)).toHaveText('4/4')
})

test('G2: a Reset in a newer window is not undone by an older window that played from before it', async ({
  page,
  context,
}) => {
  await openApp(page)
  for (const shown of ['1/1', '2/2', '3/3']) {
    if (shown !== '1/1') await next(page)
    await answerUntil(page, shown)
  }
  const old = await openOlderWindow(context)
  await expect(score(old)).toHaveText('3/3')
  await page.getByRole('button', { name: 'Reset Stats' }).and(page.locator(':visible')).click()
  await page
    .getByRole('dialog', { name: 'Reset Stats?' })
    .getByRole('button', { name: 'Reset Stats' })
    .click()
  await expect(score(page)).toHaveText('0/0')
  // The older window answers on top of the three it loaded, and writes all four.
  await answerRightOld(old)
  await expect(score(old)).toHaveText('4/4')
  // The three the Reset removed never come back to the new window - whether the older window's one
  // answer is carried is the design's to decide (R8), so either count is right, and nothing above it.
  await next(page)
  await expect(async () => {
    await answerRight(page)
    await expect(score(page)).toHaveText(/^(1\/1|2\/2)$/, { timeout: 500 })
  }).toPass()
  const shown = await score(page).textContent()
  await old.reload()
  await appReady(old)
  await expect(score(old)).toHaveText(shown!)
})

test('G3: a setting chosen in a newer window stands over an older window’s stale copy, and the older window’s own change stands too', async ({
  page,
  context,
}) => {
  await openApp(page, { theme: 'midnight' })
  const old = await openOlderWindow(context)
  await expect(old.locator('html')).toHaveAttribute('data-theme', 'midnight')
  // The new window chooses Nebula; the older one does not hear of it.
  let panel = await openSettings(page)
  await panel.getByRole('radio', { name: 'Nebula', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(old.locator('html')).toHaveAttribute('data-theme', 'midnight')
  // The older window turns Save Stats off, and writes its whole copy - Midnight and all.
  const oldPanel = await openSettings(old)
  await oldPanel.getByRole('button', { name: 'Save Stats' }).click()
  await expect(oldPanel.getByRole('button', { name: 'Save Stats' })).toHaveText('Off')
  await old.keyboard.press('Escape')
  // The new window keeps Nebula, and takes Save Stats off from the older window.
  panel = await openSettings(page)
  await expect(panel.getByRole('button', { name: 'Save Stats' })).toHaveText('Off')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nebula')
  await page.keyboard.press('Escape')
  await old.reload()
  await appReady(old)
  await expect(old.locator('html')).toHaveAttribute('data-theme', 'nebula')
})

test('G2: a Lookup history cleared in a newer window stays cleared when an older window that held it looks something up', async ({
  page,
  context,
}) => {
  await openApp(page)
  await switchMode(page, 'lookup')
  await lookUp(page, ['1776', '7', '4'])
  await lookUp(page, ['1969', '7', '20'])
  await expect(page.locator('.lookup-history-header')).toHaveText(/History \(2\)/)
  const old = await openOlderWindow(context)
  await switchMode(old, 'lookup')
  await expect(old.locator('.lookup-history-header')).toHaveText(/History \(2\)/)
  await page.getByRole('button', { name: 'Clear History' }).click()
  await expect(page.getByText('No lookups yet')).toBeVisible()
  // The older window looks a third date up, and writes its list - the two cleared ones with it.
  await lookUp(old, ['2000', '1', '1'])
  await expect(old.locator('.lookup-history-header')).toHaveText(/History \(3\)/)
  // The new window has the third date and only it.
  await expect(page.locator('.lookup-history-header')).toHaveText(/^History\s*Clear History$/)
  await old.reload()
  await appReady(old)
  await switchMode(old, 'lookup')
  await expect(old.locator('.lookup-history-header')).toHaveText(/^History\s*Clear History$/)
})

test('a preset deleted in a newer window stays deleted while an older window that listed it plays on', async ({
  page,
  context,
}) => {
  await openApp(page)
  let manager = await openPresetManager(page)
  await manager.getByRole('button', { name: 'New Preset' }).click()
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const old = await openOlderWindow(context)
  manager = await openPresetManager(page)
  // (a preset nothing was ever saved in goes without a question)
  await manager.getByRole('button', { name: 'Delete Preset 2' }).click()
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // The older window plays in preset 1; it still lists preset 2.
  await answerRightOld(old)
  await expect(score(old)).toHaveText('1/1')
  await expect(score(page)).toHaveText('1/1')
  manager = await openPresetManager(page)
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(1)
  await old.reload()
  await appReady(old)
  manager = await openPresetManager(old)
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(1)
})
