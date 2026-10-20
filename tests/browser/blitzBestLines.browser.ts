// BLITZ'S SMALL LINES UNDER EACH BEST (Round 26, Q10): under Best Score that round's best streak,
// under Best Streak that round's score — MoX's sub-lines, for Blitz. What is held here, at rest:
//   • THE ROW IS ONE HEIGHT, whatever it holds: no record, a record from before Round 26 (its small
//     lines a dash), a record with its small lines, one this round has just set (its ★), and in each
//     timing set-up — Per Round, Per Question with Allow Mistakes, and sudden death, which has one
//     number and so no small line, only the line's height;
//   • A SMALL LINE NEVER WRAPS, at every phone width from 280 to 430, with four-digit numbers.
// The tag beside the Bests and the dashed session-only frame round them are held by bestTag and
// sessionOnlyFrame, which see the small lines too.
import {
  test,
  expect,
  openApp,
  resizeTo,
  statsBlock,
  switchMode,
  SAME_PX,
  THEMES,
} from './support/app'
import { blitzBest } from './support/seeds'
import type { BlitzBest } from '../../src/store/progress'
import type { Page } from '@playwright/test'

const NEW: BlitzBest = {
  score: 12,
  scoreStreak: 5,
  scoreRoundId: 1,
  streak: 7,
  streakScore: 9,
  streakRoundId: 2,
}
// What a build before Round 26 saved: the four older fields, no companions.
const OLDER = { score: 12, scoreRoundId: 1, streak: 7, streakRoundId: 2 } as unknown as BlitzBest

// Per Round with Allow Mistakes, as the app opens — said out loud, because the first case below
// leaves the device on sudden death, and a later open on that device would find it there.
const PER_ROUND = { blitzPerQ: false, blitzAllowMistakes: true }

const rowHeight = (page: Page) =>
  statsBlock(page).bests.evaluate((row) => row.getBoundingClientRect().height)
const smallLines = (page: Page) =>
  statsBlock(page).bests.evaluate((row) =>
    [...row.querySelectorAll('div')]
      .filter((el) => /^(Streak|Score):/.test(el.textContent ?? ''))
      .map((el) => el.textContent),
  )

test('the Best row is one height whatever it holds, in every timing set-up', async ({ page }) => {
  await openApp(page)
  await switchMode(page, 'blitz')
  const empty = await rowHeight(page)
  expect(await smallLines(page)).toEqual(['Streak: —', 'Score: —'])

  // Per Question with Allow Mistakes: the same two small lines.
  await page.getByRole('button', { name: 'Per Round' }).click()
  await expect(page.getByRole('button', { name: 'Per Question' })).toBeVisible()
  expect(Math.abs((await rowHeight(page)) - empty)).toBeLessThanOrEqual(SAME_PX)
  // Sudden death: one number, no small line — and the line's height kept.
  await page.getByRole('button', { name: 'Allow Mistakes' }).click()
  expect(await smallLines(page)).toEqual([])
  expect(Math.abs((await rowHeight(page)) - empty)).toBeLessThanOrEqual(SAME_PX)

  for (const [what, rec, lines] of [
    ['a record with its small lines', NEW, ['Streak: 5', 'Score: 9']],
    ['a record from before Round 26', OLDER, ['Streak: —not recorded', 'Score: —not recorded']],
  ] as const) {
    await openApp(page, { seed: { modePrefs: PER_ROUND, progress: blitzBest(rec) } })
    await switchMode(page, 'blitz')
    await expect(statsBlock(page).bests).toContainText('Best Score: 12') // the seed, on screen
    expect(await smallLines(page), what).toEqual(lines)
    expect(Math.abs((await rowHeight(page)) - empty), what).toBeLessThanOrEqual(SAME_PX)
  }

  // A record the round on screen has just set, with its ★.
  await openApp(page, { seed: { modePrefs: PER_ROUND, progress: { blitzBest: {} } } })
  await switchMode(page, 'blitz')
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.locator('button[data-key="R"]:visible').click() // Reveal: the round ends on 0/1
  await page.locator('button[data-key="O"]:visible').click() // Override: credited, the round resumes
  await page.locator('button[data-key="R"]:visible').click() // …and ends on 1/2: Best Score 1 ★
  await expect(statsBlock(page).bests).toContainText('★')
  expect(Math.abs((await rowHeight(page)) - empty), 'a ★ record').toBeLessThanOrEqual(SAME_PX)
})

test('a small line never wraps, from 280 to 430 wide, with four-digit numbers', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const wide: BlitzBest = {
    ...NEW,
    score: 1234,
    scoreStreak: 1234,
    streak: 1234,
    streakScore: 1234,
  }
  await openApp(page, {
    viewport: { width: 280, height: 653 },
    seed: { progress: blitzBest(wide) },
  })
  await switchMode(page, 'blitz')
  await expect(statsBlock(page).bests).toContainText('Best Score: 1234')
  for (let width = 280; width <= 430; width++) {
    await resizeTo(page, width, 844)
    const lines = await statsBlock(page).bests.evaluate((row) =>
      [...row.querySelectorAll('div')]
        .filter((el) => /^(Streak|Score):/.test(el.textContent ?? ''))
        .map((el) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
        }),
    )
    expect(lines, `${width} wide: each small line is one line`).toEqual([1, 1])
  }
})

// ★ READABLE, AND STILL SECONDARY (the Round 26 review: the small lines read 2.1:1 in the light
// themes): in every theme, in MoX and in Blitz, a Best line and the small line under it both read
// at 4.5:1 or better against what is behind them, and the small line is the fainter of the two.
// The contrast is worked out as WCAG has it, from the colours the page itself computes: the text's
// colour over every background between it and the page, with every opacity on the way applied.
for (const theme of THEMES)
  test(`${theme}: the Bests and their small lines read at 4.5:1 or better, the small lines a step fainter`, async ({
    page,
  }) => {
    await openApp(page, { theme, seed: { progress: blitzBest(NEW), modePrefs: PER_ROUND } })
    for (const screen of ['blitz', 'aox'] as const) {
      await switchMode(page, screen)
      const pairs = await statsBlock(page).bests.evaluate((row) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const rgba = (colour: string) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = '#000'
          ctx.fillStyle = colour
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return [d[0], d[1], d[2], d[3] / 255]
        }
        const over = (top: number[], under: number[]) =>
          [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
        const behind = (el: Element) => {
          let colour = rgba(getComputedStyle(document.body).backgroundColor)
          const chain: Element[] = []
          for (let a: Element | null = el; a; a = a.parentElement) chain.unshift(a)
          for (const a of chain) {
            const fill = rgba(getComputedStyle(a).backgroundColor)
            if (fill[3] > 0) colour = over(fill, colour)
          }
          return colour
        }
        const opacity = (el: Element) => {
          let o = 1
          for (let a: Element | null = el; a; a = a.parentElement) o *= +getComputedStyle(a).opacity
          return o
        }
        const luminance = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            v /= 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        const contrast = (el: Element) => {
          const back = behind(el)
          const text = rgba(getComputedStyle(el).color)
          const ink = over([text[0], text[1], text[2], text[3] * opacity(el)], back)
          const [a, b] = [luminance(ink), luminance(back)]
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }
        // Each small line, and the Best line above it.
        return [...row.querySelectorAll('div')]
          .filter((el) => /^(Streak|Score|Median|Mean):/.test(el.textContent ?? ''))
          .map((note) => ({
            best: contrast(note.previousElementSibling!),
            note: contrast(note),
            text: note.textContent,
          }))
      })
      expect(pairs.length, `${screen}: small lines on screen`).toBeGreaterThan(0)
      for (const { best, note, text } of pairs) {
        expect(best, `${theme}, ${screen}: the Best above "${text}"`).toBeGreaterThanOrEqual(4.5)
        expect(note, `${theme}, ${screen}: "${text}"`).toBeGreaterThanOrEqual(4.5)
        expect(note, `${theme}, ${screen}: "${text}" is fainter than its Best`).toBeLessThan(best)
      }
    }
  })
