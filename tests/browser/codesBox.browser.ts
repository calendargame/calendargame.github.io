// THE SHOW CODES BOX — one look in all six places it appears (the five modes and Lookup), written
// once (components/MethodBreakdown's CODES_BOX_CLASS): its top and bottom padding are EQUAL, and on
// the root's scale (py-2 = half a rem), so they grow and shrink with the app's fluid text like the
// stats strip beside them. It used to be a fixed 3px on top, the one part of the box that did not
// scale. Read on two windows whose roots differ, so "scales" is a measurement, not a reading of
// the class.
import { test, expect, openApp, resizeTo, switchMode } from './support/app'
import type { PageId } from '../../src/lib/modes'

const PLACES: PageId[] = ['classic', 'deduction', 'flash', 'aox', 'blitz', 'lookup']

test('the codes box has equal top and bottom padding, half the root’s size, in every place it appears', async ({
  page,
}) => {
  await openApp(page, { viewport: { width: 390, height: 844 } })
  const roots = new Set<number>()
  for (const [width, height] of [
    [390, 844],
    [568, 320], // a phone on its side: a smaller root
  ]) {
    await resizeTo(page, width, height)
    for (const place of PLACES) {
      await switchMode(page, place)
      // The box is the panel the visible Show Codes button controls (mounted whether open or not).
      const toggle = page
        .getByRole('button', { name: /^(Show|Hide) Codes$/ })
        .and(page.locator(':visible'))
      const box = page.locator(
        `#${await toggle.getAttribute('aria-controls')}`.replace(/:/g, '\\:'),
      )
      const { top, bottom, root } = await box.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          top: parseFloat(s.paddingTop),
          bottom: parseFloat(s.paddingBottom),
          root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        }
      })
      const at = `${place} at ${width}×${height}`
      expect(top, `${at}: top against bottom`).toBe(bottom)
      expect(top, `${at}: half the root (${root}px)`).toBeCloseTo(root / 2, 2)
      roots.add(root)
    }
  }
  expect(roots.size, 'the two windows had different roots').toBe(2)
})
