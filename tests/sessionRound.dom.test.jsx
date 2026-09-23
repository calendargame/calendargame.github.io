// @vitest-environment jsdom
//
// sessionRound.dom — round-21 Q11: an ENDED timed round/run is re-shown after a preset switch and
// return, restored from sessionStorage keyed by the NOW-ACTIVE preset; an in-progress one is not.
//
// ★★ WHY THIS IS NOT A STORE-LEVEL TEST, same reason as tests/presetSwitch.dom. store/sessionRound
// has its own unit coverage for the map read/write/discard. The behaviour Q11 adds lives in the two
// always-mounted mode screens: a preset switch bumps their remount key, and on the remount they must
// re-hydrate an ended round from the incoming preset's sessionStorage slot — while an in-progress one
// stays discarded, because the remount is the fix for the cross-preset stats-contamination bug and
// must not be weakened. Nothing short of a mounted app, a real switch, and a finished round can show
// that the wiring is there — a green suite without this file is not proof (it was green with the
// wiring entirely missing).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { createPreset, switchPreset, deletePreset } from '../src/store/presetControl.js'
import { readSessionRound } from '../src/store/sessionRound.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  closeSettings,
  isOffered,
  fireFullReset,
} from './helpers/settingsPanel.jsx'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── Local screen readers ─────────────────────────────────────────────────────────────────────
// The shared modeScreen.readDate cannot be used here: it scans every leaf for a date shape without a
// visibility filter, and Classic (always mounted, display:none) always has a real date on it — two
// hits, a throw. So this file carries the isHidden-filtered readers tests/blitz.dom already uses.
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
// The class list on the CORRECT weekday's button for a given date — how the grid says what state that
// card is in ('btn-correct-persist' for the answer it earned, 'btn-override-wrong' for a credit an
// Override took away; see components/controlClasses).
const dayClass = (d) => ctrl(correctName(d)).className
// Value of a stat cell on the VISIBLE mode, read via its label span's parent + the [data-statval]
// marker — robust whether the cell is a <div>, an <fn> <button>, or a <div> inside the strip-button
// an ended round turns the whole panel into.
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found on the visible screen`)
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}

const ctrl = (name) => screen.getByRole('button', { name })
const queryCtrl = (name) => screen.queryByRole('button', { name })
const press = (key) => act(() => fireEvent.keyDown(window, { key }))
const switchToBlitz = () => press('B')
const switchToMox = () => press('A')
const openPreset = (id) => act(() => switchPreset(id))

// Everything a preset needs before its timed question can be read + answered: a fixed numeric-ymd
// format and a Gregorian-only range. Per-preset, because a switch that does NOT carry settings is
// exactly the thing under test — every preset starts factory.
const pinReadable = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })

// Finish a Blitz round the deterministic way — no fake timers. Begin, answer `nCorrect` correctly,
// then Reveal (counts a played miss + ends the round). Leaves the round ENDED with good = nCorrect,
// played = nCorrect + 1, and the completed view up (Reset shown, not Begin).
function finishBlitzRound(nCorrect) {
  tap(ctrl('Begin'))
  for (let i = 0; i < nCorrect; i++)
    tap(screen.getByRole('button', { name: correctName(readDate()) }))
  tap(ctrl('Reveal'))
}

describe('Q11 — a finished Blitz round survives a preset round-trip', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('an ended round is still on the completed view after switching away and back; a manual Reset clears it for good', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(2)
    expect(queryCtrl('Begin')).toBeNull()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('2/3')

    const p2 = createPreset()
    openPreset(p2.id)
    switchToBlitz()
    // The incoming preset never had a round — a fresh idle screen, NOT preset 1's ended one.
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')

    openPreset(1) // sessionMode restores Blitz for preset 1
    expect(queryCtrl('Begin')).toBeNull()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('2/3')
    // …and the round breakdown still opens off the ended strip.
    tap(ctrl('Show round breakdown'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => fireEvent.keyDown(document, { key: 'Escape' }))

    // The ended round was Reveal-ended, so Override is still on offer — it reads prevRoundBestRef,
    // which must have come back with the snapshot. Resuming it must put the round live again, not throw.
    expect(isOffered(ctrl('Override'))).toBe(true)
    tap(ctrl('Override'))
    expect(ctrl('Reset')).toBeInTheDocument() // round live again
    expect(screen.queryByRole('dialog')).toBeNull()
    // Reset back to a clean slate for the rest of the case.
    tap(ctrl('Reset'))
    finishBlitzRound(2)

    // A manual Reset takes it to idle → the parked slot is discarded → a re-switch never brings it back.
    tap(ctrl('Reset'))
    expect(ctrl('Begin')).toBeInTheDocument()
    openPreset(p2.id)
    openPreset(1)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
  })

  it('a round IN PROGRESS does not survive the switch — nothing is parked, nothing is restored', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    tap(ctrl('Begin'))
    tap(screen.getByRole('button', { name: correctName(readDate()) })) // 1/1, live, not ended
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/1')

    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument() // fresh — the in-progress round was discarded
    expect(statValue('Score')).toBe('0/0')
  })

  it('contamination guard: preset 1 ends a round, preset 2 has never started one — preset 2 shows fresh idle screens', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(1)

    const p2 = createPreset()
    openPreset(p2.id)
    // Blitz on preset 2: fresh, not preset 1's ended round (keyed by preset id — structural).
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    // MoX on preset 2: same — preset 1's Blitz park cannot leak across modes either.
    switchToMox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')

    openPreset(1)
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/2')
  })

  it('Full Reset clears an ended round and it stays gone across a later preset round-trip', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(2)
    expect(ctrl('Reset')).toBeInTheDocument()

    openSettings('key')
    fireFullReset()

    switchToBlitz() // Full Reset returns to Classic; go back to Blitz to read it
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')

    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
  })

  it('deleting a preset with a parked round removes its sessionRound slot — no orphan key', () => {
    mountApp()
    pinReadable()
    const p2 = createPreset()
    openPreset(p2.id)
    pinReadable()
    switchToBlitz()
    finishBlitzRound(1)
    expect(readSessionRound(p2.id, 'blitz')).not.toBeNull()

    openPreset(1)
    act(() => deletePreset(p2.id))
    expect(readSessionRound(p2.id, 'blitz')).toBeNull()
  })
})

describe('Q11 — a finished MoX run survives a preset round-trip', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  const setN = (n) => act(() => useModePrefs.getState().setAoxN(String(n)))

  it("a completed run (runPhase 'done') is restored after switching away and back", () => {
    mountApp()
    pinReadable()
    switchToMox()
    setN(2)
    tap(ctrl('Begin'))
    tap(screen.getByRole('button', { name: correctName(readDate()) })) // 1/2
    tap(screen.getByRole('button', { name: correctName(readDate()) })) // 2/2 → done
    expect(queryCtrl('Begin')).toBeNull()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('2/2')

    const p2 = createPreset()
    openPreset(p2.id)
    switchToMox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')

    openPreset(1)
    expect(queryCtrl('Begin')).toBeNull()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('2/2')

    // A manual Reset clears it; a re-switch does not resurrect it.
    tap(ctrl('Reset'))
    expect(ctrl('Begin')).toBeInTheDocument()
    openPreset(p2.id)
    openPreset(1)
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
  })

  it("a run still 'running' does not survive the switch", () => {
    mountApp()
    pinReadable()
    switchToMox()
    setN(3)
    tap(ctrl('Begin'))
    tap(screen.getByRole('button', { name: correctName(readDate()) })) // one credited solve, still running
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(statValue('Score')).toBe('1/1')

    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
    switchToMox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
  })
})

// ── Composed: a Best-key setting change on a RESTORED ended round (round-21 R2) ────────────────
// The one composed scenario the Q11 suite otherwise skips: restore an ended round/run through a
// preset round-trip, THEN move a Best-key setting (Julian here — the range stays all-Gregorian so
// no question changes, only the Best KEY does), THEN close the ⚙ panel.
//
// ★ THE RESTORE PATH LANDS EXACTLY WHERE THE NATIVE PATH DOES — that is the whole claim, and each
// case proves it by running BOTH and comparing the resulting Best store byte for byte. Each mode's
// useSettingsCloseEffect already resets an active OR ended round on a Best-key change (BlitzMode
// `if (active || timerDone) resetRound()`; AoxMode `if (runPhase !== 'idle') reset()`), pinned
// natively in tests/blitz.dom / tests/aox.dom; resetRound()/reset() never touches prevRoundBestRef
// or prevBestSnapRef, so a rehydrated ended round resets identically to a natively-ended one. (The
// reconcile effect has `blitzBk` / `bestKey` in its deps, so the key flip DOES write one entry
// under the new key mirroring the round's own result before the reset flushes — that is native
// behaviour, present with or without the round-trip, which is exactly why these cases compare the
// two paths rather than assert a single fixed shape.)
describe('Q11 composed — a Best-key change after a restored round lands where a native one does', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  const flipJulian = () => {
    openSettings('key')
    act(() => useSettings.getState().setUseJulian(false))
    closeSettings('key')
  }

  it('Blitz: restored-then-flip leaves the same blitzBest as native-then-flip, and the round resets clean', () => {
    // Native reference run: end a round, flip Julian, read the Best store.
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(2)
    flipJulian()
    const nativeBest = JSON.stringify(useProgress.getState().blitzBest)
    cleanup()
    document.getElementById('root')?.remove()
    resetAppState()

    // Restore path: same round, but parked and rehydrated through a preset round-trip first.
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(2)
    const p2 = createPreset()
    openPreset(p2.id)
    switchToBlitz()
    openPreset(1) // the ended round comes back from its park
    expect(ctrl('Reset')).toBeInTheDocument()
    flipJulian() // Best key moves → the settings-close effect resets the ended round

    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(isOffered(ctrl('Override'))).toBe(false)
    expect(JSON.stringify(useProgress.getState().blitzBest)).toBe(nativeBest)
  })

  it('MoX: restored-then-flip touches the same aoxBest keys, each reconciled exactly once, and the run resets clean', () => {
    const finishMo2 = () => {
      switchToMox()
      act(() => useModePrefs.getState().setAoxN('2'))
      tap(ctrl('Begin'))
      tap(screen.getByRole('button', { name: correctName(readDate()) })) // 1/2
      tap(screen.getByRole('button', { name: correctName(readDate()) })) // 2/2 → done
    }
    // aoxBest records SOLVE TIMES (wall-clock, no fake timers in this file), so the two runs'
    // avg/med values differ — the deterministic, meaningful comparison is the KEY SET and the
    // round-id stamped on each entry: one reconcile per key, under round 1, on both paths.
    const shape = (best) =>
      Object.fromEntries(
        Object.entries(best).map(([k, v]) => [
          k,
          { avgRoundId: v.avgRoundId, medRoundId: v.medRoundId },
        ]),
      )

    mountApp()
    pinReadable()
    finishMo2()
    flipJulian()
    const nativeShape = JSON.stringify(shape(useProgress.getState().aoxBest))
    cleanup()
    document.getElementById('root')?.remove()
    resetAppState()

    mountApp()
    pinReadable()
    finishMo2()
    const p2 = createPreset()
    openPreset(p2.id)
    switchToMox()
    openPreset(1) // the done run comes back from its park
    expect(ctrl('Reset')).toBeInTheDocument()
    flipJulian()

    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(isOffered(ctrl('Override'))).toBe(false)
    expect(JSON.stringify(shape(useProgress.getState().aoxBest))).toBe(nativeShape)
  })
})

// ── The cross-preset stats-contamination regression must stay green ───────────────────────────
// tests/presetSwitch.dom owns the "answering straight after a switch writes to the INCOMING preset
// only" case (the 500-cards-becomes-4 property). This is a lightweight restatement in this file's
// terms, so a change here that weakened the remount would fail without needing the other file open.
describe('Q11 wiring does not weaken the remount that isolates presets', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('a Blitz round played right after a switch scores only the incoming preset', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(3) // preset 1: good 3, played 4

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadable()
    switchToBlitz()
    tap(ctrl('Begin'))
    tap(screen.getByRole('button', { name: correctName(readDate()) }))
    expect(statValue('Score')).toBe('1/1') // 1, not 4 — the screen remounted onto preset 2

    openPreset(1)
    expect(statValue('Score')).toBe('3/4') // preset 1's ended round came back exactly as left, uncontaminated
  })
})

// ── Override ⇄ Undo across a preset round-trip (round 23 Q6) ───────────────────────────────────
// ★ THE OWNER'S SENTENCE, END TO END: "if you get smth wrong then override then later come back to
// that question by browsing or FROM ANOTHER PRESET or smth and undo there it shows your original red
// highlight(s)." Nothing here has to be rebuilt or stripped on the way through: the whole record is
// one bit and one stashed grid PER CARD inside the parked engine state, so it rides along with the
// round and the button reads it again on the other side.
describe('Round 23 Q6 — an overridden card comes back overridden, and still toggles', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Blitz: a browsed card overridden before the switch reads Undo after it, and restores its mark', () => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(2) // 2/3
    tap(ctrl('<')) // the second credited solve
    const card2 = readDate()
    tap(ctrl('Override')) // flip it → 1/3
    expect(statValue('Score')).toBe('1/3')
    expect(isOffered(ctrl('Undo'))).toBe(true)
    expect(dayClass(card2)).toContain('btn-override-wrong') // the credit taken away, on the grid
    // The record is IN the parked engine state — the card on screen carries its as-answered state.
    expect(readSessionRound(1, 'blitz').engine.card.answered).not.toBe(null)

    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
    expect(statValue('Score')).toBe('1/3') // the Override stands…
    expect(readDate()).toEqual(card2) // …on the same browsed card…
    expect(isOffered(ctrl('Undo'))).toBe(true) // …and the button still reads Undo for it
    tap(ctrl('Undo'))
    expect(statValue('Score')).toBe('2/3')
    expect(dayClass(card2)).toContain('btn-correct-persist') // the answer it left is back
    tap(ctrl('Override')) // …and it re-credits, as many times as the player likes
    expect(statValue('Score')).toBe('1/3')
  })

  it('MoX: a done run comes back with its reversed completing solve, and undoing it completes again', () => {
    mountApp()
    pinReadable()
    switchToMox()
    act(() => useModePrefs.getState().setAoxN('2'))
    tap(ctrl('Begin'))
    tap(screen.getByRole('button', { name: correctName(readDate()) }))
    tap(screen.getByRole('button', { name: correctName(readDate()) })) // done 2/2
    const solved = readDate()
    tap(ctrl('Override')) // take the completing solve's credit away → failed 1/2
    expect(statValue('Score')).toBe('1/2')
    expect(isOffered(ctrl('Undo'))).toBe(true)
    expect(readSessionRound(1, 'aox').engine.card.answered).not.toBe(null)

    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
    expect(statValue('Score')).toBe('1/2')
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(readDate()).toEqual(solved) // the card never left the screen, switch included
    expect(isOffered(ctrl('Undo'))).toBe(true)
    tap(ctrl('Undo'))
    expect(statValue('Score')).toBe('2/2') // the run is whole again, and done again
    expect(dayClass(solved)).toContain('btn-correct-persist')
  })
})

// ── A restored Blitz round keeps the clock it stopped on (round 22's fixer) ───────────────────
// The park used to omit the round's remaining seconds, and the screen's clock ref started at a
// hard-coded 60 — so a Per Round round of ANY length, ended by a wrong answer with time left, came
// back after a preset round-trip reading its full length, and an Override that rescued it resumed
// with a whole minute (an Undo then painted "1m 0s"). Fake timers drive rAF and performance.now in
// lockstep, so the seconds below are exact.
describe('a restored Blitz round resumes with the time it had left', () => {
  beforeEach(() => {
    resetAppState()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  const tick = (ms) => act(() => vi.advanceTimersByTime(ms))
  // The round clock's readout: the visible Blitz-time span sitting directly above the countdown bar
  // (the slider's own value readout shows a time too, and is not the clock).
  const readout = () => {
    const hits = Array.from(document.querySelectorAll('span')).filter(
      (el) =>
        !isHidden(el) &&
        /^(\d+m )?\d+s$/.test(el.textContent) &&
        el.parentElement?.nextElementSibling?.classList.contains('bar'),
    )
    if (hits.length !== 1) throw new Error(`expected one clock readout, found ${hits.length}`)
    return hits[0].textContent
  }
  const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
  // A 30-second Per Round round, sudden death, ended by a wrong answer with 24.5 seconds left.
  const endRoundWith25sLeft = () => {
    mountApp()
    pinReadable()
    act(() => {
      useModePrefs.getState().setBlitzSec(30)
      useModePrefs.getState().setBlitzAllowMistakes(false)
    })
    switchToBlitz()
    tap(ctrl('Begin'))
    tick(5500) // mid-second, so the readout (which rounds up) reads 25s whatever the frame timing
    tap(screen.getByRole('button', { name: wrongName(readDate()) }))
    expect(ctrl('Reset')).toBeInTheDocument() // ended
    expect(readout()).toBe('25s')
  }
  const roundTrip = () => {
    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1)
  }

  it('the readout comes back as it stopped, Override resumes from there, and Undo paints it back', () => {
    endRoundWith25sLeft()
    roundTrip()
    expect(ctrl('Reset')).toBeInTheDocument() // the ended round is back…
    expect(readout()).toBe('25s') // …showing the clock it stopped on, not the round length
    tap(ctrl('Override')) // credit the wrong → the round resumes
    tick(16)
    expect(readout()).toBe('25s') // from where it stopped — not 60s
    tick(10_000)
    expect(readout()).toBe('15s') // …and it is genuinely draining from there
    // Pressing again takes that card's credit back, which is a miss on a sudden-death round — so the
    // round ends again, and it ends with the clock it HAS, not the clock it had before the resume:
    // those ten seconds were real play. (Round 23 Q6 — a round only ever keeps the time it did not use.)
    tap(ctrl('Undo'))
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(readout()).toBe('15s')
  })

  it('a round parked by an earlier build (no remaining time saved) restores with the configured length', () => {
    endRoundWith25sLeft()
    const raw = JSON.parse(sessionStorage.getItem('cg-round-v1'))
    delete raw['1:blitz'].remain
    sessionStorage.setItem('cg-round-v1', JSON.stringify(raw))
    roundTrip()
    expect(ctrl('Reset')).toBeInTheDocument()
    expect(readout()).toBe('30s')
    tap(ctrl('Override'))
    tick(16)
    expect(readout()).toBe('30s') // the round's own length — never a stray 60
  })
})

// ── A parked blob the restore door cannot read (second review round, F3) ────────────────────────
// The park lives in sessionStorage, which live and staging SHARE (one origin), and which a reload
// keeps — so a blob in a shape this build cannot read is not hypothetical, and before the guard it
// threw inside the screen's mount (the engine's lazy initializer), every reload, for the whole
// browsing session. Such a blob must be dropped WHOLE — the screen's own fields too, or an "ended"
// round would sit on top of a fresh engine — reported, and the mode must come up fresh.
describe('a parked round in a shape this build cannot read', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const CORRUPT = [
    ['an engine with no history arrays', (e) => ({ ...e, stack: undefined, forwardStack: 'x' })],
    ['an engine with no date', (e) => ({ ...e, date: null })],
    ['an engine with no times', (e) => ({ ...e, stats: { ...e.stats, times: null } })],
    ['a history entry that is not a card', (e) => ({ ...e, stack: [null] })],
    ['no engine at all', () => undefined],
  ]
  it.each(CORRUPT)('%s: both timed screens come up fresh, and the slot is gone', (_, corrupt) => {
    mountApp()
    pinReadable()
    switchToBlitz()
    finishBlitzRound(1)
    const raw = JSON.parse(sessionStorage.getItem('cg-round-v1'))
    const blitz = raw['1:blitz']
    raw['1:blitz'] = { ...blitz, engine: corrupt(blitz.engine) }
    raw['1:aox'] = {
      engine: corrupt(blitz.engine),
      runPhase: 'done',
      shown: true,
      currentRunId: 1,
      prevBestSnap: null,
    }
    sessionStorage.setItem('cg-round-v1', JSON.stringify(raw))
    const p2 = createPreset()
    openPreset(p2.id)
    openPreset(1) // both screens remount and read the corrupt slots
    switchToBlitz()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(readSessionRound(1, 'blitz')).toBeNull()
    switchToMox()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(statValue('Score')).toBe('0/0')
    expect(readSessionRound(1, 'aox')).toBeNull()
  })
})
