// A PRESS IS ONE PRESS, HOWEVER THE FINGER GETS THERE (Round 26, Q3). lib/pointerGestures presses a
// control itself when a touch that is not a quick tap lifts on it — the owner's iPhone sends no click
// for a press held a couple of seconds, or moved about and brought back — and cancels the second
// touch of a double tap, which is what stops iOS's text magnifier. tests/pointerGestures proves the
// rules in jsdom; this proves them in real engines, on the real app, and above all that nothing is
// ever pressed TWICE.
//
// THE CONTROL UNDER TEST is the mode screen's Show Codes button: a press toggles it, so its state is
// the count of presses that reached the app — one press opens the codes, a second (a double press)
// would close them again — and every click that arrives at it is counted as well.
//
// TWO KINDS OF TOUCH:
//   • REAL ones (Chromium only): sent through the browser's own input pipeline (DevTools'
//     Input.dispatchTouchEvent), so Chromium's gesture recogniser decides whether a click follows.
//     Unlike the iPhone, desktop Chromium DOES click after a 900 ms hold (measured on a bare page) —
//     so here a long press is the double-press hazard rather than the lost one: the controller
//     presses on lifting, and the click Chromium would add must not arrive.
//   • CLICK-LESS SEQUENCES (both engines): pointer and touch events built in the page, in the order
//     the owner's iPhone logged them, with no click after — what iOS sends for a long or moved press.
//     They prove the controller's plumbing in WebKit; they cannot prove what WebKit on a phone
//     synthesises.
// ⚠ WHAT NO ENGINE HERE CAN SHOW: Playwright's WebKit is the desktop engine with touch switched on,
// not iOS. It has no long-press recogniser, no text magnifier, no momentum scrolling, and never
// decides on its own to withhold a click. Whether the lens stays away, whether a cancelled
// touchstart keeps its pointer events on a phone, and how a touch that stops a coasting list
// behaves are the owner's iPhone's to show.
//
// ⚠ THE HOLDS ARE INPUT, NOT WAITS. A long press IS a finger held for a while; the time below is
// how long the finger is down, not a guess at how long the app takes. Nothing is asserted until the
// press is over, and then the resting state is read.
import { test, expect, openApp, openSettings, settled, switchMode, topBar } from './support/app'
import type { CDPSession, Locator, Page } from '@playwright/test'

test.use({ hasTouch: true })

const HOLD_MS = 900 // a long press: three times the controller's tap limit
const DOUBLE_TAP_GAP_MS = 120 // a quick double tap's second touch

const codesButton = (page: Page) => page.locator('button[data-key="C"]:visible')

// Every click that reaches the button (a swallowed click never does: the controller stops it on the
// document, on its way down), and who made it: 'browser' for the browser's own (trusted) click,
// 'app' for the press the controller made itself.
type Clicked = HTMLElement & { clicks?: ('browser' | 'app')[] }
async function countClicks(target: Locator) {
  await target.evaluate((el: Clicked) => {
    const clicks: ('browser' | 'app')[] = (el.clicks = [])
    el.addEventListener('click', (e) => void clicks.push(e.isTrusted ? 'browser' : 'app'))
  })
}
const clicksBy = (target: Locator) => target.evaluate((el: Clicked) => el.clicks ?? [])
const clicksSeen = async (target: Locator) => (await clicksBy(target)).length

async function centre(target: Locator) {
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const hold = (page: Page, ms: number) => page.waitForTimeout(ms) // the finger is down (see the header)

async function openOnCodes(page: Page) {
  await openApp(page)
  const codes = codesButton(page)
  await expect(codes).toHaveAttribute('aria-expanded', 'false')
  await countClicks(codes)
  // Every touchstart the page saw, and whether the controller cancelled it — read in the bubble
  // phase, after the controller's capture-phase listener has had its say.
  await page.evaluate(() => {
    const w = window as unknown as { touchStarts: boolean[] }
    w.touchStarts = []
    window.addEventListener('touchstart', (e) => w.touchStarts.push(e.defaultPrevented))
  })
  return codes
}
const touchStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { touchStarts: boolean[] }).touchStarts)

// ── REAL touches, through Chromium's own input pipeline ─────────────────────────────────────────
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

test.describe('real touches (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'DevTools input is Chromium’s')

  test('a quick tap presses the button once — the browser’s own click, as always', async ({
    page,
  }) => {
    const codes = await openOnCodes(page)
    const finger = await touchscreen(page)
    await finger.down(await centre(codes))
    await finger.up()
    await expect(codes).toHaveAttribute('aria-expanded', 'true')
    expect(await clicksBy(codes)).toEqual(['browser'])
  })

  test('a LONG press is pressed once, by the controller — the click Chromium would add is withheld', async ({
    page,
  }) => {
    const codes = await openOnCodes(page)
    const finger = await touchscreen(page)
    await finger.down(await centre(codes))
    await hold(page, HOLD_MS)
    await finger.up()
    await expect(codes).toHaveAttribute('aria-expanded', 'true')
    await settled(page)
    // Pressed by the controller, and by nothing else: Chromium would have clicked too (see the
    // header), and the cancelled touchend is what stops it.
    expect(await clicksBy(codes)).toEqual(['app'])
  })

  test('the owner’s drag: around the answers and back onto the first, then lifted — that answer, once', async ({
    page,
  }) => {
    await openApp(page)
    const answers = page.locator('[data-answer-grid]:visible button')
    const [first, second] = [answers.nth(0), answers.nth(1)]
    await countClicks(first)
    await countClicks(second)
    const unanswered = await first.getAttribute('class')
    const finger = await touchscreen(page)
    const from = await centre(first)
    const via = await centre(second)
    await finger.down(from)
    for (const t of [0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0])
      await finger.move({ x: from.x + (via.x - from.x) * t, y: from.y + (via.y - from.y) * t })
    await hold(page, HOLD_MS)
    await finger.up()
    await expect(first).not.toHaveAttribute('class', unanswered!) // the answer was given
    await settled(page)
    expect(await clicksSeen(first)).toBe(1)
    expect(await clicksSeen(second)).toBe(0)
  })

  test('a press that slides off and lifts elsewhere still presses nothing', async ({ page }) => {
    const codes = await openOnCodes(page)
    const finger = await touchscreen(page)
    const at = await centre(codes)
    const box = (await codes.boundingBox())!
    await finger.down(at)
    await hold(page, HOLD_MS)
    await finger.move({ x: at.x, y: box.y + box.height + 60 })
    await finger.up()
    await settled(page)
    await expect(codes).toHaveAttribute('aria-expanded', 'false')
    expect(await clicksSeen(codes)).toBe(0)
  })

  test('a double tap and hold: the second touch is cancelled at its start, and each tap presses once', async ({
    page,
  }) => {
    const codes = await openOnCodes(page)
    const finger = await touchscreen(page)
    const at = await centre(codes)
    await finger.down(at)
    await finger.up()
    await expect(codes).toHaveAttribute('aria-expanded', 'true')
    await hold(page, DOUBLE_TAP_GAP_MS)
    await finger.down(at)
    await hold(page, HOLD_MS)
    await finger.up()
    await expect(codes).toHaveAttribute('aria-expanded', 'false') // two presses: open, then shut
    await settled(page)
    expect(await clicksSeen(codes)).toBe(2)
    expect(await touchStarts(page)).toEqual([false, true])
  })

  test('a scroll that starts on a button scrolls, and presses nothing — wherever it ends', async ({
    page,
  }) => {
    await openApp(page)
    const panel = await openSettings(page)
    const scroller = panel.locator('[data-drag-scroll]').first()
    // A button in the middle of the panel's visible part, with room to scroll the panel under it.
    await scroller.evaluate((el) => {
      const view = el.getBoundingClientRect()
      const mid = (view.top + view.bottom) / 2
      const near = [...el.querySelectorAll('button')]
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && r.top > view.top && r.bottom < view.bottom)
        .sort((p, q) => Math.abs(p.r.top - mid) - Math.abs(q.r.top - mid))[0]
      near.b.setAttribute('data-touch-target', '')
    })
    const target = scroller.locator('[data-touch-target]')
    await countClicks(target)
    const before = await scroller.evaluate((el) => el.scrollTop)
    const finger = await touchscreen(page)
    const at = await centre(target)
    await finger.down(at)
    for (let dy = 10; dy <= 200; dy += 10) await finger.move({ x: at.x, y: at.y - dy })
    await hold(page, HOLD_MS) // held at the end, as a slow scroll is
    await finger.up()
    await settled(page)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
    expect(await clicksSeen(target)).toBe(0)
  })

  test('a MOUSE held down is the browser’s, as before: one click on release', async ({ page }) => {
    const codes = await openOnCodes(page)
    const at = await centre(codes)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await hold(page, HOLD_MS)
    await page.mouse.up()
    await expect(codes).toHaveAttribute('aria-expanded', 'true')
    expect(await clicksSeen(codes)).toBe(1)
  })

  test('a row of a drop-down list, held: chosen once, and the list closes', async ({ page }) => {
    await openApp(page)
    const finger = await touchscreen(page)
    await finger.down(await centre(topBar(page).mode))
    await finger.up()
    const row = page.getByRole('option', { name: 'Blitz' })
    await expect(row).toBeVisible()
    await countClicks(row)
    // Held by its element, not found again by role: choosing the row closes the list and takes the
    // row out of the page.
    const chosen = (await row.elementHandle())!
    await finger.down(await centre(row))
    await hold(page, HOLD_MS)
    await finger.up()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(
      topBar(page).mode.locator('[aria-hidden="false"]', { hasText: 'Blitz' }),
    ).toBeVisible()
    expect(await chosen.evaluate((el: Clicked) => el.clicks)).toEqual(['app'])
  })

  test('a slider still drags — even straight after a tap, when a control’s touch would be withheld', async ({
    page,
  }) => {
    await openApp(page)
    await switchMode(page, 'blitz')
    const slider = page.locator('input[type="range"]:visible').first()
    const before = await slider.inputValue()
    const finger = await touchscreen(page)
    await finger.down(await centre(codesButton(page))) // a tap, so the next touch is a double tap's
    await finger.up()
    const box = (await slider.boundingBox())!
    const y = box.y + box.height / 2
    await finger.down({ x: box.x + box.width / 2, y })
    for (let dx = 10; dx <= 80; dx += 10) await finger.move({ x: box.x + box.width / 2 + dx, y })
    await finger.up()
    await settled(page)
    expect(Number(await slider.inputValue())).toBeGreaterThan(Number(before))
  })
})

// ── CLICK-LESS sequences, in both engines ─────────────────────────────────────────────────────
// What the owner's iPhone sent for a press held on a button: pointerdown, touchstart, pointerup,
// touchend — and no click. Built in the page and dispatched where the finger is.
interface Sequence {
  /** How long the finger stays down. */
  holdMs: number
  /** Whether a click follows the touch, as the browser sends one after a quick tap. */
  click?: boolean
}
async function clickless(page: Page, target: Locator, { holdMs, click = false }: Sequence) {
  const at = await centre(target)
  return page.evaluate(
    async ({ x, y, holdMs, click }) => {
      const el = document.elementFromPoint(x, y)!
      const pointer = (type: string) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 41,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        )
      // A plain event carrying `touches`: WebKit refuses to construct a Touch from a page, and the
      // controller reads nothing else of a touch event.
      const touch = (type: string, down: boolean) => {
        const e = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(e, 'touches', { value: { length: down ? 1 : 0 } })
        el.dispatchEvent(e)
        return e.defaultPrevented
      }
      pointer('pointerdown')
      const startCancelled = touch('touchstart', true)
      await new Promise((r) => setTimeout(r, holdMs))
      pointer('pointerup')
      const endCancelled = touch('touchend', false)
      if (click) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return { startCancelled, endCancelled }
    },
    { ...at, holdMs, click },
  )
}

test('click-less: a press held on a button and lifted brings no click, and is pressed once', async ({
  page,
}) => {
  const codes = await openOnCodes(page)
  const { endCancelled } = await clickless(page, codes, { holdMs: HOLD_MS })
  await expect(codes).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  expect(await clicksSeen(codes)).toBe(1)
  expect(endCancelled, 'the browser’s own tap is withheld').toBe(true)
})

test('click-less: a quick tap is still left to the click that follows it — one press', async ({
  page,
}) => {
  const codes = await openOnCodes(page)
  const { endCancelled } = await clickless(page, codes, { holdMs: 0, click: true })
  await expect(codes).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  expect(await clicksSeen(codes)).toBe(1)
  expect(endCancelled).toBe(false)
})

test('click-less: a double tap’s second touch is cancelled at its start, and still pressed once', async ({
  page,
}) => {
  const codes = await openOnCodes(page)
  await clickless(page, codes, { holdMs: 0, click: true })
  await expect(codes).toHaveAttribute('aria-expanded', 'true')
  const second = await clickless(page, codes, { holdMs: 0 })
  expect(second.startCancelled).toBe(true)
  await expect(codes).toHaveAttribute('aria-expanded', 'false')
  await settled(page)
  expect(await clicksSeen(codes)).toBe(2)
})

test('the keyboard presses once, before and after touches, as it always did', async ({ page }) => {
  const codes = await openOnCodes(page)
  await codes.focus()
  await page.keyboard.press('Enter')
  await expect(codes).toHaveAttribute('aria-expanded', 'true')
  await clickless(page, codes, { holdMs: HOLD_MS })
  await expect(codes).toHaveAttribute('aria-expanded', 'false')
  await codes.focus()
  await page.keyboard.press('Enter')
  await expect(codes).toHaveAttribute('aria-expanded', 'true')
  await settled(page)
  expect(await clicksSeen(codes)).toBe(3)
})
