// @vitest-environment jsdom
//
// sessionLookup — LOOKUP'S SCREEN SURVIVES A RELOAD, and not a real close (store/sessionLookup).
//
// The history LIST has always been saved. What was on the screen above it — the text in the date box,
// the answer or message being shown, the selected history row, and whether Show Codes is open — was
// plain App state, so a pull-to-refresh or the app's own update reload emptied the box and shut the
// codes. Those values are kept for the browsing session now ("only truly closing the app starts
// fresh"), written as they change — together with the Date Format the box's text was written in,
// because the screen is the app's and not a preset's: it also survives a preset switch, an Amnesic
// toggle and deleting the preset you are on, and the incoming preset may type dates differently.
//
// A reload is modelled as what it is: the tree gone, sessionStorage exactly as the page left it, a new
// mount. A real close additionally ends the browsing session — the browser clears sessionStorage.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp, openSettings, fireFullReset } from './helpers/settingsPanel.jsx'
import {
  readLookupScreen,
  writeLookupScreen,
  discardLookupScreen,
  EMPTY_LOOKUP_SCREEN,
} from '../src/store/sessionLookup.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { forgetBrowsingSession } from '../src/store/browsingSession.js'

const KEY = 'cg-lookup-screen-v1'
const HINT = 'Enter a date to see its weekday.'

describe('the store: what is kept, and what is refused', () => {
  beforeEach(() => discardLookupScreen())

  it('round-trips the six values', () => {
    const s = {
      input: '7/4/1776',
      output: '',
      calcDate: { y: 1776, m: 7, d: 4 },
      selectedId: 'abc',
      calcOpen: true,
      format: 'written-mdy',
    }
    writeLookupScreen(s)
    expect(readLookupScreen()).toEqual(s)
  })

  it('the launch screen keeps nothing at all', () => {
    writeLookupScreen({ ...EMPTY_LOOKUP_SCREEN, input: 'x' })
    expect(sessionStorage.getItem(KEY)).not.toBe(null)
    writeLookupScreen(EMPTY_LOOKUP_SCREEN)
    expect(sessionStorage.getItem(KEY)).toBe(null)
    expect(readLookupScreen()).toEqual(EMPTY_LOOKUP_SCREEN)
  })

  it.each([
    ['not JSON', '{"input":'],
    ['not an object', '42'],
    ['a field of the wrong type', JSON.stringify({ ...EMPTY_LOOKUP_SCREEN, calcOpen: 'yes' })],
    ['a missing field', JSON.stringify({ input: 'x' })],
    ['a format that is not text', JSON.stringify({ ...EMPTY_LOOKUP_SCREEN, format: 7 })],
    [
      'a date that is not one',
      JSON.stringify({ ...EMPTY_LOOKUP_SCREEN, calcDate: { y: 2000, m: 13, d: 1 } }),
    ],
    [
      'a date with a part missing',
      JSON.stringify({ ...EMPTY_LOOKUP_SCREEN, calcDate: { y: 2000, m: 1 } }),
    ],
  ])('%s reads as the launch screen', (_, raw) => {
    sessionStorage.setItem(KEY, raw)
    expect(readLookupScreen()).toEqual(EMPTY_LOOKUP_SCREEN)
  })

  it('carries nothing extra back from a tampered value', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        ...EMPTY_LOOKUP_SCREEN,
        input: 'x',
        calcDate: { y: 2000, m: 1, d: 2, evil: true },
        extra: 1,
      }),
    )
    expect(readLookupScreen()).toEqual({
      ...EMPTY_LOOKUP_SCREEN,
      input: 'x',
      calcDate: { y: 2000, m: 1, d: 2 },
    })
  })
})

describe('on the app', () => {
  let app
  const press = (key) => act(() => fireEvent.keyDown(window, { key }))
  const field = () => document.querySelector('input[placeholder^="e.g.,"]')
  const type = (text) => act(() => fireEvent.change(field(), { target: { value: text } }))
  const lookup = (text) => {
    type(text)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Lookup' })))
  }
  const codesSection = () => document.querySelector('.lookup-method-section')
  // The answer slot: the selected row's date and reading, an error message, or the standing hint.
  const answerSlot = () => document.querySelector('.text-sm.min-h-15').textContent
  const codesButton = () => screen.getByRole('button', { name: /Show Codes|Hide Codes/ })
  const codesOpen = () => codesButton().getAttribute('aria-expanded') === 'true'
  const reload = () => {
    const kept = Array.from({ length: sessionStorage.length }, (_, i) => {
      const k = sessionStorage.key(i)
      return [k, sessionStorage.getItem(k)]
    })
    app.unmount()
    cleanup()
    document.getElementById('root')?.remove()
    sessionStorage.clear()
    for (const [k, v] of kept) sessionStorage.setItem(k, v)
    app = mountApp()
  }
  const closeAndReopen = () => {
    app.unmount()
    cleanup()
    document.getElementById('root')?.remove()
    sessionStorage.clear()
    forgetBrowsingSession()
    app = mountApp()
  }

  beforeEach(() => {
    resetAppState()
    app = mountApp()
    press('L')
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('a reload keeps the looked-up date, its answer, the selected row and the open codes', () => {
    lookup('7/4/1776')
    lookup('3/14/1592') // two rows; the newest is selected
    act(() => fireEvent.click(screen.getByText('July 4, 1776'))) // select the OLDER row
    act(() => fireEvent.click(codesButton()))
    expect(codesOpen()).toBe(true)
    expect(field().value).toBe('7/4/1776')

    reload()
    expect(field().value).toBe('7/4/1776') // the page (Lookup) and the box
    expect(answerSlot()).toBe('July 4, 1776Thursday') // the selected (older) row's answer
    expect(codesOpen()).toBe(true)
    expect(codesSection()).not.toBe(null)
  })

  it('a reload keeps text typed but not yet looked up, and an error message', () => {
    lookup('99/99/1776')
    const message = answerSlot()
    expect(message).not.toBe(HINT)
    type('12/2')
    reload()
    expect(field().value).toBe('12/2')
    expect(answerSlot()).toBe(message)
  })

  it('a real close starts Lookup empty — the history list is still there', () => {
    lookup('7/4/1776')
    act(() => fireEvent.click(codesButton()))
    closeAndReopen()
    press('L')
    expect(field().value).toBe('')
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(codesOpen()).toBe(false)
    expect(screen.getByText('July 4, 1776')).toBeInTheDocument() // the saved history row
  })

  it('Clear empties what is kept', () => {
    lookup('7/4/1776')
    expect(sessionStorage.getItem(KEY)).not.toBe(null)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(sessionStorage.getItem(KEY)).toBe(null)
  })

  // ── The screen is the app's, not a preset's ────────────────────────────────────────────────────
  // The history list is shared by every preset, so what is selected in it — and the box, the answer
  // and the open codes that follow from it — survives everything that swaps the data under the mode
  // screens. (All three used to empty it.)
  const lookedUp = () => {
    lookup('7/4/1776')
    act(() => fireEvent.click(codesButton()))
  }
  const expectLookedUp = () => {
    expect(field().value).toBe('7/4/1776')
    expect(answerSlot()).toBe('July 4, 1776Thursday')
    expect(codesOpen()).toBe(true)
  }
  let p2
  const makeSecondPreset = () => act(() => void (p2 = createPreset()))

  it('a preset switch keeps the screen — with Lookup on show in both presets', () => {
    makeSecondPreset()
    act(() => switchPreset(p2.id))
    press('L') // preset 2's page is Lookup too
    act(() => switchPreset(1))
    lookedUp()
    act(() => switchPreset(p2.id))
    expectLookedUp()
  })

  it('a preset switch keeps the screen — through a page that is not Lookup, and back', () => {
    lookedUp()
    makeSecondPreset()
    act(() => switchPreset(p2.id)) // first visit → Classic; the Lookup card is not even mounted
    press('L')
    expectLookedUp()
    act(() => switchPreset(1))
    expectLookedUp()
  })

  it('an Amnesic toggle keeps the screen', () => {
    lookedUp()
    act(() => setPresetAmnesic(1, true))
    expectLookedUp()
    act(() => setPresetAmnesic(1, false))
    expectLookedUp()
  })

  it('deleting the preset you are on keeps the screen', () => {
    makeSecondPreset()
    act(() => switchPreset(p2.id))
    press('L')
    lookedUp()
    act(() => deletePreset(p2.id)) // back in preset 1, whose page is Lookup (the beforeEach)
    expectLookedUp()
  })

  it('Full Reset is what empties it', () => {
    lookedUp()
    openSettings()
    fireFullReset()
    expect(sessionStorage.getItem(KEY)).toBe(null)
    press('L')
    expect(field().value).toBe('')
    expect(codesOpen()).toBe(false)
  })

  // ── …and the one thing a preset CAN change under it: the Date Format the box is typed in ────────
  // One rule, LookupCard's own, however the live format came to differ from the one the text was
  // written in: a selected date is re-written in the new format; text with nothing selected, which
  // would no longer parse, is cleared along with its message.
  describe('the box under a different Date Format', () => {
    const useYmdInPreset2 = () => {
      makeSecondPreset()
      act(() => switchPreset(p2.id))
      act(() => useSettings.getState().setDateFormat('numeric-ymd'))
      act(() => switchPreset(1))
    }

    it('a preset with another format: the selected date is re-written in it, and everything else stays', () => {
      useYmdInPreset2()
      lookedUp() // typed as m/d/y, in preset 1
      act(() => switchPreset(p2.id))
      press('L')
      expect(field().value).toBe('1776-7-4')
      expect(answerSlot()).toBe('1776-7-4Thursday')
      expect(codesOpen()).toBe(true)
      act(() => switchPreset(1)) // …and back again, in preset 1's format
      expect(field().value).toBe('7/4/1776')
      expect(answerSlot()).toBe('July 4, 1776Thursday')
    })

    it('a preset with another format: text that was never looked up is cleared, with its message', () => {
      useYmdInPreset2()
      lookup('99/99/1776') // refused: an error message, nothing selected
      expect(answerSlot()).not.toBe(HINT)
      type('12/2')
      act(() => switchPreset(p2.id))
      press('L')
      expect(field().value).toBe('')
      expect(answerSlot()).toBe(HINT)
    })

    it('the format changed while Lookup was off screen: the same rule, when the card comes back', () => {
      lookedUp()
      press('K') // away to Classic — the Lookup card unmounts
      act(() => useSettings.getState().setDateFormat('numeric-dmy'))
      press('L')
      expect(field().value).toBe('4.7.1776') // not m/d/y text left under a d.m.y box
      expect(answerSlot()).toBe('4.7.1776Thursday')
    })

    it('the same format on the way back changes nothing, typed text included', () => {
      useYmdInPreset2()
      type('12/2') // half-typed, nothing selected
      act(() => switchPreset(p2.id)) // preset 2 opens on Classic: the card never sees its format
      act(() => switchPreset(1))
      expect(field().value).toBe('12/2')
    })

    it('a reload keeps the format with the text, so the reloaded card leaves the box alone', () => {
      lookedUp()
      expect(readLookupScreen().format).toBe(useSettings.getState().dateFormat)
      reload()
      expectLookedUp()
    })
  })
})
