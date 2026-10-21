// storageBreakdown — THE STORAGE USED BREAKDOWN'S "WHAT IS USING IT" LIST (Round 27, owner;
// components/StorageUsagePopup). One owner per row, told apart at a glance: a hairline in the
// panel's thin divider colour BETWEEN rows — none above the first row, none below the last — so a
// row that wraps still reads as one row; text never touching a line; each row's figure on its
// FIRST line, at the right; no bullets (the "To make room" list keeps its own). And none of it may
// make the popup scroll on the lane's phone, with rows as long as a real device makes them: two
// presets with long names, every mode's solve times big enough to be listed.
import { test, expect, openApp, openSettings, THEMES, type AppSeed } from './support/app'
import { presetsNamed } from './support/seeds'
import type { Locator } from '@playwright/test'

const timesOf = (n: number) => ({
  played: n,
  good: n,
  streak: 3,
  best: 40,
  times: Array.from({ length: n }, (_, i) => 2 + (i % 977) / 100),
})
// Each mode's list over 1% of the room, so every one is a row of its own; and two presets, so each
// row names its preset — with a long name, cut to its start and an ellipsis as the popup draws one.
const SEED: AppSeed = {
  presets: presetsNamed('My weekday drills for the morning commute', 'Weekend practice'),
  progress: {
    stats: {
      classic: timesOf(9000),
      flash: timesOf(9000),
      dedDay: timesOf(9000),
      dedMonth: timesOf(9000),
      dedYear: timesOf(9000),
    },
  },
}

async function openBreakdown(page: Parameters<typeof openApp>[0], theme: (typeof THEMES)[number]) {
  await openApp(page, { theme, seed: SEED })
  const panel = await openSettings(page)
  await panel.getByRole('button', { name: /^Storage used/ }).click()
  const dialog = page.getByRole('dialog', { name: /^Storage used/ })
  await expect(dialog).toBeVisible()
  return dialog
}

// Every row of the "What is using it" list (the first list in the card; "To make room" is the second).
const usageRows = (dialog: Locator) => dialog.locator('ul').first().locator(':scope > li')

for (const theme of THEMES)
  test(`${theme}: rows divided by hairlines between them only, each figure on its row's first line`, async ({
    page,
  }) => {
    const dialog = await openBreakdown(page, theme)
    // The seed is on screen: every mode's times are rows, under the long name cut short.
    await expect(dialog).toContainText('Deduction (Month) solve times (9,000)')
    const rows = usageRows(dialog)
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(6) // (five modes' times, and Everything else)

    const measured = await rows.evaluateAll((items) => {
      const thin = getComputedStyle(document.documentElement).getPropertyValue('--thin-bd').trim()
      // the colour --thin-bd resolves to, as a border would compute it
      const probe = document.createElement('div')
      probe.style.borderTop = `1px solid ${thin}`
      document.body.append(probe)
      const thinColour = getComputedStyle(probe).borderTopColor
      probe.remove()
      const textBox = (el: Element) => {
        const r = document.createRange()
        r.selectNodeContents(el)
        return r.getClientRects()[0]
      }
      return items.map((li) => {
        const style = getComputedStyle(li)
        const [label, figure] = Array.from(li.children) as HTMLElement[]
        // the label's first line box: the first rect of its text
        const range = document.createRange()
        range.selectNodeContents(label)
        const first = range.getClientRects()[0]
        const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size
        const box = li.getBoundingClientRect()
        const text = range.getBoundingClientRect()
        return {
          top: parseFloat(style.borderTopWidth),
          topColour: style.borderTopColor,
          bottom: parseFloat(style.borderBottomWidth),
          bottomColour: style.borderBottomColor,
          bullet: style.listStyleType,
          thinColour,
          labelFirstTop: first.top,
          labelFirstBottom: first.bottom,
          // (its text's box, as the label's first line is measured: like with like)
          figureTop: textBox(figure).top,
          figureBottom: textBox(figure).bottom,
          figureRight: figure.getBoundingClientRect().right,
          rowRight: box.right - parseFloat(style.paddingRight),
          // room between the text and the row's own edges, inside any line drawn on them
          above: text.top - box.top - parseFloat(style.borderTopWidth),
          below: box.bottom - parseFloat(style.borderBottomWidth) - text.bottom,
          lines,
        }
      })
    })
    // Exactly one hairline between each two rows (on the edge of whichever row draws it), in the thin
    // divider colour; none above the first row and none below the last.
    expect(measured[0].top, 'a line above the first row').toBe(0)
    expect(measured.at(-1)!.bottom, 'a line below the last row').toBe(0)
    for (let i = 1; i < measured.length; i++) {
      const [upper, lower] = [measured[i - 1], measured[i]]
      expect(upper.bottom + lower.top, `the line between rows ${i - 1} and ${i}`).toBe(1)
      const colour = upper.bottom ? upper.bottomColour : lower.topColour
      expect(colour, `the line between rows ${i - 1} and ${i}`).toBe(lower.thinColour)
    }
    for (const [i, row] of measured.entries()) {
      expect(row.bullet, `row ${i}'s bullet`).toBe('none')
      // The figure sits on the label's first line, at the row's right.
      expect(Math.abs(row.figureTop - row.labelFirstTop), `row ${i}'s figure`).toBeLessThan(1)
      expect(Math.abs(row.figureBottom - row.labelFirstBottom), `row ${i}'s figure`).toBeLessThan(1)
      expect(
        Math.abs(row.figureRight - row.rowRight),
        `row ${i}'s figure, at the right`,
      ).toBeLessThan(0.5)
      // No text touches a line.
      expect(row.above, `room above row ${i}`).toBeGreaterThanOrEqual(2)
      expect(row.below, `room below row ${i}`).toBeGreaterThanOrEqual(2)
    }
    // The seed's long name wraps a row, and it is still one row: no line inside it (each row draws at
    // most the one line on its edge, held above).
    expect(Math.max(...measured.map((r) => r.lines))).toBeGreaterThan(1)

    // The "To make room" list keeps its bullets.
    const advice = dialog.locator('ul').nth(1).locator(':scope > li').first()
    expect(await advice.evaluate((li) => getComputedStyle(li).listStyleType)).toBe('disc')

    // And the card does not scroll on the lane's phone (390×844) for any of it.
    const scroller = await dialog.evaluate((card) => {
      for (let el: Element | null = card; el; el = el.parentElement)
        if (el.scrollHeight > el.clientHeight + 0.5 && getComputedStyle(el).overflowY !== 'visible')
          return el.id || el.className
      return null
    })
    expect(scroller, 'the breakdown scrolls').toBeNull()
  })
