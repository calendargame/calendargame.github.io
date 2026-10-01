// @vitest-environment jsdom
//
// openIn.dom — THE ⚙ PANEL'S "Open in" DROPDOWN (round 23), in the real app.
//
// Presets are unlimited, so "Open in" stopped being a tray (one segment per preset, a height that
// grew with the count) and became the SAME dropdown as the top-bar preset switcher: one trigger row
// whose height no preset count changes, and a list that floats over the ⚙ card. What this file pins
// is the wiring inside the real panel — the list's contents, that a pick pins the preset and leaves
// the panel up, that Escape peels one layer, that the ⚙ card's scroll region is held still while
// the list is open, and that a press-drag release on it cannot take the panel down. CustomSelect's
// own long-list and scroll-hold mechanics are pinned in tests/customselect.dom; the store's pin in
// tests/presets.dom. jsdom lays nothing out, so how it LOOKS is a real-browser and device check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, within, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  openSettings,
  panelEl,
  isSettingsOpen,
} from './helpers/settingsPanel.jsx'
import { usePresets } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  setOpenInPreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { forgetBrowsingSession } from '../src/store/browsingSession.js'

const openInTrigger = () => screen.getByRole('button', { name: /^Open in,/ })
const list = () => screen.getByRole('listbox', { name: 'Open in' })
const optionNames = () =>
  within(list())
    .getAllByRole('option')
    .map((o) => o.textContent)

beforeEach(() => {
  resetAppState()
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  resetAppState()
})

// ── The pin decides a FRESH OPEN, never a reload ────────────────────────────────────────────────
// A reload is the same browsing session ("only truly closing the app starts fresh"): it stays on the
// preset the player was on. Applied on every load, the pin took a guest playing in an Amnesic preset
// and dropped them — on a pull-to-refresh or the app's own update reload — into the pinned permanent
// one, where their next answers were saved.
// A page load is modelled as what it is: the tree gone, every store hydrating again from storage, a
// new mount. A real close additionally ends the browsing session (the browser clears sessionStorage).
describe('the pin applies on a fresh open only', () => {
  const pageLoad = () => {
    cleanup()
    document.getElementById('root')?.remove()
    act(() => {
      usePresets.persist.rehydrate()
      useSettings.persist.rehydrate()
      useModePrefs.persist.rehydrate()
      useProgress.persist.rehydrate()
      useUserDefaults.persist.rehydrate()
    })
    mountApp()
  }
  const reload = pageLoad
  const closeAndReopen = () => {
    sessionStorage.clear()
    forgetBrowsingSession()
    pageLoad()
  }
  const diskActiveId = () => JSON.parse(localStorage.getItem('cg-presets-v1')).state.activeId

  it('a reload keeps you on the preset you were on, whatever is pinned', () => {
    mountApp()
    let p2
    act(() => {
      p2 = createPreset()
    })
    act(() => setOpenInPreset(p2.id)) // pin preset 2 — while on preset 1
    reload()
    expect(usePresets.getState().activeId).toBe(1)
    // …and the other way round: on preset 2, pinned to preset 1.
    act(() => setOpenInPreset(1))
    act(() => switchPreset(p2.id))
    reload()
    expect(usePresets.getState().activeId).toBe(p2.id)
  })

  it('a fresh open lands in the pinned preset — and a reload right after it stays there', () => {
    mountApp()
    let p2
    act(() => {
      p2 = createPreset()
    })
    act(() => setOpenInPreset(p2.id))
    expect(diskActiveId()).toBe(1) // the last visit ends on preset 1
    closeAndReopen()
    expect(usePresets.getState().activeId).toBe(p2.id)
    // The open wrote down where it landed, so the reload reads preset 2 off the device — not the
    // preset the LAST visit ended on.
    expect(diskActiveId()).toBe(p2.id)
    reload()
    expect(usePresets.getState().activeId).toBe(p2.id)
  })
})

describe('"Open in" is a dropdown', () => {
  it('lists "Last used" and then every preset, the amnesic ones marked as in the top bar', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
    })
    mountApp()
    // After the mount: round 21 reseeds Amnesic from saved defaults on a cold open.
    act(() => setPresetAmnesic(3, true))
    openSettings('key')
    fireEvent.click(openInTrigger())
    // The ✓ column is part of each option's text, so the selected row reads "✓Last used". An
    // amnesic row's text is what is DRAWN (the name, the A) followed by what is SPOKEN in their
    // place (the one sr-only phrase) — components/PresetSwitcher's shared label.
    expect(optionNames()).toEqual(['✓Last used', 'Preset 1', 'Timed', 'GuestAGuest, amnesic'])
    expect(screen.getByRole('option', { name: 'Guest, amnesic' })).toBeTruthy()
  })

  it('the trigger is ONE control however many presets there are — no tray, no segment per preset', () => {
    act(() => {
      for (let i = 0; i < 29; i++) createPreset()
    })
    mountApp()
    openSettings('key')
    expect(usePresets.getState().presets).toHaveLength(30)
    expect(screen.queryByRole('radiogroup', { name: 'Open in' })).toBeNull()
    expect(openInTrigger().getAttribute('aria-haspopup')).toBe('listbox')
    // The closed control draws nothing per preset outside its own trigger button.
    const wrapper = openInTrigger().closest('[data-drag-stay]')
    expect(wrapper.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(openInTrigger())
    expect(within(list()).getAllByRole('option')).toHaveLength(31)
  })

  it('picking a preset pins it, closes the list, and leaves the ⚙ panel open', () => {
    act(() => {
      createPreset('Timed')
    })
    mountApp()
    openSettings('key')
    fireEvent.click(openInTrigger())
    const timed = within(list())
      .getAllByRole('option')
      .find((o) => o.textContent.includes('Timed'))
    // A real tap: the press lands on the portaled option (outside the ⚙ card in the DOM)…
    fireEvent.pointerDown(timed)
    fireEvent.click(timed)
    expect(usePresets.getState().openInPreset).toBe(2)
    expect(screen.queryByRole('listbox', { name: 'Open in' })).toBeNull()
    expect(isSettingsOpen()).toBe(true) // …and the panel under it survived that press
    expect(openInTrigger().textContent).toContain('Timed')
    // "Last used" is a real choice too, not a way back to a default the list cannot name.
    fireEvent.click(openInTrigger())
    fireEvent.click(within(list()).getAllByRole('option')[0])
    expect(usePresets.getState().openInPreset).toBe('last')
  })

  it('Escape peels ONE layer: the list first, then (a second press) the panel', () => {
    mountApp()
    openSettings('key')
    fireEvent.click(openInTrigger())
    fireEvent.keyDown(openInTrigger(), { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Open in' })).toBeNull()
    expect(isSettingsOpen()).toBe(true)
    fireEvent.keyDown(openInTrigger(), { key: 'Escape' })
    expect(isSettingsOpen()).toBe(false)
  })

  // The trigger lives inside the ⚙ card's scroll region, so while its list is open that region is
  // held still (CustomSelect's caller contract, second route) and let go when it closes. jsdom has
  // no stylesheet, so the region's overflow-y:auto is given inline here the way the real class
  // gives it; what is asserted is that the hold finds THIS region and restores it exactly.
  it('holds the ⚙ card`s scroll region still while the list is open', () => {
    mountApp()
    openSettings('key')
    const region = panelEl().querySelector('[data-drag-scroll]')
    region.style.overflowY = 'auto'
    fireEvent.click(openInTrigger())
    expect(region.style.overflowY).toBe('hidden')
    fireEvent.keyDown(openInTrigger(), { key: 'Escape' })
    expect(region.style.overflowY).toBe('auto')
  })

  // The ⚙ card is data-drag-dismiss: a press-drag from the gear that releases on a control clicks it
  // and closes the panel. Releasing on "Open in" opens its list, and the panel must stay up under
  // it — so the control opts out, as the Manage Presets button beside it does.
  it('opts out of drag-dismiss, so a press-drag release on it cannot close the panel', () => {
    mountApp()
    openSettings('key')
    expect(openInTrigger().closest('[data-drag-stay]')).not.toBeNull()
    expect(openInTrigger().hasAttribute('data-select-trigger')).toBe(false) // not a press-drag menu
  })
})
