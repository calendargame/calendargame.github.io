// @vitest-environment jsdom
//
// How-to-Play DotDiagram ↔ shared dot layout consistency. The diagram (components/GuidePage) must be
// a pure DERIVATION of the shared DOT_CELLS grid (lib/dotLayout — the same data that positions the
// real Dots answer input) + the DAY names (lib/format): dot positions from (r,c), labels from the
// day names' first three letters, and the aria-label sentence from the filled cells in row order.
// These tests pin BOTH ends: the canonical physical layout in DOT_CELLS itself (so a data edit
// can't silently pass a derivation-only check), and the rendered SVG/aria-label against that data.
//
// ★ AND SINCE THE LAYOUT TURNS (Settings → Display → Rotate Dots: Standard / 45° CCW / 90° CCW) the
// same pair of claims is made THREE times, once per rotation, with the turned cells written out by
// hand here. That hand-copy is the whole value of this file's half of the contract: lib/dotLayout
// BUILDS the turned arrays by mapping the standard one, so a test that re-derived them the same way
// would agree with a wrong rotation just as happily as with a right one.
//
// The store field driving this is `dotRotation` (round 23), set here through setDotRotation.
// UNLIKE the title-bar mark (tests/dotRotation.dom), this diagram is NOT gated on inputStyle — see
// the standalone case at the foot of this file for why, and GuidePage's own header comment for the
// fuller argument (it documents what the chosen rotation looks like, regardless of the player's
// current Input choice, the same way it renders at all regardless of Input).
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderGuidePage } from './helpers/guideScroller.jsx'
import { useSettings } from '../src/store/settings.js'
import { DOT_CELLS, DOT_GRID_SIZE } from '../src/lib/dotLayout.js'
import { DAY } from '../src/lib/format.js'

// The physical truth, stated independently of the module under test: weekday index → grid cell.
//   standard — Sun centre, Mon bottom-right, Tue mid-right, Wed top-right, Thu bottom-left,
//              Fri mid-left, Sat top-left; centre-top (1,2) and centre-bottom (3,2) stay empty.
//   ccw45    — an eighth turn ANTICLOCKWISE, on the 5×5 lattice: the square stands on a corner —
//              Wed top, Sat left, Mon right, Thu bottom — with Tue and Fri on the two diagonals
//              between; Sunday is the lattice's centre, and the empty pair lands on the other two
//              diagonal cells, (2,2) and (4,4). Every filled cell has r + c even — a checkerboard.
//   ccw90    — a quarter turn ANTICLOCKWISE: the two weekday triples that ran down the side
//              columns now lie along the top (Wed, Tue, Mon) and the bottom (Sat, Fri, Thu); Sunday
//              is the turn's fixed point, and the empty pair moves to the middle row's two ends,
//              (2,1) and (2,3).
const CANONICAL = {
  standard: [
    { r: 2, c: 2 }, // Sunday
    { r: 3, c: 3 }, // Monday
    { r: 2, c: 3 }, // Tuesday
    { r: 1, c: 3 }, // Wednesday
    { r: 3, c: 1 }, // Thursday
    { r: 2, c: 1 }, // Friday
    { r: 1, c: 1 }, // Saturday
  ],
  ccw45: [
    { r: 3, c: 3 }, // Sunday    — centre of the 5×5
    { r: 3, c: 5 }, // Monday    — was bottom-right → right tip
    { r: 2, c: 4 }, // Tuesday   — was mid-right    → upper-right
    { r: 1, c: 3 }, // Wednesday — was top-right    → top tip
    { r: 5, c: 3 }, // Thursday  — was bottom-left  → bottom tip
    { r: 4, c: 2 }, // Friday    — was mid-left     → lower-left
    { r: 3, c: 1 }, // Saturday  — was top-left     → left tip
  ],
  ccw90: [
    { r: 2, c: 2 }, // Sunday    — centre, unmoved
    { r: 1, c: 3 }, // Monday    — was bottom-right → top-right
    { r: 1, c: 2 }, // Tuesday   — was mid-right    → top-centre
    { r: 1, c: 1 }, // Wednesday — was top-right    → top-left
    { r: 3, c: 3 }, // Thursday  — was bottom-left  → bottom-right
    { r: 3, c: 2 }, // Friday    — was mid-left     → bottom-centre
    { r: 3, c: 1 }, // Saturday  — was top-left     → bottom-left
  ],
}
// Which two cells are unoccupied in each rotation — the dead cells a press slides onto to cancel.
const EMPTY = { standard: ['1,2', '3,2'], ccw45: ['2,2', '4,4'], ccw90: ['2,1', '2,3'] }
// Each rotation's grid size, and the diagram's step between neighbouring cells on it, about a middle
// cell drawn at (90, 90). The 5×5's steps are the 3×3's (60 × 62) turned and scaled by the 45°
// layout's 0.8 — × 0.8/√2, to hundredths — so the diagram is drawn in the input's own proportions.
const GRID = {
  standard: { size: 3, x: 60, y: 62 },
  ccw45: { size: 5, x: 33.94, y: 35.07 },
  ccw90: { size: 3, x: 60, y: 62 },
}
const MID = { 3: 2, 5: 3 }
// What a screen reader announces, pinned verbatim per rotation. Derivable from the cells + DAY,
// but asserted as a literal so a bug in the derivation AND the data can't cancel out.
const SPOKEN = {
  standard:
    'Dots layout: Saturday top-left, Wednesday top-right, Friday middle-left, Sunday centre, ' +
    'Tuesday middle-right, Thursday bottom-left, Monday bottom-right.',
  ccw45:
    'Dots layout: Wednesday top, Tuesday upper-right, Saturday left, Sunday centre, ' +
    'Monday right, Friday lower-left, Thursday bottom.',
  ccw90:
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
  for (const rotation of ['standard', 'ccw45', 'ccw90']) {
    describe(`rotation: ${rotation}`, () => {
      const cells = () => DOT_CELLS[rotation]
      const { size, x: stepX, y: stepY } = GRID[rotation]

      it('is the canonical 7-dot layout: weekday-indexed, unique cells, the right pair empty', () => {
        expect(DAY).toHaveLength(7)
        expect(cells()).toHaveLength(7)
        expect(cells()).toEqual(CANONICAL[rotation])
        expect(DOT_GRID_SIZE[rotation]).toBe(size)
        const keys = cells().map(({ r, c }) => `${r},${c}`)
        expect(new Set(keys).size).toBe(7)
        for (const dead of EMPTY[rotation]) expect(keys).not.toContain(dead)
        for (const { r, c } of cells()) {
          expect(r).toBeGreaterThanOrEqual(1)
          expect(r).toBeLessThanOrEqual(size)
          expect(c).toBeGreaterThanOrEqual(1)
          expect(c).toBeLessThanOrEqual(size)
        }
      })

      it('renders one labelled dot per weekday, in DAY order, at the cell-derived SVG position', () => {
        useSettings.getState().setDotRotation(rotation)
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
          // Position derived from the shared grid cell, about the middle cell at (90, 90) — for the
          // 3×3 that is x = 30+(c-1)*60, y = 28+(r-1)*62, the diagram's original formula.
          const { r, c } = CANONICAL[rotation][i]
          expect(Number(circle.getAttribute('cx'))).toBeCloseTo(90 + (c - MID[size]) * stepX, 2)
          expect(Number(circle.getAttribute('cy'))).toBeCloseTo(90 + (r - MID[size]) * stepY, 2)
          // The label sits centred just below its dot.
          expect(text.getAttribute('x')).toBe(circle.getAttribute('cx'))
          expect(text.getAttribute('y')).toBe(String(Number(circle.getAttribute('cy')) + 27))
        })
        // Every rotation fits the SAME frame, labels included (viewBox 0 0 180 192; r 11 dots).
        expect(svg.getAttribute('viewBox')).toBe('0 0 180 192')
        for (const g of groups) {
          const cx = Number(g.querySelector('circle').getAttribute('cx'))
          const cy = Number(g.querySelector('circle').getAttribute('cy'))
          expect(cx - 11).toBeGreaterThanOrEqual(0)
          expect(cx + 11).toBeLessThanOrEqual(180)
          expect(cy - 11).toBeGreaterThanOrEqual(0)
          expect(cy + 27).toBeLessThanOrEqual(192)
        }
      })

      it('speaks the layout accurately: aria-label lists every day at its cell position, in row order', () => {
        useSettings.getState().setDotRotation(rotation)
        expect(renderDiagram().getAttribute('aria-label')).toBe(SPOKEN[rotation])
      })
    })
  }

  // The rotations must be the SAME SEVEN DAYS rearranged — not other layouts that happen to have
  // seven dots in them. Stated against the hand-written cells above, so it holds even if
  // lib/dotLayout stopped computing one from another.
  it('90° is the standard layout turned: same seven cells, only Sunday fixed', () => {
    const key = ({ r, c }) => `${r},${c}`
    expect(new Set(CANONICAL.ccw90.map(key))).not.toEqual(new Set(CANONICAL.standard.map(key)))
    expect(CANONICAL.ccw90[0]).toEqual(CANONICAL.standard[0]) // Sunday, the turn's fixed point
    for (let i = 1; i < 7; i++) expect(CANONICAL.ccw90[i]).not.toEqual(CANONICAL.standard[i])
  })

  // 45° is the one rotation whose grid is not the standard one, so its claim is geometric: centred
  // on the lattice, each day sits at the standard offset turned an eighth anticlockwise and scaled
  // by √2 — (u, v) → (u + v, v − u), with v pointing DOWN the screen — and two of these eighth
  // turns are the 90° turn. Worked from the hand-written tables, not from lib/dotLayout's function.
  it('45° is the standard layout turned an eighth: the offsets rotate, and twice over is 90°', () => {
    const off = ({ r, c }, centre) => ({ u: c - centre, v: r - centre })
    const eighth = ({ u, v }) => ({ u: u + v, v: v - u })
    for (let i = 0; i < 7; i++) {
      const s = off(CANONICAL.standard[i], 2)
      expect(off(CANONICAL.ccw45[i], 3)).toEqual(eighth(s))
      // Twice: (u, v) → (2v, −2u), which is the 90° turn (u, v) → (v, −u) at twice the scale.
      const quarter = off(CANONICAL.ccw90[i], 2)
      expect(eighth(eighth(s))).toEqual({ u: 2 * quarter.u, v: 2 * quarter.v })
      // The checkerboard: every filled 45° cell has an even r + c.
      expect((CANONICAL.ccw45[i].r + CANONICAL.ccw45[i].c) % 2).toBe(0)
    }
  })

  // ⚠ UNLIKE THE TITLE-BAR MARK (tests/dotRotation.dom), this diagram is NOT gated on inputStyle —
  // stated as its own case rather than left implicit, since round 20 added exactly that gate to the
  // OTHER consumer of this setting and a reader could otherwise wonder why this one lacks it.
  // GuidePage's own header comment argues why: the diagram documents what the chosen rotation looks
  // like, so a player who currently has Buttons selected can still see it — the same way the
  // diagram renders at all regardless of which Input they have chosen.
  it('reflects Rotate Dots regardless of inputStyle — Buttons included', () => {
    useSettings.getState().setInputStyle('buttons')
    useSettings.getState().setDotRotation('ccw45')
    const svg = renderDiagram()
    const circles = Array.from(svg.querySelectorAll('circle'))
    circles.forEach((circle, i) => {
      const { r, c } = CANONICAL.ccw45[i]
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(90 + (c - 3) * 33.94, 2)
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(90 + (r - 3) * 35.07, 2)
    })
  })
})
