// @vitest-environment jsdom
//
// lookupHistory.dom.test.js — store/lookupHistory against REAL (jsdom) storage, end to end, and
// the app-level consequences of Q1 (round 20): Lookup history left store/progress to become ONE
// list shared by every preset, with a session-only overflow for lookups made while the active
// preset is Amnesic. This file is the "tests/lookupHistory.dom" this round's other files (progress,
// amnesic, persistence, settingsPanel.defaults) point readers at.
//
// Five claims, one section each:
//   (a) the permanent list persists across a real reopen, and untrusted payloads are screened —
//       the store-level twin of what progress.dom used to prove against the OLD key.
//   (b) the session-only bucket is sessionStorage-backed: survives a refresh, gone on a close.
//   (c) switching the active preset does not change what Lookup shows — the whole point of the move.
//   (d) Full Reset clears it, from any preset, amnesic or not — the one exception to "Full Reset is
//       a per-preset operation", because there is only one copy of this list to clear.
//   (e) an amnesic preset's lookups never join the permanent list, and do not survive the app
//       being reopened (sessionStorage.clear() + rehydrate — the SAME "close" simulation
//       tests/amnesic.dom uses for the stats session copy) — while a non-amnesic preset's lookups
//       persist through it normally.
//
// ⚠ THIS FILE MAY IMPORT store/lookupHistory'S OWN MODULE DIRECTLY, unlike tests/persistence.dom,
// because that file's whole indirection exists to survive the PRESET namespacing scheme — this
// store is deliberately outside that scheme (see its header), so there is no namespacing left to
// insulate against. Its two keys are named here on purpose, the same way tests/buildStamp.dom and
// tests/changelog.dom name theirs: a GLOBAL key is the contract for those files, not an
// implementation detail about to move.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import {
  useLookupHistory,
  useLookupSession,
  LOOKUP_HISTORY_CAP,
} from '../src/store/lookupHistory.js'
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
  tap,
  openSettings,
  fullResetButton,
} from './helpers/settingsPanel.jsx'

const LOOKUP_KEY = 'cg-lookup-v1'
const SESSION_KEY = 'cg-lookup-session-v1'

// Re-import store/lookupHistory fresh — the same "did it actually reach storage" proof
// tests/helpers/persistence's reopenApp gives the four preset stores, scoped to this one module
// since it sits outside that helper's remit (see this file's header, and that helper's own note).
async function reopenLookupHistory() {
  vi.resetModules()
  const mod = await import('../src/store/lookupHistory.js')
  return { useLookupHistory: mod.useLookupHistory, useLookupSession: mod.useLookupSession }
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
// (a) THE PERMANENT LIST PERSISTS, AND UNTRUSTED PAYLOADS ARE SCREENED.
describe('the permanent list', () => {
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

  it('setHistory accepts a direct value and a functional updater, capped at LOOKUP_HISTORY_CAP', () => {
    useLookupHistory.getState().setHistory([{ id: 'a', y: 1, m: 1, d: 1 }])
    expect(useLookupHistory.getState().history).toHaveLength(1)
    useLookupHistory.getState().setHistory((prev) => [{ id: 'b', y: 2, m: 2, d: 2 }, ...prev])
    expect(useLookupHistory.getState().history).toHaveLength(2)
    expect(useLookupHistory.getState().history[0].id).toBe('b')
    expect(LOOKUP_HISTORY_CAP).toBe(100) // the number How-to-Play states — pinned so it reads as a decision
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (b) THE SESSION-ONLY OVERFLOW: sessionStorage-backed, survives a refresh, gone on a close.
describe('the session-only overflow (amnesic suppression bucket)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useLookupSession.getState().setSessionEntries([])
  })

  it('lives in sessionStorage, under its own key — not the permanent one', () => {
    useLookupSession.getState().setSessionEntries([{ id: 'a', y: 1, m: 1, d: 1 }])
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull()
    expect(localStorage.getItem(LOOKUP_KEY)).toBeNull() // never mirrored to the permanent key
  })

  it('a reload keeps it — only a close ends it (the same promise Amnesic states for stats)', async () => {
    useLookupSession.getState().setSessionEntries([{ id: 'a', y: 1, m: 1, d: 1 }])
    await useLookupSession.persist.rehydrate() // the refresh: same tab, same sessionStorage
    expect(useLookupSession.getState().sessionEntries).toEqual([{ id: 'a', y: 1, m: 1, d: 1 }])
  })

  it('closing the app (sessionStorage cleared) leaves it empty on the way back in', async () => {
    useLookupSession.getState().setSessionEntries([{ id: 'a', y: 1, m: 1, d: 1 }])
    sessionStorage.clear() // the close
    await useLookupSession.persist.rehydrate() // …and the next launch reads storage again
    expect(useLookupSession.getState().sessionEntries).toEqual([])
  })

  it('is screened on load exactly like the permanent list — untrusted storage either way', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        state: { sessionEntries: [{ id: 'ok', y: 1, m: 1, d: 1 }, { id: 'x' }] },
        version: 1,
      }),
    )
    await useLookupSession.persist.rehydrate()
    expect(useLookupSession.getState().sessionEntries).toEqual([{ id: 'ok', y: 1, m: 1, d: 1 }])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (c) SHARED ACROSS EVERY PRESET — the whole point of the move. Driven with the real <App/>
// mounted, exactly like tests/presetSwitch.dom, because the claim is about what the SCREEN shows,
// not just where the bytes sit.
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
    // only ever removes that preset's four namespaced keys plus its session stats copy — nothing
    // in it can reach a key that was never namespaced to begin with.
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

  // ⚠ THE OWNER'S EXPLICIT CALL, overriding an earlier draft of Q1 that left Full Reset unable to
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
    tap(fullResetButton()) // arm
    tap(fullResetButton()) // confirm
    expect(useLookupHistory.getState().history).toEqual([])
    pressKey('L')
    expect(historyRowCount()).toBe(0)
  })

  it('clears the session overflow too, in an amnesic preset', () => {
    mountApp()
    act(() => setPresetAmnesic(1, true))
    lookFourthOfJuly() // held in the session overflow — see the next describe block
    expect(historyRowCount()).toBe(1)
    pressKey('K')
    openSettings()
    tap(fullResetButton())
    tap(fullResetButton())
    // The entry never reached the permanent list (it is amnesic — see the next describe block), and
    // clearLookupHistory() empties BOTH buckets regardless of which one actually held anything, so
    // the session overflow is wiped right alongside the (already-empty) permanent list.
    expect(useLookupHistory.getState().history).toEqual([])
    expect(useLookupSession.getState().sessionEntries).toEqual([])
    pressKey('L')
    expect(historyRowCount()).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (e) AMNESIC SUPPRESSION: a lookup made while the active preset is amnesic never joins the
// permanent list, still shows for the rest of the session, and does not survive the app being
// reopened — while a non-amnesic preset's lookup persists through the identical reopen normally.
describe('a lookup made while the active preset is amnesic', () => {
  beforeEach(() => resetAppState())

  it('shows on screen, but is held in the session overflow, never the permanent list', () => {
    mountApp()
    act(() => setPresetAmnesic(1, true))
    lookFourthOfJuly()
    expect(historyRowCount()).toBe(1)
    expect(historyText()).toContain('July 4, 1776')
    expect(useLookupHistory.getState().history).toEqual([]) // the permanent list never saw it
    expect(useLookupSession.getState().sessionEntries).toEqual([
      { id: expect.any(String), y: 1776, m: 7, d: 4 },
    ])
  })

  // ★★ THE CASE THE BRIEF IS BUILT AROUND. "The app is reopened" — the exact simulation
  // tests/amnesic.dom uses for the stats session copy: sessionStorage is what a real close empties,
  // so clearing it and rehydrating in place is the honest jsdom stand-in for closing the tab and
  // opening it again (see that file's own header for why this is a close and not merely a reload).
  it('does not survive the app being reopened, while a non-amnesic lookup does', async () => {
    mountApp()
    act(() => setPresetAmnesic(1, true))
    lookFourthOfJuly() // 7/4/1776 — session-only
    pressKey('K')

    act(() => setPresetAmnesic(1, false)) // back to normal — the session entry is not reconciled in
    // Ask the SAME date again, now while non-amnesic. LookupCard's runLookup() matches on y/m/d
    // against the merged display (which still shows the amnesic entry) and calls onMoveHistory, not
    // onAddHistory — so this exercises moveHistoryEntryToTop's own "stays in whichever list it came
    // from" rule (main.tsx): it re-affirms the SAME session entry rather than pushing a new
    // permanent one. Prove the permanent list stays empty here, before reopening, so the reopen
    // assertion below is unambiguous about what it is testing.
    lookFourthOfJuly()
    expect(useLookupHistory.getState().history).toEqual([])
    expect(useLookupSession.getState().sessionEntries).toHaveLength(1)

    // Add a genuinely NEW, non-amnesic lookup — this is the one that must survive the reopen.
    pressKey('L')
    const input = document.querySelector('input[placeholder^="e.g.,"]')
    act(() => fireEvent.change(input, { target: { value: '1/1/1900' } }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
    expect(useLookupHistory.getState().history).toEqual([
      { id: expect.any(String), y: 1900, m: 1, d: 1 },
    ])
    pressKey('K')

    // THE CLOSE.
    sessionStorage.clear()
    await act(async () => {
      await useLookupSession.persist.rehydrate()
    })

    expect(useLookupSession.getState().sessionEntries).toEqual([]) // gone
    expect(useLookupHistory.getState().history).toEqual([
      { id: expect.any(String), y: 1900, m: 1, d: 1 },
    ]) // still here

    pressKey('L')
    expect(historyRowCount()).toBe(1) // only the permanent one shows — the amnesic 7/4/1776 is gone
    expect(historyText()).not.toContain('July 4, 1776')
    expect(historyText()).toContain('January 1, 1900')
  })

  it('turning Amnesic off does not reach back and promote what is already in the session bucket', () => {
    mountApp()
    act(() => setPresetAmnesic(1, true))
    lookFourthOfJuly()
    expect(useLookupSession.getState().sessionEntries).toHaveLength(1)
    act(() => setPresetAmnesic(1, false))
    // No merge on toggle-off — the same rule store/amnesic states for stats. The entry is still
    // only in the session bucket; it did not just become permanent because Amnesic turned off.
    expect(useLookupHistory.getState().history).toEqual([])
    expect(useLookupSession.getState().sessionEntries).toHaveLength(1)
  })
})
