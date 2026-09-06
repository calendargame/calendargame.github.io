// @vitest-environment jsdom
//
// THE STAT-BOX VALUE AUTO-FIT — WHERE THE FITTED SIZE LANDS, AND WHAT THE BOX DOES ABOUT IT.
//
// ★ THE DEFECT THIS FILE WAS WRITTEN FOR (the owner's photo of the strip). Each of the six value
// boxes fits INDEPENDENTLY: a long value gets a smaller inline font-size so it stays in its cell.
// A smaller font-size means a shorter line box, and the cell packs its children from the top, so a
// shrunken value used to sit HIGHER than its un-shrunk neighbours as well as smaller — "940/1001"
// riding above the "93.9%" beside it. Same class as the ⚙ footer-button catch of 2026-07-13
// (SettingsPanel's fitFooterBtns): a fitted size and an un-fitted strut in one box do not share a
// line. The footer's answer — size the CONTAINER so the strut shrinks with the text — cannot be
// borrowed here, because these six shrink by different amounts and a shrinking container would make
// six different cell heights out of one row. So the box stopped depending on its content instead:
// a fixed-height `h-[1lh]` cell with the value CENTRED in it.
//
// ⚠ WHAT THIS FILE CANNOT DO. jsdom has no layout engine — no line boxes, no baselines, no heights —
// so nothing here proves the values line up. That is device-only, and it is the whole point of the
// change. What IS pinnable is everything the pixels rest on, and it is pinned:
//   • the fitted size is applied to the VALUE SPAN and to nothing else (not to the cell, whose type
//     must stay at the base size or `1lh` stops being the base line box);
//   • the fit measures the span's natural width against the CELL's width — which only works while
//     the cell is full-width, the trap `w-full` exists for;
//   • the box is described identically whatever the value is, so its height cannot depend on one;
//   • the value cannot wrap, which a time of "1m 2.34s" made possible for the first time.
//
// Geometry is STUBBED rather than mocked away: jsdom reports every width as 0, which is exactly the
// no-op case the production code is written to survive, so a test that only mounted the panel would
// assert nothing about the apply path at all. Defining scrollWidth/clientWidth on the real nodes
// drives the same code the browser drives, and the numbers are the only fiction.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import StatPanel from '../src/components/StatPanel.jsx'

// The base type has to come from a real stylesheet: fitAll reads `getComputedStyle(span).fontSize`
// as the size to scale DOWN from, and jsdom applies no Tailwind. 14px is text-sm at the default root
// size — the number does not matter, only that the scaled result is derived from it.
const BASE_PX = 14
const styleBase = () => {
  const el = document.createElement('style')
  el.textContent = `[data-statval]{font-size:${BASE_PX}px}`
  document.head.appendChild(el)
  return el
}
// A width the element will report for as long as the test runs. `configurable` so a later stub on
// the same node wins rather than throwing.
const stub = (el, prop, value) =>
  Object.defineProperty(el, prop, { value, configurable: true, writable: true })

const stats = [
  { label: 'Score', value: '940/1001' }, // the long one from the photo
  { label: 'Accuracy', value: '93.9%' }, // the short one beside it
]
// The value spans in strip order — the fixture is two cells, so [0] is the long value and [1] the
// short one beside it. Read by marker, never by position in the cell, for the same reason the
// per-mode helpers do: a cell can carry a trailing sr-only "Off".
const valueSpans = () => [...document.querySelectorAll('[data-statval]')]

describe('StatPanel value auto-fit — the fitted size lands on the value span alone', () => {
  afterEach(() => {
    cleanup()
    document.head.querySelectorAll('style').forEach((el) => el.remove())
  })

  // ★ THE APPLY PATH. A value measuring twice its cell gets exactly half the base size, written
  // inline on the span. The CELL keeps no inline size at all — if the fit ever moved up to the
  // container the way the footer-button fit did, `h-[1lh]` would resolve against a shrunken
  // line-height and the box would collapse with the text, reintroducing the defect at cell scale.
  it('a too-wide value is scaled on the span; its cell is never inline-sized', () => {
    styleBase()
    const { rerender } = render(<StatPanel stats={stats} dimmed={false} />)
    const span = valueSpans()[0]
    stub(span, 'scrollWidth', 216) // natural
    stub(span.parentElement, 'clientWidth', 116) // the cell; fitAll subtracts 8 → 108 available
    rerender(<StatPanel stats={stats} dimmed={false} />) // the layout effect re-fits on every render
    expect(span.style.fontSize).toBe(`${BASE_PX * 0.5}px`)
    expect(span.parentElement.style.fontSize).toBe('')
    expect(span.parentElement.getAttribute('style')).toBeNull()
  })

  // A value that already fits is left ALONE — not scaled to 1, not given an inline size at all.
  // Short values keeping their full size is a requirement, not an optimisation: shrinking every box
  // to the longest value's size would trade a misalignment for a strip of needlessly tiny numbers.
  it('a value that fits keeps the base size, with no inline font-size written', () => {
    styleBase()
    const { rerender } = render(<StatPanel stats={stats} dimmed={false} />)
    const [long, short] = valueSpans()
    stub(long, 'scrollWidth', 216)
    stub(long.parentElement, 'clientWidth', 116)
    stub(short, 'scrollWidth', 60)
    stub(short.parentElement, 'clientWidth', 116)
    rerender(<StatPanel stats={stats} dimmed={false} />)
    expect(long.style.fontSize).toBe('7px')
    expect(short.style.fontSize).toBe('') // untouched — the two boxes fit independently
  })

  // ⚠ THE RESET. The effect has no dependency array and re-runs on every render, so it must measure
  // from the BASE each time; reading the size it wrote last pass would compound (14 → 7 → 3.5 → …).
  // Production guards this by clearing the inline size before measuring — pinned by feeding the
  // second pass a value that now fits and expecting the full size back, not a smaller one.
  it('re-fitting starts from the base, so a shrink never compounds', () => {
    styleBase()
    const { rerender } = render(<StatPanel stats={stats} dimmed={false} />)
    const span = valueSpans()[0]
    stub(span, 'scrollWidth', 216)
    stub(span.parentElement, 'clientWidth', 116)
    rerender(<StatPanel stats={stats} dimmed={false} />)
    expect(span.style.fontSize).toBe('7px')
    stub(span, 'scrollWidth', 60) // the value got shorter
    rerender(<StatPanel stats={stats} dimmed={false} />)
    expect(span.style.fontSize).toBe('') // all the way back to base, not 7px of it
  })

  // ⚠ THE MEASURE TARGET. `avail` comes from the span's PARENT, so the parent has to be the
  // full-width cell. A shrink-to-fit wrapper would report the value's own width instead and every
  // box would shrink for ever; `w-full` is what stops it, and this is the line that names it.
  it('the fit measures the value against its full-width cell', () => {
    styleBase()
    const { rerender } = render(<StatPanel stats={stats} dimmed={false} />)
    const span = valueSpans()[0]
    expect(span.parentElement.className).toContain('w-full')
    stub(span, 'scrollWidth', 200)
    stub(span.parentElement, 'clientWidth', 108) // 100 available after the 8px divider allowance
    rerender(<StatPanel stats={stats} dimmed={false} />)
    expect(span.style.fontSize).toBe('7px') // 100/200 of 14px — the CELL's width governed
  })
})

describe('StatPanel value cell — the box the alignment rests on', () => {
  afterEach(cleanup)

  // The height is the box's, not the value's: identical description for a long value, a short one,
  // a dash and a blank. jsdom cannot measure it; what it can prove is that nothing about the value
  // reaches the class list that carries the height.
  it('every value cell is described identically, whatever its value', () => {
    render(
      <StatPanel
        stats={[
          { label: 'Score', value: '940/1001' },
          { label: 'Accuracy', value: '93.9%' },
          { label: 'Last', value: '—' },
          { label: 'Average', value: '1h 2m 3.45s', off: true },
        ]}
        dimmed={false}
      />,
    )
    const classes = valueSpans().map((v) => v.parentElement.className)
    expect(new Set(classes).size).toBe(1)
    expect(classes[0]).toContain('h-[1lh]') // fixed height…
    expect(classes[0]).toContain('items-center') // …with the value centred in it
    expect(classes[0]).toContain('justify-center')
  })

  // ⚠ THE BASE TYPE IS DECLARED ON THE CELL, ONCE. `1lh` is one line box of the CELL's own type, so
  // it is only the right height while the cell and the value it contains agree on a size — which
  // they cannot fail to do while the value inherits. A `text-sm` re-added to the span would be inert
  // today and wrong the moment either one changes.
  it('the cell owns the base size and the value inherits it', () => {
    render(<StatPanel stats={stats} dimmed={false} />)
    const span = valueSpans()[0]
    expect(span.parentElement.className).toContain('text-sm')
    expect(span.parentElement.className).toContain('leading-tight')
    expect(span.className).not.toContain('text-sm')
  })

  // ⚠ THE SPACE. Until the minutes shape landed no value could contain one — times read "59.99s",
  // and a score's slash is no break opportunity between digits. A minute-plus time reads "1m 2.34s",
  // which WOULD wrap: two lines inside a one-line-tall box, and a scrollWidth that reports the
  // wrapped width instead of the natural one the fit needs. Both failures, one missing class.
  it('a value can never wrap — the minutes shape put a space inside one', () => {
    render(<StatPanel stats={[{ label: 'Average', value: '1m 2.34s' }]} dimmed={false} />)
    expect(valueSpans()[0].className).toContain('whitespace-nowrap')
    expect(valueSpans()[0].textContent).toBe('1m 2.34s')
  })
})
