// @vitest-environment jsdom
// windowSync.settings — ⚙ SETTINGS, THE MODE SETUP, SAVED DEFAULTS, AND THE JULIAN-ON RANGE IN TWO
// WINDOWS (design-q1-q2.md v4: 4, 6.2, 8.2). The app is mounted in this window; "another window" is a
// second windows-in-sync door over the same device (tests/helpers/otherWindow), or an OLDER build's
// whole-doc save, and the storage events a browser would send are delivered by hand.
//   • another window's change to one setting comes in as that setting alone, at once, with
//     remoteEpoch moved in the same turn;
//   • it does here what the same change made here does when the ⚙ panel closes (the third case,
//     components/useSettingsCloseEffect) - with the panel closed at once, with it open at its close;
//   • the round setup's own switches reset a round when another window changes them; timing turned
//     on elsewhere settles this window's engines as the tap does (modeHooks' useStatsHideToggles);
//   • saved defaults carry their own tag: an older tab's stale copy never undoes a newer save, its
//     own Save Defaults is taken;
//   • a field a newer build wrote is kept through this build's saves;
//   • (8.2) nothing is written for a preset another window deleted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp, openSettings, closeSettings } from './helpers/settingsPanel.jsx'
import { questionText, questionShape } from './helpers/modeScreen.jsx'
import { otherWindow } from './helpers/otherWindow.js'
import { useSettings, SETTINGS_DOC } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DOC } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useJulianRange, JULIAN_RANGE_DOC } from '../src/store/julianRange.js'
import { usePresets, PRESET_STORE_KEYS, PRESET_REGISTRY_KEY } from '../src/store/presets.js'
import { createPreset, switchPreset } from '../src/store/presetControl.js'
import { useRemoteEpoch } from '../src/store/syncedDoc.js'

const ctrl = (name) => screen.getByRole('button', { name })
const begin = () => act(() => fireEvent.click(ctrl('Begin')))
const toBlitz = () => act(() => fireEvent.keyDown(window, { key: 'B' }))
const deviceState = (key) => JSON.parse(localStorage.getItem(key)).state

beforeEach(() => {
  vi.useFakeTimers()
  resetAppState()
  useSettings.getState().setRandomFormat(false)
  useSettings.getState().setDateFormat('numeric-ymd')
  useSettings.getState().setMinY(1583)
  useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  document.getElementById('root')?.remove()
})

describe('a setting changed in another window', () => {
  it('comes in at once, as that setting alone, and says it came from elsewhere', () => {
    mountApp()
    const W = otherWindow()
    const epoch = useRemoteEpoch.getState().settings
    act(() => useSettings.getState().setMaxY(9000)) // this window's own change…
    W.save(SETTINGS_DOC, { useSystem: false, manualTheme: 'nebula' }) // …and the other window's
    W.deliver()
    expect(useSettings.getState().manualTheme).toBe('nebula')
    expect(useSettings.getState().useSystem).toBe(false)
    expect(useSettings.getState().maxY).toBe(9000)
    expect(useRemoteEpoch.getState().settings).toBe(epoch + 1)
    const saved = deviceState(PRESET_STORE_KEYS.settings)
    expect([saved.manualTheme, saved.maxY]).toEqual(['nebula', 9000])
  })

  it('does here what the same change does at a ⚙ close: the waiting question is drawn again', () => {
    mountApp()
    const W = otherWindow()
    expect(questionShape()).toBe('numeric YMD')
    W.save(SETTINGS_DOC, { dateFormat: 'numeric-dmy' })
    W.deliver()
    expect(questionShape()).toBe('numeric DMY')
  })

  it('a live Blitz round resets at once with the panel closed — and only at its close with it open', () => {
    mountApp()
    toBlitz()
    const W = otherWindow()
    begin()
    W.save(MODE_PREFS_DOC, { blitzSec: 30 })
    W.deliver()
    expect(ctrl('Begin')).toBeInTheDocument() // reset, as a ⚙ change does at its close
    begin()
    openSettings()
    W.save(MODE_PREFS_DOC, { blitzSec: 45 })
    W.deliver()
    expect(useModePrefs.getState().blitzSec).toBe(45) // shown in the panel…
    closeSettings()
    expect(ctrl('Begin')).toBeInTheDocument() // …and applied at its close
  })

  it('the round setup’s own switches (idle-locked here) reset a live round when changed elsewhere', () => {
    mountApp()
    toBlitz()
    const W = otherWindow()
    begin()
    W.save(MODE_PREFS_DOC, { blitzAllowMistakes: !useModePrefs.getState().blitzAllowMistakes })
    W.deliver()
    expect(ctrl('Begin')).toBeInTheDocument()
  })

  it('a change made HERE with the panel closed is not taken for another window’s', () => {
    mountApp()
    toBlitz()
    const W = otherWindow()
    act(() => useModePrefs.getState().setBlitzAllowMistakes((v) => !v)) // idle: allowed here
    begin()
    W.save(SETTINGS_DOC, { useSystem: false, manualTheme: 'nebula' }) // a setting no round reads
    W.deliver()
    expect(ctrl('Reset')).toBeInTheDocument() // the round runs on
  })

  it('timing turned on elsewhere settles this window’s question as the tap does: drawn again', () => {
    act(() => useModePrefs.getState().setClassicTimingOff(true))
    mountApp()
    const W = otherWindow()
    const before = questionText()
    W.save(MODE_PREFS_DOC, { classicTimingOff: false })
    W.deliver()
    expect(useModePrefs.getState().classicTimingOff).toBe(false)
    expect(questionText()).not.toBe(before)
  })

  it('the Julian-on Year Range changed elsewhere comes in like the rest', () => {
    mountApp()
    const W = otherWindow()
    W.save(JULIAN_RANGE_DOC, { julianMinY: 1700, julianMaxY: 2000 })
    W.deliver()
    expect([useJulianRange.getState().julianMinY, useJulianRange.getState().julianMaxY]).toEqual([
      1700, 2000,
    ])
  })
})

describe('fields and versions only a build that knows them reads', () => {
  it('a field a newer build wrote is kept through this build’s saves', () => {
    const W = otherWindow()
    W.olderSave(PRESET_STORE_KEYS.settings, (s) => ({ ...s, aFutureSetting: 'kept' }))
    W.deliver()
    act(() => useSettings.getState().setMaxY(8000))
    expect(deviceState(PRESET_STORE_KEYS.settings)).toMatchObject({
      aFutureSetting: 'kept',
      maxY: 8000,
    })
  })

  it('saved defaults: an older tab’s stale copy never undoes a newer save; its own save is taken', () => {
    const snapshot = (flashMs) => ({
      settings: { ...useSettings.getState() },
      prefs: { flashMs, blitzSec: 60, blitzQSec: 10, aoxN: '10' },
      amnesic: 'off',
    })
    act(() => useUserDefaults.getState().saveDefaults(snapshot(700)))
    const key = PRESET_STORE_KEYS.userDefaults
    const stale = deviceState(key) // an older tab loads here…
    // …and two newer saves after it: the copy it holds is two versions back, which only the snapshot's
    // own tag can tell (the sync key keeps the value just before the newest, not every one before it)
    act(() => useUserDefaults.getState().saveDefaults(snapshot(800)))
    act(() => useUserDefaults.getState().saveDefaults(snapshot(900)))
    const W = otherWindow()
    // The older tab saves the doc back as it loaded it (its migration, say): the snapshot it carries
    // is the older one, its tag intact.
    W.olderSave(key, () => stale)
    W.deliver()
    expect(useUserDefaults.getState().saved.prefs.flashMs).toBe(900)
    expect(deviceState(key).saved.prefs.flashMs).toBe(900)
    // Its own Save Defaults is a snapshot with no tag: taken.
    W.olderSave(key, () => ({ saved: { ...snapshot(500), amnesic: false } }))
    W.deliver()
    expect(useUserDefaults.getState().saved.prefs.flashMs).toBe(500)
    expect(useUserDefaults.getState().saved).not.toHaveProperty('w') // the tag never reaches the store
  })
})

describe('a preset another window deleted (8.2)', () => {
  it('gets nothing written for it here, and this window moves off it', async () => {
    const p2 = createPreset('Guest')
    const p3 = createPreset('Later') // (made after it: an older tab's copy listing this one proves it knew Guest - 8.1)
    act(() => switchPreset(p2.id))
    const key = `${PRESET_STORE_KEYS.settings}~p${p2.id}`
    act(() => useSettings.getState().setMaxY(7000))
    expect(localStorage.getItem(key)).not.toBeNull()
    // Another window - an older tab that had loaded both - deletes it: the list without it, and its keys
    // removed - and this window has not been told yet (the read lag).
    const W = otherWindow()
    W.olderSave(PRESET_REGISTRY_KEY, (s) => ({
      ...s,
      presets: s.presets.filter((p) => p.id !== p2.id),
      activeId: 1,
    }))
    for (const k of Object.keys(localStorage)) if (k.endsWith(`~p${p2.id}`)) W.write(k, null)
    act(() => useSettings.getState().setMaxY(6000))
    expect(localStorage.getItem(key)).toBeNull() // nothing written for a preset that is gone
    await act(async () => {
      await Promise.resolve()
    })
    expect(usePresets.getState().activeId).toBe(p3.id) // …and the list's merge moved this window off it
  })
})
