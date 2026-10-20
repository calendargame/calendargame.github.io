// THE END OF THE ⚙ MENU'S LIST — scrolled as far as it goes, the last control (the Amnesic picker)
// is drawn whole: its bottom border is at or above the scroll area's bottom edge, never under it.
// The scroll area's height is fractional and the browser's furthest scroll position a whole pixel,
// so without the scroll area's one pixel of bottom padding up to a pixel of the last control could
// stay out of sight — on the owner's iPhone (430 wide, Round 25) the pill's bottom border was cut
// by 0.2px, and Chromium dropped the line outright. Swept a pixel at a time over the heights where
// he saw it, in both engines. And the pixel is taken back from the margin under the scroll area, so
// the distance from that control to the foot's line is what it was: the card's space-y-4.
import {
  test,
  expect,
  openApp,
  openSettings,
  resizeTo,
  settled,
  appReady,
  switchMode,
  SAME_PX,
} from './support/app'

test('scrolled to the end, the last control is drawn whole, and sits a rem above the foot', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openApp(page, { viewport: { width: 430, height: 860 } })
  const panel = await openSettings(page)
  const scroller = panel.locator('[data-drag-scroll]')
  const last = panel.getByRole('radiogroup', { name: 'Amnesic' })
  await expect(last).toBeVisible()
  for (let height = 860; height <= 880; height++) {
    await resizeTo(page, 430, height)
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await settled(page)
    const at = `at 430×${height}`
    const r = await page.evaluate(() => {
      const card = document.querySelector('#settings-popover')!
      const sc = card.querySelector('[data-drag-scroll]')!
      // The tray itself: the bordered housing inside the picker's group.
      const tray = card.querySelector(
        '[role="radiogroup"][aria-label="Amnesic"]',
      )!.lastElementChild!
      const foot = card.querySelector('.popover-sticky-footer')!
      return {
        overflows: sc.scrollHeight > sc.clientHeight,
        atEnd: Math.abs(sc.scrollHeight - sc.clientHeight - sc.scrollTop) < 1,
        last: tray.getBoundingClientRect().bottom,
        bottom: sc.getBoundingClientRect().bottom,
        footTop: foot.getBoundingClientRect().top,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      }
    })
    expect(r.overflows, `${at}: the list scrolls`).toBe(true)
    expect(r.atEnd, `${at}: scrolled to the end`).toBe(true)
    // At or above — not "within a tolerance of": the cut being fixed was a fifth of a pixel.
    expect(
      r.last,
      `${at}: the last control's bottom edge against the scroll area's`,
    ).toBeLessThanOrEqual(r.bottom)
    // The rem between the list and the foot is the card's space-y-4, as it always was: the pixel of
    // padding is taken back from the margin under the scroll area, so all that moves it is the
    // part of a pixel the whole-pixel scroll position leaves over, either way.
    const gap = r.footTop - r.last
    expect(
      Math.abs(gap - r.rem),
      `${at}: the last control to the foot's line, against a rem`,
    ).toBeLessThan(1)
  }
})

// THE SAME, FOR LOOKUP'S HISTORY LIST (Round 26): scrolled to the end, the last row's bottom border is
// at or above the list's bottom edge — it was under it by up to 0.9px at 360 wide before the list
// got its pixel of padding — and the panel's bottom padding gave that pixel back, so the padding
// under the last row is the rem it was.
test('Lookup: scrolled to the end, the last history row is drawn whole, with a rem of padding under it as before', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openApp(page)
  await page.evaluate(() =>
    window.localStorage.setItem(
      'cg-lookup-v1',
      JSON.stringify({
        state: {
          history: Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, y: 1900 + i, m: 3, d: 4 })),
        },
        version: 1,
      }),
    ),
  )
  await page.reload()
  await appReady(page)
  await switchMode(page, 'lookup')
  const list = page.locator('ul:has(li[data-row]):visible')
  for (const width of [360, 390])
    for (let height = 600; height <= 860; height += 3) {
      await resizeTo(page, width, height)
      // Twice: the list is windowed, so arriving at the end draws its last rows, which can change
      // how tall it is; the second scroll lands on the end as it then stands.
      for (let i = 0; i < 2; i++) {
        await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
        await settled(page)
      }
      const at = `at ${width}×${height}`
      const r = await list.evaluate((ul) => {
        const rows = [...ul.querySelectorAll('li[data-row] button')]
        const panel = ul.parentElement!
        return {
          atEnd: Math.abs(ul.scrollHeight - ul.clientHeight - ul.scrollTop) < 1,
          scrolls: ul.scrollHeight > ul.clientHeight,
          last: rows[rows.length - 1].getBoundingClientRect().bottom,
          bottom: ul.getBoundingClientRect().bottom,
          listPad: parseFloat(getComputedStyle(ul).paddingBottom),
          panelPad: parseFloat(getComputedStyle(panel).paddingBottom),
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        }
      })
      expect(r.scrolls, `${at}: the list scrolls`).toBe(true)
      expect(r.atEnd, `${at}: scrolled to the end`).toBe(true)
      expect(r.last, `${at}: the last row's bottom edge against the list's`).toBeLessThanOrEqual(
        r.bottom,
      )
      // …and the pixel is GIVEN BACK: the list's pixel of padding and the panel's bottom padding add
      // up to the rem the panel always had under its last row. (Asserted on the two paddings, not on
      // the last row's position: a history row's button sits a little above the bottom of its own row,
      // which no padding decides, and the whole-pixel scroll leaves its own fraction on top.)
      expect(
        Math.abs(r.listPad + r.panelPad - r.rem),
        `${at}: the padding under the last row`,
      ).toBeLessThanOrEqual(SAME_PX)
    }
})

// ★ THE END OF THE MENU CAN BE REACHED AT EVERY PHONE SIZE (Round 26 review: in WebKit, at 320×700,
// 344×800, 360×800, 360×900, 375×900, and 390×900, scrolling stopped 15 to 22px short and the
// Amnesic picker stayed out of sight — the trio's caption fit, measuring in the real buttons size
// after size, left WebKit's scroll range at an in-between height; components/SettingsPanel now
// measures in a ruler). Opened fresh at each size, as a player opens it, and scrolled as far as the
// browser will go.
for (const [width, height] of [
  [320, 700],
  [344, 800],
  [360, 800],
  [360, 900],
  [375, 900],
  [390, 900],
  [390, 844],
  [430, 932],
] as const)
  test(`at ${width}×${height}: the menu scrolls all the way to its last control`, async ({
    page,
  }) => {
    await openApp(page, { viewport: { width, height } })
    const panel = await openSettings(page)
    const scroller = panel.locator('[data-drag-scroll]')
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await settled(page)
    const r = await scroller.evaluate((sc) => {
      const tray = sc.querySelector('[role="radiogroup"][aria-label="Amnesic"]')!.lastElementChild!
      return {
        short: sc.scrollHeight - sc.clientHeight - sc.scrollTop,
        last: tray.getBoundingClientRect().bottom,
        bottom: sc.getBoundingClientRect().bottom,
      }
    })
    expect(r.short, 'scrolled to the end of what the menu holds').toBeLessThan(1)
    expect(r.last, "the last control's bottom edge against the scroll area's").toBeLessThanOrEqual(
      r.bottom,
    )
  })
