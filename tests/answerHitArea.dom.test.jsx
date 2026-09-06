// @vitest-environment jsdom
//
// tests/answerHitArea.dom.test.jsx — sub-group 1B's hit areas, checked against the RENDERED app.
//
// tests/answerHitPad.test.js proves the model (answerGridHitPad) and the TS↔CSS constants. This
// file proves the join those two cannot see: that the shape each grid actually RENDERS is the shape
// the padding was computed for. Both halves of that are class names — the container's `grid-cols-N`
// and each button's `col-span-N` — and both are literals Tailwind has to be able to scan, so
// neither can be built from the numbers the padding maths uses. They are therefore the same fact
// stated twice, and the only honest check is to read the shape BACK off the DOM, re-run the model
// on it, and demand the rendered data-hit-pad agree. A future edit that changes WeekdayAnswer's
// grid-cols-2 to grid-cols-3, or gives Deduction's Month a different span, fails here.
//
// ⚠ NOTHING HERE IS GEOMETRY. jsdom has no layout engine: no ::after exists, no rectangle is
// measured, and this file could not tell a correct hit area from a 4px one. It checks WHICH SIDES
// each button is told it may claim. That the halves of a gutter actually meet on glass — the 1px
// dead-line trap the CSS comment describes — is the owner's iPhone to confirm, and only his.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { DAY } from '../src/lib/format.js'
import { wday } from '../src/lib/calendar.js'
import { answerGridHitPad } from '../src/lib/answerGrid.js'
import { mountApp, resetAppState } from './helpers/settingsPanel.jsx'

// The four weekday mode panels are always mounted but display:none; Deduction is conditionally
// rendered. Walk ancestors so a raw querySelectorAll ignores the hidden panels.
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const visibleGrid = () =>
  Array.from(document.querySelectorAll('[data-answer-grid="true"]')).find((g) => !isHidden(g))
const ctrl = (name) => screen.getByRole('button', { name })
const click = (el) => act(() => fireEvent.click(el))
const tokens = (el) => el.className.split(/\s+/).filter(Boolean)

// ── The whole point of the file, in one function ─────────────────────────────
// Re-derive the hit padding from what the grid RENDERED, and hand back both sides for comparison.
// cols comes off the container's grid-cols-N; a button's span off its col-span-N (absent = 1).
function shapeOf(grid) {
  const colsCls = tokens(grid).find((c) => /^grid-cols-\d+$/.test(c))
  if (!colsCls) throw new Error(`answer grid wears no grid-cols-N: "${grid.className}"`)
  const buttons = Array.from(grid.children)
  for (const b of buttons) expect(b.tagName).toBe('BUTTON') // children[idx] is also the keyboard 0–9 path
  const spans = buttons.map((b) => {
    const s = tokens(b).find((c) => /^col-span-\d+$/.test(c))
    return s ? Number(s.slice('col-span-'.length)) : 1
  })
  return {
    buttons,
    cols: Number(colsCls.slice('grid-cols-'.length)),
    spans,
    rendered: buttons.map((b) => b.getAttribute('data-hit-pad')),
    expected: answerGridHitPad(Number(colsCls.slice('grid-cols-'.length)), spans),
  }
}
// One assertion, used everywhere: every option carries an attribute, and it is the one the shape
// on screen calls for. `toBe(null)` on a missing attribute is the case that matters most — a
// button with no attribute at all matches no CSS rule and silently keeps the OLD clipped shape,
// corners and all, which is exactly the regression nobody would notice.
function expectHitPadMatchesRenderedShape(grid, label) {
  const { buttons, cols, spans, rendered, expected } = shapeOf(grid)
  buttons.forEach((b, i) => {
    expect(
      rendered[i],
      `${label}: option ${i} ("${b.textContent.trim()}") has no data-hit-pad`,
    ).not.toBe(null)
  })
  expect(rendered, `${label}: cols=${cols} spans=[${spans}]`).toEqual(expected)
  return { rendered, spans, cols }
}

function pin({ minY = 1583, maxY = 10000, useJulian = true } = {}) {
  resetAppState()
  const s = useSettings.getState()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setUseJulian(useJulian)
  s.setMinY(minY)
  s.setMaxY(maxY)
}
const switchToDeduction = () => act(() => fireEvent.keyDown(window, { key: 'D' }))

describe('answer hit areas — the rendered grid and its padding describe one shape', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pin()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the weekday grid: 7 labelled options over 2 columns, Saturday spanning the last row', () => {
    mountApp()
    const grid = visibleGrid()
    const { rendered, spans, cols } = expectHitPadMatchesRenderedShape(grid, 'weekday')
    // Pinned explicitly as well as re-derived: this grid's shape is FIXED (it is DAY, seven names),
    // so the literal is a real statement about the app rather than a restatement of the model.
    expect({ cols, spans }).toEqual({ cols: 2, spans: [1, 1, 1, 1, 1, 1, 2] })
    expect(rendered).toEqual(['r b', 'b l', 't r b', 't b l', 't r b', 't b l', 't'])
    // Rule 3 in the DOM: the four corners of the grid claim nothing outward.
    expect(rendered[0]).not.toMatch(/[tl]/) // Sunday, top-left
    expect(rendered[1]).not.toMatch(/[tr]/) // Monday, top-right
    expect(rendered[6]).toBe('t') // Saturday spans the bottom row: left, right and bottom are all outer
  })

  it("★ rule 2 — answering does NOT hand a live button its dead neighbour's half of the gutter", () => {
    // The owner KILLED the "a live button beside a dead one swallows the whole gutter" proposal:
    // he slides onto dead buttons on purpose to CANCEL a press, so dead space is a feature. The
    // model cannot break this (it never learns which option is dead — see answerHitPad.test.js);
    // what CAN break it is the app deciding to stop emitting the attribute on an inert button, or
    // to recompute the grid's padding once an option locks. Both would show up right here.
    mountApp()
    const before = shapeOf(visibleGrid()).rendered
    // Answer wrong: that option locks (persist state, no re-answer) while the rest stay live.
    const el = Array.from(document.querySelectorAll('div')).find(
      (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()),
    )
    const [y, m, d] = el.textContent.trim().split('-').map(Number)
    const wrong = DAY[(wday(y, m, d) + 1) % 7]
    click(ctrl(wrong))
    const grid = visibleGrid()
    const dead = grid.children[DAY.indexOf(wrong)]
    // "Dead" here is the app's own sense of it, and worth being exact about: an already-answered
    // weekday option deliberately stays HIT-TESTABLE — it still highlights as you drag across it
    // (Q4), and WeekdayAnswer's onClick guard is what refuses the re-answer. So it is a live target
    // that does nothing on release: precisely the thing the owner slides onto to cancel.
    expect(dead.className).toContain('btn-wrong-persist')
    expect(dead.className).not.toContain('pointer-events-none')
    // …and every option's claim is byte-for-byte what it was: the answered one keeps its own half
    // (so the CSS still draws its rectangle), and no neighbour grew into it.
    expect(shapeOf(grid).rendered).toEqual(before)
    expectHitPadMatchesRenderedShape(grid, 'weekday after a wrong answer')
  })

  it('the dot layout carries no attribute at all — its rule is "own your cell", stated in CSS', () => {
    // The cluster has NO gutter (a square 3×3 place-items:center grid), so "half the space between
    // two dots" IS "the rest of my own cell", and .dot-btn::after says that once for all seven.
    // A data-hit-pad here would be the labelled grid's rule leaking into a layout it does not
    // describe — and would reach into the two EMPTY cells, which the owner wants dead as an
    // in-cluster place to slide a press onto and cancel it.
    useSettings.getState().setInputStyle('dots')
    mountApp()
    const cluster = visibleGrid()
    expect(cluster.className).toContain('dot-cluster')
    expect(cluster.querySelectorAll('[data-hit-pad]')).toHaveLength(0)
    // Seven dots in nine cells: the two empty cells are the absence of a button, so nothing can
    // claim them however the CSS is written.
    expect(cluster.children).toHaveLength(7)
    expect(Array.from(cluster.children).map((b) => b.getAttribute('aria-label'))).toEqual([...DAY])
  })

  it('Deduction — Day, Month and Year all agree with their own rendered shapes', () => {
    mountApp()
    switchToDeduction()
    for (const sub of ['Day', 'Month', 'Year']) {
      click(ctrl(sub))
      expectHitPadMatchesRenderedShape(visibleGrid(), `Deduction ${sub}`)
    }
  })

  it('Deduction Year — every option count the range can produce, not just the first one dealt', () => {
    // Year is the only grid whose COLUMN COUNT moves with the puzzle (2, 3 or 6 columns, with
    // col-span-2/3 on the 6), so a single deal proves almost nothing. Reroll and check whatever
    // turns up; the assertion is per-deal, so this is a sweep, not a search for one lucky shape.
    mountApp()
    switchToDeduction()
    click(ctrl('Year'))
    const seen = new Set()
    for (let i = 0; i < 40; i++) {
      const { cols, spans } = expectHitPadMatchesRenderedShape(visibleGrid(), 'Deduction Year')
      seen.add(`${cols}:${spans.join(',')}`)
      click(ctrl('New'))
    }
    // The default 5-over-6 shape is overwhelmingly the common deal, so its absence would mean the
    // loop never ran rather than that the app changed — worth stating so a silent no-op can't pass.
    expect([...seen].some((s) => s.startsWith('6:'))).toBe(true)
  })

  it('Deduction Day — an already-answered option keeps its half there too', () => {
    mountApp()
    switchToDeduction()
    click(ctrl('Day'))
    const before = shapeOf(visibleGrid()).rendered
    click(visibleGrid().children[0])
    const grid = visibleGrid()
    expect(shapeOf(grid).rendered).toEqual(before)
    expectHitPadMatchesRenderedShape(grid, 'Deduction Day after an answer')
  })
})
