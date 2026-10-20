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

// ★ A COPY OF A LONG NAME CAN BE TOLD FROM ITS ORIGINAL: where a cell cuts the name, it is cut
// BEFORE its copy number, which stays on screen whole — in the top bar's button and in every row of
// the lists (the top bar's and Duplicate's) — and a screen reader still hears the whole name
// (components/PresetSwitcher's PresetOptionLabel, lib/presetNameText's copyNumberOf).
test('a long name is cut before its copy number, never through it', async ({ page }) => {
  const long = 'A rather long preset name for practising the hardest dates of all'
  const copy = `${long} (2)`
  await openApp(page, {
    seed: { presets: { ...presetsNamed('Preset 1', long, copy), activeId: 3 } },
  })
  // Every laid-out name cell showing the copy: its last characters, "(2)", lie inside the cell
  // (not past its clipped edge), and the name before them is cut.
  const copyCells = () =>
    page.evaluate((copy) => {
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
          const last = drawn.at(-1)!
          const end = document.createRange()
          end.setStart(last, last.length - 3)
          end.setEnd(last, last.length)
          const all = document.createRange()
          all.setStart(drawn[0], 0)
          all.setEnd(last, last.length)
          return {
            drawn: drawn.map((t) => t.data).join(''),
            numberLeft: end.getBoundingClientRect().left - box.left,
            numberRight: end.getBoundingClientRect().right - box.right,
            // (WebKit lays a cut name out short, and gives its hidden end a box of no width.)
            numberWidth: end.getBoundingClientRect().width,
            cut: all.getBoundingClientRect().width - box.width,
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
    await expect(page.getByRole('listbox', { name: 'Preset' })).toBeVisible()
    await expect(
      page.getByRole('listbox', { name: 'Preset' }).getByRole('option', { name: copy }),
    ).toBeVisible()
    await settled(page)
    const cells = await copyCells()
    // The button, its list's row, and the hidden copy of the list the app measures by.
    expect(cells.length, `${width}: the copy's name cells`).toBeGreaterThanOrEqual(2)
    for (const cell of cells) {
      expect(cell.drawn, `${width}: the copy's drawn name`).toBe(copy)
      expect(cell.cut, `${width}: the name is too long for the cell`).toBeGreaterThan(0)
      expect(cell.numberRight, `${width}: "(2)" ends inside the cell`).toBeLessThanOrEqual(SAME_PX)
      expect(cell.numberLeft, `${width}: "(2)" starts inside the cell`).toBeGreaterThan(0)
      expect(cell.numberWidth, `${width}: "(2)" is drawn`).toBeGreaterThan(1)
    }
    await page.keyboard.press('Escape')
  }
})
