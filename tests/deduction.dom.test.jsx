// @vitest-environment jsdom
//
// Deduction mode — characterization tests (Stage C, Step 6, Step 4). Deduction is a puzzle
// question type with three independent sub-modes (Day / Month / Year): the screen shows a
// PARTIAL date (one of y/m/d hidden) plus its weekday, and you pick the missing piece from a
// grid of options. Each sub-mode keeps its OWN stats + history silo. It is still rendered
// inline in <App/> and runs through the same fused handlers (submitDoW/override/goBack/…) as
// the other modes, so these lock TODAY's observable behavior before it moves onto the shared
// engine — written against the current app as a black box, valid before AND after the rewrite.
//
// Determinism strategy: the puzzle is random, so we read what's on screen — the shown weekday
// and the two visible date parts (numeric-ymd format, pinned, so the partial is trivially
// parseable) — and compute which option is correct with the same already-tested calendar
// functions the app uses (activeWday, honoring the active calendar). Year/Day options are
// numbers; Month options are doomsday-code boxes whose labels (e.g. "Jan/Oct") name the months
// they group, so the correct box is the one holding a month whose weekday matches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { DAY } from '../src/lib/format.js'
import { isGapDate, isJulianDate, dim } from '../src/lib/calendar.js'
import { activeWday } from '../src/engine/gameReducer.js'
import { installSeededRandom } from './helpers/rng.js'
import { isOffered } from './helpers/offered.js'

// ── Harness ──────────────────────────────────────────────────────────────────
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
// The Classic/Flash/Blitz/AoX mode panels are always-mounted but display:none; Deduction is
// conditionally rendered (visible). isHidden walks ancestors so raw DOM queries (date, stat
// spans) ignore the hidden panels. getByRole already excludes display:none subtrees.
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const ctrl = (name) => screen.getByRole('button', { name })
// Not offered = the app is withholding the control. How that is SPELLED lives in one place
// (tests/helpers/offered) so this file never names a class string.
const isDisabled = (btn) => !isOffered(btn)

function switchToDeduction() {
  act(() => {
    fireEvent.keyDown(window, { key: 'D' })
  })
}
function clickCtrl(name) {
  act(() => {
    fireEvent.click(ctrl(name))
  })
}
// Q7 round 21: Reset Stats confirms through the shared ConfirmModal. Open it, then confirm — the
// confirm button is resolved WITHIN the dialog so it never collides with the always-present mode
// button of the same name.
function fireResetStats() {
  clickCtrl('Reset Stats')
  act(() => {
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset Stats?' })).getByRole('button', {
        name: 'Reset Stats',
      }),
    )
  })
}
function clickEl(el) {
  act(() => {
    fireEvent.click(el)
  })
}

// Stat value by label span, scoped to the visible App stats strip (hidden mode panels also
// contain "Score"/"Streak" spans). The value is the cell's last <span>.
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

// The visible Deduction option buttons, in grid order (hidden modes' grids are display:none →
// excluded by getAllByRole; the option buttons are direct children of [data-answer-grid]).
function optButtons() {
  return screen
    .getAllByRole('button')
    .filter((b) => b.parentElement?.getAttribute('data-answer-grid') === 'true')
}
function optState(btn) {
  const c = btn.className
  if (c.includes('btn-correct-persist')) return 'correct'
  if (c.includes('btn-wrong-persist')) return 'wrong-latest'
  if (c.includes('btn-wrong-dim')) return 'wrong-prev'
  if (c.includes('btn-override-wrong')) return 'override-wrong'
  return 'idle'
}
// The visible answer-grid element itself (the Q14 both-crosses sizer strut deliberately carries
// NO data-answer-grid, so this always finds the REAL grid).
function visibleAnswerGrid() {
  return Array.from(document.querySelectorAll('[data-answer-grid="true"]')).find(
    (g) => !isHidden(g),
  )
}
const flashGoodCount = () => visibleAnswerGrid().querySelectorAll('.flash-good').length
// Gap utilities on a grid element. Used by the Q4 round-9 gutter tests below: jsdom cannot measure,
// so the class token IS the contract. Returns an array so "exactly one gap token" is assertable —
// two stacked gaps would leave the gutter up to CSS emission order.
const gapTokens = (el) => el.className.split(/\s+/).filter((c) => /^gap-/.test(c))

const MON3 = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
}
const labelMonths = (lab) =>
  lab
    .split('/')
    .map((s) => MON3[s.trim()])
    .filter(Boolean)

// Read the live puzzle from the screen: the partial date (one slot is "__"), the shown weekday
// index, the option labels, and the sub-mode (which slot is missing).
function readPuzzle() {
  const dateEl = Array.from(document.querySelectorAll('div')).find(
    (e) => e.children.length === 0 && !isHidden(e) && e.textContent.includes('__'),
  )
  if (!dateEl) throw new Error('Deduction partial date not found')
  const [ySlot, mSlot, dSlot] = dateEl.textContent.trim().split('-')
  const wdEl = Array.from(document.querySelectorAll('div')).find(
    (e) => !isHidden(e) && /^Weekday:/.test(e.textContent.trim()),
  )
  if (!wdEl) throw new Error('Deduction weekday not found')
  const w = DAY.indexOf(wdEl.querySelector('span').textContent.trim())
  const labels = optButtons().map((b) => b.textContent.trim())
  return {
    type: ySlot === '__' ? 'year' : mSlot === '__' ? 'month' : 'day',
    w,
    labels,
    raw: dateEl.textContent.trim(),
    Y: ySlot === '__' ? null : +ySlot,
    M: mSlot === '__' ? null : +mSlot,
    D: dSlot === '__' ? null : +dSlot,
  }
}

// Index of the correct option, computed from the displayed weekday + the two visible parts.
// useJulian is read live from the store (Gregorian-ness comes from the year range, not the flag).
function correctIdx() {
  const useJulian = useSettings.getState().useJulian
  const { type, w, labels, Y, M, D } = readPuzzle()
  if (type === 'day') return labels.findIndex((d) => activeWday(Y, M, +d, useJulian) === w)
  if (type === 'year') return labels.findIndex((y) => activeWday(+y, M, D, useJulian) === w)
  // Month: options are doomsday boxes; the correct box holds a month whose weekday matches.
  const cand = []
  for (let m = 1; m <= 12; m++) {
    if (isGapDate(Y, m, D)) continue
    if (D > dim(Y, m, useJulian && isJulianDate(Y, m, D))) continue
    if (activeWday(Y, m, D, useJulian) === w) cand.push(m)
  }
  return labels.findIndex((lab) => labelMonths(lab).some((m) => cand.includes(m)))
}
function answerCorrect() {
  const i = correctIdx()
  if (i < 0) throw new Error('no correct option found for ' + readPuzzle().raw)
  clickEl(optButtons()[i])
}
// Click a wrong option (the one after the correct one). Returns its index so callers can
// inspect its state (the puzzle does not advance on a wrong answer).
function answerWrong() {
  const i = correctIdx()
  const opts = optButtons()
  const j = (i + 1) % opts.length
  clickEl(opts[j])
  return j
}

function pin({ minY = 1583, maxY = 10000, useJulian = true } = {}) {
  localStorage.clear()
  const s = useSettings.getState()
  s.resetToFactory()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setUseJulian(useJulian)
  s.setMinY(minY)
  s.setMaxY(maxY)
}

// ── Batch 1: Day basics ───────────────────────────────────────────────────────
describe('Deduction — characterization (batch 1: Day basics)', () => {
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

  it('starts at a clean slate: Score 0/0, Streak 0/0, Accuracy —, Override + Back/Forward disabled', () => {
    mountApp()
    switchToDeduction()
    expect(readPuzzle().type).toBe('day') // Day is the default sub-mode
    expect(statValue('Score')).toBe('0/0')
    expect(statValue('Streak')).toBe('0/0')
    expect(statValue('Accuracy')).toBe('—')
    expect(isDisabled(ctrl('Override'))).toBe(true)
    expect(isDisabled(ctrl('<'))).toBe(true)
    expect(isDisabled(ctrl('>'))).toBe(true)
  })

  it('correct answer: Score 1/1, Accuracy 100.0%, Streak 1/1, advances (Back + Override enabled)', () => {
    mountApp()
    switchToDeduction()
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Accuracy')).toBe('100.0%')
    expect(statValue('Streak')).toBe('1/1')
    expect(isDisabled(ctrl('<'))).toBe(false) // pushed to history
    expect(isDisabled(ctrl('Override'))).toBe(false) // Path 5 retro-flip available
  })

  it('wrong answer: Score 0/1, Accuracy 0.0%, Streak 0/0, marks wrong, does NOT advance, arms Override', () => {
    mountApp()
    switchToDeduction()
    const before = readPuzzle()
    const j = answerWrong()
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Accuracy')).toBe('0.0%')
    expect(statValue('Streak')).toBe('0/0')
    expect(optState(optButtons()[j])).toBe('wrong-latest')
    expect(readPuzzle().raw).toBe(before.raw) // same puzzle, no advance
    expect(isDisabled(ctrl('Override'))).toBe(false) // Path 3 armed
    expect(isDisabled(ctrl('<'))).toBe(true) // still-live wrong not pushed to history
  })

  it('Reveal: shows the correct option, counts as played (0/1), resets streak, locks the grid', () => {
    mountApp()
    switchToDeduction()
    const i = correctIdx()
    clickCtrl('Reveal')
    expect(optState(optButtons()[i])).toBe('correct')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(optButtons()[i])).toBe(true) // grid locked
  })

  it('New after a correct answer advances to a fresh puzzle but keeps stats', () => {
    mountApp()
    switchToDeduction()
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    clickCtrl('New')
    expect(statValue('Score')).toBe('1/1') // New does not reset stats
    for (const b of optButtons()) expect(optState(b)).toBe('idle') // fresh grid
  })
})

// ── Batch 2: Day live Override paths ───────────────────────────────────────────
describe('Deduction — characterization (batch 2: Day live Override)', () => {
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

  it('Path 5 (correct → Override): retro-flips the just-answered question to wrong (1/1 → 0/1, streak 0)', () => {
    mountApp()
    switchToDeduction()
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    clickCtrl('Override')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(ctrl('Override'))).toBe(true) // single-shot
  })

  it('Path 3 (wrong → Override): retroactively credits the wrong answer and advances (0/1 → 1/1)', () => {
    mountApp()
    switchToDeduction()
    answerWrong()
    expect(statValue('Score')).toBe('0/1')
    clickCtrl('Override')
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(isDisabled(ctrl('<'))).toBe(false) // advanced → history has the credited entry
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })
})

// ── Batch 3: Day Back/Forward + history Override paths ──────────────────────────
describe('Deduction — characterization (batch 3: Day Back/Forward + history Override)', () => {
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

  it('Back then Forward walks history, restores the answered state, leaves stats unchanged', () => {
    mountApp()
    switchToDeduction()
    const q1 = readPuzzle()
    answerCorrect() // 1/1, advance
    clickCtrl('<') // back to Q1
    expect(readPuzzle().raw).toBe(q1.raw)
    const q1Correct = correctIdx()
    expect(optState(optButtons()[q1Correct])).toBe('correct') // answered state restored
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/1') // browsing never changes stats
    expect(isDisabled(ctrl('<'))).toBe(true) // nothing older
    expect(isDisabled(ctrl('>'))).toBe(false) // can return to live
    clickCtrl('>') // forward to live
    expect(statValue('Score')).toBe('1/1')
    expect(isDisabled(ctrl('>'))).toBe(true) // at the live edge again
  })

  it('Path 1 (Back to a correct answer → Override): undoes the credit, marks it override-wrong (1/1 → 0/1)', () => {
    mountApp()
    switchToDeduction()
    answerCorrect() // 1/1, advance
    clickCtrl('<') // back to Q1
    expect(isDisabled(ctrl('Override'))).toBe(false)
    const i = correctIdx()
    clickCtrl('Override')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(optState(optButtons()[i])).toBe('override-wrong')
  })

  it('Path 4 (wrong, then correct on same Q, then Override): credits the previous Q; live Q stays (timing off)', () => {
    mountApp()
    switchToDeduction()
    answerWrong() // 0/1
    answerCorrect() // late-correct: advances, still 0/1, arms pendingWrongOverride
    const q2 = readPuzzle()
    expect(statValue('Score')).toBe('0/1')
    clickCtrl('Override') // retroactively credits the previous (wrong-then-right) Q
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(readPuzzle().raw).toBe(q2.raw) // timing off (Deduction default) → live Q does not advance
    expect(isDisabled(ctrl('Override'))).toBe(true)
  })
})

// ── Batch 4: Day Show Codes, streaks, Reset Stats ──────────────────────────────
describe('Deduction — characterization (batch 4: Day Show Codes, streaks, Reset Stats)', () => {
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

  it('Show Codes on a fresh question reveals the answer and counts a played miss (0/1)', () => {
    mountApp()
    switchToDeduction()
    const i = correctIdx()
    clickCtrl('Show Codes')
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(optState(optButtons()[i])).toBe('correct')
    expect(isDisabled(ctrl('Override'))).toBe(false) // burned → Path 3 available
  })

  it('consecutive correct answers build the streak; a wrong resets current but keeps best', () => {
    mountApp()
    switchToDeduction()
    answerCorrect() // 1/1, streak 1/1
    answerCorrect() // 2/2, streak 2/2
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
    answerWrong() // wrong → played 3, good 2; streak 0, best 2
    expect(statValue('Score')).toBe('2/3')
    expect(statValue('Streak')).toBe('0/2')
  })

  it('Reset Stats clears stats and history and resets the grid', () => {
    mountApp()
    switchToDeduction()
    answerCorrect() // 1/1, history has one entry
    expect(isDisabled(ctrl('<'))).toBe(false)
    fireResetStats() // opens the confirm popup, then confirms
    expect(statValue('Score')).toBe('0/0')
    expect(statValue('Streak')).toBe('0/0')
    expect(isDisabled(ctrl('<'))).toBe(true) // history cleared
    for (const b of optButtons()) expect(optState(b)).toBe('idle') // fresh grid
  })
})

// ── Batch 5: Month + Year sub-modes + per-silo independence ─────────────────────
describe('Deduction — characterization (batch 5: Month + Year + silos)', () => {
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

  it('Month sub-mode: a correct box credits and advances (1/1)', () => {
    mountApp()
    switchToDeduction()
    clickCtrl('Month')
    expect(readPuzzle().type).toBe('month')
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Accuracy')).toBe('100.0%')
    expect(statValue('Streak')).toBe('1/1')
    expect(isDisabled(ctrl('<'))).toBe(false)
  })

  it('Month sub-mode: a wrong box counts a miss and does not advance (0/1)', () => {
    mountApp()
    switchToDeduction()
    clickCtrl('Month')
    const before = readPuzzle()
    const j = answerWrong()
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    expect(optState(optButtons()[j])).toBe('wrong-latest')
    expect(readPuzzle().raw).toBe(before.raw)
    expect(isDisabled(ctrl('Override'))).toBe(false)
  })

  it('Year sub-mode: a correct year credits and advances (1/1)', () => {
    mountApp()
    switchToDeduction()
    clickCtrl('Year')
    expect(readPuzzle().type).toBe('year')
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(isDisabled(ctrl('<'))).toBe(false)
  })

  it('the three sub-modes keep independent stats (answering Day leaves Month/Year at 0/0)', () => {
    mountApp()
    switchToDeduction()
    answerCorrect() // Day → 1/1
    expect(statValue('Score')).toBe('1/1')
    clickCtrl('Month')
    expect(statValue('Score')).toBe('0/0') // Month silo untouched
    clickCtrl('Year')
    expect(statValue('Score')).toBe('0/0') // Year silo untouched
    clickCtrl('Day')
    expect(statValue('Score')).toBe('1/1') // Day silo preserved
  })
})

// ── Batch 6: 1582 special cases (Julian on) ────────────────────────────────────
describe('Deduction — characterization (batch 6: 1582 special cases)', () => {
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Month "1582 Only": forces the 1582 split-calendar layout; the correct box still credits (1/1)', () => {
    vi.useFakeTimers()
    pin({ minY: 1581, maxY: 1583, useJulian: true })
    mountApp()
    switchToDeduction()
    clickCtrl('Month')
    clickCtrl('1582 Only')
    const p = readPuzzle()
    expect(p.Y).toBe(1582)
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
  })

  it('Year "Jul Cross": forces a 2-year window straddling Oct 15, 1582; the correct year credits (1/1)', () => {
    vi.useFakeTimers()
    pin({ minY: 1581, maxY: 1583, useJulian: true })
    mountApp()
    switchToDeduction()
    clickCtrl('Year')
    clickCtrl('Jul Cross')
    expect(optButtons().length).toBe(2) // N=2 across the calendar boundary
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
  })

  it('Day sub-mode in 1582 (Julian): the Julian-aware puzzle credits the correct day (1/1)', () => {
    vi.useFakeTimers()
    pin({ minY: 1582, maxY: 1582, useJulian: true })
    mountApp()
    switchToDeduction()
    const p = readPuzzle()
    expect(p.type).toBe('day')
    expect(p.Y).toBe(1582)
    answerCorrect()
    expect(statValue('Score')).toBe('1/1')
  })
})

// ── C2: deep cross-silo independence — full MID-STATE survives a silo round-trip ─────────────────
// Batch 5 pins independent STATS; this pins the rest of a silo's state machine: an armed Override
// (countedWrong), the wrong-mark on the grid, a back-browse position, and an OPEN codes panel must
// all survive switching to another silo, playing there, and returning — and the armed Override must
// still fire correctly afterwards. The silos are separate engine instances by construction; the
// realistic leak vectors are the SHARED chrome (the one flash pulse, the toggles, the active-eng
// wiring), so the assertion drives exactly that seam.
describe('Deduction — C2: a silo round-trip preserves browse + armed-override + codes state', () => {
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

  it('Day mid-state (browsing, codes open, wrong armed) is intact after playing Month', () => {
    mountApp()
    switchToDeduction()
    // Day silo: one credit, then a wrong on Q2 (arms Override), then browse back to Q1 + open codes.
    answerCorrect() // Day 1/1
    const j = answerWrong() // Day 1/2 — wrong-latest mark, Override armed
    expect(statValue('Score')).toBe('1/2')
    clickCtrl('<') // browse to Q1 (read-only)
    expect(screen.getByText('Q1')).toBeInTheDocument()
    clickCtrl('Show Codes') // read-only codes on the browsed entry
    expect(ctrl('Hide Codes')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/2') // no penalty while browsing
    // Detour: play the Month silo (its own credit), then return.
    clickCtrl('Month')
    expect(statValue('Score')).toBe('0/0')
    answerCorrect() // Month 1/1
    expect(statValue('Score')).toBe('1/1')
    clickCtrl('Day')
    // The Day silo is EXACTLY where it was left: browsing Q1 with its codes panel open…
    expect(statValue('Score')).toBe('1/2')
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(ctrl('Hide Codes')).toBeInTheDocument()
    clickCtrl('Hide Codes')
    clickCtrl('>') // forward to the live wrong question
    expect(optState(optButtons()[j])).toBe('wrong-latest') // the wrong mark survived the detour
    // …and the armed Override still fires (Path 3): credits the wrong → 2/2.
    expect(isDisabled(ctrl('Override'))).toBe(false)
    clickCtrl('Override')
    expect(statValue('Score')).toBe('2/2')
    // The Month silo kept its own credit, untouched by Day's override.
    clickCtrl('Month')
    expect(statValue('Score')).toBe('1/1')
  })
})

// ── Q13: flash validity — a flash only renders on a grid with the button count it was born in ──
// Answering correct advances INSIDE the flash's 550ms window, so the carried green pulse used to
// repaint on whatever button sat at the same index in the NEW layout when the option count changed
// (Year 2↔5 under both crosses, Day 7↔4 across Oct 1582). The rule is general: a count-changing
// advance suppresses the carried flash in the same commit; a same-count advance keeps it — the
// designed feedback, exactly as in the fixed 7-grid weekday modes.
//
// Both sweeps below carry a raised 60s per-test timeout (the third it() argument). Each loop
// iteration is a full <App/> re-render plus a constrained puzzle regeneration (the Year cross
// window's trySpawn retries up to 3000×), and the loops run up to their probabilistic caps
// (120 / 400) — legitimate, bounded work that the default 20s budget cannot absorb when the full
// suite's parallel workers contend for the CPU (the intermittent CI "Run tests" timeout: these
// sweeps assert nothing on the wall, they simply run long). The caps still break early the moment
// both branches are observed, and nothing about the generation is forced, so every probability
// documented per-sweep stays exactly as written.
describe('Deduction — Q13: carried flash suppressed when the option count changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Answer correct once and classify the advance: 'same' | 'change' (option count), asserting the
  // carried-flash rule for that branch. Returns 'skip' WITHOUT asserting in the one case the
  // screen-derived oracle can mis-pick — a dead Feb-29 Year option (non-leap year) whose formula
  // weekday collides with the shown one; the mis-click stays on-screen as wrong-latest, so it's
  // detectable, and New recovers. Clears the flash timer afterwards so every advance is measured
  // in isolation.
  function advanceAndCheck() {
    const prevN = optButtons().length
    answerCorrect()
    if (optButtons().some((b) => optState(b) === 'wrong-latest')) {
      act(() => {
        vi.advanceTimersByTime(600)
      })
      clickCtrl('New')
      return 'skip'
    }
    const newN = optButtons().length
    const flashes = flashGoodCount()
    if (newN === prevN) {
      expect(flashes).toBe(1) // same layout → the carried pulse renders, exactly one
    } else {
      expect(flashes).toBe(0) // layout changed → suppressed in the same commit it renders
    }
    act(() => {
      vi.advanceTimersByTime(600)
    })
    return newN === prevN ? 'same' : 'change'
  }

  it('Year both-crosses: 2↔5 flips render clean; same-layout advances keep exactly one pulse', () => {
    pin({ minY: 1500, maxY: 1650, useJulian: true }) // ab (1500/1600 century) + jul (1581-1583) both possible
    const restoreRandom = installSeededRandom(1500)
    try {
      mountApp()
      switchToDeduction()
      clickCtrl('Year')
      clickCtrl('ab Cross')
      clickCtrl('Jul Cross')
      let sawSame = false
      let sawChange = false
      // Each puzzle picks ab (N=5) or jul (N=2) 50/50, so both branches show up fast.
      for (let k = 0; k < 120 && !(sawSame && sawChange); k++) {
        const kind = advanceAndCheck()
        if (kind === 'same') sawSame = true
        if (kind === 'change') sawChange = true
      }
      expect(sawSame).toBe(true)
      expect(sawChange).toBe(true)
    } finally {
      restoreRandom()
    }
  })

  it('Day pinned to 1582: the Oct 7↔4 layout pair also suppresses the carried flash', () => {
    pin({ minY: 1582, maxY: 1582, useJulian: true })
    // Seeded: the 4-option layout needs the hidden day to land in Oct 1-4 (P ~ (1/12)·(4/21) ~ 1.6%
    // per advance), so with the real RNG this sweep's iteration count — and therefore its wall-clock
    // — has a long tail. It took ~16s on an average draw and blew its 60s cap under full-suite load
    // while passing in isolation: a flaky gate. Seed 404 reaches both branches in ~3 advances
    // (~0.8s). If a change to date generation ever shifts the RNG call sequence this will get slow
    // again rather than wrong — re-pick a seed by timing a few (see tests/helpers/rng.js).
    const restoreRandom = installSeededRandom(404)
    try {
      mountApp()
      switchToDeduction()
      let sawSame = false
      let sawChange = false // a 7↔4 (or 4↔7) advance — Oct pre-gap [1-4] vs the 7-day windows
      for (let k = 0; k < 400 && !(sawSame && sawChange); k++) {
        const kind = advanceAndCheck()
        if (kind === 'same') sawSame = true
        if (kind === 'change') sawChange = true
      }
      expect(sawSame).toBe(true)
      expect(sawChange).toBe(true)
    } finally {
      restoreRandom()
    }
  })
})

// ── Q14: both-crosses Year reserves the 5-layout height (2-button grid centered in a sizer) ──
// With ab Cross AND Jul Cross both on, puzzles alternate between the 5-option two-row and the
// 2-option one-row layouts, teleporting everything below the answer panel ~57px per flip. The
// 2-option grid therefore overlays an invisible inert 5-layout strut that holds the panel at the
// 5-layout's height, with the real buttons self-centered in that space. The sizer exists EXACTLY
// when both toggles are on and N===2 — any other 2-option Year (e.g. Jul Cross alone, where every
// puzzle is one row) keeps the tight layout. The pixel geometry itself is on-device territory;
// this pins the structure.
describe('Deduction — Q14: both-crosses 2-option Year sizer overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The sizer renders as the real grid's immediate previous sibling inside the overlay wrapper;
  // in the tight layout the grid is the keyed wrapper's first element (no sibling at all).
  const sizerOf = (grid) => {
    const prev = grid.previousElementSibling
    return prev && prev.getAttribute('aria-hidden') === 'true' ? prev : null
  }

  it('sizer + self-centered grid exactly on the N=2 puzzles; N=5 stays the plain tight grid', () => {
    pin({ minY: 1500, maxY: 1650, useJulian: true })
    const restoreRandom = installSeededRandom(2500)
    try {
      mountApp()
      switchToDeduction()
      clickCtrl('Year')
      clickCtrl('ab Cross')
      clickCtrl('Jul Cross')
      let checked2 = false
      let checked5 = false
      for (let k = 0; k < 120 && !(checked2 && checked5); k++) {
        const grid = visibleAnswerGrid()
        if (optButtons().length === 2) {
          expect(grid.className).toContain('col-start-1 row-start-1 self-center')
          const sizer = sizerOf(grid)
          expect(sizer).toBeTruthy()
          expect(sizer.className).toContain('invisible')
          expect(sizer.className).toContain('pointer-events-none')
          expect(sizer.className).toContain('grid-cols-6')
          expect(sizer.hasAttribute('data-answer-grid')).toBe(false)
          expect(sizer.children.length).toBe(5) // the five 5-layout strut cells…
          expect(sizer.querySelectorAll('button').length).toBe(0) // …inert DIVs, never buttons
          // Strut and real grid draw their gutter from the one ANSWER_GRID_GAP, so the height the
          // strut reserves is the height the 5-layout actually takes. A drift here is invisible in
          // jsdom and on-screen alike — it just leaves a dead band or a jump (Q4 round-9).
          expect(gapTokens(sizer)).toEqual(gapTokens(grid))
          expect(gapTokens(sizer)).toHaveLength(1)
          // The 5-layout's col-spans are derived from the same yearGridLayout the real grid uses.
          expect(Array.from(sizer.children, (c) => /col-span-\d/.exec(c.className)?.[0])).toEqual([
            'col-span-2',
            'col-span-2',
            'col-span-2',
            'col-span-3',
            'col-span-3',
          ])
          checked2 = true
        } else {
          expect(optButtons().length).toBe(5)
          expect(grid.className).not.toContain('self-center')
          expect(sizerOf(grid)).toBe(null)
          checked5 = true
        }
        clickCtrl('New') // reroll — ab/jul picked 50/50 per puzzle
      }
      expect(checked2).toBe(true)
      expect(checked5).toBe(true)
    } finally {
      restoreRandom()
    }
  })

  it('Jul Cross alone (N=2 but only one toggle) does NOT reserve: no sizer, no self-center', () => {
    pin({ minY: 1581, maxY: 1583, useJulian: true })
    mountApp()
    switchToDeduction()
    clickCtrl('Year')
    clickCtrl('Jul Cross')
    expect(optButtons().length).toBe(2)
    const grid = visibleAnswerGrid()
    expect(grid.className).not.toContain('self-center')
    expect(sizerOf(grid)).toBe(null)
  })
})

// ── Q4 round-8: the three sub-modes' answer buttons are ONE height tier ────────
// Deduction's options are years / month-code boxes / day numbers, so its answer buttons sit one
// text tier below the weekday grids' BASE_BTN. Day and Year used to append that smaller size per
// grid and Month did not, which left Month's answers 4.2px taller (the text-base→text-sm
// line-height step at the fluid root) — and left the two that were right resolving correctly only
// because of which of two stacked text sizes CSS happened to emit last. The size is derived once
// now. jsdom cannot measure, so what is pinned is the class contract that decides the height:
// every option button in every sub-mode carries the SAME single text-size token.
describe('Deduction — Q4 round-8: Day / Month / Year answer buttons share one text size', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  const sizeTokens = (el) =>
    el.className.split(/\s+/).filter((c) => /^text-(xs|sm|base|lg|xl)$/.test(c))

  it('one text-size token per button, identical across all three sub-modes', () => {
    pin()
    mountApp()
    switchToDeduction()
    const seen = new Set()
    for (const sub of ['Day', 'Month', 'Year']) {
      clickCtrl(sub)
      const btns = optButtons()
      expect(btns.length).toBeGreaterThan(0)
      for (const b of btns) {
        // Exactly one — a second, stacked size is the ambiguity this replaced, not a style.
        expect(sizeTokens(b)).toHaveLength(1)
        seen.add(sizeTokens(b)[0])
      }
    }
    // …and it is the same one everywhere, so the three grids render at one height.
    expect([...seen]).toEqual(['text-sm'])
  })

  it('the both-crosses Year sizer strut tracks the real buttons — same size token, no drift', () => {
    pin({ minY: 1500, maxY: 1650, useJulian: true })
    const restoreRandom = installSeededRandom(2600)
    try {
      mountApp()
      switchToDeduction()
      clickCtrl('Year')
      clickCtrl('ab Cross')
      clickCtrl('Jul Cross')
      let checked = false
      for (let k = 0; k < 120 && !checked; k++) {
        const grid = visibleAnswerGrid()
        const prev = grid.previousElementSibling
        if (prev && prev.getAttribute('aria-hidden') === 'true') {
          // The strut reserves the 5-layout's height, so a size mismatch would reserve the wrong one.
          for (const cell of prev.children) expect(sizeTokens(cell)).toEqual(['text-sm'])
          checked = true
        }
        clickCtrl('New')
      }
      expect(checked).toBe(true)
    } finally {
      restoreRandom()
    }
  })
})

// ── Q4 round-9: one gutter across the sub-modes AND the weekday grid ──────────
// The owner saw the space between Deduction's answer buttons CHANGE with the sub-mode: Month ran
// gap-3 while Day and Year ran gap-2 (12.69px vs 8.46px at his 16.92px fluid root). Day and Year
// were widened onto gap-3 — the value Month already had, and the one the weekday grid has always
// had (Classic/Flash/Blitz/AoX all render the single WeekdayAnswer, so there is exactly one of
// those to check) — never the reverse. All of them now read one ANSWER_GRID_GAP, which as a bonus
// puts them on a shared column lattice: at a common gap g a 6-col col-span-2 is exactly (W−2g)/3,
// a 3-col column, and a col-span-3 is exactly (W−g)/2, a 2-col column, so the sub-modes' invisible
// column edges line up instead of missing by a few px.
// NOT asserted here: the 7-dot input. It carries the same data-answer-grid marker but is a square
// 3×3 place-items:center cluster spaced by --dot-frac, so it holds no gap token at all — a guard
// phrased as "every [data-answer-grid] wears the gutter" would fail the moment Settings → Input →
// Dots is picked. Scoping to the labelled grids keeps this honest. The strut is covered too, in
// the Q14 sizer test above (it has the reroll loop needed to reach a both-crosses N=2 puzzle).
describe('Deduction — Q4 round-9: every labelled answer grid shares one gutter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('one gutter token, identical across Day / Month / Year and the weekday grid', () => {
    pin()
    mountApp()
    // Mount lands in Classic with the factory buttons input — the weekday reference grid.
    const weekdayGrid = visibleAnswerGrid()
    expect(weekdayGrid.className).toContain('grid-cols-2') // the labelled grid, not the dot cluster
    // Exactly one token everywhere — two stacked gaps would hand the gutter to CSS emission order,
    // which is the same ambiguity the text-size fix above removed.
    expect(gapTokens(weekdayGrid)).toHaveLength(1)
    const seen = new Set(gapTokens(weekdayGrid))
    switchToDeduction()
    for (const sub of ['Day', 'Month', 'Year']) {
      clickCtrl(sub)
      expect(readPuzzle().type).toBe(sub.toLowerCase()) // the visible grid really is this sub-mode's
      const grid = visibleAnswerGrid()
      expect(gapTokens(grid)).toHaveLength(1)
      seen.add(gapTokens(grid)[0])
    }
    expect([...seen]).toEqual(['gap-3'])
  })

  it('the dot input is exempt by construction: same marker, no gap utility at all', () => {
    pin()
    useSettings.getState().setInputStyle('dots')
    mountApp()
    const dots = visibleAnswerGrid()
    expect(dots.className).toContain('dot-cluster')
    expect(gapTokens(dots)).toEqual([]) // spacing is --dot-frac in index.css, not a gap
  })
})
