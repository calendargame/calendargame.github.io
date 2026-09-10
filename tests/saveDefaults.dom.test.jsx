// @vitest-environment jsdom
//
// Save Defaults (Q7) + the gear "modified" indicator (Q8) — App-level behavior tests.
//
// Drives the real <App/> like a user: the ⚙ footer's Save Defaults button opens a centered
// confirmation popup (portaled to #root, rendering the shared DefaultsCard — Q5 round-6) whose
// edits touch ONLY a pending snapshot; Save makes that snapshot the EFFECTIVE defaults
// (store/userDefaults) that Reset Settings, Full Reset, the gear indicator, and the
// Save-Defaults dim all mean by "default" from then on. The pure store/helper contract is
// locked in tests/userDefaults.test.js; the manager half of the shared card lives in
// tests/viewDefaults.dom.test.jsx; visual polish (the violet bar, footer wrap) is on-device
// per the standing lesson.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { usePresets } from '../src/store/presets.js'
import { selectAmnesic } from '../src/store/amnesic.js'
import {
  mountApp,
  openSettings,
  closeSettings,
  footerButton,
  gearIndicator,
  modalCard,
  yearInput,
  isOffered,
  makeSaveable,
  resetAppState,
  switchState,
  toggleSwitch,
} from './helpers/settingsPanel.jsx'

// ── Harness helpers (tests/helpers/settingsPanel, plus this file's own) ──────
// The three footer offers are asked of the panel helper — "is the app OFFERING this?" — never of
// a class string, so what "dimmed" is spelled as stops being this file's business.
const btn = (name) => screen.getByRole('button', { name })
// Q7 round 21: Reset Settings and Full Reset confirm through the shared ConfirmModal now. Fire each
// end to end — the footer button opens the popup, the popup's own button (resolved WITHIN the
// dialog, so it never collides with the footer button of the same name) applies.
const fireResetSettings = () => {
  act(() => fireEvent.click(btn('Reset Settings')))
  act(() =>
    fireEvent.click(
      within(modalCard('resetSettings')).getByRole('button', { name: 'Reset Settings' }),
    ),
  )
}
const fireFullReset = () => {
  act(() => fireEvent.click(btn('Full Reset')))
  act(() =>
    fireEvent.click(within(modalCard('fullReset')).getByRole('button', { name: 'Full Reset' })),
  )
}
const openPopup = () => act(() => fireEvent.click(footerButton('Save Defaults')))
const popupTitle = () => screen.queryByText('Save current settings as your defaults?')
const nField = () => screen.getByRole('textbox', { name: 'MoX Run Length' })
const flashSlider = () => screen.getByRole('slider', { name: 'Flash Speed' })

describe('Save Defaults (Q7) + gear indicator (Q8)', () => {
  beforeEach(() => {
    resetAppState() // all four persisted singletons + localStorage, back to a clean baseline
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('Save → Reset Settings restores the personal panel values (store + year-range mirrors)', () => {
    useSettings.getState().setLeapChance('75')
    useSettings.getState().setMinY(1600)
    mountApp()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // capture the personal defaults
    // Diverge, then Reset Settings — it must mean the SAVED values now, not factory.
    act(() => {
      useSettings.getState().setLeapChance('random')
      useSettings.getState().setMinY(1583)
    })
    fireResetSettings()
    expect(useSettings.getState().leapChance).toBe('75')
    expect(useSettings.getState().minY).toBe(1600)
    expect(yearInput('min').value).toBe('1600') // the min-year text mirror
    // …and it is the ONLY box in the document showing 1600. This line looks redundant and is not:
    // it is the second half of the retired `getByDisplayValue('1600')`, which was a throwing,
    // ambiguity-rejecting query and so asserted uniqueness as well as presence. yearInput() names
    // its subject, which is the stronger half and the one G5 needs — but naming a subject is a
    // TRADE for uniqueness, not a superset of it, and G0 may not drop an assertion on the way past.
    expect(screen.getAllByDisplayValue('1600')).toHaveLength(1)
  })

  // ── Q7 round-6: Reset Settings now also restores the 4 mode-screen prefs (Flash speed, both Blitz
  // timers, MoX run length) — the exact mirror of Save Defaults over the 19-value unit the gear judges.
  it('Reset Settings restores the 4 mode-screen prefs to the FACTORY defaults when nothing is saved (non-capturable prefs untouched)', () => {
    const p = useModePrefs.getState()
    p.setFlashMs(800)
    p.setBlitzSec(120)
    p.setBlitzQSec(20)
    p.setAoxN('25')
    p.setBlitzPerQ(true) // non-capturable — Reset Settings must leave it (only Full Reset restores it)
    mountApp()
    openSettings()
    expect(isOffered(footerButton('Reset Settings'))).toBe(true) // a mode-screen pref diverges → the button is offered
    fireResetSettings()
    const r = useModePrefs.getState()
    expect(r.flashMs).toBe(2000)
    expect(r.blitzSec).toBe(60)
    expect(r.blitzQSec).toBe(10)
    expect(r.aoxN).toBe('10')
    expect(r.blitzPerQ).toBe(true) // non-capturable — untouched by Reset Settings
    expect(isOffered(footerButton('Reset Settings'))).toBe(false) // …and now nothing is left to reset
  })

  it('Reset Settings restores the 4 mode-screen prefs to the SAVED personal defaults when a snapshot exists', () => {
    const p = useModePrefs.getState()
    p.setFlashMs(800)
    p.setBlitzSec(120)
    p.setBlitzQSec(20)
    p.setAoxN('25')
    mountApp()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // saved prefs = { flashMs 800, blitzSec 120, blitzQSec 20, aoxN '25' }
    // Diverge every captured pref back to factory, then Reset Settings — it must mean the SAVED values.
    act(() => {
      const q = useModePrefs.getState()
      q.setFlashMs(2000)
      q.setBlitzSec(60)
      q.setBlitzQSec(10)
      q.setAoxN('10')
    })
    fireResetSettings()
    const r = useModePrefs.getState()
    expect(r.flashMs).toBe(800)
    expect(r.blitzSec).toBe(120)
    expect(r.blitzQSec).toBe(20)
    expect(r.aoxN).toBe('25')
  })

  it('Reset Settings clears a gear lit ONLY by a divergent mode-screen pref (the round-6 Q7 enable + restore mirror)', () => {
    useModePrefs.getState().setFlashMs(800)
    mountApp()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // saved.flashMs = 800; the ⚙ panel captured at its factory values
    // Return the pref to factory: the PANEL now matches the saved defaults but the pref does not —
    // exactly the case that used to strand the gear (before Q7 Reset Settings watched the panel alone).
    act(() => useModePrefs.getState().setFlashMs(2000))
    expect(gearIndicator().name).toBe('Settings (modified)')
    expect(isOffered(footerButton('Reset Settings'))).toBe(true) // OFFERED even though the panel sits at defaults
    fireResetSettings()
    expect(useModePrefs.getState().flashMs).toBe(800) // restored to the SAVED default, not factory
    expect(gearIndicator().name).toBe('Settings') // the violet bar goes out
    expect(isOffered(footerButton('Reset Settings'))).toBe(false) // nothing is left to reset
  })

  it('Save → Full Reset pushes the 4 captured prefs; the rest of modePrefs stays factory; the snapshot survives', () => {
    const p = useModePrefs.getState()
    p.setFlashMs(800)
    p.setBlitzSec(90)
    p.setBlitzQSec(15) // every captured value diverges from factory (blitzQSec launches at 10)
    p.setAoxN('25')
    p.setBlitzPerQ(true) // non-capturable — must reset to factory
    p.setDedType('month') // non-capturable — must reset to factory
    mountApp()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save')))
    // Diverge the live prefs again, then Full Reset.
    act(() => {
      useModePrefs.getState().setFlashMs(1500)
      useModePrefs.getState().setAoxN('50')
    })
    fireFullReset()
    const r = useModePrefs.getState()
    expect(r.flashMs).toBe(800)
    expect(r.blitzSec).toBe(90)
    expect(r.blitzQSec).toBe(15)
    expect(r.aoxN).toBe('25')
    expect(r.blitzPerQ).toBe(MODE_PREFS_DEFAULTS.blitzPerQ) // factory, not captured
    expect(r.dedType).toBe(MODE_PREFS_DEFAULTS.dedType) // factory, not captured
    expect(useUserDefaults.getState().saved).not.toBeNull() // Full Reset never clears the snapshot
  })

  // Q8: the Blitz/AoX visual-only timing toggles (blitzTimingOff/aoxTimingOff) are NON-capturable —
  // same family as Per Round / Allow Mistakes / the Deduction sub-type. Save Defaults never records
  // them, the gear "modified" bar never lights for them, and Full Reset returns them to factory.
  it('Q8: the Blitz/AoX visual timing toggles are excluded from Save Defaults and the gear bar, and reset by Full Reset', () => {
    const p = useModePrefs.getState()
    p.setBlitzTimingOff(true)
    p.setAoxTimingOff(true)
    mountApp()
    // A divergent visual timing pref must NOT light the gear "modified" bar (it isn't in the
    // at-defaults comparison — prefsMatchDefaults covers only the four capturable prefs).
    expect(gearIndicator().bar).toBe(false)
    // …but the popup can only be REACHED while something the panel does capture diverges (round 14,
    // D7 — a dimmed Save Defaults is now inert). Arranged after the assertion above, so the claim it
    // makes about the timing toggles is still measured against an otherwise pristine app.
    makeSaveable()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save')))
    // The saved snapshot carries ONLY the four capturable prefs — never the toggles.
    expect(useUserDefaults.getState().saved.prefs).toEqual({
      flashMs: MODE_PREFS_DEFAULTS.flashMs,
      blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
      blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
      aoxN: MODE_PREFS_DEFAULTS.aoxN,
    })
    // Saving leaves the live toggles untouched…
    expect(useModePrefs.getState().blitzTimingOff).toBe(true)
    expect(useModePrefs.getState().aoxTimingOff).toBe(true)
    // …and Full Reset returns both to their factory (shown) launch value.
    fireFullReset()
    expect(useModePrefs.getState().blitzTimingOff).toBe(false)
    expect(useModePrefs.getState().aoxTimingOff).toBe(false)
  })

  it('Full Reset honors + dims against the personal defaults — the freshness-literal rewiring', () => {
    useModePrefs.getState().setFlashMs(800)
    mountApp()
    openSettings()
    openPopup()
    act(() => fireEvent.click(btn('Save')))
    // live == saved defaults → the app ALREADY reads fully reset: the mode freshness checks
    // compare against the EFFECTIVE defaults (flashMs 800) — with the old factory literals
    // (flashMs===500) Full Reset would never dim while a personal Flash speed is active.
    expect(isOffered(footerButton('Full Reset'))).toBe(false)
    expect(isOffered(footerButton('Save Defaults'))).toBe(false) // nothing to save either
    // Diverge → it comes live; Full Reset (two-tap) restores the PERSONAL default and re-dims.
    act(() => useModePrefs.getState().setFlashMs(1500))
    expect(isOffered(footerButton('Full Reset'))).toBe(true)
    fireFullReset()
    expect(useModePrefs.getState().flashMs).toBe(800)
    openSettings()
    expect(isOffered(footerButton('Full Reset'))).toBe(false)
    expect(isOffered(footerButton('Save Defaults'))).toBe(false)
  })

  // ── Round-20 Q4: Amnesic joins the Save Defaults / Reset Settings / Full Reset contract ────────
  // Owner's explicit, confirmed decision (flagged as a real tradeoff, reaffirmed anyway): Save
  // Defaults captures whether the active preset is Amnesic at the moment of saving; Reset Settings
  // and Full Reset both restore it. Amnesic itself never lights the gear's "modified" bar (that is
  // pinned elsewhere, in tests/amnesic.dom), so every case below arranges a SEPARATE divergence to
  // make the button it presses actually offered.
  it('the Save Defaults popup captures the LIVE Amnesic value at commit — both Off and On', () => {
    mountApp()
    openSettings()
    // Off first: Amnesic starts Off and nothing else needs to diverge to prove the capture.
    makeSaveable()
    openPopup()
    act(() => fireEvent.click(btn('Save')))
    expect(useUserDefaults.getState().saved.amnesic).toBe(false)
    // Flip Amnesic On — it does not light Save Defaults on its own, so a fresh divergence is what
    // reopens the popup, not the toggle.
    toggleSwitch('Amnesic')
    expect(isOffered(footerButton('Save Defaults'))).toBe(false)
    makeSaveable()
    openPopup()
    act(() => fireEvent.click(btn('Save')))
    expect(useUserDefaults.getState().saved.amnesic).toBe(true)
  })

  it("the manager's Save passes the PREVIOUSLY SAVED Amnesic value through unchanged, never the live one", () => {
    mountApp()
    openSettings()
    toggleSwitch('Amnesic') // On
    makeSaveable()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // saved.amnesic = true
    expect(useUserDefaults.getState().saved.amnesic).toBe(true)
    toggleSwitch('Amnesic') // live flips back Off — a re-capture would show up here
    // Edit one shown row through the manager and Save — the manager's own rule (mirrors the
    // settings-byte-identical case in tests/settingsPanel.defaults.dom): it writes only what it
    // shows, never Amnesic.
    act(() => fireEvent.click(footerButton('View Saved Defaults')))
    const dialog = modalCard('Your saved defaults')
    act(() =>
      fireEvent.change(within(dialog).getByRole('slider', { name: 'Flash Speed' }), {
        target: { value: '1200' },
      }),
    )
    act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })))
    expect(useUserDefaults.getState().saved.amnesic).toBe(true) // unchanged — never re-captured
  })

  it('Reset Settings restores the saved Amnesic state onto the active preset', () => {
    mountApp()
    openSettings()
    toggleSwitch('Amnesic') // On
    makeSaveable()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // saved.amnesic = true
    toggleSwitch('Amnesic') // live diverges to Off — Reset Settings must put it back
    act(() => useSettings.getState().setLeapChance('75')) // something else, so the tap is live
    fireResetSettings()
    expect(switchState('Amnesic')).toBe('On')
    expect(selectAmnesic(usePresets.getState())).toBe(true)
  })

  it('with nothing saved, Reset Settings restores Amnesic to factory (Off)', () => {
    mountApp()
    openSettings()
    toggleSwitch('Amnesic') // live On, nothing ever saved
    act(() => useSettings.getState().setLeapChance('75')) // something capturable diverges too
    fireResetSettings()
    expect(switchState('Amnesic')).toBe('Off')
    expect(selectAmnesic(usePresets.getState())).toBe(false)
  })

  // The surprising half of this group's scope, called out on its own rather than left as inherited
  // coverage: fullReset delegates its ENTIRE settings restore to resetSettings (main.tsx's own
  // comment says so), so Amnesic rides along there too — Full Reset restores it exactly as Reset
  // Settings does, not just the footer's own middle button.
  it('Full Reset ALSO restores the saved Amnesic state (not just the Reset Settings button)', () => {
    mountApp()
    openSettings()
    toggleSwitch('Amnesic') // On
    makeSaveable()
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // saved.amnesic = true
    toggleSwitch('Amnesic') // live diverges to Off
    act(() => useSettings.getState().setLeapChance('75')) // something else, so Full Reset has work
    fireFullReset()
    expect(selectAmnesic(usePresets.getState())).toBe(true)
  })

  it('popup Cancel discards edits; Save persists the EDITED values; live stores stay untouched', () => {
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    act(() => fireEvent.change(flashSlider(), { target: { value: '1200' } }))
    act(() => fireEvent.change(nField(), { target: { value: '25' } }))
    act(() => fireEvent.click(btn('Cancel')))
    expect(useUserDefaults.getState().saved).toBeNull() // nothing saved
    expect(useModePrefs.getState().flashMs).toBe(2000) // live store never touched (factory default)
    openPopup() // re-seeded fresh from the live stores — the cancelled edits are gone
    expect(flashSlider().value).toBe('2000')
    expect(nField().value).toBe('10')
    act(() => fireEvent.change(flashSlider(), { target: { value: '1200' } }))
    act(() => fireEvent.change(nField(), { target: { value: '25' } }))
    act(() => fireEvent.click(btn('Save')))
    expect(useUserDefaults.getState().saved.prefs).toEqual({
      flashMs: 1200,
      blitzSec: 60,
      blitzQSec: 10,
      aoxN: '25',
    })
    expect(useUserDefaults.getState().saved.settings).toEqual(
      expect.objectContaining({ minY: 1, maxY: 10000 }), // panel captured as-is at open
    )
    expect(useModePrefs.getState().flashMs).toBe(2000) // saving defaults never edits live prefs
  })

  it('the popup sliders seed UNCLAMPED from live prefs beyond the pre-Round-2 maxes (ranges stay in lockstep with the mode screens)', () => {
    // The popup seeds from the LIVE stores, so its mirrors must accept every value the widened
    // mode-screen ranges can commit — a 4000ms Flash fed into a max=3000 mirror would clamp on
    // the first drag and silently corrupt the pending snapshot.
    const p = useModePrefs.getState()
    p.setFlashMs(4000) // > the old 3000 cap
    p.setBlitzSec(300) // > the old 180 cap
    p.setBlitzQSec(25) // > the old 20 cap
    mountApp()
    openSettings()
    openPopup()
    expect(flashSlider().value).toBe('4000')
    expect(screen.getByRole('slider', { name: 'Blitz Round Timer' }).value).toBe('300')
    expect(screen.getByRole('slider', { name: 'Blitz Question Timer' }).value).toBe('25')
  })

  it("the popup's N field applies the AoX validation trio (digits only, clamp on commit, Escape discards)", () => {
    // ⚠ RE-BLESSED (round 15, B6) — AND IT WAS STILL GREEN WHEN THE BEHAVIOUR CHANGED UNDER IT,
    // which is the more useful half of this note. Escape here used to normalize-COMMIT; it now
    // discards back to the value the field held when the keyboard entered it. This case went on
    // passing only because it focused the field AFTER typing, so the "value at focus" it discarded
    // to was the half-typed 1 — which then normalize-committed to 2 on the blur and matched the old
    // assertion exactly. A route no finger can take: you cannot type into a field you have not
    // focused. The focus has moved above the typing below, which is both the real order and the
    // order that makes the assertion mean what it says.
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    act(() => fireEvent.change(nField(), { target: { value: 'abc' } }))
    expect(nField().value).toBe('10') // non-digits rejected outright
    act(() => fireEvent.change(nField(), { target: { value: '' } }))
    act(() => fireEvent.blur(nField()))
    expect(nField().value).toBe('10') // empty commits to the fallback
    act(() => fireEvent.change(nField(), { target: { value: '2000' } }))
    act(() => fireEvent.keyDown(nField(), { key: 'Enter' }))
    expect(nField().value).toBe('1000') // Enter commits with the 2–1000 clamp
    // Focus first, as a real keypress implies twice over: it is what the field captures its discard
    // target from, and it is what makes the popup's document-level Escape handler skip the press
    // (that handler bails only while an input holds focus). The field's own handler then discards
    // the edit and dismisses the keyboard, NOT the popup or the panel.
    act(() => {
      nField().focus()
      fireEvent.change(nField(), { target: { value: '1' } })
    })
    act(() => fireEvent.keyDown(nField(), { key: 'Escape' }))
    expect(nField().value).toBe('1000') // discarded back to the value at focus — Enter's commit above
    expect(popupTitle()).toBeInTheDocument() // …and the popup (and panel) survived the press
    act(() => fireEvent.click(btn('Save')))
    expect(useUserDefaults.getState().saved.prefs.aoxN).toBe('1000')
  })

  it('gear indicator + Save-Defaults dim derive from ONE at-defaults comparison across both stores', () => {
    mountApp()
    expect(gearIndicator().bar).toBe(false)
    expect(gearIndicator().name).toBe('Settings')
    // Divergence in the SETTINGS store lights the gear…
    act(() => useSettings.getState().setLeapChance('75'))
    expect(gearIndicator().bar).toBe(true)
    expect(gearIndicator().name).toBe('Settings (modified)')
    act(() => useSettings.getState().setLeapChance('random'))
    expect(gearIndicator().bar).toBe(false)
    // …and so does divergence in the MODE-PREFS store (one of the 4 capturable values).
    act(() => useModePrefs.getState().setFlashMs(900))
    expect(gearIndicator().bar).toBe(true)
    openSettings()
    expect(gearIndicator().bar).toBe(false) // hidden while open (solid gear)
    expect(gearIndicator().name).toBe('Settings (modified)') // the label still tells
    expect(isOffered(footerButton('Save Defaults'))).toBe(true) // something to save
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // live == saved now
    expect(isOffered(footerButton('Save Defaults'))).toBe(false)
    // The subtle case: live returns to FACTORY but saved says 900 — that IS a divergence from
    // the effective defaults, so the button stays live (re-saving factory is meaningful).
    act(() => useModePrefs.getState().setFlashMs(2000))
    expect(isOffered(footerButton('Save Defaults'))).toBe(true)
    closeSettings() // the indicator bar shows again
    expect(gearIndicator().bar).toBe(true)
  })

  it('the popup carries NO clear link (footer-only, Round-4); the footer link clears — via its confirm — while the popup is open', () => {
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    mountApp()
    openSettings()
    openPopup()
    // Round-20 Q5: the footer link is always MOUNTED now, never absent — nothing saved yet means it
    // dims and locks instead. It still carries no popup-scoped twin, which is the rest of this case.
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false)
    act(() => fireEvent.click(btn('Save')))
    // Saving parked live == saved, which dims Save Defaults — and since round 14 (D7) a dimmed
    // Save Defaults is inert, so getting back INTO the popup takes a fresh divergence.
    makeSaveable()
    openPopup()
    // The Save Defaults popup's duplicate "(back to factory)" link was removed in Round-4 —
    // the ⚙ footer's "Clear Saved Defaults" is the ONLY clear affordance.
    const dialog = modalCard('Save current settings as your defaults?')
    expect(within(dialog).queryByRole('button', { name: /Clear Saved Defaults/ })).toBeNull()
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(true) // now reachable — a snapshot exists
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear Saved Defaults' })))
    // The link asks first now (Q5 round-6): nothing is cleared until the confirm's red-tier Clear.
    expect(useUserDefaults.getState().saved).not.toBeNull()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(useUserDefaults.getState().saved).toBeNull() // back to factory semantics
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false) // dims and locks again…
    expect(btn('Save')).toBeInTheDocument() // …and the open popup survives, still saveable
  })

  it('the ⚙ footer Clear Saved Defaults link: dimmed and locked without a snapshot, reachable at steady state (Save Defaults dimmed), clears via its confirm', () => {
    mountApp()
    openSettings()
    expect(footerButton('Clear Saved Defaults')).toBeInTheDocument() // always mounted (round-20 Q5)
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false) // …but nothing saved, so it is inert
    act(() => fireEvent.click(footerButton('Clear Saved Defaults'))) // a press against the lock is a no-op
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull() // the confirm never opened
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    act(() => fireEvent.click(btn('Save'))) // live == saved → the Save Defaults button dims…
    expect(isOffered(footerButton('Save Defaults'))).toBe(false) // …making the POPUP's clear link unreachable
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(true) // the footer link is the escape hatch
    const footerLink = screen.getByRole('button', { name: 'Clear Saved Defaults' })
    act(() => fireEvent.click(footerLink))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' }))) // through the confirm popup (Q5 round-6)
    expect(useUserDefaults.getState().saved).toBeNull() // snapshot forgotten (live settings untouched)
    expect(isOffered(footerButton('Clear Saved Defaults'))).toBe(false) // dims and locks again
  })

  it('the shared card in the Save popup: an edited row goes btn-solid; Cancel + Save always; no restricted-write note', () => {
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    const dialog = modalCard('Save current settings as your defaults?')
    // An action card even while clean — never the manager's resting Close.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    expect(nField().className).not.toContain('btn-solid')
    expect(nField().className).toContain('border surface-tray') // clean = the shared interactive surface (Q7 round-7)
    act(() => fireEvent.change(nField(), { target: { value: '25' } }))
    expect(nField().className).toContain('btn-solid') // the dirty accent on the box…
    expect(nField().className).not.toContain('surface-tray') // …swapped in for the tray surface WHOLE (NUM_INPUT_DIRTY_CLASS)
    act(() => fireEvent.change(flashSlider(), { target: { value: '1200' } }))
    expect(within(dialog).getByRole('button', { name: 'Edit Flash Speed' }).className).toContain(
      'btn-solid', // …and on the tap-to-type readouts
    )
    expect(
      within(dialog).getByRole('button', { name: 'Edit Blitz Round Timer' }).className,
    ).not.toContain('btn-solid') // per-row, not global
    expect(screen.queryByText('Saving here updates only these values.')).toBeNull() // manager-only note
  })

  it('the ⚙ Year Range pair wears the shared interactive surface (border surface-tray), never the container panel (Q7 round-7)', () => {
    // The other two NUM_INPUT_CLASS sites (the AoX mode-screen box is pinned in
    // tests/aox.dom.test.jsx; the popup box in the shared-card test above): the site-wide
    // interactive-border rule puts every editable box on the sbtn-bd control tier.
    useSettings.getState().setMinY(1600)
    useSettings.getState().setMaxY(1900)
    mountApp()
    openSettings()
    for (const [end, year] of [
      ['min', '1600'],
      ['max', '1900'],
    ]) {
      const input = yearInput(end) // the min/max text mirrors
      expect(input.value).toBe(year)
      // The uniqueness half of the retired getByDisplayValue(year) — see the same pairing above.
      expect(screen.getAllByDisplayValue(year)).toHaveLength(1)
      expect(input.className).toContain('border surface-tray')
      expect(input.className).not.toContain('panel')
    }
  })

  it('the popup is a real modal: role=dialog + aria-modal, focus moves in on open, Tab wraps inside it', () => {
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    const dialog = modalCard('Save current settings as your defaults?')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog) // focus landed IN the dialog on open
    // Tab from the LAST control wraps to the first (the N field) instead of escaping to the panel
    // under the scrim (where Enter would edit the LIVE store while Save persists the open snapshot).
    const save = btn('Save')
    act(() => {
      save.focus()
      fireEvent.keyDown(save, { key: 'Tab' })
    })
    expect(document.activeElement).toBe(nField())
    // Shift+Tab from the FIRST control wraps back to the last.
    act(() => fireEvent.keyDown(nField(), { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(save)
  })

  it('Escape closes the popup even while a slider holds focus (range inputs have no Escape semantics of their own)', () => {
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    act(() => {
      flashSlider().focus()
      fireEvent.keyDown(flashSlider(), { key: 'Escape' })
    })
    expect(popupTitle()).toBeNull() // the popup dismissed…
    expect(btn('Reset Settings')).toBeInTheDocument() // …and the panel survived (capture handler consumed the press)
  })

  it('scrim mousedown/click and Escape cancel the POPUP only; the settings panel closes on the next Escape', () => {
    mountApp()
    openSettings()
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openPopup()
    const scrim = document.querySelector('[data-settings-modal]')
    // The settings click-outside handler must treat the scrim as "inside" (mousedown path)…
    act(() => fireEvent.mouseDown(scrim))
    expect(btn('Reset Settings')).toBeInTheDocument()
    // …and a scrim CLICK cancels only the popup.
    act(() => fireEvent.click(scrim))
    expect(popupTitle()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    openPopup()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // capture-phase popup handler wins
    expect(popupTitle()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })

  it('Android Back closes the popup first, then Settings (LIFO overlay stack)', async () => {
    mountApp()
    // Flush jsdom's queued history traversals first: earlier tests' UI closes each ran
    // popOverlay's guarded history.back(), whose to-be-ignored popstate fires on a LATER task —
    // unflushed, a stale ignorePop would swallow the first synthetic Back below. A single
    // setTimeout(0) tick is NOT enough under full-suite CPU load (a flushed popstate can queue
    // another traversal), so flush until QUIESCENT: two consecutive ticks with zero popstate
    // events (bounded at 20 ticks).
    await act(async () => {
      let quiet = 0
      let seen = 0
      const count = () => {
        seen++
      }
      window.addEventListener('popstate', count)
      for (let i = 0; i < 20 && quiet < 2; i++) {
        seen = 0
        await new Promise((r) => setTimeout(r, 0))
        quiet = seen === 0 ? quiet + 1 : 0
      }
      window.removeEventListener('popstate', count)
    })
    makeSaveable() // round 14 (D7): a dimmed Save Defaults no longer opens its popup — see the helper
    openSettings()
    openPopup()
    expect(popupTitle()).toBeInTheDocument()
    // A real Back press manifests as a popstate the useBackButton stack consumes newest-first.
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(popupTitle()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument() // settings survived the first Back
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })
})
