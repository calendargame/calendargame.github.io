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
import { describe, it, expect, beforeEach, afterEach, onTestFinished } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'
import { isOffered } from './helpers/offered.js'

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
    throw new Error(
      `expected exactly one ymd date, found ${els.length}: ${els.map((e) => e.textContent)}`,
    )
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}

// Year range is pinned >=1583, so the active calendar is always Gregorian → plain wday().
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]

const dayBtn = (name) => screen.getByRole('button', { name })
const ctrl = (name) => screen.getByRole('button', { name })
// Q7 round 21: Reset Stats confirms through the shared ConfirmModal. Open it, then confirm — the
// confirm button is resolved WITHIN the dialog so it never collides with the always-present mode
// button of the same name.
const resetStatsDialog = () => screen.getByRole('dialog', { name: 'Reset Stats?' })
const fireResetStats = () => {
  fireEvent.click(ctrl('Reset Stats'))
  fireEvent.click(within(resetStatsDialog()).getByRole('button', { name: 'Reset Stats' }))
}
// Not offered = the app is withholding the control. How that is SPELLED lives in one place
// (tests/helpers/offered) so this file never names a class string.
const isDisabled = (btn) => !isOffered(btn)

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
// ⚠ Reads the value through its OWN marker, [data-statval] — the auto-fit target StatPanel puts on
// the value span — and NOT "the cell's last span". A cell can carry a trailing screen-reader-only
// span (the "Off" that names a blanked group, C1 round 16), and last-span would read that instead of
// the value. The marker names the one element that IS the readout, so it cannot drift again.
function statValue(label) {
  return statCell(label).querySelector('[data-statval]').textContent.trim()
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
    useSettings.getState().resetToFactory()
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
    useSettings.getState().resetToFactory()
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
    // Where Override used to go inert, the same button now reads Undo (round 23 Q6).
    expect(screen.queryByRole('button', { name: 'Override' })).toBeNull()
    expect(isDisabled(ctrl('Undo'))).toBe(false)
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
    expect(isDisabled(ctrl('Undo'))).toBe(false)
  })
})

describe('Classic — characterization (batch 3: Back/Forward + history Override paths)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
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
    expect(isDisabled(ctrl('Undo'))).toBe(false)
  })
})

// ── Override ⇄ Undo (round 23 Q6) ─────────────────────────────────────────────────────────────
// "everything will either say override or undo, no locked override anymore. We just gotta store what
// you got wrong so that if you get smth wrong then override then later come back to that question by
// browsing or from another preset or smth and undo there it shows your original red highlight(s)."
// Every scored date remembers how it was answered plus whether it is overridden, so the button reads
// the date it points at — Undo when that date is overridden, Override when it is not — forever.
describe('Classic — Override ⇄ Undo', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const snapshot = () => ({
    score: statValue('Score'),
    streak: statValue('Streak'),
    date: readDate(),
  })

  it('crediting the live wrong moves play on, and the button then reads Undo for the card behind', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1, burned
    fireEvent.click(ctrl('Override')) // credits the burned live card and moves play on
    const live = snapshot()
    expect(live.score).toBe('1/1')
    expect(live.date).not.toEqual(q1)
    // ★ THE PRESS FLIPS A CARD; IT DOES NOT REWIND PLAY. The card it just credited is the one
    // behind, so the button reads Undo for it while the fresh question stays exactly where it is —
    // and it never runs out, three cycles or thirty.
    for (let i = 0; i < 3; i++) {
      expect(isDisabled(ctrl('Undo'))).toBe(false)
      fireEvent.click(ctrl('Undo'))
      expect(snapshot()).toEqual({ score: '0/1', streak: '0/0', date: live.date })
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
      expect(isDisabled(ctrl('Override'))).toBe(false)
      fireEvent.click(ctrl('Override'))
      expect(snapshot()).toEqual(live) // the score, the streak and the date, all where they were
    }
    // …and the reds the Undo put back are there to be seen: browse to that card and it is the grid
    // the player left, not the answer the Override painted over it (the owner's sentence).
    fireEvent.click(ctrl('Undo'))
    fireEvent.click(ctrl('<'))
    expect(readDate()).toEqual(q1)
    // 'wrong-prev', not 'wrong-latest': a history card's reds are always dimmed beside the
    // synthesized green (answerButtons.entryWithGreen), and advance() gives state A the SAME green —
    // so an undone card looks exactly like a card that was never overridden, which is the point.
    expect(dayState(wrongName(q1))).toBe('wrong-prev')
    expect(dayState(correctName(q1))).toBe('correct')
    expect(ctrl('Override')).toBeInTheDocument() // the card is back in A, so the word is Override
  })

  it('Path 5 toggles on the history entry and leaves the live question alone', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1
    const live = readDate()
    for (let i = 0; i < 3; i++) {
      fireEvent.click(ctrl('Override'))
      expect(statValue('Score')).toBe('0/1')
      expect(readDate()).toEqual(live)
      fireEvent.click(ctrl('Undo'))
      expect(statValue('Score')).toBe('1/1')
      expect(statValue('Streak')).toBe('1/1')
      expect(readDate()).toEqual(live)
    }
  })

  // App's [data-key] walk skips elements whose offsetParent is null — every element in jsdom's
  // layout-free DOM (see the S-shortcut note in batch 4). So for this one test, offsetParent is
  // given the one rule the walk relies on: null inside a display:none ancestor (the hidden mode
  // screens), otherwise a parent. That lets the real keyboard handler find the visible O button.
  it('the O key follows the label', () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        for (let e = this; e; e = e.parentElement) if (e.style?.display === 'none') return null
        return this.parentElement
      },
    })
    onTestFinished(() => Object.defineProperty(HTMLElement.prototype, 'offsetParent', desc))
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1)))
    act(() => fireEvent.keyDown(window, { key: 'o' }))
    expect(statValue('Score')).toBe('0/1')
    expect(ctrl('Undo')).toBeInTheDocument()
    act(() => fireEvent.keyDown(window, { key: 'o' }))
    expect(statValue('Score')).toBe('1/1')
    expect(ctrl('Override')).toBeInTheDocument()
  })

  // ★ THE INVERSION OF THE OLD RULE, and the heart of what the owner asked for. An Override used to
  // last "until your next action": play on and the way back was gone forever. Now the record belongs
  // to the DATE, so playing on, browsing away and coming back all leave it exactly where it was, and
  // the button reads Undo the moment it points at that date again.
  it('an Override outlives every later action — play on, browse back, and it still toggles', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1
    fireEvent.click(ctrl('Override')) // take q1's credit away: 0/1, and q1 is overridden
    const q2 = readDate()
    fireEvent.click(dayBtn(correctName(q2))) // play on — which used to close the window
    expect(statValue('Score')).toBe('1/2')
    // The button now points at q2 (the card just finished, in A), so it reads Override…
    expect(ctrl('Override')).toBeInTheDocument()
    // …and browsing back to q1 finds it still overridden, two cards later.
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('<'))
    expect(readDate()).toEqual(q1)
    expect(dayState(correctName(q1))).toBe('override-wrong')
    expect(ctrl('Undo')).toBeInTheDocument()
    fireEvent.click(ctrl('Undo')) // …and it undoes there, not where it was pressed
    expect(statValue('Score')).toBe('2/2')
    expect(dayState(correctName(q1))).toBe('correct')
    expect(ctrl('Override')).toBeInTheDocument()
    // A Back/Forward round trip changes nothing about any of it.
    fireEvent.click(ctrl('Override'))
    fireEvent.click(ctrl('>'))
    fireEvent.click(ctrl('>'))
    expect(statValue('Score')).toBe('1/2')
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('<'))
    expect(ctrl('Undo')).toBeInTheDocument()
  })
})

describe('Classic — characterization (batch 4: Show Codes, streaks, Reset Stats)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
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
    fireResetStats() // opens the confirm popup, then confirms
    expect(statValue('Score')).toBe('0/0')
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(ctrl('<'))).toBe(true) // history cleared
    for (const name of DAY) expect(dayState(name)).toBe('idle') // fresh grid
  })
})

describe('Classic — characterization (batch 5: timing-on, history & override nuances)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Timing is OFF by default in Classic (Last/Mean/Median hidden). Clicking the "Last"
  // stat cell toggles timing ON. The cell doubles as the toggle button.
  it('with timing enabled, a correct answer records a solve time into Last/Mean/Median', () => {
    mountApp()
    pressNewAndRead() // normalize the date format
    fireEvent.click(statCell('Last')) // enable timing → regenerates the (unanswered) date
    const date = readDate()
    expect(statValue('Last')).toBe('—') // no solves recorded yet
    fireEvent.click(dayBtn(correctName(date)))
    expect(statValue('Score')).toBe('1/1')
    // A time is now recorded — shape "N.NNs" (the exact value is wall-clock, so match the format).
    expect(statValue('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
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

// ── Save Stats / Override availability (deliberate fix, 2026-06-06) ────────────
// A question processed (answered wrong / Reveal / Show Codes) while Save Stats is OFF is
// never scored (played is NOT incremented). Turning Save Stats back ON must NOT make that
// question override-able again — otherwise Override Path 3 credits good+1 with played still
// 0, an impossible 1/0 (good > played). The fix gates override AVAILABILITY on whether THIS
// question was actually scored (state.saveStatsThisQ via effectiveSaveStats), not on the live
// Save Stats setting. These assert the corrected behavior — they fail RED against the pre-fix
// code (Override was wrongly enabled and the score jumped to 1/0). The Save-Stats-ON path
// staying override-able is already covered by "Override after Reveal … (Path 3 via Reveal)".
describe('Classic — Save Stats / Override availability (fix 2026-06-06)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  const setSaveStats = (v) => act(() => useSettings.getState().setSaveStats(v))

  it('Reveal while Save Stats OFF, then ON: Override stays locked, Score stays 0/0 (no 1/0)', () => {
    mountApp()
    setSaveStats(false)
    pressNewAndRead() // fresh, normalized date; nothing is scored while Save Stats is off
    fireEvent.click(ctrl('Reveal')) // burns the question, but played is NOT incremented
    setSaveStats(true)
    expect(isDisabled(ctrl('Override'))).toBe(true) // must NOT arm override on an unscored Q
    expect(statValue('Score')).toBe('0/0')
  })

  it('Wrong answer while Save Stats OFF, then ON: Override stays locked, Score stays 0/0', () => {
    mountApp()
    setSaveStats(false)
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(date))) // wrong, burns the question, played NOT incremented
    setSaveStats(true)
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe('0/0')
  })

  it('Wrong while Save Stats OFF, then New + Save Stats ON: no Path-4 over-credit (Override locked)', () => {
    // The unscored wrong must NOT arm pendingWrongOverride on the next question — else Override
    // Path 4 credits good+1 on a played it never incremented (1/0). Gated at arming (advance `saved`).
    mountApp()
    setSaveStats(false)
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // wrong + unscored (played NOT incremented)
    fireEvent.click(ctrl('New')) // advance off the unscored wrong
    setSaveStats(true)
    expect(isDisabled(ctrl('Override'))).toBe(true) // no scored history → nothing to override
    expect(statValue('Score')).toBe('0/0')
  })

  // The dimmed button still says which state its date is in (second review round, F9): it used to
  // read "Override" while Save Stats was off, and "Undo" again when it came back on.
  it('Save Stats OFF dims the button on an overridden date, and it still reads Undo', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1, Q1 into history
    fireEvent.click(ctrl('Override')) // Q1 overridden away → the button reads Undo
    setSaveStats(false)
    expect(isDisabled(ctrl('Undo'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Override' })).toBeNull()
    setSaveStats(true)
    expect(isDisabled(ctrl('Undo'))).toBe(false)
  })
})

// ── Show Codes while browsing back is read-only (deliberate fix, 2026-06-06) ───
// Browsing back (backDepth>0) is review-only: opening Show Codes on a browsed entry must NOT
// change anything. The reducer's penalty-free guard only covered UNANSWERED browsed entries
// (`!state.revealed`), so opening codes on a browsed ANSWERED/correct entry fell through and
// armed countedWrong — which then let Override fire Path 3 (good+1) instead of the legitimate
// Path 1 (flip), over-crediting to an impossible 2/1 (good > played). The fix makes Show Codes
// penalty-free for ANY browsed entry. Surfaced by the C3 all-modes score-integrity survey.
describe('Classic — Show Codes while browsing back is read-only (fix 2026-06-06)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Back to a correct entry → Show Codes → Override does Path 1 flip (0/1), never over-credits (2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1 → advance to Q2 (Q1 now in history)
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('<')) // browse back to Q1 (the correct, revealed entry)
    fireEvent.click(ctrl('Show Codes')) // review the codes — must be penalty-free
    expect(statValue('Score')).toBe('1/1') // reviewing never changes the score
    fireEvent.click(ctrl('Override')) // back-browse override = Path 1 (flip correct→wrong)
    expect(statValue('Score')).toBe('0/1') // the legit flip — NOT the pre-fix 2/1 over-credit
  })
})

// ── Override + back-browse: a question can never be credited TWICE (owner's scenarios, 2026-06-06) ─
// Owner-reported scenarios, and the reason the old engine had a per-question lock: crediting a
// back-browsed wrong entry did not invalidate the live question's pending override (which targeted the
// SAME entry), so Forward + Override credited it again → an impossible 2/1. The lock is GONE (round 23
// Q6) and the guarantee is stronger without it: a card's credit is its as-answered credit XOR one
// `overridden` bit, so a second press on the same card is its Undo, by construction, whatever route
// the player took to it. These six scenarios are kept exactly as the owner reported them and now
// assert that shape — the button reads Undo on the card it already flipped, and pressing it takes the
// credit back instead of stacking a second one.
describe('Classic — a question is never credited twice (owner scenarios, 2026-06-06)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Scenario 1: first-try correct → back → the press flips it to a miss → forward → it reads Undo.
  it('S1: correct → back → Override (flip to a miss) → forward → the button reads Undo for it', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1 → advance
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // browsed: flip correct → a miss → 0/1
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(ctrl('Undo')).toBeInTheDocument() // the fresh question's button points back at Q1
    fireEvent.click(ctrl('Undo'))
    expect(statValue('Score')).toBe('1/1') // its credit, back — never 2/1, never 0/1 twice
  })

  // Scenario 2 (the reported BUG): wrong→right → back → credit it → forward → a second press must
  // take the credit BACK, not add another one (the old engine's 2/1).
  it('S2: wrong→right → back → Override → forward → the next press undoes it (never 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(dayBtn(correctName(q1))) // wrong→right: advance, Q1 pushed as a miss
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // browsed: credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(ctrl('Undo')).toBeInTheDocument()
    fireEvent.click(ctrl('Undo'))
    expect(statValue('Score')).toBe('0/1')
  })

  // Scenario 3 (the same BUG by the New route).
  it('S3: wrong → New → back → Override → forward → the next press undoes it (never 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(ctrl('New')) // advance, Q1 pushed
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // browsed: credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(ctrl('Undo')).toBeInTheDocument()
    fireEvent.click(ctrl('Undo'))
    expect(statValue('Score')).toBe('0/1')
  })

  // Scenario 4: wrong→right → back → credit → New.
  it('S4: wrong→right → back → Override → New → the next press undoes it (never 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1)))
    fireEvent.click(dayBtn(correctName(q1))) // advance, 0/1
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('Override')) // browsed: credit → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New'))
    expect(ctrl('Undo')).toBeInTheDocument()
    fireEvent.click(ctrl('Undo'))
    expect(statValue('Score')).toBe('0/1')
  })

  // Scenario 5: wrong → New → back → credit → New.
  it('S5: wrong → New → back → Override → New → the next press undoes it (never 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1)))
    fireEvent.click(ctrl('New'))
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('Override')) // browsed: credit → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New'))
    expect(ctrl('Undo')).toBeInTheDocument()
    fireEvent.click(ctrl('Undo'))
    expect(statValue('Score')).toBe('0/1')
  })

  // Owner's extra find (BUG): a revealed question must be back-browse-overridable after New.
  it('Reveal → New → back → Override available and credits (0/1 → 1/1)', () => {
    mountApp()
    pressNewAndRead()
    fireEvent.click(ctrl('Reveal')) // 0/1, scored wrong
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('New')) // advance, Q1 pushed
    fireEvent.click(ctrl('<')) // back to Q1
    expect(isDisabled(ctrl('Override'))).toBe(false) // scored → must be overridable
    fireEvent.click(ctrl('Override')) // credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
  })

  // Same asymmetry via Show Codes.
  it('Show Codes → New → back → Override available and credits (0/1 → 1/1)', () => {
    mountApp()
    pressNewAndRead()
    fireEvent.click(ctrl('Show Codes')) // burns + scores the live question (0/1)
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('New')) // advance, Q1 pushed
    fireEvent.click(ctrl('<')) // back to Q1
    expect(isDisabled(ctrl('Override'))).toBe(false) // scored → must be overridable
    fireEvent.click(ctrl('Override')) // credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
  })

  // New while browsing a credited entry must not duplicate it (which would let it be re-credited).
  it('New while browsing a credited entry → no duplicate, and the one copy still toggles', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(ctrl('New')) // advance, Q1 pushed
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // browsed: credit Q1 → 1/1 (still browsing the credited Q1)
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New')) // New WHILE browsing — must return to live + advance, not duplicate Q1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('<')) // back to the (single, credited) Q1
    expect(screen.getByText('Q1')).toBeInTheDocument() // …and it is still card 1 — one copy, not two
    expect(isDisabled(ctrl('<'))).toBe(true) // nothing older behind it
    fireEvent.click(ctrl('Undo')) // its own record, not a second crediting of a duplicate
    expect(statValue('Score')).toBe('0/1')
  })
})

// ── Back-browse Override must not count the streak past a live MISS (deliberate fix, 2026-06-08) ──
// Found by the C1 deeper-fuzz strong oracle and verified here END-TO-END through the real <App/> with
// actual button clicks (proving it's a reachable user sequence, not just an engine artifact): burn the
// LIVE question (a scored miss), then Back to an earlier wrong and Override it to credit. The streak
// recompute EXCLUDED the live question, so it counted PAST the live miss — the Streak read 1/1 instead
// of 0/1 (and that inflated streak then inflated Best on the next correct answer). Both stayed ≤ Score,
// so the good≤played / streak≤good checks couldn't catch it; the exact-history oracle did. Fixed in
// gameReducer Path 1 (liveStreakContribution). Both tests fail RED against the pre-fix engine.
describe('Classic — back-browse Override past a live miss (fix 2026-06-08)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('wrong → New → Reveal (live miss) → Back → Override: Streak is 0/1, not 1/1', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // Q1 wrong (creditable later) → Score 0/1, Streak 0/0
    fireEvent.click(ctrl('New')) // advance, Q1 pushed to history
    fireEvent.click(ctrl('Reveal')) // burn Q2 = a scored MISS, still LIVE → 0/2
    expect(statValue('Score')).toBe('0/2')
    expect(statValue('Streak')).toBe('0/0')
    fireEvent.click(ctrl('<')) // browse back to Q1 (the live Q2 miss parks aside)
    fireEvent.click(ctrl('Override')) // Path 1: credit Q1 — must NOT count the streak past the Q2 miss
    expect(statValue('Score')).toBe('1/2')
    expect(statValue('Streak')).toBe('0/1') // was 1/1 before the fix (the live Q2 miss was skipped)
    // Returning to the live edge keeps it honest.
    fireEvent.click(ctrl('New')) // advance the Q2 miss into history
    expect(statValue('Score')).toBe('1/2')
    expect(statValue('Streak')).toBe('0/1')
  })

  it('downstream: the wrongly-counted streak does not later inflate Best', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // Q1 wrong
    fireEvent.click(ctrl('New'))
    fireEvent.click(ctrl('Reveal')) // Q2 scored miss, still live
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // credit Q1; streak 0 (live Q2 miss), not 1
    fireEvent.click(ctrl('New')) // advance Q2 miss → clean edge
    const q3 = readDate()
    fireEvent.click(dayBtn(correctName(q3))) // answer Q3 correct → Streak 1/1 (Best = the true max run)
    expect(statValue('Score')).toBe('2/3')
    expect(statValue('Streak')).toBe('1/1') // was 2/2 before the fix (Best inflated by the bad streak)
  })
})

// ── Q2 (2026-06-21): a settings change regenerates the live date on the ⚙ popover CLOSE ────────────
// The ⚙ settings only change while the popover is open, so the date regen (which bumps questionId and
// thus restarts the solve timer) is deferred to one apply on close — no per-keystroke churn. While the
// popover is open the live date stays put; closing after a change regenerates it into the new config.
describe('Classic — Q2 (settings regen deferred to popover close)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  // /^Settings/ — the gear's accessible name flips to "Settings (modified)" once any
  // setting diverges from the effective defaults (the Q8 indicator), which these tests do.
  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))

  it('changing the year range defers the regen until the popover closes', () => {
    mountApp() // Classic is the default mode
    const d0 = readDate()
    const newY = d0.y === 1600 ? 1601 : 1600 // a single-year range guaranteed != the current date
    toggleSettings() // open → snapshot the settings
    act(() => {
      useSettings.getState().setMinY(newY)
      useSettings.getState().setMaxY(newY)
    })
    expect(readDate().y).toBe(d0.y) // still on the old date while the popover is open (deferred)
    toggleSettings() // close → regen fires once
    expect(readDate().y).toBe(newY) // regenerated into the new range
  })

  it('opening + closing settings with NO change does not regenerate the date', () => {
    mountApp()
    const d0 = readDate()
    toggleSettings()
    toggleSettings() // no change → no regen
    expect(readDate()).toEqual(d0) // exact same date (questionId/timer untouched)
  })
})

// ── Q2 / Q7: Reset Stats confirmation popup ───────────────────────────────────
// The Reset Stats button opens a ConfirmModal (Q7 round 21 replaced the two-tap in-place arm) and
// only clears on the popup's Confirm — preventing an accidental wipe of lifetime stats (it's also
// the `S` shortcut). The popup + has-data gate live in the shared useResetStatsConfirm hook, used
// identically by Flash + Deduction, so pinning it on Classic covers all three.
describe('Classic — Reset Stats confirmation popup (Q2 / Q7)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const answerCorrect = () => fireEvent.click(dayBtn(correctName(readDate())))

  it('the button opens a popup without clearing; Confirm clears, dismissing does not', () => {
    mountApp()
    pressNewAndRead()
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    // Dismiss first — the popup opens, nothing clears. Q2 removed the Cancel button from every
    // ConfirmModal in the app (the owner: a dismiss already says it), so the route that stands in
    // for it is Escape — one of the three the component owns, and the one a keyboard reaches.
    fireEvent.click(ctrl('Reset Stats'))
    expect(resetStatsDialog()).toBeInTheDocument()
    expect(within(resetStatsDialog()).getAllByRole('button')).toHaveLength(1) // the confirm, alone
    expect(statValue('Score')).toBe('1/1')
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(screen.queryByRole('dialog', { name: 'Reset Stats?' })).toBeNull()
    expect(statValue('Score')).toBe('1/1') // NOT cleared
    // Now Confirm.
    fireResetStats()
    expect(statValue('Score')).toBe('0/0') // cleared
    expect(screen.queryByRole('dialog', { name: 'Reset Stats?' })).toBeNull()
  })

  // (The `S` shortcut routes through this same button's onClick — App's [data-key] DOM walk
  // .click()s it — so it opens the identical popup. Not asserted here: the walk skips any element
  // whose offsetParent is null, which is every element in jsdom's layout-free DOM. The one dom test
  // that drives a game-loop letter — O, in "Classic — Override ⇄ Undo" — stubs offsetParent to do
  // it; S rides the identical walk and stays a device check.)

  // A2 (round 21): the popup now carries a real z-60 scrim, so G — which would open the ⚙ panel
  // UNDER it — is gated to a no-op while a non-panel modal is up. A mode letter is NOT gated: it
  // switches the screen and the leaving mode's own `confirmOpen && !visible` guard drops the popup.
  it('G is inert while the popup is up, but a mode letter still switches away and closes it', () => {
    mountApp()
    pressNewAndRead()
    answerCorrect()
    fireEvent.click(ctrl('Reset Stats'))
    expect(resetStatsDialog()).toBeInTheDocument()

    act(() => fireEvent.keyDown(window, { key: 'G' }))
    expect(document.getElementById('settings-popover')).toBeNull() // the panel never opened
    expect(resetStatsDialog()).toBeInTheDocument() // …and the popup is untouched

    act(() => fireEvent.keyDown(window, { key: 'F' })) // → Flash: the popup leaves with Classic
    expect(screen.queryByRole('dialog', { name: 'Reset Stats?' })).toBeNull()

    // Back on a clean screen G opens the panel exactly as before.
    act(() => fireEvent.keyDown(window, { key: 'G' }))
    expect(document.getElementById('settings-popover')).not.toBeNull()
  })

  it('on a fresh mode (nothing to lose), tapping Reset Stats is a no-op — it never opens the popup', () => {
    mountApp()
    pressNewAndRead()
    expect(statValue('Score')).toBe('0/0')
    fireEvent.click(ctrl('Reset Stats'))
    expect(screen.queryByRole('dialog', { name: 'Reset Stats?' })).toBeNull()
  })
})
