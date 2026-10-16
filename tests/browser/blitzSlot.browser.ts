// BLITZ'S ONE SLOT (Round 26, Q12; and Q11's reset): the time-limit slider and the countdown it sets
// share one row. Idle it is the slider and its value box; from Begin until Reset the same track is
// the countdown, laid exactly over the slider's track, and the time left stands where the value box
// stood. What is held here, at rest, in both engines:
//   • NOTHING MOVES as the slot changes face: the row, the track, the value cell, and everything
//     below them keep their boxes from idle to running to ended and back to idle after Reset;
//   • THE NUMBER STAYS IN ONE PLACE: the time left sits on the value box's line, right edge to
//     right edge;
//   • THE COUNTDOWN IS THE SLIDER'S TRACK: the same box and the same unfilled colour, in every theme;
//   • WHICH FACE IS SHOWING, to the eye and to assistive tech: the slider is disabled and hidden
//     while it is a countdown, and the countdown is a timer;
//   • A RESET ROUND IS A RESET ROUND (Q11): Reset brings back the slider, and the countdown under
//     it is at full length again;
//   • THE PAGE FITS: an ended round with Show Codes open fits a 390×844 and a 360×800 window — the
//     owner's worry when the slot was proposed; before it, both scrolled (13px and 14px).
// Reduce Motion is on for the lane, so the cross-fade has no time to take and every reading is a
// resting one.
import {
  test,
  expect,
  openApp,
  rectOf,
  settled,
  switchMode,
  textRectOf,
  THEMES,
} from './support/app'
import { SAME_PX, type Rect } from './support/app'
import type { Page } from '@playwright/test'

function parts(page: Page) {
  const slider = page.locator('input[type="range"]:visible')
  const row = slider.locator('xpath=../..')
  return {
    row,
    slider,
    clock: row.locator('.range-clock'),
    valueBox: row.locator('button[aria-label^="Edit Blitz"]'),
    timer: row.locator('[role="timer"]'),
    card: row.locator('xpath=following-sibling::div[1]'),
  }
}

type Face = Awaited<ReturnType<typeof faceOf>>
async function faceOf(page: Page) {
  await settled(page)
  const p = parts(page)
  const opacity = (l: typeof p.slider) => l.evaluate((el) => getComputedStyle(el).opacity)
  const visibility = (l: typeof p.slider) => l.evaluate((el) => getComputedStyle(el).visibility)
  return {
    row: await rectOf(p.row),
    track: await rectOf(p.slider),
    clockBox: await rectOf(p.clock),
    valueCell: await rectOf(p.valueBox),
    timerCell: await rectOf(p.timer),
    card: await rectOf(p.card),
    sliderOpacity: await opacity(p.slider),
    clockOpacity: await opacity(p.clock),
    valueVisible: (await visibility(p.valueBox)) === 'visible',
    timerVisible: (await visibility(p.timer)) === 'visible',
    sliderDisabled: await p.slider.isDisabled(),
    sliderHidden: await p.slider.getAttribute('aria-hidden'),
    timerText: (await p.timer.locator('span').last().textContent()) ?? '',
    valueText: (await p.valueBox.textContent()) ?? '',
    timerInk: await textRectOf(p.timer.locator('span').last()),
    valueInk: await textRectOf(p.valueBox),
  }
}

function expectSameBox(a: Rect, b: Rect, what: string) {
  for (const edge of ['left', 'right', 'top', 'bottom'] as const)
    expect(Math.abs(a[edge] - b[edge]), `${what}: ${edge}`).toBeLessThanOrEqual(SAME_PX)
}

function expectIdle(face: Face, length: string) {
  expect(face.sliderOpacity).toBe('1')
  expect(face.clockOpacity).toBe('0')
  expect(face.valueVisible && !face.timerVisible, 'idle shows the value box, not the timer').toBe(
    true,
  )
  expect(face.sliderDisabled).toBe(false)
  expect(face.sliderHidden).toBeNull()
  expect(face.valueText).toBe(length)
}
function expectClocking(face: Face) {
  expect(face.sliderOpacity).toBe('0')
  expect(face.clockOpacity).toBe('1')
  expect(
    face.timerVisible && !face.valueVisible,
    'a round shows the timer, not the value box',
  ).toBe(true)
  expect(face.sliderDisabled, 'the slider cannot be moved while it is a countdown').toBe(true)
  expect(
    face.sliderHidden,
    'the slider is hidden from assistive tech while it is a countdown',
  ).toBe('true')
}
// Every box the slot and the page under it have, unchanged from `idle` — and the number on show
// (the time left while clocking, the value box's value when not) where idle's value stood.
function expectNothingMoved(idle: Face, now: Face, state: string, clocking: boolean) {
  expectSameBox(now.row, idle.row, `${state}: the slot's row`)
  expectSameBox(now.track, idle.track, `${state}: the slider's track`)
  expectSameBox(now.timerCell, idle.valueCell, `${state}: the time left's cell vs the value box's`)
  expectSameBox(now.valueCell, idle.valueCell, `${state}: the value box's cell`)
  expectSameBox(now.card, idle.card, `${state}: the date card under the slot`)
  // The countdown is laid exactly over the slider's track.
  expectSameBox(now.clockBox, now.track, `${state}: the countdown over the track`)
  // The number: the same line as idle's value, and the same right edge.
  const ink = clocking ? now.timerInk : now.valueInk
  for (const edge of ['right', 'top', 'bottom'] as const)
    expect(
      Math.abs(ink[edge] - idle.valueInk[edge]),
      `${state}: the number's ${edge} edge`,
    ).toBeLessThanOrEqual(SAME_PX)
}

for (const timing of ['Per Round', 'Per Question'] as const)
  test(`${timing}: idle → Begin → ended → Reset, and nothing in the slot moves`, async ({
    page,
  }) => {
    const perQ = timing === 'Per Question'
    await openApp(page, { seed: { modePrefs: { blitzPerQ: perQ, blitzSec: 30, blitzQSec: 10 } } })
    await switchMode(page, 'blitz')
    await expect(page.getByRole('button', { name: timing })).toBeVisible() // the seed, on screen
    const length = perQ ? '10s' : '30s'
    const idle = await faceOf(page)
    expectIdle(idle, length)
    expectSameBox(idle.clockBox, idle.track, 'idle: the countdown waits exactly over the track')

    await page.getByRole('button', { name: 'Begin' }).click()
    const running = await faceOf(page)
    expectClocking(running)
    expectNothingMoved(idle, running, 'running', true)
    expect(running.timerText).toMatch(/^\d+s$/)

    await page.locator('button[data-key="R"]:visible').click() // Reveal ends the round
    await expect(page.locator('button[data-key="N"]:visible')).toHaveText('Reset')
    const ended = await faceOf(page)
    expectClocking(ended) // an ended round keeps its countdown on screen
    expectNothingMoved(idle, ended, 'ended', true)

    await page.locator('button[data-key="N"]:visible').click() // Reset
    await expect(page.getByRole('button', { name: 'Begin' })).toBeVisible()
    const reset = await faceOf(page)
    expectIdle(reset, length)
    expectNothingMoved(idle, reset, 'reset', false)
    // Q11: the countdown under the slider is back at full length, for the next Begin.
    expect(reset.timerText).toBe(length)
  })

test('the countdown is the slider’s own track, in every theme: the same unfilled colour', async ({
  page,
}) => {
  for (const theme of THEMES) {
    await openApp(page, { theme })
    await switchMode(page, 'blitz')
    const { slider, clock } = parts(page)
    const [track, unfilled] = await Promise.all([
      slider.evaluate((el) => getComputedStyle(el).backgroundImage),
      clock.evaluate((el) => getComputedStyle(el).backgroundColor),
    ])
    // The slider's track is a gradient whose last stop is its unfilled colour.
    expect(track, `${theme}: the slider's track ends in the countdown's unfilled colour`).toMatch(
      new RegExp(`${unfilled.replace(/[().]/g, '\\$&')} \\d+(\\.\\d+)?%\\)$`),
    )
    const [a, b] = await Promise.all([
      slider.evaluate((el) => getComputedStyle(el).borderRadius),
      clock.evaluate((el) => getComputedStyle(el).borderRadius),
    ])
    expect(b, `${theme}: the countdown's rounding is the track's`).toBe(a)
  }
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
])
  test(`an ended round with Show Codes open fits the window at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await openApp(page, { viewport })
    await switchMode(page, 'blitz')
    await page.getByRole('button', { name: 'Begin' }).click()
    await page.locator('button[data-key="C"]:visible').click() // Show Codes ends the round, open
    await expect(page.locator('button[data-key="C"]:visible')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await settled(page)
    const over = await page
      .locator('#appScroll')
      .evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(over, 'the Blitz page scrolls with Show Codes open').toBeLessThanOrEqual(0)
  })
