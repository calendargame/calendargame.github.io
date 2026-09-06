// @vitest-environment jsdom
//
// The Q# card-number badge — the small label at the top-right of the date card (sub-group 3A).
//
// THE DEFECT THIS FILE EXISTS FOR. The badge used to be the card's 1-based slot in THIS SESSION's
// browsable history (`stack.length + 1`). In Classic, Flash and Deduction the SCORE is hydrated
// from saved progress at mount while the history stack deliberately starts empty, so the badge and
// the Score box it sits beside had never agreed: a player 500 cards in answered one, pressed <,
// and read "Q1" next to a Score of "471/501".
//
// THE RULE THE BADGE NOW FOLLOWS: it counts whatever the Score box beside it counts. A mode with
// its own score and stats counts separately — so Deduction's Day / Month / Year each carry their
// own numbering, and Blitz / AoX, whose Begin/Reset zeroes score and history together, keep
// counting from Q1 within the round or run (that is the same number they showed before, which is
// what makes the change invisible there).
//
// Determinism strategy is the one the other mode files use: the date is random, so read it back off
// the screen and compute the correct weekday with the same already-tested calendar function the app
// uses, on a pinned numeric-ymd format and a Gregorian-only year range.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useProgress } from '../src/store/progress.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── Harness ──────────────────────────────────────────────────────────────────────────────────
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
// Every mode panel stays mounted (display:none for the inactive ones), so raw DOM queries must
// walk ancestors to skip the hidden ones — the same isHidden the Blitz/Deduction files use.
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const ctrl = (name) => screen.getByRole('button', { name })
const click = (name) =>
  act(() => {
    fireEvent.click(ctrl(name))
  })
const clickEl = (el) =>
  act(() => {
    fireEvent.click(el)
  })
const pressKey = (key) =>
  act(() => {
    fireEvent.keyDown(window, { key })
  })

// THE BADGE, read the way a player sees it: the one visible leaf whose whole text is Q + digits.
// Returns null when no badge is showing (it only appears while browsing back — and, in AoX, at run
// end), so "the badge is absent" is assertable without a class name or a test-only attribute.
function badge() {
  const els = Array.from(document.querySelectorAll('span')).filter(
    (e) => e.children.length === 0 && /^Q\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length > 1)
    throw new Error(
      `expected one visible Q# badge, found ${els.length}: ${els.map((e) => e.textContent)}`,
    )
  return els[0] ? els[0].textContent.trim() : null
}

// The visible live date, in the pinned numeric-ymd format.
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1)
    throw new Error(
      `expected one visible ymd date, found ${els.length}: ${els.map((e) => e.textContent)}`,
    )
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
// Year range is pinned >=1583, so the active calendar is always Gregorian → plain wday().
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]

// Stat value by its label span, scoped to the visible strip (hidden panels carry the same labels).
// Read through [data-statval] — the marker StatPanel puts on the value span itself — never "the
// cell's last span", which can be a screen-reader-only trailer.
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}

// A prior-session record, seeded through the store's OWN setter (a payload the app never wrote
// would be no evidence). This is the shape of the owner's report: 471 correct of 500 played.
const priorRecord = (played, good) => ({ played, good, streak: 0, best: 3, times: [] })

function pinSettings() {
  localStorage.clear()
  useSettings.getState().resetToFactory()
  useProgress.getState().resetProgress()
  useSettings.getState().setRandomFormat(false)
  useSettings.getState().setDateFormat('numeric-ymd')
  useSettings.getState().setMinY(1583)
  useSettings.getState().setMaxY(10000)
}

// Play one card wrong and advance past it, so it lands in browsable history with a played behind
// it. Wrong-then-New is the shortest route that leaves the Score box unambiguous (good unchanged,
// played +1), which is exactly the disagreement the badge used to show.
function missOneCardAndAdvance() {
  const date = readDate()
  clickEl(screen.getByRole('button', { name: wrongName(date) }))
  click('New')
}

// ── Classic — the reported defect ────────────────────────────────────────────────────────────
describe('Q# badge — Classic counts the player’s lifetime cards', () => {
  beforeEach(pinSettings)
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the badge agrees with the hydrated Score box (was Q1 beside 471/501)', () => {
    useProgress.getState().setModeStats('classic', priorRecord(500, 471))
    mountApp()
    click('New') // normalise the live date to the pinned format
    missOneCardAndAdvance() // the 501st card, missed → 471/501
    expect(statValue('Score')).toBe('471/501')
    expect(badge()).toBe(null) // nothing shown at the live edge
    click('<')
    expect(badge()).toBe('Q501') // the card just played IS the 501st
    expect(statValue('Score')).toBe('471/501') // …and the box beside it says so
  })

  it('steps down one per card browsed, and back up on Forward', () => {
    useProgress.getState().setModeStats('classic', priorRecord(500, 471))
    mountApp()
    click('New')
    missOneCardAndAdvance() // 501st
    missOneCardAndAdvance() // 502nd
    click('<')
    expect(badge()).toBe('Q502')
    click('<')
    expect(badge()).toBe('Q501')
    click('>')
    expect(badge()).toBe('Q502')
  })

  it('a blank slate still counts from Q1 — the number is unchanged with nothing hydrated', () => {
    mountApp()
    click('New')
    missOneCardAndAdvance()
    click('<')
    expect(badge()).toBe('Q1')
    expect(statValue('Score')).toBe('0/1')
  })

  it('Reset Stats re-bases the count with the score it clears', () => {
    useProgress.getState().setModeStats('classic', priorRecord(500, 471))
    mountApp()
    click('New')
    missOneCardAndAdvance()
    click('Reset Stats') // two-tap confirm
    click('Reset Stats?')
    expect(statValue('Score')).toBe('0/0')
    missOneCardAndAdvance()
    click('<')
    expect(badge()).toBe('Q1')
  })
})

// ── Deduction — one count per Score box ──────────────────────────────────────────────────────
// The owner's rule is "the badge follows whatever Score box it sits beside", and Deduction is the
// mode that makes the rule bite: its three sub-modes each keep their own stats silo and their own
// Score, so they must each carry their own numbering. Nothing special is done for them — each
// sub-mode runs its own engine, hydrated from its own silo, so this falls out.
describe('Q# badge — Deduction counts each sub-mode separately', () => {
  beforeEach(pinSettings)
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Day and Month number from their own hydrated totals, not from each other', () => {
    useProgress.getState().setModeStats('dedDay', priorRecord(10, 8))
    useProgress.getState().setModeStats('dedMonth', priorRecord(3, 2))
    mountApp()
    pressKey('D')

    // Day: burn the live card (Reveal counts a played without needing the answer), advance, browse.
    click('Day')
    click('Reveal')
    click('New')
    click('<')
    expect(badge()).toBe('Q11') // 10 prior + this one
    expect(statValue('Score')).toBe('8/11')

    click('Month')
    click('Reveal')
    click('New')
    click('<')
    expect(badge()).toBe('Q4') // 3 prior + this one — Day's 11 does not leak in
    expect(statValue('Score')).toBe('2/4')
  })
})

// ── Blitz — provably unchanged ───────────────────────────────────────────────────────────────
// Blitz (like AoX) begins each round with a full engine reset, which zeroes score and history
// TOGETHER — so its base is 0 by construction and the badge shows exactly the numbers it always
// did. This is the no-regression half of the change, and it must hold with a fat Classic record
// sitting in the same store: Blitz's engine hydrates nothing.
describe('Q# badge — Blitz still counts within the round', () => {
  beforeEach(() => {
    pinSettings()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('counts from Q1 each round, with a 500-card Classic record in the store', () => {
    useProgress.getState().setModeStats('classic', priorRecord(500, 471))
    mountApp()
    pressKey('B')
    click('Begin')
    clickEl(screen.getByRole('button', { name: correctName(readDate()) })) // round card 1
    clickEl(screen.getByRole('button', { name: correctName(readDate()) })) // round card 2
    click('<')
    expect(badge()).toBe('Q2')
    click('<')
    expect(badge()).toBe('Q1')
  })
})
