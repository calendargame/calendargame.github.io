// swOldWindows — THE WORKER BRINGS EVERY WINDOW OF THE VERSION BEFORE ONTO ITS OWN (public/sw-old-windows.js,
// Round 26). The file runs inside a service worker, so here it runs in a fresh script context with a
// fake worker scope around it: the windows (`clients`), its own state, its messages, and an IndexedDB
// that keeps what is written to it across a "restart" of the worker (a second run of the file). What a
// real browser does with it - the activation, the reloads - is the browser lane's
// (tests/browser/oldWindows.browser.ts), in Chromium and WebKit.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const SOURCE = readFileSync(join(__dirname, '..', 'public', 'sw-old-windows.js'), 'utf8')

// An IndexedDB of one object store, enough for the file's get and put. Requests and transactions
// complete in later microtasks, as the real ones do.
function fakeIndexedDB() {
  const stores = new Map()
  return {
    stores,
    open() {
      const open = {}
      queueMicrotask(() => {
        const fresh = stores.size === 0
        open.result = {
          createObjectStore: (name) => stores.set(name, new Map()),
          close() {},
          transaction(name) {
            const tx = {}
            tx.objectStore = () => {
              const store = stores.get(name)
              return {
                get: (key) => ({ result: store.get(key) }),
                put: (value, key) => (store.set(key, structuredClone(value)), { result: key }),
              }
            }
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
            return tx
          },
        }
        if (fresh) open.onupgradeneeded?.()
        open.onsuccess()
      })
      return open
    },
  }
}

const windowOf = (id, visibilityState = 'visible', focused = false) => ({
  id,
  url: `https://calendargame.app/#${id}`,
  visibilityState,
  focused,
  navigated: 0,
  navigate() {
    this.navigated++
    return Promise.resolve(this)
  },
})

// One start of the worker: the file run against `windows` and `idb`, on `hostname`.
function startWorker({ windows, idb, hostname = 'calendargame.app', scope = '/' }) {
  const listeners = {}
  const own = { state: 'activating', listeners: [] }
  own.addEventListener = (_type, fn) => own.listeners.push(fn)
  const self = {
    location: { hostname },
    registration: { scope: `https://${hostname}${scope}` },
    serviceWorker: own,
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    clients: { matchAll: async () => windows.filter((w) => !w.closed) },
  }
  runInNewContext(SOURCE, { self, indexedDB: idb, Promise, Set, Array, queueMicrotask })
  const fire = async (type, data, source) => {
    const waits = []
    for (const fn of listeners[type] ?? []) fn({ data, source, waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  return {
    takeOver: () => fire('activate'),
    activated: async () => {
      own.state = 'activated'
      own.listeners.forEach((fn) => fn())
      for (let i = 0; i < 50; i++) await Promise.resolve() // (the look it starts is not awaited)
      await fire('message', { type: 'NOTHING' }) // (and a look queued after it has finished)
    },
    ask: (source = null, extra = {}) =>
      fire('message', { type: 'SWEEP_OLD_WINDOWS', ...extra }, source),
  }
}
const listIn = (idb, scope = 'https://calendargame.app/') =>
  idb.stores.get('kv')?.get(`old-windows ${scope}`)

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

  // The live site and the test site share one origin, so one IndexedDB: each worker keeps its own list.
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
