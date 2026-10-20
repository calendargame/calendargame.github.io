// @vitest-environment jsdom
//
// lookupHistory.dom.test.js — store/lookupHistory against REAL (jsdom) storage, end to end, and
// the app-level consequences of round 20: Lookup history left store/progress to become ONE
// list shared by every preset. This file is the "tests/lookupHistory.dom" this round's other files
// (progress, amnesic, persistence, settingsPanel.defaults) point readers at.
//
// Four claims, one section each:
//   (a) the list persists across a real reopen, and untrusted payloads are screened — the
//       store-level twin of what progress.dom used to prove against the OLD key.
//   (c) switching the active preset does not change what Lookup shows — the whole point of the move.
//   (d) Full Reset clears it, from any preset, amnesic or not — the one exception to "Full Reset is
//       a per-preset operation", because there is only one copy of this list to clear.
//   (e) AMNESIC NEVER TOUCHES IT (the owner's rule): a lookup made on any value joins the list and
//       survives the app being reopened. (That the close's forget leaves it alone is tests/amnesic.dom's.)
//
// ⚠ THIS FILE MAY IMPORT store/lookupHistory'S OWN MODULE DIRECTLY, unlike tests/persistence.dom,
// because that file's whole indirection exists to survive the PRESET namespacing scheme — this
// store is deliberately outside that scheme (see its header), so there is no namespacing left to
// insulate against. Its key is named here on purpose, the same way tests/buildStamp.dom and
// tests/changelog.dom name theirs: a GLOBAL key is the contract for those files, not an
// implementation detail about to move.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useLookupHistory } from '../src/store/lookupHistory.js'
import { usePresets } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import {
  resetAppState,
  mountApp,
  pressKey,
  openSettings,
  fireFullReset,
} from './helpers/settingsPanel.jsx'

const LOOKUP_KEY = 'cg-lookup-v1'

// Re-import store/lookupHistory fresh — the same "did it actually reach storage" proof
// tests/helpers/persistence's reopenApp gives the four preset stores, scoped to this one module
// since it sits outside that helper's remit (see this file's header, and that helper's own note).
async function reopenLookupHistory() {
  vi.resetModules()
  const mod = await import('../src/store/lookupHistory.js')
  return { useLookupHistory: mod.useLookupHistory }
}

// A real lookup, driven through the mounted app exactly as a player would: switch to Lookup, type
// the numeric form, press the Lookup button. Written MDY is the factory Date Format, so '7/4/1776'
// reads back as "July 4, 1776" — the same fixture tests/lookupCard.dom uses.
function lookFourthOfJuly() {
  pressKey('L')
  const input = document.querySelector('input[placeholder^="e.g.,"]')
  act(() => fireEvent.change(input, { target: { value: '7/4/1776' } }))
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
}
// Scoped to LookupCard's own history panel via its stable '.lookup-history-header' boundary class
// (see that component's own comment on the class) — a bare 'ul li button' would also match the
// OTHER always-mounted screens' markup, which stay in the DOM (CSS-hidden, not unmounted) while
// Lookup is the active mode.
const historyPanel = () => document.querySelector('.lookup-history-header')?.parentElement ?? null
const historyRowCount = () => historyPanel()?.querySelectorAll('ul li button').length ?? 0
const historyText = () => historyPanel()?.querySelector('ul')?.textContent ?? ''

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (a) THE LIST PERSISTS, AND UNTRUSTED PAYLOADS ARE SCREENED.
describe('the list', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useLookupHistory.getState().setHistory([])
  })

  it('survives a real reopen — the module has never held the value in memory', async () => {
    useLookupHistory.getState().setHistory([{ id: 'a', y: 1776, m: 7, d: 4 }])
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual([{ id: 'a', y: 1776, m: 7, d: 4 }])
  })

  it('a first-ever boot (no key at all) is an empty list, not a crash', async () => {
    localStorage.removeItem(LOOKUP_KEY)
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual([])
  })

  // The screen is unconditional (store/lookupHistory's own comment on normalizeLookupEntries),
  // exercised here against the real key rather than as the pure function in tests/lookupHistory.
  it('a payload with old rendered fields and a junk entry is screened on load', async () => {
    localStorage.setItem(
      LOOKUP_KEY,
      JSON.stringify({
        state: {
          history: [
            { id: 'a', y: 1776, m: 7, d: 4, label: 'July 4, 1776', weekday: 'Thursday' },
            { id: 'trunc' }, // a write that stopped mid-entry
            { id: 'bad', y: 1900, m: 2, d: 30 }, // a date that exists in no calendar
          ],
        },
        version: 1,
      }),
    )
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual([{ id: 'a', y: 1776, m: 7, d: 4 }])
  })

  it('a non-array payload hydrates as an empty list rather than throwing', async () => {
    localStorage.setItem(LOOKUP_KEY, JSON.stringify({ state: { history: 'nope' }, version: 1 }))
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual([])
  })

  it('a corrupt (non-JSON) payload leaves the app on an empty list rather than broken', async () => {
    localStorage.setItem(LOOKUP_KEY, '{"state":{"history"')
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual([])
  })

  it('setHistory accepts a direct value and a functional updater', () => {
    useLookupHistory.getState().setHistory([{ id: 'a', y: 1, m: 1, d: 1 }])
    expect(useLookupHistory.getState().history).toHaveLength(1)
    useLookupHistory.getState().setHistory((prev) => [{ id: 'b', y: 2, m: 2, d: 2 }, ...prev])
    expect(useLookupHistory.getState().history).toHaveLength(2)
    expect(useLookupHistory.getState().history[0].id).toBe('b')
  })

  it('a history of thousands is saved and read back whole — nothing trims it on the way', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      id: `h${i}`,
      y: 1 + (i % 9999),
      m: (i % 12) + 1,
      d: (i % 28) + 1,
    }))
    useLookupHistory.getState().setHistory(many)
    const fresh = await reopenLookupHistory()
    expect(fresh.useLookupHistory.getState().history).toEqual(many)
  })
})

describe('shared across every preset', () => {
  beforeEach(() => resetAppState())

  it('a lookup made on one preset is still shown after switching to another', () => {
    mountApp()
    lookFourthOfJuly()
    expect(historyRowCount()).toBe(1)
    expect(historyText()).toContain('July 4, 1776')

    const p2 = act(() => createPreset())
    act(() => switchPreset(p2.id))
    // Lookup is not one of the six always-mounted screens presets remount — it is not preset data
    // any more — so it is still showing the SAME row, not a blank one, after the switch.
    pressKey('K') // and back — proves the switch didn't quietly wipe the App-level Lookup UI either
    pressKey('L')
    expect(historyRowCount()).toBe(1)
    expect(historyText()).toContain('July 4, 1776')
    expect(useLookupHistory.getState().history).toEqual([
      { id: expect.any(String), y: 1776, m: 7, d: 4 },
    ])
  })

  it('deleting the preset that made the lookup does not touch it either', () => {
    mountApp()
    lookFourthOfJuly()
    const before = useLookupHistory.getState().history
    expect(before).toHaveLength(1)
    // Switch to a second preset FIRST, then delete the one that made the lookup — deletePreset
    // refuses to remove the active preset's last-standing self, and this is the shape a player
    // actually reaches: you can only delete a preset you are not currently on, or one being closed
    // out from under you (presetControl's own deletePreset docs). Either way, clearPresetStorage
    // only ever removes that preset's namespaced keys and its browsing-session parts — nothing in it
    // can reach a key that was never namespaced to begin with.
    const p2 = act(() => createPreset())
    act(() => switchPreset(p2.id))
    act(() => deletePreset(1))
    expect(usePresets.getState().presets.map((p) => p.id)).not.toContain(1)
    expect(useLookupHistory.getState().history).toEqual(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (d) FULL RESET CLEARS IT, FROM ANY PRESET.
describe('Full Reset clears it too', () => {
  beforeEach(() => resetAppState())

  // ⚠ THE OWNER'S EXPLICIT CALL, overriding an earlier draft that left Full Reset unable to
  // reach this list at all (the reasoning at the time: it is shared, and Full Reset is otherwise a
  // strictly per-preset operation). He corrected it: there is only ONE copy of this list, so Full
  // Reset — pressed from ANY preset — clears the one copy there is. main.tsx's fullReset calls
  // clearLookupHistory() directly, the same function Clear History uses, so both buckets go.
  it('a Lookup made before Full Reset is gone after it', () => {
    mountApp()
    lookFourthOfJuly()
    expect(historyRowCount()).toBe(1)
    pressKey('K')
    openSettings()
    fireFullReset()
    expect(useLookupHistory.getState().history).toEqual([])
    pressKey('L')
    expect(historyRowCount()).toBe(0)
  })

  it('in an amnesic preset too', () => {
    mountApp()
    act(() => setPresetAmnesic(1, 'full'))
    lookFourthOfJuly()
    expect(historyRowCount()).toBe(1)
    pressKey('K')
    openSettings()
    fireFullReset()
    expect(useLookupHistory.getState().history).toEqual([])
    pressKey('L')
    expect(historyRowCount()).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (e) AMNESIC NEVER TOUCHES LOOKUP: a lookup is a question you asked, not a stat, so on every value it
// joins the one list, exactly as under Off, and survives the app closing.
describe('a lookup made on any Amnesic value', () => {
  beforeEach(() => resetAppState())

  it('joins the one list as under Off — Off, Stats Only, Full, Stats Only — and survives a reopen', async () => {
    mountApp()
    const lookUp = (text) => {
      pressKey('L')
      const input = document.querySelector('input[placeholder^="e.g.,"]')
      act(() => fireEvent.change(input, { target: { value: text } }))
      act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
    }
    const years = (entries) => entries.map((e) => e.y)
    lookUp('1/1/1900') // Off
    act(() => setPresetAmnesic(1, 'stats'))
    lookUp('1/1/1901')
    act(() => setPresetAmnesic(1, 'full'))
    lookUp('1/1/1902')
    act(() => setPresetAmnesic(1, 'stats'))
    lookUp('1/1/1903')
    expect(years(useLookupHistory.getState().history)).toEqual([1903, 1902, 1901, 1900])
    expect(historyRowCount()).toBe(4)
    expect(years(JSON.parse(localStorage.getItem(LOOKUP_KEY)).state.history)).toEqual([
      1903, 1902, 1901, 1900,
    ])
    // THE CLOSE (sessionStorage is what a real close empties) and a reopen: all four are still there.
    sessionStorage.clear()
    const { useLookupHistory: reopened } = await reopenLookupHistory()
    await act(async () => {
      await reopened.persist.rehydrate()
    })
    expect(years(reopened.getState().history)).toEqual([1903, 1902, 1901, 1900])
  })
})
