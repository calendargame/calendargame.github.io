// @vitest-environment jsdom
//
// How-to-Play DotDiagram ↔ shared dot layout consistency. The diagram (components/GuidePage) must be
// a pure DERIVATION of the shared DOT_CELLS grid (lib/dotLayout — the same data that positions the
// real Dots answer input) + the DAY names (lib/format): dot positions from (r,c), labels from the
// day names' first three letters, and the aria-label sentence from the filled cells in row order.
// These tests pin BOTH ends: the canonical physical layout in DOT_CELLS itself (so a data edit
// can't silently pass a derivation-only check), and the rendered SVG/aria-label against that data.
//
// ★ AND SINCE THE LAYOUT TURNS (Settings → Display → Dot Layout) the same pair of claims is made
// TWICE, once per orientation, with the rotated one's cells written out by hand here. That
// hand-copy is the whole value of this file's half of the contract: lib/dotLayout BUILDS the
// rotated array by mapping the upright one, so a test that re-derived it the same way would agree
// with a wrong rotation just as happily as with a right one.
//
// ⚠ Q3 (round 20): the store field driving this is the boolean `rotateDots`, set here through
// setRotateDots(orientation === 'rows') — the diagram itself still derives through DOT_CELLS keyed
// by 'columns' | 'rows', via GuidePage's own dotOrientationFor(rotateDots) call. UNLIKE the title-bar
// mark (tests/dotOrientation.dom), this diagram is NOT gated on inputStyle — see the standalone case
// at the foot of this file for why, and GuidePage's own header comment for the fuller argument
// (it documents what turning the toggle on WOULD look like, regardless of the player's current
// Input choice, the same way it renders at all regardless of Input).
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderGuidePage } from './helpers/guideScroller.jsx'
import { useSettings } from '../src/store/settings.js'
import { DOT_CELLS } from '../src/lib/dotLayout.js'
import { DAY } from '../src/lib/format.js'

// The physical truth, stated independently of the module under test: weekday index → grid cell.
//   columns — Sun centre, Mon bottom-right, Tue mid-right, Wed top-right, Thu bottom-left,
//             Fri mid-left, Sat top-left; centre-top (1,2) and centre-bottom (3,2) stay empty.
//   rows    — the same seven a quarter turn ANTICLOCKWISE: the two weekday triples that ran down
//             the side columns now lie along the top (Wed, Tue, Mon) and the bottom (Sat, Fri,
//             Thu); Sunday is the turn's fixed point, and the empty pair moves to the middle row's
//             two ends, (2,1) and (2,3).
const CANONICAL = {
  columns: [
    { r: 2, c: 2 }, // Sunday
    { r: 3, c: 3 }, // Monday
    { r: 2, c: 3 }, // Tuesday
    { r: 1, c: 3 }, // Wednesday
    { r: 3, c: 1 }, // Thursday
    { r: 2, c: 1 }, // Friday
    { r: 1, c: 1 }, // Saturday
  ],
  rows: [
    { r: 2, c: 2 }, // Sunday    — centre, unmoved
    { r: 1, c: 3 }, // Monday    — was bottom-right → top-right
    { r: 1, c: 2 }, // Tuesday   — was mid-right    → top-centre
    { r: 1, c: 1 }, // Wednesday — was top-right    → top-left
    { r: 3, c: 3 }, // Thursday  — was bottom-left  → bottom-right
    { r: 3, c: 2 }, // Friday    — was mid-left     → bottom-centre
    { r: 3, c: 1 }, // Saturday  — was top-left     → bottom-left
  ],
}
// Which two cells are unoccupied in each orientation — the dead cells a press slides onto to cancel.
const EMPTY = { columns: ['1,2', '3,2'], rows: ['2,1', '2,3'] }
// What a screen reader announces, pinned verbatim per orientation. Derivable from the cells + DAY,
// but asserted as a literal so a bug in the derivation AND the data can't cancel out.
const SPOKEN = {
  columns:
    'Dots layout: Saturday top-left, Wednesday top-right, Friday middle-left, Sunday centre, ' +
    'Tuesday middle-right, Thursday bottom-left, Monday bottom-right.',
  rows:
    'Dots layout: Wednesday top-left, Tuesday top-centre, Monday top-right, Sunday centre, ' +
    'Saturday bottom-left, Friday bottom-centre, Thursday bottom-right.',
}

// GuideSection content sits inside an always-mounted Expander (collapsed 0fr grid row, never
// unmounted), so the diagram is queryable without opening its section.
// The mount goes through renderGuidePage (tests/helpers/guideScroller) rather than rendering
// GuidePage bare. Nothing here scrolls or taps, so the scroller is not what this file is about —
// but since round 13 the guide cannot be rendered without one (the coordinator dereferences the
// ref App hands it), and a mount that is merely one click away from throwing is not a mount this
// file should own a private copy of.
let guide = null
const renderDiagram = () => {
  const { container, guide: g } = renderGuidePage()
  guide = g
  const svg = container.querySelector('svg[role="img"]')
  expect(svg).not.toBeNull()
  return svg
}

afterEach(() => {
  guide?.restore()
  guide = null
  cleanup()
  useSettings.getState().resetToFactory()
})

describe('DotDiagram / DOT_CELLS / DAY consistency', () => {
  for (const orientation of ['columns', 'rows']) {
    describe(`orientation: ${orientation}`, () => {
      const cells = () => DOT_CELLS[orientation]

      it('is the canonical 7-dot layout: weekday-indexed, unique cells, the right pair empty', () => {
        expect(DAY).toHaveLength(7)
        expect(cells()).toHaveLength(7)
        expect(cells()).toEqual(CANONICAL[orientation])
        const keys = cells().map(({ r, c }) => `${r},${c}`)
        expect(new Set(keys).size).toBe(7)
        for (const dead of EMPTY[orientation]) expect(keys).not.toContain(dead)
        for (const { r, c } of cells()) {
          expect([1, 2, 3]).toContain(r)
          expect([1, 2, 3]).toContain(c)
        }
      })

      it('renders one labelled dot per weekday, in DAY order, at the cell-derived SVG position', () => {
        useSettings.getState().setRotateDots(orientation === 'rows')
        const svg = renderDiagram()
        const groups = Array.from(svg.querySelectorAll('g'))
        expect(groups).toHaveLength(7)
        groups.forEach((g, i) => {
          const circle = g.querySelector('circle')
          const text = g.querySelector('text')
          // Label = the weekday's first three letters, DOM order = DAY order (Sun..Sat). ⚠ DOM
          // order is INVARIANT under the turn — only the drawn position moves — which is the
          // diagram's half of the same promise the real input makes about children[idx].
          expect(text.textContent).toBe(DAY[i].slice(0, 3))
          // Position derived from the shared grid cell: x = 30+(c-1)*60, y = 28+(r-1)*62.
          const { r, c } = CANONICAL[orientation][i]
          expect(circle.getAttribute('cx')).toBe(String(30 + (c - 1) * 60))
          expect(circle.getAttribute('cy')).toBe(String(28 + (r - 1) * 62))
          // The label sits centred just below its dot.
          expect(text.getAttribute('x')).toBe(circle.getAttribute('cx'))
          expect(text.getAttribute('y')).toBe(String(Number(circle.getAttribute('cy')) + 27))
        })
      })

      it('speaks the layout accurately: aria-label lists every day at its cell position, in row order', () => {
        useSettings.getState().setRotateDots(orientation === 'rows')
        expect(renderDiagram().getAttribute('aria-label')).toBe(SPOKEN[orientation])
      })
    })
  }

  // The two orientations must be the SAME SEVEN DAYS rearranged — not a second layout that happens
  // to have seven dots in it. Stated against the hand-written pair above, so it holds even if
  // lib/dotLayout stopped computing one from the other.
  it('the two orientations are one layout turned: same seven cells, only Sunday fixed', () => {
    const key = ({ r, c }) => `${r},${c}`
    expect(new Set(CANONICAL.rows.map(key))).not.toEqual(new Set(CANONICAL.columns.map(key)))
    expect(CANONICAL.rows[0]).toEqual(CANONICAL.columns[0]) // Sunday, the turn's fixed point
    for (let i = 1; i < 7; i++) expect(CANONICAL.rows[i]).not.toEqual(CANONICAL.columns[i])
  })

  // ⚠ UNLIKE THE TITLE-BAR MARK (tests/dotOrientation.dom), this diagram is NOT gated on
  // inputStyle — stated as its own case rather than left implicit, since Q3 added exactly that gate
  // to the OTHER consumer of this setting and a reader could otherwise wonder why this one lacks it.
  // GuidePage's own header comment argues why: the diagram documents what turning Dot Layout on
  // WOULD look like, so a player who currently has Buttons selected can still see it — the same way
  // the diagram renders at all regardless of which Input they have chosen.
  it('reflects rotateDots regardless of inputStyle — Buttons included', () => {
    useSettings.getState().setInputStyle('buttons')
    useSettings.getState().setRotateDots(true)
    const svg = renderDiagram()
    const circles = Array.from(svg.querySelectorAll('circle'))
    expect(circles.map((c) => ({ cx: c.getAttribute('cx'), cy: c.getAttribute('cy') }))).toEqual(
      DOT_CELLS.rows.map(({ r, c }) => ({
        cx: String(30 + (c - 1) * 60),
        cy: String(28 + (r - 1) * 62),
      })),
    )
  })
})
