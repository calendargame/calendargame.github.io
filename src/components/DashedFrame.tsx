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
// on any engine, at any size, with nothing left over for a gap to absorb (lib/dashedOutline is the
// arithmetic). The size is re-read whenever the box changes size: a narrower phone, a turned
// screen, a value growing a digit — and a mode screen coming into view.
//
// ★ DRAWN IN THE SAME FRAME AS THE PAGE (the owner's report, 2026-10-21: the outline flashed on
// every switch of mode). Every mode's screen stays mounted, and a screen out of view has no size,
// so its frame has nothing to draw until the switch brings it into view. The shape used to go
// through React state, and a state update made by a ResizeObserver renders after the browser has
// painted — so for one frame the page was there and its outline was not. Now the observer, which
// the browser runs after layout and BEFORE paint, writes the path itself (`d` and `pathLength`,
// straight onto the element; React never renders them, so it never overwrites them), and the
// outline is on screen in the very frame its box is.
//
// Its geometry is the old border's exactly: the frame's box is the host's padding box (inset 0, as
// the ::after it replaced was), the line is lib/dashedOutline's DASHED_LINE wide along the INSIDE of
// that box's edge, and its corners have the host's own radius on the outside of the line. The one
// exception is `reachBelow` (index.css's .session-frame-below says when, and how far).
import { useLayoutEffect, useRef } from 'react'
import { dashedOutline, DASH_OFFSET, DASH_PATTERN } from '../lib/dashedOutline.js'

export default function DashedFrame({ reachBelow = false }: { reachBelow?: boolean }) {
  const ref = useRef<SVGPathElement>(null)
  useLayoutEffect(() => {
    const path = ref.current
    const svg = path?.ownerSVGElement
    const host = svg?.parentElement
    if (!path || !svg || !host) return
    const draw = () => {
      const { width, height } = svg.getBoundingClientRect()
      const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0
      const line = dashedOutline({ width, height, radius })
      if (line) {
        path.setAttribute('d', line.d)
        path.setAttribute('pathLength', String(line.periods))
      } else path.removeAttribute('d') // a box with no size — a screen out of view: nothing to draw
    }
    draw()
    // jsdom has no ResizeObserver and lays nothing out; there the frame is its empty box.
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(draw)
    watch.observe(svg)
    return () => watch.disconnect()
  }, [])
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={reachBelow ? 'session-frame session-frame-below' : 'session-frame'}
    >
      <path ref={ref} strokeDasharray={DASH_PATTERN} strokeDashoffset={DASH_OFFSET} />
    </svg>
  )
}
