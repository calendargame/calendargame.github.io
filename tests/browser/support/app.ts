// tests/browser/support/app — THE BROWSER LANE'S ONE DOOR INTO THE APP. Every *.browser.ts file
// imports `test` and `expect` from here, never from '@playwright/test'.
//
// ── HOW TO ADD A TEST ────────────────────────────────────────────────────────────────────────
//   1. Create tests/browser/<what it is about>.browser.ts and `import { test, expect, openApp }
//      from './support/app'`. The name must end in .browser.ts or nothing runs it.
//   2. Open the app with `openApp(page, { viewport, theme, seed })`, get to the screen with
//      `switchMode` / `openSettings`, then measure with `rectOf` and assert with `expect` or the
//      `expectNo…` helpers below. A second window on the same saved data is `openSecondWindow`;
//      a second DEVICE, with a save of its own, is the `newDevice` fixture.
//   3. `npm run build`, then `npm run test:browser`. It must pass in every project, three runs in a
//      row, before it is committed.
//
// ── HOW TO RUN ONE FILE, AND WATCH IT ────────────────────────────────────────────────────────
//   npx playwright test bestTag --project=webkit            one file, one engine
//   npx playwright test bestTag --project=chromium --headed --workers=1      …in a window
//   npx playwright test bestTag --project=chromium --debug                   …stepping, with the inspector
//   npx playwright show-trace test-results/<folder>/trace.zip                a failed run, replayed
// The lane serves `dist` and refuses a stale one: after any change under src/, build first.
//
// ── ★ THE RULE: ASSERT GEOMETRY AT REST, NEVER A FRAME ───────────────────────────────────────
// A test here may assert where things ARE once the page has settled: a box's edges, whether text
// is cut, what a resting opacity is. It may not assert what a frame in the middle of a movement
// looked like, how many frames something took, or that two things changed in the same frame. Those
// depend on the machine's speed and the browser's scheduler; they pass on a laptop and fail on a
// loaded CI runner, and a lane that fails for no reason is a lane people learn to re-run. Round 25
// measured frame traces by hand, usefully, and deliberately none of them were ported.
//   • No sleeps. Wait for the state itself (`expect(...).toBe…`, `expect.poll`, `page.waitFor…`).
//     `settled` below waits for the browser to have laid out and painted what is already decided.
//   • Reduce Motion is on for every test (playwright.config.ts), so nothing decorative is moving.
//   • Assert RELATIONS, not pixel values: "the list is as wide as its button", never "the list is
//     156px wide". Fonts differ between Windows, Linux, and the phones; relations do not.
//   • CONFIRM EVERY SEED ON SCREEN before measuring what it set up (the seeded Best is showing, the
//     seeded theme is the page's). A seed the app ignored makes every assertion after it vacuous.
//   • A difference between the engines is a FINDING to report, not a tolerance to add.
import {
  test as base,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { PAGES, type PageId } from '../../../src/lib/modes'
import { storageFor, type AppSeed, type SeededStorage, type Theme } from './seeds'

export { expect }
export type { AppSeed, Theme }
export { THEMES } from './seeds'

// A page the lane serves itself, on the app's own address and holding nothing: somewhere to stand
// while storage is filled, before any of the app's code has run.
const BLANK_PAGE = '__browser-lane-blank.html'

export const test = base.extend<{ newDevice: () => Promise<Page> }>({
  context: async ({ context, baseURL }, use) => {
    const check = await watch(context, baseURL!)
    await use(context)
    check()
  },
  /**
   * A window on ANOTHER device: its own saved data, sharing nothing with `page`. For a test that
   * needs two saves side by side (two pages of one context are one device — `openSecondWindow`).
   * Watched and closed like the test's own.
   */
  newDevice: async ({ browser, baseURL }, use) => {
    const devices: { context: BrowserContext; check: () => void }[] = []
    await use(async () => {
      // Playwright gives a context made this way the same fixed world as the test's own.
      const context = await browser.newContext()
      devices.push({ context, check: await watch(context, baseURL!) })
      return context.newPage()
    })
    for (const { context, check } of devices) {
      await context.close()
      check()
    }
  },
})

// Put a context under the lane's rules, and hand back the check to run when its test is over.
async function watch(context: BrowserContext, baseURL: string): Promise<() => void> {
  const site = new URL(baseURL).origin
  // Nothing leaves the machine: the live site's build carries an analytics script, and a test run
  // is not a visit. Answered empty rather than refused, so the page logs no failed request.
  await context.route(
    (url) => url.origin !== site,
    (route) => route.fulfill({ status: 204, body: '' }),
  )
  await context.route(`**/${BLANK_PAGE}`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }),
  )
  // Every test fails on an error the page raised or logged, in any window it opened — "it did not
  // crash" is checked for free, everywhere, instead of remembered case by case. Heard inside the
  // page (its own `error` and `unhandledrejection` events) rather than through the browser's
  // debugging channel, because the engines disagree about what that channel carries: WebKit passes
  // a ResizeObserver loop error along it and Chromium does not, though both raise it.
  const errors: string[] = []
  pageErrors.set(context, errors)
  await context.exposeBinding(REPORT, (_source, message: string) => void errors.push(message))
  await context.addInitScript((REPORT) => {
    const report = (message: string) =>
      (window as unknown as Record<string, (m: string) => void>)[REPORT](message)
    window.addEventListener('error', (e) => report(`uncaught: ${e.message}`))
    window.addEventListener('unhandledrejection', (e) =>
      report(`unhandled rejection: ${String(e.reason)}`),
    )
  }, REPORT)
  context.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  return () =>
    expect(
      errors.filter((e) => !KNOWN_PAGE_ERRORS.some((known) => e.includes(known))),
      'the page raised or logged an error',
    ).toEqual([])
}

const REPORT = '__browserLaneReport'
const pageErrors = new WeakMap<BrowserContext, string[]>()
/** Every error the pages of this context have raised or logged so far, known ones included. */
export const pageErrorsOf = (context: BrowserContext): readonly string[] => pageErrors.get(context)!

// ── ⚠ KNOWN DEFECTS THE LANE MEETS AND DOES NOT FAIL ON. THIS LIST IS MEANT TO BE EMPTY. ─────
// An entry is an error the APP raises today, already known and waiting for its own fix, that a
// test here cannot avoid setting off. Without the entry every test that touches it would be red
// for a reason that is not its own; with it, the lane must not let the entry outlive the defect —
// so EVERY ENTRY HAS A TEST IN knownDefects.browser.ts THAT FAILS THE DAY THE ERROR STOPS
// HAPPENING. Fix the defect, watch that test fail, delete both. Never add an entry without one.
export const KNOWN_PAGE_ERRORS: readonly string[] = [
  // The top bar's height observer (src/main.tsx's syncBarHeight) answers a change in the bar's
  // height by writing --bar-h, which the page is laid out from — from inside the observer's own
  // callback, so the browser has new sizes to report before it has finished reporting the last,
  // and raises this. A change of the window's size that moves the root font sets it off (a
  // different height, or a tablet or desktop width), which a sweep here cannot avoid. Nothing is
  // drawn wrong; on the live site it is an error in the log.
  'ResizeObserver loop completed with undelivered notifications.',
]

export interface OpenOptions {
  /** The window's size. Left out, it is the lane's 390×844 phone. */
  viewport?: { width: number; height: number }
  /** One of the five themes. Left out, it is the app's own choice for a dark system (Dusk). */
  theme?: Theme
  /** What is already saved on the device when the app opens (support/seeds). */
  seed?: AppSeed
}

/**
 * Open the app in `page` as a first visit to a device that holds `seed`, and wait until it is on
 * screen and still. The storage is written before any of the app's code runs, and once: a later
 * `page.reload()` finds what the app itself saved, as a real reload would.
 */
export async function openApp(page: Page, { viewport, theme, seed = {} }: OpenOptions = {}) {
  if (viewport) await page.setViewportSize(viewport)
  const stored = storageFor(theme ? { ...seed, settings: themeSettings(theme, seed) } : seed)
  await page.goto(BLANK_PAGE)
  await page.evaluate(fillStorage, stored)
  await page.goto('./')
  await appReady(page)
  if (theme) await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

const themeSettings = (theme: Theme, seed: AppSeed) => ({
  ...seed.settings,
  useSystem: false,
  manualTheme: theme,
})

const fillStorage = ({ local, session }: SeededStorage) => {
  for (const [key, value] of Object.entries(local)) window.localStorage.setItem(key, value)
  for (const [key, value] of Object.entries(session)) window.sessionStorage.setItem(key, value)
}

/**
 * A second window on the same device: the same saved data (two pages of one context share
 * localStorage), its own session (sessionStorage is per window) — what a player gets by opening the
 * site in another tab. Nothing is seeded; it opens on whatever the first window has saved.
 */
export async function openSecondWindow(
  context: BrowserContext,
  viewport?: OpenOptions['viewport'],
) {
  const page = await context.newPage()
  if (viewport) await page.setViewportSize(viewport)
  await page.goto('./')
  await appReady(page)
  return page
}

/** The app has started, its stylesheet and fonts are in, and the page has been laid out. */
export async function appReady(page: Page) {
  // index.html's splash is removed only once React has mounted AND the stylesheet has applied.
  await expect(page.locator('#boot')).toHaveCount(0)
  await expect(page.locator('header [data-select-trigger]').first()).toBeVisible()
  await settled(page)
}

/**
 * Wait for the page to be still: fonts loaded, then two frames — one for anything the app does in
 * answer to a size or content change (its ResizeObservers run in the frame after the change), one
 * for the layout that follows. Not a sleep: it ends as soon as the browser has drawn twice.
 */
export async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    )
  })
}

/** Resize the window and wait for the page to have followed. */
export async function resizeTo(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await settled(page)
}

// ── Getting around ───────────────────────────────────────────────────────────────────────────

/** The top bar's three controls. */
export const topBar = (page: Page) => ({
  preset: page.locator('header [data-select-trigger][aria-haspopup="listbox"]').nth(0),
  mode: page.locator('header [data-select-trigger][aria-haspopup="listbox"]').nth(1),
  // "Settings", or "Settings (modified)" once anything differs from the defaults.
  settings: page.locator('header').getByRole('button', { name: /^Settings\b/ }),
})

/** Go to a mode or page by its keyboard shortcut, and wait until the top bar names it. */
export async function switchMode(page: Page, id: PageId) {
  const target = PAGES.find((p) => p.id === id)!
  await page.keyboard.press(target.key)
  // The mode button holds every mode's name (to size itself); the one showing is not aria-hidden.
  await expect(
    topBar(page).mode.locator('[aria-hidden="false"]', { hasText: target.label }),
  ).toBeVisible()
  await settled(page)
}

/** Open the ⚙ menu and hand back its panel. */
export async function openSettings(page: Page): Promise<Locator> {
  await topBar(page).settings.click()
  const panel = page.locator('#settings-popover')
  await expect(panel).toBeVisible()
  await settled(page)
  return panel
}

/** Open ⚙ → Manage Presets and hand back the dialog. */
export async function openPresetManager(page: Page): Promise<Locator> {
  const panel = await openSettings(page)
  await panel.getByRole('button', { name: 'Manage Presets' }).click()
  const dialog = page.getByRole('dialog', { name: 'Presets' })
  await expect(dialog).toBeVisible()
  await settled(page)
  return dialog
}

/**
 * The stats strip of the mode on screen, the row of Best readouts under it (MoX and Blitz; absent
 * elsewhere), and the group that holds the two. Found from what they SAY, never from a class a test
 * might be about. (Every mode's screen stays mounted; only one is displayed.)
 */
export function statsBlock(page: Page) {
  const strip = page.locator('.panel:visible', { has: page.locator('[data-statval]') })
  const group = strip.locator('xpath=..')
  const bests = group.locator(':scope > :nth-child(2)')
  return { strip, group, bests }
}

// ── Measuring ────────────────────────────────────────────────────────────────────────────────

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** An element's box, in CSS pixels and unrounded (Playwright's own boundingBox rounds nothing
 *  either, but gives no right or bottom — and most layout rules are about edges). */
export const rectOf = (target: Locator): Promise<Rect> =>
  target.evaluate((el) => {
    const { left, top, right, bottom, width, height } = el.getBoundingClientRect()
    return { left, top, right, bottom, width, height }
  })

/** The box of an element's TEXT as laid out — its ink's extent, whatever box it sits in. */
export const textRectOf = (target: Locator): Promise<Rect> =>
  target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const { left, top, right, bottom, width, height } = range.getBoundingClientRect()
    return { left, top, right, bottom, width, height }
  })

// ONE TOLERANCE, AND IT IS THE BROWSERS' OWN GRAIN, NOT SLACK. Chromium and WebKit both lay boxes out
// in sixty-fourths of a pixel while text is measured in finer fractions, so a box edge and the text
// that fills it exactly can read 1/64px apart (0.0156). A twentieth of a pixel is three of those
// steps: far below anything a screen draws, and above anything rounding alone produces.
export const SAME_PX = 0.05

/**
 * Nothing inside `target` is wider than it: its content does not overflow sideways, so nothing is
 * cut at its edge and it cannot be scrolled sideways. (`scrollWidth` counts whole pixels, so text
 * over by a fraction is caught by the text's own box.)
 */
export async function expectNoHorizontalOverflow(target: Locator, what = 'the element') {
  const over = await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const box = el.getBoundingClientRect()
    const text = range.getBoundingClientRect()
    return {
      scroll: el.scrollWidth - el.clientWidth,
      textRight: text.width > 0 ? text.right - box.right : 0,
      textLeft: text.width > 0 ? box.left - text.left : 0,
    }
  })
  expect(over.scroll, `${what} holds content wider than itself`).toBeLessThanOrEqual(0)
  expect(over.textRight, `${what}'s text runs past its right edge`).toBeLessThanOrEqual(SAME_PX)
  expect(over.textLeft, `${what}'s text runs past its left edge`).toBeLessThanOrEqual(SAME_PX)
}

/** `inner` lies wholly inside `outer` — nothing of it is outside to be clipped. */
export async function expectInside(inner: Locator, outer: Locator, what = 'the element') {
  const [a, b] = await Promise.all([rectOf(inner), rectOf(outer)])
  expect(a.left, `${what}: left edge`).toBeGreaterThanOrEqual(b.left - SAME_PX)
  expect(a.right, `${what}: right edge`).toBeLessThanOrEqual(b.right + SAME_PX)
  expect(a.top, `${what}: top edge`).toBeGreaterThanOrEqual(b.top - SAME_PX)
  expect(a.bottom, `${what}: bottom edge`).toBeLessThanOrEqual(b.bottom + SAME_PX)
}

/** The page is exactly as wide as the window: nothing pushes it sideways. */
export async function expectPageNotWiderThanWindow(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(over, 'the page is wider than the window').toBeLessThanOrEqual(0)
}
