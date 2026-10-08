// @vitest-environment jsdom
//
// sessionGuide — round 23: How to Play's place (open section + reading offset), parked in
// sessionStorage for a reload (store/sessionGuide). Pins the store alone: what it keeps, that the
// launch place keeps nothing, and that anything unreadable reads as "no place" rather than throwing.
// The screen's wiring — parked on pagehide, restored on the reload, cleared by a real close and by a
// preset switch — is tests/guideScroll.dom.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readGuidePlace, writeGuidePlace, discardGuidePlace } from '../src/store/sessionGuide.js'

const KEY = 'cg-guide-place-v1'
beforeEach(() => discardGuidePlace())
afterEach(() => vi.restoreAllMocks())

describe('the guide place', () => {
  it('reads back what was written, and nothing before that', () => {
    expect(readGuidePlace()).toBe(null)
    writeGuidePlace({ open: 'stats', y: 412.5 })
    expect(readGuidePlace()).toEqual({ open: 'stats', y: 412.5 })
    writeGuidePlace({ open: null, y: 90 }) // every section closed, scrolled down the list
    expect(readGuidePlace()).toEqual({ open: null, y: 90 })
  })
  it('the launch place — all closed, at the top — parks nothing, and clears an older place', () => {
    writeGuidePlace({ open: 'stats', y: 10 })
    writeGuidePlace({ open: null, y: 0 })
    expect(sessionStorage.getItem(KEY)).toBe(null)
  })
  it.each([
    ['not JSON', '{'],
    ['not an object', '7'],
    ['null', 'null'],
    ['a section that is not a string', '{"open":3,"y":0}'],
    ['no offset', '{"open":"stats"}'],
    ['a negative offset', '{"open":"stats","y":-4}'],
    ['an offset that is not a number', '{"open":"stats","y":"12"}'],
  ])('%s reads as no place', (_, raw) => {
    sessionStorage.setItem(KEY, raw)
    expect(readGuidePlace()).toBe(null)
  })
  it('a refused write removes the place — an older one never comes back instead', () => {
    writeGuidePlace({ open: 'stats', y: 10 })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => writeGuidePlace({ open: 'blitz', y: 20 })).not.toThrow()
    vi.restoreAllMocks()
    expect(readGuidePlace()).toBe(null)
  })
  it('a browser that refuses sessionStorage outright: nothing throws, there is no place', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => writeGuidePlace({ open: 'stats', y: 10 })).not.toThrow()
    expect(readGuidePlace()).toBe(null)
    expect(() => discardGuidePlace()).not.toThrow()
  })
})
