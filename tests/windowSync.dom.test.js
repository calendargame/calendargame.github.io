// @vitest-environment jsdom
// windowSync — the notices that the saved data changed under this window, and the order of a return
// (design-q1-q2.md v4, 2.7 and 6.5: CLOCKS FIRST).
import { describe, it, expect, afterEach } from 'vitest'
import { installWindowSync, onReturn } from '../src/store/windowSync.js'
import { SCRATCH_KEY } from '../src/store/storageHealth.js'
import {
  GEAR_DOT_KEY,
  CHANGELOG_DOT_KEY,
  CHANGELOG_SEEN_KEY,
  subscribeUpdateDot,
} from '../src/changelog.js'

const fakeDoor = () => {
  const log = []
  return {
    log,
    notice: (key, old) => log.push(['notice', key, old]),
    syncAll: () => log.push(['syncAll']),
    setHidden: (on) => log.push(['hidden', on]),
  }
}
const setVisibility = (state) =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
const tick = () => new Promise((r) => queueMicrotask(r))

let uninstall = () => {}
afterEach(() => {
  uninstall()
  setVisibility('visible')
})

describe('windowSync', () => {
  it('another window’s write reaches the door, with what the key held before; the measurement’s scratch key does not', () => {
    const d = fakeDoor()
    uninstall = installWindowSync(d)
    d.log.length = 0
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cg-x',
        oldValue: 'a',
        newValue: 'b',
        storageArea: localStorage,
      }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', { key: SCRATCH_KEY, storageArea: localStorage }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'cg-y', storageArea: sessionStorage }))
    expect(d.log).toEqual([['notice', 'cg-x', 'a']])
  })

  it('a return - visible, pageshow, focus, resume - is ONE sync, and every round that ran out is settled first', async () => {
    const d = fakeDoor()
    uninstall = installWindowSync(d)
    const off = onReturn(() => d.log.push(['settle']))
    d.log.length = 0
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('resume'))
    await tick()
    expect(d.log).toEqual([['hidden', true], ['settle'], ['syncAll'], ['hidden', false]])
    off()
  })

  // The update dots are single flags (design 4.3's small keys): another window's change of one - the
  // changelog opened there - wakes every reader here, which re-reads it; and so does a return.
  it('another window’s change of an update dot, or of the changelog seen there, wakes the dots here', async () => {
    const d = fakeDoor()
    uninstall = installWindowSync(d)
    let woken = 0
    const stop = subscribeUpdateDot(() => woken++)
    try {
      for (const key of [GEAR_DOT_KEY, CHANGELOG_DOT_KEY, CHANGELOG_SEEN_KEY])
        window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
      expect(woken).toBe(3)
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'cg-settings-v1', storageArea: localStorage }),
      )
      expect(woken).toBe(3)
      window.dispatchEvent(new Event('focus'))
      await tick()
      expect(woken).toBe(4)
    } finally {
      stop()
    }
  })
})
