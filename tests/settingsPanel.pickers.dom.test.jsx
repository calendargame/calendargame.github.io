// @vitest-environment jsdom
//
// ⚙ SETTINGS — THE PICKERS: every lock and its exact condition, the theme block's SHAPE change,
// and the Use-System round trip. Groups 2, 3 and 4 of the behaviour net (_settings_net_spec.md).
//
// WHY THIS FILE EXISTS. The panel is about to be lifted out of App, and the gate on that move is
// that this net passes with ZERO edits. So every question below is the user's — "is this picker
// offered", "which pill is lit", "what theme is on screen", "is the gear reporting modified" —
// asked through tests/helpers/settingsPanel. Nothing here names a DOM position, a parent element,
// a Tailwind token or a component. A test that has to be fixed on the far side of the move proves
// only that somebody made it green again.
//
// WHAT THE THREE GROUPS ARE ABOUT, and they are three genuinely different shapes:
//
//   • GROUP 2 — FOUR LOCKS, FOUR CONDITIONS. One `disabled` on the PillGroup publishes five
//     consequences at once (the dim, the group's aria-disabled, every segment's, the onChange
//     guard, and the tab stop), so they are asserted TOGETHER — a picker locked four ways out of
//     five is a real bug that a single-facet assertion cannot see. What was missing before this
//     file was the BOUNDARIES and the NEGATIVE modes: `mode==='deduction'` is the only lock driver
//     that is neither a store value nor derived from one, and five of the six modes that leave
//     Input LIVE had never been exercised.
//
//   • GROUP 3 — THE THEME BLOCK IS A SHAPE CHANGE, NOT A LOCK. Three nested PillGroups, and NONE
//     of them ever takes `disabled`. It LOOKS like a lock and is not: Use System Settings moves
//     which wrapper is NAMED (hence which one is the radiogroup) and which value each row reads
//     and writes, and nothing else. The natural "improvement" — dimming or hiding the row that
//     does not hold the pick — is a behaviour change the owner explicitly rejected, which is why
//     "neither row is EVER drawn as unavailable" is asserted in both states with a locked picker
//     alongside it as the control.
//
//   • GROUP 4 — THE USE-SYSTEM ROUND TRIP, which is one contract in two halves. The OFF flip seeds
//     the manual theme from what is ALREADY on screen, so the look never jumps; and "modified" is
//     judged only over the theme values IN EFFECT, so the round trip cannot permanently light the
//     gear. Both halves have to hold together — comparing the dormant value instead is a bug that
//     shipped once, and the accepted cost of the fix (a dormant divergence the panel offers no way
//     to reach) is pinned here deliberately so a future rewrite cannot quietly "fix" it back.
//
// WHAT THIS FILE DELIBERATELY DOES NOT CLAIM. jsdom has no layout engine, so "the panel's height
// does not change when Use System is flipped" is a DEVICE CHECK — what is asserted here is the row
// count and the pills, which is the structural half of that promise and all of it that is
// reachable. Nothing below implies the pixel half is covered.
//
// ── WHY GROUPS 3 AND 4 ARE SHORTER THAN THE SPEC'S CASE LIST (dedup pass, round 14) ───────────
// Eleven cases that were written here first turned out to RESTATE cases tests/settings.dom already
// carried, and — this is the part that made them removable rather than merely redundant — those
// existing versions had themselves been rewritten onto tests/helpers/settingsPanel earlier in this
// round, so they survive the extraction with zero edits exactly as these did. Keeping both bought
// nothing but suite runtime. Each pair was read in full and the STRONGER one kept; in all eleven
// that was settings.dom's, because those assert the STORE value alongside what the panel shows and
// several assert an intermediate state this file skipped (see settings.dom ~155, ~182, ~204, ~245,
// ~256, ~269, ~294, ~448, ~501, ~692, ~741).
//
// WHAT WAS DELIBERATELY NOT REMOVED, because it is not a restatement — the near-misses are worth
// naming so nobody "finishes the job" later: G2.3 is the only case anywhere that asserts the Date
// Format captions are NOT dimmed while the picker is live (settings.dom asserts only the locked
// half, so a permanently-dimmed caption would pass it); G2.7 is the only case that touches the
// 1581/1582/1583 boundary the Julian Chance lock turns on (settings.dom uses 1900 and 1, which a
// `>` -for- `>=` slip clears); and G2.9 sweeps all four lockable pickers and asserts the arrow is
// preventDefault-ed, where settings.dom asks one picker and asserts only that it never reaches the
// window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import {
  mountApp,
  openSettings,
  closeSettings,
  isSettingsOpen,
  resetAppState,
  installSystemColorScheme,
  caption,
  rowPills,
  rowChosen,
  pickerChosen,
  expectLock,
  tabStopLabel,
  otherPillName,
  drawnUnavailable,
  pickPill,
  arrowPicker,
  LOCKABLE_PICKERS,
  settingSwitch,
  switchState,
  toggleSwitch,
  isOffered,
  typeYear,
  commitYear,
  yearValue,
  documentTheme,
  offers,
  openModal,
  closeModal,
} from './helpers/settingsPanel.jsx'

// The Julian switch's setting name is long enough that spelling it inline at a dozen call sites
// would be the thing most likely to drift. One constant, the panel's own wording verbatim.
const JULIAN_SWITCH = 'Julian Calendar (pre-Oct 15, 1582)'
const USE_SYSTEM = 'Use System Settings'

// ── Local compositions. Every one of these is built ONLY out of the panel helper's exports; none
// reaches past the abstraction. They live here because they are this file's questions.
//
// Three that used to live here — expectLock (the whole-lock assertion), tabStopLabel and
// otherPillName — have been promoted into tests/helpers/settingsPanel.jsx and are imported above.
// expectLock in particular was the THIRD copy of its idea: tests/settings.dom carried a private
// four-facet version, and the reconciled export keeps the five-facet form this file had.

// COMMIT a year range through the two boxes, as a user would — type, then Enter.
//
// It writes min→1, then max, then min, and the detour through 1 is required rather than tidy: each
// box CLAMPS against the other box's live committed value (commitMin caps at maxY, commitMax
// floors at minY), so raising the min above the standing max, or lowering the max below the
// standing min, silently lands somewhere else. Opening the range to the bottom first makes every
// (min ≤ max) pair reachable in three commits with no clamp in the way.
function commitRange(min, max) {
  for (const [which, value] of [
    ['min', 1],
    ['max', max],
    ['min', min],
  ]) {
    typeYear(which, String(value))
    // Enter, not blur: Enter is a keydown the app handles directly, so it commits whether or not
    // the box happens to hold focus.
    commitYear(which, 'enter')
  }
}

// A mode change made the way a user makes one — the mode letter, which also closes the panel — and
// then reopening it. The pairing is the point: `mode` is read LIVE by the Input lock, but the only
// route that changes it also dismisses the panel, so "check the lock in mode X" is always two
// gestures.
const goMode = (mode) => {
  closeSettings('modeKey', { mode })
  openSettings()
}
// The same for How to Play, which H toggles — and it reopens by the GEAR, exactly like goMode, so
// the two legs of G2.1 are the same gesture asked in different places.
//
// ⚠ THAT USED TO BE IMPOSSIBLE, and the fix was a helper one. The guide is a real screen once you
// are on it, and it carries a collapsible section titled "Settings Overview" whose header is a
// real button — so the panel helper's gear(), which matched /^Settings/, resolved to TWO elements
// and threw while How to Play was up. This file worked around it by reopening with the G key. The
// matcher is now anchored at both ends of the word (/^Settings( \(|$)/, admitting exactly the four
// names the gear can wear), so the gear is reachable from inside the guide and the workaround is
// gone. Nothing about the app was ever wrong here.
const goGuide = () => {
  closeSettings('guideKey')
  openSettings()
}

const standUp = () => {
  mountApp()
  openSettings()
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// GROUP 2 — every picker lock and its exact condition
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('⚙ Settings → the picker locks and their exact conditions', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // G2.1 — the ONLY lock driver that is not a store value. The condition is `mode==='deduction'`
  // exactly, and five of the six modes that leave Input live had never been exercised: a rewrite
  // that reached for "not a weekday mode" or "a game mode" would pass every test that existed.
  // ★ INPUT AND DOT LAYOUT SHARE THAT ONE CONDITION — the two describe one subject, the weekday dot
  // input, which Deduction does not have — so both are walked through every mode HERE rather than
  // one being spot-checked elsewhere. The pair is the point: they were written to lock together, and
  // the failure worth catching is one of them drifting off the condition while the other still
  // satisfies every case that names it. Q3 (round 20) made Rotate Dots CCW a SWITCH rather than a
  // picker, so it is read through isOffered here rather than expectLock — a different assertion for
  // the same claim, and the reason this walk cannot simply loop a shared name list any more.
  // ⚠ DOT LAYOUT CARRIES A SECOND LOCK — Input on Buttons, where there are no dots to turn; its
  // exact condition, and its full aria-disabled/dim contract, are pinned in tests/dotOrientation.dom
  // with the rest of that setting's story, rather than copied here. This walk therefore chooses
  // DOTS first: without that the switch is locked in all seven modes and the case would pass while
  // saying nothing about the MODE lock at all.
  it('Input and Rotate Dots CCW are live in every mode except Deduction', () => {
    standUp()
    pickPill('Input', 'Dots')
    const both = (locked) => {
      expectLock('Input', locked)
      expect(isOffered(settingSwitch('Rotate Dots CCW'))).toBe(!locked)
    }
    both(false) // classic, where the app opens
    for (const mode of ['flash', 'blitz', 'aox', 'lookup']) {
      goMode(mode)
      both(false)
    }
    goMode('deduction')
    both(true)
    goMode('classic')
    both(false)
    goGuide() // How to Play is a mode too, and it leaves both live
    both(false)
  })

  // G2.2 — REMOVED in the dedup pass, and split rather than dropped: "a lock PRESERVES the pick"
  // through the lock and the guard behind it is tests/settings.dom ~448 ('Input: live in a weekday
  // mode, locked in Deduction, value preserved'), which asks the same three questions and also
  // asserts the STORE value; "and nothing was reset on unlock" is G2.10's Input row below, which
  // additionally asserts the tab stop came back on the chosen pill. Between them nothing this case
  // said is unasserted.

  // G2.3 — Date Format's condition, plus the reason its lock sits on the wrapper that spans BOTH
  // trays: the dim has to cover the Written / Numeric captions too, or the greyed tray reads as
  // two live captions introducing dead controls.
  it('the Date Format picker locks with Random Format on, and the dim covers its captions', () => {
    standUp()
    expect(switchState('Random Format')).toBe('Off')
    expectLock('Date Format', false)
    expect(drawnUnavailable(caption('Written'))).toBe(false)
    expect(drawnUnavailable(caption('Numeric'))).toBe(false)
    toggleSwitch('Random Format')
    expect(switchState('Random Format')).toBe('On')
    expectLock('Date Format', true)
    expect(drawnUnavailable(caption('Written'))).toBe(true)
    expect(drawnUnavailable(caption('Numeric'))).toBe(true)
    toggleSwitch('Random Format')
    expectLock('Date Format', false)
    expect(drawnUnavailable(caption('Written'))).toBe(false)
    expect(drawnUnavailable(caption('Numeric'))).toBe(false)
  })

  // G2.4 — REMOVED in the dedup pass. "Leap Year Chance locks when the committed range reaches no
  // leap year" is tests/settings.dom ~501, which drives the range through the store and also
  // asserts the pick is preserved and the onChange guard holds; the same lock driven through the
  // year BOXES, which is the route a user has, is G2.10's Leap Year Chance row below
  // (commitRange(1900,1900) → locked, commitRange(1,10000) → live), with G2.8 and G2.9 standing the
  // same range up. The only thing this case owned alone was 1904 standing in for "a leap year is
  // back in range", which 10000 already does.

  // G2.5 — the third argument. rangeHasLeapYear is evaluated under the ACTIVE calendar, so the
  // Julian switch alone moves this lock with the range held perfectly still. 1500 is the cleanest
  // year to say it with: divisible by 4, so Julian grants it a February 29, and a century that is
  // not a multiple of 400, so Gregorian does not.
  it('the Leap Year Chance picker re-evaluates when the Julian switch alone flips', () => {
    standUp()
    commitRange(1500, 1500)
    expect(switchState(JULIAN_SWITCH)).toBe('On')
    expectLock('Leap Year Chance', false) // Julian: 1500 is a leap year
    toggleSwitch(JULIAN_SWITCH)
    expect(switchState(JULIAN_SWITCH)).toBe('Off')
    expectLock('Leap Year Chance', true) // Gregorian: it is not
    toggleSwitch(JULIAN_SWITCH)
    expectLock('Leap Year Chance', false)
    // …and the range never moved, which is the whole claim.
    expect(yearValue('min')).toBe('1500')
    expect(yearValue('max')).toBe('1500')
  })

  // G2.6 — REMOVED in the dedup pass. THE NEGATIVE CONTROL — Jan/Feb Chance has no lock branch at
  // all, so it stays live and operable sitting directly under a greyed-out Leap Year Chance — is
  // the second half of tests/settings.dom ~501, in the same order and driven the same way, and
  // that version asserts the store value the pick writes as well as the pill that lights.

  // G2.7 — the inclusive bounds, which are load-bearing and had never been touched at the edges.
  // Julian Chance applies only where the two calendars are BOTH in play, i.e. the range straddles
  // 1582 — and 1582 itself counts on both sides, since the reform falls inside that year.
  it('the Julian Chance picker is live only when the range straddles 1582 and the switch is on', () => {
    standUp()
    expect(switchState(JULIAN_SWITCH)).toBe('On')
    expectLock('Julian Chance', false) // the factory 1–10000 straddles it
    commitRange(1582, 1582)
    expectLock('Julian Chance', false) // both bounds inclusive, at the tightest possible range
    commitRange(1583, 10000)
    expectLock('Julian Chance', true) // one year past the reform: all Gregorian
    commitRange(1, 1581)
    expectLock('Julian Chance', true) // one year short of it: all Julian
    commitRange(1, 10000)
    expectLock('Julian Chance', false)
    toggleSwitch(JULIAN_SWITCH)
    expectLock('Julian Chance', true) // the switch off locks it whatever the range says
    commitRange(1582, 1582)
    expectLock('Julian Chance', true)
  })

  // G2.8 — ONE boolean, five consequences, asserted as a set for all four lockable pickers at
  // once. A picker locked four ways out of five is a real bug and a per-facet test cannot see it.
  // All four conditions are held simultaneously here, which is not a contrivance: Deduction with
  // Random Format on and a [1900,1900] range is a state a user can sit in.
  it('every lockable picker publishes the whole lock together, and refuses a press', () => {
    standUp()
    toggleSwitch('Random Format')
    commitRange(1900, 1900)
    goMode('deduction')
    for (const name of LOCKABLE_PICKERS) {
      expectLock(name, true)
      const before = pickerChosen(name)
      pickPill(name, otherPillName(name)) // the dim is CSS-only; jsdom does not enforce it
      expect(pickerChosen(name)).toEqual(before)
    }
  })

  // G2.9 — the half of the lock a keyboard user meets. pointer-events-none stops pointers and
  // nothing else, so a locked group has to SWALLOW the six keys it owns: App's global handler maps
  // ArrowLeft/ArrowRight to the game's history buttons, and an arrow that escaped a locked picker
  // would step the puzzle behind the open panel.
  it('a locked picker swallows the arrows instead of letting them reach the page behind it', () => {
    standUp()
    toggleSwitch('Random Format')
    commitRange(1900, 1900)
    goMode('deduction')
    const reachedTheWindow = vi.fn()
    window.addEventListener('keydown', reachedTheWindow)
    try {
      for (const name of LOCKABLE_PICKERS) {
        const before = pickerChosen(name)
        expect(arrowPicker(name, 'ArrowRight').prevented).toBe(true)
        expect(pickerChosen(name)).toEqual(before)
        expect(reachedTheWindow).not.toHaveBeenCalled()
      }
      // The control that makes the four assertions above mean something: the same key, pressed
      // outside any picker, does reach the page.
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
      expect(reachedTheWindow).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', reachedTheWindow)
    }
  })

  // G2.10 — unlocking restores exactly ONE tab stop, on the pill that is actually chosen, with no
  // interaction at all: the group's layout effect re-asserts it on the pass that clears the lock.
  // Asserted for all FOUR lockable pickers, and every pick below is deliberately NOT the first pill,
  // so "restores a tab stop" cannot pass by landing on the front of the tray.
  // ⚠ DOT LAYOUT USED TO BE A FIFTH CASE HERE, and Q3 (round 20) removed it rather than converting
  // it: it is a SWITCH now, and a switch never loses its tab stop while locked in the first place
  // (aria-disabled announces the lock; the button stays reachable so a keyboard user is told why it
  // does nothing) — so "unlocking restores the tab stop" is not a claim that shape can even make.
  // Its own preserved-value-through-a-lock claim is tests/dotOrientation.dom's, in switch terms.
  const UNLOCK_CASES = [
    {
      name: 'Input',
      pick: 'Dots',
      lock: () => goMode('deduction'),
      unlock: () => goMode('classic'),
    },
    {
      name: 'Date Format',
      pick: 'Numeric YMD',
      lock: () => toggleSwitch('Random Format'),
      unlock: () => toggleSwitch('Random Format'),
    },
    {
      name: 'Leap Year Chance',
      pick: '100%',
      lock: () => commitRange(1900, 1900),
      unlock: () => commitRange(1, 10000),
    },
    {
      name: 'Julian Chance',
      pick: '75%',
      lock: () => toggleSwitch(JULIAN_SWITCH),
      unlock: () => toggleSwitch(JULIAN_SWITCH),
    },
  ]
  UNLOCK_CASES.forEach(({ name, pick, arrange, lock, unlock }) => {
    it(`unlocking ${name} puts its one tab stop back on the chosen pill, untouched`, () => {
      standUp()
      arrange?.()
      pickPill(name, pick)
      expect(tabStopLabel(name)).toBe(pick)
      lock()
      expectLock(name, true)
      expect(tabStopLabel(name)).toBe(null) // a locked group appoints nobody
      unlock()
      expectLock(name, false)
      expect(tabStopLabel(name)).toBe(pick)
      expect(pickerChosen(name)).toEqual([pick.replace(/^(Written|Numeric) /, '')])
    })
  })

  // G2.11 — the lock is LIVE, not read at open time. A store write made from outside the panel
  // (another screen, a restore, a future sync) has to withdraw the tab stop on the same pass.
  it('a lock arriving from a store write outside the panel still withdraws the tab stop', () => {
    standUp()
    expectLock('Leap Year Chance', false)
    act(() => {
      useSettings.getState().setMinY(1900)
      useSettings.getState().setMaxY(1900)
    })
    expectLock('Leap Year Chance', true)
  })

  // G2.12 — the awkward moment: the picker locks while the keyboard is sitting on one of its own
  // pills. tabIndex -1 still permits focus, so the keyboard stays exactly where it was — and what
  // stops that being a trap is that the group goes inert rather than silent: the arrows are
  // consumed, nothing moves, and nothing escapes to the page behind.
  it('a picker that locks under the keyboard leaves it there, inert rather than silent', () => {
    standUp()
    pickPill('Leap Year Chance', '100%') // clicking a pill is how the keyboard gets into a group
    expect(document.activeElement.textContent.trim()).toBe('100%')
    act(() => {
      useSettings.getState().setMinY(1900)
      useSettings.getState().setMaxY(1900)
    })
    expectLock('Leap Year Chance', true)
    expect(document.activeElement.textContent.trim()).toBe('100%') // not stranded, not moved
    expect(arrowPicker('Leap Year Chance', 'ArrowRight').prevented).toBe(true)
    expect(pickerChosen('Leap Year Chance')).toEqual(['100%'])
    expect(document.activeElement.textContent.trim()).toBe('100%')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// GROUP 3 — the theme block is a SHAPE change, not a lock
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('⚙ Settings → the theme block changes SHAPE, never availability', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // G3.1 — REMOVED in the dedup pass. "The same two rows, with the same five pills, in BOTH states"
  // — the structural half of the panel-does-not-reflow promise — is tests/settings.dom ~155, which
  // asserts the same two label lists in the same two states and additionally checks the store flag
  // actually flipped. (The pixel half, no height change, was and remains a DEVICE CHECK.)

  // G3.2 — THE CASE THIS GROUP EXISTS FOR. Neither theme row is ever drawn as unavailable, in
  // either state — the row that does not hold the pick is not a locked control, it is a row whose
  // options simply are not the current answer. The Date Format lock alongside is the control: it
  // proves the question being asked can return true, so the four falses below are real answers and
  // not a predicate that never fires.
  it('neither theme row is ever drawn as unavailable, in either Use-System state', () => {
    standUp()
    toggleSwitch('Random Format') // a genuine lock in the same panel, as the control
    expect(drawnUnavailable(caption('Written'))).toBe(true)
    for (const state of ['On', 'Off']) {
      expect(switchState(USE_SYSTEM)).toBe(state)
      expect(drawnUnavailable(caption('Dark'))).toBe(false)
      expect(drawnUnavailable(caption('Light'))).toBe(false)
      expect(drawnUnavailable(rowPills('Dark')[0])).toBe(false)
      expect(drawnUnavailable(rowPills('Light')[0])).toBe(false)
      if (state === 'On') toggleSwitch(USE_SYSTEM)
    }
  })

  // G3.3, G3.4 and G3.5 — REMOVED in the dedup pass, all three to tests/settings.dom:
  //   • "Use System ON: the two rows are two INDEPENDENT picks and no Theme group spans them" is
  //     ~182, which asserts the same absence, the same two lit pills and the same independence,
  //     plus the pill LABELS and the two store values the picks write.
  //   • "Use System OFF: ONE Theme group spans both rows and holds a single pick, and the row
  //     without it shows no selection" is ~204, which additionally pins the five pills' ORDER
  //     across the two rows and moves the pick BACK to the light row.
  //   • "the theme tab stops collapse from two to one, and the arrows cross between the rows" is
  //     ~692 (one tab stop per group in both Use-System states, swept by name) plus ~741's second
  //     half (an arrow off the last Dark pill lands on Light and takes the selection with it).
  // Two facets those three asked that settings.dom does not — the Theme group's own aria-disabled,
  // and `offered` on the two per-row groups — are NOT a loss: every facet of a lock comes from ONE
  // `disabled` on the PillGroup, so a rewrite that locked a theme group would trip G3.2's
  // drawnUnavailable sweep first. Nothing can be dimmed-but-not-announced here.

  // G3.6 — the invisible pick. With Use System on and the OS in light mode, the Dark row is the
  // dormant half: choosing in it stores a real preference and changes nothing on screen. That is
  // the shape working as intended, and it is also why the row must not be dimmed — the setting is
  // available, it is simply not the one currently in effect.
  it('with Use System on under a light OS, a Dark-row pick changes the setting but not the screen', () => {
    const system = installSystemColorScheme({ dark: false })
    try {
      standUp()
      expect(documentTheme()).toBe('light')
      pickPill('Dark theme', 'Midnight')
      expect(rowChosen('Dark')).toEqual(['Midnight']) // the stored dark theme moved
      expect(documentTheme()).toBe('light') // …and nothing repainted
      // The proof it was stored rather than dropped: hand the OS to it and it is what appears.
      system.set(true)
      expect(documentTheme()).toBe('midnight')
    } finally {
      system.restore()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// GROUP 4 — the Use-System round trip
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('⚙ Settings → the Use-System round trip', () => {
  let system = null
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    system?.restore()
    system = null
  })

  // Saving the CURRENT panel state as the user's personal defaults, by the route a user has: the
  // footer button, then Save in the popup it opens. From then on "default" means this.
  const saveDefaults = () => {
    openModal('save')
    closeModal('save', 'save')
  }

  // G4.1a, G4.1b and G4.1c — REMOVED in the dedup pass. The whole "the look must not jump" trio —
  // the off-flip seeds the manual theme from what is ALREADY on screen, on a light system, on a
  // dark one, and after the live row has been re-picked — is tests/settings.dom ~245, ~269 and
  // ~256 respectively. Those are the STRONGER versions: each asserts the seeded store value as
  // well as the theme on the document, and the light-system one additionally pins the stale
  // manualTheme ('dusk') that the old code used to jump to, which is the whole shape of the bug.
  // The only thing this file added was installSystemColorScheme's live MediaQueryList in place of
  // a frozen stub, and G4.6 below drives that listener for real.

  // G4.2 — the way back. Turning Use System on hands the choice back to the OS, asserted on the
  // DOCUMENT rather than in the store, because the contract is about what the user is looking at.
  it('flipping Use System off and back on puts the OS-chosen theme back on screen', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    toggleSwitch(USE_SYSTEM)
    pickPill('Theme', 'Midnight')
    expect(documentTheme()).toBe('midnight')
    toggleSwitch(USE_SYSTEM)
    expect(documentTheme()).toBe('light') // the OS decides again
    expect(rowChosen('Light')).toEqual(['Light'])
  })

  // G4.3 — REMOVED in the dedup pass, and this one deserves its full note because it guards a bug
  // that actually shipped. The off-flip parks the manual theme at whatever was on screen, so after
  // an untouched round trip the STORED manual theme differs from the factory one while every
  // visible setting is back where it started; judging "modified" over the stored trio instead of
  // the pair IN EFFECT lit the gear permanently, with nothing the user could change to clear it.
  // The regression gate on that fix is tests/settings.dom ~294 ('an OFF→ON round trip leaves the
  // panel reading UNMODIFIED'), which is the stronger of the two: it asserts the INTERMEDIATE
  // state as well — offered while Use System is off, because that divergence is real — and pins
  // the parked 'light' the seed leaves behind. This file's version asserted all four offers rather
  // than one, and the four move together for any theme divergence (they share themeAtDefaults), so
  // that breadth bought nothing the ~294 case does not already discriminate.

  // G4.4a — with Use System ON, the live pair is what counts: the dark and light themes light the
  // gear, and the dormant manual theme does not.
  it('with Use System on, the live themes light the gear and the dormant manual one does not', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    expect(offers().gear).toBe(false)
    pickPill('Dark theme', 'Midnight')
    expect(offers().gear).toBe(true)
    pickPill('Dark theme', 'Dusk')
    expect(offers().gear).toBe(false)
    // The manual theme is dormant here, and the panel offers no way to move it — so this is a
    // store write, which is exactly the situation the comparison has to survive.
    act(() => useSettings.getState().setManualTheme('parchment'))
    expect(offers().gear).toBe(false)
  })

  // G4.4b — and with Use System OFF, the reverse. Measured against a saved snapshot taken in the
  // OFF state, because otherwise the switch's own divergence from its default would light the gear
  // and drown out the thing being asked.
  it('with Use System off, the manual theme lights the gear and the dormant pair does not', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    toggleSwitch(USE_SYSTEM)
    saveDefaults() // "default" now means: Use System off, manual theme light
    expect(offers().gear).toBe(false)
    pickPill('Theme', 'Parchment')
    expect(offers().gear).toBe(true)
    pickPill('Theme', 'Light')
    expect(offers().gear).toBe(false)
    act(() => useSettings.getState().setDarkTheme('nebula')) // dormant while Use System is off
    expect(offers().gear).toBe(false)
  })

  // G4.5 — THE ACCEPTED COST, and it must survive the extraction unchanged. Because only the
  // values IN EFFECT are compared, a divergence parked in a dormant value is invisible to the gear
  // and to both footer offers — and while Use System is off the panel gives the user no affordance
  // that reaches it at all. That is the deliberate price of never lighting the gear falsely, and a
  // rewrite that "fixes" it reintroduces the permanent-violet-bar bug.
  it('a dormant dark-theme divergence leaves the gear dark and both offers withheld', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    toggleSwitch(USE_SYSTEM)
    saveDefaults() // saved with Use System OFF
    toggleSwitch(USE_SYSTEM) // on…
    pickPill('Dark theme', 'Midnight') // …change the dark theme…
    toggleSwitch(USE_SYSTEM) // …and back off, which re-seeds the manual theme from the screen
    expect(switchState(USE_SYSTEM)).toBe('Off')
    expect(offers().gear).toBe(false)
    expect(offers().saveDefaults).toBe(false)
    expect(offers().resetSettings).toBe(false)
    // The divergence is real, and dormant: it reappears the moment the OS is back in charge.
    toggleSwitch(USE_SYSTEM)
    expect(rowChosen('Dark')).toEqual(['Midnight'])
  })

  // G4.6 — the OS changing its mind while the app is running. The listener behind this has never
  // been driven: the suite's standing matchMedia stub is a flat "light, forever".
  it('an OS colour-scheme change swaps the theme while Use System is on, and not while it is off', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    expect(documentTheme()).toBe('light')
    system.set(true)
    expect(documentTheme()).toBe('dusk')
    toggleSwitch(USE_SYSTEM) // the user takes over, seeded from the dark theme now on screen
    expect(documentTheme()).toBe('dusk')
    system.set(false)
    expect(documentTheme()).toBe('dusk') // the OS no longer has a say
    system.set(true)
    expect(documentTheme()).toBe('dusk')
  })

  // G4.7 — the theme is the ONE settings consequence that is not deferred to close: every other
  // change waits for the panel to be dismissed, but a theme pill repaints the app under the still
  // open panel, because the whole point of the row is to let you see what you are choosing.
  it('a theme pill repaints the app immediately, with the panel still open', () => {
    system = installSystemColorScheme({ dark: false })
    standUp()
    expect(documentTheme()).toBe('light')
    pickPill('Light theme', 'Parchment')
    expect(documentTheme()).toBe('parchment')
    expect(isSettingsOpen()).toBe(true)
  })
})
