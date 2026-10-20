// THE LANE'S OWN PROMISES, TESTED. Every other file here leans on what support/app.ts says about
// the world a test runs in; if one of these stopped being true, their results would mean something
// else without a single one of them failing.
import {
  test,
  expect,
  openApp,
  openSecondWindow,
  openSettings,
  THEMES,
  type Theme,
} from './support/app'
import { PRESET_STORE_KEYS } from '../../src/store/presets'
import type { Page } from '@playwright/test'

const world = (page: Page) =>
  page.evaluate(async () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    serviceWorkers: (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
  }))

const FIXED_WORLD = {
  width: 390,
  height: 844,
  pixelRatio: 1,
  reducedMotion: true,
  dark: true,
  timeZone: 'America/Los_Angeles',
  language: 'en-US',
  serviceWorkers: 0,
}

test('every test starts in one fixed world, and so does a second device', async ({
  page,
  newDevice,
}) => {
  await openApp(page)
  expect(await world(page)).toEqual(FIXED_WORLD)
  const other = await newDevice()
  await openApp(other)
  expect(await world(other)).toEqual(FIXED_WORLD)
})

test('the app is served under the address it was built for, and every file it asks for arrives', async ({
  page,
  baseURL,
}) => {
  const failed: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
  })
  await openApp(page)
  expect(page.url()).toBe(baseURL)
  expect(failed).toEqual([])
})

for (const theme of THEMES) {
  test(`openApp opens on the ${theme} theme when asked`, async ({ page }) => {
    await openApp(page, { theme })
    // openApp has already checked the page's own attribute; this is the ⚙ menu agreeing.
    const panel = await openSettings(page)
    const label = theme[0].toUpperCase() + theme.slice(1)
    await expect(panel.getByRole('radio', { name: label, exact: true })).toBeChecked()
  })
}

test('a second window shares the first one’s saved data and has its own session', async ({
  page,
  context,
}) => {
  const theme: Theme = 'nebula'
  await openApp(page, { theme, seed: { amnesic: { 1: 'full' } } })
  const second = await openSecondWindow(context)
  // The same device: the theme the first window has saved is the second window's too.
  await expect(second.locator('html')).toHaveAttribute('data-theme', theme)
  expect(
    await second.evaluate((key) => window.localStorage.getItem(key), PRESET_STORE_KEYS.settings),
  ).toBe(await page.evaluate((key) => window.localStorage.getItem(key), PRESET_STORE_KEYS.settings))
  // The Amnesic value is one of the preset's settings, so the second window is on Full too
  // (design-q1-q2.md v4, 9)…
  const amnesic = async (p: Page) => {
    const panel = await openSettings(p)
    return panel.getByRole('radiogroup', { name: 'Amnesic' }).getByRole('radio', { checked: true })
  }
  await expect(await amnesic(page)).toHaveText('Full')
  await expect(await amnesic(second)).toHaveText('Full')
  // …and its session is its own: what the first window keeps for its browsing session is not in it.
  await page.evaluate(() => window.sessionStorage.setItem('lane-first-window', '1'))
  expect(await second.evaluate(() => window.sessionStorage.getItem('lane-first-window'))).toBeNull()
})

test('a reload finds what the app saved, not the seed again', async ({ page }) => {
  await openApp(page, { theme: 'midnight' })
  const panel = await openSettings(page)
  await panel.getByRole('radio', { name: 'Nebula', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nebula')
  await page.reload()
  await expect(page.locator('#boot')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nebula')
})
