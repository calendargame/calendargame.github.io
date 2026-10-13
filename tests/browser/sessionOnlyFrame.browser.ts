// THE ONE DASHED FRAME — "these numbers are for this session only" (Amnesic) — in every practice
// mode, on every Amnesic value, with Save Stats on and off.
//
//                        Save Stats on                      Save Stats off (the strip is dimmed)
//   Off                  no frame                           no frame
//   Stats Only           round the stats strip              no frame
//   Full                 round the strip — and, in MoX      round the Best readouts alone (MoX,
//                        and Blitz, ONE frame round the     Blitz); no frame elsewhere
//                        strip and its Best readouts
//
// components/StatPanel decides which element wears the frame and tests/sessionOnlyOutline.dom pins
// that choice class by class. What only a browser can say is here: that exactly ONE dashed line is
// DRAWN, that it runs round exactly what is temporary, and that drawing it moves nothing — the
// strip and the readouts are where they are with no frame at all.
import { test, expect, openApp, statsBlock, switchMode, SAME_PX, THEMES } from './support/app'
import { PRACTICE_MODES, type PracticeModeId } from '../../src/lib/modes'
import type { AmnesicMode } from '../../src/store/amnesicMode'
import type { Page } from '@playwright/test'

const AMNESIC: AmnesicMode[] = ['off', 'stats', 'full']
const HAS_BESTS: PracticeModeId[] = ['aox', 'blitz']
const SPOKEN = {
  strip: 'These stats are for this session only',
  bests: 'Bests are for this session only',
  dimmed: 'Stats are not being saved',
}

type Wearer = 'strip' | 'bests' | 'group'
const expectedFrame = (
  mode: PracticeModeId,
  amnesic: AmnesicMode,
  saveStats: boolean,
): Wearer | null => {
  const stripTemporary = amnesic !== 'off' && saveStats
  const bestsTemporary = HAS_BESTS.includes(mode) && amnesic === 'full'
  return stripTemporary && bestsTemporary
    ? 'group'
    : stripTemporary
      ? 'strip'
      : bestsTemporary
        ? 'bests'
        : null
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
interface Screen {
  /** Every dashed frame drawn on the screen: what wears it (or 'other'), where, and its line. */
  frames: { wearer: Wearer | 'other'; box: Box; line: string; lineWidth: number }[]
  strip: Box
  stripOpacity: string
  bests: Box | null
  spoken: string
  background: string
}

// Read off the page as it is drawn: a frame is any visible element whose ::after paints a dashed
// border — found by what is painted, not by the class that asks for it.
const read = (page: Page): Promise<Screen> =>
  statsBlock(page).strip.evaluate((stripEl) => {
    const groupEl = stripEl.parentElement!
    // The strip's one sibling in its group, when the mode has Best readouts (support/app's
    // statsBlock finds the same three).
    const bestsEl = groupEl.children.length > 1 ? groupEl.children[1] : null
    const box = (el: Element): Box => {
      const { left, top, right, bottom } = el.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const scroller = document.getElementById('appScroll')!
    const frames = [...scroller.querySelectorAll('*')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, after: getComputedStyle(el, '::after') }))
      .filter(({ after }) => after.content !== 'none' && after.borderTopStyle === 'dashed')
      .map(({ el, after }) => ({
        wearer:
          el === stripEl
            ? ('strip' as const)
            : el === groupEl
              ? ('group' as const)
              : el === bestsEl
                ? ('bests' as const)
                : ('other' as const),
        box: box(el),
        line: after.borderTopColor,
        lineWidth: parseFloat(after.borderTopWidth),
      }))
    return {
      frames,
      strip: box(stripEl),
      stripOpacity: getComputedStyle(stripEl).opacity,
      bests: bestsEl ? box(bestsEl) : null,
      spoken: groupEl.textContent ?? '',
      background: getComputedStyle(document.body).backgroundColor,
    }
  })

const sameBox = (a: Box, b: Box, what: string) => {
  for (const edge of ['left', 'top', 'right', 'bottom'] as const)
    expect(Math.abs(a[edge] - b[edge]), `${what}: ${edge} edge`).toBeLessThanOrEqual(SAME_PX)
}

for (const saveStats of [true, false]) {
  test(`Save Stats ${saveStats ? 'on' : 'off'}: one dashed frame, round exactly what is temporary, in every mode on every Amnesic value — and it moves nothing`, async ({
    page,
    newDevice,
  }) => {
    test.setTimeout(120_000)
    // Three devices, one per Amnesic value, walked through the modes together.
    const pages = { off: page, stats: await newDevice(), full: await newDevice() }
    for (const amnesic of AMNESIC)
      await openApp(pages[amnesic], {
        seed: { amnesic: { 1: amnesic }, settings: { saveStats } },
      })

    for (const { id: mode, label } of PRACTICE_MODES) {
      const screens = {} as Record<AmnesicMode, Screen>
      for (const amnesic of AMNESIC) {
        await switchMode(pages[amnesic], mode)
        screens[amnesic] = await read(pages[amnesic])
      }
      for (const amnesic of AMNESIC) {
        const at = `${label}, Amnesic ${amnesic}, Save Stats ${saveStats ? 'on' : 'off'}`
        const screen = screens[amnesic]
        const frame = expectedFrame(mode, amnesic, saveStats)

        // The seed is on screen: the strip is dimmed exactly when Save Stats is off, and the words
        // a screen reader gets say which parts are the session's.
        expect(screen.stripOpacity, `${at}: the strip's dim`).toBe(saveStats ? '1' : '0.5')
        expect(screen.spoken.includes(SPOKEN.dimmed), `${at}: "${SPOKEN.dimmed}"`).toBe(!saveStats)
        expect(screen.spoken.includes(SPOKEN.strip), `${at}: "${SPOKEN.strip}"`).toBe(
          frame === 'strip' || frame === 'group',
        )
        expect(screen.spoken.includes(SPOKEN.bests), `${at}: "${SPOKEN.bests}"`).toBe(
          frame === 'bests' || frame === 'group',
        )
        expect(screen.bests !== null, `${at}: has Best readouts`).toBe(HAS_BESTS.includes(mode))

        // ONE frame, or none — and on the element that holds exactly what is temporary.
        expect(
          screen.frames.map((f) => f.wearer),
          `${at}: what wears a dashed frame`,
        ).toEqual(frame ? [frame] : [])
        if (frame) {
          const [{ box, lineWidth }] = screen.frames
          expect(lineWidth, `${at}: the line's width`).toBeGreaterThan(0)
          // Round the strip: the frame's sides and top are the strip's own.
          if (frame !== 'bests') {
            expect(Math.abs(box.left - screen.strip.left), `${at}: left`).toBeLessThanOrEqual(
              SAME_PX,
            )
            expect(Math.abs(box.right - screen.strip.right), `${at}: right`).toBeLessThanOrEqual(
              SAME_PX,
            )
            expect(Math.abs(box.top - screen.strip.top), `${at}: top`).toBeLessThanOrEqual(SAME_PX)
          }
          if (frame === 'strip') sameBox(box, screen.strip, `${at}: the frame is the strip's edge`)
          if (frame === 'bests')
            sameBox(box, screen.bests!, `${at}: the frame is the readouts' row`)
          // Round both: it closes at the bottom of the readouts' row, and no wider than the strip.
          if (frame === 'group')
            expect(
              Math.abs(box.bottom - screen.bests!.bottom),
              `${at}: bottom`,
            ).toBeLessThanOrEqual(SAME_PX)
        }

        // …and nothing has moved: the strip and the readouts are where Amnesic Off has them.
        sameBox(screen.strip, screens.off.strip, `${at}: the strip, against Amnesic Off`)
        if (screen.bests)
          sameBox(screen.bests, screens.off.bests!, `${at}: the Best readouts, against Amnesic Off`)
      }
    }
  })
}

for (const theme of THEMES) {
  test(`the frame's line can be seen on the ${theme} theme`, async ({ page }) => {
    await openApp(page, { theme, seed: { amnesic: { 1: 'full' } } })
    await switchMode(page, 'aox')
    const { frames, background } = await read(page)
    expect(frames.map((f) => f.wearer)).toEqual(['group'])
    // A colour of its own: not transparent, and not the page's.
    const [line] = frames
    expect(line.line).not.toBe(background)
    expect(line.line).not.toMatch(/^(transparent|rgba\(.*,\s*0\))$/)
    expect(line.lineWidth).toBeGreaterThanOrEqual(1)
  })
}
