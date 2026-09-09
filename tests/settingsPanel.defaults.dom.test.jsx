// @vitest-environment jsdom
//
// THE BEHAVIOUR NET, groups 7–9: RESET SETTINGS, FULL RESET, and THE DEFAULTS SNAPSHOT.
//
// WHY THIS FILE EXISTS. The ⚙ panel is about to be lifted out of App, and the gate on that move is
// falsifiable and absolute: this net passes with ZERO edits. So every question below is asked the
// way a USER asks it — "tap Reset Settings; what do the controls read now", "is Full Reset still
// offering itself", "what did Save actually persist" — and routed through tests/helpers/settingsPanel
// so that none of it names a component, a parent element or a class string. The three groups here
// are the ones where a plausible, tidy-looking rewrite silently changes what the user gets:
//
//   G7 — RESET SETTINGS' REACH. The settings store exposes a `resetToFactory` action that restores
//        FACTORY, and app code never calls it: App's own resetSettings uses
//        applySettings(defSettings), the user's saved personal defaults. A rewrite that reaches for
//        the store action reverts the entire saved-defaults feature, invisibly to anyone with no
//        snapshot. The case that catches it is "with personal defaults saved, one tap lands on the
//        SAVED values" — it is the whole reason this group leads.
//
//   G8 — FULL RESET, asserted as OUTCOMES and never as call order. Inside fullReset the zustand
//        writes land synchronously while the React setState calls batch, so re-ordering the
//        setStates is inert and a net pinning call order would fail a legitimate refactor. Two
//        orderings DO bite, and both are outcomes: resetModePrefs() before applyModePrefs(defPrefs)
//        (or every Full Reset silently loses the user's four saved personal prefs), and switchMode()
//        before the guide's reading position is cleared (or How to Play restores its pre-reset
//        place instead of opening at the top).
//
//   G9 — THE SNAPSHOT. Two commits with deliberately DIFFERENT shapes that a rewrite is very likely
//        to unify, because both call saveUserDefaults: the Save popup commits a snapshot frozen at
//        POPUP OPEN, while the manager writes only the four values it shows and passes the settings
//        half through byte-identical.
//
// ⚠ THIS NET PINS TODAY'S BEHAVIOUR, INCLUDING ITS QUIRKS, and nothing here is a fix. Two of the
// spec's known defects are load-bearing for this file:
//   • D4, the "dead-ish" store action — src/store/settings exports a `resetToFactory` that restores
//     FACTORY and that no app code calls. It stays exactly where it is; the case that would catch a
//     rewrite reaching for it is G7's saved-values case, and that is the whole of this file's answer
//     to it. (Round 15 renamed the action from `resetSettings`, so it no longer shares a name with
//     the panel's button — but a name is not a gate, and G7's case is still the only one.)
//   • D7, the guard asymmetry, is CLOSED as of round 14: all three ⚙ footer buttons short-circuit
//     when they would be a no-op, so a dimmed Save Defaults no longer opens its popup for a
//     keyboard or a programmatic press. Cases below whose subject is the popup therefore arrange a
//     real offer first, via makeSaveable(). G6 owns asserting the three guards as a claim.
//
// ⚠ WHAT IS NOT HERE, deliberately: the footer row's no-resize under the "Confirm?" swap. The fit
// is a no-op at width 0 (jsdom lays nothing out), so the only honest coverage is the mocked-
// measurement wiring in tests/footerFit.dom plus a device check. This file asserts the CAPTIONS
// either side of the arm and claims nothing about pixels.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useProgress } from '../src/store/progress.js'
import { useLookupHistory } from '../src/store/lookupHistory.js'
import { CHANGELOG_DOT_KEY, markUpdateDot } from '../src/changelog.js'
import { installGuideScroller } from './helpers/guideScroller.jsx'
import {
  anyModalOpen,
  appScroller,
  changelogDot,
  closeModal,
  closeSettings,
  currentMode,
  focusModalEdge,
  footerButton,
  footerCaptions,
  fullResetButton,
  fullResetState,
  isOffered,
  isSettingsOpen,
  modalButtons,
  modalCard,
  modalTabStops,
  modeMenuOpen,
  mountApp,
  offers,
  openModal,
  openSettings,
  panelEl,
  panelValues,
  pickerChosen,
  pressKey,
  queryModalCard,
  makeSaveable,
  resetAppState,
  switchState,
  tabInModal,
  tap,
  tapFooter,
  toggleSwitch,
  typeYear,
  yearValue,
  documentTheme,
  MODAL_KEYS,
} from './helpers/settingsPanel.jsx'
// The game screen. Shared with the lifecycle lane rather than defined twice — the two lanes had
// grown different answers to the same two questions; tests/helpers/modeScreen.jsx records which
// form won and why.
import { correctDayName, readDate, statValue } from './helpers/modeScreen.jsx'

// ── Local accessors ──────────────────────────────────────────────────────────────────────────
//
// What is left here answers questions no shared helper owns. Everything that DID belong to one has
// been promoted: the mode readout, the app scroller and the Changelog link's dot to
// tests/helpers/settingsPanel.jsx, the live question and the stats strip to
// tests/helpers/modeScreen.jsx. None of what remains walks a parent chain or matches a layout class.

// The shared DefaultsCard's own controls, inside whichever modal is showing it. Asked by role +
// accessible name within a helper-resolved card, so no DOM shape is encoded.
const modalSlider = (key, label) => within(modalCard(key)).getByRole('slider', { name: label })
const modalReadout = (key, label) =>
  within(modalCard(key)).getByRole('button', { name: `Edit ${label}` })
const saveCardAoxBox = () =>
  within(modalCard('save')).getByRole('textbox', { name: 'MoX Run Length' })
// The card's DIRTY-ROW accent — the visible "you changed this one" treatment, which is the only
// readout the Save card's clean/edited state has (the manager also republishes it as Close →
// Cancel + Save). Same category as isDimmed: a paint the user meets, named in one place.
const rowMarkedEdited = (el) => el.className.includes('btn-solid')
// Drag a card's slider to a value — a `change`, which is what a controlled range input sees.
const dragSlider = (key, label, value) =>
  act(() => fireEvent.change(modalSlider(key, label), { target: { value: String(value) } }))

// Whether How to Play's sections are open, by the aria-expanded each
// header publishes. tests/guideScroll.dom resolves them the same way.
const guidePanelHeaders = () => [...document.querySelectorAll('[aria-controls^="guide-panel-"]')]
const guidePanelStates = () => guidePanelHeaders().map((h) => h.getAttribute('aria-expanded'))

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────

// The four capturable mode-screen prefs (Flash speed, both Blitz timers, the MoX run length) — the
// only ones Save Defaults records and Reset Settings restores.
const CAPTURABLE = ['flashMs', 'blitzSec', 'blitzQSec', 'aoxN']
// …and the thirteen it deliberately does NOT: config the user sets on a mode screen and expects to
// keep. Full Reset returns these to factory; Reset Settings must not touch them.
const NON_CAPTURABLE = [
  'flashTimingOff',
  'flashScoringOff',
  'blitzPerQ',
  'blitzAllowMistakes',
  'blitzTimingOff',
  'aoxAllowMistakes',
  'aoxOneByOne',
  'aoxTimingOff',
  'dedType',
  'dedTimingOff',
  'dedScoringOff',
  'classicTimingOff',
  'classicScoringOff',
]
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]))
const prefs = (keys) => pick(useModePrefs.getState(), keys)
const factoryPrefs = (keys) => pick(MODE_PREFS_DEFAULTS, keys)

const DIVERGED_CAPTURABLE = { flashMs: 800, blitzSec: 90, blitzQSec: 15, aoxN: '25' }
const divergeCapturable = (v = DIVERGED_CAPTURABLE) =>
  act(() => {
    const p = useModePrefs.getState()
    p.setFlashMs(v.flashMs)
    p.setBlitzSec(v.blitzSec)
    p.setBlitzQSec(v.blitzQSec)
    p.setAoxN(v.aoxN)
  })
// Every non-capturable pref moved off its factory value, so "untouched" and "returned to factory"
// are both discriminating answers.
const divergeNonCapturable = () =>
  act(() => {
    const p = useModePrefs.getState()
    p.setFlashTimingOff(true)
    p.setFlashScoringOff(true)
    p.setBlitzPerQ(true)
    p.setBlitzAllowMistakes(false)
    p.setBlitzTimingOff(true)
    p.setAoxAllowMistakes(true)
    p.setAoxOneByOne(true)
    p.setAoxTimingOff(true)
    p.setDedType('month')
    p.setDedTimingOff(false)
    p.setDedScoringOff(true)
    p.setClassicTimingOff(false)
    p.setClassicScoringOff(true)
  })

// All fifteen settings, each moved off its factory value — the round-trip subject in G9 and the
// "one tap snaps everything back" subject in G7.
const PERSONAL_SETTINGS = {
  randomFormat: true,
  dateFormat: 'numeric-ymd',
  inputStyle: 'dots',
  rotateDots: true,
  useJulian: false,
  minY: 1600,
  maxY: 1900,
  leapChance: '75',
  janFebChance: '25',
  julianChance: '50',
  saveStats: false,
  useSystem: false,
  darkTheme: 'nebula',
  lightTheme: 'parchment',
  manualTheme: 'midnight',
}
const applySettings = (values) => act(() => useSettings.getState().applySettings(values))

describe('⚙ Reset Settings — its full reach, positive and negative (net group 7)', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('one tap returns every value the panel shows, both year boxes and the four capturable mode prefs to their defaults', () => {
    mountApp()
    openSettings()
    const atDefaults = panelValues() // the launch state, read through the panel itself
    closeSettings()
    // Move all eleven non-theme settings plus both stored themes off their defaults, and all four
    // capturable prefs with them. Use System is left ON so the panel keeps one shape throughout.
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(true)
      s.setDateFormat('numeric-ymd')
      s.setInputStyle('dots')
      s.setUseJulian(false)
      s.setMinY(1600)
      s.setMaxY(1900)
      s.setLeapChance('75')
      s.setJanFebChance('25')
      s.setJulianChance('50')
      s.setSaveStats(false)
      s.setDarkTheme('nebula')
      s.setLightTheme('parchment')
    })
    divergeCapturable()
    openSettings()
    expect(panelValues()).not.toEqual(atDefaults) // the fixture really diverged
    tapFooter('Reset Settings')
    expect(panelValues()).toEqual(atDefaults)
    expect(yearValue('min')).toBe(String(SETTINGS_DEFAULTS.minY)) // the text mirrors, not just the store
    expect(yearValue('max')).toBe(String(SETTINGS_DEFAULTS.maxY))
    expect(prefs(CAPTURABLE)).toEqual(factoryPrefs(CAPTURABLE))
  })

  it('with personal defaults saved, one tap lands on the SAVED values and never on the factory ones', () => {
    // ★ THE R3 GATE. The settings store's own `resetToFactory` action restores FACTORY and no app
    // code calls it. A rewrite that reaches for it passes every other case in this file and every
    // case in the existing suite for any user who has never saved a snapshot — and silently
    // deletes the whole saved-defaults feature for everyone who has.
    applySettings(PERSONAL_SETTINGS)
    divergeCapturable()
    mountApp()
    openSettings()
    const personalView = panelValues() // what the panel reads at the values about to be saved
    openModal('save')
    closeModal('save', 'save') // the snapshot is now the personal values
    // Send the live state all the way back to factory, so "factory" and "saved" are visibly
    // different answers and the tap has to choose between them.
    applySettings(SETTINGS_DEFAULTS)
    act(() => useModePrefs.getState().resetModePrefs())
    const factoryView = panelValues()
    expect(factoryView).not.toEqual(personalView)
    tapFooter('Reset Settings')
    expect(panelValues()).toEqual(personalView) // the SAVED values, not the factory ones
    expect(yearValue('min')).toBe(String(PERSONAL_SETTINGS.minY))
    expect(yearValue('max')).toBe(String(PERSONAL_SETTINGS.maxY))
    expect(prefs(CAPTURABLE)).toEqual(DIVERGED_CAPTURABLE)
  })

  it('leaves the snapshot, the stats, the history, the mode, the non-capturable prefs and the screen in play exactly as they were', () => {
    // The negative half of the reach, item by item — the list Reset Settings must NOT touch.
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
      s.setLeapChance('75') // the divergence that makes Reset Settings live
    })
    divergeNonCapturable()
    act(() => {
      const p = useProgress.getState()
      useLookupHistory.getState().setHistory([{ id: 'seed-1', y: 1900, m: 3, d: 4 }])
      p.setModeStats('classic', { played: 7, good: 6, streak: 3, best: 4, times: [1200] })
      p.setBlitzBest({ 'a-config': { score: 12, streak: 5, scoreRoundId: 1, streakRoundId: 1 } })
    })
    mountApp()
    // The question currently in play — a Reset Settings that remounted the screen would replace it.
    // ⚠ The lifetime stats are read from the store rather than off the strip, because this fixture
    // diverges classicScoringOff (one of the thirteen) and the strip is HIDDEN while it is on.
    const inPlay = readDate()
    const statsBefore = useProgress.getState().stats.classic
    const bestsBefore = useProgress.getState().blitzBest
    openSettings()
    openModal('save')
    closeModal('save', 'save') // a snapshot now exists
    const savedBefore = useUserDefaults.getState().saved
    act(() => useSettings.getState().setLeapChance('random')) // re-diverge so the tap is live
    tapFooter('Reset Settings')
    expect(useUserDefaults.getState().saved).toBe(savedBefore) // the snapshot itself: untouched
    expect(useProgress.getState().stats.classic).toEqual(statsBefore) // lifetime stats
    expect(useProgress.getState().blitzBest).toEqual(bestsBefore) // all-time bests
    expect(useLookupHistory.getState().history).toHaveLength(1) // Lookup history (shared, untouched anyway)
    expect(currentMode()).toBe('Classic') // the current mode
    expect(isSettingsOpen()).toBe(true) // the panel's open state
    expect(prefs(NON_CAPTURABLE)).not.toEqual(factoryPrefs(NON_CAPTURABLE)) // the thirteen
    expect(readDate()).toEqual(inPlay) // the screen never remounted: the same question is in play
  })

  it('does not close the panel', () => {
    act(() => useSettings.getState().setLeapChance('75'))
    mountApp()
    openSettings()
    tapFooter('Reset Settings')
    expect(isSettingsOpen()).toBe(true)
  })

  it('afterwards the gear reads not-modified and neither Save Defaults nor Reset Settings is offered', () => {
    act(() => useSettings.getState().setLeapChance('75'))
    divergeCapturable()
    mountApp()
    openSettings()
    expect(offers()).toMatchObject({ gear: true, saveDefaults: true, resetSettings: true })
    tapFooter('Reset Settings')
    expect(offers()).toMatchObject({ gear: false, saveDefaults: false, resetSettings: false })
  })

  it('its consequences wait for the close: the live question does not move, and a hand-restore before closing fires nothing', () => {
    // The effective defaults are a SAVED snapshot on a different year range from the live one, so
    // "the reset landed" and "the reset was applied to the question" are different observations.
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings: { ...SETTINGS_DEFAULTS, dateFormat: 'numeric-ymd', minY: 1700, maxY: 1700 },
        prefs: pick(MODE_PREFS_DEFAULTS, CAPTURABLE),
        amnesic: false,
      }),
    )
    act(() => {
      const s = useSettings.getState()
      s.setDateFormat('numeric-ymd')
      s.setMinY(1600)
      s.setMaxY(1600)
    })
    mountApp()
    const before = readDate()
    expect(before.y).toBe(1600)
    openSettings()
    tapFooter('Reset Settings') // the range is now 1700 in the store…
    expect(yearValue('min')).toBe('1700') // …and the panel says so immediately…
    expect(readDate()).toEqual(before) // …while the live question has not moved at all
    // Hand-restore everything the reset changed, then close: the close-pass compares against what
    // the panel held when it opened, so nothing is left to apply.
    act(() => {
      const s = useSettings.getState()
      s.setMinY(1600)
      s.setMaxY(1600)
    })
    closeSettings()
    expect(readDate()).toEqual(before) // the same question, down to the day
  })

  it('its theme change, by contrast, repaints the app immediately with the panel still open', () => {
    act(() => {
      const s = useSettings.getState()
      s.setUseSystem(false)
      s.setManualTheme('nebula')
    })
    mountApp()
    openSettings()
    expect(documentTheme()).toBe('nebula')
    tapFooter('Reset Settings')
    expect(isSettingsOpen()).toBe(true)
    // Use System comes back ON, and the test environment reports a LIGHT system, so the theme in
    // effect is the default light pick — a different look from the one on screen a moment ago.
    expect(documentTheme()).toBe(SETTINGS_DEFAULTS.lightTheme)
  })
})

describe('⚙ Full Reset — reach, outcomes and the two-tap machine (net group 8)', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Two real taps on the button, under whichever caption it is wearing.
  const fireFullReset = () => {
    tap(fullResetButton())
    tap(fullResetButton())
  }

  it('two taps land the app on Classic, at the top of the page, with the panel closed', () => {
    act(() => useSettings.getState().setLeapChance('75')) // diverged → Full Reset is offered
    mountApp()
    pressKey('F') // a different mode, with the page scrolled down inside it
    appScroller().scrollTop = 240
    expect(currentMode()).toBe('Flash')
    openSettings()
    fireFullReset()
    expect(currentMode()).toBe('Classic')
    expect(appScroller().scrollTop).toBe(0)
    expect(isSettingsOpen()).toBe(false)
  })

  it('afterwards the four capturable prefs hold the SAVED values while all thirteen others are back at factory', () => {
    // ★ THE R8 GATE, as an outcome rather than a call order: fullReset resets the mode prefs to
    // factory and THEN pushes the four saved ones back over that. Reversed, the user's personal
    // Flash speed / Blitz timers / AoX length are silently lost on every Full Reset.
    divergeCapturable()
    mountApp()
    openSettings()
    openModal('save')
    closeModal('save', 'save') // the four capturable prefs are now the saved defaults
    divergeCapturable({ flashMs: 1500, blitzSec: 45, blitzQSec: 8, aoxN: '50' })
    divergeNonCapturable()
    fireFullReset()
    expect(prefs(CAPTURABLE)).toEqual(DIVERGED_CAPTURABLE) // the SAVED four
    expect(prefs(NON_CAPTURABLE)).toEqual(factoryPrefs(NON_CAPTURABLE)) // the other thirteen
  })

  it('afterwards the ONE byte no offer in the panel can see — a dormant theme — is back at its default too', () => {
    // ★ THE GATE ON FULL RESET'S DELEGATED SETTINGS RESTORE. fullReset writes no settings of its
    // own — it hands the whole store, both year-box text mirrors and the four capturable prefs to
    // resetSettings and does nothing else about them. So anything that makes THAT call conditional
    // narrows Full Reset silently, and until this case nothing in 1112 tests would have noticed:
    // no other case asks Full Reset about a value "modified" is deliberately blind to. (Round 14
    // shipped exactly that guard for one review cycle, inside resetSettings rather than on the
    // button that needed it.) The value below is therefore chosen as the one "modified" cannot see
    // — it is the whole exposure.
    //
    // ⚠ RE-BLESSED (round 15) — AND THE HALF-TYPED YEAR HAD TO LEAVE THIS CASE, which is a change
    // of PREMISE and not a loosening. It used to be the second invisible byte, and round 15's first
    // change makes all four offers read the year boxes' TEXT (the owner's reversal). A typed year
    // therefore now lights `settingsModified` — so leaving it here would have set the state up so
    // that a guard keyed on `settingsModified` inside resetSettings PASSES, and this case would
    // have stopped catching the very regression it exists for. Removing it restores the bite. The
    // year's own claim moved to the case below, where it is now a claim about a VISIBLE value.
    //
    // THE STATE IS THE ONE tests/settings.dom ALREADY PINS AS LEGITIMATE: flipping Use System off
    // seeds manualTheme from what is on screen so the look never jumps, and flipping it back on
    // parks that seed as a dormant value. It diverges from the 'dusk' default and nothing in the
    // panel says so — which is the point, and why Full Reset is the only way back.
    //
    // The second ingredient is a NON-SETTINGS reason for the app not to be fresh, because Full
    // Reset asks a wider question than "has anything changed": a played Classic question is enough
    // to offer it in a state the other three offers read as pristine. Deliberately not a panel value
    // — that would light the other three and the guard under test would never bite.
    // ⚠ USED TO BE A SEEDED LOOKUP, still WOULD work (Q1, round 20 moved lookupHistory out of the
    // progress store, but the owner's later call kept it inside Full Reset's reach — see main.tsx's
    // isFullyReset, which reads `displayLookupHistory` again). Switched to a played Classic question
    // during the move and left that way rather than reverted: a mode-store freshness flag
    // (classicIsFresh, one of isFullyReset's five per-mode terms) is the same kind of "wider than
    // settings" fact this case needs, one that survives the mode component's own mount-time
    // hydration from the store the way a local useState-only fact could not — and it is one fewer
    // store this case has to reach into. Either seed proves the same claim; this file keeps the one
    // already here.
    act(() =>
      useProgress
        .getState()
        .setModeStats('classic', { played: 1, good: 1, streak: 1, best: 1, times: [1] }),
    )
    mountApp()
    openSettings()
    toggleSwitch('Use System Settings')
    toggleSwitch('Use System Settings')
    expect(useSettings.getState().manualTheme).toBe('light') // parked, and ≠ the 'dusk' default
    expect(offers()).toMatchObject({
      gear: false,
      saveDefaults: false,
      resetSettings: false,
      fullReset: true,
    })
    fireFullReset()
    expect(useSettings.getState().manualTheme).toBe(SETTINGS_DEFAULTS.manualTheme)
  })

  it('afterwards a year box left half-typed is back at its default too — the mirror Full Reset writes but never saves', () => {
    // THE YEAR HALF OF THE CASE ABOVE, split out in round 15 because the two halves stopped being
    // the same claim. A typed-but-uncommitted year is no longer invisible: it lights all four
    // offers, so Full Reset is offered here for THAT reason alone and no Lookup seed is needed.
    //
    // What it still gates is the other thing round 14 found — the two text mirrors are written by
    // resetSettings and are in NO snapshot, so Save Defaults cannot put them right and Reset
    // Settings / Full Reset are the only routes back. A restore that skipped them would leave the
    // box reading 1800 on a state that calls itself freshly launched.
    mountApp()
    openSettings()
    typeYear('min', '1800')
    expect(offers()).toMatchObject({ fullReset: true }) // the text alone is enough now
    expect(yearValue('min')).toBe('1800') // the text really is there, so the check below is not vacuous
    fireFullReset()
    // The mirrors outlive the panel — they are App state, not the panel's — so reopening is the
    // only way to read them, and it is also how the user would meet a year box left half-typed.
    openSettings()
    expect(yearValue('min')).toBe(String(SETTINGS_DEFAULTS.minY))
  })

  it('afterwards How to Play opens at the top with every section closed, even when the reset fired from a game screen', () => {
    // ★ THE SECOND LOAD-BEARING ORDERING, also as an outcome: switchMode runs before the guide's
    // saved reading position is cleared, so the position captured on the way OUT of the guide is
    // the one that gets cleared. Cleared first, the mode switch would write the old place straight
    // back and the reader would land mid-page after a reset that means "a new launch".
    act(() => useSettings.getState().setLeapChance('75'))
    const { container } = mountApp()
    pressKey('H')
    const guide = installGuideScroller(container)
    try {
      guide.setContent(3000)
      guide.scrollTo(500)
      tap(guidePanelHeaders()[0]) // open a section
      expect(guidePanelStates()).toContain('true')
      pressKey('K') // back to a game screen — the place is saved on the way out
      openSettings()
      fireFullReset()
      pressKey('H')
      expect(guide.pos()).toBe(0)
      expect(guidePanelStates().every((s) => s === 'false')).toBe(true)
    } finally {
      guide.restore()
    }
  })

  it('wipes the stats, the bests, and Lookup history for good, and returns the screen in play to its launch state', () => {
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
    })
    act(() => {
      const p = useProgress.getState()
      useLookupHistory.getState().setHistory([{ id: 'seed-1', y: 1900, m: 3, d: 4 }])
      p.setBlitzBest({ 'some-config': { score: 12, streak: 5, scoreRoundId: 1, streakRoundId: 1 } })
    })
    const view = mountApp()
    tap(screen.getByRole('button', { name: correctDayName(readDate()) }))
    expect(statValue('Score')).toBe('1/1')
    openSettings()
    fireFullReset()
    expect(statValue('Score')).toBe('0/0') // the screen came back at launch state
    expect(useProgress.getState().blitzBest).toEqual({})
    // ★ LOOKUP HISTORY IS WIPED TOO (Q1, round 20 — the owner's explicit call, overriding an earlier
    // draft of this whole feature that would have left it standing). It left the progress store for
    // its own global one, but Full Reset — unlike every OTHER button in this panel, which only ever
    // reaches the preset it was pressed in — still reaches this ONE shared list, precisely because
    // there is only one copy for any preset's Full Reset to clear. See main.tsx's fullReset, which
    // calls clearLookupHistory() explicitly for exactly this reason.
    expect(useLookupHistory.getState().history).toEqual([])
    // …and the bests stay gone across a reload: the wipe went through the persisted store, so the
    // next launch hydrates from nothing — Lookup history included, the same as the bests.
    view.unmount()
    document.getElementById('root').remove()
    mountApp()
    expect(statValue('Score')).toBe('0/0')
    expect(useLookupHistory.getState().history).toEqual([])
  })

  it('leaves the saved-defaults snapshot and a pending update mark standing', () => {
    divergeCapturable()
    markUpdateDot(CHANGELOG_DOT_KEY) // news the user has not read yet
    mountApp()
    openSettings()
    openModal('save')
    closeModal('save', 'save')
    const savedBefore = useUserDefaults.getState().saved
    expect(changelogDot()).toBe('true')
    divergeCapturable({ flashMs: 1500, blitzSec: 45, blitzQSec: 8, aoxN: '50' })
    fireFullReset()
    expect(useUserDefaults.getState().saved).toEqual(savedBefore) // restoring YOUR defaults needs them to survive
    openSettings()
    expect(footerButton('Clear Saved Defaults')).toBeInTheDocument() // still the one way back to factory
    expect(changelogDot()).toBe('true') // the update breadcrumb is not gameplay state
  })

  it('the first tap asks "Confirm?" and rings the button; the second within the window fires it', () => {
    act(() => useSettings.getState().setLeapChance('75'))
    mountApp()
    openSettings()
    expect(fullResetState()).toEqual({ caption: 'Full Reset', armed: false, offered: true })
    tap(fullResetButton())
    expect(fullResetState()).toEqual({ caption: 'Confirm?', armed: true, offered: true })
    // Only the third caption changes — the row still reads the same two words either side of it.
    // (Whether the ROW resizes is a pixel question jsdom cannot answer; see this file's header.)
    expect(footerCaptions()).toEqual(['Save Defaults', 'Reset Settings', 'Confirm?'])
    tap(fullResetButton())
    expect(isSettingsOpen()).toBe(false) // it fired
    expect(useSettings.getState().leapChance).toBe(SETTINGS_DEFAULTS.leapChance)
  })

  it('an arm left alone disarms itself after about three seconds', () => {
    act(() => useSettings.getState().setLeapChance('75'))
    mountApp()
    openSettings()
    vi.useFakeTimers()
    tap(fullResetButton())
    expect(fullResetState().caption).toBe('Confirm?')
    act(() => vi.advanceTimersByTime(2500))
    expect(fullResetState().caption).toBe('Confirm?') // still inside the window
    act(() => vi.advanceTimersByTime(600))
    expect(fullResetState()).toMatchObject({ caption: 'Full Reset', armed: false })
    expect(useSettings.getState().leapChance).toBe('75') // and it did NOT fire on the way out
  })

  it('closing the panel disarms it, by every route, and it is not still armed on reopen', async () => {
    for (const via of ['gear', 'key', 'escape', 'outside', 'back']) {
      resetAppState()
      act(() => useSettings.getState().setLeapChance('75'))
      const view = mountApp()
      openSettings()
      tap(fullResetButton())
      expect(fullResetState().caption).toBe('Confirm?')
      await closeSettings(via)
      expect(isSettingsOpen()).toBe(false)
      openSettings()
      expect(fullResetState()).toMatchObject({ caption: 'Full Reset', armed: false })
      expect(useSettings.getState().leapChance).toBe('75') // nothing fired on the way through
      view.unmount()
      document.getElementById('root').remove()
    }
  })

  it('a press anywhere else disarms it — and that press still does its own job on the same tap', () => {
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
    })
    mountApp()
    openSettings()
    const JULIAN = 'Julian Calendar (pre-Oct 15, 1582)'
    // (a) another control inside the same panel
    tap(fullResetButton())
    expect(fullResetState().caption).toBe('Confirm?')
    const before = switchState(JULIAN)
    toggleSwitch(JULIAN)
    expect(fullResetState().caption).toBe('Full Reset') // disarmed…
    expect(switchState(JULIAN)).not.toBe(before) // …and the switch still flipped
    toggleSwitch(JULIAN) // put it back
    // (b) a game answer behind the panel. That press is OUTSIDE the card, so the panel's own
    // click-outside rule closes it on the same gesture — the arm has to be gone when it reopens.
    tap(fullResetButton())
    expect(fullResetState().caption).toBe('Confirm?')
    tap(screen.getByRole('button', { name: correctDayName(readDate()) }))
    expect(statValue('Score')).toBe('1/1') // the answer still counted
    expect(isSettingsOpen()).toBe(false)
    openSettings()
    expect(fullResetState()).toMatchObject({ caption: 'Full Reset', armed: false })
    expect(useSettings.getState().minY).toBe(1583) // and nothing ever fired
  })

  // ★ ADDED IN ROUND 14's REVIEW PASS, and the only case in this file that is not pre-move
  // behaviour pinned before the fact — because it turned out nothing pinned this at all. The panel
  // carries a safety net for "the app becomes fully reset while Full Reset is armed", inherited
  // with a comment calling it unreachable. It is not unreachable: the site-wide disarm listener
  // watches mousedown/touchstart only, so ACTIVATING Reset Settings by keyboard leaves the arm
  // standing, and if the rest of the app was already fresh then settings landing on default is the
  // last of isFullyReset's thirteen terms (briefly twelve mid-round-20, when an earlier draft of
  // Q1 dropped `displayLookupHistory.length===0` on the assumption Full Reset would stop reaching
  // it — the owner's later call put the term back; see main.tsx's isFullyReset). The net had no
  // case here, so when the safety net was
  // rewritten (from a setState-in-effect to a during-render adjustment) 1113 green cases said
  // nothing either way. This case is what says it: without the net it reads "Confirm?".
  it('an arm does not outlive the app becoming fully reset, even with no press to disarm it', () => {
    act(() => useSettings.getState().setLeapChance('75'))
    mountApp()
    openSettings()
    tap(fullResetButton())
    expect(fullResetState()).toMatchObject({ caption: 'Confirm?', armed: true })
    // click with NO mousedown — how a keyboard Enter (or any programmatic press) arrives, and the
    // one route the disarm listener cannot see.
    act(() => fireEvent.click(footerButton('Reset Settings')))
    expect(useSettings.getState().leapChance).toBe(SETTINGS_DEFAULTS.leapChance)
    // Full Reset is now a no-op and says so: not armed, and no longer offered.
    expect(fullResetState()).toMatchObject({ caption: 'Full Reset', armed: false, offered: false })
  })
})

describe('⚙ The defaults snapshot — Save, the manager, Clear (net group 9)', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Save the live state as the personal defaults, through the real popup.
  const saveSnapshot = () => {
    openModal('save')
    closeModal('save', 'save')
  }

  it('the Save popup opens seeded from the live mode screens, clean, with the run length already clamped', () => {
    divergeCapturable({ flashMs: 800, blitzSec: 90, blitzQSec: 15, aoxN: '007' })
    mountApp()
    openSettings()
    openModal('save')
    expect(modalSlider('save', 'Flash Speed').value).toBe('800')
    expect(modalSlider('save', 'Blitz Round Timer').value).toBe('90')
    expect(modalSlider('save', 'Blitz Question Timer').value).toBe('15')
    expect(saveCardAoxBox().value).toBe('7') // '007' arrives in its committed form
    // Nothing is marked edited: a freshly seeded copy has no dirty rows to explain.
    expect(rowMarkedEdited(saveCardAoxBox())).toBe(false)
    for (const label of ['Flash Speed', 'Blitz Round Timer', 'Blitz Question Timer'])
      expect(rowMarkedEdited(modalReadout('save', label))).toBe(false)
  })

  it('editing the popup never touches the live mode screens — before Save or after it', () => {
    divergeCapturable()
    mountApp()
    openSettings()
    openModal('save')
    dragSlider('save', 'Flash Speed', 1200)
    expect(rowMarkedEdited(modalReadout('save', 'Flash Speed'))).toBe(true) // the edit landed
    expect(useModePrefs.getState().flashMs).toBe(DIVERGED_CAPTURABLE.flashMs) // …in the pending copy only
    closeModal('save', 'save')
    expect(useModePrefs.getState().flashMs).toBe(DIVERGED_CAPTURABLE.flashMs) // still the live value
    expect(useUserDefaults.getState().saved.prefs.flashMs).toBe(1200) // the snapshot took the edit
  })

  it('Save persists the panel as it was when the popup OPENED, not as it is at the moment of Save', () => {
    // ★ THE FREEZE. Both commits call saveUserDefaults, which is exactly why a rewrite wants to
    // unify them — and a version that re-reads the store at commit time passes every existing test
    // in the suite.
    divergeCapturable()
    mountApp()
    openSettings()
    openModal('save') // the panel half is captured HERE
    act(() => useSettings.getState().setLeapChance('75'))
    expect(pickerChosen('Leap Year Chance')).toEqual(['75%']) // the live panel really did change
    closeModal('save', 'save')
    expect(useUserDefaults.getState().saved.settings.leapChance).toBe(SETTINGS_DEFAULTS.leapChance)
  })

  it('all fifteen settings round-trip through a saved snapshot', () => {
    applySettings(PERSONAL_SETTINGS)
    mountApp()
    openSettings()
    const personalView = panelValues()
    saveSnapshot()
    expect(useUserDefaults.getState().saved.settings).toEqual(PERSONAL_SETTINGS)
    // …and the round trip is completed through the panel, not just read out of the store: send
    // everything back to factory, then ask the defaults to restore it.
    applySettings(SETTINGS_DEFAULTS)
    expect(panelValues()).not.toEqual(personalView)
    tapFooter('Reset Settings')
    expect(panelValues()).toEqual(personalView)
  })

  it('every dismissal route discards the pending edits and leaves both live stores alone', async () => {
    divergeCapturable()
    mountApp()
    for (const via of ['dismiss', 'scrim', 'escape', 'back', 'panel']) {
      if (!isSettingsOpen()) openSettings()
      openModal('save')
      dragSlider('save', 'Flash Speed', 1200)
      await closeModal('save', via)
      expect(queryModalCard('save')).toBeNull()
      expect(useUserDefaults.getState().saved).toBeNull() // nothing was committed
      expect(useModePrefs.getState().flashMs).toBe(DIVERGED_CAPTURABLE.flashMs)
      if (!isSettingsOpen()) openSettings()
      openModal('save')
      expect(modalSlider('save', 'Flash Speed').value).toBe(String(DIVERGED_CAPTURABLE.flashMs))
      await closeModal('save', 'dismiss')
    }
  })

  it('View Saved Defaults and Clear Saved Defaults are both always there; Clear dims and locks until something is saved (round-20 Q5)', () => {
    divergeCapturable()
    mountApp()
    openSettings()
    expect(footerButton('View Saved Defaults')).toBeInTheDocument()
    expect(footerButton('Clear Saved Defaults')).toBeInTheDocument() // mounted, not absent
    expect(offers()).toMatchObject({ gear: true }) // sanity: the fixture really diverged
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false) // nothing saved yet
    openModal('manage')
    expect(modalCard('Default settings')).toBeInTheDocument() // the FACTORY view, said out loud
    closeModal('manage')
    saveSnapshot()
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(true)
    openModal('manage')
    expect(modalCard('Your saved defaults')).toBeInTheDocument()
  })

  it('the manager rests read-only and becomes an action card on the first edit', () => {
    divergeCapturable()
    mountApp()
    openSettings()
    saveSnapshot()
    openModal('manage')
    expect(modalButtons('manage')).toContain('Close')
    expect(modalButtons('manage')).not.toContain('Save')
    expect(
      within(modalCard('manage')).getByText(
        'Every ⚙ menu setting is also part of the snapshot, captured as it was when you saved.',
      ),
    ).toBeInTheDocument()
    dragSlider('manage', 'Flash Speed', 1200)
    expect(modalButtons('manage')).toEqual(expect.arrayContaining(['Cancel', 'Save']))
    expect(modalButtons('manage')).not.toContain('Close')
    expect(
      within(modalCard('manage')).getByText('Saving here updates only these values.'),
    ).toBeInTheDocument()
  })

  it("the manager's Save writes only the four values it shows, and from the factory view it creates the snapshot", () => {
    applySettings({ ...SETTINGS_DEFAULTS, leapChance: '75', minY: 1600 })
    divergeCapturable()
    mountApp()
    openSettings()
    saveSnapshot()
    const settingsBefore = useUserDefaults.getState().saved.settings
    act(() => useSettings.getState().setLeapChance('random')) // a re-capture would show up here
    openModal('manage')
    dragSlider('manage', 'Flash Speed', 1200)
    closeModal('manage', 'save')
    expect(useUserDefaults.getState().saved.prefs.flashMs).toBe(1200) // the shown value landed
    expect(useUserDefaults.getState().saved.prefs.blitzSec).toBe(DIVERGED_CAPTURABLE.blitzSec)
    expect(useUserDefaults.getState().saved.settings).toEqual(settingsBefore) // byte-identical
    // And from the FACTORY view, the same Save creates a snapshot that never existed.
    act(() => useUserDefaults.getState().clearDefaults())
    openModal('manage')
    dragSlider('manage', 'Blitz Round Timer', 75)
    closeModal('manage', 'save')
    expect(useUserDefaults.getState().saved.prefs.blitzSec).toBe(75)
    expect(useUserDefaults.getState().saved.settings).toEqual(SETTINGS_DEFAULTS)
  })

  it('Clear forgets the snapshot and nothing else — no setting moves, but every offer can flip in the same moment', () => {
    applySettings({ ...SETTINGS_DEFAULTS, leapChance: '75' })
    divergeCapturable()
    mountApp()
    openSettings()
    saveSnapshot() // live == saved → there is nothing to save, reset or fully reset
    const shown = panelValues()
    expect(offers()).toMatchObject({ gear: false, saveDefaults: false, resetSettings: false })
    openModal('clear')
    tap(within(modalCard('clear')).getByRole('button', { name: 'Clear' }))
    expect(useUserDefaults.getState().saved).toBeNull()
    expect(panelValues()).toEqual(shown) // not one visible setting moved…
    // …but "default" now means factory, so the same live state is suddenly a divergence.
    expect(offers()).toMatchObject({ gear: true, saveDefaults: true, resetSettings: true })
    // Round-20 Q5: the link stays MOUNTED — it dims and locks rather than disappearing.
    expect(
      within(panelEl()).getByRole('button', { name: 'Clear Saved Defaults' }),
    ).toBeInTheDocument()
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false)
  })

  it('a snapshot saved before a setting existed reads factory for it, and never strands the gear lit', () => {
    // A legacy payload: the saver never saw julianChance, so the effective defaults forward-merge
    // the factory value under it. Without that merge the comparison reads `undefined` forever and
    // the gear can never be cleared by any affordance the panel has.
    const legacy = { ...SETTINGS_DEFAULTS }
    delete legacy.julianChance
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings: legacy,
        prefs: pick(MODE_PREFS_DEFAULTS, CAPTURABLE),
      }),
    )
    mountApp()
    openSettings()
    expect(pickerChosen('Julian Chance')).toEqual(['Random']) // the factory value, not blank
    expect(offers()).toMatchObject({ gear: false, saveDefaults: false, resetSettings: false })
    act(() => useSettings.getState().setJulianChance('50'))
    expect(offers().gear).toBe(true)
    tapFooter('Reset Settings')
    expect(offers().gear).toBe(false) // the gear can still be cleared
  })

  it('each modal takes the keyboard on open and cycles it at both ends, without opening the mode menu behind it', () => {
    // ⚠ THE TRAVERSAL HAS TO START ON AN END OF THE CYCLE, and getting that wrong is how this case
    // first shipped saying nothing at all. jsdom implements no native tab navigation, and the
    // scrim's trap only acts at the two ENDS or on a press from outside its tree — so a Tab pressed
    // with the keyboard still on the CARD moves nothing and fires no branch, and a loop asserting
    // "focus is still inside the modal" afterwards reduces to `card.contains(card)`. It passed with
    // trapModalTab deleted. Seating the keyboard on the last control and asserting the WRAP is the
    // form that fails the moment the trap is dropped or its containment check is re-scoped — which
    // matters here specifically, because all four modals move with the panel and a rewrite that
    // mis-scopes the scrim's onKeyDown ships a dialog a keyboard user can Tab straight out of.
    divergeCapturable()
    mountApp()
    openSettings()
    saveSnapshot() // so the Clear link exists and the manager opens on the saved view
    makeSaveable() // …which also parks live == saved, dimming the now-inert Save Defaults (round 14, D7)
    for (const key of MODAL_KEYS) {
      if (!isSettingsOpen()) openSettings()
      openModal(key)
      expect(document.activeElement).toBe(modalCard(key))
      const stops = modalTabStops(key)
      expect(stops.length).toBeGreaterThan(0)
      // Tab off the END wraps to the front, and the press is CONSUMED. Both halves are asserted:
      // the Changelog popup holds a single Close button, so it is both ends at once and only
      // `prevented` can tell a real wrap there from a press nothing handled.
      focusModalEdge(key, 'last')
      expect(tabInModal(key).prevented).toBe(true)
      expect(document.activeElement).toBe(stops[0])
      // …and Shift+Tab off the FRONT wraps back to the end.
      focusModalEdge(key, 'first')
      expect(tabInModal(key, { shift: true }).prevented).toBe(true)
      expect(document.activeElement).toBe(stops[stops.length - 1])
      // Whatever it lands on is inside the popup and never behind it in the panel.
      expect(modalCard(key).contains(document.activeElement)).toBe(true)
      expect(panelEl().contains(document.activeElement)).toBe(false)
      pressKey('Tab') // a Tab that starts outside the trap is refused too, by App's own guard
      expect(modeMenuOpen()).toBe(false)
      expect(queryModalCard(key)).not.toBeNull()
      closeModal(key)
    }
  })

  it('Escape in a numeric field DISCARDS its edit and keeps the popup up; Escape on a slider dismisses the popup', () => {
    // ⚠ RE-BLESSED (round 15, B6). This asserted that Escape here COMMITTED through the 2–1000
    // clamp, leaving 2 in the box — the last field in the app where Escape kept an edit. It now
    // discards back to the value the field held when the keyboard entered it, matching the ⚙ Year
    // Range boxes (round 14) and the tap-to-type slider readouts beside this very field (round 2).
    // Cancel is still the discard for the whole popup; this is the discard for one field.
    // ★ WHAT THE CASE IS REALLY GUARDING IS UNCHANGED, and it is the second half of the title: the
    // press must not reach the popup's capture-phase Escape handler or App's panel one. That is
    // why the two "still standing" assertions below matter more than the value does — a field that
    // discarded correctly but took the popup down with it would be a worse regression than the one
    // this case was written for.
    makeSaveable() // round 14 (D7): a dimmed Save Defaults is inert now, so the popup needs a real offer
    mountApp()
    openSettings()
    openModal('save')
    // The seed matters: the discard target is captured on FOCUS, so the box must be focused before
    // the edit — which is also the only way a finger reaches it. 10 is the value it opens holding.
    act(() => {
      saveCardAoxBox().focus()
      fireEvent.change(saveCardAoxBox(), { target: { value: '1' } })
    })
    act(() => fireEvent.keyDown(saveCardAoxBox(), { key: 'Escape' }))
    expect(saveCardAoxBox().value).toBe('10') // DISCARDED back to the value at focus, not clamped to 2
    expect(queryModalCard('save')).not.toBeNull()
    expect(isSettingsOpen()).toBe(true)
    act(() => {
      modalSlider('save', 'Flash Speed').focus()
      fireEvent.keyDown(modalSlider('save', 'Flash Speed'), { key: 'Escape' })
    })
    expect(queryModalCard('save')).toBeNull() // a slider has no Escape semantics of its own
    expect(isSettingsOpen()).toBe(true)
  })

  it('Escape with a modal up closes only the modal and leaves the panel standing', () => {
    divergeCapturable()
    mountApp()
    openSettings()
    saveSnapshot()
    makeSaveable() // …which also parks live == saved, dimming the now-inert Save Defaults (round 14, D7)
    for (const key of MODAL_KEYS) {
      if (!isSettingsOpen()) openSettings()
      openModal(key)
      expect(anyModalOpen()).toBe(true)
      closeModal(key, 'escape')
      expect(anyModalOpen()).toBe(false)
      expect(isSettingsOpen()).toBe(true)
    }
  })

  it('G, and a mode letter, close the modal and the panel together and discard the pending snapshot', () => {
    for (const key of ['G', 'F']) {
      resetAppState()
      divergeCapturable()
      const view = mountApp()
      openSettings()
      openModal('save')
      dragSlider('save', 'Flash Speed', 1200)
      // The mode/panel shortcuts are DELIBERATELY not blocked by the modal guard. That guard now
      // covers three of App's four shortcut categories — Tab, the answer grid, and the [data-key]
      // walk — and this is the one it deliberately skips: those three OPERATE the page behind the
      // scrim, which a modal must forbid, while G and a mode letter REPLACE that page and take
      // every modal on it along. This case is what pins the difference.
      pressKey(key)
      expect(anyModalOpen()).toBe(false)
      expect(isSettingsOpen()).toBe(false)
      expect(useUserDefaults.getState().saved).toBeNull() // the pending snapshot went with it
      expect(useModePrefs.getState().flashMs).toBe(DIVERGED_CAPTURABLE.flashMs)
      view.unmount()
      document.getElementById('root').remove()
    }
  })
})
