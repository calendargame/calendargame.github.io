import { useRef, useLayoutEffect, type ReactNode } from 'react'

// Expander — animates its children open/closed by tweening max-height.
//
// On mount it snaps to the current `open` state with no transition (so an
// initially-open panel doesn't animate in). After that, each `open` change
// animates: opening measures the inner content's scrollHeight (+ a tiny buffer)
// and sets that as max-height; closing pins the current height, forces a
// reflow, then drops to 0 so the CSS transition has two heights to tween between.
// A ResizeObserver keeps an open panel sized to its content if that content
// changes height while open. Pure presentational — no app state.
//
// OPEN_BUFFER_PX is only sub-pixel safety against scrollHeight rounding a hair
// short (which would clip the last line). It used to be 16px, but that 16px of
// dead space sat at the bottom of EVERY open panel at rest — invisible in the
// scrollable How-to-Play, but in a game mode it added 16px of height to the
// Show-Codes panel and pushed the tallest layout (Blitz + Show Codes) past the
// no-scroll viewport. The panels carry their own bottom padding, so the buffer
// is purely a measurement guard; 2px removes the dead space without clipping.
//
// Extracted from main.jsx in Stage C, Step 4a (only the React-hook imports were
// added, since this is now its own module).
const OPEN_BUFFER_PX = 2
export default function Expander({ open, children }: { open: boolean; children?: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const prevOpenRef = useRef(open)
  const mountedRef = useRef(false)
  const resizeObsRef = useRef<ResizeObserver | null>(null)
  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const attachObs = () => {
      if (typeof ResizeObserver === 'undefined' || !innerRef.current || !outerRef.current) return
      // Disconnect any prior observer before creating a new one. Currently the effect cleanup
      // handles disconnection between effect runs, so this guard only matters if a future change
      // calls attachObs twice within a single effect run (which would otherwise orphan the first).
      if (resizeObsRef.current) {
        resizeObsRef.current.disconnect()
        resizeObsRef.current = null
      }
      const inner = innerRef.current
      const obs = new ResizeObserver(() => {
        if (!outerRef.current || !innerRef.current) return
        outerRef.current.style.maxHeight = innerRef.current.scrollHeight + OPEN_BUFFER_PX + 'px'
      })
      obs.observe(inner)
      resizeObsRef.current = obs
    }
    if (!mountedRef.current) {
      mountedRef.current = true
      prevOpenRef.current = open
      if (open) {
        el.style.transition = 'none'
        el.style.maxHeight = (innerRef.current?.scrollHeight ?? 0) + OPEN_BUFFER_PX + 'px'
        el.getBoundingClientRect()
        el.style.transition = ''
        attachObs()
      } else {
        el.style.maxHeight = '0px'
      }
      return () => {
        if (resizeObsRef.current) {
          resizeObsRef.current.disconnect()
          resizeObsRef.current = null
        }
      }
    }
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (open) {
      el.style.maxHeight = (innerRef.current?.scrollHeight ?? 0) + OPEN_BUFFER_PX + 'px'
      attachObs()
    } else if (!wasOpen) {
      el.style.maxHeight = '0px'
    } else {
      el.style.maxHeight = el.scrollHeight + 'px'
      el.getBoundingClientRect()
      el.style.maxHeight = '0px'
    }
    return () => {
      if (resizeObsRef.current) {
        resizeObsRef.current.disconnect()
        resizeObsRef.current = null
      }
    }
  }, [open])
  return (
    <div ref={outerRef} className="expander">
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
