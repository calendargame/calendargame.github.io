// THE ⚙ MENU'S "OPEN IN" LIST, UNDER A FINGER (Round 26, from the owner's iPhone):
//   1. A FLICK THAT STARTS ON THE PILL SCROLLS THE MENU AND OPENS NOTHING. On the phone it opened
//      the list as the finger lifted: iOS can end a touch that scrolled an inner region in a plain
//      pointerup on the control it began on (the control travelled with the finger) and send no
//      pointercancel, and lib/pointerGestures pressed that as a "moved" touch. The controller now
//      watches for the scroll itself (its ★ "a touch that scrolled anything is a scroll").
//
// Real touches (Chromium's own input pipeline, which sends a pointercancel when a touch scrolls)
// and click-less sequences built in the page in the order the iPhone sends them (no pointercancel,
// no click — both engines). See tests/browser/touchPress.browser.ts's header for what neither can
// show: what iOS itself sends is the owner's phone's to confirm.
import { test, expect, openApp, openSettings, settled } from './support/app'
import { presetsNamed } from './support/seeds'
import type { CDPSession, Locator, Page } from '@playwright/test'

test.use({ hasTouch: true })

const SEED = { presets: presetsNamed('Preset 1', 'Speed', 'Evenings') }

async function centre(target: Locator) {
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// ── Touches built in the page: pointer and touch events, no pointercancel and no click ─────────
// Each step is dispatched on what is under the finger at that moment, as a browser does.
async function synthetic(page: Page) {
  const at = (type: string, x: number, y: number, touch?: 'start' | 'end') =>
    page.evaluate(
      ({ type, x, y, touch }) => {
        const el = document.elementFromPoint(x, y)!
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 52,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        )
        if (touch) {
          const e = new Event(`touch${touch}`, { bubbles: true, cancelable: true })
          Object.defineProperty(e, 'touches', { value: { length: touch === 'start' ? 1 : 0 } })
          el.dispatchEvent(e)
        }
      },
      { type, x, y, touch },
    )
  return {
    down: (p: { x: number; y: number }) => at('pointerdown', p.x, p.y, 'start'),
    move: (p: { x: number; y: number }) => at('pointermove', p.x, p.y),
    up: (p: { x: number; y: number }) => at('pointerup', p.x, p.y, 'end'),
  }
}

// ── Real touches, Chromium only ────────────────────────────────────────────────────────────────
async function touchscreen(page: Page) {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  return {
    down: (p: { x: number; y: number }) => send('touchStart', p.x, p.y),
    move: (p: { x: number; y: number }) => send('touchMove', p.x, p.y),
    up: () => send('touchEnd'),
  }
}

async function openMenu(page: Page) {
  await openApp(page, { seed: SEED })
  const panel = await openSettings(page)
  const pill = panel.getByRole('button', { name: /^Open in,/ })
  const scroller = panel.locator('[data-drag-scroll]').first()
  expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(80)
  return { panel, pill, scroller }
}
const openInList = (page: Page) => page.getByRole('listbox', { name: 'Open in' })

// ── 1. A flick that starts on the pill ─────────────────────────────────────────────────────────

test('a flick that starts on the Open in pill scrolls the menu, and opens nothing — the touch the iPhone sends', async ({
  page,
}) => {
  const { pill, scroller } = await openMenu(page)
  const from = await centre(pill)
  const finger = await synthetic(page)
  await finger.down(from)
  // The finger travels 60px up and the menu scrolls under it by as much: the pill goes with it, so
  // the finger lifts on the pill again — with no pointercancel, as iOS can send it.
  for (let dy = 10; dy <= 60; dy += 10) {
    await finger.move({ x: from.x, y: from.y - dy })
    await scroller.evaluate((el) => (el.scrollTop += 10))
    await settled(page) // the scroll event, as the page hears it while the finger moves
  }
  await finger.up(await centre(pill))
  await settled(page)
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(openInList(page)).toHaveCount(0)
  await expect(pill).toHaveAttribute('aria-expanded', 'false')
})

test('…and a press on the pill that did NOT scroll anything still opens it, however long it was held', async ({
  page,
}) => {
  const { pill } = await openMenu(page)
  const at = await centre(pill)
  const finger = await synthetic(page)
  await finger.down(at)
  await page.waitForTimeout(600) // the finger is down: a long press, which brings no click
  await finger.up(at)
  await expect(openInList(page)).toBeVisible()
})

test.describe('real touches (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'DevTools input is Chromium’s')

  test('a flick that starts on the Open in pill scrolls the menu, and opens nothing', async ({
    page,
  }) => {
    const { pill, scroller } = await openMenu(page)
    const from = await centre(pill)
    const finger = await touchscreen(page)
    await finger.down(from)
    for (let dy = 10; dy <= 120; dy += 10) await finger.move({ x: from.x, y: from.y - dy })
    await finger.up()
    await settled(page)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(openInList(page)).toHaveCount(0)
  })
})
