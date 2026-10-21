// tests/helpers/oldWindowsWorker.js — public/sw-old-windows.js RUN AS ITS WORKER WOULD RUN IT, against
// a fake worker scope (the windows, its own state, its messages) and a fake IndexedDB that keeps what is
// written to it across a "restart" of the worker (a second run of the file). Shared by
// tests/swOldWindows.test.js (the file's own rules) and tests/oldTestSite.test.js (which clears the
// entry the file writes at the test site's old scope, so the two cannot disagree on its key).
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const SOURCE = readFileSync(new URL('../../public/sw-old-windows.js', import.meta.url), 'utf8')

// An IndexedDB of one object store, enough for the file's get and put (and the delete
// src/lib/oldTestSite.ts makes). Requests and transactions complete in later microtasks, as the real
// ones do.
export function fakeIndexedDB() {
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
                delete: (key) => (store.delete(key), { result: undefined }),
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

export const windowOf = (id, visibilityState = 'visible', focused = false) => ({
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
export function startWorker({ windows, idb, hostname = 'calendargame.app', scope = '/' }) {
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
export const listIn = (idb, scope = 'https://calendargame.app/') =>
  idb.stores.get('kv')?.get(`old-windows ${scope}`)
