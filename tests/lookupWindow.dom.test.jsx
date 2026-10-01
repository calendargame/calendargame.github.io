// @vitest-environment jsdom
//
// LOOKUP'S HISTORY LIST IS WINDOWED (components/scrollRegion's useWindowedRows, drawn by
// components/LookupCard).
//
// The history is unlimited, so the list can be thousands of rows long. It draws only the rows in
// and near the viewport and stands in for the rest with two blank spacers, so that it scrolls like a
// short list while behaving, in every way a player can see, like the whole one: the same height, the
// same count beside the heading, a selection that survives being scrolled away, and a selected row
// that is brought into view.
//
// ⚠ jsdom LAYS NOTHING OUT, which is the one thing a window is computed from — so this file gives it
// the three numbers the hook reads, and only those: a drawn row's rect (from its own `data-row`),
// the list's clientHeight, and a scrollTop that sticks. With nothing to measure the hook draws every
// row instead (pinned at the foot of this file, and relied on by tests/lookupCard.dom throughout).
// Whether it is SMOOTH at 5,000 rows is a real-browser question; this proves the arithmetic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import LookupCard from '../src/components/LookupCard.jsx'
import { addLookupEntry } from '../src/store/lookupHistory.js'
import { installResizeObserver } from './helpers/scrollGeometry.js'

const ROW = 32 //    a row's height, px
const PITCH = 40 //  from one row's top to the next row's (the row + its 8px gap)
const VIEW = 400 //  the list's visible height: ten rows

// 5,000 distinct real dates, newest first, the way the store holds them.
const HISTORY = Array.from({ length: 5000 }, (_, i) => ({
  id: `h${i}`,
  y: 2000 + Math.floor(i / 336),
  m: (Math.floor(i / 28) % 12) + 1,
  d: (i % 28) + 1,
}))

function Host({ initialHistory = HISTORY, initialSelected = null }) {
  const [history, setHistory] = React.useState(initialHistory)
  const [input, setInput] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [calcDate, setCalcDate] = React.useState(null)
  const [selectedId, setSelectedId] = React.useState(initialSelected)
  const [calcOpen, setCalcOpen] = React.useState(false)
  return (
    <LookupCard
      history={history}
      onAddHistory={(e) => setHistory((prev) => addLookupEntry(prev, e))}
      onClearHistory={() => setHistory([])}
      inputValue={input}
      onInputChange={setInput}
      outputValue={output}
      onOutputChange={setOutput}
      calcDate={calcDate}
      onCalcDateChange={setCalcDate}
      selectedHistoryId={selectedId}
      onSelectedHistoryIdChange={setSelectedId}
      calcOpen={calcOpen}
      onCalcOpenChange={setCalcOpen}
      dateFormat="numeric-mdy"
      fmtDate={(y, m, d) => `${m}/${d}/${y}`}
    />
  )
}

const list = () => document.querySelector('ul')
const drawn = () => [...list().querySelectorAll('li[data-row]')]
const drawnIndexes = () => drawn().map((li) => Number(li.dataset.row))
const spacers = () => [...list().querySelectorAll('li[role="presentation"]')]
const px = (el) => parseFloat(el.style.height)
// The list's full content height, as the browser would add it up: both spacers, every drawn row,
// and the gap above every row but the list's first.
const contentHeight = () =>
  spacers().reduce((sum, s) => sum + px(s), 0) +
  drawn().reduce((sum, li) => sum + ROW + (li.className.includes('mt-2') ? PITCH - ROW : 0), 0)
const scrollTo = (y) =>
  act(() => {
    list().scrollTop = y
    fireEvent.scroll(list())
  })
const selectedRow = () =>
  drawn().find((li) => li.querySelector('button').className.includes('bg-(--hist-sel)'))

let layout = true
// The geometry the mocks report — the three constants above, until a test changes one to model the
// list being resized or its rows changing size (and then delivers the resize: `resized`).
let geo = { row: ROW, pitch: PITCH, view: VIEW }
let observer
const resized = (change) =>
  act(() => {
    geo = { ...geo, ...change }
    observer.resize(list())
  })
beforeEach(() => {
  layout = true
  geo = { row: ROW, pitch: PITCH, view: VIEW }
  observer = installResizeObserver()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const row = layout && this.dataset?.row !== undefined ? Number(this.dataset.row) : null
    const top = row === null ? 0 : row * geo.pitch
    const height = row === null ? 0 : geo.row
    return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return layout && this.tagName === 'UL' ? geo.view : 0
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  observer.restore()
})

describe('a history of 5,000 draws a window of rows, not 5,000', () => {
  it('draws only the rows near the top, and still counts every one in the heading', () => {
    render(<Host />)
    // Ten rows fit; the window keeps a margin of rows drawn past each edge on top of that.
    expect(drawn().length).toBeGreaterThanOrEqual(10)
    expect(drawn().length).toBeLessThan(60)
    expect(drawnIndexes()[0]).toBe(0)
    expect(document.querySelector('.lookup-history-header').firstElementChild.textContent).toBe(
      'History (5000)',
    )
  })

  it('is exactly as tall as the whole list would be — the spacers stand in for the undrawn rows', () => {
    render(<Host />)
    const whole = HISTORY.length * PITCH - (PITCH - ROW) // 5,000 rows and the 4,999 gaps between them
    expect(contentHeight()).toBe(whole)
    scrollTo(80000)
    expect(contentHeight()).toBe(whole)
    scrollTo(HISTORY.length * PITCH) // past the end
    expect(contentHeight()).toBe(whole)
    expect(drawnIndexes().at(-1)).toBe(4999)
  })

  it('scrolling moves the window: the rows now in view are drawn, and the ones left behind are not', () => {
    render(<Host />)
    scrollTo(80000) // row 2000 is at the top of the view
    const indexes = drawnIndexes()
    for (let i = 2000; i < 2010; i++) expect(indexes).toContain(i)
    expect(indexes).not.toContain(0)
    expect(indexes[0]).toBeLessThan(2000) // a margin above…
    expect(indexes.at(-1)).toBeGreaterThan(2009) // …and below, for a fling to land on
    expect(drawn().length).toBeLessThan(60)
    // The rows are consecutive — a window, not a sample.
    expect(indexes).toEqual(indexes.map((_, k) => indexes[0] + k))
  })

  it('tells a screen reader each row`s place in the WHOLE list', () => {
    render(<Host />)
    scrollTo(80000)
    const row = drawn().find((li) => li.dataset.row === '2000')
    expect(row.getAttribute('aria-setsize')).toBe('5000')
    expect(row.getAttribute('aria-posinset')).toBe('2001')
    for (const s of spacers()) expect(s.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the selected row, when it is not where the list happens to be scrolled', () => {
  it('a row selected far down the list is brought to the middle of the view when the list appears', () => {
    // What a reload does: Lookup comes back with its selected row (store/sessionLookup), and that
    // row may be thousands of rows from the top.
    render(<Host initialSelected="h3000" />)
    expect(list().scrollTop).toBe(3000 * PITCH - (VIEW - ROW) / 2)
    expect(selectedRow()?.dataset.row).toBe('3000')
    // …and the answer is the selected entry's, whether or not anything is drawn.
    expect(document.querySelector('.min-h-15').textContent).toContain('12/5/2008')
  })

  it('the selection survives its row being scrolled away and drawn again', () => {
    render(<Host initialSelected="h3000" />)
    scrollTo(0)
    expect(selectedRow()).toBeUndefined() // not drawn at all up here
    expect(document.querySelector('.min-h-15').textContent).toContain('12/5/2008') // still the answer
    scrollTo(3000 * PITCH)
    expect(selectedRow()?.dataset.row).toBe('3000')
  })

  it('arrowing past the bottom of the view scrolls the list along with the selection', () => {
    render(<Host />)
    act(() => fireEvent.click(drawn()[9].querySelector('button'))) // the last row wholly in view
    expect(list().scrollTop).toBe(0)
    act(() => fireEvent.keyDown(document, { key: 'ArrowDown' }))
    expect(selectedRow()?.dataset.row).toBe('10')
    expect(list().scrollTop).toBe(10 * PITCH + ROW - VIEW) // just far enough to show all of row 10
    act(() => fireEvent.keyDown(document, { key: 'ArrowUp' }))
    act(() => fireEvent.keyDown(document, { key: 'ArrowUp' }))
    expect(selectedRow()?.dataset.row).toBe('8')
    expect(list().scrollTop).toBe(10 * PITCH + ROW - VIEW) // row 8 was already in view: no scroll
  })

  it('a new lookup lands at the top and the list comes back up to show it', () => {
    render(<Host />)
    scrollTo(80000)
    fireEvent.change(document.querySelector('input'), { target: { value: '7/4/1776' } })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
    expect(list().scrollTop).toBe(0)
    expect(selectedRow()?.dataset.row).toBe('0')
    expect(selectedRow().textContent).toContain('7/4/1776')
    expect(document.querySelector('.lookup-history-header').firstElementChild.textContent).toBe(
      'History (5001)',
    )
  })

  it('tapping a row that is already in view moves nothing', () => {
    render(<Host />)
    scrollTo(80000)
    act(() =>
      fireEvent.click(
        drawn()
          .find((li) => li.dataset.row === '2004')
          .querySelector('button'),
      ),
    )
    expect(list().scrollTop).toBe(80000)
    expect(selectedRow()?.dataset.row).toBe('2004')
  })
})

// ── The list's geometry changing under the player ────────────────────────────────────────────────
// Show Codes opening in the card above takes the list's room; a rotation changes the font, and so
// the rows. ONE rule for both (components/scrollRegion's useWindowedRows): what the player was
// looking at stays — the row at the top of the view stays at the top, and the selected row is
// brought back into view only if it was whole in view before. It used to answer a change of row
// size by jumping to the selected row wherever the player had scrolled, and a change of box size by
// doing nothing, which let the selected row slide out under the fold.
describe('the geometry changes under the list', () => {
  const pickRow = (n) =>
    act(() =>
      fireEvent.click(
        drawn()
          .find((li) => li.dataset.row === String(n))
          .querySelector('button'),
      ),
    )
  // Is row `n` whole inside the list's box right now?
  const wholeInView = (n) =>
    n * geo.pitch >= list().scrollTop && n * geo.pitch + geo.row <= list().scrollTop + geo.view

  it('the list shrinking (Show Codes opening) keeps a selected row that was in view, in view', () => {
    render(<Host />)
    pickRow(8) // near the foot of a ten-row view
    expect(list().scrollTop).toBe(0)
    resized({ view: 160 }) // four rows of room left
    expect(wholeInView(8)).toBe(true)
    expect(list().scrollTop).toBe(8 * PITCH + ROW - 160) // scrolled only as far as it had to
    resized({ view: VIEW }) // the codes close again: nothing needs to move
    expect(list().scrollTop).toBe(8 * PITCH + ROW - 160)
  })

  it('the list shrinking does not bring back a selected row the player had scrolled away from', () => {
    render(<Host />)
    pickRow(2)
    scrollTo(2000) // fifty rows down: row 2 is long gone
    resized({ view: 160 })
    expect(list().scrollTop).toBe(2000)
  })

  it('the rows changing size keeps the row at the top of the view at the top', () => {
    render(<Host />)
    pickRow(2)
    scrollTo(50 * PITCH) // row 50 at the top of the view; the selected row 2 scrolled away
    resized({ pitch: 50, row: 40 }) // a bigger font
    expect(list().scrollTop).toBe(50 * 50) // row 50 is still the first row — not a jump back to row 2
  })

  it('the rows changing size keeps a selected row that was in view, in view', () => {
    render(<Host />)
    pickRow(9) // the last row whole in a ten-row view
    resized({ pitch: 50, row: 40 }) // eight rows fit now: row 9 would be below the fold
    expect(wholeInView(9)).toBe(true)
  })

  it('a resize that changes nothing moves nothing', () => {
    render(<Host initialSelected="h3000" />)
    scrollTo(0)
    resized({})
    expect(list().scrollTop).toBe(0)
  })
})

describe('where there is nothing to measure', () => {
  it('draws every row — correct, and only as slow as the list is long', () => {
    layout = false // every size reads 0: a layout-free environment, or a list that is not displayed
    render(<Host initialHistory={HISTORY.slice(0, 300)} />)
    expect(drawn()).toHaveLength(300)
    expect(spacers()).toHaveLength(0)
  })

  it('a short list is simply drawn whole, with no spacers', () => {
    render(<Host initialHistory={HISTORY.slice(0, 8)} />)
    expect(drawnIndexes()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(spacers()).toHaveLength(0)
  })
})
