// A PRESET NAME AND THE ROOM IT HAS — lib/presetNameWidth's two answers, checked against the page:
//   • a stock name ("Preset 3") is drawn short ("P3"), everywhere at once, exactly when some stock
//     name would not fit somewhere it is shown — and as its bare number ("3") exactly when some
//     stock name's "P" form would not fit either;
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
import { CLOSE_PX, expectStockNameShown, nameCells } from './support/presetNameCells'
import { defaultPresetName, shortStockName, stockNumber } from '../../src/store/presets'
import type { Page } from '@playwright/test'

const NOTE = 'Some places will show this name cut short.'

// ── Stock names ──────────────────────────────────────────────────────────────────────────────

test('stock names are drawn short everywhere, exactly when one of them would not fit somewhere — and as bare numbers exactly when a short one would not', async ({
  page,
}) => {
  test.setTimeout(180_000)
  // Twelve presets, so the longest stock name is "Preset 12".
  const names = Array.from({ length: 12 }, (_, i) => defaultPresetName(i + 1))
  const short = names.map((name) => shortStockName(name)!)
  const numbers = names.map((name) => stockNumber(name)!)
  await openApp(page, { seed: { presets: presetsNamed(...names) } })
  await expect(topBar(page).preset).toContainText('Preset 1')

  const seen = { full: 0, short: 0, number: 0, tooClose: 0 }
  for (let width = 240; width <= 480; width += 2) {
    await resizeTo(page, width, 844)
    const now = await nameCells(page, [...names, ...short])
    const at = `at ${width}px`
    expect(now.length, `${at}: name cells laid out`).toBeGreaterThan(0)
    // One form everywhere: every cell shows a full stock name, or every cell a short one, or every
    // cell a number. (A number that is itself cut is drawn with an ellipsis, so it is told by what
    // its cell holds — which is one of the numbers whatever is shown of it.)
    const drawn = (forms: string[]) => now.map((cell) => forms.includes(cell.text))
    const form = drawn(names).every(Boolean)
      ? 'full'
      : drawn(short).every(Boolean)
        ? 'short'
        : drawn(numbers).every(Boolean)
          ? 'number'
          : null
    expect(
      form,
      `${at}: one form everywhere (${[...new Set(now.map((c) => c.text))].join(', ')})`,
    ).not.toBeNull()
    // The worst case over every name and every cell: by how much the worst-placed name misses —
    // written in full, and in its "P" form.
    const worst = (from: number, to: number) =>
      Math.max(...now.flatMap((cell) => cell.wouldOverrun.slice(from, to)))
    const full = worst(0, names.length)
    const p = worst(names.length, names.length * 2)
    // ⚠ A "P" FORM THAT JUST FITS IS NOT TOO CLOSE TO CALL. A list is never narrower than a row
    // showing "P10"-"P99" whole (components/PresetSwitcher's one least width, rounded UP to a whole
    // pixel), so wherever that least width is what a row has, the widest "P" form fits it by a
    // hair, by construction — and must be drawn. Only a "P" form over by a hair is too close.
    if (Math.abs(full) < CLOSE_PX || (full > 0 && p > 0 && p < CLOSE_PX)) {
      seen.tooClose++
      continue
    }
    const expected = full <= 0 ? 'full' : p <= 0 ? 'short' : 'number'
    expect(
      form,
      `${at}: a full name would overrun by ${full.toFixed(2)}px, a "P" form by ${p.toFixed(2)}px`,
    ).toBe(expected)
    seen[expected]++
  }
  // The sweep crossed both widths where the names change form, and was decided nearly everywhere.
  expect(seen.full, 'widths where names were full').toBeGreaterThan(0)
  expect(seen.short, 'widths where names were short').toBeGreaterThan(0)
  expect(seen.number, 'widths where names were numbers').toBeGreaterThan(0)
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
      const worst = Math.max(
        ...(await nameCells(page, [text.trim()])).map((c) => c.wouldOverrun[0]),
      )
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
      const showing = (await nameCells(page, [])).filter((cell) => cell.text === text.trim())
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

// ── A name that draws nothing ────────────────────────────────────────────────────────────────
//
// store/presets' normalizePresetName calls a name empty when nothing in it is drawn: first by
// Unicode's rule, then — for a name that passes it — by drawing it in the page's font on this
// device (lib/presetNameInk). Three characters a player can paste that draw nothing: the blank
// Braille pattern (U+2800, named in the rule by hand), the Hangul filler (U+3164, which Unicode
// lists as ignorable), and the object replacement character (U+FFFC), which no table calls
// invisible — only drawing it finds it blank. And one that must be KEPT: a code point nothing is
// assigned to (U+0378), which a device has no picture for and draws as an empty box.
//
// THE ORACLE IS A SECOND DRAWING, made here: the name set in the page's font at another size on a
// fresh canvas, its pixels counted — the device's own answer to "does this show anything", asked
// independently of the app. Each of the three must BE blank on the engines this lane runs, or the
// test would be about nothing. Together they are not, everywhere: WebKit draws the object
// replacement character as nothing alone and as a box beside anything else (measured), so the
// three in one name are kept there and empty in Chromium — the app follows the device, and so does
// the test.

const inked = (page: Page, name: string) =>
  page.evaluate((name) => {
    const family = getComputedStyle(document.documentElement).fontFamily
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.canvas.width = 600
    ctx.canvas.height = 120
    ctx.font = `48px ${family}`
    ctx.fillText(name, 20, 80)
    return ctx.getImageData(0, 0, 600, 120).data.some((v, i) => i % 4 === 3 && v !== 0)
  }, name)

const savedNames = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('cg-presets-v1')
    return raw && (JSON.parse(raw).state.presets as { name: string }[]).map((p) => p.name)
  })

// The name the top bar's control is showing (it holds every preset's; the one on show is not
// aria-hidden).
const shownInBar = (page: Page) =>
  topBar(page).preset.locator('[aria-hidden="false"] [data-preset-name-cell]')

const BLANK = {
  'the blank Braille pattern': String.fromCodePoint(0x2800),
  'the Hangul filler': String.fromCodePoint(0x3164),
  'the object replacement character': String.fromCodePoint(0xfffc),
}
const TOGETHER = ` ${String.fromCodePoint(0xfffc, 0x2800, 0x3164, 0xfffc)} `
const NO_PICTURE = String.fromCodePoint(0x0378)

test('a name this device draws as nothing is an empty name: typed, it goes back to the stock name', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openPresetManager(page)
  const box = dialog.getByRole('textbox', { name: 'Preset name' })
  const rename = async (name: string, expected: string, what: string) => {
    await box.click()
    await box.fill('Mornings')
    await box.press('Enter')
    await expect(box, what).toHaveValue('Mornings')
    await box.click()
    await box.fill(name)
    await box.press('Enter')
    await expect(box, what).toHaveValue(expected)
    if (stockNumber(expected) !== null)
      await expectStockNameShown(page, shownInBar(page), expected, { what })
    else await expect(shownInBar(page), what).toHaveText(expected)
    expect(await savedNames(page), what).toEqual([expected])
  }
  for (const [what, name] of Object.entries(BLANK)) {
    expect(await inked(page, name), `${what} draws nothing here`).toBe(false)
    await rename(name, 'Preset 1', what)
  }
  const together = (await inked(page, TOGETHER.trim())) ? TOGETHER.trim() : 'Preset 1'
  await rename(TOGETHER, together, 'the three together')
  // A character with no picture is drawn as a box — something to see — and is kept.
  expect(await inked(page, NO_PICTURE), 'a box is drawn').toBe(true)
  await rename(NO_PICTURE, NO_PICTURE, 'a character with no picture')
})

test('a saved name this device draws as nothing is shown as the stock name, and the saved text is left alone', async ({
  page,
}) => {
  const blank = BLANK['the object replacement character']
  await openApp(page, { seed: { presets: presetsNamed(blank, 'Evenings') } })
  const before = await page.evaluate(() => window.localStorage.getItem('cg-presets-v1'))
  expect(before).toContain(blank)
  await expectStockNameShown(page, shownInBar(page), 'Preset 1')
  const dialog = await openPresetManager(page)
  const boxes = dialog.getByRole('textbox', { name: 'Preset name' })
  await expect(boxes.nth(0)).toHaveValue('Preset 1')
  await expect(boxes.nth(1)).toHaveValue('Evenings')
  expect(await page.evaluate(() => window.localStorage.getItem('cg-presets-v1'))).toBe(before)
})
