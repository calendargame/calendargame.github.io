// swOldWindows — THE WORKER BRINGS EVERY WINDOW OF THE VERSION BEFORE ONTO ITS OWN (public/sw-old-windows.js,
// Round 26). The file runs inside a service worker, so here it runs in a fresh script context with a
// fake worker scope around it (tests/helpers/oldWindowsWorker.js). What a real browser does with it -
// the activation, the reloads - is the browser lane's (tests/browser/oldWindows.browser.ts), in
// Chromium and WebKit.
import { describe, it, expect } from 'vitest'
import { fakeIndexedDB, windowOf, startWorker, listIn } from './helpers/oldWindowsWorker.js'

describe('the windows of the version before', () => {
  it('are written down at the takeover - every window open then, and only those', async () => {
    const idb = fakeIndexedDB()
    const windows = [windowOf('a'), windowOf('b', 'hidden')]
    await startWorker({ windows, idb }).takeOver()
    expect(listIn(idb)).toEqual(['a', 'b'])
  })

  it('once active: one in the background is reloaded at once, one on screen is left', async () => {
    const idb = fakeIndexedDB()
    const windows = [windowOf('shown'), windowOf('away', 'hidden'), windowOf('beside')]
    const worker = startWorker({ windows, idb })
    await worker.takeOver()
    windows.push(windowOf('opened-after', 'hidden'))
    await worker.activated()
    expect(windows.map((w) => w.navigated)).toEqual([0, 1, 0, 0])
    // (on screen but not focused at the takeover is on screen: it waits for its next hide or blur)
    expect(listIn(idb)).toEqual(['shown', 'beside'])
  })

  it('an ask reloads one left for another window (blurred), never the focused one or the asker', async () => {
    const idb = fakeIndexedDB()
    const windows = [windowOf('playing', 'visible', true), windowOf('left'), windowOf('asker')]
    const worker = startWorker({ windows, idb })
    await worker.takeOver()
    await worker.activated()
    expect(windows.map((w) => w.navigated)).toEqual([0, 0, 0])
    await worker.ask(windows[2])
    expect(windows.map((w) => w.navigated)).toEqual([0, 1, 0])
    expect(listIn(idb)).toEqual(['playing'])
    // the player leaves it: hidden at the next ask, and reloaded
    windows[0].visibilityState = 'hidden'
    windows[0].focused = false
    await worker.ask(windows[2])
    expect(windows.map((w) => w.navigated)).toEqual([1, 1, 0])
    expect(listIn(idb)).toEqual([])
  })

  // ★ NO LOOP. A window reloaded is off the list, and the list is written only at a takeover, so
  // however many asks follow, nothing is reloaded twice.
  it('each window is reloaded at most once per takeover, however many asks follow', async () => {
    const idb = fakeIndexedDB()
    const windows = [windowOf('away', 'hidden'), windowOf('later')]
    const worker = startWorker({ windows, idb })
    await worker.takeOver()
    await worker.activated()
    windows[1].visibilityState = 'hidden'
    for (let i = 0; i < 5; i++) await worker.ask()
    expect(windows.map((w) => w.navigated)).toEqual([1, 1])
    expect(listIn(idb)).toEqual([])
  })

  it('the list outlives the worker: a later start reloads what the first one left', async () => {
    const idb = fakeIndexedDB()
    const windows = [windowOf('kept', 'visible', true)]
    const first = startWorker({ windows, idb })
    await first.takeOver()
    await first.activated()
    expect(windows[0].navigated).toBe(0)
    windows[0].focused = false
    await startWorker({ windows, idb }).ask() // (the browser stopped the idle worker; this is a new start)
    expect(windows[0].navigated).toBe(1)
  })

  it('a window closed since comes off the list; one that cannot be reloaded yet stays on it', async () => {
    const idb = fakeIndexedDB()
    const stuck = windowOf('stuck', 'hidden')
    stuck.navigate = () => Promise.reject(new TypeError('not controlled'))
    const windows = [windowOf('closed', 'hidden'), stuck]
    const worker = startWorker({ windows, idb })
    await worker.takeOver()
    windows[0].closed = true
    await worker.activated()
    expect(listIn(idb)).toEqual(['stuck'])
  })

  it('`anyVisible` (the lane’s, as headless windows are always on screen) works on a loopback address only', async () => {
    for (const [hostname, reloaded] of [
      ['calendargame.app', 0],
      ['127.0.0.1', 1],
      ['localhost', 1],
    ]) {
      const idb = fakeIndexedDB()
      const windows = [windowOf('on-screen', 'visible', true)]
      const worker = startWorker({ windows, idb, hostname })
      await worker.takeOver()
      await worker.ask(null, { anyVisible: true })
      expect(windows[0].navigated).toBe(reloaded)
    }
  })

  // One IndexedDB per origin, one list per worker's scope. Until Round 27 the live site's worker and the
  // test site's ('/test_version/') shared calendargame.app; src/lib/oldTestSite.ts removes the old
  // one's list by exactly this key (tests/oldTestSite.test.js).
  it('a worker at another scope keeps a list of its own, and never touches this one’s', async () => {
    const idb = fakeIndexedDB()
    const live = [windowOf('live', 'visible', true)]
    await startWorker({ windows: live, idb }).takeOver()
    await startWorker({ windows: [windowOf('test-site')], idb, scope: '/test_version/' }).takeOver()
    expect(listIn(idb)).toEqual(['live'])
    expect(listIn(idb, 'https://calendargame.app/test_version/')).toEqual(['test-site'])
  })

  it('without IndexedDB nothing is reloaded, and nothing throws', async () => {
    const windows = [windowOf('a', 'hidden')]
    const idb = {
      open() {
        throw new Error('blocked')
      },
    }
    const worker = startWorker({ windows, idb })
    await worker.takeOver()
    await worker.activated()
    await worker.ask()
    expect(windows[0].navigated).toBe(0)
  })
})
