// @vitest-environment jsdom
//
// Classic mode — characterization tests (Stage C, Step 6, sub-step 0; Classic batch 1).
//
// These lock in TODAY's observable behavior of Classic mode so the upcoming engine
// extraction (sub-step 1) can be proven behavior-identical: drive the real <App/> like a
// user and assert on what the screen shows (Score / Accuracy / Streak, button states, which
// controls enable). They are written against the CURRENT app as a black box, so the same
// tests stay valid before AND after the rewrite. Bugs, if any, are locked too — the refactor
// must not change behavior; behavior fixes are a separate, deliberate step.
//
// Determinism strategy: the date is random, so we read the displayed date back and compute
// the correct weekday with the SAME already-tested calendar functions the app uses, then
// click accordingly. We pin a Gregorian-only year range (>=1583) and a fixed numeric-ymd
// format so the displayed date is unambiguous and trivially parseable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── Harness helpers ─────────────────────────────────────────────────────────
function mountApp() {
  // CustomSelect portals into #root; provide one. App's own tree mounts into RTL's
  // container (not #root), so there's no duplicate auto-mount.
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// The live Classic date is the only leaf element whose text is a numeric-ymd date
// ("Y-M-D"). AoX (always mounted, display:none) shows "—"; Deduction/Lookup aren't mounted.
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()),
  )
  if (els.length !== 1)
    throw new Error(`expected exactly one ymd date, found ${els.length}: ${els.map((e) => e.textContent)}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}

// Year range is pinned >=1583, so the active calendar is always Gregorian → plain wday().
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]

const dayBtn = (name) => screen.getByRole('button', { name })
const ctrl = (name) => screen.getByRole('button', { name })
const isDisabled = (btn) => btn.className.includes('pointer-events-none')

// Stat cells are buttons containing a label <span> and a value <span>. Find by the label
// span's exact text (robust to accessible-name spacing). getAllByRole('button') excludes the
// always-mounted-but-display:none AoX panel, so only the visible App stats strip is searched.
function statCell(label) {
  const btn = screen
    .getAllByRole('button')
    .find((b) => Array.from(b.querySelectorAll('span')).some((s) => s.textContent.trim() === label))
  if (!btn) throw new Error(`stat cell "${label}" not found`)
  return btn
}
function statValue(label) {
  const spans = statCell(label).querySelectorAll('span')
  return spans[spans.length - 1].textContent.trim()
}

// State of a weekday answer button, derived from its persistent-state class.
function dayState(name) {
  const c = dayBtn(name).className
  if (c.includes('btn-correct-persist')) return 'correct'
  if (c.includes('btn-wrong-persist')) return 'wrong-latest'
  if (c.includes('btn-wrong-dim')) return 'wrong-prev'
  if (c.includes('btn-override-wrong')) return 'override-wrong'
  return 'idle'
}

// Press New and return the fresh (parseable) date. randomFormat is off, so the new date
// uses the pinned numeric-ymd format.
function pressNewAndRead() {
  fireEvent.click(ctrl('New'))
  return readDate()
}

describe('Classic — characterization (batch 1: basics)', () => {
  beforeEach(() => {
    // The settings store is a persisted singleton — clear + reset, then pin a deterministic
    // config: fixed numeric-ymd format (parseable) and a Gregorian-only year range.
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('starts at a clean slate: Score 0/0, Streak 0/0, Accuracy —, Override disabled', () => {
    mountApp()
    pressNewAndRead() // normalize the date to the pinned format
    expect(statValue('Score')).toBe('0/0')
    expect(statValue('Streak')).toBe('0/0')
    expect(statValue('Accuracy')).toBe('—')
    expect(isDisabled(ctrl('Override'))).toBe(true)
    // Back/Forward both disabled with empty history.
    expect(isDisabled(ctrl('<'))).toBe(true)
    expect(isDisabled(ctrl('>'))).toBe(true)
  })

  it('correct answer: Score 1/1, Accuracy 100.0%, Streak 1/1, button marked correct, advances', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(date)))
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Accuracy')).toBe('100.0%')
    expect(statValue('Streak')).toBe('1/1')
    // The just-answered question was pushed to history → Back becomes available.
    expect(isDisabled(ctrl('<'))).toBe(false)
    // After a first-try correct, the live Q is fresh and Override can retro-flip the
    // just-answered entry (Path 5) → Override is enabled.
    expect(isDisabled(ctrl('Override'))).toBe(false)
  })

  it('wrong answer: Score 0/1, Accuracy 0.0%, Streak 0/0, button marked wrong, does NOT advance', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(date)))
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Accuracy')).toBe('0.0%')
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(wrongName(date))).toBe('wrong-latest')
    // The correct answer is NOT auto-revealed on a wrong (only Reveal/Show Codes/lock do that).
    expect(dayState(correctName(date))).toBe('idle')
    // Same question stays (no advance); Override is now available (wrong → Path 3).
    expect(readDate()).toEqual(date)
    expect(isDisabled(ctrl('Override'))).toBe(false)
    // Back stays disabled — a still-live wrong question hasn't been pushed to history.
    expect(isDisabled(ctrl('<'))).toBe(true)
  })

  it('Reveal: shows the correct day, counts as played (0/1), resets streak, locks the grid', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(ctrl('Reveal'))
    expect(dayState(correctName(date))).toBe('correct')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Accuracy')).toBe('0.0%')
    expect(statValue('Streak')).toBe('0/0')
    // Grid locks after Reveal — answer buttons become non-interactive.
    expect(isDisabled(dayBtn(correctName(date)))).toBe(true)
  })

  it('New after a correct answer advances to a fresh question but keeps stats', () => {
    mountApp()
    const first = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(first)))
    expect(statValue('Score')).toBe('1/1')
    // New: fresh grid (no marked buttons), stats preserved.
    fireEvent.click(ctrl('New'))
    expect(statValue('Score')).toBe('1/1') // New does not reset stats
    for (const name of DAY) expect(dayState(name)).toBe('idle')
  })
})

describe('Classic — characterization (batch 2: live Override paths)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Path 5 (correct → Override): retro-flips the just-answered question to wrong (1/1 → 0/1, streak 0)', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(date)))
    expect(statValue('Score')).toBe('1/1')
    // Override with a fresh live Q flips the most-recent (correct) history entry to wrong.
    fireEvent.click(ctrl('Override'))
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    // Override is single-shot per state — disabled immediately after firing.
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })

  it('Path 3 (wrong → Override): retroactively credits the wrong answer and advances (0/1 → 1/1)', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(date)))
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('Override'))
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    // Path 3 advances to a fresh question (history now has the credited entry).
    expect(isDisabled(ctrl('<'))).toBe(false)
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })
})

describe('Classic — characterization (batch 3: Back/Forward + history Override paths)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Back then Forward walks history, restores the answered state, and leaves stats unchanged', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1, advance to a fresh live Q
    // Back → review Q1.
    fireEvent.click(ctrl('<'))
    expect(readDate()).toEqual(q1)
    expect(dayState(correctName(q1))).toBe('correct') // answered state restored
    expect(screen.getByText('Q1')).toBeInTheDocument() // history position indicator
    expect(statValue('Score')).toBe('1/1') // browsing never changes stats
    expect(isDisabled(ctrl('<'))).toBe(true) // nothing older
    expect(isDisabled(ctrl('>'))).toBe(false) // can return to live
    // Forward → back to the live question.
    fireEvent.click(ctrl('>'))
    expect(statValue('Score')).toBe('1/1')
    expect(isDisabled(ctrl('>'))).toBe(true) // at the live edge again
  })

  it('Path 1 (Back to a correct answer → Override): undoes the credit and marks it override-wrong (1/1 → 0/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1, advance
    fireEvent.click(ctrl('<')) // back to Q1
    expect(isDisabled(ctrl('Override'))).toBe(false)
    fireEvent.click(ctrl('Override')) // delta-based undo of the credit
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(correctName(q1))).toBe('override-wrong')
  })

  it('Path 4 (wrong, then correct on same Q, then Override): credits the previous question; live Q stays put (timing off)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(dayBtn(correctName(q1))) // advances to a fresh Q, still 0/1, arms pendingWrongOverride
    const q2 = readDate()
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('Override')) // retroactively credits the previous (wrong-then-right) Q
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    // With timing hidden (Classic default), Path 4 does NOT advance the live question.
    expect(readDate()).toEqual(q2)
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })
})

describe('Classic — characterization (batch 4: Show Codes, streaks, Reset Stats)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Show Codes on a fresh question reveals the answer and counts it as a played miss (0/1)', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(ctrl('Show Codes'))
    // Opening codes on an unanswered question is a penalty: counts as played, streak reset,
    // answer revealed (the correct day goes green).
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(dayState(correctName(date))).toBe('correct')
    // Burned like a wrong → Override (Path 3) becomes available to reclaim credit.
    expect(isDisabled(ctrl('Override'))).toBe(false)
  })

  it('consecutive correct answers build the streak; a wrong resets current but keeps best', () => {
    mountApp()
    let d = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(d))) // 1/1, streak 1/1
    d = readDate()
    fireEvent.click(dayBtn(correctName(d))) // 2/2, streak 2/2
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
    d = readDate()
    fireEvent.click(dayBtn(wrongName(d))) // wrong → played 3, good 2; current streak 0, best 2
    expect(statValue('Score')).toBe('2/3')
    expect(statValue('Streak')).toBe('0/2')
  })

  it('Reset Stats clears stats and history and resets the grid', () => {
    mountApp()
    const d = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(d))) // 1/1, history now has one entry
    expect(isDisabled(ctrl('<'))).toBe(false)
    fireEvent.click(ctrl('Reset Stats'))
    expect(statValue('Score')).toBe('0/0')
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(ctrl('<'))).toBe(true) // history cleared
    for (const name of DAY) expect(dayState(name)).toBe('idle') // fresh grid
  })
})

describe('Classic — characterization (batch 5: timing-on, history & override nuances)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Timing is OFF by default in Classic (Last/Average/Median hidden). Clicking the "Last"
  // stat cell toggles timing ON. The cell doubles as the toggle button.
  it('with timing enabled, a correct answer records a solve time into Last/Average/Median', () => {
    mountApp()
    pressNewAndRead() // normalize the date format
    fireEvent.click(statCell('Last')) // enable timing → regenerates the (unanswered) date
    const date = readDate()
    expect(statValue('Last')).toBe('—') // no solves recorded yet
    fireEvent.click(dayBtn(correctName(date)))
    expect(statValue('Score')).toBe('1/1')
    // A time is now recorded — shape "N.NNs" (the exact value is wall-clock, so match the format).
    expect(statValue('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Average')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Median')).toMatch(/^\d+\.\d{2}s$/)
  })

  it('answering correctly AFTER a wrong (no Override) advances with no credit but arms Override', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1, streak 0
    fireEvent.click(dayBtn(correctName(q1))) // late-correct: advances, but earns no credit
    expect(statValue('Score')).toBe('0/1') // no credit for the late-correct
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(ctrl('<'))).toBe(false) // advanced → history has the (uncredited) entry
    expect(isDisabled(ctrl('Override'))).toBe(false) // pendingWrongOverride armed (Path 4 ready)
  })

  it('Override after Reveal retroactively credits the question (Path 3 via Reveal)', () => {
    mountApp()
    pressNewAndRead() // advance to a fresh, normalized question
    fireEvent.click(ctrl('Reveal')) // 0/1, revealed + counted wrong + locked
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('Override')) // Path 3: credit + advance
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(isDisabled(ctrl('<'))).toBe(false) // advanced
  })

  it('Back/Forward walks two levels of history with correct Q indicators, stats untouched', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1 → advance
    const q2 = readDate()
    fireEvent.click(dayBtn(correctName(q2))) // 2/2 → advance (now on live Q3)
    expect(statValue('Score')).toBe('2/2')

    // Back once → Q2 (history position "Q2").
    fireEvent.click(ctrl('<'))
    expect(readDate()).toEqual(q2)
    expect(screen.getByText('Q2')).toBeInTheDocument()
    // Back again → Q1, the oldest (Back now disabled).
    fireEvent.click(ctrl('<'))
    expect(readDate()).toEqual(q1)
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(isDisabled(ctrl('<'))).toBe(true)
    expect(statValue('Score')).toBe('2/2') // browsing never changes stats

    // Forward twice → back to the live edge.
    fireEvent.click(ctrl('>'))
    expect(readDate()).toEqual(q2)
    fireEvent.click(ctrl('>'))
    expect(isDisabled(ctrl('>'))).toBe(true)
    expect(statValue('Score')).toBe('2/2')
  })
})
