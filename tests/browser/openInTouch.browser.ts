// THE ⚙ MENU'S "OPEN IN" LIST, UNDER A FINGER (Round 26, two reports from the owner's iPhone):
//   1. A FLICK THAT STARTS ON THE PILL SCROLLS THE MENU AND OPENS NOTHING. On the phone it opened
//      the list as the finger lifted: iOS can end a touch that scrolled an inner region in a plain
//      pointerup on the control it began on (the control travelled with the finger) and send no
//      pointercancel, and lib/pointerGestures pressed that as a "moved" touch. The controller now
//      watches for the scroll itself (its ★ "a touch that scrolled anything is a scroll").
//   2. SLIDING ROUND AN OPEN LIST WORKS AS IT DOES IN THE TOP BAR'S LISTS — one mechanism, every
//      list a selection group (components/CustomSelect's listbox): a touch on an option rings
//      nothing; slide onto ANOTHER option while held and that one is ringed; lift there and it is
//      picked. The one deliberate difference stays: a press on the top bar's preset or mode button
//      opens its list at once and can slide straight into it; a press on the Open in pill opens
//      nothing until it is released on the pill.
//
// Real touches (Chromium's own input pipeline, which sends a pointercancel when a touch scrolls)
// and click-less sequences built in the page in the order the iPhone sends them (no pointercancel,
// no click — both engines). See tests/browser/touchPress.browser.ts's header for what neither can
// show: what iOS itself sends is the owner's phone's to confirm.
import { test, expect, openApp, openSettings, settled, topBar } from './support/app'
import { presetsNamed } from './support/seeds'
import type { CDPSession, Locator, Page } from '@playwright/test'

test.use({ hasTouch: true })

const SEED = { presets: presetsNamed('Preset 1', 'Speed', 'Evenings') }

async function centre(target: Locator) {
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const ringed = (list: Locator) =>
  list.evaluate((el) => [...el.querySelectorAll('.drag-target')].map((o) => o.textContent))

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

  // Desktop Chromium takes a finger moving down an open list for a pan and cancels the pointer
  // (measured: pointerdown, pointermove, pointercancel), so there a slide picks nothing — in the
  // top bar's list exactly as in Open in. What is asserted is that the two lists answer the same
  // slide the same way: one mechanism. (The slide itself is the click-less tests' below, and the
  // owner's phone's.)
  test('the open Open in list and the top bar’s preset list answer the same slide alike', async ({
    page,
  }) => {
    const { pill } = await openMenu(page)
    const outcome = async (list: Locator, shows: Locator) => {
      await expect(list).toBeVisible()
      const finger = await touchscreen(page)
      const a = await centre(list.getByRole('option', { name: 'Speed' }))
      await finger.down(a)
      await finger.move({ x: a.x + 3, y: a.y })
      const onTouch = await ringed(list)
      await finger.move(await centre(list.getByRole('option', { name: 'Evenings' })))
      const onSlide = await ringed(list)
      await finger.up()
      await settled(page)
      // What the button shows afterwards: the option on show, not the stacked ones it sizes by.
      const picked = await shows.locator('[aria-hidden="false"]').first().textContent()
      return { onTouch, onSlide, picked: picked?.includes('Evenings') }
    }
    await pill.click()
    const openIn = await outcome(openInList(page), pill)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await topBar(page).preset.click()
    const preset = await outcome(page.getByRole('listbox', { name: 'Preset' }), topBar(page).preset)
    expect(openIn.onTouch).toEqual([])
    expect(openIn).toEqual(preset)
  })
})

// ── 2. Sliding round the open list, in both engines ────────────────────────────────────────────

for (const where of ['Open in', 'the top bar’s preset list'] as const) {
  test(`${where}: a touch on an option rings nothing; slid onto another, held, that one is ringed; lifted there, it is picked`, async ({
    page,
  }) => {
    const { pill } = await openMenu(page)
    let list: Locator
    let shows: Locator
    if (where === 'Open in') {
      await pill.click()
      list = openInList(page)
      shows = pill
    } else {
      await page.keyboard.press('Escape') // the ⚙ menu away; the top bar's list instead
      await topBar(page).preset.click()
      list = page.getByRole('listbox', { name: 'Preset' })
      shows = topBar(page).preset
    }
    await expect(list).toBeVisible()
    const a = list.getByRole('option', { name: 'Speed' })
    const b = list.getByRole('option', { name: 'Evenings' })
    const finger = await synthetic(page)
    const fromA = await centre(a)
    await finger.down(fromA)
    await finger.move({ x: fromA.x + 3, y: fromA.y })
    expect(await ringed(list), 'a touch on one option').toEqual([])
    const toB = await centre(b)
    await finger.move(toB)
    expect(await ringed(list), 'slid onto another').toEqual(['Evenings'])
    await finger.up(toB)
    await expect(list).toHaveCount(0)
    await expect(shows).toHaveAccessibleName(/Evenings/)
  })
}

test('the one difference: a press on the top bar’s button opens its list at once and slides on into it; a press on the Open in pill opens nothing until it is lifted on the pill', async ({
  page,
}) => {
  const { pill } = await openMenu(page)
  const finger = await synthetic(page)
  // The pill: pressed, slid off it, lifted — nothing opened at any point.
  const at = await centre(pill)
  await finger.down(at)
  await expect(openInList(page)).toHaveCount(0)
  await finger.move({ x: at.x, y: at.y + 90 })
  await finger.up({ x: at.x, y: at.y + 90 })
  await settled(page)
  await expect(openInList(page)).toHaveCount(0)
  // The top bar's preset button: the press opens the list, and the same touch picks from it.
  await page.keyboard.press('Escape')
  const trigger = topBar(page).preset
  const t = await centre(trigger)
  await finger.down(t)
  const list = page.getByRole('listbox', { name: 'Preset' })
  await expect(list).toBeVisible()
  const target = await centre(list.getByRole('option', { name: 'Evenings' }))
  await finger.move(target)
  await finger.up(target)
  await expect(list).toHaveCount(0)
  await expect(trigger).toHaveAccessibleName(/Evenings/)
})
