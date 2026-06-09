// @vitest-environment jsdom
//
// Blitz mode — characterization tests (Stage C, Step 6, Step 3). Blitz is the hardest mode:
// a countdown (Per Round, 60s) or per-question (Per Question / sudden-death, 5s) timer, with
// Best Score / Best Streak records. These lock TODAY's behavior before migrating onto the
// shared engine (which will need a round-stats / best / timerDone extension).
//
// The countdown-to-zero is impractical to fast-forward (rAF runs ~60×/s for 60s), so these
// tests exercise the ANSWER behavior + round-end-via-wrong (reachable without the timer
// expiring). Fake timers keep the rAF countdown from running during the test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
function switchToBlitz() {
  act(() => {
    fireEvent.keyDown(window, { key: 'B' })
  })
}
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
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
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
const dayBtn = (name) => screen.getByRole('button', { name })
const ctrl = (name) => screen.getByRole('button', { name })
const isDisabled = (btn) => btn.className.includes('pointer-events-none')
// Blitz stat cells are <div>s (Blitz can't hide stats, so no toggle/button). Find the cell
// via its label <span>, scoped to the visible panel (the hidden Classic/Flash/AoX panels
// also contain "Score" spans). The value is the cell's last <span>.
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  const spans = labelSpan.parentElement.querySelectorAll('span')
  return spans[spans.length - 1].textContent.trim()
}
function begin() {
  act(() => {
    fireEvent.click(ctrl('Begin'))
  })
}
function click(name) {
  act(() => {
    fireEvent.click(dayBtn(name))
  })
}
function clickText(text) {
  act(() => {
    fireEvent.click(ctrl(text))
  })
}

describe('Blitz — characterization (batch 1: Per Round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('idle: shows Begin, hidden date, Score 0/0, Best Score —', () => {
    mountApp()
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    // Best Score is shown as a plain label/value (— when unset).
    expect(screen.getByText(/Best Score:/)).toBeInTheDocument()
  })

  it('Begin reveals the date and arms the round (Reset shown)', () => {
    mountApp()
    switchToBlitz()
    begin()
    expect(ctrl('Reset')).toBeInTheDocument()
    const d = readDate()
    expect(d.y).toBeGreaterThanOrEqual(1583)
  })

  it('per-round correct answers advance and accumulate the round score', () => {
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate())) // 1/1
    click(correctName(readDate())) // 2/2
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
  })

  it('per-round wrong (Allow Mistakes on) counts a miss but keeps the round going', () => {
    mountApp()
    switchToBlitz()
    begin()
    const d = readDate()
    click(correctName(d)) // 1/1
    click(wrongName(readDate())) // wrong → 1/2, still live
    expect(statValue('Score')).toBe('1/2')
    expect(ctrl('Reset')).toBeInTheDocument() // round still live (Reset, not Begin)
  })

  it('per-round with Allow Mistakes OFF: a wrong answer ends the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // toggle off (it is on by default)
    begin()
    const d = readDate()
    click(wrongName(d)) // wrong → round ends
    // Round over: the grid locks (the correct day is shown) and stats froze at 0/1.
    expect(statValue('Score')).toBe('0/1')
    expect(dayBtn(correctName(d)).className).toContain('btn-correct-persist')
    expect(isDisabled(dayBtn(correctName(d)))).toBe(true)
  })

  it('Best Score records the round result when a round ends', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off → a wrong ends the round
    begin()
    click(correctName(readDate())) // round score 1
    click(wrongName(readDate())) // wrong → round ends with good = 1
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
  })
})

describe('Blitz — characterization (batch 2: Per Question / sudden death)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Per Question: a correct answer advances, a wrong answer ends the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // toggle to Per Question (button shows the current mode)
    begin()
    click(correctName(readDate())) // 1/1, next question
    expect(statValue('Score')).toBe('1/1')
    const d = readDate()
    click(wrongName(d)) // wrong → sudden death, round ends
    expect(statValue('Score')).toBe('1/2')
    expect(dayBtn(correctName(d)).className).toContain('btn-correct-persist')
    expect(isDisabled(dayBtn(correctName(d)))).toBe(true) // locked (round over)
  })
})

describe('Blitz — characterization (batch 3: Override)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('per-round Override after a wrong credits the round (0/1 → 1/1) and advances', () => {
    mountApp()
    switchToBlitz()
    begin()
    const d = readDate()
    click(wrongName(d)) // miss → round score 0/1, still live
    expect(statValue('Score')).toBe('0/1')
    expect(isDisabled(ctrl('Override'))).toBe(false)
    act(() => {
      fireEvent.click(ctrl('Override'))
    })
    expect(statValue('Score')).toBe('1/1') // credited
    expect(ctrl('Reset')).toBeInTheDocument() // still live (advanced to next Q)
  })

  it('Best Score rolls back when a completed-round correct answer is overridden to wrong', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off → wrong ends the round
    begin()
    click(correctName(readDate())) // round score 1
    const last = readDate()
    click(wrongName(last)) // wrong → round ends; good = 1
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    // Back-browse to the credited answer and Override it to wrong → round score + Best drop to 0.
    act(() => {
      fireEvent.click(ctrl('<'))
    })
    expect(isDisabled(ctrl('Override'))).toBe(false)
    act(() => {
      fireEvent.click(ctrl('Override'))
    })
    expect(screen.getByText(/Best Score: 0\b/)).toBeInTheDocument()
  })
})

// Deliberate behavior fixes (2026-06-01) — the unified session-end rule. See PROJECT.md.
describe('Blitz — bug fixes (override-to-wrong + Show Codes end the round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Bug #1: with Allow Mistakes off, flipping a correct answer to wrong via Override is a
  // mistake and must end the round (like a real wrong answer). It used to leave the round live.
  it('Allow Mistakes OFF: overriding a correct answer to wrong ends the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // Q1 correct → 1/1, advances to a fresh Q2
    expect(statValue('Score')).toBe('1/1')
    expect(isDisabled(ctrl('Override'))).toBe(false) // retro-override of Q1 is available
    act(() => {
      fireEvent.click(ctrl('Override'))
    }) // flip Q1 correct → wrong
    expect(statValue('Score')).toBe('0/1') // credit removed
    expect(isDisabled(dayBtn('Sunday'))).toBe(true) // round ended → answer grid locked
  })

  // Bug #3: opening Show Codes mid-round must end the round (so Best Score records and the
  // countdown stops), like Reveal. The migration dropped the round-end (Best was never saved).
  it('Show Codes during an active round ends the round and records Best Score', () => {
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate())) // round score 1
    act(() => {
      fireEvent.click(ctrl('Show Codes'))
    }) // open codes mid-round → ends the round
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument() // Best recorded (was the bug)
    expect(isDisabled(dayBtn('Sunday'))).toBe(true) // round ended → answer grid locked
  })
})

// C2 fuzz/read pass (2026-06-08): the Best Score/Streak rollback dropped the Best below a PREVIOUS
// round's score. The reconcile tracks only ONE best record + its round id, and on rollback set
// Best = the (overridden-down) current round's good — with no memory of the earlier round that the
// record had overwritten. AoX's rollback snapshots + restores the PRIOR best (correct); Blitz lacked
// that snapshot. Same "restore from a stale/absent snapshot" family as the engine bugs.
describe('Blitz — Best Score cross-round rollback (C2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('overriding a later round below an earlier one keeps Best Score at the earlier round', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // OFF → a wrong ends the round (lets us end rounds without the timer)
    // Round A → good 1 (sets Best Score 1)
    begin()
    click(correctName(readDate())) // 1/1
    click(wrongName(readDate())) // wrong → round A ends, good = 1
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    // Round B → good 2 (beats A, overwrites the Best record with round B's id)
    clickText('Reset') // round A ended → back to idle so Begin shows again (Best 1 persists)
    begin()
    click(correctName(readDate())) // 1
    click(correctName(readDate())) // 2
    click(wrongName(readDate())) // wrong → round B ends, good = 2
    expect(screen.getByText(/Best Score: 2\b/)).toBeInTheDocument()
    // Override round B's two correct answers to wrong → good 2 → 1 → 0 (below round A's 1).
    act(() => fireEvent.click(ctrl('<'))) // browse B's 2nd correct
    act(() => fireEvent.click(ctrl('Override'))) // → wrong, good 2→1
    act(() => fireEvent.click(ctrl('<'))) // browse B's 1st correct
    act(() => fireEvent.click(ctrl('Override'))) // → wrong, good 1→0
    // Round A's 1 still stands as the real best — Best Score must be 1, NOT round B's dropped 0.
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
  })
})
