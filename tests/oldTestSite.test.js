// src/lib/oldTestSite.ts — the test site's OLD address (calendargame.app/test_version/, until Round 27)
// cleared from a device: its worker, its caches, and its entry in the IndexedDB the two workers shared,
// and nothing of the live site's. The IndexedDB entries are written by the REAL public/sw-old-windows.js
// (tests/helpers/oldWindowsWorker.js) at the two scopes, so the key this module deletes is proved to be
// the key that file writes.
import { describe, it, expect, vi } from 'vitest'
import {
  OLD_TEST_SITE_NAVIGATION,
  oldTestSiteScope,
  removeOldTestSite,
} from '../src/lib/oldTestSite.ts'
import { fakeIndexedDB, windowOf, startWorker, listIn } from './helpers/oldWindowsWorker.js'

const LIVE_SCOPE = 'https://calendargame.app/'
const OLD_TEST_SITE_SCOPE = 'https://calendargame.app/test_version/'
// Workbox's names for a worker's caches: workbox-<what>-<the registration's scope>.
const LIVE_CACHES = [`workbox-precache-v2-${LIVE_SCOPE}`, `workbox-runtime-${LIVE_SCOPE}`]
const OLD_CACHES = [
  `workbox-precache-v2-${OLD_TEST_SITE_SCOPE}`,
  `workbox-runtime-${OLD_TEST_SITE_SCOPE}`,
]

// A device: its registrations, its caches, its IndexedDB — and one log of every removal, in order.
function device({ scopes = [LIVE_SCOPE, OLD_TEST_SITE_SCOPE], cacheNames = [], idb } = {}) {
  const log = []
  const registrations = scopes.map((scope) => ({
    scope,
    unregister: vi.fn(async () => (log.push(`unregister ${scope}`), true)),
  }))
  const names = new Set(cacheNames)
  const caches = {
    keys: vi.fn(async () => [...names]),
    delete: vi.fn(async (name) => (log.push(`cache ${name}`), names.delete(name))),
  }
  const indexedDB = idb && {
    open: vi.fn((...args) => {
      log.push('indexedDB')
      return idb.open(...args)
    }),
  }
  return {
    log,
    registrations,
    names,
    apis: {
      origin: 'https://calendargame.app',
      serviceWorker: { getRegistrations: vi.fn(async () => registrations) },
      caches,
      indexedDB,
    },
  }
}

// The IndexedDB as a device that ran both old workers holds it: each wrote its list at a takeover.
async function bothWorkersRan() {
  const idb = fakeIndexedDB()
  await startWorker({ windows: [windowOf('live-window')], idb }).takeOver()
  await startWorker({
    windows: [windowOf('test-window')],
    idb,
    scope: '/test_version/',
  }).takeOver()
  expect(listIn(idb)).toEqual(['live-window'])
  expect(listIn(idb, OLD_TEST_SITE_SCOPE)).toEqual(['test-window'])
  return idb
}

describe('removeOldTestSite', () => {
  it('removes the old worker, its caches, and its list — and nothing of the live site’s', async () => {
    const idb = await bothWorkersRan()
    const d = device({ cacheNames: [...LIVE_CACHES, ...OLD_CACHES, 'something-else'], idb })
    await expect(removeOldTestSite(d.apis)).resolves.toBe(true)
    expect(listIn(idb, OLD_TEST_SITE_SCOPE)).toBeUndefined()
    expect(listIn(idb)).toEqual(['live-window'])
    expect([...d.names]).toEqual([...LIVE_CACHES, 'something-else'])
    expect(d.registrations[0].unregister).not.toHaveBeenCalled()
    expect(d.registrations[1].unregister).toHaveBeenCalledTimes(1)
  })

  it('removes the registration LAST — it is what the next open looks for to finish the job', async () => {
    const d = device({ cacheNames: OLD_CACHES, idb: fakeIndexedDB() })
    await removeOldTestSite(d.apis)
    expect(d.log).toEqual([
      'indexedDB',
      ...OLD_CACHES.map((name) => `cache ${name}`),
      `unregister ${OLD_TEST_SITE_SCOPE}`,
    ])
  })

  it('does nothing at all on a device that never had it — not even open the database', async () => {
    const d = device({ scopes: [LIVE_SCOPE], cacheNames: LIVE_CACHES, idb: fakeIndexedDB() })
    await expect(removeOldTestSite(d.apis)).resolves.toBe(false)
    expect(d.log).toEqual([])
  })

  it('is idempotent: once it has worked, the next open finds nothing', async () => {
    const d = device({ cacheNames: OLD_CACHES, idb: await bothWorkersRan() })
    await removeOldTestSite(d.apis)
    d.registrations.splice(1, 1) // (the browser forgets an unregistered worker)
    d.log.length = 0
    await expect(removeOldTestSite(d.apis)).resolves.toBe(false)
    expect(d.log).toEqual([])
  })

  it('finishes what a cut-short run left: caches still there after the worker went', async () => {
    const idb = await bothWorkersRan()
    const d = device({ scopes: [LIVE_SCOPE], cacheNames: OLD_CACHES, idb })
    await expect(removeOldTestSite(d.apis)).resolves.toBe(true)
    expect([...d.names]).toEqual([])
    expect(listIn(idb, OLD_TEST_SITE_SCOPE)).toBeUndefined()
  })

  it('a failure leaves the registration in place, so the next open tries again', async () => {
    const d = device({
      cacheNames: OLD_CACHES,
      idb: {
        open() {
          const open = {}
          queueMicrotask(() => {
            open.error = new Error('blocked')
            open.onerror()
          })
          return open
        },
      },
    })
    await expect(removeOldTestSite(d.apis)).rejects.toThrow('blocked')
    expect(d.registrations[1].unregister).not.toHaveBeenCalled()
  })

  it('without Cache Storage or IndexedDB (an insecure context) it still removes the worker', async () => {
    const d = device()
    await expect(
      removeOldTestSite({ ...d.apis, caches: undefined, indexedDB: undefined }),
    ).resolves.toBe(true)
    expect(d.registrations[1].unregister).toHaveBeenCalledTimes(1)
  })
})

describe('oldTestSiteScope — the old worker’s scope on the page’s own origin', () => {
  it('is the old address on the live site, and an address no worker ever had on the test site', () => {
    expect(oldTestSiteScope('https://calendargame.app')).toBe(OLD_TEST_SITE_SCOPE)
    expect(oldTestSiteScope('https://test.calendargame.app')).toBe(
      'https://test.calendargame.app/test_version/',
    )
  })
})

describe('OLD_TEST_SITE_NAVIGATION — what the live worker leaves to GitHub’s redirect', () => {
  it('is every navigation to the old address', () => {
    for (const path of [
      '/test_version/',
      '/test_version',
      '/test_version/?utm=1',
      '/test_version?x',
      '/test_version/index.html',
    ])
      expect(OLD_TEST_SITE_NAVIGATION.test(path)).toBe(true)
  })

  it('and nothing of the live site’s', () => {
    for (const path of [
      '/',
      '/?test_version',
      '/index.html',
      '/test_versions/',
      '/x/test_version/',
    ])
      expect(OLD_TEST_SITE_NAVIGATION.test(path)).toBe(false)
  })
})
