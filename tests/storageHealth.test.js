// store/storageHealth — the rules of a refused save, in isolation (the player-visible half is
// tests/storageFull.dom, on the real <App/>; the cross-preset half is tests/storageFullPresets.dom).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isQuotaError,
  writeItem,
  readItem,
  removeItem,
  storageSpaceFreed,
  placeChangedElsewhere,
  showStorageNotice,
  forgetStorageHealth,
  useStorageHealth,
} from '../src/store/storageHealth.js'

// A storage area with a switch: while `full`, every setItem is refused the way a browser refuses it.
function makeArea() {
  const items = new Map()
  const area = {
    full: false,
    error: null,
    writes: [],
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => {
      if (area.error) throw area.error
      if (area.full) throw new DOMException('full', 'QuotaExceededError')
      area.writes.push(k)
      items.set(k, v)
    },
    removeItem: (k) => items.delete(k),
  }
  return area
}

describe('storageHealth', () => {
  beforeEach(() => forgetStorageHealth())

  it('recognises every spelling of "no room" and nothing else', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaError(new DOMException('x', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true)
    expect(isQuotaError(new DOMException('x', 'SecurityError'))).toBe(false)
    expect(isQuotaError(new Error('QuotaExceededError'))).toBe(false)
  })

  it('a refusal is caught and opens the notice; any OTHER storage error still throws', () => {
    const area = makeArea()
    area.full = true
    expect(() => writeItem(area, 'a', '1')).not.toThrow()
    expect(useStorageHealth.getState()).toMatchObject({ unsaved: true, noticeOpen: true })
    area.error = new DOMException('no', 'SecurityError')
    expect(() => writeItem(area, 'b', '1')).toThrow('no')
  })

  it('one notice per episode: a dismissed notice stays down while the device stays full', () => {
    const area = makeArea()
    area.full = true
    writeItem(area, 'a', '1')
    useStorageHealth.getState().dismissStorageNotice()
    writeItem(area, 'a', '2')
    writeItem(area, 'b', '1')
    expect(useStorageHealth.getState()).toMatchObject({ unsaved: true, noticeOpen: false })
    // …and the app can put it back up when it has to refuse something because of it.
    showStorageNotice()
    expect(useStorageHealth.getState().noticeOpen).toBe(true)
  })

  it('a refused value is what its place reads as — the newest one, and only for that place', () => {
    const local = makeArea()
    const session = makeArea()
    writeItem(local, 'k', 'old')
    local.full = true
    writeItem(local, 'k', 'new')
    writeItem(local, 'k', 'newest')
    expect(local.getItem('k')).toBe('old') // the device still holds the older copy
    expect(readItem(local, 'k')).toBe('newest')
    expect(readItem(local, 'other')).toBe(null)
    expect(readItem(session, 'k')).toBe(null) // the same key in the OTHER area is another place
  })

  it('a write that fits saves every held value to ITS OWN place, and the episode ends when all have', () => {
    const local = makeArea()
    const session = makeArea()
    local.full = true
    session.full = true
    writeItem(local, 'a', 'A')
    writeItem(session, 'a', 'guest')
    local.full = false
    session.full = false
    writeItem(local, 'b', 'B')
    expect(local.writes).toEqual(['b', 'a'])
    expect(local.getItem('a')).toBe('A')
    expect(session.getItem('a')).toBe('guest')
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('freed space retries at once; a retry that still does not fit keeps the episode open', () => {
    const area = makeArea()
    area.full = true
    writeItem(area, 'c', 'C')
    storageSpaceFreed()
    expect(useStorageHealth.getState().unsaved).toBe(true)
    area.full = false
    storageSpaceFreed()
    expect(area.getItem('c')).toBe('C')
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('removing a place forgets what was held for it — it is never written back out', () => {
    const area = makeArea()
    area.full = true
    writeItem(area, 'gone', 'x')
    removeItem(area, 'gone')
    expect(readItem(area, 'gone')).toBe(null)
    expect(useStorageHealth.getState().unsaved).toBe(false)
    area.full = false
    storageSpaceFreed()
    expect(area.getItem('gone')).toBe(null)
  })

  it('a later save that fits supersedes the held one', () => {
    const area = makeArea()
    area.full = true
    writeItem(area, 'k', 'refused')
    area.full = false
    writeItem(area, 'k', 'fits')
    expect(area.getItem('k')).toBe('fits')
    expect(area.writes).toEqual(['k'])
    expect(readItem(area, 'k')).toBe('fits')
  })

  // Another tab saving to (or deleting) a place this page holds a refused save for: the held save is
  // an OLDER one by then, so it is dropped rather than written over what came after it.
  it('another tab changing a place forgets what was held for it — and only for it', () => {
    const area = makeArea()
    area.full = true
    writeItem(area, 'theirs', 'mine, refused')
    writeItem(area, 'untouched', 'also refused')
    area.full = false
    area.setItem('theirs', 'the other tab, later') // the other tab's save lands on the device
    area.writes.length = 0
    placeChangedElsewhere(area, 'theirs')
    expect(readItem(area, 'theirs')).toBe('the other tab, later')
    expect(useStorageHealth.getState().unsaved).toBe(true) // 'untouched' is still held
    storageSpaceFreed()
    expect(area.writes).toEqual(['untouched']) // …and it alone is written out
    expect(area.getItem('theirs')).toBe('the other tab, later')
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('another tab clearing the whole area forgets everything held for that area', () => {
    const local = makeArea()
    const session = makeArea()
    local.full = session.full = true
    writeItem(local, 'a', '1')
    writeItem(local, 'b', '2')
    writeItem(session, 'c', '3')
    placeChangedElsewhere(local, null)
    local.full = session.full = false
    storageSpaceFreed()
    expect(local.writes).toEqual([])
    expect(session.writes).toEqual(['c'])
  })
})
