// tests/browser/support/presetNameCells — THE CELLS A PRESET NAME IS DRAWN IN, measured, and the one
// font-proof way to ask which name a cell is showing.
//
// ★ WHY A TEST MAY NOT EXPECT "Preset 1" TO BE DRAWN. Whether a stock name is drawn in full, as
// "P1", or as "1" is decided by whether it FITS (lib/presetNameWidth's stockNameForm) — and that
// depends on the machine's fonts. The lane's first run on the Linux CI runner proved it: at the
// lane's 390×844 phone, the runner's font is wide enough that "Preset 1" does not fit one of the
// top bar's cells, so the app (correctly) drew "P1" everywhere, and three tests that expected the
// cell to read "Preset 1" failed there while passing on Windows. So a test about WHICH preset is
// shown asks expectStockNameShown below: what a screen reader is told is the name in full, and
// what is drawn is that name in the form the room in front of it decides — checked against the
// room by layout, the way tests/browser/presetNames checks the rule itself.
import { expect, type Locator, type Page } from '@playwright/test'
import { shortStockName, stockNumber } from '../../../src/store/presets'

/** Where a name misses or clears its room by less than this, canvas (the app's measure) and
 *  layout (the test's) may honestly disagree, and nothing is asserted about it. */
export const CLOSE_PX = 0.5

export interface NameCell {
  /** The words in the cell as drawn, and how far they overrun it (more than 0 = cut). */
  text: string
  overrun: number
  /** For each of `names`: how far that name, set in this cell's font, would overrun it. */
  wouldOverrun: number[]
}

/** Every laid-out cell a preset name is drawn in (lib/presetNameWidth's one hook), and how each of
 *  `names` would fit it — measured by laying the name out in a plain element in the cell's font. */
export const nameCells = (page: Page, names: string[]): Promise<NameCell[]> =>
  page.evaluate((names) => {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0'
    document.body.appendChild(probe)
    const widthIn = (font: string, text: string) => {
      probe.style.font = font
      probe.textContent = text
      return probe.getBoundingClientRect().width
    }
    const out = [...document.querySelectorAll('[data-preset-name-cell]')]
      .filter((cell) => cell.getClientRects().length > 0)
      .map((cell) => {
        const room = cell.getBoundingClientRect().width
        const font = getComputedStyle(cell).font
        const words = cell.firstElementChild!
        const range = document.createRange()
        range.selectNodeContents(words)
        return {
          text: words.textContent ?? '',
          // The text's own laid-out width against the cell: an ellipsis hides what is over.
          overrun: Math.max(range.getBoundingClientRect().width, words.scrollWidth) - room,
          wouldOverrun: names.map((name) => widthIn(font, name) - room),
        }
      })
    probe.remove()
    return out
  }, names)

/**
 * `cell` (a `[data-preset-name-cell]`) is showing the stock name `name` ("Preset 1"), on any font:
 *   • a screen reader is told `name` in full — the drawn words when they ARE the full name, the
 *     cell's spoken copy (components/PresetSwitcher's sr-only text) when they are not;
 *   • what is drawn is `name`, its "P1" form, or its number "1" — the form the rooms decide. Every
 *     stock name in `stockNames` (the registry's, `name` included) is laid out in every visible name
 *     cell: all of them whole in every room means the full form, all of their "P" forms whole means
 *     "P1", anything less means the number. A worst case within CLOSE_PX of its room is too close
 *     to call between the two forms either side of it, and either is accepted.
 */
export async function expectStockNameShown(
  page: Page,
  cell: Locator,
  name: string,
  { stockNames = [name], what = 'the name cell' }: { stockNames?: string[]; what?: string } = {},
) {
  const short = shortStockName(name)
  const number = stockNumber(name)
  expect(short, `${name} is a stock name`).not.toBeNull()
  // Waits for the cell to show one of the three, as toHaveText would wait for one.
  const forms = { full: name, short: short!, number: number! }
  await expect
    .poll(() => cell.evaluate((c) => c.firstElementChild?.textContent ?? ''), { message: what })
    .toMatch(new RegExp(`^(${Object.values(forms).join('|')})$`))
  const { drawn, spoken } = await cell.evaluate((c) => ({
    drawn: c.firstElementChild?.textContent ?? '',
    spoken: c.querySelector('.sr-only')?.textContent ?? null,
  }))
  expect(spoken ?? drawn, `${what}: what a screen reader is told`).toBe(name)
  expect(
    spoken === null,
    `${what}: a spoken copy exactly when the drawn words are not the name`,
  ).toBe(drawn === name)
  const shorts = stockNames.map((n) => shortStockName(n)!)
  const rooms = await nameCells(page, [...stockNames, ...shorts])
  const worst = (from: number, to: number) =>
    Math.max(...rooms.flatMap((c) => c.wouldOverrun.slice(from, to)))
  const full = worst(0, stockNames.length)
  const p = worst(stockNames.length, stockNames.length * 2)
  const allowed =
    Math.abs(full) < CLOSE_PX
      ? [forms.full, forms.short]
      : full < 0
        ? [forms.full]
        : Math.abs(p) < CLOSE_PX
          ? [forms.short, forms.number]
          : p < 0
            ? [forms.short]
            : [forms.number]
  expect(
    allowed,
    `${what}: drawn "${drawn}"; in full it would overrun its room by ${full.toFixed(2)}px, as "${forms.short}" by ${p.toFixed(2)}px`,
  ).toContain(drawn)
}
