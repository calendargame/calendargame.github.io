// THE BREAKDOWN'S SUMMARY, LAID OUT (Round 26, Q4). The figures above a finished MoX run's list
// stand in two columns: Solves, Fastest, Slowest, and Spread down the left; Accuracy, Mean, and
// Median down the right. Spread is shown only when the run has two different times to span, so the
// left column is four tall or three — and the right column must start level with the left's top
// either way. tests/runBreakdown.dom proves the ORDER (jsdom lays nothing out); this proves where
// the figures really stand, with a run played for real: a clean Mo2 (two solves, a Spread) and a
// run failed on its first question (no times, no Spread).
import { test, expect, openApp, settled, switchMode, SAME_PX } from './support/app'
import type { Page } from '@playwright/test'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// The question on screen, as numeric-ymd in a Gregorian range (the seed below), and its weekday.
async function question(page: Page) {
  const text = await page
    .locator(':not(:has(*))', { hasText: /^\d{4}-\d{1,2}-\d{1,2}$/ })
    .filter({ visible: true })
    .first()
    .textContent()
  const [y, m, d] = text!.split('-').map(Number)
  return { text: text!, day: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }
}

async function answer(page: Page, day: string) {
  await page.locator('[data-answer-grid]:visible').getByRole('button', { name: day }).click()
}

async function beginMo2(page: Page) {
  await openApp(page, {
    seed: {
      settings: {
        randomFormat: false,
        dateFormat: 'numeric-ymd',
        useJulian: false,
        minY: 2000,
        maxY: 2030,
      },
    },
  })
  await switchMode(page, 'aox')
  const length = page.getByRole('textbox', { name: 'MoX run length' })
  await length.fill('2')
  await length.press('Enter')
  await page.getByRole('button', { name: 'Begin' }).click()
}

// Where each figure's label stands.
async function figures(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Mean Breakdown' })
  await expect(dialog).toBeVisible()
  await settled(page)
  return dialog.evaluate((dlg) => {
    const at: Record<string, { left: number; top: number }> = {}
    for (const span of dlg.querySelectorAll('span')) {
      const label = span.textContent!.trim()
      if (
        span.childElementCount === 0 &&
        /^(Solves|Fastest|Slowest|Spread|Accuracy|Mean|Median)$/.test(label)
      ) {
        const r = span.parentElement!.getBoundingClientRect()
        at[label] ??= { left: r.left, top: r.top }
      }
    }
    return at
  })
}

function expectColumns(
  at: Record<string, { left: number; top: number }>,
  left: string[],
  right: string[],
) {
  expect(Object.keys(at).sort()).toEqual([...left, ...right].sort())
  for (const column of [left, right]) {
    for (let i = 1; i < column.length; i++) {
      expect(
        Math.abs(at[column[i]].left - at[column[0]].left),
        `${column[i]} is in its column`,
      ).toBeLessThan(SAME_PX)
      expect(at[column[i]].top, `${column[i]} is under ${column[i - 1]}`).toBeGreaterThan(
        at[column[i - 1]].top,
      )
    }
  }
  expect(at[right[0]].left, 'the right column is to the right').toBeGreaterThan(at[left[0]].left)
  // Row by row, the right column stands level with the left, starting at the top.
  right.forEach((label, i) =>
    expect(
      Math.abs(at[label].top - at[left[i]].top),
      `${label} is level with ${left[i]}`,
    ).toBeLessThan(SAME_PX),
  )
}

test('a clean run: Solves, Fastest, Slowest, and Spread down the left; Accuracy, Mean, and Median down the right', async ({
  page,
}) => {
  await beginMo2(page)
  const first = await question(page)
  await answer(page, first.day)
  await expect.poll(async () => (await question(page)).text).not.toBe(first.text)
  await answer(page, (await question(page)).day)
  await page.getByRole('button', { name: 'Show mean breakdown' }).click()
  expectColumns(
    await figures(page),
    ['Solves', 'Fastest', 'Slowest', 'Spread'],
    ['Accuracy', 'Mean', 'Median'],
  )
})

test('a run with no Spread: the left column is three tall, and Accuracy still heads the right', async ({
  page,
}) => {
  await beginMo2(page)
  const { day } = await question(page)
  await answer(page, DAYS[(DAYS.indexOf(day) + 1) % 7]) // wrong: the run fails on its first question
  await page.getByRole('button', { name: 'Show mean breakdown' }).click()
  expectColumns(
    await figures(page),
    ['Solves', 'Fastest', 'Slowest'],
    ['Accuracy', 'Mean', 'Median'],
  )
})
