import { describe, it, expect } from 'vitest'
import {
  AMNESIC_MODES,
  AMNESIC_SPOKEN,
  isAmnesicMode,
  readAmnesicMode,
  storedAmnesic,
} from '../src/store/amnesicMode.js'

// amnesicMode — the three values of the Amnesic setting and the ONE reader of every stored spelling
// of it. Pure, so it is pinned here as a table; where each stored copy actually reaches the reader
// (a saved-defaults snapshot, another preset's, the settings field) is tests/amnesicSetting.dom's.

describe('the three values', () => {
  it('are Off, Stats Only, and Full, least amnesic first', () => {
    expect(AMNESIC_MODES).toEqual(['off', 'stats', 'full'])
    for (const mode of AMNESIC_MODES) expect(isAmnesicMode(mode)).toBe(true)
    for (const not of [true, false, null, undefined, 'on', 'Full', 1, {}])
      expect(isAmnesicMode(not)).toBe(false)
  })
})

describe('the saved spelling: the older boolean, and the value beside it', () => {
  // ★ WHAT AN OLDER BUILD READS. A build from before the setting was three-way acts on `amnesic`
  // and nothing else, and reads anything but `true` there as "not amnesic". So the boolean must say
  // true for BOTH amnesic values — to that build a Stats Only preset is a plain amnesic one, which
  // keeps nothing, never the other way about.
  it('writes amnesic:true for Stats Only and Full, false for Off', () => {
    expect(storedAmnesic('off')).toEqual({ amnesic: false, amnesicMode: 'off' })
    expect(storedAmnesic('stats')).toEqual({ amnesic: true, amnesicMode: 'stats' })
    expect(storedAmnesic('full')).toEqual({ amnesic: true, amnesicMode: 'full' })
  })

  it('round-trips every value', () => {
    for (const mode of AMNESIC_MODES) expect(readAmnesicMode(storedAmnesic(mode))).toBe(mode)
  })
})

describe('the one reader', () => {
  // THE MIGRATION: the boolean becomes the three-way value — true → Full, false → Off.
  it('an older build’s copy (the boolean alone): true is Full, false is Off', () => {
    expect(readAmnesicMode({ amnesic: true })).toBe('full')
    expect(readAmnesicMode({ amnesic: false })).toBe('off')
  })

  it('a copy from before the setting existed (no field), or no copy at all, is Off', () => {
    expect(readAmnesicMode({})).toBe('off')
    expect(readAmnesicMode({ settings: {}, prefs: {} })).toBe('off')
    expect(readAmnesicMode({ amnesic: null })).toBe('off')
    expect(readAmnesicMode(null)).toBe('off')
    expect(readAmnesicMode(undefined)).toBe('off')
    expect(readAmnesicMode('full')).toBe('off') // not a stored copy at all
  })

  // ★ THE SAFE DIRECTION. Reading "off" for a preset that was meant to forget records a guest for
  // good; reading "full" for one that was meant to remember shows a zeroed strip and loses nothing
  // saved. So everything this build does not recognise reads as Full.
  it('a value it does not recognise fails SAFE — it reads as Full, never as Off', () => {
    expect(readAmnesicMode({ amnesic: true, amnesicMode: 'bests-only' })).toBe('full') // a newer build's
    expect(readAmnesicMode({ amnesic: false, amnesicMode: 'bests-only' })).toBe('full')
    expect(readAmnesicMode({ amnesicMode: 7 })).toBe('full')
    expect(readAmnesicMode({ amnesicMode: null })).toBe('full')
    expect(readAmnesicMode({ amnesic: 'yes' })).toBe('full') // a boolean that is not one
    expect(readAmnesicMode({ amnesic: 1 })).toBe('full')
  })

  // What an OLDER build leaves when it re-saves a snapshot this build wrote: its `migrate` carries
  // `saved` whole (both fields survive a load), and its Save Defaults writes its own boolean and
  // drops the mode. Neither can make the two fields disagree, but a hand-edited payload can.
  it('when the two fields disagree, the more amnesic reading wins', () => {
    expect(readAmnesicMode({ amnesic: true, amnesicMode: 'off' })).toBe('full')
    expect(readAmnesicMode({ amnesic: false, amnesicMode: 'stats' })).toBe('stats')
    expect(readAmnesicMode({ amnesic: false, amnesicMode: 'full' })).toBe('full')
    expect(readAmnesicMode({ amnesic: true, amnesicMode: 'stats' })).toBe('stats') // they agree
  })

  it('is total: no input throws', () => {
    for (const junk of [0, '', [], [1], () => {}, Symbol.iterator, NaN, { amnesic: {} }])
      expect(() => readAmnesicMode(junk)).not.toThrow()
  })
})

describe('what a preset list says of an amnesic preset', () => {
  // Screen-reader users have to be able to tell the two kinds apart, and ", amnesic" is kept as it
  // has always been said.
  it('nothing for Off; "amnesic" for Full; "amnesic, stats only" for Stats Only', () => {
    expect(AMNESIC_SPOKEN).toEqual({ off: null, stats: 'amnesic, stats only', full: 'amnesic' })
  })
})
