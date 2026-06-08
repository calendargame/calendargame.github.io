import { useRef, useLayoutEffect, type ReactNode } from 'react'

// Expander — animates its children open/closed by tweening max-height.
//
// Opening: measure the content height, tween max-height 0 → that height, then — once the open
// transition finishes — RELEASE the clamp to `max-height:none` so the panel sizes to its content
// NATURALLY at rest. That release is the key correctness property: while OPEN AND IDLE the panel is
// never height-clamped, so it can NEVER clip its content (e.g. an inner panel's bottom border),
// regardless of sub-pixel measurement rounding on high-DPI screens. The clamp exists ONLY for the
// open/close slide. Closing: pin the current measured height, force a reflow, then drop to 0 so the
// CSS transition has two concrete heights to tween between. An initially-open panel snaps straight to
// `none` (no animation, no clip). Pure presentational — no app state.
//
// (Why `none` at rest — Calendar Game fix 2026-06-08: the prior version kept max-height pinned at a
// measured scrollHeight + a tiny 2px buffer EVEN AT REST, with a ResizeObserver re-pinning it on
// content change. On a 3× retina iPhone the measured scrollHeight rounded a hair short of the real
// height, so with only 2px of slack the open Show-Codes panel's 1px bottom border was shaved off — in
// every mode. Releasing to `none` once open removes the clamp (and the whole measurement-rounding
// failure class) with ZERO dead space, so it no longer pushes the tallest layout past the no-scroll
// viewport either. The old ResizeObserver is gone: `none` auto-sizes to any content change at rest.)
//
// ⚠ The release must also cover OS Reduce-Motion: the `.expander` transition is
// `calc(.28s * var(--motion-scale))`, which collapses to 0s when Reduce-Motion is on — and a 0s
// transition fires NO `transitionend`. So when the resolved duration is ~0 we skip straight to `none`
// (instant, unclamped); only when it's > 0 do we tween and then release (transitionend, with a
// timeout backstop for e.g. a backgrounded tab that never fires the event).
//
// Extracted from main.jsx in Stage C, Step 4a (only the React-hook imports were added).
const OPEN_BUFFER_PX = 2 // sub-pixel safety for the OPEN TWEEN's target only (released to `none` at rest)

// The element's resolved max-height transition duration in ms (0 under Reduce-Motion).
function transitionMs(el: HTMLElement): number {
  const d = getComputedStyle(el).transitionDuration.split(',')[0].trim()
  return (parseFloat(d) || 0) * (d.endsWith('ms') ? 1 : 1000)
}

export default function Expander({ open, children }: { open: boolean; children?: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const prevOpenRef = useRef(open)
  const mountedRef = useRef(false)
  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const measured = () => (innerRef.current?.scrollHeight ?? 0) + OPEN_BUFFER_PX

    // First run: snap to the current state with no animation — an initially-open panel must not
    // animate in, and must not be clipped, so it goes STRAIGHT to `none`.
    if (!mountedRef.current) {
      mountedRef.current = true
      prevOpenRef.current = open
      el.style.transition = 'none'
      el.style.maxHeight = open ? 'none' : '0px'
      el.getBoundingClientRect() // flush the snap before re-enabling transitions
      el.style.transition = ''
      return
    }

    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open

    if (open && !wasOpen) {
      const ms = transitionMs(el)
      if (ms <= 0) {
        // No animation (Reduce-Motion): straight to the released, never-clipped state.
        el.style.maxHeight = 'none'
        return
      }
      // Animated: tween 0 → measured height, then RELEASE the clamp to `none` at the end so the panel
      // can never clip its content at rest. transitionend releases precisely; the timeout backstops it
      // (a backgrounded tab may not fire transitionend). `released` de-dupes the two.
      el.style.maxHeight = measured() + 'px'
      let released = false
      const release = () => {
        if (released) return
        released = true
        if (prevOpenRef.current) el.style.maxHeight = 'none'
      }
      const onEnd = (e: TransitionEvent) => {
        if (e.target === el && e.propertyName === 'max-height') release()
      }
      el.addEventListener('transitionend', onEnd)
      const timer = setTimeout(release, ms + 80)
      return () => {
        clearTimeout(timer)
        el.removeEventListener('transitionend', onEnd)
      }
    }

    if (!open && wasOpen) {
      // Closing: pin the current (possibly `none`/auto) height to a concrete px, reflow, then collapse
      // to 0 so the CSS transition has two heights to tween between. (scrollHeight is the full content
      // height regardless of max-height/overflow, so this works whether we were at `none` or a px cap.)
      el.style.maxHeight = el.scrollHeight + 'px'
      el.getBoundingClientRect() // flush
      el.style.maxHeight = '0px'
      return
    }

    // open === wasOpen (the effect re-ran without an open change — shouldn't happen with [open] deps,
    // but keep it sane by reflecting the current state).
    el.style.maxHeight = open ? 'none' : '0px'
  }, [open])
  return (
    <div ref={outerRef} className="expander">
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
