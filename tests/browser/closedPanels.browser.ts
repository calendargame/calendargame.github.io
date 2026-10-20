// A CLOSED PANEL IS NOT THERE FOR A KEYBOARD OR A SCREEN READER (Round 26 review): a How to Play
// section, and the Show Codes box. Their content stays mounted while closed — the slide animates to
// its height — and it used to be reachable all the same: Shift+Tab landed on the Contact link inside
// the closed Settings Overview, a screen reader read every closed section in full, and it read the
// codes with the box closed, which gives the method away. components/Expander makes a closed panel
// `inert`. Checked here in where Tab and Shift+Tab really go, in both engines, and in the tree the
// browser itself hands a screen reader — Chromium's, read through its debugging protocol, which
// WebKit's Playwright build has no counterpart of. (Playwright's own accessibility snapshot is no
// use for this: it leaves out what is hidden from the EYE, and an inert panel is not.)
import { test, expect, openApp, switchMode, settled } from './support/app'
import type { Page } from '@playwright/test'

// Every closed panel on screen is inert, to its last element.
async function expectClosedPanelsInert(page: Page, what: string) {
  const report = await page.evaluate(() =>
    [...document.querySelectorAll('.expander:not(.expander-open)')]
      .filter((panel) => panel.getClientRects().length > 0)
      .map((panel) => (panel.firstElementChild as HTMLElement).inert),
  )
  expect(report.length, `${what}: closed panels on screen`).toBeGreaterThan(0)
  expect(report, `${what}: every closed panel is inert`).not.toContain(false)
}

// The words a screen reader is given that contain `text` (Chromium's own accessibility tree).
async function spoken(page: Page, text: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: { ignored: boolean; name?: { value?: string } }[]
  }
  await cdp.detach()
  return nodes.filter((n) => !n.ignored && (n.name?.value ?? '').includes(text)).length
}

// Walk the keyboard `steps` presses of `key` and report every place it landed inside a closed panel.
async function landingsInClosedPanels(page: Page, key: 'Tab' | 'Shift+Tab', steps: number) {
  const landed: string[] = []
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key)
    const inside = await page.evaluate(() => {
      const el = document.activeElement
      return el?.closest('.expander:not(.expander-open)') ? el.outerHTML.slice(0, 100) : null
    })
    if (inside) landed.push(inside)
  }
  return landed
}

const OVERVIEW_WORDS = 'A training tool for working out the day of the week'

test('a closed How to Play section is out of reach of the keyboard and of a screen reader', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  await openApp(page)
  await switchMode(page, 'guide')
  await expectClosedPanelsInert(page, 'How to Play')
  if (browserName === 'chromium') expect(await spoken(page, OVERVIEW_WORDS)).toBe(0)
  // From the foot of the guide back up, and from the top down: nothing hidden takes the keyboard.
  await page.locator('#appScroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await settled(page)
  expect(await landingsInClosedPanels(page, 'Shift+Tab', 40)).toEqual([])
  await page.locator('#appScroll').evaluate((el) => (el.scrollTop = 0))
  expect(await landingsInClosedPanels(page, 'Tab', 40)).toEqual([])
  // An OPEN section is all there: its words are read and its link is reached.
  const header = page.getByRole('button', { name: 'What Is Calendar Game?' })
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  const panel = page.locator(`#${await header.getAttribute('aria-controls')}`)
  expect(await panel.evaluate((el) => el.closest('[inert]'))).toBeNull()
  if (browserName === 'chromium') expect(await spoken(page, OVERVIEW_WORDS)).toBeGreaterThan(0)
})

test('the Show Codes box, closed, gives nothing away to a screen reader', async ({
  page,
  browserName,
}) => {
  await openApp(page)
  await switchMode(page, 'classic')
  const toggle = page.locator('button[data-key="C"]:visible')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const codes = page.locator(`#${await toggle.getAttribute('aria-controls')}`)
  // The box's calendar line, as the date on screen has it: "Gregorian Calendar", or "Julian Calendar"
  // for a date before the 1582 changeover - about one in seven of the default range's dates, which is
  // what made a fixed "Gregorian Calendar" fail now and then. Read from the box itself (its words are in
  // the page while it is closed; only a screen reader is kept from them).
  const words = await codes.evaluate(
    (el) =>
      /(?:Julian|Gregorian)(?:\/(?:Julian|Gregorian))? Calendar/.exec(el.textContent ?? '')![0],
  )
  await expectClosedPanelsInert(page, 'the codes box')
  if (browserName === 'chromium') expect(await spoken(page, words), 'closed').toBe(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  expect(await codes.evaluate((el) => el.closest('[inert]'))).toBeNull()
  if (browserName === 'chromium') expect(await spoken(page, words), 'open').toBeGreaterThan(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await settled(page)
  if (browserName === 'chromium') expect(await spoken(page, words), 'closed again').toBe(0)
})
