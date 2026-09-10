// @vitest-environment jsdom
//
// AoX mode — characterization tests (Stage C, Step 6, Step 5). AoX is the headline dedup: it
// has its OWN near-duplicate engine (timer / stats / Override / Back-Forward / Show Codes) plus
// a unique "average of N" (Ao-N) RUN layer — a run of N solves that completes on the Nth, fails
// on a mistake (when Allow Mistakes is off), tracks Best Mean / Best Median per config, and
// supports One-by-One (date hidden until you reveal it). These lock TODAY's observable behavior
// before folding the common engine onto the shared useGameEngine. Written against the current
// <App/> (AoX already renders via AoxMode) as a black box, so they stay valid before AND after.
//
// Determinism: AoX answers are weekdays, exactly like Classic — read the shown date back and
// compute the correct weekday with the already-tested wday(), on a pinned Gregorian range +
// numeric-ymd format. Short runs (Ao2) make "complete the run" reachable in two clicks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useProgress } from '../src/store/progress.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'
import { isOffered } from './helpers/offered.js'

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
// Q7 round 21: Reset Settings confirms through a shared popup now. Open it, then confirm.
const fireResetSettings = () => {
  act(() => fireEvent.click(ctrl('Reset Settings')))
  act(() =>
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset Settings for this preset?' })).getByRole(
        'button',
        { name: 'Reset Settings' },
      ),
    ),
  )
}
const dayBtn = (name) => screen.getByRole('button', { name })
// Not offered = the app is withholding the control. How that is SPELLED lives in one place
// (tests/helpers/offered) so this file never names a class string.
const isDisabled = (btn) => !isOffered(btn)

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
// "—" when the date is hidden — idle / One-by-One-not-yet-revealed).
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
// ⚠ Reads the value through its OWN marker, [data-statval] — the auto-fit target StatPanel puts on
// the value span — and NOT "the cell's last span". A cell can carry a trailing screen-reader-only
// span (the "Off" that names a blanked group, C1 round 16), and last-span would read that instead of
// the value. The marker names the one element that IS the readout, so it cannot drift again.
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}
// Tap a stat cell (Q8: the timing-trio cells are buttons that toggle the visual-only hide). The
// cell is the label span's parent (a <button> for the timing trio); clicking it fires the toggle.
function clickStat(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  act(() => {
    fireEvent.click(labelSpan.parentElement)
  })
}
// Fast-forward the faked clock (performance.now advances in lockstep) inside act, so a solve made
// after the tick records a nonzero time. Used by the Q8 visual-only-timing tests.
const tick = (ms) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
// Best Mean / Best Median VALUE ("1.23s" or "—"). Picks the innermost "Best X:" line and
// extracts just the time, ignoring the new-best ★ and the sibling Median/Mean sub-line.
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
  const input = Array.from(document.querySelectorAll('input[type="text"]')).find(
    (i) => !isHidden(i),
  )
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
  s.resetToFactory()
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

  it('idle: Begin shown, Score 0/0, date hidden, Best Mean —', () => {
    mountApp()
    switchToAox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(bestVal('Mean')).toBe('—')
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
    // Run done: a Best Mean is now recorded (a time, not —), and a solve time shows.
    expect(bestVal('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
  })

  it('Reset returns to idle (Score 0/0, Begin shown) but keeps the recorded Best', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done, best recorded
    const best = bestVal('Mean')
    expect(best).toMatch(/^\d+\.\d{2}s$/)
    click('Reset')
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(bestVal('Mean')).toBe(best) // best value persists across Reset (same config)
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

  it('Override on a completed run undoes the last solve and rolls the Best Mean back to —', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done; Best Mean recorded
    expect(bestVal('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(isDisabled(ctrl('Override'))).toBe(false) // the completing solve is reversible
    click('Override') // undo the last solve → its Best was this run's, so it rolls back
    expect(statValue('Score')).toBe('1/2') // one solve undone, both attempts still counted
    expect(bestVal('Mean')).toBe('—') // Best rolled back (it was set by this now-undone run)
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

// ── Batch 5: One-by-One ─────────────────────────────────────────────────────────
describe('AoX — characterization (batch 5: One-by-One)', () => {
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

  it('One-by-One hides the date after the first question until Continue reveals it', () => {
    mountApp()
    switchToAox()
    click('One-by-One')
    setN(3)
    click('Begin')
    answerCorrect() // 1/1 → next question is hidden (One-by-One)
    expect(statValue('Score')).toBe('1/1')
    // Date hidden now → Continue is offered, and no visible ymd date is present.
    expect(ctrl('Continue')).toBeInTheDocument()
    const visibleYmd = Array.from(document.querySelectorAll('div')).filter(
      (e) =>
        e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
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

  // C2 Q4 + the reveal-flash refinement: Reveal with Allow Mistakes ON (and One-by-One OFF) counts a
  // miss, FLASHES the answer briefly, then AUTO-ADVANCES — no pause/Next button (the run flows
  // date-to-date on its own). Before the fix a revealed question was a locked dead-end.
  it('Reveal (Allow Mistakes on, One-by-One off) counts a miss, flashes the answer, then auto-advances', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(3)
    click('Begin')
    const d1 = readDate()
    click('Reveal')
    expect(statValue('Score')).toBe('0/1') // counted as a played miss
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(correctName(d1))).toBe('correct') // the answer is shown during the flash
    expect(readDate()).toEqual(d1) // still on the revealed date during the flash window
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull() // no pause — it auto-advances
    act(() => {
      vi.advanceTimersByTime(700)
    }) // flash window elapses → auto-advance
    const d2 = readDate()
    expect(d2).not.toEqual(d1) // advanced to a fresh date — the run continues
    answerCorrect() // the grid is live again
    expect(statValue('Score')).toBe('1/2')
    expect(statValue('Streak')).toBe('1/1')
  })

  // One-by-One reveals DO pause (One-by-One pauses between dates by design) — a "Next" button, so you
  // see the answer before the next hidden date.
  it('Reveal (Allow Mistakes on, One-by-One on) pauses on a Next button', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    click('One-by-One')
    setN(3)
    click('Begin')
    const d1 = readDate()
    click('Reveal')
    expect(statValue('Score')).toBe('0/1')
    expect(dayState(correctName(d1))).toBe('correct')
    expect(readDate()).toEqual(d1) // stays — no auto-advance under One-by-One
    expect(ctrl('Next')).toBeInTheDocument() // pauses on Next
    click('Next') // advance → the next date is hidden (One-by-One), Continue offered
    expect(ctrl('Continue')).toBeInTheDocument()
  })

  // Show Codes must function the SAME as Reveal under Allow Mistakes ON: count a miss, open the codes
  // to read, then Next advances (it's no longer a dead-end once you close/continue).
  it('Show Codes (Allow Mistakes on) counts a miss and a Next button continues the run', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(3)
    click('Begin')
    const d1 = readDate()
    click('Show Codes')
    expect(statValue('Score')).toBe('0/1') // counted as a played miss
    expect(ctrl('Hide Codes')).toBeInTheDocument() // panel open to read the codes
    expect(ctrl('Next')).toBeInTheDocument() // Next offered (same as Reveal)
    click('Next') // advances + closes the panel
    const d2 = readDate()
    expect(d2).not.toEqual(d1)
    expect(ctrl('Show Codes')).toBeInTheDocument() // panel closed on the new date
    answerCorrect()
    expect(statValue('Score')).toBe('1/2')
  })
})

// ── Batch 6c: completing an AoX run via Override stays on the Nth question (no phantom extra) ──────
// With Allow Mistakes off, Reveal fails the run and Override credits it + resumes. When that credit is
// the COMPLETING solve (good reaches N), the run must complete ON that question — not advance to a
// phantom Q(N+1). Before the fix, the Override credit always advanced, so an Ao10 completed via
// Reveal+Override showed Q11 (owner-reported). A normal final correct answer uses `complete` to stay
// put; this gives the Override-completion the same behavior.
describe('AoX — bug fix (Override-completed run stays on the Nth question, C2)', () => {
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

  // The completing-on-Nth fix must hold for EVERY way the final question becomes a counted wrong —
  // a wrong answer, a Reveal, or a Show Codes (owner: "regardless of … pressed the wrong answer,
  // revealed, or showed codes") — and with Save Stats on (the default `pin()` here). All three set
  // countedWrong → Path 3 → the completing-credit hold. Ao2: finish Q1 to reach good=1, then complete
  // Q2 the given way; the run must end ON Q2 (not Q3).
  const completeQ1 = () => {
    click('Reveal')
    click('Override') // Q1 credited (good 1), advance to Q2
    expect(statValue('Score')).toBe('1/1')
  }
  it('final question via WRONG ANSWER + Override completes on Q2', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    completeQ1()
    answerWrong() // Q2 wrong → run fails (good 1)
    click('Override') // credit Q2 → good 2 = N → completes, stays on Q2
    expect(statValue('Score')).toBe('2/2')
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.queryByText('Q3')).toBeNull()
  })
  it('final question via REVEAL + Override completes on Q2', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    completeQ1()
    click('Reveal') // Q2 miss → run fails
    click('Override') // credit Q2 → completes, stays on Q2
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.queryByText('Q3')).toBeNull()
    expect(isDisabled(ctrl('Reveal'))).toBe(true) // done → can't keep going
  })
  it('final question via SHOW CODES + Override completes on Q2', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    completeQ1()
    click('Show Codes') // Q2 counted miss → run fails (panel open)
    click('Override') // credit Q2 → completes, stays on Q2
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.queryByText('Q3')).toBeNull()
  })
})

// ── Batch 6e: reveal-flash race — Override DURING the flash window cancels the pending auto-advance ──
// onReveal (Allow Mistakes on, One-by-One off) flashes the answer then auto-advances ~FLASH_MS later
// via a setTimeout (revealAdvanceRef). If the player credits the revealed miss via Override inside that
// window, the stale timer must be cancelled — else it fires an extra doNew() that SKIPS a question, or
// at the final question RE-OPENS the phantom-Q(N+1) overshoot the completion fix closed. (Found 2026-06-20.)
describe('AoX — reveal-flash race (Override during the flash cancels the pending auto-advance)', () => {
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

  it('final question: Reveal then Override completes on Q2 — the stale flash timer does NOT overshoot to Q3', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(2)
    click('Begin')
    answerCorrect() // Q1 correct → good 1, advance to Q2
    click('Reveal') // Q2 revealed miss → arms the FLASH_MS auto-advance timer; doneCount still 1 (=n-1)
    click('Override') // completeViaOverride → HOLD, run completes ON Q2
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.queryByText('Q3')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(700)
    }) // the stale flash timer would fire doNew() here
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.queryByText('Q3')).toBeNull() // NOT overshot to a phantom Q3
  })

  it('non-final question: Reveal then Override advances exactly once — the stale timer does NOT skip a question', () => {
    mountApp()
    switchToAox()
    click('Allow Mistakes')
    setN(3)
    click('Begin')
    click('Reveal') // Q1 revealed miss → arms the flash timer
    click('Override') // Path 3 credit → advances to Q2 (good 1)
    expect(statValue('Score')).toBe('1/1')
    const q2 = readDate()
    act(() => {
      vi.advanceTimersByTime(700)
    }) // the stale flash timer would fire doNew() → skip Q2
    expect(readDate()).toEqual(q2) // still on Q2 — not skipped to Q3
    expect(statValue('Score')).toBe('1/1')
  })
})

// ── Batch 6b: C2 Q2-B — practice mode (Save Stats off) lets Override rescue a misclick-ended run ──
// AoX already always-tracks internally, so the off-gate on Override was the only thing stopping a
// fat-finger rescue in practice mode. Now Override is available specifically to continue a run a
// misclick ended (Allow Mistakes off), even with stats hidden.
describe('AoX — C2 Q2-B (Save Stats off: Override rescues a misclick-failed run)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pin()
    useSettings.getState().setSaveStats(false) // practice mode
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    useSettings.getState().setSaveStats(true)
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('a misclick fails the run, but Override is available (and continues it) even with Save Stats off', () => {
    mountApp()
    switchToAox()
    setN(3) // Allow Mistakes off by default
    click('Begin')
    const d = readDate()
    answerWrong() // misclick → run fails (the failed date is shown)
    expect(ctrl('Reset')).toBeInTheDocument() // run is over
    expect(isDisabled(ctrl('Override'))).toBe(false) // rescuable in practice mode (the off-gate fix)
    click('Override') // credit + resume
    const d2 = readDate()
    expect(d2).not.toEqual(d) // advanced to a fresh date — the run continues
    answerCorrect() // and the grid is live again
    expect(d2).not.toEqual(readDate())
  })
})

// ── Batch 7: bug #2 fix — override-to-wrong fails the run (Allow Mistakes off) ───
// The deliberate fix (the unified session-end rule, applied at the component level by the fold):
// with Allow Mistakes off, flipping a correct answer to wrong via Override is a mistake and must
// FAIL the run — exactly like a wrong answer. Previously the retro-flip path didn't. The batch-3
// Override tests use Allow Mistakes ON precisely to avoid this, so they don't cover it.
describe('AoX — bug #2 fix (override-to-wrong fails the run, Allow Mistakes off)', () => {
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

  it('retro-flipping a credited answer to wrong fails the run (locks the grid)', () => {
    mountApp()
    switchToAox()
    setN(3) // Allow Mistakes is OFF by default
    click('Begin')
    answerCorrect() // 1/1, advances to a fresh live question; the credited entry is now retro-overridable
    expect(statValue('Score')).toBe('1/1')
    expect(isDisabled(ctrl('Override'))).toBe(false)
    click('Override') // retro-flip the credited answer to wrong
    expect(statValue('Score')).toBe('0/1') // credit removed
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(dayBtn('Sunday'))).toBe(true) // run FAILED → grid locked (the bug: it used to stay running)
  })
})

// ── Batch 8: bug fix — Show Codes on a COMPLETED run is review-only (C2) ─────────
// A completing solve credits good but stays on the question (locked, reversible). Opening Show Codes
// to review the method on the FINISHED run must NOT burn it. The reducer's SHOW_CODES penalty assumed
// an unanswered live question; a completing solve is already-answered-correct, so reviewing its codes
// is read-only. Before the fix, opening the codes turned a finished 2/2 run into 2/3 with the streak
// reset to 0/2 (a phantom played) — found by the aox-strong strong-oracle fuzz profile.
describe('AoX — bug fix (Show Codes on a completed run is review-only, C2)', () => {
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

  it('opening Show Codes on a completed run does not change the score', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect() // 1/1
    answerCorrect() // 2/2 → run completes (held), Best recorded
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
    click('Show Codes') // review the codes on the finished run
    // No phantom played, no streak reset — the score is untouched (was 2/3, streak 0/2).
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
    expect(ctrl('Hide Codes')).toBeInTheDocument() // the codes panel opened
  })
})

// ── Batch 9: bug fix — a post-completion Override reconciles the Best (C2, AoX run layer) ───────
// A completed run records its Best, but its history stays browsable and overridable — and a
// back-browse Override (Path 1) can retract one of the run's n credited solves. Before the fix, only
// the LIVE-edge reversal of the completing solve rolled the Best back (rollbackBest was gated on
// !inBack), so a back-browse un-credit left the recorded Best standing on a run that no longer has
// n credits — a fabricated Best (the AoX analog of the Blitz cross-round rollback bug, and the same
// "stale-or-absent snapshot" family). The fix reconciles the Best continuously while the run's
// stats change post-completion, exactly like Blitz's timerDone effect: still standing (good ≥ n) →
// the pre-run record improved by the standing avg/med; no longer standing → the pre-run record.
describe('AoX — bug fix (post-completion Override reconciles the Best, C2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pin()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('back-browse Override on a completed run rolls the Best back (the credit was retracted)', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect() // 1/1, advance
    answerCorrect() // 2/2 → run completes, Best recorded
    expect(bestVal('Mean')).toMatch(/^\d+\.\d{2}s$/)
    click('<') // review the first solve
    expect(isDisabled(ctrl('Override'))).toBe(false)
    click('Override') // Path-1 un-credit: retract the first solve (2/2 → 1/2)
    expect(statValue('Score')).toBe('1/2')
    // The run no longer stands at 2 credits, so its recorded Best must not stand either.
    expect(bestVal('Mean')).toBe('—')
    expect(bestVal('Median')).toBe('—')
  })

  it('retracting a later run restores the EARLIER run’s Best, not empty (cross-run floor)', () => {
    // Controlled solve clock: the engine times answers via performance.now() deltas.
    let fakeNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const tick = (ms) => {
      fakeNow += ms
    }
    mountApp()
    switchToAox()
    setN(2)
    // Run 1: two 2.0s solves → Best Mean 2.00s.
    click('Begin')
    tick(2000)
    answerCorrect()
    tick(2000)
    answerCorrect()
    expect(bestVal('Mean')).toBe('2.00s')
    click('Reset')
    // Run 2: two 0.5s solves → a new record, 0.50s (overwriting the stored value).
    click('Begin')
    tick(500)
    answerCorrect()
    tick(500)
    answerCorrect()
    expect(bestVal('Mean')).toBe('0.50s')
    // Retract one of run 2's solves: run 2 no longer stands → run 1's 2.00s must come back —
    // not '—' (lost) and not 0.50s (fabricated).
    click('<')
    click('Override')
    expect(statValue('Score')).toBe('1/2')
    expect(bestVal('Mean')).toBe('2.00s')
    expect(bestVal('Median')).toBe('2.00s')
  })

  it('a mid-done settings change cannot strand the rollback under the wrong key', () => {
    // Settings stay editable while a run sits done, and the year range is part of the Best key — so
    // the panel's bestKey can MOVE between the recording and a later rollback. The reconcile must
    // target the key the run RECORDED under (the old rollbackBest bailed on the key mismatch and
    // left the fabricated record standing).
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done; Best recorded under the begin-time key
    const oldKey = '2|false|numeric-ymd|random|random|random|1583-10000|true'
    expect(useProgress.getState().aoxBest[oldKey]?.avg).toEqual(expect.any(Number)) // recorded here
    act(() => {
      useSettings.getState().setMinY(3000) // DIRECT store change (NOT via the ⚙ popover) — isolates the reconcile-key path; a real popover-close change now resets the done run (see "AoX — Q2")
    })
    expect(isDisabled(ctrl('Override'))).toBe(false)
    click('Override') // reverse the completing solve at the live edge → the run no longer stands
    expect(statValue('Score')).toBe('1/2')
    // The record under the RUN's key rolled back to its pre-run (empty) floor.
    expect(useProgress.getState().aoxBest[oldKey]?.avg ?? null).toBeNull()
  })
})

// ── C2: the mode-switch contract (characterization — completes the cross-mode net) ──────────────
// Every timer mode tears down a RUNNING round/run when you leave it (the original App's rule;
// Blitz's missing teardown was fixed this pass) while an ENDED one survives the detour. Pin AoX's
// half: a running run resets to idle on switch-away; a done run (and its recorded Best) survives.
describe('AoX — C2: mode switch mid-run resets, done state survives', () => {
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

  it('switching away mid-run and back lands on a FRESH idle AoX (run reset)', () => {
    mountApp()
    switchToAox()
    setN(3)
    click('Begin')
    answerCorrect() // 1/1, running
    expect(statValue('Score')).toBe('1/1')
    act(() => {
      fireEvent.keyDown(window, { key: 'K' }) // detour into Classic mid-run
    })
    switchToAox()
    expect(ctrl('Begin')).toBeInTheDocument() // back to idle
    expect(statValue('Score')).toBe('0/0')
  })

  it('a COMPLETED run (and its recorded Best) survives the same detour', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done, Best recorded
    const best = bestVal('Mean')
    expect(best).toMatch(/^\d+\.\d{2}s$/)
    act(() => {
      fireEvent.keyDown(window, { key: 'K' })
    })
    switchToAox()
    expect(statValue('Score')).toBe('2/2') // the finished run's summary is still there
    expect(bestVal('Mean')).toBe(best)
    expect(ctrl('Reset')).toBeInTheDocument()
  })
})

// ── Q2 (2026-06-21): a config change on the ⚙ popover CLOSE resets a running OR ended AoX run ───────
// So the run on screen always matches the current settings (the recorded Best is config-keyed). Deferred
// to popover close; an open→close with no change is a no-op. (The old "done run left alone" test above
// uses a DIRECT store change to isolate the reconcile-key path — the real popover path resets, here.)
describe('AoX — Q2 (a config change on popover close resets a done/failed run)', () => {
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
  // /^Settings/ — the gear's accessible name flips to "Settings (modified)" once any
  // setting diverges from the effective defaults (the Q8 indicator), which these tests do.
  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))

  it('a DONE run resets to Begin when a config setting changes on close', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done
    expect(ctrl('Reset')).toBeInTheDocument() // done → Reset shown
    toggleSettings() // open ⚙ → snapshot
    act(() => useSettings.getState().setMinY(1700)) // change a config setting while open
    expect(ctrl('Reset')).toBeInTheDocument() // still done while open (deferred)
    toggleSettings() // close ⚙ → fire → reset()
    expect(ctrl('Begin')).toBeInTheDocument() // done run reset to idle
  })

  it('opening + closing settings with NO change leaves a done run intact', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    answerCorrect() // run done
    toggleSettings()
    toggleSettings() // no change → no reset
    expect(ctrl('Reset')).toBeInTheDocument() // still done
    expect(statValue('Score')).toBe('2/2')
  })

  // Q9: the close-fired reset REMOUNTS the answer grid (keyed on the engine's gridEpoch, which
  // RESET bumps) — fresh DOM nodes have no prior green to CSS-transition from, so the cleared
  // grid snaps to idle instead of fading. Node identity is the observable remount proof.
  it('the settings-close reset REMOUNTS the answer grid (Q9: fresh nodes, cleared green)', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect() // Q1 → advance
    const green = correctName(readDate()) // Q2's correct day — its green persists on the held solve
    answerCorrect() // run done
    expect(dayState(green)).toBe('correct')
    const before = DAY.map((nm) => dayBtn(nm))
    toggleSettings()
    act(() => useSettings.getState().setMinY(1700))
    toggleSettings() // close → reset() → RESET bumps gridEpoch → the keyed grid remounts
    DAY.forEach((nm, i) => expect(dayBtn(nm)).not.toBe(before[i])) // all-new nodes
    expect(dayState(green)).toBe('idle') // and the green is gone
  })

  it('a manual Reset tap REMOUNTS the answer grid too (Q9: same RESET mechanism)', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect()
    const green = correctName(readDate())
    answerCorrect() // run done → Reset shown
    const before = DAY.map((nm) => dayBtn(nm))
    click('Reset') // reset() → eng.resetStats() → RESET bumps gridEpoch
    expect(ctrl('Begin')).toBeInTheDocument() // back to idle
    DAY.forEach((nm, i) => expect(dayBtn(nm)).not.toBe(before[i])) // remounted — snap, no fade
    expect(dayState(green)).toBe('idle')
  })
})

// ── Q18: the run-length field (the shared boxed-numeric idiom + the one clamp) ────
describe('AoX — Q18 (the run-length field shares the popup N field validation trio)', () => {
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
  // The field gained its aria-label in the same batch (a Q18 gap-fill) — an accessible-name
  // lookup here is itself the regression test for it.
  const nField = () => screen.getByRole('textbox', { name: 'MoX run length' })

  it('rejects non-digits outright, normalize-commits on blur/Enter, and DISCARDS on Escape', () => {
    // ⚠ RE-BLESSED (round 15, B6) — the Escape leg at the foot of this case asserted the opposite
    // until now: "Escape commits the clamped current value too", so typing 1 and pressing Escape
    // left the field on 2. That was the app's own comment as well, and it made this the last field
    // where Escape KEPT an edit — the ⚙ Year Range boxes discard (round 14) and the tap-to-type
    // slider readouts have since round 2. The owner's rule is now uniform: Enter keeps the edit and
    // lets go, Escape throws it away and lets go.
    // The leg below is also STRENGTHENED, because the old one could not have told the two apart on
    // its own: it discarded back to 10, which is both the value at focus AND normalizeAoxN's
    // fallback. Committing to a non-default 25 first makes the answer unambiguous — a discard
    // gives 25 back, a normalize-commit would give 2.
    mountApp()
    switchToAox()
    // Seed a known committed value first (the modePrefs singleton carries state across tests).
    act(() => {
      fireEvent.change(nField(), { target: { value: '10' } })
      fireEvent.blur(nField())
    })
    // The flagged Q18 behavior change: letters never ENTER the field (the popup N field's
    // contract) — previously they were accepted raw and only clamped away on commit.
    act(() => fireEvent.change(nField(), { target: { value: 'abc' } }))
    expect(nField().value).toBe('10')
    act(() => fireEvent.change(nField(), { target: { value: '' } }))
    act(() => fireEvent.blur(nField()))
    expect(nField().value).toBe('10') // empty commits to the fallback
    act(() => fireEvent.change(nField(), { target: { value: '2000' } }))
    act(() => fireEvent.keyDown(nField(), { key: 'Enter' }))
    expect(nField().value).toBe('1000') // Enter commits with the shared 2–1000 clamp
    // The Escape leg. focus() first and deliberately — the field remembers its discard target when
    // the keyboard ENTERS it (aoxNAtFocusRef), because `aoxN` is the stored pref itself and every
    // keystroke overwrites it, so without a focus there is nothing to go back to. That is also how
    // a real edit starts, so leaving it out would have tested a route no finger can take.
    // ⚠ A REAL .blur(), not fireEvent.blur(). fireEvent dispatches the EVENT without moving the
    // browser's focus, so the element stays document.activeElement and the .focus() below would be
    // a no-op that never fires onFocus — the discard target would still be whatever the field held
    // at the FIRST focus, and this leg would silently be testing nothing. (It caught itself doing
    // exactly that while this case was being written.) The legs above use fireEvent.blur happily
    // because they only ask what a commit does.
    act(() => {
      nField().focus()
      fireEvent.change(nField(), { target: { value: '25' } })
      nField().blur()
    })
    expect(nField().value).toBe('25') // a committed value that is NOT the fallback
    act(() => {
      nField().focus()
      fireEvent.change(nField(), { target: { value: '1' } })
    })
    act(() => fireEvent.keyDown(nField(), { key: 'Escape' }))
    expect(nField().value).toBe('25') // Escape DISCARDS: back to the value at focus, not 2
  })

  it('opening the ⚙ panel takes the keyboard out of the box, and commits what was typed', () => {
    // ★ RE-BLESSED (round 18, 1D) — AND THE OLD ASSERTION WAS THE BUG. This case used to drive the
    // opposite: it clicked the gear, asserted the box STILL held the keyboard, and pinned the
    // `e.stopPropagation()` on the Escape branch as the thing that stopped the resulting press from
    // closing the panel. The owner reported that state as a defect in its own right — focus the run
    // length, open Settings or the mode menu, and the keyboard just sits there over what you opened
    // — and his rule is "when the keyboard is open, doing anything at all should close it". So the
    // scenario the old case protected no longer exists to protect.
    //
    // ⚠ fireEvent.click ON THE GEAR IS STILL THE POINT, and it is now the point twice over. A click
    // that does not move focus is exactly what a real tap does on iOS and Safari, where pressing a
    // <button> leaves focus where it was — which is WHY the keyboard used to survive the gear tap on
    // his phone and never did in desktop Chrome (there the button takes focus and the box blurs on
    // its own). Driving it this way is what makes this a test of the app's rule rather than of the
    // platform's accident. (Focusing the gear first would prove nothing: that is the path that
    // already worked.)
    //
    // The rule itself is ONE line, in the app's open-overlay registry — dismissKeyboard() inside
    // pushOverlay, components/useBackButton — so this case covers the gear, the mode menu, Show
    // Codes, How to Play and the four ⚙ popups at once. tests/textEntryFocus.dom walks the rest.
    //
    // ⚠ WHAT PINS THE stopPropagation NOW: nothing on this screen, because it is no longer
    // observable from here — with the keyboard gone at open, the box can no longer be holding an
    // Escape while the panel is up. It stays in the source as one term of a contract its four
    // siblings inside the panel still need; tests/settingsPanel.yearRange and tests/saveDefaults
    // pin it where it is reachable. See the note beside it in modes/AoxMode.
    mountApp()
    switchToAox()
    act(() => {
      fireEvent.change(nField(), { target: { value: '10' } })
      fireEvent.blur(nField())
    })
    const gear = () => screen.getByRole('button', { name: /^Settings/ })
    act(() => {
      nField().focus()
      fireEvent.change(nField(), { target: { value: '1' } })
    })
    expect(document.activeElement).toBe(nField()) // the keyboard is in the box…
    act(() => fireEvent.click(gear()))
    expect(gear().getAttribute('aria-controls')).toBe('settings-popover') // …the panel opened…
    expect(document.activeElement).not.toBe(nField()) // …and the keyboard went down with it
    // KEPT, NOT DROPPED. The blur is this box's commit, so opening an overlay normalize-commits the
    // half-typed value exactly as tapping away on desktop always did: '1' clamps up to the Ao2 floor
    // rather than reverting to 10. Escape is what throws an edit away; opening something is not.
    expect(nField().value).toBe('2')
    // And the very next Escape now belongs to the panel, because no box is holding one.
    act(() => fireEvent.keyDown(document, { key: 'Escape' }))
    expect(gear().getAttribute('aria-controls')).toBeNull()
  })

  it('the box wears the shared interactive surface (border surface-tray), never the container panel (Q7 round-7)', () => {
    // The site-wide interactive-border rule: inputs are controls, so the box carries the same
    // sbtn-bd border tier as its Allow Mistakes / One-by-One neighbors — NUM_INPUT_CLASS's
    // shared token, asserted here on the mode-screen site.
    mountApp()
    switchToAox()
    expect(nField().className).toContain('border surface-tray')
    expect(nField().className).not.toContain('panel')
  })
})

// ── Q7 round-6: Reset Settings now restores the MoX run length too, so a Reset Settings that
// changes a running/ended run's N reconciles it on the popover close — AoX's existing settings-close
// reset rule, now triggered by the aoxN dep the close-effect gained. Uses a FACTORY panel so Reset
// Settings touches ONLY the run length, isolating the mode-screen-pref path from the ⚙-panel path.
// (Q7 round-6 = "extend Reset Settings"; distinct from the Session-11 Q7 that added Save Defaults.)
describe('AoX — Q7 round-6 (Reset Settings restoring the run length reconciles the run)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useModePrefs.getState().resetModePrefs()
    useUserDefaults.getState().clearDefaults()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })
  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))

  it('a RUNNING run resets when Reset Settings restores a divergent run length on close', () => {
    useModePrefs.getState().setAoxN('25') // diverges from the factory 10
    mountApp()
    switchToAox()
    click('Begin')
    expect(ctrl('Reset')).toBeInTheDocument() // running → Reset shown
    toggleSettings() // open ⚙ → snapshot (aoxN '25')
    fireResetSettings() // restores aoxN → '10' (the panel is already factory)
    expect(ctrl('Reset')).toBeInTheDocument() // still running while open (deferred to close)
    toggleSettings() // close → the aoxN dep changed → reset()
    expect(ctrl('Begin')).toBeInTheDocument() // run reset to idle
    expect(useModePrefs.getState().aoxN).toBe('10') // run length restored to the factory default
  })
})

// ── Q8: the visual-only timing-stats hide toggle (Last/Mean/Median) ───────────────────────
// AoX gained a per-mode timing-trio hide toggle that is VISUAL ONLY: it blanks the display but the
// engine keeps timing (AoX feeds the engine timingOff:false always). So there is NO "Enable and
// Reset Stats?" arm — hiding can never desync — and the scoring trio stays untoggleable. Hiding
// suppresses only the LIVE mid-run trio: a COMPLETED run always shows its result (the average is
// the point of the run). The pref (aoxTimingOff) is excluded from the defaults system (verified in
// tests/saveDefaults.dom.test.jsx).
//
// ⚠ RE-BLESSED for C1 (round 16, the stat-box redesign — approved by the owner as a settled design).
// A group YOU turned off now renders its value cells BLANK, not as an em dash. The dash was moved to
// mean one thing only — "no data yet, but there could be" — so that a shown-but-empty stat and a
// stat you hid stop reading identically. Save Stats off is the third signal: dim, whole strip, which
// AoX's Save-Stats cases below still pin. Every '—' in this describe that used to mean "hidden" is
// now '' and says so.
describe('AoX — Q8 visual-only timing hide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pin()
    useModePrefs.getState().resetModePrefs() // aoxTimingOff starts false (shown)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('tapping a timing stat blanks all three (visual only); the scoring trio stays; no reset prompt', () => {
    mountApp()
    switchToAox()
    setN(3)
    click('Begin')
    tick(500)
    answerCorrect() // one solve; run still going
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    clickStat('Mean') // hide the timing trio
    // BLANK — C1's "you turned these off, and they ARE still recording" signal.
    expect(statValue('Last')).toBe('')
    expect(statValue('Mean')).toBe('')
    expect(statValue('Median')).toBe('')
    // Scoring trio is untoggleable — still visible.
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    // VISUAL ONLY: never the Classic/Flash/Deduction "Enable and Reset Stats?" confirmation.
    expect(screen.queryByText('Enable and Reset Stats?')).toBeNull()
    clickStat('Median') // tapping any timing box re-shows all three
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
  })

  it('the engine keeps timing while the trio is hidden — a solve made while hidden appears on re-show', () => {
    mountApp()
    switchToAox()
    setN(4)
    click('Begin')
    answerCorrect() // solve #1 immediate → 0.00s
    clickStat('Last') // hide
    expect(statValue('Last')).toBe('') // blank, not a dash (C1)
    tick(4000)
    answerCorrect() // solve #2 recorded WHILE hidden (~4.00s)
    expect(statValue('Score')).toBe('2/2') // the run kept going
    clickStat('Last') // re-show
    const last = statValue('Last')
    expect(last).toMatch(/^\d+\.\d{2}s$/)
    // Nonzero → the hidden solve WAS timed by the engine (would be 0.00s if the toggle wrongly fed
    // useGameEngine's timingOff and stopped tracking).
    expect(last).not.toBe('0.00s')
    expect(screen.queryByText('Enable and Reset Stats?')).toBeNull()
  })

  it('a completed run shows its result even when the trio is hidden', () => {
    act(() => useModePrefs.getState().setAoxTimingOff(true)) // hidden before the run
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    answerCorrect() // 1/2 → running, trio suppressed
    expect(statValue('Mean')).toBe('') // blank, not a dash (C1)
    answerCorrect() // 2/2 → run completes
    expect(statValue('Score')).toBe('2/2')
    // The completed run reveals its result regardless of the hide toggle (the average is the point).
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Median')).toMatch(/^\d+\.\d{2}s$/)
  })
})

// ── Q4 round-8 / Q5 round-8: Show Codes is ONE button in six places ───────────
// AoX used to render its own Show Codes button + Expander instead of a MethodBreakdownSection
// (it froze the displayed date itself), so its copy of the button was a hand-duplicated string
// — and it had already drifted, losing the aria-disabled and cursor-not-allowed the other five
// carried. Q4 (round 8) pulled both back onto the shared class consts; Q5 (round 8) deleted the
// duplicate outright, so all six toggles are now literally the same component. The class also
// carries `border border-transparent`: it is a solid fill measured against controls that all
// carry a 1px border, and a border counts toward rendered height, so without it the button sat
// 2px under its tier wherever nothing stretched it. Rendered pixels are on-device; the shared
// contract is pinned here — and all six copies live in ONE mounted tree (the modes are
// always-mounted, display:none), so parity is a direct comparison.
describe('AoX — round-8: the Show Codes button is shared with the other five sites', () => {
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

  // Every Show Codes / Hide Codes toggle in the tree, visible or not.
  const codesButtons = () =>
    Array.from(document.querySelectorAll('button[data-key="C"]')).filter((b) =>
      /^(Show|Hide) Codes$/.test(b.textContent.trim()),
    )

  it('all copies carry the same base classes, including the height-completing transparent border', () => {
    mountApp()
    switchToAox()
    const btns = codesButtons()
    expect(btns.length).toBeGreaterThan(1) // AoX's own copy + the always-mounted modes' sections
    const base = [
      'w-full',
      'px-4',
      'py-2',
      'rounded-xl',
      'btn-solid',
      'border',
      'border-transparent',
      'text-sm',
      'font-medium',
    ]
    for (const b of btns) {
      const tokens = b.className.split(/\s+/).filter(Boolean)
      for (const t of base) expect(tokens).toContain(t)
      // The accessible disabled state is stated on EVERY copy — the divergence that existed.
      expect(b.hasAttribute('aria-disabled')).toBe(true)
    }
  })

  it('AoX idle: no date yet, so its Show Codes is disabled in the aria tree AND to the pointer', () => {
    mountApp()
    switchToAox()
    const btn = ctrl('Show Codes')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    for (const t of ['opacity-60', 'cursor-not-allowed', 'pointer-events-none'])
      expect(btn.className.split(/\s+/)).toContain(t)
  })

  it('AoX with a live date: the same button reports itself enabled and drops the disabled classes', () => {
    mountApp()
    switchToAox()
    setN(2)
    click('Begin')
    const btn = ctrl('Show Codes')
    expect(btn.getAttribute('aria-disabled')).toBe('false')
    for (const t of ['opacity-60', 'cursor-not-allowed', 'pointer-events-none'])
      expect(btn.className.split(/\s+/)).not.toContain(t)
  })
})

// ── Q3 round-9: the run-length row equalizes by STRETCHING ──────────────────────────────────
// These are CLASS-CONTRACT tests, not height tests — jsdom has no layout engine, so it can no more
// measure the defect than it could have measured the two rounds of "prove the heights match" fixes
// that preceded this one. What they pin is the RULE that replaced those attempts:
//
//   the run-length <input> and its Allow Mistakes / One-by-One <button> neighbors never declare a
//   height; each derives one from its own inner line box, and WebKit's machinery for a text control
//   lands ~2px from its machinery for a button even when every class, padding and border matches
//   (they already did — that was never the question). Under items-center the row split that 2px
//   evenly and the box sat ~1px proud above AND below. items-stretch makes the shorter items grow
//   to the tallest instead, so the derived heights never have to agree.
//
// The direction doesn't matter to the fix: on the owner's iPhone the input is the taller one, so the
// buttons grow and the input keeps its natural height, but stretch equalizes either way.
const cls = (el) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
describe('AoX — Q3 round-9 (the run-length row equalizes by stretch, not by matched heights)', () => {
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
  const nField = () => screen.getByRole('textbox', { name: 'MoX run length' })

  it('the control row stretches its items — items-stretch, never items-center', () => {
    mountApp()
    switchToAox()
    const row = nField().parentElement.parentElement
    // Anchor the assertion to the real row: the input's wrapper AND both pills are its children.
    expect(row.contains(ctrl('Allow Mistakes'))).toBe(true)
    expect(row.contains(ctrl('One-by-One'))).toBe(true)
    expect(cls(row)).toContain('flex')
    expect(cls(row)).toContain('items-stretch')
    expect(cls(row)).not.toContain('items-center')
  })

  it('the input wrapper restates it, so the row height reaches the input through it', () => {
    // Without this the wrapper would size to the input and stop: a row stretch would grow the
    // wrapper and leave the input centered inside it — the same 1px-proud look, one level down.
    mountApp()
    switchToAox()
    const wrapper = nField().parentElement
    expect(cls(wrapper)).toContain('flex')
    expect(cls(wrapper)).toContain('items-stretch')
    expect(cls(wrapper)).not.toContain('items-center')
  })

  it('the "Mo" label opts back out with self-center (a stretched span rides its text at the top)', () => {
    mountApp()
    switchToAox()
    const span = nField().parentElement.querySelector('span')
    expect(span.textContent).toBe('Mo')
    expect(cls(span)).toContain('self-center')
  })
})

// ── App-wide guard for the same defect class (Q3 round-9) ───────────────────────────────────────
// Structural, not AoX-specific: ANY flex row that puts an in-flow text <input> in one item and a
// <button> in another must not be items-center, for exactly the reason above. It lives here because
// this is where the bug and its history are documented, and it runs over the mounted <App/>, which
// carries all five mode screens at once (the inactive ones are display:none, still in the tree) plus
// the settings panel — i.e. every row that owns a control today.
//
// Scope, stated honestly:
//   • it reads the DOM, not the source, so it cannot see branches this mount never renders — the
//     Save Defaults / defaults-manager popups and the Lookup page. (Neither is at risk today: the
//     popup's AoX row is <span> + <input> with no button, and LookupCard's row is already
//     items-stretch. A source regex was the alternative and was rejected — JSX nesting, conditional
//     branches and template-literal classNames make it either leaky or false-positive-prone.)
//   • out-of-flow items are exempt and skipped by class (absolute / fixed / .svalue-input): they
//     take no part in cross-axis sizing. That is precisely why SliderValueEditor's tap-to-type cell
//     is immune — its <button> and <input> are position:absolute inside a strut-sized span.
//   • <input type="range"> is exempt: index.css gives the slider a real declared height.
// Verified non-vacuous: it scans ~50 items-center rows and finds none, and re-introducing
// items-center on the AoX row makes it fail with that row named.
describe('app-wide — no items-center flex row mixes an <input> with a <button> (Q3 round-9)', () => {
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

  const outOfFlow = (el) => ['absolute', 'fixed', 'svalue-input'].some((t) => cls(el).includes(t))
  // What a flex ITEM derives its height from, looking through its in-flow subtree.
  const derivesFrom = (item) => {
    const seen = { input: false, button: false }
    const walk = (n) => {
      if (n !== item && outOfFlow(n)) return
      if (n.tagName === 'INPUT' && n.getAttribute('type') !== 'range') seen.input = true
      if (n.tagName === 'BUTTON') seen.button = true
      for (const c of n.children) walk(c)
    }
    walk(item)
    return seen
  }
  const offenders = () => {
    const bad = []
    for (const row of document.querySelectorAll('*')) {
      if (!cls(row).includes('flex') || !cls(row).includes('items-center')) continue
      let input = false
      let button = false
      for (const item of row.children) {
        if (outOfFlow(item)) continue
        const k = derivesFrom(item)
        input ||= k.input
        button ||= k.button
      }
      if (input && button) bad.push(row.getAttribute('class'))
    }
    return bad
  }

  it('holds across every mode screen and the settings panel', () => {
    mountApp()
    switchToAox()
    expect(offenders()).toEqual([])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    })
    expect(offenders()).toEqual([])
  })
})

// ── The behaviour net's two half-landed settings cases, finished here ─────────────────────────
// _settings_net_spec.md's G7 case 3 and G10 case 5 each make a claim about a MODE SCREEN that the
// net's own files could not make honestly. tests/settingsPanel.defaults pins the Classic screen
// only, on the reasoning that Reset Settings bumps no remount key so one screen answers for six —
// sound for the panel's own state, and not sound for a screen that RECONCILES itself against the
// settings when the popover closes. AoX and Blitz are the two that do, and they are the two with
// something in progress to lose, so both cases land in the files that already have the harness.
// tests/blitz.dom carries the same pair; the two are deliberately parallel, because the whole
// question is whether the claim holds for BOTH reconciling screens rather than one of them.
//
// ⚠ WHAT MAKES THE FIRST CASE A REAL QUESTION rather than a tautology: pin() diverges three of the
// nine settings AoX reconciles against (randomFormat, dateFormat, minY). Measured against FACTORY
// defaults, Reset Settings would restore all three, the deps would move, and the run would reset —
// correctly, and for a reason that has nothing to do with the claim. Saving the fixture AS the
// user's personal defaults leaves the reset exactly one thing to do (Input, a panel setting AoX
// does not read), which is the state in which "Reset Settings leaves the run alone" is falsifiable.
// ⚠ And aoxN stays at its factory '10' throughout that case for the same reason: it IS one of the
// nine (round-6 Q7), and the describe above already pins what a Reset Settings that MOVES it does.
describe('AoX — the settings net: an in-progress run vs Reset Settings and Save Stats', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pin()
    useModePrefs.getState().resetModePrefs()
    useUserDefaults.getState().clearDefaults()
    useProgress.getState().resetProgress()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings( \(|$)/ })))
  // Freeze the CURRENT settings as the user's personal defaults, so "default" means this fixture.
  // The four capturable prefs go in at their factory values, which is where this fixture leaves
  // them — Reset Settings restores those too, and a snapshot that disagreed would move aoxN.
  const saveFixtureAsDefaults = () => {
    const live = useSettings.getState()
    const settings = {}
    for (const k of Object.keys(SETTINGS_DEFAULTS)) settings[k] = live[k]
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings,
        prefs: {
          flashMs: MODE_PREFS_DEFAULTS.flashMs,
          blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
          blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
          aoxN: MODE_PREFS_DEFAULTS.aoxN,
        },
        amnesic: false, // this fixture's preset is never amnesic — Reset Settings must not disturb it
      }),
    )
  }
  // The ⚙ panel's own Save Stats switch, pressed as a user presses it. Not a store write: G10 is
  // about what the PANEL's controls do, and a setSaveStats() call would pass a rewrite that had
  // stopped wiring the switch up at all.
  const flipSaveStats = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Save Stats' })))

  // G7 case 3, the AoX half.
  it('Reset Settings leaves a running run alone — on the tap, and again on the close', () => {
    saveFixtureAsDefaults()
    act(() => useSettings.getState().setInputStyle('dots')) // the one thing left to restore
    mountApp()
    switchToAox()
    click('Begin')
    answerCorrect()
    const inPlay = readDate() // the question the run is now on
    const score = statValue('Score')
    expect(ctrl('Reset')).toBeInTheDocument() // running
    toggleSettings()
    fireResetSettings()
    expect(useSettings.getState().inputStyle).toBe('buttons') // the reset really fired…
    expect(ctrl('Reset')).toBeInTheDocument() // …and the run is untouched while the panel is up
    expect(statValue('Score')).toBe(score)
    toggleSettings() // close — the moment AoX reconciles, and it has nothing to reconcile
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe(score)
    expect(readDate()).toEqual(inPlay) // the same question, not a regenerated one
  })

  // G10 case 5, the AoX half — the Best-recording gate, which is the half that never landed.
  // Asserted in BOTH directions in one test on purpose: "no Best was recorded" is a claim about an
  // absence, and an absence is worthless without the same run proving a Best is recordable at all.
  // The order is OFF first for that reason — on a frozen clock a second run cannot beat the first,
  // so the ON leg has to be the one that starts from nothing.
  it('Save Stats flipped in the panel gates the Best a completed run records, not just the readouts', () => {
    useModePrefs.getState().setAoxN('2') // an Ao2 completes in two answers
    mountApp()
    switchToAox()
    toggleSettings()
    flipSaveStats()
    // Immediate, with the panel still open: the readouts stop showing what is no longer kept.
    expect(statValue('Score')).toBe('—')
    toggleSettings()
    click('Begin')
    answerCorrect()
    answerCorrect() // the run COMPLETES — Save Stats off never stopped it running
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(bestVal('Mean')).toBe('—')
    expect(useProgress.getState().aoxBest).toEqual({}) // nothing was written
    // …and the control: the same run, with the switch back on.
    click('Reset')
    toggleSettings()
    flipSaveStats()
    expect(statValue('Score')).toBe('0/0') // the readouts are back
    toggleSettings()
    click('Begin')
    answerCorrect()
    answerCorrect()
    expect(Object.keys(useProgress.getState().aoxBest)).toHaveLength(1)
    expect(bestVal('Mean')).not.toBe('—')
  })
})
