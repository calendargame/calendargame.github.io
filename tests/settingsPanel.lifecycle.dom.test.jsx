// @vitest-environment jsdom
//
// THE ⚙ SETTINGS PANEL — ITS LIFECYCLE, groups 1, 10 and 13 of the behaviour net.
//
// WHY THIS FILE EXISTS. The panel is about to be lifted out of the 2,287-line App in
// src/main.tsx. That is a REWRITE, not a move — the panel closes over a great deal of App state —
// so the gate on it is falsifiable and absolute: THIS FILE PASSES WITH ZERO EDITS on the far side.
// Every question below is the user's ("open the panel", "did the question change", "did the press
// land"), routed through tests/helpers/settingsPanel.jsx so that not one of them names a
// component, a parent element or a Tailwind token.
//
// THE THREE GROUPS ARE ONE STORY, which is why they share a file:
//   • GROUP 1 — the panel opens and closes by every route. Eight distinct close routes, each of
//     which must produce the IDENTICAL open→close transition.
//   • GROUP 10 — that transition is what COMMITS deferred settings work, through all six
//     useSettingsCloseEffect callers. This is risk R1, the deepest silent-failure risk in the
//     extraction: a panel that hosts a useSettingsCloseEffect call and unmounts on close never
//     produces a true→false transition, so every apply-on-close stops firing and NOTHING THROWS.
//     Every existing deferral test pokes the store with useSettings.getState().setX(...) and then
//     toggles the panel; not one clicks a real control. Every case here clicks a real control.
//   • GROUP 13 — the DOM markers that carry that behaviour. They are not closures: a global
//     pointer controller and three App-level listeners resolve them LIVE, so renaming or
//     re-parenting one changes what the user gets with no code change near any handler (risk R10).
//
// ⚠ WHAT THIS FILE PINS, INCLUDING ITS QUIRKS. The net's job is to freeze what the app does TODAY
// so the extraction is provably faithful. Where a case below looks wrong, it is pinned deliberately
// and says so; the fix is a separate change made AFTER the net is green.
//
// ⚠ ONE ENVIRONMENT ARTEFACT THE CASES HAVE TO RESPECT, and it now lives where the next builder
// will meet it rather than only here: the full account is at pressDragFromGear in
// tests/helpers/settingsPanel.jsx. In short — the press-drag controller ALWAYS suppresses the
// trigger's own click, jsdom never delivers that click, so after a synthetic press-drag the arming
// is still live and the NEXT click on the gear is swallowed. A case that press-drags therefore
// never re-opens (or closes) the panel with a gear tap: it stands the app up again, or travels a
// route that is not a click.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, act, within } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import {
  makeSaveable,
  resetAppState,
  mountApp,
  openSettings,
  closeSettings,
  isSettingsOpen,
  panel,
  panelEl,
  panelScroller,
  panelScrollerCount,
  currentMode,
  gear,
  gearIndicator,
  tap,
  pressDragFromGear,
  outsideTarget,
  picker,
  pickPill,
  pickerChosen,
  footerButton,
  fullResetState,
  tapFooter,
  toggleSwitch,
  switchState,
  yearInput,
  yearValue,
  typeYear,
  commitYear,
  openModal,
  closeModal,
  modalCard,
  queryModalCard,
  modalScrim,
  anyModalOpen,
  openModeMenu,
  modeMenuOpen,
  pickMode,
  lastUpdatedText,
  changelogEntryDates,
  MODAL_KEYS,
} from './helpers/settingsPanel.jsx'
// The game screen, which is where group 10's whole subject lands. Shared rather than local: the
// defaults lane asked the same three questions and answered them differently, and the two answers
// rested on different invariants — see tests/helpers/modeScreen.jsx for which form won and why.
import { questionShape, questionText, statReadouts } from './helpers/modeScreen.jsx'

// ── Standing the app up ───────────────────────────────────────────────────────────────────────

// A FRESH APP MID-TEST, for the sweeps whose subject is what ONE gesture did to an untouched app.
// Two things force it: a gesture that also changes mode leaves the next iteration somewhere else,
// and a press-drag leaves the pointer controller's click-suppression armed (see the file header).
// So "and now the same thing by the other route" has to mean a clean start, not a continuation.
function freshApp(setup) {
  cleanup()
  document.getElementById('root')?.remove()
  resetAppState()
  setup?.()
  return mountApp()
}

// A PERSONAL DEFAULTS SNAPSHOT, seeded before the mount. Needed by every case that involves the
// 'Clear Saved Defaults' link, which the footer now always renders but leaves dimmed and locked
// until a snapshot exists (round-20 Q5) — this is what makes it reachable.
function seedSavedDefaults() {
  const prefs = useModePrefs.getState()
  useUserDefaults.getState().saveDefaults({
    settings: { ...useSettings.getState() },
    prefs: {
      flashMs: prefs.flashMs,
      blitzSec: prefs.blitzSec,
      blitzQSec: prefs.blitzQSec,
      aoxN: prefs.aoxN,
    },
    amnesic: false,
  })
}

// The panel's Date Format pills, by the accessible name that keeps the two 'MDY's apart.
const NUMERIC_YMD = 'Numeric YMD'
const NUMERIC_DMY = 'Numeric DMY'

beforeEach(() => resetAppState())
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// ── GROUP 1 — the panel opens and closes by every route ───────────────────────────────────────
//
// Eight distinct close routes, and the point of asserting them as a set is that each must produce
// the IDENTICAL transition: it is that transition, not any one gesture, that fires the six
// apply-on-close callers group 10 is about. A rewrite that special-cases one route is the most
// likely silent regression in the whole extraction, and nothing in the suite asserted any of this
// before — the G key and the gear click were used only as fixtures.
describe('the settings panel — opening and closing by every route (group 1)', () => {
  it('a gear tap opens the panel, and the next gear tap closes it once rather than toggling twice', () => {
    mountApp()
    expect(isSettingsOpen()).toBe(false)
    openSettings('gear')
    expect(isSettingsOpen()).toBe(true)
    closeSettings('gear')
    expect(isSettingsOpen()).toBe(false)
    // A gear that toggled twice per tap would land back open here, or refuse to re-open at all.
    openSettings('gear')
    expect(isSettingsOpen()).toBe(true)
  })

  it('a touch press on the gear opens the panel exactly once — the click that follows the release does not shut it again', () => {
    mountApp()
    // The gear acts on POINTERDOWN so a finger can drag straight into the panel. Nothing in the
    // suite had ever pressed the real button that way; every existing test uses a click or the G
    // key, which is the keyboard path.
    openSettings('gearPress')
    expect(isSettingsOpen()).toBe(true)
    // The browser still delivers a click after the release. It must not toggle the panel back
    // shut — one gesture, one open.
    tap(gear())
    expect(isSettingsOpen()).toBe(true)
  })

  it('the G key, every mode letter, How to Play, Escape and Android Back each close an open panel', async () => {
    const routes = [
      ['the G key', 'key'],
      ['Escape', 'escape'],
      ['Android Back', 'back'],
      ['How to Play (H)', 'guideKey'],
      ...['classic', 'flash', 'blitz', 'aox', 'deduction', 'lookup'].map((mode) => [
        `the ${mode} letter`,
        'modeKey',
        { mode },
      ]),
    ]
    mountApp()
    const closed = []
    for (const [label, via, opts] of routes) {
      openSettings('key')
      expect(isSettingsOpen()).toBe(true)
      await closeSettings(via, opts)
      closed.push(`${label}: ${isSettingsOpen()}`)
    }
    expect(closed).toEqual(routes.map(([label]) => `${label}: false`))
  })

  it('a tap on the page behind the panel closes it', () => {
    mountApp()
    openSettings()
    closeSettings('outside', { on: outsideTarget() })
    expect(isSettingsOpen()).toBe(false)
  })

  it('a press that lands on the page frame rather than on the page — the Windows scrollbar drag — leaves the panel open', () => {
    mountApp()
    openSettings()
    closeSettings('outside', { on: document.documentElement })
    expect(isSettingsOpen()).toBe(true)
    closeSettings('outside', { on: document.body })
    expect(isSettingsOpen()).toBe(true)
    // The control: the same gesture on a real page element DOES close it, so the two above are
    // being spared by the frame rule and not by a dead handler.
    closeSettings('outside', { on: outsideTarget() })
    expect(isSettingsOpen()).toBe(false)
  })

  it('a tap inside the panel leaves it open', () => {
    mountApp()
    openSettings()
    tap(panel().getByText('Year Range'))
    expect(isSettingsOpen()).toBe(true)
    tap(panelEl())
    expect(isSettingsOpen()).toBe(true)
  })

  it('picking a mode from the bar dropdown registers the pick and closes the panel', () => {
    mountApp()
    openSettings()
    // Two gestures, and the pairing is the point: opening the bar's menu from an open panel must
    // not slam the panel shut on the press that opened the menu and swallow the choice.
    openModeMenu()
    expect(modeMenuOpen()).toBe(true)
    expect(isSettingsOpen()).toBe(true)
    pickMode('Flash')
    expect(currentMode()).toBe('Flash')
    expect(isSettingsOpen()).toBe(false)
  })

  it('a tap on any settings modal scrim closes only that modal and leaves the panel up', () => {
    // ⚠ THE ROUTE HAS TO BE A REAL TAP, and it now is (the helper's `scrim` route fires mousedown
    // THEN click; it fired click alone until this was caught). The half about the modal is
    // satisfied by the click — the scrim's own onClick cancels its popup. The half about the PANEL
    // is not: the panel's click-outside rule listens on document mousedown/touchstart and never
    // sees a click at all, so a click-only route would report "panel true" by never consulting the
    // rule, and would keep reporting it with the rule's `[data-settings-modal]` carve-out deleted.
    seedSavedDefaults()
    // The snapshot leaves live == saved, so Save Defaults sits dimmed — and since round 14 closed
    // defect D7 a dimmed footer button is genuinely inert, so the Save modal is unreachable until
    // something diverges. One unrelated setting, and all four modals are reachable again.
    makeSaveable()
    mountApp()
    openSettings()
    const after = []
    for (const key of MODAL_KEYS) {
      openModal(key)
      expect(queryModalCard(key)).not.toBeNull()
      closeModal(key, 'scrim')
      after.push(`${key}: modal ${queryModalCard(key) !== null}, panel ${isSettingsOpen()}`)
    }
    expect(after).toEqual(MODAL_KEYS.map((key) => `${key}: modal false, panel true`))
  })

  it('an open panel still says the settings are modified while it stops drawing the modified bar; a closed one shows both', () => {
    mountApp()
    openSettings()
    // Diverge through a real control, so this is the state a user can actually reach.
    pickPill('Leap Year Chance', '50%')
    expect(gearIndicator().name).toBe('Settings (modified)')
    // The bar is the CLOSED gear's signal — an open gear is solid and wears no stripe.
    expect(gearIndicator().bar).toBe(false)
    closeSettings('gear')
    expect(gearIndicator().name).toBe('Settings (modified)')
    expect(gearIndicator().bar).toBe(true)
  })

  it('the gear names the panel it controls only while that panel is up', () => {
    mountApp()
    expect(gearIndicator().controls).toBeNull()
    openSettings()
    expect(gearIndicator().controls).toBe('settings-popover')
    closeSettings('gear')
    expect(gearIndicator().controls).toBeNull()
  })
})

// ── GROUP 10 — apply-on-close, driven by the panel's OWN controls ─────────────────────────────
//
// The mechanism under all of this is src/components/useSettingsCloseEffect.ts, whose wasOpenRef
// seeds from the FIRST settingsOpen it ever sees. Nothing here knows that; every case asks only
// what the user gets. But that is what breaks silently if the extracted panel ever hosts one of
// those calls, so these are the cases that have to be real: a real pill, a real switch, real
// typing, and a real close.
//
// HOW A REGENERATION IS OBSERVED, since the date itself is random: the live question is stamped
// with the date format that was in effect when it was GENERATED, so a settings change made while
// the format on screen and the format in the store DISAGREE turns "did it regenerate" into a
// deterministic question about the shape on screen.
describe('the settings panel — what a close applies (group 10)', () => {
  it('a Date Format pill leaves the live question alone until the panel closes, and then changes it exactly once', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    expect(questionShape()).toBe('numeric YMD')
    openSettings()
    pickPill('Date Format', NUMERIC_DMY)
    // Deferred: the pick is registered in the panel but the question is untouched.
    expect(pickerChosen('Date Format')).toEqual(['DMY'])
    expect(questionShape()).toBe('numeric YMD')
    closeSettings('gear')
    expect(questionShape()).toBe('numeric DMY')
    // Exactly once: a second open/close with nothing touched leaves the same question standing.
    const settled = questionText()
    openSettings()
    closeSettings('gear')
    expect(questionText()).toBe(settled)
  })

  it('a Leap Year Chance pill applies on close too', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    // Re-aim the format while the panel is CLOSED: nothing regenerates, so the question keeps the
    // shape it was stamped with and any later regeneration is visible as a shape change.
    act(() => useSettings.getState().setDateFormat('numeric-dmy'))
    expect(questionShape()).toBe('numeric YMD')
    openSettings()
    pickPill('Leap Year Chance', '50%')
    expect(questionShape()).toBe('numeric YMD')
    closeSettings('gear')
    expect(questionShape()).toBe('numeric DMY')
  })

  it('a committed year-range change applies on close, and the question lands inside the new range', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(1599)
    mountApp()
    const started = questionText()
    const startYear = Number(started.split('-')[0])
    expect(startYear).toBeGreaterThanOrEqual(1583)
    expect(startYear).toBeLessThanOrEqual(1599)
    openSettings()
    // Real typing, real commits. The upper bound goes first because each box clamps against the
    // other's live committed value.
    typeYear('max', '1700')
    commitYear('max', 'enter')
    typeYear('min', '1700')
    commitYear('min', 'enter')
    expect([yearValue('min'), yearValue('max')]).toEqual(['1700', '1700'])
    // Committed, and still deferred — the question the user is on has not moved.
    expect(questionText()).toBe(started)
    closeSettings('gear')
    expect(Number(questionText().split('-')[0])).toBe(1700)
  })

  it('the Julian Calendar switch does NOT regenerate the live question on close', () => {
    // ⚠ PINNED AS IT IS TODAY, and it contradicts the net's own spec (group 10 case 2 lists the
    // Julian switch alongside the pills that DO regenerate). The code is the authority: useJulian
    // is deliberately absent from the deferred pass's dependency list, because the live setting
    // flows straight through to the answer and the method codes — regenerating would throw away a
    // question the user is part-way through for a change that does not invalidate it.
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    act(() => useSettings.getState().setDateFormat('numeric-dmy'))
    const before = questionText()
    openSettings()
    toggleSwitch('Julian Calendar (pre-Oct 15, 1582)')
    closeSettings('gear')
    expect(questionText()).toBe(before)
    expect(questionShape()).toBe('numeric YMD')
  })

  it('a change reverted before the panel closes applies nothing', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    const before = questionText()
    openSettings()
    pickPill('Date Format', NUMERIC_DMY)
    pickPill('Date Format', NUMERIC_YMD)
    closeSettings('gear')
    expect(questionText()).toBe(before)
  })

  it('the apply lands through every close route independently', async () => {
    const routes = ['gear', 'gearPress', 'key', 'escape', 'outside', 'modeKey', 'back']
    const landed = []
    for (const via of routes) {
      freshApp(() => useSettings.getState().setDateFormat('numeric-ymd'))
      openSettings('key')
      pickPill('Date Format', NUMERIC_DMY)
      const deferred = questionShape() === 'numeric YMD'
      await closeSettings(via)
      landed.push(`${via}: deferred ${deferred}, applied ${questionShape() === 'numeric DMY'}`)
    }
    // The eighth route is the press-drag release, which STARTS on the gear: the press opens the
    // panel and the release both picks the pill and dismisses, so it is one gesture rather than
    // an open followed by a close.
    freshApp(() => useSettings.getState().setDateFormat('numeric-ymd'))
    closeSettings('dragDismiss', {
      on: () => within(panelEl()).getByRole('radio', { name: NUMERIC_DMY }),
    })
    landed.push(`dragDismiss: deferred true, applied ${questionShape() === 'numeric DMY'}`)
    expect(landed).toEqual(
      [...routes, 'dragDismiss'].map((via) => `${via}: deferred true, applied true`),
    )
  })

  it('Save Stats is the exception — it takes effect at once and never regenerates the question', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    act(() => useSettings.getState().setDateFormat('numeric-dmy'))
    const before = questionText()
    expect(statReadouts()).toEqual(['Score', 'Accuracy', 'Streak', 'Last', 'Mean', 'Median'])
    openSettings()
    toggleSwitch('Save Stats')
    // Immediate, with the panel still open: the strip stops showing what it is no longer keeping.
    expect(switchState('Save Stats')).toBe('Off')
    expect(statReadouts()).toEqual([])
    toggleSwitch('Save Stats')
    expect(statReadouts()).toEqual(['Score', 'Accuracy', 'Streak', 'Last', 'Mean', 'Median'])
    closeSettings('gear')
    expect(questionText()).toBe(before)
    expect(questionShape()).toBe('numeric YMD')
  })

  it('Reset Settings tapped inside the panel regenerates the question once, on close', () => {
    // Against a PERSONAL snapshot, because Reset Settings restores the SAVED values rather than
    // the factory ones — the difference risk R3 is about.
    useSettings.getState().setDateFormat('numeric-mdy')
    seedSavedDefaults()
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    expect(questionShape()).toBe('numeric YMD')
    openSettings()
    tapFooter('Reset Settings')
    expect(pickerChosen('Date Format')).toEqual(['MDY'])
    // Deferred like every other settings change.
    expect(questionShape()).toBe('numeric YMD')
    closeSettings('gear')
    expect(questionShape()).toBe('numeric MDY')
  })

  it('Full Reset reaches its launch state by remounting the mode screens, not by a close-fired apply', () => {
    mountApp()
    const codes = () => screen.getByRole('button', { name: /Codes$/ })
    expect(codes().textContent.trim()).toBe('Show Codes')
    tap(codes())
    expect(codes().textContent.trim()).toBe('Hide Codes')
    openSettings()
    closeSettings('fullReset')
    expect(isSettingsOpen()).toBe(false)
    expect(currentMode()).toBe('Classic')
    // The open codes panel is the mode screen's OWN state — no store write in Full Reset touches
    // it, and the deferred apply explicitly no-ops on a question the user has opened up. Its being
    // shut again is the remount, and nothing else.
    expect(codes().textContent.trim()).toBe('Show Codes')
  })
})

// ── GROUP 13 — the structural markers that carry behaviour ────────────────────────────────────
//
// These are not closures. They are DOM attributes a global pointer controller and three App-level
// listeners resolve LIVE, so renaming or re-parenting one changes user-facing behaviour with no
// code change anywhere near a handler (risk R10). jsdom cannot reproduce the GESTURES — the
// hit-test geometry, the edge-band feel — but it can drive the controller's DECISIONS end to end,
// which is what every press-drag case below does.
describe('the settings panel — the markers that carry its behaviour (group 13)', () => {
  it('the gear names the card that is actually there, and only while it is there', () => {
    mountApp()
    openSettings()
    // The pairing, not two separate facts: the press-drag controller resolves the named id LIVE to
    // decide which menu a gesture belongs to, so a gear naming an id no card carries would pair a
    // whole gesture with nothing.
    expect(panelEl().id).toBe(gearIndicator().controls)
    closeSettings('gear')
    expect(panelEl()).toBeNull()
    expect(gearIndicator().controls).toBeNull()
  })

  it('a press-drag release on a picker pill picks it and dismisses the panel, and the pick applies', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    mountApp()
    closeSettings('dragDismiss', {
      on: () => within(panelEl()).getByRole('radio', { name: NUMERIC_DMY }),
    })
    expect(isSettingsOpen()).toBe(false)
    expect(questionShape()).toBe('numeric DMY')
    // Not a click that got lost on the way out: the pick is there when the panel comes back.
    openSettings('key')
    expect(pickerChosen('Date Format')).toEqual(['DMY'])
  })

  it('a press-drag release on any footer control acts without dismissing the panel', () => {
    const cases = [
      ['Save Defaults', () => `save popup ${queryModalCard('save') !== null}`, 'save popup true'],
      // The settings were diverged before the mount, so this is a reset with something to undo.
      ['Reset Settings', () => `leap ${pickerChosen('Leap Year Chance')}`, 'leap Random'],
      ['Full Reset', () => `caption ${fullResetState().caption}`, 'caption Confirm?'],
      ['View Saved Defaults', () => `manager ${queryModalCard('manage') !== null}`, 'manager true'],
      ['Changelog', () => `changelog ${queryModalCard('changelog') !== null}`, 'changelog true'],
    ]
    const acted = []
    for (const [name, read] of cases) {
      freshApp(() => useSettings.getState().setLeapChance('50'))
      pressDragFromGear(() => footerButton(name))
      acted.push(`${name}: panel ${isSettingsOpen()}, ${read()}`)
    }
    expect(acted).toEqual(cases.map(([name, , want]) => `${name}: panel true, ${want}`))
  })

  it('a press-drag release on either year box focuses it for typing and leaves the panel open', () => {
    const focused = []
    for (const which of ['min', 'max']) {
      freshApp()
      pressDragFromGear(() => yearInput(which))
      focused.push(
        `${which}: panel ${isSettingsOpen()}, focused ${document.activeElement === yearInput(which)}`,
      )
    }
    expect(focused).toEqual(['min: panel true, focused true', 'max: panel true, focused true'])
  })

  it('the panel publishes one scroll region, inside the card and holding the list but not the footer', () => {
    mountApp()
    openSettings()
    // The controller resolves this element live as the menu's auto-scroll target and acts on the
    // FIRST it finds, so "exactly one, on this host" is the contract — a second one introduced by
    // a re-parenting would silently take the auto-scroll over and nothing would throw. ⚠ The
    // SCROLLING it enables is a device check; the controller never sees a scrollable region
    // without a layout engine.
    //
    // ⚠ Asking whether the CARD CONTAINS the scroller would be a tautology and is deliberately not
    // asked: panelScroller() finds it by querying inside the card, so that answer is true by
    // construction or the line has already thrown. The count, and the two contents claims below,
    // are the forms of the claim that can come back false.
    expect(panelScrollerCount()).toBe(1)
    expect(panelScroller().contains(picker('Date Format'))).toBe(true)
    // The footer is the card's own child, outside the scroller — which is what makes it stick
    // while the list moves under it.
    expect(panelScroller().contains(footerButton('Save Defaults'))).toBe(false)
  })

  it('every settings modal renders outside the panel card yet still counts as inside it', () => {
    seedSavedDefaults()
    makeSaveable() // round 14 (D7): the snapshot dims Save Defaults, and a dimmed button is now inert
    mountApp()
    openSettings()
    const placed = []
    for (const key of MODAL_KEYS) {
      openModal(key)
      // OUTSIDE the card in the DOM — which is precisely why a drag-release on modal content can
      // never dismiss the panel: the controller only acts on a release the menu CONTAINS.
      const outsideCard = !panelEl().contains(modalCard(key))
      // ...and INSIDE for the panel's click-outside rule, so neither the card nor its scrim
      // pulls the panel down behind it.
      tap(modalCard(key))
      const cardKeptBoth = queryModalCard(key) !== null && isSettingsOpen()
      // The scrim cancels its own modal — and only that. The panel is not "outside" it.
      tap(modalScrim(key))
      const scrimKeptPanel = queryModalCard(key) === null && isSettingsOpen()
      placed.push(`${key}: outside ${outsideCard}, card ${cardKeptBoth}, scrim ${scrimKeptPanel}`)
    }
    expect(placed).toEqual(MODAL_KEYS.map((key) => `${key}: outside true, card true, scrim true`))
  })

  it('a Tab while a settings modal is up does not open the mode menu behind it', () => {
    seedSavedDefaults()
    makeSaveable() // round 14 (D7): the snapshot dims Save Defaults, and a dimmed button is now inert
    mountApp()
    openSettings()
    const guarded = []
    for (const key of MODAL_KEYS) {
      openModal(key)
      openModeMenu()
      guarded.push(`${key}: menu ${modeMenuOpen()}, modal ${queryModalCard(key) !== null}`)
      closeModal(key, 'dismiss')
    }
    expect(guarded).toEqual(MODAL_KEYS.map((key) => `${key}: menu false, modal true`))
    // The control: with no modal up, that same Tab DOES open the menu — so the guard above is a
    // guard and not a dead gesture.
    expect(anyModalOpen()).toBe(false)
    openModeMenu()
    expect(modeMenuOpen()).toBe(true)
  })

  it('the build stamp and every changelog date follow the Date Format setting, always numerically, and re-render live', () => {
    mountApp()
    openSettings()
    // The default format is WRITTEN, and these two render numerically anyway — the numeric
    // coercion is the contract, not an accident of the default.
    expect(pickerChosen('Date Format')).toEqual(['MDY'])
    expect(lastUpdatedText()).toMatch(/^Last Updated: \d+\/\d+\/\d+ \d\d:\d\d$/)
    openModal('changelog')
    const written = changelogEntryDates()
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((d) => /^\d+\/\d+\/\d+$/.test(d))).toBe(true)
    closeModal('changelog', 'escape')

    // Live: no reopen, no reload — the stamp and the list re-render on the pick.
    pickPill('Date Format', NUMERIC_YMD)
    expect(lastUpdatedText()).toMatch(/^Last Updated: \d+-\d+-\d+ \d\d:\d\d$/)
    openModal('changelog')
    const ymd = changelogEntryDates()
    expect(ymd.length).toBe(written.length)
    expect(ymd.every((d) => /^\d+-\d+-\d+$/.test(d))).toBe(true)
  })
})
