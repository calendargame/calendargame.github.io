// windowSyncPins — WHAT A WINDOW DOES WHEN ANOTHER WINDOW CHANGES SOMETHING UNDER IT, in a real browser
// (design-q1-q2.md v4, 14.3's level-2 pins and 14.4 (15)). Two windows of this build on one device; the
// change is made in one, through its own screens, and the other is watched. The rule throughout (6.2):
// a change from another window does here exactly what the same change made here would do.
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  openApp,
  openSecondWindow,
  openSettings,
  openPresetManager,
  answerRight,
  switchMode,
  topBar,
  weekdayOf,
} from './support/app'

const score = (p: Page) => p.locator('.panel:visible [data-statval]').first()
const dateOn = (p: Page) => p.locator('.date-line:visible').textContent()
const visible = (p: Page, name: string) =>
  p.getByRole('button', { name, exact: true }).and(p.locator(':visible'))
const next = (p: Page) => visible(p, 'New').click()
// One more right answer. Another window's change can replace the question here, and for 300 ms after
// that a press answers nothing (lib/unaskedSwap) - so a press is repeated until the score shows it.
const answerUntil = (p: Page, shown: string) =>
  expect(async () => {
    await answerRight(p)
    await expect(score(p)).toHaveText(shown, { timeout: 500 })
  }).toPass()

/** Set the Julian-on Year Range in `p`'s ⚙ menu and close it - where a range change takes effect. */
async function setJulianOnRange(p: Page, from: number, to: number) {
  const panel = await openSettings(p)
  for (const [name, year] of [
    ['Earliest Year, Julian On', from],
    ['Latest Year, Julian On', to],
  ] as const) {
    const box = panel.getByRole('textbox', { name })
    await box.fill(String(year))
    await box.press('Enter')
  }
  await p.keyboard.press('Escape')
  await expect(p.locator('#settings-popover')).toHaveCount(0)
}

/** Turn Save Stats off in `p`'s ⚙ menu and close it. */
async function saveStatsOff(p: Page) {
  const panel = await openSettings(p)
  await panel.getByRole('button', { name: 'Save Stats' }).click()
  await expect(panel.getByRole('button', { name: 'Save Stats' })).toHaveText('Off')
  await p.keyboard.press('Escape')
  await expect(p.locator('#settings-popover')).toHaveCount(0)
}

const yearOf = (shown: string | null) => Number(/(\d+)$/.exec(shown ?? '')?.[1])

// 14.3 (2): the waiting question is drawn again inside the new range - and the cards already played
// stay, to browse back through - exactly as a range change in this window's own ⚙ menu does.
test('a Year Range changed in another window: the waiting question is drawn again in the new range, and the history is kept', async ({
  page,
  context,
}) => {
  await openApp(page)
  const other = await openSecondWindow(context)
  const played = await dateOn(page)
  await answerUntil(page, '1/1')
  await next(page)
  await setJulianOnRange(other, 1700, 1710)
  await expect.poll(async () => yearOf(await dateOn(page))).toBeGreaterThanOrEqual(1700)
  expect(yearOf(await dateOn(page))).toBeLessThanOrEqual(1710)
  await expect(score(page)).toHaveText('1/1')
  await visible(page, '<').click()
  await expect(page.locator('.date-line:visible')).toHaveText(played!)
})

// 14.3 (2): a live Blitz round is played under the range, so a range change ends it - as here; a Save
// Stats change does not (it only decides whether the round is recorded), so the round runs on.
test('a live Blitz round runs on through another window’s Save Stats change, and is reset by its Year Range change', async ({
  page,
  context,
}) => {
  await openApp(page)
  const other = await openSecondWindow(context)
  await switchMode(page, 'blitz')
  await visible(page, 'Begin').click()
  await expect(visible(page, 'Begin')).toHaveCount(0)
  await answerRight(page)
  await expect(score(page)).toHaveText('1/1')
  await saveStatsOff(other)
  // (the Save Stats change has come in: this window's strip says so)
  const panel = await openSettings(page)
  await expect(panel.getByRole('button', { name: 'Save Stats' })).toHaveText('Off')
  await page.keyboard.press('Escape')
  // Still running: no Begin, and the round takes answers - the next question comes up. (With Save
  // Stats off the strip shows a dash, not a count.)
  await expect(visible(page, 'Begin')).toHaveCount(0)
  const asked = await dateOn(page)
  await answerRight(page)
  await expect.poll(() => dateOn(page)).not.toBe(asked)
  await setJulianOnRange(other, 1700, 1710)
  await expect(visible(page, 'Begin')).toBeVisible() // reset, ready for the next
})

// 14.3 (13): the breakdown of a finished run stays open across another window's Save Stats change.
test('a finished MoX run’s breakdown stays open while another window turns Save Stats off', async ({
  page,
  context,
}) => {
  await openApp(page, { seed: { modePrefs: { aoxN: '2' } } })
  const other = await openSecondWindow(context)
  await switchMode(page, 'aox')
  await visible(page, 'Begin').click()
  const first = await dateOn(page)
  await answerRight(page)
  await expect.poll(() => dateOn(page)).not.toBe(first)
  await answerRight(page) // the second of two: the run is over
  await page.getByRole('button', { name: 'Show mean breakdown' }).click()
  const breakdown = page.getByRole('dialog', { name: 'Mean Breakdown' })
  await expect(breakdown).toBeVisible()
  await saveStatsOff(other)
  // The change has come in here (the strip's Save Stats state) and the breakdown is still open.
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('cg-settings-v1')!).state.saveStats),
    )
    .toBe(false)
  await expect(breakdown).toBeVisible()
})

// 14.4 (12): a change from another window takes nothing from the screen but what it replaces. Another
// window's answer in the mode on screen rebuilds its engine (store/screenPool) - and a "Reset Stats?"
// question open over it stays open, with the keyboard still in it; answered, it resets the stats as
// they now are, the other window's answer with them.
test('a “Reset Stats?” question stays open, with the keyboard in it, while another window answers the same mode', async ({
  page,
  context,
}) => {
  await openApp(page)
  await answerUntil(page, '1/1')
  const other = await openSecondWindow(context)
  await visible(page, 'Reset Stats').click()
  const question = page.getByRole('dialog', { name: 'Reset Stats?' })
  await expect(question).toBeVisible()
  await next(other)
  await answerUntil(other, '2/2')
  await expect(score(page)).toHaveText('2/2') // rebuilt here on both answers…
  await expect(question).toBeVisible() // …with the question still open
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    'the keyboard is still in the question',
  ).toBe(true)
  await question.getByRole('button', { name: 'Reset Stats' }).click()
  await expect(score(page)).toHaveText('0/0')
  await expect(score(other)).toHaveText('0/0')
})

// 14.3 (3): delete in one window the preset another window is on, and that window moves to the
// preset next to it, as the window that deleted it would.
test('a preset deleted in another window while this one is on it: this window moves to its neighbour', async ({
  page,
  context,
}) => {
  await openApp(page)
  const manager = await openPresetManager(page)
  await manager.getByRole('button', { name: 'New Preset' }).click()
  await expect(manager.getByRole('textbox', { name: 'Preset name' })).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const other = await openSecondWindow(context)
  await topBar(other).preset.click()
  await other.getByRole('option', { name: 'Preset 2' }).click()
  await expect(topBar(other).preset).toHaveAccessibleName(/Preset 2$/)
  await expect(topBar(page).preset).toHaveAccessibleName(/Preset 1$/) // (each window its own)
  const again = await openPresetManager(page)
  await again.getByRole('button', { name: 'Delete Preset 2' }).click()
  await expect(again.getByRole('textbox', { name: 'Preset name' })).toHaveCount(1)
  await expect(topBar(other).preset).toHaveAccessibleName(/Preset 1$/)
})

// 14.3 (5): a Reset in one window, answers in ANOTHER mode in the other: the reset mode stays reset.
test('a mode reset in another window stays reset while this window plays a different mode', async ({
  page,
  context,
}) => {
  await openApp(page, { seed: { modePrefs: { aoxN: '2' } } })
  await answerUntil(page, '1/1')
  await next(page)
  await answerUntil(page, '2/2')
  const other = await openSecondWindow(context)
  await switchMode(other, 'aox')
  await visible(page, 'Reset Stats').click()
  await page
    .getByRole('dialog', { name: 'Reset Stats?' })
    .getByRole('button', { name: 'Reset Stats' })
    .click()
  await expect(score(page)).toHaveText('0/0')
  await visible(other, 'Begin').click()
  await answerRight(other)
  await expect(score(other)).toHaveText(/^1\//)
  await switchMode(other, 'classic')
  await expect(score(other)).toHaveText('0/0')
  await page.reload()
  await expect(score(page)).toHaveText('0/0')
})

// The Deduction puzzle on screen, as the default format writes it ("November __, 4149"), with the
// weekday it asks for - read from the one place it is drawn.
const puzzleOn = (p: Page) =>
  p.evaluate(() => {
    const leaf = [...document.querySelectorAll<HTMLElement>('#appScroll *')].find(
      (el) =>
        el.offsetParent !== null && /__/.test(el.textContent ?? '') && el.childElementCount === 0,
    )
    let card: HTMLElement | null | undefined = leaf
    while (card && !/Weekday:/.test(card.textContent ?? '')) card = card.parentElement
    return card?.textContent ?? null
  })
// Answer a Day puzzle right: the day of its month and year whose weekday is the one asked for.
async function answerDayPuzzle(p: Page) {
  const text = (await puzzleOn(p)) ?? ''
  const [, month, year, weekday] =
    /([A-Z][a-z]+) __, (\d+)[\s\S]*?Weekday:\s*([A-Z][a-z]+day)/.exec(text) ?? []
  expect(weekday, `a Day puzzle in the default format, not "${text}"`).toBeDefined()
  const grid = p.locator('[data-answer-grid]:visible')
  for (const name of await grid.getByRole('button').allTextContents())
    if (weekdayOf(`${month} ${name}, ${year}`) === weekday)
      return grid.getByRole('button', { name, exact: true }).click()
  throw new Error(`no day of ${month} ${year} is a ${weekday}`)
}

// 14.3 (10): Deduction's three puzzle types are three engines; another window's Day answer rebuilds
// this window's Day engine only - a Month puzzle on screen here stays, unanswered and untouched.
test('another window’s Deduction Day answer leaves this window’s Month puzzle where it is', async ({
  page,
  context,
}) => {
  await openApp(page)
  const other = await openSecondWindow(context)
  await switchMode(page, 'deduction')
  await visible(page, 'Month').click()
  await expect(visible(page, 'Month')).toHaveClass(/btn-solid/)
  const monthPuzzle = await puzzleOn(page)
  await switchMode(other, 'deduction')
  await visible(other, 'Day').click()
  await answerDayPuzzle(other)
  await expect(score(other)).toHaveText('1/1')
  // (the answer has come in here: the shared Day stats, read back as this window's Day screen will)
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('cg-progress-v1')!).state.stats.dedDay.played,
      ),
    )
    .toBe(1)
  await expect(visible(page, 'Month')).toHaveClass(/btn-solid/)
  expect(await puzzleOn(page)).toBe(monthPuzzle)
  await expect(score(page)).toHaveText('0/0') // the Month strip
})

// 14.4 (15): a FROZEN window (the browser's lifecycle freeze, Chromium's) hears nothing while frozen;
// on its return the changes it missed are taken in, in order, and its next answer lands on top of them.
test('a frozen window catches up on its return, and its next answer lands on top', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'only Chromium lets a page be frozen from outside')
  await openApp(page)
  const other = await openSecondWindow(context)
  const cdp = await context.newCDPSession(other)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await answerUntil(page, '1/1')
  await next(page)
  await answerUntil(page, '2/2')
  await next(page)
  await answerUntil(page, '3/3')
  await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  await expect(score(other)).toHaveText('3/3')
  await answerUntil(other, '4/4')
  await expect(score(page)).toHaveText('4/4')
})
