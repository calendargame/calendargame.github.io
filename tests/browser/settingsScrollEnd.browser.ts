// THE END OF THE ⚙ MENU'S LIST — scrolled as far as it goes, the last control (the Amnesic picker)
// is drawn whole: its bottom border is at or above the scroll area's bottom edge, never under it.
// The scroll area's height is fractional and the browser's furthest scroll position a whole pixel,
// so without the scroll area's one pixel of bottom padding up to a pixel of the last control could
// stay out of sight — on the owner's iPhone (430 wide, Round 25) the pill's bottom border was cut
// by 0.2px, and Chromium dropped the line outright. Swept a pixel at a time over the heights where
// he saw it, in both engines. And the pixel is taken back from the margin under the scroll area, so
// the distance from that control to the foot's line is what it was: the card's space-y-4.
import { test, expect, openApp, openSettings, resizeTo, settled } from './support/app'

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
