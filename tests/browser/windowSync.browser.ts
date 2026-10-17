// windowSync — TWO WINDOWS OF THE APP ON ONE DEVICE, IN A REAL BROWSER (design-q1-q2.md v4, 2.7 and
// 6.2): what one window saves reaches the other through the browser's own `storage` event and the
// windows-in-sync door, with no reload — the part jsdom cannot show, since there the events are
// delivered by hand.
import { test, expect, openApp, openSecondWindow, openSettings, answerRight } from './support/app'

test('a theme chosen in one window is worn by the other at once, both ways', async ({
  page,
  context,
}) => {
  await openApp(page, { theme: 'midnight' })
  const second = await openSecondWindow(context)
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'midnight')
  const panel = await openSettings(second)
  await panel.getByRole('radio', { name: 'Nebula', exact: true }).click()
  await second.keyboard.press('Escape')
  // The first window was not touched, and not reloaded: it wears the other window's choice.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nebula')
  // …and back the other way, from the first window this time.
  const first = await openSettings(page)
  await first.getByRole('radio', { name: 'Dusk', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dusk')
})

// ★ EVERY ANSWER COUNTS ONCE, WHICHEVER WINDOW MADE IT (design-q1-q2.md v4, G1): the two windows answer
// Classic in turn, and each shows the other's answers at once - the score in both reads every answer.
// (A window's question is drawn again when the other's answers come in, and for 300 ms after that a
// press answers nothing - the cue test below - so a press is repeated until it counts: once it has, the
// question is answered, and a press on it does nothing.)
test('an answer in either window is counted in both, at once — and none is lost', async ({
  page,
  context,
}) => {
  await openApp(page)
  const second = await openSecondWindow(context)
  const score = (p: typeof page) => p.locator('.panel:visible [data-statval]').first()
  const answerUntil = async (p: typeof page, shown: string) =>
    expect(async () => {
      await answerRight(p)
      await expect(score(p)).toHaveText(shown, { timeout: 500 })
    }).toPass()
  const next = (p: typeof page) =>
    p.getByRole('button', { name: 'New', exact: true }).and(p.locator(':visible')).click()
  await answerUntil(page, '1/1')
  await expect(score(second)).toHaveText('1/1')
  await next(second)
  await answerUntil(second, '2/2')
  await expect(score(page)).toHaveText('2/2')
  await next(page)
  await answerUntil(page, '3/3')
  await expect(score(second)).toHaveText('3/3')
})

// ★ THE CUE FOR A PRESS THAT DID NOT COUNT (design-q1-q2.md v4, 6.4; lib/unaskedSwap): another window's
// change replaces the question here — an older tab saving a new date format, which draws the waiting
// question again — and a key pressed in the moment after it answers nothing, and rings the button it
// pressed: a neutral inset ring, painted, then gone; under Reduce Motion too (no fade, the same ring).
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`a press just after another window replaced the question rings its button and answers nothing (motion: ${reducedMotion})`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion })
    await openApp(page, {
      seed: { settings: { randomFormat: false, dateFormat: 'numeric-ymd', minY: 1583 } },
    })
    const second = await openSecondWindow(context)
    // In the first window: the moment its answer grid is replaced, the key for Wednesday — a player
    // pressing as the question changed — and what the button then shows, once painted and later.
    await page.evaluate(() => {
      // (the grid on screen: every mode's screen stays mounted, the others hidden)
      const grid = () =>
        [...document.querySelectorAll<HTMLElement>('[data-answer-grid="true"]')].find(
          (g) => g.offsetParent !== null,
        )
      const first = grid()
      const seen = new MutationObserver(() => {
        const now = grid()
        if (!now || now === first) return
        seen.disconnect()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))
        const button = now.children[3] as HTMLElement
        const ring = () => {
          const style = getComputedStyle(button)
          return `${style.outlineStyle} ${style.outlineWidth}`
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const on = ring()
            setTimeout(() => {
              ;(window as unknown as { voidRing: object }).voidRing = { on, off: ring() }
            }, 700)
          }),
        )
      })
      seen.observe(document.body, { childList: true, subtree: true })
    })
    await second.evaluate(() => {
      const key = 'cg-settings-v1'
      const saved = JSON.parse(localStorage.getItem(key) ?? '{"state":{}}')
      localStorage.setItem(
        key,
        JSON.stringify({ state: { ...saved.state, dateFormat: 'numeric-dmy' }, version: 4 }),
      )
    })
    const ring = await page.waitForFunction(
      () => (window as unknown as { voidRing?: { on: string; off: string } }).voidRing,
    )
    const { on, off } = (await ring.jsonValue()) as { on: string; off: string }
    expect(on).toBe('solid 3px') // painted
    expect(off).toMatch(/^none /) // and gone
    // Nothing was answered: the score still reads 0/0.
    await expect(page.locator('.panel:visible [data-statval]').first()).toHaveText('0/0')
  })
}
