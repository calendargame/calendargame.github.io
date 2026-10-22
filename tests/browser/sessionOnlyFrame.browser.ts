// THE ONE DASHED FRAME — "what you play now is forgotten when you close the app" (Amnesic) — in every
// practice mode, on every Amnesic value, with Save Stats on and off.
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
// DRAWN, that it runs round exactly what will be forgotten, and that drawing it moves nothing — the
// strip and the readouts are where they are with no frame at all.
import { test, expect, openApp, statsBlock, switchMode, SAME_PX, THEMES } from './support/app'
import { PRACTICE_MODES, type PracticeModeId } from '../../src/lib/modes'
import type { AmnesicMode } from '../../src/store/amnesicMode'
import type { Page } from '@playwright/test'

const AMNESIC: AmnesicMode[] = ['off', 'stats', 'full']
const HAS_BESTS: PracticeModeId[] = ['aox', 'blitz']
const SPOKEN = {
  strip: 'What you play now is forgotten when you close the app',
  bests: 'Bests set now are forgotten when you close the app',
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

// Read off the page as it is drawn: a frame is any visible dashed line — a stroked path with a dash
// pattern (components/DashedFrame draws the frame so, on its wearer's box) — found by what is
// painted, not by the class that asks for it. Its wearer is the element it is drawn over.
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
    const frames = [...scroller.querySelectorAll('svg')]
      .filter((svg) => svg.getClientRects().length > 0)
      .map((svg) => ({ svg, line: svg.querySelector('path') }))
      .filter(({ line }) => line && getComputedStyle(line).strokeDasharray !== 'none')
      .map(({ svg, line }) => ({ el: svg.parentElement!, drawn: getComputedStyle(line!) }))
      .map(({ el, drawn }) => ({
        wearer:
          el === stripEl
            ? ('strip' as const)
            : el === groupEl
              ? ('group' as const)
              : el === bestsEl
                ? ('bests' as const)
                : ('other' as const),
        box: box(el),
        line: drawn.stroke,
        lineWidth: parseFloat(drawn.strokeWidth),
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

// EVERY GAP THE SAME, ALL THE WAY ROUND (the owner's report, 2026-10-21: on his iPhone one gap on
// the right side was longer than the rest — a dashed border's leftover length, dropped into one gap;
// components/DashedFrame draws the line with a whole number of dashes round it instead). Measured on
// the drawn picture, at three times the pixels so a gap is several pixels long, along a line of pixels inside the line: along the top edge
// and down the right side, between the corners, every gap is the same length, and so is every dash,
// to within the two device pixels that rounding each end of a run to a whole pixel can add or
// take (two thirds of a CSS pixel). A leftover gap is longer by up to a whole dash and gap.
test.describe('at three times the pixels', () => {
  test.use({ deviceScaleFactor: 3 })
  test('the frame has the same gap all the way round, in both engines and at several widths', async ({
    page,
  }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page, { seed: { amnesic: { 1: 'full' } } })
      await switchMode(page, 'aox')
      const host = page.locator('svg.session-frame >> visible=true').locator('..')
      const b = (await host.boundingBox())!
      const shot = await page.screenshot({ clip: b, scale: 'device' })
      const gaps = await page.evaluate(
        async ([base64, inset]) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const g = canvas.getContext('2d', { willReadFrequently: true })!
          g.drawImage(bitmap, 0, 0)
          const { data, width: w, height: h } = g.getImageData(0, 0, bitmap.width, bitmap.height)
          const lum = (x: number, y: number) => {
            const i = (y * w + x) * 4
            return data[i] + data[i + 1] + data[i + 2]
          }
          // The runs of not-line between the dashes along one line of pixels, corners left out.
          // The runs along a line of pixels, as two lists — the runs on one side of the middle
          // brightness and the runs on the other (which is the dashes and which the gaps depends on
          // the theme), each without the part-runs cut off at the two ends.
          const runsOf = (values: number[]) => {
            const middle = (Math.max(...values) + Math.min(...values)) / 2
            const lengths: { light: boolean; length: number }[] = []
            for (const v of values) {
              const light = v > middle
              const last = lengths[lengths.length - 1]
              if (last && last.light === light) last.length++
              else lengths.push({ light, length: 1 })
            }
            const whole = lengths.slice(1, -1)
            return {
              light: whole.filter((r) => r.light).map((r) => r.length),
              dark: whole.filter((r) => !r.light).map((r) => r.length),
            }
          }
          // The line of pixels that runs inside the line: of the outermost few, the one that
          // changes most often between dash and gap (the picture's edge can fall a pixel either
          // side of the box's, and the line is lighter than what is under it in the dark themes
          // and darker in the light ones).
          const changes = (values: number[]) => {
            const { light, dark } = runsOf(values.slice(inset, -inset))
            return light.length + dark.length
          }
          const busiest = (count: number, along: (k: number) => number[]) =>
            [...Array(count).keys()].sort((a, b) => changes(along(b)) - changes(along(a)))[0]
          const row = busiest(6, (y) => [...Array(w).keys()].map((x) => lum(x, y)))
          const column =
            w - 1 - busiest(6, (k) => [...Array(h).keys()].map((y) => lum(w - 1 - k, y)))
          return {
            top: runsOf([...Array(w).keys()].map((x) => lum(x, row)).slice(inset, -inset)),
            right: runsOf([...Array(h).keys()].map((y) => lum(column, y)).slice(inset, -inset)),
          }
        },
        [shot.toString('base64'), 60] as const,
      )
      for (const [side, both] of Object.entries(gaps))
        for (const [which, runs] of Object.entries(both)) {
          expect(runs.length, `${width}px, ${side}: dashes and gaps found`).toBeGreaterThan(2)
          expect(
            Math.max(...runs) - Math.min(...runs),
            `${width}px, ${side}: every ${which} run the same length (${runs.join(' ')})`,
          ).toBeLessThanOrEqual(2)
        }
    }
  })
})

// THE OUTLINE IS DRAWN IN THE SAME FRAME AS THE SCREEN IT IS ON (the owner's report, 2026-10-21: it
// flashed on every switch of mode). A screen out of view has no size, so its frame has nothing to
// draw until the switch brings it into view; the browser then tells every ResizeObserver, after
// layout and before paint. components/DashedFrame draws in its own observer, which was made when
// the frame was, so it is told FIRST — and an observer made here, later, finds the line already
// drawn when it is told, in that same frame. (When the line went through React state, it was
// drawn only on a render after the paint, and this observer found no line.)
test('switching mode, the outline is there in the first frame the screen is', async ({ page }) => {
  await openApp(page, { seed: { amnesic: { 1: 'full' } } })
  await switchMode(page, 'classic')
  const drawnWhenSeen = page.evaluate(
    () =>
      new Promise<boolean[]>((done) => {
        const seen: boolean[] = []
        const watch = new ResizeObserver((entries) => {
          for (const entry of entries)
            if (entry.contentRect.width > 0)
              seen.push(entry.target.querySelector('path')!.hasAttribute('d'))
          if (seen.length) {
            watch.disconnect()
            done(seen)
          }
        })
        for (const svg of document.querySelectorAll('svg.session-frame')) watch.observe(svg)
      }),
  )
  await switchMode(page, 'aox')
  expect(await drawnWhenSeen, 'the line was there when the frame first had a size').not.toContain(
    false,
  )
})

// ROUND THE STATS AND THE BESTS, THE LINE REACHES A LITTLE BELOW THEM (index.css's
// .session-frame-below, the owner's call 2026-10-21) — its drawing, not the group: nothing on the
// page moves for it (the test above, against Amnesic Off), and it stays clear of what comes next.
test('round the stats and the Bests, the line sits an eighth of a rem below them, and clear of what follows', async ({
  page,
}) => {
  await openApp(page, { seed: { amnesic: { 1: 'full' } } })
  for (const mode of ['aox', 'blitz'] as const) {
    await switchMode(page, mode)
    const g = await page.locator('svg.session-frame >> visible=true').evaluate((svg) => {
      const host = svg.parentElement!
      let next = host.nextElementSibling
      while (next && next.getClientRects().length === 0) next = next.nextElementSibling
      return {
        reach: svg.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom,
        eighth: parseFloat(getComputedStyle(document.documentElement).fontSize) / 8,
        clear: next ? next.getBoundingClientRect().top - svg.getBoundingClientRect().bottom : 99,
        top: svg.getBoundingClientRect().top - host.getBoundingClientRect().top,
      }
    })
    expect(Math.abs(g.reach - g.eighth), `${mode}: reaches an eighth of a rem below`).toBeLessThan(
      SAME_PX,
    )
    expect(Math.abs(g.top), `${mode}: its top is the group's`).toBeLessThan(SAME_PX)
    expect(g.clear, `${mode}: clear of what follows`).toBeGreaterThan(4)
  }
})
