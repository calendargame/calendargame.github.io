// @vitest-environment jsdom
//
// The codes panel's FREEZE STATE MACHINE (components/MethodBreakdown) — round 11.
//
// MethodBreakdownSection holds the four inputs its body reads (date, format, cellDates, Julian)
// steady for CODES_CLOSE_MS after the panel starts closing, so the contents cannot change while
// it is still visibly sliding shut. The Expander wiring around that — the stated duration, the
// aria disclosure contract, the per-instance panel id — is pinned in expander.dom; what lives
// here is the machine itself, and specifically the transition the machine used to get wrong:
// the DATE GOING AWAY.
//
// A date going away is a close like any other (the panel's `open` folds in hasDate), and until
// round 11 the freeze effect opened with `if (!date) return`. That skipped the close path: React ran
// the previous run's cleanup, clearing the pending release timer, and armed nothing in its
// place, so the panel stayed flagged as closing and the frozen snapshot stayed at the date that
// had already gone away until the next open overwrote it. It was never VISIBLE, because a
// section with no date is forced closed — which is exactly why it is pinned here rather than
// left to be rediscovered: the guard is a real guarantee this file states out loud, not a
// coincidence that happened to cover for a stuck machine.
//
// Every case is driven controlled (open + onOpenChange), which is the shape all six live call
// sites use. Motion is CSS and unverifiable in jsdom; what is asserted is the machine's state,
// read through the body the frozen snapshot renders.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MethodBreakdownSection } from '../src/components/MethodBreakdown.jsx'
import { CODES_CLOSE_MS } from '../src/lib/accordionMotion.js'

const DATE = { y: 2024, m: 3, d: 15 }
const OTHER = { y: 1999, m: 12, d: 31 }
// What the body renders once the snapshot has been released to a null date.
const RELEASED = 'Show Codes is only supported for AD dates.'

const section = (props) => (
  <MethodBreakdownSection className="" contentClassName="codes-body" {...props} />
)
// Container-scoped, not by id: a couple of these tests mount a second tree as an oracle.
const bodyText = (container) => container.querySelector('.codes-body').textContent

// The oracle for "the snapshot is showing date X": what a panel opened fresh on X renders.
const codesTextFor = (date) => {
  const { container, unmount } = render(section({ date, open: true, onOpenChange: () => {} }))
  const text = bodyText(container)
  unmount()
  return text
}

describe('codes panel — the freeze releases when the date goes away (round 11)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
  })

  it('date removed MID-CLOSE: the snapshot still releases, on the same window', () => {
    const onOpenChange = vi.fn()
    const { container, rerender } = render(section({ date: DATE, open: true, onOpenChange }))
    expect(bodyText(container)).toBe(codesTextFor(DATE))
    // Hide Codes — the panel begins sliding shut and the freeze window opens.
    rerender(section({ date: DATE, open: false, onOpenChange }))
    act(() => vi.advanceTimersByTime(CODES_CLOSE_MS - 50))
    expect(bodyText(container)).toBe(codesTextFor(DATE)) // still held, still mid-slide
    // …and now the date goes away inside that window (a reset, or Lookup selecting a gap entry).
    rerender(section({ date: null, open: false, onOpenChange }))
    act(() => vi.advanceTimersByTime(CODES_CLOSE_MS))
    expect(bodyText(container)).toBe(RELEASED)
  })

  it('date removed while OPEN: the snapshot is HELD for the slide, then released', () => {
    // The hold is the reason a null date takes the close path instead of releasing on the spot:
    // the panel is mid-slide, and swapping the codes for the "AD dates" line would be visible.
    const onOpenChange = vi.fn()
    const { container, rerender } = render(section({ date: DATE, open: true, onOpenChange }))
    rerender(section({ date: null, open: true, onOpenChange }))
    expect(bodyText(container)).toBe(codesTextFor(DATE))
    act(() => vi.advanceTimersByTime(CODES_CLOSE_MS - 1))
    expect(bodyText(container)).toBe(codesTextFor(DATE))
    act(() => vi.advanceTimersByTime(1))
    expect(bodyText(container)).toBe(RELEASED)
  })

  it('after the release the machine is idle: the next date is taken up at once', () => {
    // The stuck-closing tell. With the machine wedged, a date arriving after the null one is
    // treated as another dep change during a close and waits out a phantom freeze window,
    // leaving the body on the previous date's codes for CODES_CLOSE_MS.
    const onOpenChange = vi.fn()
    const { container, rerender } = render(section({ date: DATE, open: true, onOpenChange }))
    rerender(section({ date: null, open: false, onOpenChange }))
    act(() => vi.advanceTimersByTime(CODES_CLOSE_MS))
    expect(bodyText(container)).toBe(RELEASED)
    rerender(section({ date: OTHER, open: false, onOpenChange }))
    expect(bodyText(container)).toBe(codesTextFor(OTHER))
  })
})

describe('codes panel — a section with no date renders nothing from its snapshot', () => {
  afterEach(cleanup)

  // The downstream guard the stale snapshot used to hide behind. It is a genuine guarantee —
  // a dateless panel is closed no matter what the caller passes, and it tells the caller so —
  // and this is the file that says it in those terms.
  it('the caller can say open; with no date the panel is closed and the caller is corrected', () => {
    const onOpenChange = vi.fn()
    const { container } = render(section({ date: null, open: true, onOpenChange }))
    const button = container.querySelector('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.expander').classList.contains('expander-open')).toBe(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
