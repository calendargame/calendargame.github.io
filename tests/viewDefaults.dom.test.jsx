// @vitest-environment jsdom
//
// The defaults manager (Q12, made editable in Q5 round-6) — the ⚙ footer's window onto the
// saved (or factory) defaults, on the ONE shared DefaultsCard with the Save Defaults popup.
//
// Drives the real <App/> like a user: the "View saved defaults" link is ALWAYS visible, LEFT of
// "Clear saved defaults" (which still appears only while a snapshot exists). It opens the shared
// card seeded from the EFFECTIVE defaults: read-only at rest (one full-width Close), the factory
// view when nothing is saved (adapted title and subline), and fully editable — a dirty row's
// value goes btn-solid, the restricted-write note replaces the footnote, and Save writes ONLY the
// four shown values (the ⚙ half stays byte-identical; from the factory view it CREATES the
// snapshot). The manager's AoX row is the ONE deliberate difference from the Save card: a
// tap-to-type SliderValueEditor readout (strut "1000"), no visible box. Clear runs through its
// own confirm modal (Cancel + a red-tier Clear) with full modal parity. Modal parity for the
// manager itself (focus-on-open, capture Escape, close-with-settings, Android Back, the shared
// Tab trap, the [data-settings-modal] marker) is locked here too. Visual polish (one-line fit,
// themes, drag-release) is on-device per the standing lesson.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import {
  mountApp,
  openSettings,
  gear,
  modalCard,
  queryModalCard,
  panelFooter,
  resetAppState,
} from './helpers/settingsPanel.jsx'

// ── Harness helpers (tests/helpers/settingsPanel, plus the manager's own) ──
const btn = (name) => screen.getByRole('button', { name })
const openManager = () => act(() => fireEvent.click(btn('View saved defaults')))
// "The manager is open on the SAVED view" — asked of the dialog itself, by its accessible name,
// rather than of the title text. A text query cannot answer it any more: How to Play is
// always-mounted since Q6 (round 9), so its display:none copy of the guide is in the DOM on every
// screen, and the guide names "Your saved defaults" in prose. Role queries skip display:none
// subtrees, and the dialog is what every one of these assertions actually means.
const savedManager = () => queryModalCard('Your saved defaults')
const managerDialog = (name = 'Your saved defaults') => modalCard(name)
// Save a snapshot through the UI (settings must be open): Save Defaults → Save.
const saveSnapshot = () => {
  act(() => fireEvent.click(btn('Save Defaults')))
  act(() => fireEvent.click(btn('Save')))
}
// A row's tap-to-type readout (SliderValueEditor display mode) inside a dialog.
const readout = (dialog, label) => within(dialog).getByRole('button', { name: `Edit ${label}` })
// The shared card's four row labels, in their fixed order (the parity contract).
const ROW_LABELS = ['MoX Run Length', 'Flash Speed', 'Blitz Round Timer', 'Blitz Question Timer']
const expectRowsInOrder = (dialog) => {
  const els = ROW_LABELS.map((t) => within(dialog).getByText(t))
  for (let i = 1; i < els.length; i++)
    expect(
      els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
}

describe('The defaults manager (Q12 + Q5 round-6)', () => {
  beforeEach(() => {
    resetAppState() // all four persisted singletons + localStorage, back to a clean baseline
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the View link is ALWAYS visible; with nothing saved it opens the labeled FACTORY view, Clear hidden', () => {
    mountApp()
    openSettings()
    expect(btn('View saved defaults')).toBeInTheDocument() // no snapshot needed any more
    expect(screen.queryByRole('button', { name: 'Clear saved defaults' })).toBeNull() // nothing to clear
    openManager()
    const dialog = managerDialog('Default settings') // adapted title
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog) // focus landed IN the dialog on open
    expect(
      within(dialog).getByText("These are the factory defaults — you haven't saved your own."),
    ).toBeInTheDocument() // adapted subline
    // The factory values, through the card's own formatters/readouts.
    expect(readout(dialog, 'MoX Run Length').textContent).toBe('10')
    expect(readout(dialog, 'Flash Speed').textContent).toBe('2.0s')
    expect(readout(dialog, 'Blitz Round Timer').textContent).toBe('1m 0s')
    expect(readout(dialog, 'Blitz Question Timer').textContent).toBe('10s')
    // Read-only at rest: one full-width Close, no Cancel/Save, no dirty note.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByText('Saving here updates only these values.')).toBeNull()
  })

  it('with a snapshot: View sits LEFT of Clear, and the saved values render through the SAME formatters as the Save card', () => {
    const p = useModePrefs.getState()
    p.setFlashMs(800)
    p.setBlitzSec(90)
    p.setBlitzQSec(10.5)
    p.setAoxN('25')
    mountApp()
    openSettings()
    saveSnapshot()
    const view = btn('View saved defaults')
    const clear = btn('Clear saved defaults')
    // One row, View LEFT of Clear (non-destructive inspect before destructive wipe).
    expect(view.parentElement).toBe(clear.parentElement)
    expect(view.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    openManager()
    const dialog = managerDialog()
    expect(readout(dialog, 'MoX Run Length').textContent).toBe('25') // normalizeAoxN
    expect(readout(dialog, 'Flash Speed').textContent).toBe('0.8s') // fmtFlashT
    expect(readout(dialog, 'Blitz Round Timer').textContent).toBe('1m 30s') // fmtBlitzT
    expect(readout(dialog, 'Blitz Question Timer').textContent).toBe('10.5s') // +"s"
    // The clean-state footnote (replaced by the restricted-write note only once dirty).
    expect(
      within(dialog).getByText(
        'Every ⚙ menu setting is also part of the snapshot, captured as it was when you saved.',
      ),
    ).toBeInTheDocument()
  })

  it('lives in the pinned button block and places the pair on the row’s THIRDS — View alone centres on the whole row', () => {
    useModePrefs.getState().setAoxN('25') // something to save, so Save Defaults is offered
    mountApp()
    openSettings()
    // ⚠ jsdom HAS NO LAYOUT ENGINE, so nothing here measures a position — this pins the PLACEMENT
    // RULE the geometry follows from. The row is three equal columns with NO gap (a gap would push
    // both centres off the thirds); View spans columns 1-2 and Clear columns 2-3, each centred in
    // its own span. Centre of [0, 2/3] is 1/3, centre of [1/3, 1] is 2/3 — the two links land in
    // the GAPS between the three flex-1 buttons above, whose centres are 1/6, 1/2 and 5/6. Whether
    // that reads as interlocked or as crowded at a phone's width is the owner's device call.
    const view = () => btn('View saved defaults')
    const row = view().parentElement
    expect(row.className).toContain('grid-cols-3')
    expect(row.className).not.toContain('gap-')
    // Its home is the PINNED BUTTON BLOCK — the same fenced block as Save Defaults / Reset Settings
    // / Full Reset — and no longer the metadata block's first row, which is what moved the divider
    // down to Contact.
    expect(row.parentElement).toBe(panelFooter())
    expect(panelFooter().contains(btn('Full Reset'))).toBe(true)
    // Nothing saved yet, so Clear is absent and View spans ALL THREE columns: centred on the whole
    // row rather than sitting at one third with nothing opposite it.
    expect(screen.queryByRole('button', { name: 'Clear saved defaults' })).toBeNull()
    expect(view().className).toContain('col-start-1')
    expect(view().className).toContain('col-end-4')
    expect(view().className).toContain('justify-self-center')
    // With a snapshot the pair takes its thirds.
    saveSnapshot()
    const clear = btn('Clear saved defaults')
    expect(view().className).toContain('col-end-3') // 1/3
    expect(clear.className).toContain('col-start-2')
    expect(clear.className).toContain('col-end-4') // 2/3
    expect(clear.className).toContain('justify-self-center')
    // Both state row 1 explicitly. With only Clear's column placed, auto-placement would have found
    // column 2 already behind the cursor (View having just taken columns 1-2) and dropped Clear
    // onto a second line — a silent two-line footer.
    expect(view().className).toContain('row-start-1')
    expect(clear.className).toContain('row-start-1')
  })

  it('a legacy snapshot missing a field forward-merges to factory — never undefined', () => {
    // Simulate a snapshot persisted before blitzQSec existed (the saver never saw the field);
    // effectivePrefDefaults forward-merges it over the factory constants (store/userDefaults).
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings: { ...SETTINGS_DEFAULTS },
        prefs: { flashMs: 800, blitzSec: 90, aoxN: '25' },
      }),
    )
    mountApp()
    openSettings()
    openManager()
    const dialog = managerDialog()
    expect(readout(dialog, 'Blitz Question Timer').textContent).toBe('10s') // factory 10, forward-merged
    expect(readout(dialog, 'Flash Speed').textContent).toBe('0.8s') // the saved fields still read saved
    expect(readout(dialog, 'MoX Run Length').textContent).toBe('25')
  })

  it('editing turns the row btn-solid, swaps the footnote for the restricted-write note, and swaps Close for Cancel + Save', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    openManager()
    const dialog = managerDialog()
    expect(readout(dialog, 'Flash Speed').className).not.toContain('btn-solid') // clean at rest
    act(() =>
      fireEvent.change(within(dialog).getByRole('slider', { name: 'Flash Speed' }), {
        target: { value: '1200' },
      }),
    )
    expect(readout(dialog, 'Flash Speed').className).toContain('btn-solid') // the dirty accent
    expect(readout(dialog, 'Blitz Round Timer').className).not.toContain('btn-solid') // per-row, not global
    expect(screen.getByText('Saving here updates only these values.')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Every ⚙ menu setting is also part of the snapshot, captured as it was when you saved.',
      ),
    ).toBeNull() // the note REPLACES the footnote while dirty
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    // Cancel discards: reopening seeds fresh from the saved defaults, back at rest.
    act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })))
    expect(savedManager()).toBeNull()
    openManager()
    const dialog2 = managerDialog()
    expect(readout(dialog2, 'Flash Speed').textContent).toBe('0.8s')
    expect(within(dialog2).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it("the manager's Save writes ONLY the four shown values — the ⚙ half stays byte-identical, live prefs untouched", () => {
    useSettings.getState().setLeapChance('75')
    useSettings.getState().setMinY(1600)
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot() // snapshot: leapChance 75, minY 1600, flashMs 800
    const settingsBefore = { ...useUserDefaults.getState().saved.settings }
    // Diverge the LIVE panel so a re-capture would be visible as a settings change…
    act(() => useSettings.getState().setLeapChance('random'))
    openManager()
    act(() =>
      fireEvent.change(screen.getByRole('slider', { name: 'Flash Speed' }), {
        target: { value: '1200' },
      }),
    )
    act(() => fireEvent.click(btn('Save')))
    expect(savedManager()).toBeNull() // Save closes the manager
    const saved = useUserDefaults.getState().saved
    expect(saved.prefs.flashMs).toBe(1200) // the edited value landed
    expect(saved.prefs.blitzSec).toBe(MODE_PREFS_DEFAULTS.blitzSec) // untouched rows unchanged
    expect(saved.settings).toEqual(settingsBefore) // …but the ⚙ half passed through AS-SAVED
    expect(useModePrefs.getState().flashMs).toBe(800) // editing defaults never edits live prefs
  })

  it('the AoX row is tap-to-type (no visible box): the readout opens an input, Enter commits with the 2–1000 clamp', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    openManager()
    const dialog = managerDialog()
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0) // no box at rest — the ONE difference from the Save card
    act(() => fireEvent.click(readout(dialog, 'MoX Run Length')))
    const input = within(dialog).getByRole('textbox', { name: 'MoX Run Length' }) // editLabel — a count, not "(seconds)"
    act(() => fireEvent.change(input, { target: { value: '2000' } }))
    act(() => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(readout(dialog, 'MoX Run Length').textContent).toBe('1000') // Enter commits with the clamp
    expect(readout(dialog, 'MoX Run Length').className).toContain('btn-solid') // the dirty accent on the readout
    // Escape mid-edit reverts the edit only — the popup (and panel) survive the press.
    act(() => fireEvent.click(readout(dialog, 'MoX Run Length')))
    const input2 = within(dialog).getByRole('textbox', { name: 'MoX Run Length' })
    act(() => {
      input2.focus()
      fireEvent.change(input2, { target: { value: '77' } })
      fireEvent.keyDown(input2, { key: 'Escape' })
    })
    expect(readout(dialog, 'MoX Run Length').textContent).toBe('1000')
    expect(savedManager()).toBeInTheDocument()
    expect(btn('Reset Settings')).toBeInTheDocument()
  })

  it('editing from the FACTORY view + Save CREATES the snapshot (factory ⚙ values + the edits) and Clear appears', () => {
    mountApp()
    openSettings()
    expect(useUserDefaults.getState().saved).toBeNull()
    openManager()
    const dialog = managerDialog('Default settings')
    act(() => fireEvent.click(readout(dialog, 'MoX Run Length')))
    const input = within(dialog).getByRole('textbox', { name: 'MoX Run Length' })
    act(() => fireEvent.change(input, { target: { value: '25' } }))
    act(() => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(screen.getByText('Saving here updates only these values.')).toBeInTheDocument()
    act(() => fireEvent.click(btn('Save')))
    const saved = useUserDefaults.getState().saved
    expect(saved).not.toBeNull()
    expect(saved.settings).toEqual(SETTINGS_DEFAULTS) // the ⚙ half captured at factory
    expect(saved.prefs).toEqual({
      flashMs: MODE_PREFS_DEFAULTS.flashMs,
      blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
      blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
      aoxN: '25',
    })
    expect(btn('Clear saved defaults')).toBeInTheDocument() // the Clear link appears with the snapshot
    openManager()
    expect(savedManager()).toBeInTheDocument() // and the manager now opens on the saved view
  })

  it('SHARED-CARD PARITY: both popups render the same rows, sliders, and readouts — the AoX box is the one difference', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    // The Save Defaults card…
    act(() => fireEvent.click(btn('Save Defaults')))
    const saveDialog = screen.getByRole('dialog', {
      name: 'Save current settings as your defaults?',
    })
    expectRowsInOrder(saveDialog)
    expect(
      within(saveDialog)
        .getAllByRole('slider')
        .map((s) => s.getAttribute('aria-label')),
    ).toEqual(['Flash Speed', 'Blitz Round Timer', 'Blitz Question Timer'])
    expect(within(saveDialog).getAllByRole('textbox')).toHaveLength(1) // the visible AoX box stays
    readout(saveDialog, 'Flash Speed') // the same tap-to-type readouts beside the sliders
    readout(saveDialog, 'Blitz Round Timer')
    readout(saveDialog, 'Blitz Question Timer')
    expect(within(saveDialog).queryByRole('button', { name: 'Edit MoX Run Length' })).toBeNull()
    act(() => fireEvent.click(within(saveDialog).getByRole('button', { name: 'Cancel' })))
    // …and the manager: identical structure, except the AoX readout replaces the box.
    openManager()
    const manageDialog = managerDialog('Default settings')
    expectRowsInOrder(manageDialog)
    expect(
      within(manageDialog)
        .getAllByRole('slider')
        .map((s) => s.getAttribute('aria-label')),
    ).toEqual(['Flash Speed', 'Blitz Round Timer', 'Blitz Question Timer'])
    expect(within(manageDialog).queryAllByRole('textbox')).toHaveLength(0)
    readout(manageDialog, 'MoX Run Length')
    readout(manageDialog, 'Flash Speed')
    readout(manageDialog, 'Blitz Round Timer')
    readout(manageDialog, 'Blitz Question Timer')
  })

  it('the CLEAR CONFIRM popup: Cancel keeps the snapshot, Clear forgets it (View stays, Clear link hides)', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    act(() => fireEvent.click(btn('Clear saved defaults')))
    const dialog = managerDialog('Clear your saved defaults?')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog) // focus landed IN the dialog on open
    act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })))
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(useUserDefaults.getState().saved).not.toBeNull() // Cancel keeps it
    expect(btn('Reset Settings')).toBeInTheDocument() // the settings panel survived
    act(() => fireEvent.click(btn('Clear saved defaults')))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(useUserDefaults.getState().saved).toBeNull() // back to factory semantics
    expect(screen.queryByRole('button', { name: 'Clear saved defaults' })).toBeNull() // the link hides itself
    expect(btn('View saved defaults')).toBeInTheDocument() // View is permanent
  })

  it('the Clear confirm carries full modal parity: scrim, Escape, and close-with-settings', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    act(() => fireEvent.click(btn('Clear saved defaults')))
    // The settings click-outside handler must treat the scrim as "inside" (mousedown path)…
    const scrim = document.querySelector('[data-settings-modal]')
    act(() => fireEvent.mouseDown(scrim))
    expect(btn('Reset Settings')).toBeInTheDocument()
    // …and a scrim CLICK cancels only the popup.
    act(() => fireEvent.click(scrim))
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(useUserDefaults.getState().saved).not.toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    act(() => fireEvent.click(btn('Clear saved defaults')))
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // capture-phase popup handler wins
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    act(() => fireEvent.click(btn('Clear saved defaults')))
    act(() => fireEvent.click(gear())) // any settings close counts
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(useUserDefaults.getState().saved).not.toBeNull() // dismissal never clears
  })

  it('Close, scrim mousedown/click and Escape dismiss the manager only — the settings panel survives', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    openManager()
    act(() => fireEvent.click(btn('Close')))
    expect(savedManager()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    openManager()
    // The settings click-outside handler must treat the scrim as "inside" — the shared
    // [data-settings-modal] marker (the same guard as the Save popup)…
    const scrim = document.querySelector('[data-settings-modal]')
    act(() => fireEvent.mouseDown(scrim))
    expect(btn('Reset Settings')).toBeInTheDocument()
    // …and a scrim CLICK cancels only the popup.
    act(() => fireEvent.click(scrim))
    expect(savedManager()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
    openManager()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // capture-phase popup handler wins
    expect(savedManager()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument()
  })

  it('closing Settings closes the manager with it (child flow of the panel)', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    openManager()
    expect(savedManager()).toBeInTheDocument()
    act(() => fireEvent.click(gear())) // any settings close counts
    expect(savedManager()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })

  it('the Tab trap wraps across the card controls; the mode dropdown stays suppressed', () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    openManager()
    const dialog = managerDialog()
    const first = readout(dialog, 'MoX Run Length') // the card's first control
    const close = btn('Close') // …and its last (the resting read-only state)
    // Tab from the LAST control wraps to the first instead of escaping to the panel under the
    // scrim; Shift+Tab from the FIRST wraps back to the last.
    act(() => {
      close.focus()
      fireEvent.keyDown(close, { key: 'Tab' })
    })
    expect(document.activeElement).toBe(first)
    act(() => fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(close)
    // The app-wide Tab shortcut bails while a settings modal is up (the [data-settings-modal]
    // guard) — the mode dropdown must not open behind the aria-modal dialog.
    act(() => fireEvent.keyDown(window, { key: 'Tab' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(savedManager()).toBeInTheDocument()
  })

  it('Android Back closes the manager first, then Settings (LIFO overlay stack)', async () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    // Flush jsdom's queued history traversals until quiescent (the saveDefaults.dom pattern):
    // earlier tests' UI closes — and saveSnapshot's own Save-popup close just above — each ran
    // popOverlay's guarded history.back(), whose to-be-ignored popstate fires on a later task
    // and would otherwise swallow the first synthetic Back below.
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
    openManager()
    expect(savedManager()).toBeInTheDocument()
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(savedManager()).toBeNull()
    expect(btn('Reset Settings')).toBeInTheDocument() // settings survived the first Back
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })

  it('Android Back closes the Clear confirm first, then Settings (LIFO overlay stack)', async () => {
    act(() => useModePrefs.getState().setFlashMs(800))
    mountApp()
    openSettings()
    saveSnapshot()
    // The same quiescence flush as above (saveSnapshot's popup close queues a traversal).
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
    act(() => fireEvent.click(btn('Clear saved defaults')))
    expect(screen.getByText('Clear your saved defaults?')).toBeInTheDocument()
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.queryByText('Clear your saved defaults?')).toBeNull()
    expect(useUserDefaults.getState().saved).not.toBeNull() // Back never clears
    expect(btn('Reset Settings')).toBeInTheDocument() // settings survived the first Back
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.queryByRole('button', { name: 'Reset Settings' })).toBeNull()
  })
})
