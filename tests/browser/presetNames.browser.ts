// A PRESET NAME AND THE ROOM IT HAS — lib/presetNameWidth's two answers, checked against the page:
//   • a stock name ("Preset 3") is drawn short ("P3"), everywhere at once, exactly when some stock
//     name would not fit somewhere it is shown;
//   • the note under the rename box ("Some places will show this name cut short.") is there exactly
//     when the text in the box would be cut somewhere — and a name saved with the note showing
//     really is drawn cut, one saved without it really is not.
//
// The app decides both by measuring text on a canvas against the live width of every cell a name
// is drawn in. jsdom has neither, so tests/presetNameWidth.dom fakes both; here they are real, and
// the oracle is the browser's own LAYOUT — the same words set in the same font in a plain element,
// measured — which is not the canvas the app asked.
//
// ⚠ TOO CLOSE TO CALL. Canvas and layout can differ by a fraction of a pixel for the same words, so
// where a name misses or clears its room by less than CLOSE_PX the two may honestly disagree, and
// nothing is asserted about that name at that width. Everywhere else — which is nearly everywhere:
// one more character is several pixels — the answer must be the app's.
import { test, expect, openApp, openPresetManager, resizeTo, settled, topBar } from './support/app'
import { presetsNamed } from './support/seeds'
import { defaultPresetName, shortStockName } from '../../src/store/presets'
import type { Page } from '@playwright/test'

const CLOSE_PX = 0.5
const NOTE = 'Some places will show this name cut short.'

interface Cell {
  /** The words in the cell as drawn, and how far they overrun it (more than 0 = cut). */
  text: string
  overrun: number
  /** For each of `names`: how far that name, set in this cell's font, would overrun it. */
  wouldOverrun: number[]
}

// Every laid-out cell a preset name is drawn in (lib/presetNameWidth's one hook), and how each of
// `names` would fit it — measured by laying the name out in a plain element in the cell's font.
const cells = (page: Page, names: string[]): Promise<Cell[]> =>
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

// ── Stock names ──────────────────────────────────────────────────────────────────────────────

test('stock names are drawn short everywhere, exactly when one of them would not fit somewhere', async ({
  page,
}) => {
  test.setTimeout(180_000)
  // Twelve presets, so the longest stock name is "Preset 12".
  const names = Array.from({ length: 12 }, (_, i) => defaultPresetName(i + 1))
  const short = names.map((name) => shortStockName(name)!)
  await openApp(page, { seed: { presets: presetsNamed(...names) } })
  await expect(topBar(page).preset).toContainText('Preset 1')

  const seen = { short: 0, full: 0, tooClose: 0 }
  for (let width = 280; width <= 480; width += 2) {
    await resizeTo(page, width, 844)
    const now = await cells(page, names)
    const at = `at ${width}px`
    expect(now.length, `${at}: name cells laid out`).toBeGreaterThan(0)
    // One form everywhere: every cell shows a full stock name, or every cell shows a short one.
    const drawnShort = now.map((cell) => short.includes(cell.text))
    const drawnFull = now.map((cell) => names.includes(cell.text))
    expect(
      drawnShort.every(Boolean) || drawnFull.every(Boolean),
      `${at}: one form everywhere (${[...new Set(now.map((c) => c.text))].join(', ')})`,
    ).toBe(true)
    // The worst case over every name and every cell: by how much the worst-placed name misses.
    const worst = Math.max(...now.flatMap((cell) => cell.wouldOverrun))
    if (Math.abs(worst) < CLOSE_PX) {
      seen.tooClose++
      continue
    }
    expect(
      drawnShort[0],
      `${at}: short form (a full name would overrun by ${worst.toFixed(2)}px)`,
    ).toBe(worst > 0)
    seen[worst > 0 ? 'short' : 'full']++
  }
  // The sweep crossed the width where the names change form, and was decided nearly everywhere.
  expect(seen.short, 'widths where names were short').toBeGreaterThan(0)
  expect(seen.full, 'widths where names were full').toBeGreaterThan(0)
  expect(seen.tooClose, 'widths too close to call').toBeLessThanOrEqual(3)
})

// ── The note under the rename box ────────────────────────────────────────────────────────────

const TYPED = 'Wednesday evening practice with a metronome'

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [1280, 800],
]) {
  test(`the note appears at the character where the name stops fitting, and a name saved either side of it is cut or whole as the note said, at ${width}×${height}`, async ({
    page,
  }) => {
    await openApp(page, { viewport: { width, height } })
    const dialog = await openPresetManager(page)
    const box = dialog.getByRole('textbox', { name: 'Preset name' })
    const note = dialog.getByText(NOTE, { exact: true }).and(page.locator('[aria-hidden="true"]'))
    await box.click()

    // Type the name a character at a time; at each length ask the page whether those words would
    // fit every cell, and whether the note is showing.
    let firstCut = 0
    for (let length = 1; length <= TYPED.length; length++) {
      const text = TYPED.slice(0, length)
      await box.fill(text)
      await settled(page)
      const worst = Math.max(...(await cells(page, [text.trim()])).map((c) => c.wouldOverrun[0]))
      const shown = await note.isVisible()
      if (Math.abs(worst) >= CLOSE_PX)
        expect(shown, `"${text}" (overruns by ${worst.toFixed(2)}px): the note`).toBe(worst > 0)
      if (shown && !firstCut) firstCut = length
      // Once a name is too long, a longer one is too.
      if (firstCut) expect(shown, `"${text}": the note stays`).toBe(true)
    }
    expect(firstCut, 'the name fitted for a while before it did not').toBeGreaterThan(1)
    // Said once to a screen reader, through the card's live region, while it is on screen.
    await expect(dialog.locator('[aria-live="polite"]')).toHaveText(NOTE)

    // Either side of that character, saved (leaving the box saves it) and looked at where it is
    // drawn: the top bar's button, behind the card.
    const drawn = async (text: string) => {
      await box.fill(text)
      await box.press('Enter')
      await expect(topBar(page).preset.locator('[data-preset-name-cell]')).toHaveText(text.trim())
      await settled(page)
      const showing = (await cells(page, [])).filter((cell) => cell.text === text.trim())
      expect(showing.length, `"${text}" is drawn somewhere`).toBeGreaterThan(0)
      return Math.max(...showing.map((cell) => cell.overrun))
    }
    const whole = await drawn(TYPED.slice(0, firstCut - 1))
    if (Math.abs(whole) >= CLOSE_PX) expect(whole, 'the last name without the note').toBeLessThan(0)
    await box.click()
    const cut = await drawn(TYPED.slice(0, firstCut))
    if (Math.abs(cut) >= CLOSE_PX) expect(cut, 'the first name with the note').toBeGreaterThan(0)
    // One of the two, at least, was decided — or this test met nothing.
    expect(Math.abs(whole) >= CLOSE_PX || Math.abs(cut) >= CLOSE_PX).toBe(true)
  })
}
