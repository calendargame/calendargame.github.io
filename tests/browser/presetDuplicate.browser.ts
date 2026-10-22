// DUPLICATE PRESET (Round 26, Q5), in a real browser: the Duplicate button beside New Preset opens a
// list of the presets over the Manage Presets popup, a choice makes a copy DIRECTLY AFTER its
// original, and the list of presets scrolls to show it — however far down a long list it lands.
import {
  test,
  expect,
  openApp,
  openPresetManager,
  rectOf,
  resizeTo,
  settled,
  topBar,
  SAME_PX,
} from './support/app'
import { presetsNamed } from './support/seeds'
import { expectStockNameShown } from './support/presetNameCells'
import type { Locator } from '@playwright/test'

test('a copy lands right under its original, and a long list scrolls to show it', async ({
  page,
}) => {
  const names = Array.from({ length: 24 }, (_, i) => `Practice ${i + 1}`)
  await openApp(page, { seed: { presets: presetsNamed(...names) } })
  const dialog = await openPresetManager(page)
  const boxes = dialog.getByRole('textbox', { name: 'Preset name' })
  const list = boxes.first().locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  await expect(boxes).toHaveCount(24)

  const button = dialog.getByRole('button', { name: 'Duplicate' })
  await button.click()
  const menu = page.getByRole('listbox', { name: 'Preset to duplicate' })
  await expect(menu).toBeVisible()
  // The list hangs over the popup, and its rows can be reached and pressed there.
  const choice = menu.getByRole('option', { name: 'Practice 22' })
  await choice.scrollIntoViewIfNeeded()
  await choice.click()
  await expect(menu).toHaveCount(0)
  await expect(boxes).toHaveCount(25)
  await expect(boxes.nth(22)).toHaveValue('Practice 22 (2)')
  await expect(boxes.nth(23)).toHaveValue('Practice 23')
  await settled(page)
  // The copy is on screen inside the list's own box — which had to scroll to show it.
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const [row, region] = await Promise.all([rectOf(boxes.nth(22)), rectOf(list)])
  expect(row.top).toBeGreaterThanOrEqual(region.top - SAME_PX)
  expect(row.bottom).toBeLessThanOrEqual(region.bottom + SAME_PX)
  // The preset you are on is still the first: a copy is not a switch.
  await expect(
    page.locator('header').getByRole('button', { name: /^Preset, Practice 1\b/ }),
  ).toBeVisible()
})

// ★ THE LIST STAYS ON SCREEN, INSIDE THE APP'S SIDE GUTTER (1rem, the top bar's own inset), in any
// font and at any width. It is as wide as its longest name and hangs from the Duplicate button —
// which sits in the right half of its row — so a long name once sent it off the left edge of the
// screen (21px at 320 wide). components/CustomSelect's LIST_GUTTER_REM.
for (const font of [null, 'serif', 'monospace'] as const) {
  test(`the Duplicate list stays inside the side gutter at every width (${font ?? 'the app font'})`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const long = 'A rather long preset name for practising the hardest dates of all'
    await openApp(page, { seed: { presets: presetsNamed('Preset 1', long, 'Speed') } })
    if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
    for (const [width, height] of [
      [280, 653],
      [320, 568],
      [360, 780],
      [390, 844],
      [430, 932],
    ]) {
      await resizeTo(page, width, height)
      const dialog = await openPresetManager(page)
      const button = dialog.getByRole('button', { name: 'Duplicate' })
      await button.click()
      const menu = page.getByRole('listbox', { name: 'Preset to duplicate' })
      await expect(menu).toBeVisible()
      await settled(page)
      const at = `${width}×${height}`
      const [list, trigger, gutter] = await Promise.all([
        rectOf(menu),
        rectOf(button),
        page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
      ])
      expect(list.left, `${at}: the list's left edge`).toBeGreaterThanOrEqual(gutter - SAME_PX)
      expect(width - list.right, `${at}: the list's right edge`).toBeGreaterThanOrEqual(
        gutter - SAME_PX,
      )
      // Where there is room it still hangs from its button's right edge.
      if (list.width <= trigger.right - gutter)
        expect(Math.abs(list.right - trigger.right), `${at}: hangs from its button`).toBeLessThan(
          SAME_PX,
        )
      // The long name is in it, cut short only if the screen is too narrow for it whole.
      await expect(menu.getByRole('option', { name: long })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('#settings-popover')).toHaveCount(0)
    }
  })
}

// ★ A COPY OF A LONG NAME CAN BE TOLD FROM ITS ORIGINAL: where a cell cuts the name and has room for
// "…" and the copy number, the name is cut BEFORE its number, which stays on screen whole — in the
// top bar's button and in every row of the lists (the top bar's and Duplicate's) — and where a cell
// is too narrow even for that, the name is cut at its end as any name is: never a number cut
// part-way. A screen reader hears the whole name either way (components/PresetSwitcher's
// NameCutBeforeNumber says the rule). Held as the RULE, in each cell's own font, in three fonts (the
// machine's, its serif, and its monospace — wider than any system font, as the Linux runner's are
// wider than Windows'), so which of the two a cell draws is the font's to decide, not the test's.
for (const font of [null, 'serif', 'monospace'] as const)
  test(`a long name is cut before its copy number, never through it (${font ?? 'the app font'})`, async ({
    page,
  }) => {
    const long = 'A rather long preset name for practising the hardest dates of all'
    const copy = `${long} (2)`
    await openApp(page, {
      seed: { presets: { ...presetsNamed('Preset 1', long, copy), activeId: 3 } },
    })
    if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
    // Every laid-out name cell drawing the copy, and what the rule asks of it.
    const copyCells = () =>
      page.evaluate((copy) => {
        const ctx = document.createElement('canvas').getContext('2d')!
        const widthIn = (font: string, text: string) => {
          ctx.font = font
          return ctx.measureText(text).width
        }
        return [...document.querySelectorAll('[data-preset-name-cell]')]
          .filter((cell) => cell.getClientRects().length > 0)
          .map((cell) => {
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
            const drawn: Text[] = []
            for (let n = walker.nextNode(); n; n = walker.nextNode())
              if (!n.parentElement!.closest('.sr-only')) drawn.push(n as Text)
            return { cell, drawn }
          })
          .filter(({ drawn }) => drawn.map((t) => t.data).join('') === copy)
          .map(({ cell, drawn }) => {
            const box = cell.getBoundingClientRect()
            const font = getComputedStyle(cell).font
            const last = drawn.at(-1)!
            const end = document.createRange()
            end.setStart(last, last.length - 3)
            end.setEnd(last, last.length)
            const n = end.getBoundingClientRect()
            return {
              // What the rule needs to know, in this cell's font.
              fitsWhole: widthIn(font, copy) <= box.width,
              roomForNumber: widthIn(font, '… (2)') + 1 <= box.width,
              // What is drawn: two pieces (the number its own), or one.
              pieces: drawn.length,
              // The number's three characters against the cell, as laid out.
              numberLeft: n.left - box.left,
              numberRight: n.right - box.right,
              // (WebKit lays a cut name out short, and gives its hidden end a box of no width.)
              numberWidth: n.width,
            }
          })
      }, copy)
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ]) {
      await resizeTo(page, width, height)
      await expect(topBar(page).preset).toHaveAccessibleName(`Preset, ${copy}`)
      await topBar(page).preset.click()
      await expect(
        page.getByRole('listbox', { name: 'Preset' }).getByRole('option', { name: copy }),
      ).toBeVisible()
      await settled(page)
      const cells = await copyCells()
      // The button, its list's row, and the hidden copy of the list the app measures by.
      expect(cells.length, `${width}: the copy's name cells`).toBeGreaterThanOrEqual(2)
      for (const [i, c] of cells.entries()) {
        const at = `${width}, cell ${i + 1}`
        expect(c.fitsWhole, `${at}: the name is too long for the cell`).toBe(false)
        if (c.roomForNumber) {
          // Room for "…" and the number: the number is its own piece, whole, inside the cell.
          expect(c.pieces, `${at}: the name and its number, two pieces`).toBe(2)
          expect(c.numberRight, `${at}: "(2)" ends inside the cell`).toBeLessThanOrEqual(SAME_PX)
          expect(c.numberLeft, `${at}: "(2)" starts inside the cell`).toBeGreaterThan(0)
          expect(c.numberWidth, `${at}: "(2)" is drawn`).toBeGreaterThan(1)
        } else {
          // Too narrow: the name cut at its end, as any name — one piece, never a number cut part-way.
          expect(c.pieces, `${at}: the name in one piece, cut at its end`).toBe(1)
        }
      }
      await page.keyboard.press('Escape')
    }
  })

// ★ THE DUPLICATE LIST IS ONE OF THE PLACES A NAME IS SHOWN, and takes the app's one answer for a
// ready-made name ("Preset 1", "P1", or "1" — components/PresetSwitcher's ★★ "drawn short"): where
// the top bar's list cannot show "Preset 1", this list shows "P1" too, though it has room for more;
// with room everywhere, it shows "Preset 1". (The Round 26 review saw "P1" here at 288 wide and asked
// whether the rule was misapplied: it is the rule.)
for (const [width, height] of [
  [288, 640],
  [390, 844],
])
  test(`at ${width}×${height}: the Duplicate list shows a ready-made name in the form the whole app does`, async ({
    page,
  }) => {
    await openApp(page, {
      viewport: { width, height },
      seed: { presets: presetsNamed('Preset 1', 'Preset 2') },
    })
    const dialog = await openPresetManager(page)
    await dialog.getByRole('button', { name: 'Duplicate' }).click()
    const menu = page.getByRole('listbox', { name: 'Preset to duplicate' })
    await expect(menu).toBeVisible()
    await settled(page)
    const stockNames = ['Preset 1', 'Preset 2']
    for (const [i, name] of stockNames.entries())
      await expectStockNameShown(
        page,
        menu.getByRole('option').nth(i).locator('[data-preset-name-cell]'),
        name,
        { stockNames, what: `the Duplicate list's "${name}"` },
      )
    // …and in the very form the top bar's button shows.
    const drawn = (cell: Locator) => cell.evaluate((c) => c.firstElementChild?.textContent)
    expect(await drawn(menu.getByRole('option').first().locator('[data-preset-name-cell]'))).toBe(
      await drawn(topBar(page).preset.locator('[data-preset-name-cell]:visible').first()),
    )
  })

// ★ …AND IN MANAGE PRESETS' NAME BOXES, WHILE THEY ARE NOT BEING TYPED IN (Round 26 review): a box
// shows its text from the start and clips the rest, so a long name and its copy read alike to the
// box's edge. Not typed in, a copy's box draws its name cut before its "(2)", inside the box; the box
// still holds the whole name; typed in, it is the box's own text again, whole and selectable.
test('a copy’s name box, not typed in, shows its "(2)"; typed in, the whole name', async ({
  page,
}) => {
  const long = 'A rather long preset name for practising the hardest dates of all'
  const copy = `${long} (2)`
  const dialog = await (async () => {
    await openApp(page, { seed: { presets: presetsNamed(long, copy) } })
    return openPresetManager(page)
  })()
  const box = dialog.getByRole('textbox', { name: 'Preset name' }).nth(1)
  await expect(box).toHaveValue(copy)
  const drawn = () =>
    box.evaluate((input) => {
      const art = input.nextElementSibling
      if (!art || !art.matches('[class*="pointer-events-none"]')) return null
      const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT)
      const texts: Text[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
      const last = texts.at(-1)!
      const end = document.createRange()
      end.setStart(last, last.length - 3)
      end.setEnd(last, last.length)
      const r = end.getBoundingClientRect()
      const b = input.getBoundingClientRect()
      return {
        text: texts.map((t) => t.data).join(''),
        numberInside: r.width > 1 && r.left > b.left && r.right <= b.right,
        boxText: getComputedStyle(input).color,
      }
    })
  const unfocused = await drawn()
  expect(unfocused, 'the drawn name over the box').not.toBeNull()
  expect(unfocused!.text).toBe(copy)
  expect(unfocused!.numberInside, '"(2)" drawn inside the box').toBe(true)
  expect(unfocused!.boxText, "the box's own text is clear under the drawing").toMatch(
    /rgba\(0, 0, 0, 0\)|transparent/,
  )
  await box.focus()
  await expect.poll(drawn).toBeNull()
  await expect(box).toHaveValue(copy)
})

// NEW PRESET AND DUPLICATE ARE HALF AND HALF (the row's own design; the owner's report, 2026-10-21:
// they were not — as flex items, New Preset's padding was added to its half before the halves were
// shared). Equal at every width, in both engines, to the pixel.
test('New Preset and Duplicate are the same width at every width', async ({ page }) => {
  await openApp(page)
  const dialog = await openPresetManager(page)
  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 800 })
    await settled(page)
    const [made, copy] = await Promise.all([
      rectOf(dialog.getByRole('button', { name: 'New Preset' })),
      rectOf(dialog.getByRole('button', { name: 'Duplicate' })),
    ])
    expect(Math.abs(made.width - copy.width), `${width}px: the same width`).toBeLessThanOrEqual(
      SAME_PX,
    )
    expect(Math.abs(made.top - copy.top), `${width}px: on one line`).toBeLessThanOrEqual(SAME_PX)
  }
})
