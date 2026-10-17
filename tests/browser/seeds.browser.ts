// THE LANE'S OWN SEEDS, HELD TO THE APP. support/seeds writes saved data by hand so a test can open
// the app on a device that already holds something; three facts in it are spelled there rather than
// imported (the stores keep them private): each save's `version`, the sessionStorage keys of a
// session under way, and how a Best's configuration key is put together. This file makes the real
// app write each of them and compares — so the day the app changes one, this fails, by name,
// instead of every other test in the lane quietly measuring a screen its seed never reached.
import {
  test,
  expect,
  openApp,
  openSettings,
  openPresetManager,
  switchMode,
  answerRight,
} from './support/app'
import { PRESET_REGISTRY_KEY, PRESET_STORE_KEYS } from '../../src/store/presets'
import {
  SAVED_VERSION,
  SESSION_KEYS,
  blitzBestKey,
  moxBestKey,
  type AppSeed,
} from './support/seeds'
import type { Page } from '@playwright/test'

const saved = (page: Page, key: string) =>
  page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    return raw === null
      ? null
      : (JSON.parse(raw) as { state: Record<string, unknown>; version: number })
  }, key)

test('every save the lane seeds carries the version the app writes today', async ({ page }) => {
  await openApp(page)
  // Make each store save: a ⚙ switch (settings), a mode's own toggle (the per-mode setup), a new
  // preset (the list of presets), an answer (progress — an open writes nothing: design-q1-q2.md v4
  // G7, and the stats a screen mounts on are the ones saved — made first, while Save Stats is on).
  await answerRight(page)
  const panel = await openSettings(page)
  await panel.getByRole('button', { name: 'Save Stats' }).click()
  await page.keyboard.press('Escape')
  const manager = await openPresetManager(page)
  await manager.getByRole('button', { name: 'New Preset' }).click()
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('#settings-popover')).toHaveCount(0)
  await switchMode(page, 'aox')
  await page.getByRole('button', { name: 'Allow Mistakes' }).and(page.locator(':visible')).click()

  for (const [store, key] of [
    ['settings', PRESET_STORE_KEYS.settings],
    // (the Julian-on Year Range: pinned by the app on its first open of the preset)
    ['julianRange', PRESET_STORE_KEYS.julianRange],
    ['modePrefs', PRESET_STORE_KEYS.modePrefs],
    ['progress', PRESET_STORE_KEYS.progress],
    ['presets', PRESET_REGISTRY_KEY],
  ] as const) {
    await expect.poll(() => saved(page, key), `the app saved its ${store}`).not.toBeNull()
    expect((await saved(page, key))!.version, `${store}: support/seeds SAVED_VERSION`).toBe(
      SAVED_VERSION[store],
    )
  }
})

test('a session under way is recorded under the keys the lane seeds', async ({ page }) => {
  await openApp(page)
  const session = await page.evaluate(() => ({ ...window.sessionStorage }))
  expect(session[SESSION_KEYS.browsingSession]).toBe('1')
  expect(JSON.parse(session[SESSION_KEYS.amnesic])).toEqual({ 1: 'off' })
})

test('a seeded Amnesic value is the one the app opens on', async ({ page }) => {
  await openApp(page, { seed: { amnesic: { 1: 'full' } } })
  const panel = await openSettings(page)
  await expect(
    panel.getByRole('radiogroup', { name: 'Amnesic' }).getByRole('radio', { name: 'Full' }),
  ).toBeChecked()
})

test('a MoX Best is filed under the key the lane spells', async ({ page }) => {
  const seed: AppSeed = { modePrefs: { aoxN: '2' } }
  await openApp(page, { seed })
  await switchMode(page, 'aox')
  await page.getByRole('button', { name: 'Begin' }).and(page.locator(':visible')).click()
  const bests = async () =>
    Object.keys(((await saved(page, PRESET_STORE_KEYS.progress))?.state.aoxBest ?? {}) as object)
  await answerRight(page)
  await answerRight(page)
  await expect.poll(bests).toEqual([moxBestKey(seed)])
})

test('a Blitz Best is filed under the key the lane spells', async ({ page }) => {
  // The round is a minute long, so the test owns the clock and winds it on instead of waiting.
  await page.clock.install()
  await openApp(page)
  await switchMode(page, 'blitz')
  await page.getByRole('button', { name: 'Begin' }).and(page.locator(':visible')).click()
  await answerRight(page)
  await expect(page.locator('[data-statval]:visible').first()).toHaveText('1/1')
  await page.clock.fastForward(61_000)
  const bests = async () =>
    Object.keys(((await saved(page, PRESET_STORE_KEYS.progress))?.state.blitzBest ?? {}) as object)
  await expect.poll(bests).toEqual([blitzBestKey()])
})
