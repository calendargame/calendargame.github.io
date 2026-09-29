// store/storageHealth — the rules of a refused save, in isolation (the player-visible half is
// tests/storageFull.dom, on the real <App/>).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isQuotaError,
  guardedSetItem,
  registerPersistFlush,
  storageSpaceFreed,
  forgetStorageHealth,
  useStorageHealth,
} from '../src/store/storageHealth.js'

const quota = () => {
  throw new DOMException('full', 'QuotaExceededError')
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
    expect(() => guardedSetItem('a', quota)).not.toThrow()
    expect(useStorageHealth.getState()).toMatchObject({ unsaved: true, noticeOpen: true })
    const insecure = () => {
      throw new DOMException('no', 'SecurityError')
    }
    expect(() => guardedSetItem('b', insecure)).toThrow('no')
  })

  it('one notice per episode: a dismissed notice stays down while the device stays full', () => {
    guardedSetItem('a', quota)
    useStorageHealth.getState().dismissStorageNotice()
    guardedSetItem('a', quota)
    guardedSetItem('b', quota)
    expect(useStorageHealth.getState()).toMatchObject({ unsaved: true, noticeOpen: false })
  })

  it('a write that fits re-saves every other unsaved store, and the episode ends when all have', () => {
    let room = false
    const saved = []
    registerPersistFlush('a', () => guardedSetItem('a', () => (room ? saved.push('a') : quota())))
    guardedSetItem('a', quota)
    room = true
    guardedSetItem('b', () => saved.push('b'))
    expect(saved).toEqual(['b', 'a'])
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('freed space re-saves at once; a re-save that still does not fit keeps the episode open', () => {
    let room = false
    registerPersistFlush('c', () => guardedSetItem('c', () => (room ? undefined : quota())))
    guardedSetItem('c', quota)
    storageSpaceFreed()
    expect(useStorageHealth.getState().unsaved).toBe(true)
    room = true
    storageSpaceFreed()
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })
})
