// @vitest-environment jsdom
//
// AoX mode — characterization tests (Stage C, Step 6, Step 5). AoX is the headline dedup: it
// has its OWN near-duplicate engine (timer / stats / Override / Back-Forward / Show Codes) plus
// a unique "average of N" (Ao-N) RUN layer — a run of N solves that completes on the Nth, fails
// on a mistake (when Allow Mistakes is off), tracks Best Average / Best Median per config, and
// supports One-By-One (date hidden until you reveal it). These lock TODAY's observable behavior
// before folding the common engine onto the shared useGameEngine. Written against the current
// <App/> (AoX already renders via AoxMode) as a black box, so they stay valid before AND after.
//
// Determinism: AoX answers are weekdays, exactly like Classic — read the shown date back and
// compute the correct weekday with the already-tested wday(), on a pinned Gregorian range +
// numeric-ymd format. Short runs (Ao2) make "complete the run" reachable in two clicks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── Harness ──────────────────────────────────────────────────────────────────
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const ctrl = (name) => screen.getByRole('button', { name })
const dayBtn = (name) => screen.getByRole('button', { name })
const isDisabled = (btn) => btn.className.includes('pointer-events-none')

function switchToAox() {
  act(() => {
    fireEvent.keyDown(window, { key: 'A' })
  })
}
function click(name) {
  act(() => {
    fireEvent.click(ctrl(name))
  })
}
// AoX date is the only VISIBLE numeric-ymd leaf div (other modes are display:none; AoX shows
// "—" when the date is hidden — idle / One-By-One-not-yet-revealed).
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1)
    throw new Error(`expected one visible ymd date, found ${els.length}: ${els.map((e) => e.textContent)}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
function answerCorrect() {
  act(() => {
    fireEvent.click(dayBtn(correctName(readDate())))
  })
}
function answerWrong() {
  act(() => {
    fireEvent.click(dayBtn(wrongName(readDate())))
  })
}
// Stat value by visible label span (other modes' strips are display:none).
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  const spans = labelSpan.parentElement.querySelectorAll('span')
  return spans[spans.length - 1].textContent.trim()
}
// Best Average / Best Median VALUE ("1.23s" or "—"). Picks the innermost "Best X:" line and
// extracts just the time, ignoring the new-best ★ and the sibling Median/Average sub-line.
function bestVal(which) {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => !isHidden(e) && e.textContent.trim().startsWith(`Best ${which}:`),
  )
  els.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
  const m = els[0]?.textContent.match(/Best \w+:\s*(—|\d+\.\d{2}s)/)
  return m ? m[1] : null
}
// The Ao-N size input (the only visible text input in the AoX panel).
function setN(val) {
  const input = Array.from(document.querySelectorAll('input[type="text"]')).find((i) => !isHidden(i))
  act(() => {
    fireEvent.change(input, { target: { value: String(val) } })
    fireEvent.blur(input)
  })
}
const dayState = (name) => {
  const c = dayBtn(name).className
  if (c.includes('btn-correct-persist')) return 'correct'
  if (c.includes('btn-wrong-persist')) return 'wrong-latest'
  if (c.includes('btn-override-wrong')) return 'override-wrong'
  return 'idle'
}

function pin() {
  localStorage.clear()
  const s = useSettings.getState()
  s.resetSettings()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setMinY(1583)
  s.setMaxY(10000)
}

// ── Batch 1: a clean Ao2 run (Allow Mistakes off, default) ──────────────────────
describe('AoX — characterization (batch 1: a clean Ao2 run)', () => {
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

  it('idle: Begin shown, Score 0/0, date hidden, Best Average —', () => {
    mountApp()
    switchToAox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(bestVal('Average')).toBe('—')
    // Back/Forward/Reveal/Override all disabled in idle.
    expect(isDisabled(ctrl('<'))).toBe(true)
    expect(isDisabled(ctrl('Reveal'))).toBe(true)
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })

  it('Begin reveals the date and arms the run (Reset shown)', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(readDate().y).toBeGreaterThanOrEqual(1583)
    expect(statValue('Score')).toBe('0/0')
  })

  it('first correct counts + advances; the Nth correct completes the run and records a Best', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect() // 1/1, advance to the 2nd question
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(ctrl('Reset')).toBeInTheDocument() // still running
    answerCorrect() // 2/2 → run completes
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
    // Run done: a Best Average is now recorded (a time, not —), and a solve time shows.
    expect(bestVal('Average')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Average')).toMatch(/^\d+\.\d{2}s$/)
  })

  it('Reset returns to idle (Score 0/0, Begin shown) but keeps the recorded Best', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done, best recorded
    const best = bestVal('Average')
    expect(best).toMatch(/^\d+\.\d{2}s$/)
    click('Reset')
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(bestVal('Average')).toBe(best) // best value persists across Reset (same config)
  })
})

// ── Batch 2: mistakes — failed run vs Allow Mistakes ────────────────────────────
describe('AoX — characterization (batch 2: mistakes)', () => {
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

  it('Allow Mistakes OFF: a wrong answer fails the run (locks, marks the correct day)', () => {
    mountApp()
    switchToAox()
    setN(3)
    click('Begin')
    const d = readDate()
    answerWrong() // wrong → run fails
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(correctName(d))).toBe('correct') // correct day revealed on fail
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(isDisabled(dayBtn(correctName(d)))).toBe(true) // grid locked
  })

  it('Allow Mistakes ON: a wrong answer keeps the run going (retry on the same date)', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes') // toggle on (off by default)
    setN(3)
    click('Begin')
    const d = readDate()
    answerWrong() // counted, streak 0, still running
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(readDate()).toEqual(d) // same date — try again
    expect(ctrl('Reset')).toBeInTheDocument()
    // Now answer it right: no credit for the late-correct, but it advances.
    answerCorrect()
    expect(statValue('Score')).toBe('0/1')
    expect(readDate()).not.toEqual(d) // advanced
  })
})

// ── Batch 3: Override ───────────────────────────────────────────────────────────
describe('AoX — characterization (batch 3: Override)', () => {
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

  it('Override after a first-try correct (retro-flip): undoes the credit (1/1 → 0/1)', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes') // on, so the run survives the flip instead of failing
    setN(3)
    click('Begin')
    answerCorrect() // 1/1, advance to a fresh live question
    expect(statValue('Score')).toBe('1/1')
    expect(isDisabled(ctrl('Override'))).toBe(false)
    click('Override') // retro-flip the just-credited entry to wrong
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
  })

  it('Override after a wrong (Allow Mistakes on): credits it and advances (0/1 → 1/1)', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(3)
    click('Begin')
    answerWrong() // 0/1, still running
    expect(statValue('Score')).toBe('0/1')
    expect(isDisabled(ctrl('Override'))).toBe(false)
    click('Override') // retroactive credit
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
  })
})

// ── Batch 3b: Best rollback when an override undoes the run that set it ──────────
describe('AoX — characterization (batch 3b: Best rollback)', () => {
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

  it('Override on a completed run undoes the last solve and rolls the Best Average back to —', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done; Best Average recorded
    expect(bestVal('Average')).toMatch(/^\d+\.\d{2}s$/)
    expect(isDisabled(ctrl('Override'))).toBe(false) // the completing solve is reversible
    click('Override') // undo the last solve → its Best was this run's, so it rolls back
    expect(statValue('Score')).toBe('1/2') // one solve undone, both attempts still counted
    expect(bestVal('Average')).toBe('—') // Best rolled back (it was set by this now-undone run)
    expect(ctrl('Reset')).toBeInTheDocument() // run is over (failed) → locked
  })
})

// ── Batch 4: Back/Forward after a run ends ──────────────────────────────────────
describe('AoX — characterization (batch 4: Back/Forward review)', () => {
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

  it('Back/Forward is locked during a run, available after it completes', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    expect(isDisabled(ctrl('<'))).toBe(true) // no browsing mid-run
    const q1 = readDate()
    answerCorrect() // 1/1, advance
    expect(isDisabled(ctrl('<'))).toBe(true) // still running → still locked
    answerCorrect() // 2/2, run done
    expect(isDisabled(ctrl('<'))).toBe(false) // now reviewable
    click('<') // back to the first question
    expect(readDate()).toEqual(q1)
    expect(screen.getByText('Q1')).toBeInTheDocument()
    click('>') // forward to the completed last question
    expect(isDisabled(ctrl('>'))).toBe(true)
  })
})

// ── Batch 5: One-By-One ─────────────────────────────────────────────────────────
describe('AoX — characterization (batch 5: One-By-One)', () => {
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

  it('One-By-One hides the date after the first question until Continue reveals it', () => {
    mountApp()
    switchToAox()
    click('One-By-One')
    setN(3)
    click('Begin')
    answerCorrect() // 1/1 → next question is hidden (One-By-One)
    expect(statValue('Score')).toBe('1/1')
    // Date hidden now → Continue is offered, and no visible ymd date is present.
    expect(ctrl('Continue')).toBeInTheDocument()
    const visibleYmd = Array.from(document.querySelectorAll('div')).filter(
      (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
    )
    expect(visibleYmd.length).toBe(0)
    click('Continue') // reveal the next date
    expect(readDate().y).toBeGreaterThanOrEqual(1583)
    answerCorrect()
    expect(statValue('Score')).toBe('2/2')
  })
})

// ── Batch 6: Reveal + Show Codes (both burn the question) ────────────────────────
describe('AoX — characterization (batch 6: Reveal + Show Codes)', () => {
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

  it('Reveal (Allow Mistakes off) shows the answer, counts a miss, fails the run', () => {
    mountApp()
    switchToAox()
    setN(3)
    click('Begin')
    const d = readDate()
    click('Reveal')
    expect(dayState(correctName(d))).toBe('correct')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(ctrl('Reset')).toBeInTheDocument() // failed → locked
  })

  it('Show Codes (Allow Mistakes on) counts a miss + reveals, run continues', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(3)
    click('Begin')
    const d = readDate()
    click('Show Codes')
    expect(statValue('Score')).toBe('0/1') // counted as a played miss
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(correctName(d))).toBe('correct')
    expect(ctrl('Hide Codes')).toBeInTheDocument() // panel open
  })
})
