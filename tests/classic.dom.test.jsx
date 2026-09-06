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
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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
    expect(isDisabled(ctrl('Override'))).toBe(true)
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
    fireEvent.click(ctrl('Reset Stats')) // Q2: first tap arms
    fireEvent.click(ctrl('Reset Stats?')) // second tap confirms + clears
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

// ── Override + back-browse: credit a question AT MOST ONCE (deliberate fix, 2026-06-06) ─────────
// Owner-reported scenarios. The bug: crediting a back-browsed wrong entry (Path 1) does NOT
// invalidate the live question's pendingWrongOverride (which targets the SAME entry), so Forward +
// Override credits it again (Path 4) → impossible 2/1. New (not Forward) happened to clear it, which
// is why the New variants were already correct. Plus an asymmetry: a wrong ANSWER stores a stats
// snapshot on its history entry (so it can be back-browse-overridden), but Reveal / Show Codes set
// that snapshot to null — so a revealed/show-coded question can't be overridden after New + Back,
// even though it was scored and should be. These lock the correct behavior (the 2/3 + Reveal/Show
// Codes cases fail RED against the pre-fix engine).
describe('Classic — Override credits a question at most once (fix 2026-06-06)', () => {
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

  // Scenario 1 (already correct): first-try correct → back → override flips it → forward → locked.
  it('S1: correct → back → override (flip to wrong) → forward → Override locked', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(q1))) // 1/1 → advance
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // Path 1: flip correct→wrong → 0/1
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe('0/1')
  })

  // Scenario 2 (BUG): wrong→right → back → override (credit) → forward → override must be LOCKED.
  it('S2: wrong→right → back → override → forward → Override locked, no double-credit (not 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(dayBtn(correctName(q1))) // wrong→right: advance, pendingWrongOverride armed
    expect(statValue('Score')).toBe('0/1')
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // Path 1: credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(isDisabled(ctrl('Override'))).toBe(true) // Q1 already credited — must not credit again
    expect(statValue('Score')).toBe('1/1')
  })

  // Scenario 3 (BUG): wrong → New → back → override (credit) → forward → override must be LOCKED.
  it('S3: wrong → New → back → override → forward → Override locked, no double-credit (not 2/1)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(ctrl('New')) // advance, pendingWrongOverride armed
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // Path 1: credit Q1 → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('>')) // forward to live
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe('1/1')
  })

  // Scenario 4 (already correct): wrong→right → back → override → New → locked.
  it('S4: wrong→right → back → override → New → Override locked', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1)))
    fireEvent.click(dayBtn(correctName(q1))) // advance, 0/1
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('Override')) // Path 1 credit → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New'))
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe('1/1')
  })

  // Scenario 5 (already correct): wrong → New → back → override → New → locked.
  it('S5: wrong → New → back → override → New → Override locked', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1)))
    fireEvent.click(ctrl('New'))
    fireEvent.click(ctrl('<'))
    fireEvent.click(ctrl('Override')) // Path 1 credit → 1/1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New'))
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe('1/1')
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
  it('New while browsing a credited entry → no duplicate, no re-credit (stays 1/1, Override locked)', () => {
    mountApp()
    const q1 = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(q1))) // 0/1
    fireEvent.click(ctrl('New')) // advance, Q1 pushed
    fireEvent.click(ctrl('<')) // back to Q1
    fireEvent.click(ctrl('Override')) // Path 1: credit Q1 → 1/1 (still browsing the credited Q1)
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('New')) // New WHILE browsing — must return to live + advance, not duplicate Q1
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('<')) // back to the (single, credited) Q1
    expect(isDisabled(ctrl('Override'))).toBe(true) // already credited → cannot re-credit
    expect(statValue('Score')).toBe('1/1')
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

// ── Q2: Reset Stats two-tap confirm ───────────────────────────────────────────
// The Reset Stats button now arms on the first tap ("Reset Stats?", danger tint) and only clears on a
// second tap within 3s — preventing an accidental wipe of lifetime stats (it's also the `S` shortcut).
// The two-tap + has-data gate live in the shared useResetStatsArm hook, used identically by Flash +
// Deduction, so pinning it on Classic covers all three.
describe('Classic — Reset Stats two-tap confirm (Q2)', () => {
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

  it('first tap arms without clearing; second tap clears', () => {
    mountApp()
    pressNewAndRead()
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    fireEvent.click(ctrl('Reset Stats')) // first tap → arm
    expect(screen.getByRole('button', { name: 'Reset Stats?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset Stats' })).toBeNull()
    expect(statValue('Score')).toBe('1/1') // NOT cleared yet
    fireEvent.click(ctrl('Reset Stats?')) // second tap → confirm
    expect(statValue('Score')).toBe('0/0') // cleared
    expect(screen.getByRole('button', { name: 'Reset Stats' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset Stats?' })).toBeNull()
  })

  it('on a fresh mode (nothing to lose), tapping Reset Stats is a no-op — it never arms', () => {
    mountApp()
    pressNewAndRead()
    expect(statValue('Score')).toBe('0/0')
    fireEvent.click(ctrl('Reset Stats'))
    expect(screen.getByRole('button', { name: 'Reset Stats' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset Stats?' })).toBeNull()
  })
})
