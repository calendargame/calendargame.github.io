// @vitest-environment jsdom
//
// The run/round breakdown popup (sub-group 3C) — the screen half of engine/runBreakdown, which
// owns the arithmetic and is tested next door. What this file pins is everything a player can do:
//
//   • WHERE IT COMES FROM. The strip is a plain readout until a run FINISHES; then the whole strip
//     is one button and a tap anywhere on it opens the panel. A run that FAILED is not a finished
//     run — it keeps its hide toggle and offers no breakdown — and neither is a strip with Save
//     Stats off, which is showing dashes and must not be a door to the numbers behind them.
//   • WHAT IT SAYS. One row per card played, in order, and a summary whose Mean is the SAME STRING
//     the stat strip prints. That is the reconciliation claim as a player would check it: two
//     numbers on one screen that have to agree.
//   • THAT IT IS A REAL MODAL. Focus lands inside it, Escape closes it, the scrim closes it, Close
//     closes it — the app's five-term modal contract (components/modalContract).
//
// Determinism: the same recipe as the other mode-screen suites — a pinned Gregorian range in
// numeric-ymd, the shown date read back and its weekday computed with the tested wday(), and fake
// timers (performance.now moves with them) so solve times are exact numbers rather than ~0.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'
import { isOffered } from './helpers/offered.js'

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
const click = (name) =>
  act(() => {
    fireEvent.click(ctrl(name))
  })
const tick = (ms) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
const switchTo = (key) =>
  act(() => {
    fireEvent.keyDown(window, { key })
  })
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
const answerCorrect = () =>
  act(() => {
    fireEvent.click(ctrl(correctName(readDate())))
  })
const answerWrong = () =>
  act(() => {
    fireEvent.click(ctrl(wrongName(readDate())))
  })

// The stat strip's label span, and the cell around it. Deliberately NOT the strip's root: the whole
// point of "tap anywhere" is that a tap on a CELL — which is not itself a button any more — reaches
// the opener, so the tests exercise the same element a thumb would land on.
function statCell(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s) && !s.closest('[role="dialog"]'),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found`)
  return labelSpan.parentElement
}
const statValue = (label) => statCell(label).querySelector('[data-statval]').textContent.trim()
const tapStat = (label) =>
  act(() => {
    fireEvent.click(statCell(label))
  })
// Is the strip offering the breakdown at all? The opener is the strip's ROOT, named by its
// aria-label — the strip's own text is six labels and six numbers, which names nothing.
const opener = (name) => screen.queryByRole('button', { name })
const dialog = (name) => screen.getByRole('dialog', { name })
// A summary figure inside the popup: the value beside its label.
const figure = (dlg, label) =>
  within(dlg)
    .getByText(label, { selector: 'span' })
    .parentElement.querySelectorAll('span')[1]
    .textContent.trim()
const rows = (dlg) => Array.from(dlg.querySelectorAll('li[data-solve-row]'))

function pin() {
  localStorage.clear()
  const s = useSettings.getState()
  s.resetToFactory()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setMinY(1583)
  s.setMaxY(10000)
}
// An Mo2 run, finished clean: two correct answers 2s and 6s apart.
function finishedMo2() {
  mountApp()
  switchTo('A')
  const input = Array.from(document.querySelectorAll('input[type="text"]')).find(
    (i) => !isHidden(i),
  )
  act(() => {
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input)
  })
  click('Begin')
  tick(2000)
  answerCorrect()
  tick(6000)
  answerCorrect()
}

describe('the run breakdown — MoX', () => {
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

  it('is not offered while a run is idle or still going', () => {
    mountApp()
    switchTo('A')
    expect(opener('Show run breakdown')).toBeNull()
    click('Begin')
    tick(1000)
    expect(opener('Show run breakdown')).toBeNull()
  })

  it('opens on a tap ANYWHERE on a finished run’s strip, and its Mean is the strip’s Mean', () => {
    finishedMo2()
    expect(opener('Show run breakdown')).not.toBeNull()
    const stripMean = statValue('Mean')
    expect(stripMean).toMatch(/^\d+\.\d{2}s$/)
    tapStat('Score') //  a SCORING cell — the gesture is the whole strip, not the time boxes
    const dlg = dialog('Run breakdown')
    expect(figure(dlg, 'Mean')).toBe(stripMean)
    expect(figure(dlg, 'Solves')).toBe('2/2')
    expect(figure(dlg, 'Fastest')).toBe('2.00s')
    expect(figure(dlg, 'Slowest')).toBe('6.00s')
    expect(figure(dlg, 'Spread')).toBe('4.00s')
  })

  it('lists one row per card, in order, each with its own date and time', () => {
    finishedMo2()
    tapStat('Median')
    const r = rows(dialog('Run breakdown'))
    expect(r).toHaveLength(2)
    expect(r.map((li) => li.textContent)).toEqual([
      expect.stringContaining('2.00s'),
      expect.stringContaining('6.00s'),
    ])
    // The two solves a trimmed average would throw away are marked — and still counted, which is
    // the Solves 2/2 asserted above.
    expect(r.map((li) => li.dataset.solveAccent)).toEqual(['fastest', 'slowest'])
  })

  it('marks a card that earned nothing, and shows a dash where no time was recorded', () => {
    mountApp()
    switchTo('A')
    act(() => useModePrefs.getState().setAoxAllowMistakes(true))
    const input = Array.from(document.querySelectorAll('input[type="text"]')).find(
      (i) => !isHidden(i),
    )
    act(() => {
      fireEvent.change(input, { target: { value: '2' } }) //  2 is the run-length floor (normalizeAoxN)
      fireEvent.blur(input)
    })
    click('Begin')
    tick(1000)
    answerWrong() //     card 1 burned…
    answerCorrect() //   …then answered right: it advances, credits nothing, and times nothing
    tick(3000)
    answerCorrect() //   card 2: the first credit
    tick(4000)
    answerCorrect() //   card 3: the second, which completes the Mo2 run
    tapStat('Score')
    const dlg = dialog('Run breakdown')
    const r = rows(dlg)
    expect(r).toHaveLength(3)
    expect(r[0].textContent).toContain('missed')
    expect(r[0].textContent).toContain('—') //  no time: it contributed nothing to the mean
    expect(r[1].textContent).not.toContain('missed')
    // …and the miss is counted as a CARD but not as a SOLVE, which is what keeps the rows and the
    // mean above them talking about the same run.
    expect(figure(dlg, 'Solves')).toBe('2/3')
    expect(figure(dlg, 'Mean')).toBe(statValue('Mean'))
  })

  it('is a real modal: focus lands inside it, and Escape, the scrim and Close all dismiss it', () => {
    finishedMo2()
    tapStat('Score')
    const dlg = dialog('Run breakdown')
    expect(document.activeElement).toBe(dlg)
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Run breakdown' })).toBeNull()

    tapStat('Score')
    act(() => {
      fireEvent.click(within(dialog('Run breakdown')).getByRole('button', { name: 'Close' }))
    })
    expect(screen.queryByRole('dialog', { name: 'Run breakdown' })).toBeNull()

    tapStat('Score')
    act(() => {
      fireEvent.click(screen.getByRole('presentation'))
    })
    expect(screen.queryByRole('dialog', { name: 'Run breakdown' })).toBeNull()
  })

  it('leaving the mode takes the popup with it — it portals outside this screen', () => {
    finishedMo2()
    tapStat('Score')
    expect(screen.queryByRole('dialog', { name: 'Run breakdown' })).not.toBeNull()
    // The mode shortcuts still fire while the panel is up, and the panel is portaled to #root — so
    // without the visibility gate this card would be left floating over Classic.
    switchTo('K')
    expect(screen.queryByRole('dialog', { name: 'Run breakdown' })).toBeNull()
  })

  it('Reset takes it away with the run', () => {
    finishedMo2()
    expect(opener('Show run breakdown')).not.toBeNull()
    click('Reset')
    expect(opener('Show run breakdown')).toBeNull()
  })

  it('a FAILED run offers no breakdown and keeps its hide toggle', () => {
    mountApp()
    switchTo('A')
    click('Begin') //  Allow Mistakes off (the default) → one wrong ends the run
    tick(1000)
    answerWrong()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(opener('Show run breakdown')).toBeNull()
    // The toggle is still the strip's gesture here — which is exactly why the opener is gated on
    // 'done' and not on "the run is over".
    expect(isOffered(statCell('Mean'))).toBe(true)
    expect(statCell('Mean').tagName).toBe('BUTTON')
  })

  it('with Save Stats off a finished run offers nothing — the strip is showing dashes', () => {
    finishedMo2()
    act(() => useSettings.getState().setSaveStats(false))
    expect(statValue('Mean')).toBe('—')
    expect(opener('Show run breakdown')).toBeNull()
  })
})

describe('the round breakdown — Blitz', () => {
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

  it('an ended round opens the same panel, under its own name', () => {
    mountApp()
    switchTo('B')
    act(() => useModePrefs.getState().setBlitzSec(10)) //  the slider minimum — short enough to sit through
    click('Begin')
    expect(opener('Show round breakdown')).toBeNull() //  not while the clock is running
    tick(2000)
    answerCorrect()
    tick(10000) //                                        the round countdown runs out
    expect(ctrl('Reset')).toBeInTheDocument()
    const stripMean = statValue('Mean')
    tapStat('Accuracy')
    const dlg = dialog('Round breakdown')
    expect(figure(dlg, 'Mean')).toBe(stripMean)
    expect(rows(dlg)).toHaveLength(1)
  })

  // ★★ THE PAGE UNDERNEATH IS INERT, AND THIS CARD IS WHY IT HAD TO BECOME TRUE. App's keyboard
  // handler walks the DOM for a visible [data-key] button and clicks it — and until this modal
  // existed, every modal in the app sat over the ⚙ PANEL, where there was nothing of the sort to
  // find. The breakdown is the first one over a live game screen, and the walk went straight
  // through the scrim: press O and it clicked Override, which RESUMED the finished round and
  // reverted the Best that round had provisionally saved. The player would have seen the card
  // vanish and their round come back to life.
  // ⚠ WHAT THIS CASE DOES NOT CLAIM: that the mode letters are blocked too. They are deliberately
  // not — see "leaving the mode takes the popup with it" above, which is the same handler's
  // Category 3 doing exactly what it is supposed to. The gate covers the two categories that reach
  // INTO the page (the [data-key] walk here, and the 0–9 answer grid, which rides the same line).
  it('swallows a game-loop shortcut aimed through its scrim — O does not reach Override', () => {
    mountApp()
    switchTo('B')
    act(() => {
      useModePrefs.getState().setBlitzSec(10)
      useModePrefs.getState().setBlitzAllowMistakes(false) // …so one wrong answer ENDS the round
    })
    click('Begin')
    tick(2000)
    answerWrong()
    expect(ctrl('Reset')).toBeInTheDocument() // the round is over
    expect(isOffered(ctrl('Override'))).toBe(true) // …and Override is sitting there, live
    const score = statValue('Score')

    tapStat('Score')
    expect(screen.queryByRole('dialog', { name: 'Round breakdown' })).not.toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: 'O' })
    })
    // Nothing moved: the card is still up, the round is still over, and the wrong answer was not
    // credited behind it.
    expect(screen.queryByRole('dialog', { name: 'Round breakdown' })).not.toBeNull()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(isOffered(ctrl('Override'))).toBe(true)
    expect(statValue('Score')).toBe(score)
  })
})
