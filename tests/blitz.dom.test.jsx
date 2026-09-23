// @vitest-environment jsdom
//
// Blitz mode — characterization tests (Stage C, Step 6, Step 3) + the C3a sub-mode suite.
// Blitz runs a countdown (Per Round, 60s) or per-question (Per Question, 10s) timer, with
// Best Score / Best Streak records. Per Question splits by Allow Mistakes (C3a): AM off is
// sudden death (a wrong ends the round, score-only Best); AM on keeps the round going — the
// question clock keeps draining while you retry, and only a correct answer advances with a
// fresh clock (score+streak Best, its own silo). The characterization batches lock the
// original behavior; the C3a describe below pins the new sub-mode.
//
// Fake timers keep the rAF countdown frozen for the answer-behavior tests (the 60s drain is
// impractical to sit through). The fake-timer clock DOES drive requestAnimationFrame and
// performance.now in lockstep, so the C3a expiry tests fast-forward the per-question clock
// deliberately with vi.advanceTimersByTime (qSec=1 via the modePrefs store).
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
const wrongName2 = ({ y, m, d }) => DAY[(wday(y, m, d) + 2) % 7] // a SECOND distinct wrong day
// Fast-forward the faked clock (rAF frames + performance.now advance in lockstep) inside act,
// so the countdown loop's state updates are flushed. Used by the C3a expiry tests.
const tick = (ms) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
const dayBtn = (name) => screen.getByRole('button', { name })
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
// Not offered = the app is withholding the control. How that is SPELLED lives in one place
// (tests/helpers/offered) so this file never names a class string.
const isDisabled = (btn) => !isOffered(btn)
// A text match on the VISIBLE screen, and the reason a plain screen.getByText won't do: every
// screen but Lookup is always-mounted — the five game modes, and How to Play since Q6 (round 9) —
// so their markup sits in the DOM under display:none while another mode is up. The guide's Blitz
// section names the "Same Round" tag in prose, which a global query matches as readily as the tag
// itself. Same visibility filter statValue and hasStat use, in the shape getByText has.
const visibleText = (text) => {
  const els = screen.getAllByText(text).filter((el) => !isHidden(el))
  if (els.length !== 1) throw new Error(`expected one visible "${text}", found ${els.length}`)
  return els[0]
}
// Find a stat cell via its label <span>, scoped to the visible panel (the hidden Classic/Flash/
// AoX panels also contain "Score" spans). The cell is the label span's PARENT, and its tag is the
// affordance: StatPanel renders a cell carrying an `fn` as a <button> and one without as a plain
// <div>. So the scoring trio (Score/Accuracy/Streak) is always <div>s, and a timing cell
// (Last/Mean/Median) is a <button> only while the mode is actually offering the Q8 hide toggle.
// Returns null when no such cell is on screen. ONE lookup — the four readers below all used to ask
// this same question in the same words, three of them with their own copy of the not-found throw.
function statCell(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  return labelSpan ? labelSpan.parentElement : null
}
function requireStatCell(label) {
  const cell = statCell(label)
  if (!cell) throw new Error(`stat "${label}" not found`)
  return cell
}
// ⚠ Reads the value through its OWN marker, [data-statval] — the auto-fit target StatPanel puts on
// the value span — and NOT "the cell's last span". A cell can carry a trailing screen-reader-only
// span (the "Off" that names a blanked group, C1 round 16), and last-span would read that instead of
// the value. The marker names the one element that IS the readout, so it cannot drift again.
function statValue(label) {
  return requireStatCell(label).querySelector('[data-statval]').textContent.trim()
}
// Close the run/round breakdown (the popup an ended strip's tap now opens — sub-group 3C). Used by
// the Q8 tests, whose subject is the hide toggle: they still tap the strip, and this puts the
// screen back so the assertions after the tap are about the strip and not about the popup over it.
// Round 21 removed the popup's Close button (and its title is now "Round Breakdown" per round /
// "Run Breakdown" per question), so this dismisses it the way a player now does — Escape.
const closeBreakdown = () => {
  screen.getByRole('dialog') // it is up…
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape' }) // …and Escape is how it closes now
  })
}
// Tap a stat cell (Q8: a timing-trio cell is a button that toggles the visual-only hide). It fires
// at the cell whether or not it is currently a button, deliberately — that is how a test can show
// that tapping a box the mode has made inert does nothing at all.
function clickStat(label) {
  const cell = requireStatCell(label)
  act(() => {
    fireEvent.click(cell)
  })
}
// Is this box OFFERING a tap? Read from the tag, per statCell above. It deliberately does NOT go
// through tests/helpers/offered: that file answers "is this control withheld" for a control that
// still exists (aria-disabled / pointer-events-none), and an inert stat box is not a withheld
// button — it is not a button.
function statIsToggle(label) {
  return requireStatCell(label).tagName === 'BUTTON'
}
// Whether a stat cell with this label is rendered at all (visible) — for the C3a
// streak-visibility pins (per-Q sudden death hides Streak; per-Q + AM shows it).
function hasStat(label) {
  return statCell(label) !== null
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
    useSettings.getState().resetToFactory()
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
    useSettings.getState().resetToFactory()
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

  it('Per Question (Allow Mistakes off): a correct answer advances, a wrong answer ends the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // toggle to Per Question (button shows the current mode)
    clickText('Allow Mistakes') // off → sudden death (independent toggles since C3a — no auto-off)
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
    useSettings.getState().resetToFactory()
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
    useSettings.getState().resetToFactory()
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
    useSettings.getState().resetToFactory()
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

// ── C2 fix: leaving Blitz mid-round ABANDONS the round (the hidden countdown must not keep
// draining). The original App discarded an active round on switch-away (blitzLeavingMidRound →
// stacks unsaved, snap nulled, arm() on return); AoX resets a hidden running run and Flash stops a
// live flash the same way — but the Blitz migration carried no visibility teardown, so the rAF
// countdown kept running behind display:none: a per-question timeout would count a phantom MISS in
// absentia, and the round would end + reconcile a Best for play the user walked away from. The
// ENDED (timerDone) state still survives a detour, exactly like AoX's done run.
describe('Blitz — C2 fix (mode switch mid-round abandons the round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
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

  it('switching away mid-round and back lands on a FRESH idle Blitz (round abandoned)', () => {
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate())) // round running, Score 1/1
    expect(statValue('Score')).toBe('1/1')
    act(() => {
      fireEvent.keyDown(window, { key: 'K' }) // detour into Classic mid-round
    })
    act(() => {
      vi.advanceTimersByTime(2000) // time passes while away — nothing may tick in the background
    })
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument() // back to idle — the round did not keep running
    expect(statValue('Score')).toBe('0/0') // the abandoned round's ephemeral stats are gone
  })

  it('an ENDED round (timerDone) survives the same detour', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // OFF → a wrong answer ends the round
    begin()
    click(wrongName(readDate())) // round over: 0/1, timerDone
    expect(statValue('Score')).toBe('0/1')
    act(() => {
      fireEvent.keyDown(window, { key: 'K' })
    })
    switchToBlitz()
    expect(statValue('Score')).toBe('0/1') // the finished round's summary is still there
    expect(ctrl('Reset')).toBeInTheDocument()
  })
})

// ── C2 Q2-A: a misclick-ended round is RESUMABLE via Override (regression fix). The pre-rewrite
// app resumed the round when you overrode the mistake — Per Round continued the countdown where it
// stopped, Per Question started a fresh per-question timer — and reverted the Best the interrupted
// round had provisionally saved ("bests not save yet"). The Blitz mode-untangle dropped this: a
// mistake ended the round, the Best saved, and Override credited the point but the round stayed
// DEAD (a new date loaded that you couldn't play). Restored here.
describe('Blitz — C2 Q2-A (Override resumes a misclick-ended round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
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

  it('Per Round (Allow Mistakes off): Override after a misclick credits it AND resumes the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // OFF → a wrong ends the round
    begin()
    click(correctName(readDate())) // 1/1
    click(wrongName(readDate())) // misclick → round ends 1/2
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument() // provisionally saved at the mistake
    act(() => fireEvent.click(ctrl('Override'))) // credit the misclick + RESUME
    expect(statValue('Score')).toBe('2/2') // credited
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // Best reverted — not locked from the interrupted round
    // The round is LIVE again: the next date is answerable (the bug left it dead → score would stay 2/2).
    click(correctName(readDate()))
    expect(statValue('Score')).toBe('3/3')
    // Ending the round now (another misclick) re-saves the Best at the true final score.
    click(wrongName(readDate()))
    expect(statValue('Score')).toBe('3/4')
    expect(screen.getByText(/Best Score: 3\b/)).toBeInTheDocument()
  })

  it('Per Question: Override after a sudden-death misclick resumes on a fresh question', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // → Per Question
    clickText('Allow Mistakes') // off → sudden death (independent toggles since C3a — no auto-off)
    begin()
    click(correctName(readDate())) // 1/1, next question
    click(wrongName(readDate())) // sudden-death miss → round ends 1/2
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    act(() => fireEvent.click(ctrl('Override'))) // credit + resume
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // reverted
    click(correctName(readDate())) // live again on a fresh question → advances
    expect(statValue('Score')).toBe('3/3')
  })
})

// ── C2 (uniform override): a round ended by a deliberate Reveal or Show Codes is ALSO resumable via
// Override (not just a misclick) — owner's call that Override should behave the same everywhere. The
// round continues and the interrupted round's provisional Best is reverted ("bests not updated").
describe('Blitz — C2 (Reveal / Show Codes then Override resumes the round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
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

  it('Per Round (Allow Mistakes off): Reveal ends the round, Override resumes it, Best not kept', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // 1/1
    act(() => fireEvent.click(ctrl('Reveal'))) // reveal → round ends 1/2, Best provisionally saved at 1
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    act(() => fireEvent.click(ctrl('Override'))) // credit the revealed miss + RESUME
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // reverted — not kept (was: stayed 1, round dead)
    click(correctName(readDate())) // live again (the bug left it dead → would stay 2/2)
    expect(statValue('Score')).toBe('3/3')
  })

  it('Per Round (Allow Mistakes off): Show Codes ends the round, Override resumes it, Best not kept', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // 1/1
    act(() => fireEvent.click(ctrl('Show Codes'))) // show codes → round ends 1/2 (a miss)
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    act(() => fireEvent.click(ctrl('Override'))) // credit + resume (also closes the panel via advance)
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument()
    click(correctName(readDate())) // live again
    expect(statValue('Score')).toBe('3/3')
  })
})

// ── C2 Q2-B: in PRACTICE MODE (Save Stats off) a misclick-ended round is STILL rescuable via
// Override (the off-gate used to hide Override entirely). Blitz now always-tracks internally — Save
// Stats off only dims the display + records no Best — so the rescue credit stays integrity-safe.
describe('Blitz — C2 Q2-B (Save Stats off: misclick rescue, no Best recorded)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useSettings.getState().setSaveStats(false) // practice mode
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    useSettings.getState().setSaveStats(true)
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Per Round: Override is available to rescue a misclick-ended round, and no Best is recorded', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off → a wrong ends the round
    begin()
    click(correctName(readDate())) // internally tracked; display dimmed
    click(wrongName(readDate())) // misclick → round ends
    // Practice mode: Best stays unrecorded, but Override IS available to rescue (the off-gate fix).
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument()
    expect(isDisabled(ctrl('Override'))).toBe(false)
    act(() => fireEvent.click(ctrl('Override'))) // credit + resume
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // still no Best
    // The round resumed: the next date is answerable.
    const d2 = readDate()
    click(correctName(d2))
    expect(ctrl('Reset')).toBeInTheDocument() // still live
  })

  it('Save Stats off records NO Best even when a round ends normally (always-track is display-only)', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // a correct
    click(wrongName(readDate())) // wrong → round ends with an internal score, but Save Stats off
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // no Best in practice mode
  })
})

// ── Q2 (2026-06-21): a config setting changed on the ⚙ popover CLOSE resets the round ──────────────
// Restores the documented "in active Blitz rounds, any settings change ends the round" behavior the
// mode-untangle dropped (BlitzMode had no settings effect), AND extends it: an ENDED round (timerDone)
// also resets, so the round on screen always matches the current settings. Deferred to popover CLOSE so
// adjusting several settings doesn't churn the round per keystroke; an open→close with no change is a no-op.
describe('Blitz — Q2 (a config change on popover close resets the round)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
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
  // /^Settings/ — the gear's accessible name flips to "Settings (modified)" once any
  // setting diverges from the effective defaults (the Q8 indicator), which these tests do.
  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))

  it('an ACTIVE round resets to Begin when a config setting changes on close', () => {
    mountApp()
    switchToBlitz()
    begin()
    expect(ctrl('Reset')).toBeInTheDocument() // active → Reset shown
    toggleSettings() // open ⚙ → snapshot
    act(() => useSettings.getState().setMinY(1700)) // change a config setting while open
    expect(ctrl('Reset')).toBeInTheDocument() // still active while open (deferred)
    toggleSettings() // close ⚙ → fire → resetRound
    expect(ctrl('Begin')).toBeInTheDocument() // round reset to idle
  })

  it('an ENDED round (timerDone) resets to Begin when a config setting changes on close', () => {
    mountApp()
    switchToBlitz()
    begin()
    clickText('Reveal') // ends the round → timerDone
    expect(ctrl('Reset')).toBeInTheDocument()
    toggleSettings()
    act(() => useSettings.getState().setMinY(1700))
    toggleSettings()
    expect(ctrl('Begin')).toBeInTheDocument() // ended round reset on close
  })

  it('opening + closing settings with NO change leaves the round running', () => {
    mountApp()
    switchToBlitz()
    begin()
    toggleSettings()
    toggleSettings() // no change → no reset
    expect(ctrl('Reset')).toBeInTheDocument() // still active
  })

  // Q9: the close-fired round reset REMOUNTS the answer grid (keyed on the engine's gridEpoch —
  // Blitz's resetRound is eng.resetStats, i.e. RESET, which bumps it) — fresh DOM nodes have no
  // prior colors to CSS-transition from, so the cleared grid snaps to idle instead of fading. A
  // normal advance must NOT remount (the epoch is untouched), or an in-flight flash keyframe
  // would restart.
  it('the settings-close reset REMOUNTS the answer grid; a normal advance does NOT (Q9)', () => {
    mountApp()
    switchToBlitz()
    begin()
    const stable = dayBtn(DAY[0])
    click(correctName(readDate())) // 1/1 — advances
    expect(dayBtn(DAY[0])).toBe(stable) // same node across an advance — no remount mid-flash
    click(wrongName(readDate())) // wrong → the round ends; red + revealed green persist
    const before = DAY.map((nm) => dayBtn(nm))
    toggleSettings()
    act(() => useSettings.getState().setMinY(1700))
    toggleSettings() // close → resetRound → RESET bumps gridEpoch → the keyed grid remounts
    expect(ctrl('Begin')).toBeInTheDocument()
    DAY.forEach((nm, i) => expect(dayBtn(nm)).not.toBe(before[i])) // all-new nodes — snap, no fade
  })

  it('a manual Reset tap REMOUNTS the answer grid too (Q9: same RESET mechanism)', () => {
    mountApp()
    switchToBlitz()
    begin()
    click(wrongName(readDate())) // round ends — the answer colors persist on the grid
    const before = DAY.map((nm) => dayBtn(nm))
    clickText('Reset') // resetRound → eng.resetStats → RESET bumps gridEpoch
    expect(ctrl('Begin')).toBeInTheDocument()
    DAY.forEach((nm, i) => expect(dayBtn(nm)).not.toBe(before[i])) // remounted — snap, no fade
  })
})

// ── Q7 round-6: Reset Settings now restores the mode-screen round timer too, so a Reset Settings
// that changes a running/ended round's timer reconciles it on the popover close — exactly the Q2 rule,
// now triggered by the timer dep the close-effect gained. Uses a FACTORY panel so Reset Settings
// touches ONLY the timer, isolating the mode-screen-pref path from the ⚙-panel path Q2 already covers.
// (Q7 round-6 = "extend Reset Settings"; distinct from the Session-11 Q7 that added Save Defaults.)
describe('Blitz — Q7 round-6 (Reset Settings restoring the round timer reconciles the round)', () => {
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

  it('an ACTIVE round resets when Reset Settings restores a divergent round timer on close', () => {
    useModePrefs.getState().setBlitzSec(120) // diverges from the factory 60
    mountApp()
    switchToBlitz()
    begin()
    expect(ctrl('Reset')).toBeInTheDocument() // active → Reset shown
    toggleSettings() // open ⚙ → snapshot (blitzSec 120)
    fireResetSettings() // restores blitzSec → 60 (the panel is already factory)
    expect(ctrl('Reset')).toBeInTheDocument() // still active while open (deferred to close)
    toggleSettings() // close → the blitzSec dep changed → resetRound
    expect(ctrl('Begin')).toBeInTheDocument() // round reset to idle
    expect(useModePrefs.getState().blitzSec).toBe(60) // timer restored to the factory default
  })

  it('an ENDED round (timerDone) resets when Reset Settings restores a divergent timer on close', () => {
    useModePrefs.getState().setBlitzSec(120)
    mountApp()
    switchToBlitz()
    begin()
    clickText('Reveal') // ends the round → timerDone
    expect(ctrl('Reset')).toBeInTheDocument()
    toggleSettings()
    fireResetSettings()
    toggleSettings()
    expect(ctrl('Begin')).toBeInTheDocument() // ended round reset on close
    expect(useModePrefs.getState().blitzSec).toBe(60)
  })
})

// ── C3a (Q15): the Per Question + Allow Mistakes sub-mode ─────────────────────────────────────────
// The two Blitz switches are now fully independent (the old auto-off exclusion died): per-Q + AM is
// a real fourth combination — a wrong answer marks the miss, breaks the streak, and leaves the SAME
// question on screen with its clock still draining; only a correct answer (or an in-round Override
// credit) advances, always with a fresh question clock; the round ends when any one question's
// clock expires. Its Best is score+streak (the BlitzBest shape) in its OWN silo (suddenAmBest),
// separate from sudden death's score-only record at the same config. The expiry tests set qSec=1
// (the slider min) via the modePrefs store and drive the faked rAF clock with tick().
describe('Blitz — Per Question + Allow Mistakes (C3a)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
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

  it('the two switches are independent: Per Question keeps Allow Mistakes on, and vice versa', () => {
    mountApp()
    switchToBlitz()
    expect(ctrl('Allow Mistakes').className).toContain('btn-solid') // AM on (factory)
    clickText('Per Round') // → Per Question
    expect(ctrl('Per Question')).toBeInTheDocument()
    expect(ctrl('Allow Mistakes').className).toContain('btn-solid') // NOT auto-disabled anymore
    clickText('Allow Mistakes') // off
    expect(ctrl('Allow Mistakes').className).not.toContain('btn-solid')
    expect(ctrl('Per Question')).toBeInTheDocument() // still Per Question
    clickText('Allow Mistakes') // back on while in Per Question
    expect(ctrl('Allow Mistakes').className).toContain('btn-solid')
    expect(ctrl('Per Question')).toBeInTheDocument() // did NOT bounce back to Per Round
  })

  it('a wrong answer counts a miss, breaks the streak, and stays on the SAME date (round live)', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // → Per Question, AM stays on
    begin()
    const d = readDate()
    click(wrongName(d))
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(ctrl('Reset')).toBeInTheDocument() // round still live
    expect(readDate()).toEqual(d) // SAME question — no advance
    click(wrongName2(d)) // a second, different wrong tap on the burned question
    expect(statValue('Score')).toBe('0/1') // no double count
    expect(readDate()).toEqual(d)
  })

  it('after a wrong, the correct answer advances WITHOUT credit; the next clean correct credits', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    begin()
    const d = readDate()
    click(wrongName(d)) // 0/1, stays
    click(correctName(d)) // late correct → advances, uncredited
    expect(statValue('Score')).toBe('0/1')
    expect(ctrl('Reset')).toBeInTheDocument()
    click(correctName(readDate())) // the NEW question credits normally — proves the advance
    expect(statValue('Score')).toBe('1/2')
  })

  it('a wrong does NOT refresh the question clock: the original deadline still ends the round', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    act(() => useModePrefs.getState().setBlitzQSec(1)) // fastest clock (slider min)
    begin()
    tick(500) // half the 1s clock gone
    const d = readDate()
    click(wrongName(d)) // burned — the clock must KEEP draining
    tick(600) // past the ORIGINAL 1s deadline
    expect(isDisabled(dayBtn(correctName(d)))).toBe(true) // round over — grid locked
    expect(dayBtn(correctName(d)).className).toContain('btn-correct-persist') // answer revealed
  })

  it('a correct answer DOES refresh the question clock (advance grants a fresh qSec)', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    act(() => useModePrefs.getState().setBlitzQSec(1))
    begin()
    tick(900) // ~0.1s left on the first question
    click(correctName(readDate())) // advance → fresh 1s clock
    tick(900) // past the OLD deadline, inside the new one
    expect(ctrl('Reset')).toBeInTheDocument() // still live — the clock was refreshed
    const d = readDate()
    expect(isDisabled(dayBtn(correctName(d)))).toBe(false)
    click(correctName(d)) // and still answerable
    expect(statValue('Score')).toBe('2/2')
  })

  it('a timeout on a burned question ends the round (no double count) and IS Override-rescuable', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    act(() => useModePrefs.getState().setBlitzQSec(1))
    begin()
    const d = readDate()
    click(wrongName(d)) // burned at ~t0 — played 1
    tick(1100) // the clock dies on the burned question
    expect(statValue('Score')).toBe('0/1') // ONE played — the timeout must not re-count it
    expect(dayBtn(correctName(d)).className).toContain('btn-correct-persist')
    expect(isDisabled(dayBtn(correctName(d)))).toBe(true)
    // countedWrong (set by the wrong) survives the timeout → this end is resumable (ratified):
    // crediting the wrong resumes the round on the next date with a FRESH question clock.
    expect(isDisabled(ctrl('Override'))).toBe(false)
    act(() => fireEvent.click(ctrl('Override')))
    expect(statValue('Score')).toBe('1/1') // credited
    expect(ctrl('Reset')).toBeInTheDocument()
    tick(500) // half a fresh 1s clock — a stale deadline would already have re-ended the round
    click(correctName(readDate()))
    expect(statValue('Score')).toBe('2/2')
  })

  it('Streak is visible in per-Q + AM (per-round semantics), hidden only in sudden death', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // → Per Question, AM on
    expect(statValue('Streak')).toBe('0/0') // the cell renders in per-Q + AM
    clickText('Allow Mistakes') // off → sudden death hides it (streak would equal score)
    expect(hasStat('Streak')).toBe(false)
    clickText('Allow Mistakes') // back on
    begin()
    click(correctName(readDate())) // streak 1
    click(correctName(readDate())) // streak 2 (the high-water)
    const d = readDate()
    click(wrongName(d)) // streak breaks, round continues
    click(correctName(d)) // uncredited advance
    expect(statValue('Streak')).toBe('0/2') // running 0 / best 2 — exactly per-round semantics
  })

  it('the per-Q + AM Best row records score AND streak with ★ flags and the Same Round tag', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    begin()
    click(correctName(readDate()))
    click(correctName(readDate())) // 2/2
    act(() => fireEvent.click(ctrl('Reveal'))) // give up → the round ends 2/3
    expect(screen.getByText(/Best Score: 2\b/).textContent).toContain('★')
    expect(screen.getByText(/Best Streak: 2\b/).textContent).toContain('★')
    expect(visibleText('Same Round')).toBeInTheDocument() // both set by this round
    clickText('Reset')
    begin()
    click(correctName(readDate()))
    click(correctName(readDate()))
    click(correctName(readDate())) // 3/3 — beats both fields
    act(() => fireEvent.click(ctrl('Reveal')))
    expect(screen.getByText(/Best Score: 3\b/).textContent).toContain('★') // re-flagged
    expect(screen.getByText(/Best Streak: 3\b/).textContent).toContain('★')
    expect(visibleText('Same Round')).toBeInTheDocument()
  })

  it('a post-round Override rolls the per-Q + AM Best back (same-round rollback)', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    begin()
    click(correctName(readDate())) // 1/1
    act(() => fireEvent.click(ctrl('Reveal'))) // the round ends 1/2, Best Score 1 recorded
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    act(() => fireEvent.click(ctrl('<'))) // browse the credited answer
    expect(isDisabled(ctrl('Override'))).toBe(false)
    act(() => fireEvent.click(ctrl('Override'))) // flip it to wrong → good 1→0
    expect(screen.getByText(/Best Score: 0\b/)).toBeInTheDocument() // rolled back with the round
  })

  it('an Override rescue reverts the provisionally saved Best until the round truly ends', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    begin()
    click(correctName(readDate())) // 1/1
    act(() => fireEvent.click(ctrl('Reveal'))) // ends 1/2 → Best Score 1 provisionally saved
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    act(() => fireEvent.click(ctrl('Override'))) // credit the revealed miss + RESUME
    expect(statValue('Score')).toBe('2/2')
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // reverted to the pre-round record
    click(correctName(readDate())) // live again on the next date
    expect(statValue('Score')).toBe('3/3')
    act(() => fireEvent.click(ctrl('Reveal'))) // end for real → re-saves at the true final score
    expect(screen.getByText(/Best Score: 3\b/)).toBeInTheDocument()
  })

  it('in-round Override on a live wrong credits, advances, keeps the round live, and re-arms the clock', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    act(() => useModePrefs.getState().setBlitzQSec(1))
    begin()
    const d = readDate()
    tick(600) // burn most of the 1s clock
    click(wrongName(d)) // 0/1, same question, still draining
    act(() => fireEvent.click(ctrl('Override'))) // "you were right all along" → credit + advance
    expect(statValue('Score')).toBe('1/1')
    tick(600) // past the original deadline — only a re-armed clock survives this
    expect(ctrl('Reset')).toBeInTheDocument()
    click(correctName(readDate())) // genuinely live on the NEW date
    expect(statValue('Score')).toBe('2/2')
  })

  // ★ ROUND 23 Q6 CHANGED THIS ONE DELIBERATELY. A press on the card BEHIND the live question used to
  // both advance past the live question and re-arm its clock — which, once the toggle became
  // unlimited, was a question clock the player could refill a press at a time. A press on a past card
  // now does nothing to the live question at all: it stays, and its own clock keeps draining.
  it('in-round: a press on the card behind retro-credits and does NOT touch the live clock', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    act(() => useModePrefs.getState().setBlitzQSec(1))
    begin()
    const d = readDate()
    click(wrongName(d)) // burned — played 1
    click(correctName(d)) // uncredited advance → a fresh 1 s clock on the next date
    expect(statValue('Score')).toBe('0/1')
    const live = readDate()
    tick(600) // 0.4 s left on the live question
    act(() => fireEvent.click(ctrl('Override'))) // credit the earlier wrong — the live question stays
    expect(statValue('Score')).toBe('1/1')
    expect(readDate()).toEqual(live)
    expect(ctrl('Reset')).toBeInTheDocument()
    tick(600) // past the live question's OWN deadline — a refilled clock would still be live
    expect(isDisabled(dayBtn('Sunday'))).toBe(true) // the grid only answers while a round runs
    expect(statValue('Score')).toBe('1/2') // the timeout counted the miss it always would have
  })

  it('retro-flipping a correct to wrong with AM on keeps the round going (AM off ends it — pinned above)', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    begin()
    click(correctName(readDate())) // 1/1, advanced
    act(() => fireEvent.click(ctrl('Override'))) // flip that correct → wrong
    expect(statValue('Score')).toBe('0/1')
    expect(ctrl('Reset')).toBeInTheDocument()
    const d = readDate()
    expect(isDisabled(dayBtn(correctName(d)))).toBe(false) // the grid is still answerable
    click(correctName(d))
    expect(statValue('Score')).toBe('1/2') // round continued
  })

  it('sudden-death and per-Q + AM keep SEPARATE Best silos at the same config', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round')
    clickText('Allow Mistakes') // off → sudden death
    begin()
    click(correctName(readDate())) // 1/1
    click(wrongName(readDate())) // sudden death → ends 1/2
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    expect(screen.queryByText(/Best Streak:/)).toBeNull() // the score-only row
    clickText('Reset')
    clickText('Allow Mistakes') // on → the AM silo (same qSec + config)
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument() // its own empty record
    expect(screen.getByText(/Best Streak: —/)).toBeInTheDocument()
    begin()
    click(correctName(readDate()))
    click(correctName(readDate())) // 2/2
    act(() => fireEvent.click(ctrl('Reveal'))) // ends 2/3
    expect(screen.getByText(/Best Score: 2\b/)).toBeInTheDocument()
    clickText('Reset')
    clickText('Allow Mistakes') // back off — the sudden-death record is untouched
    expect(screen.getByText(/Best Score: 1\b/)).toBeInTheDocument()
    expect(screen.queryByText(/Best Streak:/)).toBeNull()
  })
})

// ── C3a freshness: the new map joins Blitz's fully-reset report, and Full Reset wipes it ─────────
// Pristine settings here (no per-test overrides) so App's isFullyReset can actually be true: the
// Full Reset footer button is dimmed exactly when EVERYTHING is at launch state, so a lone
// suddenAmBest record must light it, and resetProgress (what Full Reset runs) must re-dim it.
describe('Blitz — C3a freshness (suddenAmBest blocks fully-reset until wiped)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('a suddenAmBest record enables Full Reset; resetProgress re-dims it', () => {
    mountApp()
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })))
    const fullResetBtn = () => screen.getByRole('button', { name: /Full Reset/ })
    expect(isOffered(fullResetBtn())).toBe(false) // pristine app → fully reset → dimmed
    act(() =>
      useProgress
        .getState()
        .setSuddenAmBest({ k: { score: 2, streak: 2, scoreRoundId: 1, streakRoundId: 1 } }),
    )
    expect(isOffered(fullResetBtn())).toBe(true) // the new map counts against Blitz freshness
    act(() => useProgress.getState().resetProgress()) // the wipe Full Reset performs
    expect(isOffered(fullResetBtn())).toBe(false)
  })
})

// ── Q8: the visual-only timing-stats hide toggle (Last/Mean/Median) ───────────────────────
// Blitz gained a per-mode timing-trio hide toggle that is VISUAL ONLY: it blanks the display but the
// engine keeps timing (Blitz feeds the engine timingOff:false always). So there is NO "Enable and
// Reset Stats?" arm — hiding can never desync — and the scoring trio (Score/Accuracy/Streak) stays
// untoggleable. One toggle per mode (blitzTimingOff), shared across Per Round / Per Question, and
// excluded from the defaults system (verified in tests/saveDefaults.dom.test.jsx).
//
// ⚠ RE-BLESSED for C1 (round 16, the stat-box redesign — approved by the owner as a settled design).
// A group YOU turned off now renders its value cells BLANK, not as an em dash. The dash was moved to
// mean one thing only — "no data yet, but there could be" — so that a shown-but-empty stat and a
// stat you hid stop reading identically. Save Stats off is the third signal: dim, whole strip. Every
// '—' in this describe that used to mean "hidden" is now '' and says so.
//
// ★ AND HIDING QUIETS ONLY A ROUND THAT IS STILL GOING (the completion guard, this round). An ENDED
// round shows its times and its whole strip goes inert — the guard AoX has always had on a completed
// run and the one thing Blitz was missing, so its time boxes stayed tappable on a screen where AoX's
// were already dead. Blitz names nothing "complete": the signal is `timerDone`, whose single writer
// endRound() is reached by EVERY way a round can finish in BOTH timing sub-modes, so the two cases
// below (Per Round clock, Per Question clock) are pinning one flag from its two ends rather than two
// behaviours. The `off` half and the `fn` half move together on purpose, and the second case is
// where that matters: the tap is the only writer of blitzTimingOff in the app, so dropping the
// toggle while leaving the times blanked would strand a player with three blank boxes and no way to
// read the round they just played.
describe('Blitz — Q8 visual-only timing hide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useModePrefs.getState().resetModePrefs() // blitzTimingOff starts false (shown)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('tapping a timing stat blanks all three (visual only); the scoring trio stays; no reset prompt', () => {
    mountApp()
    switchToBlitz()
    begin()
    tick(500)
    click(correctName(readDate())) // one solve recorded and shown
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Score')).toBe('1/1')
    clickStat('Mean') // hide the timing trio
    // BLANK — C1's "you turned these off, and they ARE still recording" signal.
    expect(statValue('Last')).toBe('')
    expect(statValue('Mean')).toBe('')
    expect(statValue('Median')).toBe('')
    // Scoring trio is untoggleable — still visible.
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Accuracy')).toBe('100.0%')
    expect(statValue('Streak')).toBe('1/1')
    // VISUAL ONLY: never the Classic/Flash/Deduction "Enable and Reset Stats?" confirmation.
    expect(screen.queryByText('Enable and Reset Stats?')).toBeNull()
    clickStat('Median') // tapping any timing box re-shows all three
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
  })

  it('the engine keeps timing while the trio is hidden — a solve made while hidden appears on re-show', () => {
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate())) // solve #1 immediate → 0.00s
    clickStat('Last') // hide
    expect(statValue('Last')).toBe('') // blank, not a dash (C1)
    tick(4000)
    click(correctName(readDate())) // solve #2 recorded WHILE hidden (~4.00s)
    expect(statValue('Score')).toBe('2/2') // the round kept running
    clickStat('Last') // re-show
    const last = statValue('Last')
    expect(last).toMatch(/^\d+\.\d{2}s$/)
    // Nonzero → the hidden solve WAS timed by the engine (would be 0.00s if the toggle wrongly
    // fed useGameEngine's timingOff and stopped tracking).
    expect(last).not.toBe('0.00s')
    expect(screen.queryByText('Enable and Reset Stats?')).toBeNull()
  })

  it('one toggle per mode: hiding in Per Round carries into Per Question', () => {
    mountApp()
    switchToBlitz()
    begin() // Per Round (default)
    tick(500)
    click(correctName(readDate()))
    clickStat('Mean') // hide in Per Round
    expect(statValue('Mean')).toBe('') // blank, not a dash (C1)
    clickText('Reset') // idle unlocks the sub-mode switch
    act(() => fireEvent.click(ctrl('Per Round'))) // → Per Question
    begin()
    tick(500)
    click(correctName(readDate())) // a Per Question solve
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Mean')).toBe('') // still hidden — the toggle is shared
  })

  // Per Round, ended by the round countdown. Also the case that pins the WHOLE strip inert, since
  // per-Round shows all six boxes — that is the property the later "tap the stat strip of a
  // finished round" affordance is built on, and it is free only while nothing else claims a tap.
  it('an ended Per Round round shows its times through the hide toggle, and the whole strip goes inert', () => {
    act(() => useModePrefs.getState().setBlitzTimingOff(true)) // hidden BEFORE the round
    mountApp()
    switchToBlitz()
    act(() => useModePrefs.getState().setBlitzSec(10)) // slider min — a round short enough to sit through
    begin()
    tick(500)
    click(correctName(readDate())) // one 0.50s solve, round still running
    expect(statValue('Mean')).toBe('') // suppressed mid-round, as ever
    expect(statIsToggle('Mean')).toBe(true) // …and still offering the toggle
    tick(10000) // the round countdown runs out
    expect(ctrl('Reset')).toBeInTheDocument() // the round is over
    // The ended round is a RESULT READOUT: it shows the times it recorded, hide toggle or not.
    expect(statValue('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Median')).toMatch(/^\d+\.\d{2}s$/)
    // Every box, not just the three that changed — nothing on this strip takes a tap any more.
    for (const label of ['Score', 'Accuracy', 'Streak', 'Last', 'Mean', 'Median'])
      expect(statIsToggle(label)).toBe(false)
    // …and a tap no longer TOGGLES. Since sub-group 3C it opens the round breakdown instead — the
    // ended strip's one remaining gesture — so the tap is asserted through that, and the times it
    // was hiding are still on the strip when the popup closes.
    clickStat('Mean')
    closeBreakdown()
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    // The pref was MASKED for this screen, never written — the hide is back for the next round.
    expect(useModePrefs.getState().blitzTimingOff).toBe(true)
    clickText('Reset')
    expect(statIsToggle('Mean')).toBe(true)
    begin()
    tick(500)
    click(correctName(readDate()))
    expect(statValue('Mean')).toBe('')
  })

  // Per Question, ended by a question clock — the other end of the same `timerDone` flag. Allow
  // Mistakes is left at its default (on), so Streak renders here too (C3a).
  it('an ended Per Question round shows its times through the hide toggle, and the trio goes inert', () => {
    act(() => useModePrefs.getState().setBlitzTimingOff(true)) // hidden BEFORE the round
    mountApp()
    switchToBlitz()
    clickText('Per Round') // → Per Question
    act(() => useModePrefs.getState().setBlitzQSec(1)) // fastest clock (slider min)
    begin()
    tick(500)
    click(correctName(readDate())) // a 0.50s solve → advances on a fresh 1s clock
    expect(statValue('Mean')).toBe('')
    expect(statIsToggle('Last')).toBe(true)
    tick(1100) // that question's clock dies → the round ends
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Last')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/)
    expect(statValue('Median')).toMatch(/^\d+\.\d{2}s$/)
    for (const label of ['Last', 'Mean', 'Median']) expect(statIsToggle(label)).toBe(false)
    clickStat('Median')
    closeBreakdown()
    expect(statValue('Median')).toMatch(/^\d+\.\d{2}s$/)
    expect(useModePrefs.getState().blitzTimingOff).toBe(true)
  })

  // The end paths that are NOT the clock reach the same flag. Allow Mistakes off, Per Round: a
  // wrong answer ends the round, and the strip must read the same way it does after an expiry —
  // there is no "the clock ran out" special case in the guard, and this is what says so.
  it('a round ended by a wrong answer (Allow Mistakes off) is inert too', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // OFF → a wrong answer ends the round
    begin()
    tick(500)
    click(correctName(readDate())) // one timed solve to have something to show
    clickStat('Mean') // hide MID-ROUND, the state the guard has to unmask
    expect(statValue('Mean')).toBe('')
    click(wrongName(readDate())) // wrong → round over
    expect(statValue('Score')).toBe('1/2')
    expect(statValue('Mean')).toMatch(/^\d+\.\d{2}s$/) // the round's time is shown regardless
    expect(statIsToggle('Mean')).toBe(false)
  })
})

// ── The behaviour net's two half-landed settings cases, finished here ─────────────────────────
// _settings_net_spec.md's G7 case 3 and G10 case 5 each make a claim about a MODE SCREEN that the
// net's own files could not make honestly. tests/settingsPanel.defaults pins the Classic screen
// only, on the reasoning that Reset Settings bumps no remount key so one screen answers for six —
// sound for the panel's own state, and not sound for a screen that RECONCILES itself against the
// settings when the popover closes. Blitz and AoX are the two that do, and they are the two with
// something in progress to lose, so both cases land in the files that already have the harness.
//
// ⚠ WHAT MAKES THE FIRST CASE A REAL QUESTION rather than a tautology, and it is the whole reason
// it is written the way it is: the fixture above diverges three of the ten settings Blitz
// reconciles against (randomFormat, dateFormat, minY). Measured against FACTORY defaults, Reset
// Settings would restore all three, the deps would move, and the round would reset — correctly,
// and for a reason that has nothing to do with the claim. Saving the fixture AS the user's
// personal defaults leaves the reset exactly one thing to do (Input, a panel setting Blitz does
// not read), which is the state in which "Reset Settings leaves the round alone" is falsifiable.
describe('Blitz — the settings net: an in-progress round vs Reset Settings and Save Stats', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useModePrefs.getState().resetModePrefs()
    useUserDefaults.getState().clearDefaults()
    useProgress.getState().resetProgress()
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

  const toggleSettings = () =>
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Settings( \(|$)/ })))
  // Freeze the CURRENT settings as the user's personal defaults, so "default" means this fixture.
  // The four capturable prefs go in at their factory values, which is where this fixture leaves
  // them — Reset Settings restores those too, and a snapshot that disagreed would move blitzSec.
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

  // G7 case 3, the Blitz half.
  it('Reset Settings leaves a running round alone — on the tap, and again on the close', () => {
    saveFixtureAsDefaults()
    act(() => useSettings.getState().setInputStyle('dots')) // the one thing left to restore
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate()))
    expect(statValue('Score')).toBe('1/1')
    expect(ctrl('Reset')).toBeInTheDocument() // running
    toggleSettings()
    fireResetSettings()
    expect(useSettings.getState().inputStyle).toBe('buttons') // the reset really fired…
    expect(ctrl('Reset')).toBeInTheDocument() // …and the round is untouched while the panel is up
    expect(statValue('Score')).toBe('1/1')
    toggleSettings() // close — the moment Blitz reconciles, and it has nothing to reconcile
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/1')
  })

  // G10 case 5, the Blitz half — the Best-recording gate, which is the half that never landed.
  // Asserted in BOTH directions in one test on purpose: "no Best was recorded" is a claim about an
  // absence, and an absence is worthless without the same round proving a Best is recordable at
  // all. The order is OFF first for that reason — a second round could not out-score the first on
  // a frozen clock, so the ON leg has to be the one that starts from nothing.
  it('Save Stats flipped in the panel gates the Best a finished round records, not just the readouts', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off → a wrong answer ends the round
    toggleSettings()
    flipSaveStats()
    // Immediate, with the panel still open: the readouts stop showing what is no longer kept.
    expect(statValue('Score')).toBe('—')
    toggleSettings()
    begin()
    click(correctName(readDate()))
    click(wrongName(readDate())) // the round ends on an internally-tracked score of 1
    expect(screen.getByText(/Best Score: —/)).toBeInTheDocument()
    expect(useProgress.getState().blitzBest).toEqual({}) // nothing was written
    // …and the control: the same round, the same score, with the switch back on.
    clickText('Reset')
    toggleSettings()
    flipSaveStats()
    expect(statValue('Score')).toBe('0/0') // the readouts are back
    toggleSettings()
    begin()
    click(correctName(readDate()))
    click(wrongName(readDate()))
    expect(screen.getByText(/Best Score: 1/)).toBeInTheDocument()
    expect(Object.keys(useProgress.getState().blitzBest)).toHaveLength(1)
  })
})

// ── Override ⇄ Undo (round 23 Q6) ─────────────────────────────────────────────────────────────
// Where Override used to go inert after use it reads Undo, and every press flips one card — which in
// Blitz can move the ROUND as well: a press can resume an ended round or end a running one. The
// clock rule: a round that ended on its LIVE date (answered, revealed, show-coded — an 'answer' end)
// keeps a stopped clock and resumes from it; a round a PRESS ended (a 'toggle' end) keeps draining
// while it waits, and its resume is charged for the gap. No free pause, no refill.
describe('Blitz — Override ⇄ Undo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useModePrefs.getState().resetModePrefs()
    useProgress.getState().resetProgress()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useModePrefs.getState().setBlitzSec(30)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })
  // The visible countdown readout — the label sitting directly above the visible timer bar.
  const clockText = () => {
    const bar = Array.from(document.querySelectorAll('.bar')).find((b) => !isHidden(b))
    return bar.previousElementSibling.textContent.trim()
  }
  const roundLive = () => !isDisabled(dayBtn('Sunday')) // the grid only answers while a round runs
  const bestScore = () => screen.getByText(/Best Score:/).textContent

  it('the label follows the card it points at, and the toggle never runs out', () => {
    mountApp()
    switchToBlitz()
    begin()
    const d = readDate()
    click(wrongName(d)) // 0/1 — Allow Mistakes on, the round keeps going
    clickText('Override') // credits the burned live card and advances
    expect(statValue('Score')).toBe('1/1')
    const live = readDate()
    // The credited card is now the one behind: the button reads Undo for it, and pressing it is a
    // score change and nothing else — the live question, and the round, stay exactly as they are.
    for (let i = 0; i < 3; i++) {
      expect(isDisabled(ctrl('Undo'))).toBe(false)
      clickText('Undo')
      expect(statValue('Score')).toBe('0/1')
      expect(readDate()).toEqual(live)
      expect(roundLive()).toBe(true)
      expect(isDisabled(ctrl('Override'))).toBe(false)
      clickText('Override')
      expect(statValue('Score')).toBe('1/1')
      expect(readDate()).toEqual(live)
      expect(roundLive()).toBe(true)
    }
  })

  // ★ THE 'answer' END: the round ended because the LIVE card became a resolved miss, so its answer
  // is already on screen and there is nothing left to read — the clock FREEZES. Crediting that card
  // resumes the round from the stamp the ending took.
  it("an 'answer'-ended round resumes from its frozen stamp, and the clock did not drain while ended", () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off → a wrong ends the round
    begin()
    click(correctName(readDate())) // 1/1
    tick(4500) // 25.5 s left
    click(wrongName(readDate())) // the misclick ends the round at 1/2
    expect(roundLive()).toBe(false)
    expect(clockText()).toBe('26s')
    expect(bestScore()).toMatch(/Best Score: 1\b/)
    tick(8000) // the answer is on screen: waiting here gains nothing, and costs nothing
    expect(clockText()).toBe('26s')
    clickText('Override') // credit the resolved card + RESUME
    expect(statValue('Score')).toBe('2/2')
    expect(roundLive()).toBe(true)
    expect(clockText()).toBe('26s') // …from the stamp, not 26 − 8
    expect(bestScore()).toMatch(/Best Score: —/) // …with the provisional Best reverted
  })

  // ★ THE 'toggle' END, and the rule that makes it fair (spec §7.1iii): the LIVE card is untouched
  // and still unresolved on screen, so a frozen clock would be a free pause — press, study the date,
  // press back. The clock keeps DRAINING while the round sits ended, and the resume is charged for
  // every second of it.
  it('a press that ends a running round keeps the clock draining, and the resume is charged for it', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // 1/1
    tick(2500) // 27.5 s left
    clickText('Override') // flip that correct card to a miss → the round ends (no mistakes allowed)
    expect(statValue('Score')).toBe('0/1')
    expect(roundLive()).toBe(false)
    const live = readDate() // the live question never left the screen…
    tick(5000) // …so staring at it is not free time: the ended clock drains in view
    expect(readDate()).toEqual(live)
    expect(clockText()).toBe('23s') // 27.5 − 5 → 22.5
    // The flipped card is in its override state, so the button reads Undo — for the card, not for the
    // round. Pressing it puts that card's credit back, which makes the round legal again.
    clickText('Undo') // → the round resumes on the SAME live card
    expect(statValue('Score')).toBe('1/1')
    expect(roundLive()).toBe(true)
    expect(readDate()).toEqual(live) // no advance, no fresh date drawn
    expect(clockText()).toBe('23s') // charged for the gap
    expect(bestScore()).toMatch(/Best Score: —/) // the ending's provisional Best went with it
  })

  // ⚠ ONLY A SHOW CODES THAT RESOLVES THE LIVE DATE STOPS THE DRAIN. Opening the codes while BROWSING
  // a past date is a read-only review — the live date stays untouched and unanswered — so the gap
  // must keep charging. It used to stop the clock anyway, which was a free pause on demand (browse
  // back, open the codes, think), and in Per Question it also turned the end into one that resumes
  // with a FRESH question clock on the same, still-unanswered date: a refill.
  it('Show Codes opened while browsing does not stop a tap-ended round draining', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // 1/1
    click(correctName(readDate())) // 2/2
    tick(2500) // 27.5 s left
    clickText('Override') // card 2 flipped to a miss → a tap-ended round, draining
    expect(roundLive()).toBe(false)
    click('<') // browse to card 2…
    act(() => fireEvent.click(ctrl('Show Codes'))) // …and review its codes: read-only
    expect(statValue('Score')).toBe('1/2') // nothing scored
    tick(5000)
    expect(clockText()).toBe('23s') // 27.5 − 5 → 22.5: still draining
    act(() => fireEvent.click(ctrl('Hide Codes')))
    click('>') // back to the live date
    clickText('Undo') // put card 2's credit back → resumes, charged for the whole gap
    expect(roundLive()).toBe(true)
    expect(clockText()).toBe('23s')
  })

  it('a gap longer than the clock leaves the round ended for good', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(correctName(readDate())) // 1/1
    clickText('Override') // → a miss, the round ends with ~30 s left and draining
    expect(roundLive()).toBe(false)
    tick(31_000) // the whole clock runs out while the round sits ended
    expect(clockText()).toBe('0s')
    clickText('Undo') // the credit comes back…
    expect(statValue('Score')).toBe('1/1')
    expect(roundLive()).toBe(false) // …but there is no time left to resume into
    clickText('Override')
    clickText('Undo')
    expect(roundLive()).toBe(false) // and no number of presses finds any
  })

  it('with Allow Mistakes ON a press that flips a card to a miss leaves the round running', () => {
    mountApp()
    switchToBlitz()
    begin() // Allow Mistakes on (the factory default)
    click(correctName(readDate())) // 1/1
    const live = readDate()
    tick(2000)
    clickText('Override') // flip it to a miss — a mistake the round allows
    expect(statValue('Score')).toBe('0/1')
    expect(roundLive()).toBe(true)
    expect(readDate()).toEqual(live)
    tick(2000)
    expect(clockText()).toBe('26s') // the clock never stopped, so nothing to charge
  })

  it('a round the CLOCK ended never resumes, however the score is toggled afterwards', () => {
    mountApp()
    switchToBlitz()
    act(() => useModePrefs.getState().setBlitzSec(5))
    begin()
    click(correctName(readDate())) // 1/1
    tick(6000) // the round clock runs out on a fresh question
    expect(roundLive()).toBe(false)
    expect(bestScore()).toMatch(/Best Score: 1\b/)
    // The button points at the card behind the timed-out one (a pristine timeout is never a target).
    clickText('Override')
    expect(statValue('Score')).toBe('0/1')
    expect(roundLive()).toBe(false)
    clickText('Undo')
    expect(statValue('Score')).toBe('1/1')
    expect(roundLive()).toBe(false)
  })

  it('Per Question: a press on a past card does NOT refill the live question clock', () => {
    mountApp()
    switchToBlitz()
    clickText('Per Round') // → Per Question (Allow Mistakes stays on)
    act(() => useModePrefs.getState().setBlitzQSec(5))
    begin()
    click(correctName(readDate())) // 1/1 → a fresh 5 s question clock
    const live = readDate()
    tick(3000) // 2 s left on it
    clickText('Override') // flip the card BEHIND it — the live question's clock is not its business
    expect(statValue('Score')).toBe('0/1')
    expect(readDate()).toEqual(live)
    expect(roundLive()).toBe(true)
    clickText('Undo') // …and back, still no refill
    tick(2100) // past the live question's own deadline
    expect(roundLive()).toBe(false) // a refilled clock would still be live
  })

  // ★ THE INVERSION OF THE OLD RULE: an Override used to last only until the next action. Now the
  // record belongs to the card, so playing on leaves it exactly where it was.
  it('an Override on a resumed round outlives every later answer', () => {
    mountApp()
    switchToBlitz()
    clickText('Allow Mistakes') // off
    begin()
    click(wrongName(readDate())) // ends 0/1
    clickText('Override') // credit it + resume, 1/1
    expect(ctrl('Undo')).toBeInTheDocument()
    click(correctName(readDate())) // play on
    expect(statValue('Score')).toBe('2/2')
    expect(ctrl('Override')).toBeInTheDocument() // …now pointing at the card just answered
    act(() => fireEvent.click(ctrl('<'))) // the card just answered
    act(() => fireEvent.click(ctrl('<'))) // …and the overridden one behind it
    expect(ctrl('Undo')).toBeInTheDocument()
    clickText('Undo')
    expect(statValue('Score')).toBe('1/2')
  })

  it('a post-round Override that raises a Best and its Undo that lowers it land the Best correctly across three cycles', () => {
    mountApp()
    switchToBlitz()
    begin() // Allow Mistakes on: wrong-then-right leaves a burned card in history
    let d = readDate()
    click(wrongName(d))
    click(correctName(d)) // Q1 burned, advanced
    d = readDate()
    click(wrongName(d))
    click(correctName(d)) // Q2 burned, advanced
    click(correctName(readDate())) // Q3 credited — 1/3
    clickText('Reveal') // end the round 1/4 → Best 1
    expect(bestScore()).toMatch(/Best Score: 1\b/)
    act(() => fireEvent.click(ctrl('<'))) // Q3
    act(() => fireEvent.click(ctrl('<'))) // Q2 (burned)
    clickText('Override') // credit Q2 → 2
    expect(bestScore()).toMatch(/Best Score: 2\b/)
    for (let i = 0; i < 3; i++) {
      clickText('Undo')
      expect(statValue('Score')).toBe('1/4')
      expect(bestScore()).toMatch(/Best Score: 1\b/)
      clickText('Override')
      expect(statValue('Score')).toBe('2/4')
      expect(bestScore()).toMatch(/Best Score: 2\b/)
    }
  })
})

// ── The ★ on a rolled-back Best (fixed alongside Override ⇄ Undo) ─────────────────────────────────
// The "new best" ★ is keyed by CONFIG, not by round. It used to be OR-folded on an improving write and
// never cleared on a lowering one, so Override (new Best, ★) then Undo (Best rolled back) left the ★ on
// a record that was no longer new. Clearing it on any lowering write would be wrong the other way — it
// would wipe a ★ an EARLIER round earned under the same config. The ★ is restored the way the record
// is: from the pre-round snapshot.
describe('Blitz — the ★ follows a rolled-back Best without clearing an earlier round', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useModePrefs.getState().resetModePrefs()
    useProgress.getState().resetProgress()
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
  const bestScore = () => screen.getByText(/Best Score:/).textContent
  // A round of two burned cards, a Reveal on the third: ends 0/3 with two creditable misses behind it.
  const twoBurnsThenReveal = () => {
    begin()
    for (let i = 0; i < 2; i++) {
      const d = readDate()
      click(wrongName(d))
      click(correctName(d))
    }
    clickText('Reveal')
  }
  const creditBothBurns = () => {
    act(() => fireEvent.click(ctrl('<'))) // Q2
    clickText('Override') // 1
    act(() => fireEvent.click(ctrl('<'))) // Q1
    clickText('Override') // 2
  }

  it('a Best raised by an Override and lowered by its Undo takes its ★ with it (no stale ★)', () => {
    // A Best of 1 from an earlier SESSION — recorded, but carrying no ★ in this one.
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate()))
    clickText('Reveal') // 1/2 → Best 1
    cleanup()
    document.getElementById('root')?.remove()
    mountApp() // a fresh mount: the record stands, the ★ is gone
    switchToBlitz()
    expect(bestScore()).toMatch(/Best Score: 1\b/)
    expect(bestScore()).not.toContain('★')
    clickText('Reset') // the ended round came back from its session park — clear it
    twoBurnsThenReveal()
    creditBothBurns()
    expect(bestScore()).toMatch(/Best Score: 2\b/)
    expect(bestScore()).toContain('★') // a new Best
    clickText('Undo')
    expect(bestScore()).toMatch(/Best Score: 1\b/)
    expect(bestScore()).not.toContain('★') // rolled back — and so is its ★
  })

  it("an earlier round's ★ survives the rollback, the Undo toggle, and a resume", () => {
    mountApp()
    switchToBlitz()
    begin()
    click(correctName(readDate()))
    clickText('Reveal') // round A: 1/2 → Best 1 ★ (earned this session)
    expect(bestScore()).toContain('★')
    clickText('Reset')
    twoBurnsThenReveal() // round B ends 0/3
    expect(bestScore()).toContain('★') // A's ★
    creditBothBurns() // B reaches 2 → Best 2 ★
    for (let i = 0; i < 3; i++) {
      clickText('Undo') // B back to 1 — the Best rolls back to A's 1…
      expect(bestScore()).toMatch(/Best Score: 1\b/)
      expect(bestScore()).toContain('★') // …and A's ★ is NOT collaterally cleared
      clickText('Override')
      expect(bestScore()).toMatch(/Best Score: 2\b/)
      expect(bestScore()).toContain('★')
    }
    // A resume reverts the round's provisional Best to the pre-round record — and its ★ with it.
    clickText('Reset')
    begin()
    clickText('Reveal') // round C ends 0/1: nothing new, B's 2 ★ still lit
    clickText('Override') // credit + resume
    expect(bestScore()).toMatch(/Best Score: 2\b/)
    expect(bestScore()).toContain('★') // the old resume deleted it
  })
})
