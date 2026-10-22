// DashedFrame — AMNESIC'S DASHED FRAME, "what you play now is forgotten when you close the app"
// (index.css's ★ THE DASHED OUTLINE says what it marks, where, and why it is dashed). Its host wears
// .session-only and renders this as its last child; the frame is drawn over the host's own box and
// takes no part in layout.
//
// ★ DRAWN, NOT A DASHED BORDER, SO EVERY GAP IS THE SAME (the owner's report, 2026-10-21: on his
// iPhone one gap on the right side was longer than the rest). A browser draws a dashed border edge
// by edge and puts whatever length is left over into one gap, wherever that falls; and no two
// engines dash alike — measured at this 1.5px: Chromium 3px dashes and 2px gaps, WebKit 4.5px and
// 4.5px. So the frame is one rounded-rectangle path, measured, and dashed with a WHOLE number of
// dash-and-gap periods round it: `pathLength` tells the browser to count the path's length as that
// number, and the dash pattern is written in those units, so the pattern closes on itself exactly,
// on any engine, at any size, with nothing left over for a gap to absorb. The period is the one
// that fits nearest to DASH + GAP; the stretch it needs is a fraction of a pixel per period.
// The size is re-read whenever the box changes size (ResizeObserver): a narrower phone, a turned
// screen, a value growing a digit.
//
// Its geometry is the old border's exactly: the frame's box is the host's padding box (inset 0, as
// the ::after it replaces was), the line is DASHED_LINE wide along the INSIDE of that box's edge, and
// its corners have the host's own radius on the outside of the line.
import { useLayoutEffect, useRef, useState } from 'react'

/** The line's width, px — and so the width of the column its dashes cover along each side. */
export const DASHED_LINE = 1.5
/** The dash and the gap, px, before the stretch that makes a whole number of them fit. */
export const DASH = 4.5
export const GAP = 3
/** The dash pattern, in units of one period (the path's length counts as `periods` of them). */
export const DASH_PATTERN = `${DASH / (DASH + GAP)} ${GAP / (DASH + GAP)}`
/** Where along the pattern the path starts: half way along a dash, in the same units. */
export const DASH_OFFSET = DASH / 2 / (DASH + GAP)

export type Box = { width: number; height: number; radius: number }

/**
 * The line for a box: the rounded rectangle its middle runs along, and how many dash-and-gap
 * periods go round it — a whole number, the one nearest to its length at DASH + GAP each. Null for
 * a box too small to draw in.
 * It starts and ends at the middle of the top edge, where DASH_OFFSET puts the middle of a dash: the
 * pattern is then the same on the left of the frame as on the right, mirrored, and the point where
 * the path closes — the one place a pattern that did NOT fit would show — sits in plain view in the
 * middle of a straight edge, where tests/browser/sessionOnlyFrame looks. In a DASH, not a gap,
 * because Chromium draws the two pieces a closed path's dash is cut into at its start as one dash,
 * but drew a gap cut there two thirds of a pixel too long (measured at three widths; WebKit drew
 * both evenly).
 */
export function dashedOutline(box: Box): { d: string; length: number; periods: number } | null {
  if (!(box.width > DASHED_LINE && box.height > DASHED_LINE)) return null
  const { d, length } = outline(box)
  return { d, length, periods: Math.max(1, Math.round(length / (DASH + GAP))) }
}

function outline({ width, height, radius }: Box): { d: string; length: number } {
  const h = DASHED_LINE / 2
  const [x0, y0, x1, y1] = [h, h, width - h, height - h]
  const r = Math.max(0, Math.min(radius - h, (x1 - x0) / 2, (y1 - y0) / 2))
  const arc = (x: number, y: number) => `A ${r} ${r} 0 0 1 ${x} ${y}`
  const middle = (x0 + x1) / 2
  const d = [
    `M ${middle} ${y0}`,
    `H ${x1 - r}`,
    arc(x1, y0 + r),
    `V ${y1 - r}`,
    arc(x1 - r, y1),
    `H ${x0 + r}`,
    arc(x0, y1 - r),
    `V ${y0 + r}`,
    arc(x0 + r, y0),
    `H ${middle}`,
    'Z',
  ].join(' ')
  const length = 2 * (x1 - x0 - 2 * r) + 2 * (y1 - y0 - 2 * r) + 2 * Math.PI * r
  return { d, length }
}

export default function DashedFrame() {
  const ref = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    const host = svg?.parentElement
    if (!svg || !host) return
    const read = () => {
      const { width, height } = svg.getBoundingClientRect()
      const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0
      setBox((was) =>
        was && was.width === width && was.height === height && was.radius === radius
          ? was
          : { width, height, radius },
      )
    }
    read()
    // jsdom has no ResizeObserver and lays nothing out; there the frame is its empty box.
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(read)
    watch.observe(svg)
    return () => watch.disconnect()
  }, [])
  const line = box && dashedOutline(box)
  return (
    <svg ref={ref} aria-hidden="true" focusable="false" className="session-frame">
      {line && (
        <path
          d={line.d}
          pathLength={line.periods}
          strokeDasharray={DASH_PATTERN}
          strokeDashoffset={DASH_OFFSET}
        />
      )}
    </svg>
  )
}
