// fadeEdges — A SCROLL FADE ENDS EXACTLY AT THE EDGE ITS CONTENT GOES UNDER (Round 27, the owner's
// rule; components/scrollRegion's reachEdges, index.css's scroll-edge note). Content scrolling out of
// a list fades out INTO the pinned edge or neighbour it disappears under — the card's edge, a
// heading, a footer whose shadow lies over it — with no strip of plain panel colour between the fade
// and that edge. So every fading area's scroll box must END at its neighbour (0 px between them), and
// the space that used to lie outside the box lies inside it as padding — so that, at rest, the content
// sits exactly where it always did: its first line the same distance under the edge above with the
// list at its top, its last the same distance over the edge below with the list at its end.
// The game pages' own top fade is held too: it starts at the bar's bottom edge (the screen's top is
// under the bar), as How to Play's top strip always has.
// At the lane's phone and a larger one, in all five themes, in both engines.
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  appReady,
  openApp,
  openSettings,
  openPresetManager,
  settled,
  switchMode,
  THEMES,
} from './support/app'
import { presetsNamed } from './support/seeds'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]

// Where an area's region is, and the edges it ends at. Run in the page; `region` is the scroll box.
type Edge = 'card-top' | 'card-bottom' | 'prev' | 'next' | 'wrapper-prev' | 'wrapper-next'
interface Area {
  name: string
  region: string
  card: string
  above: Edge
  below: Edge
  /** At rest: the content's first line under the edge above, its last over the edge below, in rem. */
  restTop: number
  restBottom: number
}

const measure = (page: Page, area: Area) =>
  page.evaluate((a) => {
    const region = [...document.querySelectorAll<HTMLElement>(a.region)].find(
      (el) => el.getClientRects().length > 0,
    )
    if (!region) return null
    const card = region.closest<HTMLElement>(a.card)!
    const inner = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        top: r.top + parseFloat(s.borderTopWidth),
        bottom: r.bottom - parseFloat(s.borderBottomWidth),
      }
    }
    // (the next box in the flow: a screen-reader-only region beside it takes no room)
    const nextInFlow = (el: Element) => {
      let next = el.nextElementSibling
      while (next && getComputedStyle(next).position === 'absolute') next = next.nextElementSibling
      return next!
    }
    const edge = (which: string): number => {
      switch (which) {
        case 'card-top':
          return inner(card).top
        case 'card-bottom':
          return inner(card).bottom
        case 'prev':
          return region.previousElementSibling!.getBoundingClientRect().bottom
        case 'next':
          return nextInFlow(region).getBoundingClientRect().top
        case 'wrapper-prev':
          return region.parentElement!.previousElementSibling!.getBoundingClientRect().bottom
        default:
          return nextInFlow(region.parentElement!).getBoundingClientRect().top
      }
    }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const box = region.getBoundingClientRect()
    // The content, as drawn: the first and the last child that takes up room.
    const drawn = [...region.children].filter((c) => c.getBoundingClientRect().height > 0)
    region.scrollTop = 0
    const firstTop = drawn[0].getBoundingClientRect().top
    region.scrollTop = region.scrollHeight
    const lastBottom = drawn.at(-1)!.getBoundingClientRect().bottom
    region.scrollTop = 0
    return {
      rem,
      boxToAbove: box.top - edge(a.above),
      boxToBelow: edge(a.below) - box.bottom,
      restTop: firstTop - edge(a.above),
      restBottom: edge(a.below) - lastBottom,
      overflows: region.scrollHeight > region.clientHeight + 1,
    }
  }, area)

async function check(page: Page, area: Area) {
  const m = await measure(page, area)
  expect(m, `${area.name}: the region is on screen`).not.toBeNull()
  expect.soft(Math.abs(m!.boxToAbove), `${area.name}: box to the edge above, px`).toBeLessThan(0.05)
  expect.soft(Math.abs(m!.boxToBelow), `${area.name}: box to the edge below, px`).toBeLessThan(0.05)
  // At the top the list is at scroll position 0, exactly: the first line is where it always was, to
  // a twentieth of a pixel. At the end the browser holds a list on a WHOLE pixel while its content
  // height is fractional, so the last line can sit up to a pixel off the figure: within that pixel.
  expect
    .soft(
      Math.abs(m!.restTop - area.restTop * m!.rem),
      `${area.name}: first line under the edge above (${area.restTop}rem), px off`,
    )
    .toBeLessThan(0.05)
  expect
    .soft(
      Math.abs(m!.restBottom - area.restBottom * m!.rem),
      `${area.name}: last line over the edge below (${area.restBottom}rem), px off`,
    )
    .toBeLessThan(1)
}

const SETTINGS: Area = {
  name: 'the ⚙ menu',
  region: '#settings-popover [data-drag-scroll]',
  card: '#settings-popover',
  above: 'card-top',
  below: 'next', // the pinned foot
  restTop: 1,
  restBottom: 1,
}
const CHANGELOG: Area = {
  name: 'the Changelog',
  region: '[aria-labelledby="changelog-title"] > .overflow-y-auto',
  card: '[role="dialog"]',
  above: 'prev', // the heading row
  below: 'card-bottom',
  restTop: 0.75,
  restBottom: 1,
}
const PRESETS: Area = {
  name: 'Manage Presets',
  region: '[aria-labelledby="preset-manager-title"] .flow-root > .overflow-y-auto',
  card: '[role="dialog"]',
  above: 'wrapper-prev', // the description
  below: 'wrapper-next', // New Preset / Duplicate
  restTop: 0.75,
  restBottom: 0.75,
}
const DEFAULTS: Area = {
  name: 'Save Defaults',
  region: '[role="dialog"] > .overflow-y-auto',
  card: '[role="dialog"]',
  above: 'prev', // the head, with its shadow
  below: 'next', // the foot, with its shadow
  restTop: 0.75,
  restBottom: 0.75,
}
const LOOKUP: Area = {
  name: 'Lookup history',
  region: 'ul.overflow-y-auto',
  card: '.panel',
  above: 'prev', // the History heading
  below: 'card-bottom',
  restTop: 1,
  restBottom: 1,
}
const BREAKDOWN: Area = {
  name: 'a MoX breakdown',
  region: '[aria-labelledby="run-breakdown-title"] > .overflow-y-auto',
  card: '[role="dialog"]',
  above: 'prev', // the figures
  below: 'card-bottom',
  restTop: 0.75,
  restBottom: 1,
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
async function dayShown(page: Page) {
  const text = await page
    .locator(':not(:has(*))', { hasText: /^\d{4}-\d{1,2}-\d{1,2}$/ })
    .filter({ visible: true })
    .first()
    .textContent()
  const [y, m, d] = text!.split('-').map(Number)
  return { text: text!, day: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }
}

for (const viewport of VIEWPORTS)
  for (const theme of THEMES)
    test(`${viewport.width}×${viewport.height}, ${theme}: every fade ends at its edge, the content where it was`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const names = Array.from({ length: 24 }, (_, i) => `Practice ${i + 1}`)
      await openApp(page, {
        viewport,
        theme,
        seed: {
          presets: presetsNamed(...names),
          settings: {
            randomFormat: false,
            dateFormat: 'numeric-ymd',
            useJulian: false,
            minY: 2000,
            maxY: 2030,
          },
        },
      })

      // ── The game pages: the top fade starts at the bar's bottom edge, not behind the bar.
      const top = await page.evaluate(() => {
        const scroller = document.getElementById('appScroll')!
        const bar = document.querySelector('header')!
        return {
          inset: parseFloat(getComputedStyle(scroller).getPropertyValue('--fade-top-inset')),
          barBottom: bar.getBoundingClientRect().bottom,
          boxTop: scroller.getBoundingClientRect().top,
        }
      })
      expect
        .soft(Math.abs(top.boxTop + top.inset - top.barBottom), 'the page fade starts at the bar')
        .toBeLessThan(0.05)

      // ── The ⚙ menu, and the two popups opened from it.
      const panel = await openSettings(page)
      await check(page, SETTINGS)
      await panel.getByRole('button', { name: 'Changelog' }).click()
      await expect(page.getByRole('dialog', { name: "What's new" })).toBeVisible()
      await settled(page)
      await check(page, CHANGELOG)
      await page.keyboard.press('Escape')
      await settled(page)
      await panel.getByRole('button', { name: 'Save Defaults' }).click()
      await expect(page.locator(DEFAULTS.region)).toBeVisible()
      await settled(page)
      await check(page, DEFAULTS)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await settled(page)

      // ── Manage Presets, with a list long enough to scroll.
      await openPresetManager(page)
      await check(page, PRESETS)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await settled(page)

      // ── Lookup's history, long enough to scroll (saved as the app saves it, then reloaded).
      await page.evaluate(() => {
        const history = Array.from({ length: 40 }, (_, i) => ({
          id: `h${i}`,
          y: 1900 + i,
          m: 1 + (i % 12),
          d: 1 + (i % 28),
        }))
        localStorage.setItem('cg-lookup-v1', JSON.stringify({ state: { history }, version: 1 }))
      })
      await page.reload()
      await appReady(page)
      await switchMode(page, 'lookup')
      await settled(page)
      await check(page, LOOKUP)

      // ── A MoX run's breakdown.
      await switchMode(page, 'aox')
      const length = page.getByRole('textbox', { name: 'MoX run length' })
      await length.fill('2')
      await length.press('Enter')
      await page.getByRole('button', { name: 'Begin' }).click()
      const first = await dayShown(page)
      await page
        .locator('[data-answer-grid]:visible')
        .getByRole('button', { name: first.day })
        .click()
      await expect.poll(async () => (await dayShown(page)).text).not.toBe(first.text)
      const second = await dayShown(page)
      await page
        .locator('[data-answer-grid]:visible')
        .getByRole('button', { name: second.day })
        .click()
      await page.getByRole('button', { name: 'Show mean breakdown' }).click()
      await expect(page.getByRole('dialog', { name: 'Mean Breakdown' })).toBeVisible()
      await settled(page)
      await check(page, BREAKDOWN)
    })
