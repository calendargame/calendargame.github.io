// @vitest-environment jsdom
//
// lookupCard.dom.test.jsx — LookupCard's BEHAVIOUR (round-8 Q2, extended by round-11 Q2). The
// component had no behaviour test at all before round 8: scrollRegion.dom pins its geometry
// classes, lookupHistory.* pins the saved shape (progress.* did, before Q1/round 20 moved it out),
// but nothing described what the card actually does when you type into it.
//
// Three contracts are locked here.
//
// 1. The ANSWER SLOT is always present, at a constant height, in every state. Before round-8 Q2 the
//    result line rendered only when there was a result, so the panel below it jumped by a line the
//    moment you pressed Lookup and jumped back when you pressed Clear. Now the slot always exists:
//    it shows the hint when there is nothing to say, and the answer or the error when there is.
//    Round-11 Q2 made it three EXPLICIT ROWS — the date, then the reading(s) — instead of a
//    sentence whose wrap decided the height. (The HEIGHT is a class contract — jsdom lays nothing
//    out — so the test asserts the reserving class is on the node, plus that the node itself never
//    disappears, plus that the row COUNT is what the reserve was sized for.)
//
// 2. The answer is DERIVED, never stored. The live bug this replaces: the history rows re-rendered
//    under the current Date Format while the result line above them kept the format the lookup was
//    made in, so the same date read two different ways on one screen. The regression pin is in the
//    "derived, not stored" block — an entry saved under one format renders in the format live NOW.
//
// 3. A date before the Gregorian reform is AMBIGUOUS, and the card shows BOTH calendars (round-11
//    Q2). That is what makes contract 2 possible for the Julian setting too: with no calendar
//    chosen there is nothing per-entry to freeze, so a stored date can never be re-read later as a
//    different — or an impossible — one. The bug it fixes: an entry created with Julian on was
//    re-derived as a valid GREGORIAN date once Julian was turned off, so February 29 of a
//    Julian-only leap year printed March 1's weekday under a February 29 label.
//
// The card keeps all of its state in the parent, so these tests drive it through a small
// controlled host that wires the props to real state, exactly as App does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import LookupCard from '../src/components/LookupCard.jsx'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { addLookupEntry, LOOKUP_HISTORY_CAP } from '../src/store/lookupHistory.js'
import { fmt } from '../src/lib/format.js'
import { isOffered } from './helpers/offered.js'

const HINT = 'Enter a date to see its weekday.'
const GAP = 'October 5–14, 1582 never existed — 10 days skipped in the Gregorian switch.'

// The controlled host: the same prop wiring App uses, with `lookupOutput` exposed so the tests can
// assert on it directly (isFullyReset in main.tsx reads it as "" to dim/lock Full Reset).
function Host({ dateFormat = 'written-mdy', useJulian = false, initialHistory = [] }) {
  const [history, setHistory] = React.useState(initialHistory)
  const [input, setInput] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [calcDate, setCalcDate] = React.useState(null)
  const [selectedId, setSelectedId] = React.useState(null)
  const [calcOpen, setCalcOpen] = React.useState(false)
  const fmtDate = React.useCallback((y, m, d) => fmt(y, m, d, dateFormat), [dateFormat])
  return (
    <>
      <output data-testid="lookup-output">{output}</output>
      <LookupCard
        history={history}
        onAddHistory={(e) => setHistory((prev) => addLookupEntry(prev, e))}
        onMoveHistory={(id) =>
          setHistory((prev) => {
            const i = prev.findIndex((e) => e.id === id)
            if (i <= 0) return prev
            return [prev[i], ...prev.slice(0, i), ...prev.slice(i + 1)]
          })
        }
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
        fmtDate={fmtDate}
        dateFormat={dateFormat}
        useJulian={useJulian}
      />
    </>
  )
}

// The slot is the only min-h-15 node in the card — found by class so the test doesn't depend on
// which of its several possible contents is currently showing.
const slot = (container) => container.querySelector('.min-h-15')
// The slot's lines. An answer is structured rows (the date, then the reading(s)); the hint and the
// errors are one plain string. Returning both as an array keeps every assertion in one shape.
const lines = (container) => {
  const node = slot(container)
  return node.children.length ? [...node.children].map((c) => c.textContent) : [node.textContent]
}
// A history row, as [formatted date, readings].
const rows = (container) =>
  [...container.querySelectorAll('ul li button')].map((b) =>
    [...b.querySelectorAll('span')].map((s) => s.textContent),
  )
const lookup = (container, text) => {
  fireEvent.change(container.querySelector('input'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Lookup' }))
}

describe('Lookup answer slot — always rendered, constant height (round-8 Q2 / round-11 Q2)', () => {
  afterEach(cleanup)

  it('a fresh card shows the hint, in the dimmer tone, in a three-line slot', () => {
    const { container } = render(<Host />)
    const node = slot(container)
    expect(node).not.toBeNull()
    expect(node.textContent).toBe(HINT)
    expect(node.className).toContain('min-h-15') // 3.75rem = three text-sm lines, fluid-root-scaled
    expect(node.className).toContain('text-(--tx-200-70)') // hint tone, not answer tone
  })

  it('an answer replaces the hint and takes the brighter answer tone', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '7/4/1776')
    expect(lines(container)).toEqual(['7/4/1776', 'Thursday'])
    expect(slot(container).className).toContain('text-(--tx-100-90)')
  })

  // The reserve is three lines, so nothing may ever ask for a fourth. These are the three shapes
  // that can land in it, and the widest of each: an unambiguous date (2), an ambiguous one (3), and
  // the gap message, which is one line of date plus a message that occupies the other two.
  it('nothing that can land in the slot needs more than the three rows reserved', () => {
    const { container } = render(<Host dateFormat="written-mdy" />)
    lookup(container, '9/24/1444')
    expect(lines(container)).toHaveLength(3)
    lookup(container, '7/4/1776')
    expect(lines(container)).toHaveLength(2)
    lookup(container, '10/10/1582')
    expect(lines(container)).toHaveLength(2) // the date, then the message (two lines of wrap)
  })

  it('every error family lands in the SAME slot node — the card never changes height', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    const node = slot(container)
    lookup(container, 'not a date')
    expect(slot(container)).toBe(node)
    expect(node.textContent).toBe('Enter date as m/d/y, e.g. 3/14/1592')
    lookup(container, '7/4/99999')
    expect(node.textContent).toBe('Year must be between 1 and 10000')
    lookup(container, '13/4/1776')
    expect(node.textContent).toBe('Month must be 1–12')
    lookup(container, '2/30/1776')
    expect(node.textContent).toBe('Day must be 1–29 for February')
    expect(slot(container)).toBe(node) // same node throughout: nothing was mounted or unmounted
  })

  it('Clear restores the hint (and Clear History does too)', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '7/4/1776')
    expect(lines(container)).toEqual(['7/4/1776', 'Thursday'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(slot(container).textContent).toBe(HINT)
    lookup(container, '7/4/1776')
    fireEvent.click(screen.getByRole('button', { name: 'Clear History' }))
    expect(slot(container).textContent).toBe(HINT)
    expect(screen.getByText('No lookups yet')).toBeTruthy()
  })

  // The HARD constraint from round-8 Q2: the hint is a render-time fallback, never state. main.tsx
  // computes isFullyReset from lookupOutput === "" — if the hint were ever written into that
  // state, the Full Reset button would silently unlock on a brand-new, untouched app.
  it('lookupOutput stays "" while the hint shows, and while an ANSWER shows', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    const out = screen.getByTestId('lookup-output')
    expect(slot(container).textContent).toBe(HINT)
    expect(out.textContent).toBe('') // fresh card: isFullyReset still holds
    lookup(container, '7/4/1776')
    expect(out.textContent).toBe('') // the answer is derived from the selection, not stored
    lookup(container, 'not a date')
    expect(out.textContent).toBe('Enter date as m/d/y, e.g. 3/14/1592') // errors DO live there
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(out.textContent).toBe('')
  })
})

describe('Lookup — the Oct 5–14, 1582 gap (round-8 Q2)', () => {
  afterEach(cleanup)

  // The gap days are NOT an ambiguous date with two readings: isJulianDate ends the Julian era on
  // Oct 4, 1582, so these ten days are neither calendar's — a third thing, which is what the
  // message says. Round-11 Q2 left this answer word for word as it was.
  it('answers with the short message; the long version lives in the How-to-Play guide', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '10/10/1582')
    expect(lines(container)).toEqual(['10/10/1582', GAP])
    expect(rows(container)).toEqual([['10/10/1582', 'Does Not Exist']])
  })

  it('re-looking-up a gap date replays the same message from history', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '10/10/1582')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(slot(container).textContent).toBe(HINT)
    lookup(container, '10/10/1582')
    expect(lines(container)).toEqual(['10/10/1582', GAP])
    expect(screen.getAllByText('Does Not Exist')).toHaveLength(1) // replayed, not duplicated
  })
})

describe('Lookup — the answer is derived, not stored (round-8 Q2 regression pin)', () => {
  afterEach(cleanup)

  // THE bug: an entry saved under one Date Format kept its rendered sentence, so after the user
  // switched formats the result line read the old way while the history row right below it read
  // the new way. Both come from {y,m,d} now, so both follow the live setting.
  it('an entry stored under one Date Format renders its answer in the CURRENT format', () => {
    const stored = { id: 'e1', y: 1776, m: 7, d: 4 }
    const { container } = render(
      <Host dateFormat="written-mdy" initialHistory={[stored]} useJulian={false} />,
    )
    // Select it from history: the answer is built now, in the format that is live now.
    fireEvent.click(container.querySelector('ul button'))
    expect(lines(container)).toEqual(['July 4, 1776', 'Thursday'])

    cleanup()
    // Same stored entry, different live format — same date, re-rendered, no stale copy anywhere.
    const second = render(<Host dateFormat="numeric-dmy" initialHistory={[stored]} />)
    fireEvent.click(second.container.querySelector('ul button'))
    expect(lines(second.container)).toEqual(['4.7.1776', 'Thursday'])
    expect(rows(second.container)).toEqual([['4.7.1776', 'Thursday']])
  })

  // The pin above proves derivation across two MOUNTS. This one changes the format on a LIVE
  // mount, which is the only path a user can actually take — and the one that was broken: the
  // format-change effect cleared the selection, so the answer line did not update, it VANISHED
  // back to the hint. Both the changelog and the How-to-Play guide promise that "changing the
  // Date Format updates the answer line and the whole list together", so this is that sentence,
  // executable.
  it('changing the Date Format on a LIVE card updates the answer — it does not clear it', () => {
    const stored = { id: 'e1', y: 1776, m: 7, d: 4 }
    const { container, rerender } = render(
      <Host dateFormat="written-mdy" initialHistory={[stored]} />,
    )
    fireEvent.click(container.querySelector('ul button'))
    expect(lines(container)).toEqual(['July 4, 1776', 'Thursday'])

    act(() => {
      rerender(<Host dateFormat="numeric-dmy" initialHistory={[stored]} />)
    })
    expect(lines(container)).toEqual(['4.7.1776', 'Thursday']) // updated, not cleared
    expect(rows(container)).toEqual([['4.7.1776', 'Thursday']]) // together
    // The input is always NUMERIC, and its separator and field order just changed, so it is
    // rewritten in place rather than emptied — the box still holds the date you are looking at.
    expect(container.querySelector('input').value).toBe('4.7.1776')
  })

  // The other half of the same rule: with nothing selected there is no date to re-render, and a
  // half-typed value in the old format would not parse — so that, and only that, is cleared.
  it('with nothing selected, a Date Format change clears the typed input and any error', () => {
    const { container, rerender } = render(<Host dateFormat="written-mdy" />)
    lookup(container, 'nonsense')
    expect(slot(container).textContent).toContain('Enter date as')
    expect(container.querySelector('input').value).toBe('nonsense')

    act(() => {
      rerender(<Host dateFormat="numeric-dmy" />)
    })
    expect(container.querySelector('input').value).toBe('')
    expect(slot(container).textContent).toBe(HINT) // the stale error named the old format
  })
})

// ── Both calendars for an ambiguous date (round-11 Q2) ────────────────────────────────────────
// Weekday oracles below are independent of the app's own arithmetic: Julian Oct 4, 1582 was a
// Thursday and the next day was Gregorian Oct 15, a Friday (the pair calendar.test.js also pins),
// and the rest follow from the fixed 10-day offset in that era.
describe('Lookup — a pre-reform date shows BOTH calendars (round-11 Q2)', () => {
  afterEach(cleanup)

  it('names both readings in full, one per line, Julian first', () => {
    const { container } = render(<Host dateFormat="written-mdy" />)
    lookup(container, '9/24/1444')
    expect(lines(container)).toEqual([
      'September 24, 1444',
      'Julian: Thursday',
      'Gregorian: Tuesday',
    ])
  })

  // The reason this replaced the "(Julian)" / "(Gregorian)" suffix: the setting used to decide what
  // a stored date WAS, so turning it off re-read every pre-reform entry as a different date. Now it
  // reaches neither the answer nor the rows, and the same entry reads identically either way.
  it('the Julian Calendar setting changes neither the answer nor the rows', () => {
    const stored = { id: 'e1', y: 1444, m: 9, d: 24 }
    const off = render(<Host dateFormat="written-mdy" initialHistory={[stored]} />)
    fireEvent.click(off.container.querySelector('ul button'))
    const answerOff = lines(off.container)
    const rowsOff = rows(off.container)
    cleanup()

    const on = render(<Host dateFormat="written-mdy" initialHistory={[stored]} useJulian />)
    fireEvent.click(on.container.querySelector('ul button'))
    expect(lines(on.container)).toEqual(answerOff)
    expect(rows(on.container)).toEqual(rowsOff)
  })

  // The 12 February 29ths that only Julian's every-fourth-year rule grants. This is the bug in its
  // sharpest form: with Julian off the card used to REFUSE to create the date, and an entry created
  // with Julian on then re-derived as a Gregorian February 29 — printing March 1's Thursday under
  // a February 29 label, with "(Gregorian)" appended as a positive claim that it was a real date.
  it('February 29, 1500 is a real Julian date and no Gregorian date at all', () => {
    for (const useJulian of [false, true]) {
      const { container } = render(<Host dateFormat="written-mdy" useJulian={useJulian} />)
      lookup(container, '2/29/1500')
      expect(lines(container)).toEqual([
        'February 29, 1500',
        'Julian: Saturday',
        'Gregorian: Does Not Exist',
      ])
      cleanup()
    }
  })

  // …and one where BOTH calendars have the date: 1200 is a leap year under either rule.
  it('February 29, 1200 exists in both, and both agree on the weekday', () => {
    const { container } = render(<Host dateFormat="written-mdy" />)
    lookup(container, '2/29/1200')
    expect(lines(container)).toEqual(['February 29, 1200', 'Julian: Tuesday', 'Gregorian: Tuesday'])
  })

  // The era boundary, from both sides. isJulianDate ends on Oct 4, 1582; Oct 15 is the first
  // Gregorian day and has one reading, unlabelled.
  it('Oct 4, 1582 is ambiguous; Oct 15, 1582 is not', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '10/4/1582')
    expect(lines(container)).toEqual(['10/4/1582', 'Julian: Thursday', 'Gregorian: Monday'])
    lookup(container, '10/15/1582')
    expect(lines(container)).toEqual(['10/15/1582', 'Friday'])
  })

  // The history rows carry the same information compactly — measured at 375px, where the full
  // weekday form overflows the row by 5.8px and a wrap would give the one scrolling list two row
  // heights. A row with a single reading is untouched: no label, no separator, full weekday.
  it('history rows abbreviate both readings, and leave a single reading alone', () => {
    const { container } = render(<Host dateFormat="written-mdy" />)
    lookup(container, '7/4/1776')
    lookup(container, '9/24/1444')
    lookup(container, '2/29/1500')
    expect(rows(container)).toEqual([
      ['February 29, 1500', 'J: Sat · G: Does Not Exist'],
      ['September 24, 1444', 'J: Thu · G: Tue'],
      ['July 4, 1776', 'Thursday'],
    ])
  })

  // The either-calendar rule is an acceptance rule, not a licence: a date that exists in NEITHER
  // calendar is still refused, and the day ceiling in the message is the higher of the two.
  it('rejects a date that exists in neither calendar, naming the higher ceiling', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '2/30/1500')
    expect(slot(container).textContent).toBe('Day must be 1–29 for February') // Julian's 29th counts
    lookup(container, '2/29/1900')
    expect(slot(container).textContent).toBe('Day must be 1–28 for February') // post-reform: one rule
  })

  // Validation now runs BEFORE the history match. Until round-11 Q2 the match short-circuited
  // ahead of the day check, so a date the app refuses to CREATE became answerable the moment an
  // entry for it happened to be stored — same input, same settings, opposite outcome depending on
  // the contents of a list. The either-calendar rule closed the reachable path to that (nothing
  // storable is refusable any more, and normalizeLookupEntries drops impossible entries on load),
  // so this pins the ORDER itself: the guarantee is stated, not left to be a coincidence.
  it('an impossible date in history is still refused, not answered', () => {
    const impossible = { id: 'e1', y: 1776, m: 2, d: 30 }
    const { container } = render(
      <Host dateFormat="numeric-mdy" initialHistory={[impossible]} />, //
    )
    lookup(container, '2/30/1776')
    expect(slot(container).textContent).toBe('Day must be 1–29 for February')
    expect(container.querySelector('ul button').className).not.toContain('bg-(--hist-sel)')
  })

  // Show Codes teaches ONE method, and the Julian Calendar setting still picks which — but it can
  // no longer pick a calendar the date does not exist in. With the setting off, February 29, 1500
  // would otherwise be walked through as a Gregorian date that never happened.
  it('Show Codes follows the setting, except where only one calendar has the date', () => {
    const codes = (container) => container.querySelector('.lookup-method-section').textContent
    const showCodes = () => fireEvent.click(screen.getByRole('button', { name: /Show Codes/ }))

    const both = render(<Host dateFormat="numeric-mdy" />)
    lookup(both.container, '9/24/1444')
    showCodes()
    expect(codes(both.container)).toContain('Gregorian Calendar') // setting off, both readings real
    cleanup()

    const julianOnly = render(<Host dateFormat="numeric-mdy" />)
    lookup(julianOnly.container, '2/29/1500')
    showCodes()
    expect(codes(julianOnly.container)).toContain('Julian Calendar') // setting off, reality wins
  })
})

// ── The isFullyReset contract, at App level (round-8 Q2) ─────────────────────────────────────
// The Full Reset footer button is dimmed and locked exactly while the whole app sits at launch
// state, and App reads `lookupOutput === ""` as one of the terms. Round-8 Q2 changed who writes
// that state: a successful lookup used to store its result sentence there and now stores nothing
// (the answer is derived from the selected history entry). This test is the direct consequence pin
// — a real lookup must still light Full Reset, through the OTHER Lookup terms (history, input,
// selection, calcDate) — and it fails if a later change ever writes the hint string into that
// state, which would unlock Full Reset on an untouched app. Pristine settings, no overrides, so
// isFullyReset can actually be true. Mirrors the C3a freshness pin in blitz.dom.
const mountApp = () => {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

describe('Lookup — Full Reset freshness (isFullyReset reads lookupOutput)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // isFullyReset also requires the launch mode, so every check below is made from Classic — which
  // is the honest question anyway: after a trip through Lookup, is the app back at launch state?
  const fullReset = () => screen.getByRole('button', { name: /Full Reset/ })
  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))

  it('visiting Lookup and reading the hint leaves nothing behind — Full Reset stays dimmed', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'L' })) // to Lookup
    expect(screen.getByText(HINT)).toBeTruthy() // the hint IS on screen…
    act(() => fireEvent.keyDown(window, { key: 'K' })) // …back to Classic
    toggleSettings()
    expect(isOffered(fullReset())).toBe(false) // …and it was only ever text
  })

  // ⚠ RESTRUCTURED TWICE (Q1, round 20): the first pass dropped `lookupHistory.length===0` from
  // isFullyReset on the assumption Full Reset would stop reaching the (now-shared) history — the
  // owner overruled that: Full Reset still clears it, from whichever preset you press it (there is
  // only one copy). So the term is back, reading `displayLookupHistory` (the permanent list plus
  // this session's amnesic overflow — main.tsx), and BOTH Clear and Clear History are needed to
  // re-dim Full Reset again, exactly as before this feature existed: Clear alone resets the other
  // five Lookup terms (input, output, calcDate, selection, calcOpen) but LEAVES the history entry
  // standing, so the button stays lit until Clear History (or Full Reset itself) empties the list.
  it('a real lookup lights Full Reset; it takes both Clear and Clear History to dim it again', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'L' }))
    const input = document.querySelector('input[placeholder^="e.g.,"]')
    // The input takes the numeric form of the live Date Format; the ANSWER comes back written.
    act(() => fireEvent.change(input, { target: { value: '7/4/1776' } }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
    expect(lines(document)).toEqual(['July 4, 1776', 'Thursday'])
    act(() => fireEvent.keyDown(window, { key: 'K' }))
    toggleSettings()
    expect(isOffered(fullReset())).toBe(true) // the lookup registered, without lookupOutput
    toggleSettings() // close the panel
    act(() => fireEvent.keyDown(window, { key: 'L' }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(screen.getByText(HINT)).toBeTruthy()
    // The entry is still in the History list — Clear only clears the INPUT/answer, never the saved
    // list — so Full Reset must stay lit: there is still something on screen it would remove.
    expect(screen.getByRole('button', { name: 'Clear History' })).toBeTruthy()
    act(() => fireEvent.keyDown(window, { key: 'K' }))
    toggleSettings()
    expect(isOffered(fullReset())).toBe(true) // Clear alone was NOT enough — the entry remains
    toggleSettings()
    // Clear History empties the list, and with the other five Lookup terms already reset by Clear
    // above, that is what finally brings Full Reset back down.
    act(() => fireEvent.keyDown(window, { key: 'L' }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear History' })))
    expect(screen.queryByRole('button', { name: 'Clear History' })).toBeNull()
    act(() => fireEvent.keyDown(window, { key: 'K' }))
    toggleSettings()
    expect(isOffered(fullReset())).toBe(false) // both steps together were enough
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The history WINDOW and the count beside the heading (round 13).
// The cap has always existed and nothing described it; it moved 20 → 100 this round, and the
// count is what makes it visible without opening a menu. The rule's one owner is
// store/lookupHistory (addLookupEntry), so this reads the real number rather than restating it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const dated = (i) => ({ id: `h${i}`, y: 1900 + (i % 120), m: (i % 12) + 1, d: (i % 28) + 1 })
const header = () => document.querySelector('.lookup-history-header')
// The heading LABEL — the count's host. Read separately from the header row, which also holds the
// Clear History button from the first entry on.
const heading = () => header().firstElementChild.textContent

describe('Lookup history: the window, and the count beside the heading (round 13)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('keeps the newest LOOKUP_HISTORY_CAP and drops the oldest off the end', () => {
    const over = Array.from({ length: LOOKUP_HISTORY_CAP + 25 }, (_, i) => dated(i))
    const kept = over.reduce((prev, entry) => addLookupEntry(prev, entry), [])
    expect(kept).toHaveLength(LOOKUP_HISTORY_CAP)
    expect(kept[0]).toEqual(over[over.length - 1]) // newest to the FRONT
    expect(kept.at(-1)).toEqual(over[over.length - LOOKUP_HISTORY_CAP])
    expect(kept).not.toContainEqual(over[0]) // …and the oldest is simply gone
  })

  it('shows nothing at 0 or 1 entries — a “(1)” beside a list you can see is noise', () => {
    const { rerender } = render(<LookupCard history={[]} />)
    expect(heading()).toBe('History')
    rerender(<LookupCard history={[dated(0)]} />)
    expect(heading()).toBe('History')
  })

  it('appears on the second entry and reads the total, up to and including the cap', () => {
    const all = Array.from({ length: LOOKUP_HISTORY_CAP }, (_, i) => dated(i))
    const { rerender } = render(<LookupCard history={all.slice(0, 2)} />)
    expect(heading()).toBe('History (2)')
    rerender(<LookupCard history={all.slice(0, 3)} />)
    expect(heading()).toBe('History (3)')
    // At the cap it simply reads (100) and stays there — the owner's call.
    rerender(<LookupCard history={all} />)
    expect(heading()).toBe(`History (${LOOKUP_HISTORY_CAP})`)
  })

  it('cannot reflow the header: no new flex child, no block box, and it may not wrap', () => {
    // The header is a sticky scroll BOUNDARY that casts a shadow onto the list below it, so its
    // height is a contract. jsdom lays nothing out, which is exactly why the guarantee here is
    // structural rather than measured: the count is inline text inside the existing label span —
    // the justify-between row still has its same two children — and whitespace-nowrap is what
    // keeps that one line box true at every width. (Measured in Chromium at 375px wide: 29.375px
    // with the count and 29.375px without.)
    const empty = render(<LookupCard history={[]} />)
    const bare = header()
    const label = bare.firstElementChild
    const rowClass = bare.className
    const childCount = bare.childElementCount
    expect(label.className).toContain('whitespace-nowrap')
    empty.unmount()

    render(<LookupCard history={[dated(0), dated(1)]} />)
    const counted = header()
    expect(counted.className).toBe(rowClass) // the boundary surface itself is untouched
    expect(counted.childElementCount).toBe(childCount + 1) // …+1 = the Clear History button only
    const badge = counted.firstElementChild.querySelector('span')
    expect(badge.textContent).toBe(' (2)') // inline text, its own leading space, no size class
    expect(badge.className).toBe('text-(--tx-300-60)') // the footnote tier — dimmer than the label
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE DATE BOX'S ESCAPE CONTRACT (round 17).
//
// Rounds 15 and 16 put every OTHER typing field in the app on one rule — Enter keeps the edit and
// lets go, Escape throws it away and lets go — and this box was the single hold-out, handling
// Enter only. It is on the rule now, and these cases are that rule, executable.
//
// Two things about it are worth stating up front, because both were written down WRONG before:
//   • ENTER IS UNCHANGED. The comment beside the input used to claim Enter "keeps focus" here.
//     It never did — runLookup blurs on every success path and re-focuses only to show you an
//     error — so Enter has always meant "commit and let go". The `commits and blurs` case below
//     pins the behaviour so the description can never drift from it again.
//   • ESCAPE NEEDS A REMEMBERED TARGET. This box is not a mirror of a stored value the way the ⚙
//     year boxes are (those revert to minY/maxY, sitting right beside the text): `inputValue` IS
//     the text and every keystroke overwrites it, so the value being discarded back to has to be
//     captured. It is captured when the keyboard enters the box, and re-captured whenever the CARD
//     writes the box — the last two cases are that second half, and they are not decoration:
//     Clear keeps focus in the box on purpose, so without the re-capture, Clear-then-Escape would
//     hand back the text Clear had just thrown away.
//
// ⚠ REAL .focus(), NOT fireEvent.focus, throughout — the same trap aox.dom documents. fireEvent
// dispatches the event without moving the browser's focus, so a later .focus() would be a no-op
// that never fires onFocus and the discard target would silently be whatever the box held first.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const box = (container) => container.querySelector('input')
const esc = (el) => act(() => fireEvent.keyDown(el, { key: 'Escape' }))

describe('Lookup date box — Escape discards the edit and lets go (round 17)', () => {
  afterEach(cleanup)

  it('puts back the text the box held when it was focused, and blurs', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: '7/4/1776' } })
      box(container).blur()
    })
    act(() => {
      box(container).focus() // the edit starts here: the baseline is '7/4/1776'
      fireEvent.change(box(container), { target: { value: '7/4/17' } })
    })
    esc(box(container))
    expect(box(container).value).toBe('7/4/1776')
    expect(document.activeElement).not.toBe(box(container)) // …and it let go
  })

  it('from an empty box, Escape puts the empty box back rather than anything convenient', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: '3/14/1592' } })
    })
    esc(box(container))
    expect(box(container).value).toBe('')
    expect(slot(container).textContent).toBe(HINT) // nothing was looked up on the way past
  })

  it('Enter still commits and lets go — and keeps the box only to show you an error', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: '7/4/1776' } })
    })
    act(() => fireEvent.keyDown(box(container), { key: 'Enter' }))
    expect(lines(container)).toEqual(['7/4/1776', 'Thursday'])
    expect(document.activeElement).not.toBe(box(container)) // commit AND let go, as everywhere

    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: 'nonsense' } })
    })
    act(() => fireEvent.keyDown(box(container), { key: 'Enter' }))
    expect(slot(container).textContent).toBe('Enter date as m/d/y, e.g. 3/14/1592')
    expect(document.activeElement).toBe(box(container)) // a refusal holds on, so you can fix it
  })

  it('an Escape on a LATER edit leaves the committed lookup alone', () => {
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    lookup(container, '7/4/1776')
    expect(lines(container)).toEqual(['7/4/1776', 'Thursday'])
    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: '1/1/2000' } })
    })
    esc(box(container))
    expect(box(container).value).toBe('7/4/1776') // the edit went, not the lookup
    expect(lines(container)).toEqual(['7/4/1776', 'Thursday']) // the answer stands
    expect(rows(container)).toEqual([['7/4/1776', 'Thursday']]) // and so does the history
  })

  it('the box consumes the press — nothing downstream of it ever sees the Escape', () => {
    // The stopPropagation, at component level. App's settings Escape listener is a DOCUMENT
    // keydown in the bubble phase, and React 19 attaches its own listener at the root container,
    // so stopping the press there means document never sees it at all. (The consequence that
    // matters — the ⚙ panel surviving the press — is the App-level case below.)
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    const seen = []
    const spy = (e) => seen.push(e.key)
    document.addEventListener('keydown', spy)
    try {
      act(() => box(container).focus())
      esc(box(container))
      expect(seen).toEqual([])
      act(() => fireEvent.keyDown(box(container), { key: 'Enter' })) // …and only Escape is stopped
      expect(seen).toEqual(['Enter'])
    } finally {
      document.removeEventListener('keydown', spy)
    }
  })

  it('Clear moves the baseline: Escape after it cannot resurrect what Clear threw away', () => {
    // Clear preventDefaults its own mousedown, so pressing it leaves the keyboard in the box —
    // which is exactly the route that would misbehave if the baseline were only ever set on focus.
    // ⚠ THE BOX MUST ALREADY HOLD TEXT WHEN IT IS FOCUSED, or this case tests nothing: focusing an
    // EMPTY box makes the focus baseline "" too, and then both the right answer and the wrong one
    // land on an empty box. Type, let go, then come back — that is the only shape where the focus
    // baseline and the post-Clear baseline differ, so it is the only shape that can catch this.
    const { container } = render(<Host dateFormat="numeric-mdy" />)
    act(() => {
      box(container).focus()
      fireEvent.change(box(container), { target: { value: '7/4/1776' } })
      box(container).blur()
    })
    act(() => box(container).focus()) // the focus baseline is '7/4/1776'
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(box(container).value).toBe('')
    expect(document.activeElement).toBe(box(container)) // still holding the keyboard
    esc(box(container))
    expect(box(container).value).toBe('') // Clear stands: Escape may not hand the date back
  })

  it('a Date Format change moves it too — Escape reverts to the REWRITTEN box, not the old one', () => {
    // With an entry selected, a format change rewrites the box into the new numeric format rather
    // than clearing it. The baseline has to follow, or Escape would put back a string in the
    // format that just stopped existing — text the box could no longer parse.
    const stored = { id: 'e1', y: 1776, m: 7, d: 4 }
    const { container, rerender } = render(
      <Host dateFormat="numeric-mdy" initialHistory={[stored]} />,
    )
    act(() => fireEvent.click(container.querySelector('ul button')))
    expect(box(container).value).toBe('7/4/1776')
    act(() => box(container).focus())
    act(() => {
      rerender(<Host dateFormat="numeric-dmy" initialHistory={[stored]} />)
    })
    expect(box(container).value).toBe('4.7.1776')
    esc(box(container))
    expect(box(container).value).toBe('4.7.1776') // not '7/4/1776'
  })
})

describe('Lookup date box — opening the ⚙ panel takes the keyboard with it (round 18)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // ★ RE-BLESSED (round 18, 1D), and it is the twin of the AoX run-length case (tests/aox.dom) on
  // the far side of the same change. Both used to click the gear, assert the box STILL held the
  // keyboard, and pin `e.stopPropagation()` as what kept the resulting Escape from closing the
  // panel. The owner reported that lingering keyboard as a defect of its own — "when the keyboard
  // is open, doing anything at all should close it" — so the state the old case protected is gone.
  //
  // ⚠ fireEvent.click ON THE GEAR IS STILL THE POINT. A click that does not move focus is what a
  // real tap does on iOS and Safari, so this drives the order that used to strand the keyboard,
  // rather than the desktop path where the box blurred on its own.
  //
  // ⚠ AND THIS BOX IS THE OTHER HALF OF THE STORY, which is why the twin case is not a copy: it has
  // NO onBlur, so the blur that closes the keyboard commits nothing and typing is simply left in
  // place. The AoX box commits on blur, so the same rule normalize-commits its edit there. One rule,
  // two honest outcomes, each the box's own contract.
  it('the keyboard goes down with the gear tap, and the typing is left where it was', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'L' })) // to Lookup
    const field = () => document.querySelector('input[placeholder^="e.g.,"]')
    const gear = () => screen.getByRole('button', { name: /^Settings/ })
    act(() => {
      field().focus()
      fireEvent.change(field(), { target: { value: '7/4/1776' } })
      field().blur()
    })
    act(() => {
      field().focus()
      fireEvent.change(field(), { target: { value: '7/4/17' } })
    })
    expect(document.activeElement).toBe(field()) // the keyboard is in the box…
    act(() => fireEvent.click(gear()))
    expect(gear().getAttribute('aria-controls')).toBe('settings-popover') // …the panel opened…
    expect(document.activeElement).not.toBe(field()) // …and the keyboard went down with it
    expect(field().value).toBe('7/4/17') // nothing committed, nothing discarded
    // The next Escape belongs to the panel now, because no box is holding one.
    act(() => fireEvent.keyDown(document, { key: 'Escape' }))
    expect(gear().getAttribute('aria-controls')).toBeNull()
  })
})
