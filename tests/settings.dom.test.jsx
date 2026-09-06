// @vitest-environment jsdom
//
// ⚙ Settings — DOM tests for the segmented pill trays and the radio-group a11y pass (round-8),
// extended in round-9 to pin THE PICKER RULE across the whole panel. What jsdom CAN prove, and
// does here:
//
//   • THE PICKER RULE: the panel holds exactly two kinds of control, and each has exactly one
//     treatment. A SWITCH (on/off) is one On/Off button beside its label. A PICKER (choose among
//     named alternatives) is ONE merged tray — Input and the three chance rows joined Date Format
//     and Theme in round-9, so the housing finally MEANS "these options are mutually exclusive"
//     instead of being a per-group decoration. Both halves are pinned: every picker is a tray,
//     every switch is not, and no role="radio" exists anywhere outside a tray.
//   • The conditionally-locked pickers keep their exact lock conditions through the conversion —
//     Input in Deduction, Julian Chance unless the range straddles 1582, Leap Year Chance unless a
//     leap year is reachable — with the dim on the GROUP, aria-disabled on every segment, the
//     onChange guard behind it, and the selected value preserved for when the lock clears. Jan/Feb
//     Chance is the control case: it has no lock branch at all.
//
//   • PillTray (components/PillTray) renders every group as role="radio" segments, and ONE
//     boolean — the enclosing PillGroup's `disabled` — is the whole lock: the dim class on the
//     group, aria-disabled on each segment, the onChange guard (so a click slipping past
//     pointer-events-none cannot change the value) and the missing tab stop all come from it.
//     Each of those four is asserted, and the dim is asserted as an exact class string.
//   • The five themes are two ALWAYS-PRESENT rows, not the two/three dropdowns they replaced.
//     The same rows render in both Use-System states — that is what stops the panel reflowing
//     when the switch is flipped — and only the SELECTION semantics differ: two independent
//     picks when the OS decides, exactly one pick across both rows when it doesn't.
//   • Flipping Use System Settings OFF seeds the manual theme from what is ALREADY on screen, so
//     the switch never jumps the user to a different look (the round-8 bug).
//   • THE KEYBOARD CONTRACT that role="radiogroup" promises, added in round-9 (Q2) and owned by
//     PillGroup (components/PillGroup): each group is ONE tab stop — the selected pill — with
//     Right/Down, Left/Up, Home and End moving the choice WITHIN it and wrapping, and a locked
//     group inert (no tab stop, no arrow handling — pointer-events-none stops only pointers).
//     The group, not the tray, has to own it, because two of these groups span two trays: the
//     arrow walks straight from the last Written format into the first Numeric one, and the five
//     themes are one tab stop across two rows whenever Use System is off. This is also the layer
//     the owner cannot check on a phone — there is no keyboard — so these tests ARE the pass.
//   • Every mutually-exclusive group in the panel is a role="radiogroup" of role="radio" buttons,
//     and A GROUP IS A CHOICE, NOT A ROW. Where two trays share one setting the radiogroup spans
//     both of them — the five date formats always, and the two theme rows while Use System is off
//     — because a group reporting "nothing selected" while the real pick sits in a sibling group
//     states something false. The theme grouping therefore FOLLOWS the switch, and the pills in
//     the one date-format group state their half in their accessible names, since 'MDY' and 'DMY'
//     each appear in both trays and radios in one group have to be tellable apart.
//
// What it CANNOT prove: the concentric-housing geometry, the dim, and the press-drag dismissal
// are pixels and pointers — on-device only.
//
// ── HOW THIS FILE IS ORGANISED, since the settings-panel extraction ──────────────────────────
// Everything above the PIXEL GATES divider is BEHAVIOUR, and every one of those tests reaches the
// panel through tests/helpers/settingsPanel — mounting, opening, finding a switch by its setting's
// name, asking whether a picker is locked, asking whether a footer button is being offered. None
// of them names a DOM position, an element id, or a Tailwind token, so none of them has to change
// when the panel stops being part of App. That is the point: the extraction's gate is that this
// net passes with ZERO edits, and a test you have to fix afterwards cannot be part of that gate.
//
// Below the divider are the PIXEL GATES, which are the deliberate opposite — implementation-
// coupled, exact-equality, and the owner's zero-visual-change guarantee. Their own comment block
// says what a red one there means and what the extraction owes them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { PillGroup } from '../src/components/PillGroup.jsx'
import { PillTray } from '../src/components/PillTray.jsx'
import { useSettings } from '../src/store/settings.js'
import {
  mountApp,
  openSettings,
  panel,
  panelEl,
  picker,
  pickerPills,
  pickerLockState,
  expectLock,
  row,
  settingSwitch,
  switchRow,
  footerButton,
  isOffered,
  resetAppState,
} from './helpers/settingsPanel.jsx'

// ⚠ WHERE THE PANEL LIVES IS NOT THIS FILE'S BUSINESS ANY MORE. Everything that used to be a DOM
// walk from a label, an id literal, or a Tailwind token now goes through
// tests/helpers/settingsPanel — see that file's header for why (short version: the panel is about
// to move out of App, and a safety net you have to edit on the far side of a move is not a safety
// net). Two describes at the foot of this file are the deliberate exception, and they say so.
//
// The fixture every test here starts from: the app, with the ⚙ panel OPEN. The G key is how this
// file has always opened it — kept deliberately, because the routes are not yet proved equivalent
// and swapping one for another silently would be a behaviour change smuggled in as a tidy-up.
const mountPanel = () => {
  const utils = mountApp()
  openSettings('key')
  return utils
}
// Every group under test is a labelled radiogroup, so one scoped accessor serves them all.
const group = (name) => within(picker(name))
const pills = (name) => pickerPills(name)
const checked = (name) =>
  pills(name)
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.textContent.trim())
const labels = (name) => pills(name).map((b) => b.textContent.trim())
// A visual ROW, found by its caption instead of by a role — which is the point: which radiogroup
// owns a theme row depends on Use System, but the row itself is there either way.
const rowOf = (caption) => within(row(caption))
const rowPills = (caption) => rowOf(caption).getAllByRole('radio')
const rowLabels = (caption) => rowPills(caption).map((b) => b.textContent.trim())
const rowChecked = (caption) =>
  rowPills(caption)
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.textContent.trim())
const st = () => useSettings.getState()
// A PillTray segment, recognised STRUCTURALLY rather than by a copied class list: the housing
// draws the frame (surface-tray + the single border) and each segment is borderless, carrying the
// concentric radius instead of a plain rounded-xl. A flat picker button — what Input and the three
// chance rows shipped as before round-9 — wore its own `border` and had no housing, so all three
// clauses flip together. Class strings are all jsdom can see; the geometry is on-device only.
const isTraySegment = (b) =>
  b.className.includes('rounded-[calc(var(--radius-xl)-1px)]') &&
  !/(^|\s)border(\s|$)/.test(b.className) &&
  b.parentElement.className.includes('surface-tray')
// Every choice-among-alternatives in the panel, by radiogroup name, with Use System ON — so the
// theme rows are two groups. Input and the three chance rows shipped as flat gap-separated
// buttons until round-9; the housing meant nothing while that was true. Turning Use System OFF
// swaps 'Dark theme' + 'Light theme' for the single 'Theme' group that spans both rows.
const PICKERS = [
  'Date Format',
  'Dark theme',
  'Light theme',
  'Input',
  'Dot Layout',
  'Julian Chance',
  'Leap Year Chance',
  'Jan/Feb Chance on Leap Years',
]
// The On/Off switches, by the setting each one controls. This used to walk from the LABEL's text
// to its parent to its first button, because all four read "On"/"Off" and so had no name to ask
// for; they name their setting now, and the helper is the only place that knows it.
const clickToggle = (label) =>
  act(() => {
    fireEvent.click(settingSwitch(label))
  })

describe('Settings → Display — theme pill rows', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The panel must not change height when the switch is flipped, which starts with both rows
  // existing in both states — the defect the two/three dropdowns had by construction.
  it('renders the SAME two rows, with the same pills, in both Use-System states', () => {
    mountPanel()
    expect(rowLabels('Dark')).toEqual(['Dusk', 'Midnight', 'Nebula'])
    expect(rowLabels('Light')).toEqual(['Light', 'Parchment'])
    clickToggle('Use System Settings')
    expect(st().useSystem).toBe(false)
    expect(rowLabels('Dark')).toEqual(['Dusk', 'Midnight', 'Nebula'])
    expect(rowLabels('Light')).toEqual(['Light', 'Parchment'])
  })

  // Centered in BOTH states: a left-aligned SectionLabel is reserved for the DISPLAY/DATES/STATS
  // headers and would out-rank the "Theme" sub-label these sit under.
  it('captions read Dark / Light and stay centered in both Use-System states', () => {
    mountPanel()
    const caption = (text) =>
      panel()
        .getAllByText(text)
        .find((el) => el.tagName === 'DIV')
    for (const pass of ['system on', 'system off']) {
      expect(caption('Dark').className).toContain('text-center')
      expect(caption('Light').className).toContain('text-center')
      if (pass === 'system on') clickToggle('Use System Settings')
    }
  })

  // The OS owns which row is live, so the two picks are genuinely independent — two choices, and
  // therefore two radiogroups.
  it('Use System ON: two INDEPENDENT picks, modelled as two radiogroups', () => {
    mountPanel()
    expect(labels('Dark theme')).toEqual(['Dusk', 'Midnight', 'Nebula'])
    expect(labels('Light theme')).toEqual(['Light', 'Parchment'])
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
    expect(checked('Dark theme')).toEqual(['Dusk']) // darkTheme
    expect(checked('Light theme')).toEqual(['Light']) // lightTheme — both lit at once
    act(() => {
      fireEvent.click(group('Dark theme').getByRole('radio', { name: 'Nebula' }))
    })
    act(() => {
      fireEvent.click(group('Light theme').getByRole('radio', { name: 'Parchment' }))
    })
    expect(st().darkTheme).toBe('nebula')
    expect(st().lightTheme).toBe('parchment')
    expect(checked('Dark theme')).toEqual(['Nebula'])
    expect(checked('Light theme')).toEqual(['Parchment']) // the dark pick did not disturb it
  })

  // One pick across both rows — so ONE radiogroup spans them. Two would each announce themselves
  // as an independent choice, and the row without manualTheme would read "nothing selected" while
  // the user has in fact selected a theme.
  it('Use System OFF: ONE pick across BOTH rows, modelled as ONE radiogroup', () => {
    mountPanel()
    clickToggle('Use System Settings')
    // The per-row groups are gone; one group owns all five pills, in row order.
    expect(screen.queryByRole('radiogroup', { name: 'Dark theme' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Light theme' })).toBeNull()
    expect(labels('Theme')).toEqual(['Dusk', 'Midnight', 'Nebula', 'Light', 'Parchment'])
    act(() => {
      fireEvent.click(group('Theme').getByRole('radio', { name: 'Midnight' }))
    })
    expect(st().manualTheme).toBe('midnight')
    expect(checked('Theme')).toEqual(['Midnight']) // exactly one, across both rows
    expect(rowChecked('Light')).toEqual([]) // and it is the dark row that holds it
    act(() => {
      fireEvent.click(group('Theme').getByRole('radio', { name: 'Parchment' }))
    })
    expect(st().manualTheme).toBe('parchment')
    expect(checked('Theme')).toEqual(['Parchment'])
    expect(rowChecked('Dark')).toEqual([])
  })
})

// ── Part C: the Use-System toggle must not jump the theme ────────────────────────────────────
// Turning the switch OFF used to hand control to whatever manualTheme happened to hold, which at
// factory settings is 'dusk' — so a user looking at Light got thrown into a dark theme by a
// switch that says nothing about which theme. The fix seeds manualTheme from the ALREADY-ACTIVE
// theme, so the lit pill stays lit and only its meaning changes (OS-chosen → the single manual
// pick). setup/dom.js mocks matchMedia to matches:false, so systemIsDark is false unless a test
// overrides it — the light row is the live one by default.
describe('Settings → Display — flipping Use System Settings OFF never changes the theme', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    vi.unstubAllGlobals()
  })

  const flipOff = () => clickToggle('Use System Settings')

  it('light system: seeds the manual theme from the LIGHT row, not from stale manualTheme', () => {
    mountPanel()
    expect(st().manualTheme).toBe('dusk') // the stale value the old code would have jumped to
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    flipOff()
    expect(st().manualTheme).toBe('light') // seeded from activeTheme
    expect(document.documentElement.getAttribute('data-theme')).toBe('light') // no jump
    expect(rowChecked('Light')).toEqual(['Light']) // the lit pill stayed lit
    expect(rowChecked('Dark')).toEqual([])
  })

  it('seeds from the live row even after that row is re-picked', () => {
    mountPanel()
    act(() => {
      fireEvent.click(rowOf('Light').getByRole('radio', { name: 'Parchment' }))
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
    flipOff()
    expect(st().manualTheme).toBe('parchment')
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
  })

  // Proves the seed reads activeTheme (which follows the OS) and not lightTheme by luck: with a
  // DARK system the dark row is live, so the seed must come from there.
  it('dark system: seeds from the DARK row', () => {
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query.includes('dark'), // prefers-color-scheme: dark → true; hover/pointer → false
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }))
    useSettings.getState().setDarkTheme('nebula')
    mountPanel()
    expect(document.documentElement.getAttribute('data-theme')).toBe('nebula')
    flipOff()
    expect(st().manualTheme).toBe('nebula')
    expect(document.documentElement.getAttribute('data-theme')).toBe('nebula')
    expect(rowChecked('Dark')).toEqual(['Nebula'])
    expect(rowChecked('Light')).toEqual([])
  })

  // The gear's violet "modified" bar means "live state differs from your defaults". A dormant
  // value must not light it: an OFF→ON round trip parks manualTheme at whatever was on screen
  // (that IS the seed above), and on a light-mode phone that is 'light' against a 'dusk' default.
  // Comparing stored rather than in-effect values lit the bar — and un-dimmed Reset Settings and
  // Full Reset — on an app the user had only toggled a switch on and back off.
  it('an OFF→ON round trip leaves the panel reading UNMODIFIED', () => {
    mountPanel()
    // Reset Settings stops being OFFERED exactly when the panel sits at its effective defaults,
    // so it is the readable proxy for "nothing is modified".
    const offered = () => isOffered(footerButton('Reset Settings'))
    expect(offered()).toBe(false) // factory-fresh
    flipOff()
    expect(st().manualTheme).toBe('light') // the seed diverges from the 'dusk' default…
    expect(offered()).toBe(true) // useSystem is off: real
    flipOff() // …and back on, so manualTheme is dormant again
    expect(st().useSystem).toBe(true)
    expect(st().manualTheme).toBe('light') // still parked — deliberately, so OFF never jumps
    expect(offered()).toBe(false) // yet nothing reads modified
  })
})

// ── Part A: the date-format trays + PillTray's disabled contract ─────────────────────────────
describe('Settings → Display — date-format trays', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Both halves read and write the ONE dateFormat setting, so ONE radiogroup spans them: five
  // ids, one pick, wearing two housings. The pills' accessible names carry the half — which is
  // what keeps the two 'MDY's and the two 'DMY's apart now that they share a group.
  it('is ONE radiogroup of five formats, named by half', () => {
    mountPanel()
    expect(screen.queryByRole('radiogroup', { name: 'Written date format' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Numeric date format' })).toBeNull()
    expect(pills('Date Format').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Written MDY',
      'Written DMY',
      'Numeric MDY',
      'Numeric DMY',
      'Numeric YMD',
    ])
    // The visible label stays the bare initialism, and it is contained in the accessible name —
    // so speaking what you can see still activates the pill (WCAG 2.5.3 Label in Name).
    expect(labels('Date Format')).toEqual(['MDY', 'DMY', 'MDY', 'DMY', 'YMD'])
    pills('Date Format').forEach((b) =>
      expect(b.getAttribute('aria-label')).toContain(b.textContent.trim()),
    )
  })

  it('exactly one of the five is selected, wherever it lives', () => {
    mountPanel()
    const checkedName = () =>
      pills('Date Format')
        .filter((b) => b.getAttribute('aria-checked') === 'true')
        .map((b) => b.getAttribute('aria-label'))
    expect(checkedName()).toEqual(['Written MDY']) // the factory default
    act(() => {
      fireEvent.click(group('Date Format').getByRole('radio', { name: 'Numeric YMD' }))
    })
    expect(st().dateFormat).toBe('numeric-ymd')
    expect(checkedName()).toEqual(['Numeric YMD']) // still exactly one, now in the other tray
  })

  // Random Format dims the whole group. The wrapper's pointer-events-none is the visible half;
  // these are the two halves it does NOT cover — the lock is published to assistive tech, and
  // onChange is guarded so a click dispatched past pointer-events-none cannot change the value.
  it('Random Format ON locks the group: aria-disabled, dimmed wrapper, and onChange guarded', () => {
    mountPanel()
    clickToggle('Random Format')
    expect(st().randomFormat).toBe(true)
    const locked = pickerLockState('Date Format')
    locked.segments.forEach((v) => expect(v).toBe('true'))
    expect(locked.dimmed).toBe(true)
    expect(locked.offered).toBe(false)
    // The radiogroup IS the dim wrapper, so the dim provably covers the captions inside it too.
    const wrapper = picker('Date Format')
    expect(within(wrapper).getByText('Written')).toBeInTheDocument()
    expect(within(wrapper).getByText('Numeric')).toBeInTheDocument()
    act(() => {
      fireEvent.click(group('Date Format').getByRole('radio', { name: 'Numeric DMY' }))
    })
    expect(st().dateFormat).toBe('written-mdy') // unchanged — the guard held
  })

  it('Random Format OFF leaves the group live and unmarked', () => {
    mountPanel()
    pills('Date Format').forEach((b) => expect(b.getAttribute('aria-disabled')).toBe(null))
    act(() => {
      fireEvent.click(group('Date Format').getByRole('radio', { name: 'Written DMY' }))
    })
    expect(st().dateFormat).toBe('written-dmy')
  })
})

// ── Part G: THE PICKER RULE — one treatment per control kind, and the locks survive it ───────
describe('Settings — THE PICKER RULE', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // Every on/off setting, by the label text its row is found through.
  const SWITCHES = [
    'Random Format',
    'Use System Settings',
    'Julian Calendar (pre-Oct 15, 1582)',
    'Save Stats',
  ]

  it('every PICKER is one merged tray', () => {
    mountPanel()
    for (const name of PICKERS) {
      expect(pills(name).length).toBeGreaterThan(1)
      pills(name).forEach((b) => expect(isTraySegment(b)).toBe(true))
    }
  })

  // The clause that keeps the rule from rotting: a picker added later as loose buttons would still
  // carry role="radio", so it fails here even though nobody thought to list it above. Counting the
  // radios against the listed pickers is what makes the sweep exhaustive rather than a spot check.
  it('no radio is drawn anywhere outside a tray', () => {
    mountPanel()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(PICKERS.flatMap((name) => pills(name)).length)
    radios.forEach((b) => expect(isTraySegment(b)).toBe(true))
  })

  it('every SWITCH stays one On/Off button — not a tray, not a radio', () => {
    mountPanel()
    for (const label of SWITCHES) {
      const btns = [...switchRow(label).querySelectorAll('button')]
      expect(btns).toHaveLength(1) // a switch is not a choice among alternatives
      expect(btns[0].textContent.trim()).toMatch(/^(On|Off)$/)
      expect(btns[0].getAttribute('role')).toBeNull()
      expect(isTraySegment(btns[0])).toBe(false)
    }
  })

  // The lock is published five ways and expectLock (imported from the panel helper) reads all
  // five: the dim on the GROUP (so the housing greys as one piece rather than five separately-
  // dimmed buttons, which is what changed in round-9), the GROUP's own aria-disabled, then
  // aria-disabled on every segment, PillTray's onChange guard behind them, and — the Q2 addition —
  // no tab stop at all, since pointer-events-none locks out pointers and nothing else. All five
  // come from ONE `disabled` on the PillGroup, so they cannot drift apart; asserting them together
  // is what proves that.
  //
  // ⚠ IT USED TO BE A PRIVATE FOUR-FACET COPY HERE, written before the group carried its own
  // aria-disabled, and the behaviour net then grew a five-facet second copy of the same idea. One
  // definition now, in the helper, and the stronger form won: the facet the local copy was missing
  // is the one a screen reader meets FIRST — a group announcing itself live while every segment
  // inside it says otherwise.

  it('Input: live in a weekday mode, locked in Deduction, value preserved', () => {
    mountPanel()
    expectLock('Input', false)
    act(() => {
      fireEvent.click(group('Input').getByRole('radio', { name: 'Dots' }))
    })
    expect(st().inputStyle).toBe('dots')
    act(() => {
      fireEvent.keyDown(window, { key: 'D' }) // → Deduction, which also closes the popover
    })
    act(() => {
      fireEvent.keyDown(window, { key: 'G' }) // reopen it
    })
    expectLock('Input', true)
    expect(checked('Input')).toEqual(['Dots']) // still shown as the pick, so it survives the lock
    act(() => {
      fireEvent.click(group('Input').getByRole('radio', { name: 'Buttons' }))
    })
    expect(st().inputStyle).toBe('dots') // the guard held
    act(() => {
      fireEvent.keyDown(window, { key: 'K' }) // back to Classic
    })
    act(() => {
      fireEvent.keyDown(window, { key: 'G' })
    })
    expectLock('Input', false)
  })

  // Julian Chance needs a range that STRADDLES 1582 — the factory 1–10000 does, 1900–10000 does
  // not — and needs the Julian Calendar switch on.
  it('Julian Chance: locked unless the range straddles 1582, and by the Julian switch', () => {
    mountPanel()
    expectLock('Julian Chance', false)
    act(() => {
      fireEvent.click(group('Julian Chance').getByRole('radio', { name: '75%' }))
    })
    expect(st().julianChance).toBe('75')
    act(() => st().setMinY(1900)) // all-Gregorian: nothing for the setting to do
    expectLock('Julian Chance', true)
    expect(checked('Julian Chance')).toEqual(['75%']) // preserved while locked
    act(() => {
      fireEvent.click(group('Julian Chance').getByRole('radio', { name: 'Random' }))
    })
    expect(st().julianChance).toBe('75') // the guard held
    act(() => st().setMinY(1))
    expectLock('Julian Chance', false) // and it comes back live, still on 75%
    expect(checked('Julian Chance')).toEqual(['75%'])
    clickToggle('Julian Calendar (pre-Oct 15, 1582)') // the other half of the condition
    expect(st().useJulian).toBe(false)
    expectLock('Julian Chance', true)
  })

  // 1900 is not a leap year under either rule, so a range of exactly [1900,1900] reaches none.
  it('Leap Year Chance: locked when no leap year is reachable; Jan/Feb Chance never locks', () => {
    mountPanel()
    expectLock('Leap Year Chance', false)
    act(() => {
      fireEvent.click(group('Leap Year Chance').getByRole('radio', { name: '100%' }))
    })
    expect(st().leapChance).toBe('100')
    act(() => {
      st().setMinY(1900)
      st().setMaxY(1900)
    })
    expectLock('Leap Year Chance', true)
    expect(checked('Leap Year Chance')).toEqual(['100%'])
    act(() => {
      fireEvent.click(group('Leap Year Chance').getByRole('radio', { name: 'Random' }))
    })
    expect(st().leapChance).toBe('100') // the guard held
    // Jan/Feb still applies to whatever leap years a range does contain, so it has no lock branch
    // at all — the control case for the two rows above.
    expectLock('Jan/Feb Chance on Leap Years', false)
    act(() => {
      fireEvent.click(group('Jan/Feb Chance on Leap Years').getByRole('radio', { name: '50%' }))
    })
    expect(st().janFebChance).toBe('50')
    act(() => st().setMaxY(10000))
    expectLock('Leap Year Chance', false)
    expect(checked('Leap Year Chance')).toEqual(['100%']) // restored, not reset
  })
})

// ── The two Dates adjacencies the How-to-Play guide states as fact ───────────────────────────
describe('Settings → Dates — the pairings the guide depends on', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The Dates section is one flat space-y-2 column, so its row CAPTIONS read in DOM order are the
  // visible row order. Captions are leaf label elements; the PillGroup wrappers between them hold
  // pill text that matches none of these, so they filter themselves out.
  const DATE_CAPTIONS = [
    'Year Range',
    'Leap Year Chance',
    'Jan/Feb Chance on Leap Years',
    'Julian Calendar (pre-Oct 15, 1582)',
    'Julian Chance',
  ]
  const datesRowOrder = () => {
    const section = panel().getByText('Dates').parentElement
    return [...section.querySelectorAll('div,span')]
      .map((el) => el.textContent.trim())
      .filter((t) => DATE_CAPTIONS.includes(t))
  }

  it('Jan/Feb Chance sits directly under Leap Year Chance, and Julian Chance directly under its switch', () => {
    // DELIBERATELY NOT the whole order. Which block goes first is a design call the owner may
    // revisit (round-12 already moved the Julian pair to the foot), and a test that froze all five
    // rows would fail every such call for no reason. What is NOT free is splitting either PAIR,
    // because the guide states both as fact to the reader: Jan/Feb Chance is documented as a
    // sub-case of Leap Year Chance, and the Julian Chance section tells the user in so many words
    // that "The Julian Calendar toggle ABOVE is off" is one of the three reasons the row greys out.
    // Move one half of a pair and that sentence is simply untrue on screen, with nothing to catch
    // it — the reorder that created this risk protected the pairings with a source COMMENT, which
    // cannot fail a build. (What this still cannot see: the guide's Settings Overview enumerates
    // all five rows in prose. That list has to be re-read by hand on any reshuffle — pinning it
    // here would be pinning the whole order through the back door.)
    mountPanel()
    const order = datesRowOrder()
    expect(order).toHaveLength(DATE_CAPTIONS.length) // else the index math below proves nothing
    expect(order.indexOf('Jan/Feb Chance on Leap Years')).toBe(
      order.indexOf('Leap Year Chance') + 1,
    )
    expect(order.indexOf('Julian Chance')).toBe(
      order.indexOf('Julian Calendar (pre-Oct 15, 1582)') + 1,
    )
  })
})

// ── Parts E + F: identical semantics everywhere, and the dropdowns are gone ──────────────────
describe('Settings → Display — radio semantics and the retired theme dropdowns', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // If radio semantics go in, they go everywhere the same semantics already existed — several of
  // these groups carried aria-disabled but no role, i.e. they announced their LOCK but not their
  // structure. Every mutually-exclusive choice in the panel is now one radiogroup of radios, and
  // every one of them holds exactly one checked pill — which is only true because the groups are
  // drawn around CHOICES: Date Format spans its two trays, and the theme rows are two groups here
  // solely because Use System is on, making them two genuine choices.
  it('every mutually-exclusive choice in the panel is a radiogroup with exactly one checked', () => {
    mountPanel()
    const expected = {
      'Date Format': 5,
      'Dark theme': 3,
      'Light theme': 2,
      Input: 2,
      'Julian Chance': 5,
      'Leap Year Chance': 4,
      'Jan/Feb Chance on Leap Years': 5,
    }
    for (const [name, count] of Object.entries(expected)) {
      expect(pills(name)).toHaveLength(count)
      pills(name).forEach((b) => expect(b.tagName).toBe('BUTTON'))
      expect(checked(name)).toHaveLength(1)
    }
    // The same sweep the Use-System-off case gets below: no group anywhere in the panel announces
    // itself as an unmade choice. Both states are pinned because the theme GROUPING follows the
    // switch, so each state is a different set of groups to be wrong about.
    screen.getAllByRole('radiogroup').forEach((g) => {
      const lit = within(g)
        .getAllByRole('radio')
        .filter((b) => b.getAttribute('aria-checked') === 'true')
      expect(lit).toHaveLength(1)
    })
  })

  // The same invariant with the switch off, where the theme rows collapse into one choice. No
  // group may ever report an empty selection, which is the whole reason the grouping follows the
  // semantics instead of the layout.
  it('holds with Use System off, where the theme rows become one choice', () => {
    mountPanel()
    clickToggle('Use System Settings')
    for (const [name, count] of Object.entries({
      'Date Format': 5,
      Theme: 5,
      Input: 2,
      'Julian Chance': 5,
      'Leap Year Chance': 4,
      'Jan/Feb Chance on Leap Years': 5,
    })) {
      expect(pills(name)).toHaveLength(count)
      expect(checked(name)).toHaveLength(1)
    }
    // No group anywhere in the panel announces itself as an unmade choice.
    screen.getAllByRole('radiogroup').forEach((g) => {
      const lit = within(g)
        .getAllByRole('radio')
        .filter((b) => b.getAttribute('aria-checked') === 'true')
      expect(lit).toHaveLength(1)
    })
  })

  // The theme CustomSelects are gone; the bar's mode selector is the app's last dropdown.
  it('the panel holds no dropdown — the mode selector is the only listbox trigger left', () => {
    mountPanel()
    const triggers = screen
      .getAllByRole('button', { hidden: true })
      .filter((b) => b.getAttribute('aria-haspopup') === 'listbox')
    expect(triggers).toHaveLength(1)
    expect(triggers[0].getAttribute('aria-label')).toBe('Mode')
  })
})

// ── Part H: the KEYBOARD CONTRACT role="radiogroup" promises (round-9 Q2) ────────────────────
// Round-8 announced the convention; this is the half that keeps it. Everything here is invisible
// — no pixel moves — so unlike the rest of this file there is no on-device pass to fall back on:
// the owner's phone has no keyboard. These tests are the whole verification.
describe('Settings — the radiogroup keyboard contract', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  const press = (el, key) =>
    act(() => {
      fireEvent.keyDown(el, { key })
    })
  // What the keyboard is pointing at, by the same accessible name the queries use.
  const activeName = () =>
    document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent.trim()
  // ONE tab stop per group, and it is the pill that holds the value — the definition of a roving
  // tabindex. Read through the GROUP, which is the point: two of these groups span two trays.
  const expectOneTabStop = (name) => {
    const stops = pills(name).filter((b) => b.tabIndex === 0)
    expect(stops).toHaveLength(1)
    expect(stops[0].getAttribute('aria-checked')).toBe('true')
  }

  // Before this, every pill in the panel was its own tab stop — 26 of them — while the markup
  // told assistive tech there were seven groups.
  it('every group is ONE tab stop, on the selected pill, in both Use-System states', () => {
    mountPanel()
    PICKERS.forEach(expectOneTabStop)
    // The five pills the group spans include a whole tray with nothing selected in it: the tab
    // stop is a property of the CHOICE, so the empty tray contributes none.
    expect(pills('Date Format').map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1])
    clickToggle('Use System Settings')
    // The theme rows collapse into one choice, so they collapse into one tab stop with it. Every
    // other group is re-swept by name rather than by hand, so the sweep stays exhaustive as
    // PICKERS grows.
    ;[...PICKERS.filter((n) => n !== 'Dark theme' && n !== 'Light theme'), 'Theme'].forEach(
      expectOneTabStop,
    )
    expect(pills('Theme')).toHaveLength(5)
    expect(pills('Theme').filter((b) => b.tabIndex === 0)).toHaveLength(1)
  })

  // Selection follows focus: a radio group is a single choice, so arriving at a pill is choosing
  // it. Both axes move — the vertical pair is not decoration here, since Date Format and Theme
  // stack two trays — and both wrap.
  it('Right/Down and Left/Up move the choice and wrap', () => {
    mountPanel()
    const start = pills('Date Format')[0]
    start.focus()
    press(start, 'ArrowRight')
    expect(activeName()).toBe('Written DMY')
    expect(st().dateFormat).toBe('written-dmy')
    expect(checked('Date Format')).toEqual(['DMY']) // aria-checked followed the arrow
    expectOneTabStop('Date Format') // …and so did the tab stop
    press(document.activeElement, 'ArrowLeft')
    expect(activeName()).toBe('Written MDY')
    expect(st().dateFormat).toBe('written-mdy')
    // Backwards off the front wraps to the last pill of the last tray, forwards off the end
    // comes back to the first.
    press(document.activeElement, 'ArrowLeft')
    expect(activeName()).toBe('Numeric YMD')
    expect(st().dateFormat).toBe('numeric-ymd')
    press(document.activeElement, 'ArrowRight')
    expect(activeName()).toBe('Written MDY')
    expect(st().dateFormat).toBe('written-mdy')
    // Down/Up are the same walk on the other axis.
    press(document.activeElement, 'ArrowDown')
    expect(activeName()).toBe('Written DMY')
    press(document.activeElement, 'ArrowUp')
    expect(activeName()).toBe('Written MDY')
  })

  // THE reason the contract lives on the group: a tray-scoped implementation would stop dead at
  // the end of the tray it was asked about, and hand these two groups two tab stops each.
  it('the arrows cross from one tray into the next — the group is the unit, not the tray', () => {
    mountPanel()
    const lastWritten = pills('Date Format')[1]
    lastWritten.focus()
    expect(rowPills('Written')).toContain(lastWritten) // it really is the end of the first tray
    press(lastWritten, 'ArrowDown')
    expect(activeName()).toBe('Numeric MDY')
    expect(rowPills('Numeric')).toContain(document.activeElement)
    expect(st().dateFormat).toBe('numeric-mdy')
    expectOneTabStop('Date Format') // the stop moved trays with it; the Written tray now has none
    expect(rowPills('Written').filter((b) => b.tabIndex === 0)).toHaveLength(0)
    // Same shape for the themes, where the two rows are one choice only while Use System is off.
    clickToggle('Use System Settings')
    const lastDark = rowPills('Dark')[2]
    lastDark.focus()
    press(lastDark, 'ArrowRight')
    expect(activeName()).toBe('Light')
    expect(st().manualTheme).toBe('light')
    expect(rowChecked('Dark')).toEqual([])
  })

  it('Home and End jump to the ends of the group', () => {
    mountPanel()
    const start = pills('Date Format')[2]
    start.focus()
    press(start, 'End')
    expect(activeName()).toBe('Numeric YMD')
    expect(st().dateFormat).toBe('numeric-ymd')
    press(document.activeElement, 'Home')
    expect(activeName()).toBe('Written MDY')
    expect(st().dateFormat).toBe('written-mdy')
  })

  // The dim's pointer-events-none stops POINTERS. Nothing stopped a keyboard, so a locked picker
  // was still operable by anyone using one — which is exactly the gap the group's inertness fills.
  it('a locked group has no tab stop, ignores the arrows, and SWALLOWS them', () => {
    mountPanel()
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    try {
      clickToggle('Random Format')
      pills('Date Format').forEach((b) => expect(b.tabIndex).toBe(-1))
      // Focus is forced in — the point is that the HANDLER refuses, not merely that Tab can't get
      // there. A locked group must not act on a key even when something has parked focus inside it.
      const pill = pills('Date Format')[0]
      pill.focus()
      press(pill, 'ArrowRight')
      expect(document.activeElement).toBe(pill)
      expect(st().dateFormat).toBe('written-mdy')
      // …and refusing to ACT is only half of inert. Returning early without consuming the key
      // would hand it straight to App's global handler, which maps ArrowLeft/ArrowRight to the
      // game's history buttons — so a locked picker would step the puzzle behind the open panel.
      expect(spy).not.toHaveBeenCalled()
      // Unlocking restores the stop with no interaction at all — the effect re-asserts it.
      clickToggle('Random Format')
      expectOneTabStop('Date Format')
    } finally {
      window.removeEventListener('keydown', spy)
    }
  })

  // App's global handler maps ArrowLeft/ArrowRight to the game's history back/forward buttons, so
  // an arrow the group has consumed has to stop at the group — otherwise walking between pills
  // would also step the puzzle behind the panel.
  it('an arrow the group consumed never reaches the window', () => {
    mountPanel()
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    try {
      const pill = pills('Date Format')[0]
      pill.focus()
      press(pill, 'ArrowRight')
      expect(spy).not.toHaveBeenCalled()
      // The control, which is what makes the assertion above mean anything: the same key from
      // outside any group still reaches the global handler.
      press(document.body, 'ArrowRight')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', spy)
    }
  })

  // THE ENTRY PATH. With Tab bound to the mode selector app-wide, clicking a pill is the only way
  // focus gets into a group — and a <button> is not focused by its own click on Safari (macOS and
  // iOS both), so without PillTray focusing the segment it activates, everything above was
  // unreachable there while working on Chrome and Firefox. The guide and the changelog both
  // promise "click an option, then arrow along the setting"; this is what makes that true
  // everywhere. No manual .focus() anywhere in this test — that is the whole point of it.
  it('clicking a pill puts the keyboard inside its group — the arrows work straight after', () => {
    mountPanel()
    const mdy = group('Date Format').getAllByRole('radio')[0]
    act(() => {
      fireEvent.click(mdy)
    })
    expect(document.activeElement).toBe(mdy)
    press(document.activeElement, 'ArrowRight')
    expect(activeName()).toBe('Written DMY')
    expect(st().dateFormat).toBe('written-dmy')
    // A locked group hands focus to nobody: the click guard returns before the focus, so a
    // synthetic click past the dim's pointer-events-none cannot park the keyboard inside it.
    clickToggle('Random Format')
    document.activeElement.blur()
    act(() => {
      fireEvent.click(pills('Date Format')[3])
    })
    expect(document.activeElement).toBe(document.body)
    expect(st().dateFormat).toBe('written-dmy')
  })

  // The lock, said once at group scope too. A screen reader entering a locked picker used to be
  // told it was live and only found out one element in, at the first segment's aria-disabled.
  it('a locked group announces its own lock, not just its pills', () => {
    mountPanel()
    const announced = () => pickerLockState('Date Format').announced
    expect(announced()).toBeNull()
    clickToggle('Random Format')
    expect(announced()).toBe('true')
    clickToggle('Random Format')
    expect(announced()).toBeNull()
  })

  // The degenerate case no tray can see from inside itself: a value matching no option anywhere
  // in the group — a setting saved by an older build, say. Nothing is checked, so nothing is
  // tabbable, and the group would drop out of the tab order entirely; PillGroup falls back to the
  // first radio. Rendered bare, because the app's own stores can't currently produce the state.
  //
  // The SECOND half is why the group appoints the tab stop instead of each segment declaring its
  // own: recovering from that state has to take the fallback stop back. A segment that rendered
  // its own tabIndex would leave React holding "-1" for the fallback pill — unchanged, therefore
  // never written — and the recovered group would carry TWO tab stops for the rest of its life.
  it('a group whose value matches no option still exposes one tab stop — and gives it back', () => {
    const tray = (value) => (
      <PillGroup label="Orphan">
        <PillTray
          value={value}
          onChange={() => {}}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
      </PillGroup>
    )
    const { rerender } = render(tray('retired-id'))
    const radios = screen.getAllByRole('radio')
    expect(radios.map((b) => b.tabIndex)).toEqual([0, -1])
    expect(radios.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(0)
    rerender(tray('b'))
    expect(screen.getAllByRole('radio').map((b) => b.tabIndex)).toEqual([-1, 0])
  })

  // …and it is drawn ONCE. opacity multiplies down the tree, so a nested wrapper that re-applied
  // the dim would render the group at 0.36 instead of 0.6. Rendered bare because the Theme block
  // is the app's only nesting and it carries no lock — this is the trap one `disabled=` prop away
  // from it. An inherited lock still reaches the segments; only the paint stops at the declarer.
  it('the lock draws its dim once — an inherited lock never re-dims', () => {
    render(
      <PillGroup label="Outer" disabled className="space-y-2">
        <PillGroup className="space-y-1.5">
          <PillTray value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />
        </PillGroup>
      </PillGroup>,
    )
    const outer = screen.getByRole('radiogroup', { name: 'Outer' })
    expect(outer.className).toBe('space-y-2 opacity-60 pointer-events-none')
    expect(outer.firstElementChild.className).toBe('space-y-1.5')
    expect(screen.getByRole('radio').getAttribute('aria-disabled')).toBe('true')
  })
})

// ══ PIXEL GATES — NOT BEHAVIOUR TESTS ════════════════════════════════════════════════════════
//
// ★ THESE ARE THE OWNER'S ZERO-PIXEL-MOVEMENT GATE, and they are INTENTIONALLY COUPLED TO THE
// IMPLEMENTATION. Everything else in this file goes through tests/helpers/settingsPanel so it can
// survive the panel moving out of App; these do the opposite ON PURPOSE. They assert child counts,
// element IDENTITY per index, and exact-equality class strings, because the thing they protect IS
// the markup: the owner's standing rule is that a refactor may not move a single pixel, and the
// only way to hold that line in jsdom — which lays nothing out — is to freeze what the app emits.
//
// So: do NOT route these through the abstraction, and do NOT soften them into `toContain`. An
// abstraction that made them survive a change would be an abstraction that made them pointless.
//
// ⚠ WHAT THIS MEANS FOR THE EXTRACTION. When the panel becomes its own component, the six
// className PROP STRINGS these pin (src/main.tsx — the Date Format group, Input, Jan/Feb Chance,
// the theme wrapper and its two rows) must be carried across VERBATIM, character for character.
// If one of them changes, that is a deliberate re-blessing of the app's look: change the app, look
// at it on a device, and update the string here in the same commit. It is never a silent edit, and
// a red test here is never "the helper needs fixing".
//
// ⚠ AND THEY DEPEND ON A RAW DOM WALK, deliberately kept local. `rowEl` below is the accessor the
// rest of the file retired, because it encodes that a captioned row is exactly the caption's
// parent — which is the very fact the identity assertions are checking.
describe('Settings — PIXEL GATES (implementation-coupled on purpose)', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The raw walk, kept here and nowhere else: caption DIV → its parent. The tagName filter is what
  // keeps it off the same-named 'Light' PILL (a BUTTON).
  const rowEl = (caption) =>
    panel()
      .getAllByText(caption)
      .find((el) => el.tagName === 'DIV').parentElement

  // Round-10 (owner call, reverting round-9's stack): the two trays share ONE ROW again.
  // Theme stacks out of NECESSITY — five theme names measure at zero headroom on any phone
  // narrower than the owner's — and round-9 mistook that forced layout for a rule, applying it
  // here too and costing ~61px of scrolling for consistency with a case that had no choice.
  // These labels are m/d/y-sized and fit a shared row at every width we ship.
  // THE RULE IS ABOUT HOUSINGS, NOT AXIS: each named family gets its own captioned tray; whether
  // the trays sit side by side or stack is a FIT question answered per group. So this asserts the
  // per-row SHAPE is identical to Theme's (that is the rule) while the axis differs (that is fit).
  it('Date Format is TWO captioned trays SHARING ONE ROW, each shaped like a Theme row', () => {
    mountPanel()
    const dateGroup = screen.getByRole('radiogroup', { name: 'Date Format' })
    expect(dateGroup.className).toContain('flex') // side by side, not stacked
    expect(dateGroup.className).not.toContain('space-y-') // no vertical rhythm between them
    expect(dateGroup.children).toHaveLength(2)
    // Both halves share the row evenly — without flex-1 the wider half would starve the other.
    for (const half of dateGroup.children) expect(half.className).toContain('flex-1')
    expect(dateGroup.children[0]).toBe(rowEl('Written'))
    expect(dateGroup.children[1]).toBe(rowEl('Numeric'))
    // The theme rows' shared wrapper spaces its rows with the same token.
    expect(rowEl('Dark').parentElement.className).toContain('space-y-2')
    // …and all four rows are caption-then-tray, nothing else.
    for (const el of [rowEl('Written'), rowEl('Numeric'), rowEl('Dark'), rowEl('Light')]) {
      expect(el.className).toContain('space-y-1.5')
      expect(el.children).toHaveLength(2)
      expect(el.children[0].className).toContain('text-center') // the centred family caption
      expect(el.children[1].className).toContain('surface-tray') // the tray housing
    }
  })

  // ★ THE OWNER'S GATE ON THE ROUND-9 KEYBOARD PASS: zero visual change. tabindex and key handlers
  // carry no pixels, so every class string in the panel's pickers must be byte-for-byte what
  // round-8 and the tray conversion shipped. Written out in full rather than read back from the
  // component, which would agree with itself no matter what it emitted.
  const SEGMENT = 'flex-1 px-1.5 py-1.5 rounded-[calc(var(--radius-xl)-1px)] text-xs font-medium'
  const SELECTED = SEGMENT + ' btn-solid'
  const UNSELECTED = SEGMENT + ' text-(--tx-100-80) hover:bg-(--stgl-hov)'
  const TRAY = 'flex gap-0.5 border surface-tray rounded-xl'
  const expectUnmovedPixels = () =>
    screen.getAllByRole('radio').forEach((b) => {
      expect(b.className).toBe(b.getAttribute('aria-checked') === 'true' ? SELECTED : UNSELECTED)
      expect(b.parentElement.className).toBe(TRAY)
    })

  it('moved no class on any pill, in any state', () => {
    mountPanel()
    expectUnmovedPixels()
    clickToggle('Use System Settings')
    expectUnmovedPixels()
    clickToggle('Random Format') // a locked group is dimmed by its housing, never by its pills
    expectUnmovedPixels()
  })

  // The housings themselves, including the lock's dim — which moved from four hand-written call
  // sites into PillGroup during the round-9 pass and therefore has to be pinned as an exact string.
  it('moved no class on any housing, locked or not', () => {
    mountPanel()
    const cls = (name) => screen.getByRole('radiogroup', { name }).className
    // ⚠ Round-10 retarget, NOT a loosening: Q2's gate was "the keyboard pass moves no pixel", and
    // it still holds — this string changed because the OWNER separately reverted Date Format to
    // one row (round-10), which is a deliberate visual change with its own test above. The pin
    // stays exact so a future keyboard/lock change still cannot move it by accident.
    expect(cls('Date Format')).toBe('flex gap-2')
    expect(cls('Input')).toBe('')
    expect(cls('Jan/Feb Chance on Leap Years')).toBe('')
    expect(rowEl('Dark').parentElement.className).toBe('space-y-2')
    expect(cls('Dark theme')).toBe('space-y-1.5')
    clickToggle('Random Format')
    expect(cls('Date Format')).toBe('flex gap-2 opacity-60 pointer-events-none')
    act(() => st().setMinY(1900)) // all-Gregorian: the Julian row locks, and it has no own class
    expect(cls('Julian Chance')).toBe('opacity-60 pointer-events-none')
  })

  // ★ THE ⚙ FOOTER'S THREE BUTTONS — NEW IN ROUND 15 (B7), and the honest note is that this gate
  // did NOT cover them before. B7 was expected to force a re-blessing here and could not, because
  // nothing in this describe had ever named a footer class string: the owner's zero-pixel rule was
  // being enforced over the pickers, the theme rows and the panel's layout, and the one row that
  // was about to change its look was outside it. So this is the gate catching up, not a drift being
  // blessed — and from here a future edit to the footer's treatment cannot be silent.
  //
  // ★ WHAT CHANGED, AND THAT THE OWNER APPROVED IT. Until B7 a withheld footer button wore
  // `opacity-60 pointer-events-none`. It now wears `opacity-60 cursor-not-allowed` and carries
  // aria-disabled. pointer-events-none had to GO for the cursor to exist at all — a
  // pointer-events:none element is never hit-tested, so a cursor declared on it can never paint —
  // and the not-allowed cursor on a dimmed button is the visible change the owner was told about
  // and accepted. Inertness did not move with it: the handler guards round 14 added are what make
  // these buttons do nothing, and they are untouched.
  //
  // ⚠ THE TRAILING SPACE IN THE OFFERED STRINGS IS REAL AND IS PINNED AS SUCH. It comes from
  // tests/classGlueGuard, which fails the build unless a className literal puts a space BEFORE its
  // `${`; when the conditional then contributes nothing, that space is what is left. Normalising it
  // away here would be pinning a string the app does not emit.
  it('pins the footer buttons’ offered and not-offered class strings, and how they announce', () => {
    mountPanel()
    const foot = (label) =>
      screen.getAllByRole('button').find((b) => b.textContent.trim() === label)
    const SOLID =
      'flex-1 px-3 py-1.5 rounded-xl btn-solid border border-transparent text-xs font-medium overflow-hidden '
    const ROSE =
      'flex-1 px-3 py-1.5 rounded-xl bg-rose-600/90 text-white border border-transparent text-xs font-medium overflow-hidden '
    const OFF = 'opacity-60 cursor-not-allowed'
    // A pristine launch: nothing to save, nothing to reset, nothing to undo — all three withheld.
    expect(foot('Save Defaults').className).toBe(SOLID + OFF)
    expect(foot('Reset Settings').className).toBe(ROSE + OFF)
    expect(foot('Full Reset').className).toBe(ROSE + OFF)
    for (const label of ['Save Defaults', 'Reset Settings', 'Full Reset'])
      expect(foot(label).getAttribute('aria-disabled'), label).toBe('true')
    // One committed setting change offers all three, and the treatment comes off cleanly — no
    // orphaned token, and the attribute ABSENT rather than aria-disabled="false".
    act(() => st().setLeapChance('75'))
    expect(foot('Save Defaults').className).toBe(SOLID)
    expect(foot('Reset Settings').className).toBe(ROSE)
    expect(foot('Full Reset').className).toBe(ROSE)
    for (const label of ['Save Defaults', 'Reset Settings', 'Full Reset'])
      expect(foot(label).getAttribute('aria-disabled'), label).toBeNull()
    // Armed adds the confirm ring and nothing else — the one footer state with two live modifiers.
    fireEvent.click(foot('Full Reset'))
    expect(foot('Confirm?').className).toBe(ROSE + 'ring-2 ring-rose-200 ')
  })

  // ★ THE PANEL'S OWN LAYOUT CONTRACT, and it lives here for the reason the block header gives.
  // These four tokens are what MAKE the panel scroll its list instead of growing off the bottom of
  // a phone, and every one of them is invisible to any behavioural test — jsdom lays nothing out,
  // so removing any of them leaves a fully green suite and a broken panel on a device.
  //
  // ⚠ THEY ARE DELIBERATELY NOT IN THE BEHAVIOUR NET. tests/settingsPanel.chrome carries G12 and
  // used to assert these too; that made it the one case in the net naming raw Tailwind tokens on a
  // live app element, and it would have failed on a harmless re-authoring — a card rendered as its
  // own component, or the cap moved into index.css where --bar-h already lives — while catching
  // none of the seam risks it was aimed at. A pin that forces an edit on the far side of the move
  // cannot be part of a zero-edit gate. Here, "you changed the app's look, bless it deliberately"
  // is exactly what a red test is supposed to mean.
  it('keeps the panel a viewport-capped, non-scrolling column around a shrinkable list', () => {
    mountPanel()
    const card = document.getElementById('settings-popover')
    const list = card.querySelector('[data-drag-scroll]')
    // A COLUMN capped to what is left of the viewport below the bar. Without the cap the panel
    // grows past the bottom of the screen and the footer goes with it.
    expect(card.className).toContain('flex')
    expect(card.className).toContain('flex-col')
    expect(card.className).toContain('max-h-[calc(100dvh')
    expect(card.className).toContain('var(--bar-h)')
    // The CARD itself never scrolls — if it did, the footer would scroll away with the list.
    expect(card.className).not.toMatch(/overflow-y/)
    // ★ min-h-0 IS THE WHOLE THING. A flex child's default min-height is auto, so without it the
    // list refuses to shrink below its content: it never scrolls, it pushes the card past its own
    // cap, and the footer leaves the screen.
    expect(list.className).toContain('flex-1')
    expect(list.className).toContain('min-h-0')
  })
})

// Round 10 item B — the popover's sticky footer is one of the app's four boundary surfaces, and
// its shadow is now progressive: a continuous --shade written by the shared edge hook instead of
// a class toggled off popoverAtBottom and cross-faded by a CSS transition. This is also the site
// the reviewer's 4px-dead-band objection was about, so the "overflows by a hair" case is pinned
// here explicitly: the shadow and the bottom fade mask have to give the same answer.
describe('Settings — the sticky footer’s progressive boundary shadow (round 10 item B)', () => {
  beforeEach(() => {
    resetAppState()
    // index.css is not loaded in jsdom, so the ramp distance the writer reads is stood up by hand
    // at its real value — and BEFORE the mount, since the hook reads it once when it attaches.
    document.documentElement.style.setProperty('--fade-h', '24px')
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    document.documentElement.style.removeProperty('--fade-h')
  })

  const footer = () => document.querySelector('.popover-sticky-footer')
  const scroller = () => panelEl().querySelector('[data-drag-scroll]')
  const shade = (el) => Number(el.style.getPropertyValue('--shade'))
  const scrollTo = (el, top) => {
    el.scrollTop = top
    act(() => {
      fireEvent.scroll(el)
    })
  }

  it('ramps the footer shadow with the panel’s remaining scroll, toggling no class', () => {
    mountPanel()
    const el = scroller()
    // elev-shadow-up is unconditional now; the class list is captured and re-checked at the end.
    expect(footer().className).toContain('elev-shadow-up')
    const classes = footer().className
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, get: () => 1200 },
      clientHeight: { configurable: true, get: () => 400 },
    })
    scrollTo(el, 0)
    expect(shade(footer())).toBe(1) // 800px below → full strength
    scrollTo(el, 1200 - 400 - 14) // 14px from the end → (14 − 4) / (24 − 4)
    expect(shade(footer())).toBe(0.5)
    scrollTo(el, 1200 - 400)
    expect(shade(footer())).toBe(0)
    expect(footer().className).toBe(classes)
  })

  it('stays shadowless on a panel that overflows by a hair — the shadow and the mask agree', () => {
    // The failure a naive progressive rule would have shipped: a 3px overflow is inside the
    // bottom dead band, so the fade mask is off. If the shade were computed from the raw gap the
    // footer would wear a permanent ~12% shadow beside a mask that says there is nothing below —
    // one boundary, two answers. Both readings come off the same measurement, so it cannot happen.
    mountPanel()
    const el = scroller()
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, get: () => 403 },
      clientHeight: { configurable: true, get: () => 400 },
    })
    scrollTo(el, 0)
    expect(shade(footer())).toBe(0)
    expect(el.className).not.toContain('fade-scroll-bottom')
    expect(el.className).not.toContain('fade-scroll-both')
  })
})
