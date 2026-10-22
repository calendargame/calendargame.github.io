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
// the ::after it replaces was), the line is lib/dashedOutline's DASHED_LINE wide along the INSIDE of that box's edge, and
// its corners have the host's own radius on the outside of the line.
import { useLayoutEffect, useRef, useState } from 'react'
import { dashedOutline, DASH_OFFSET, DASH_PATTERN, type Box } from '../lib/dashedOutline.js'

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
