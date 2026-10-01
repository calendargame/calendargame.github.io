// @vitest-environment jsdom
//
// sessionLookup — LOOKUP'S SCREEN SURVIVES A RELOAD, and not a real close (store/sessionLookup).
//
// The history LIST has always been saved. What was on the screen above it — the text in the date box,
// the answer or message being shown, the selected history row, and whether Show Codes is open — was
// plain App state, so a pull-to-refresh or the app's own update reload emptied the box and shut the
// codes. Those five values are kept for the browsing session now ("only truly closing the app starts
// fresh"), written as they change.
//
// A reload is modelled as what it is: the tree gone, sessionStorage exactly as the page left it, a new
// mount. A real close additionally ends the browsing session — the browser clears sessionStorage.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import {
  readLookupScreen,
  writeLookupScreen,
  discardLookupScreen,
  EMPTY_LOOKUP_SCREEN,
} from '../src/store/sessionLookup.js'
import { createPreset, switchPreset } from '../src/store/presetControl.js'
import { forgetBrowsingSession } from '../src/store/browsingSession.js'

const KEY = 'cg-lookup-screen-v1'
const HINT = 'Enter a date to see its weekday.'

describe('the store: what is kept, and what is refused', () => {
  beforeEach(() => discardLookupScreen())

  it('round-trips the five values', () => {
    const s = {
      input: '7/4/1776',
      output: '',
      calcDate: { y: 1776, m: 7, d: 4 },
      selectedId: 'abc',
      calcOpen: true,
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

  it('Clear empties what is kept; a preset switch does too', () => {
    lookup('7/4/1776')
    expect(sessionStorage.getItem(KEY)).not.toBe(null)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Clear' })))
    expect(sessionStorage.getItem(KEY)).toBe(null)
    lookup('3/14/1592')
    expect(sessionStorage.getItem(KEY)).not.toBe(null)
    let p2
    act(() => void (p2 = createPreset()))
    act(() => switchPreset(p2.id))
    expect(sessionStorage.getItem(KEY)).toBe(null)
  })
})
