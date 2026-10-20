// THE ⚙ MENU'S SAVE DEFAULTS / RESET SETTINGS / FULL RESET CAPTIONS ARE NEVER CUT (Round 26 review:
// in Verdana "Reset Settings" was cut by 1.8px at 390 wide and 9.3px at 280; the fit that was to
// prevent it measured an inline span's scrollWidth, which is 0, and never ran). components/
// SettingsPanel's fitTrioCaptions: one shared size, shrunk no further than eleven twelfths of the
// panel's text tier; past that, a caption too wide for one line takes two, broken at its space.
// Held at the phone sizes and in three fonts — the machine's own, its serif, and its monospace (wider
// than any system font).
import { test, expect, openApp, openSettings, resizeTo, SAME_PX } from './support/app'

const SIZES: [number, number][] = [
  [280, 653],
  [320, 568],
  [360, 800],
  [390, 844],
  [430, 932],
]

for (const font of [null, 'serif', 'monospace'] as const)
  test(`${font ?? "the machine's own font"}: every caption whole inside its button, all three at one size`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openApp(page)
    if (font) await page.addStyleTag({ content: `html{font-family:${font} !important}` })
    const panel = await openSettings(page)
    const captions = panel.locator('[data-fitlabel]')
    await expect(captions).toHaveCount(3)
    for (const [width, height] of SIZES) {
      await resizeTo(page, width, height)
      const seen = await captions.evaluateAll((spans) =>
        spans.map((span) => {
          const button = span.parentElement!
          const cs = getComputedStyle(button)
          const box = button.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(span)
          const text = range.getBoundingClientRect()
          const lines = range.getClientRects().length
          return {
            caption: span.textContent,
            left:
              text.left - (box.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)),
            right:
              box.right -
              parseFloat(cs.paddingRight) -
              parseFloat(cs.borderRightWidth) -
              text.right,
            top: text.top - box.top,
            bottom: box.bottom - text.bottom,
            lines,
            size: parseFloat(cs.fontSize),
            tier: parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75,
          }
        }),
      )
      const at = `${width}×${height}`
      for (const c of seen) {
        expect(c.left, `${at}: "${c.caption}" starts inside its button`).toBeGreaterThanOrEqual(
          -SAME_PX,
        )
        expect(c.right, `${at}: "${c.caption}" ends inside its button`).toBeGreaterThanOrEqual(
          -SAME_PX,
        )
        expect(c.top, `${at}: "${c.caption}" inside its button's top`).toBeGreaterThanOrEqual(
          -SAME_PX,
        )
        expect(c.bottom, `${at}: "${c.caption}" inside its button's foot`).toBeGreaterThanOrEqual(
          -SAME_PX,
        )
        expect(c.lines, `${at}: "${c.caption}" in one or two lines`).toBeLessThanOrEqual(2)
        expect(c.size, `${at}: one size for all three`).toBe(seen[0].size)
        expect(c.size, `${at}: never above the panel's tier`).toBeLessThanOrEqual(c.tier + SAME_PX)
      }
      // On one line, a caption is never shrunk below the floor: two lines come first.
      if (seen.every((c) => c.lines === 1))
        expect(seen[0].size, `${at}: one line, at or above the floor`).toBeGreaterThanOrEqual(
          (seen[0].tier * 11) / 12 - SAME_PX,
        )
    }
  })
