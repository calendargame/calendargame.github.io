// lib/oldTestSite.ts — WHAT THE TEST SITE'S OLD ADDRESS LEFT ON A DEVICE, CLEARED (Round 27, Q1).
//
// Until Round 27 the test site was https://calendargame.app/test_version/ — the live site's own
// origin, under a path. It now has a domain of its own (src/sites.ts), and GitHub answers every
// request for the old address with a permanent redirect (301) to the same path on the new one. But a
// device that ever opened the old address still holds a SERVICE WORKER for it (scope = that path) and
// its caches, and that worker never sees the redirect: it answers a visit from its cache, and the
// update check it makes for its own script is redirected, which a worker update refuses. Left alone
// it would go on serving the old test build forever — on the LIVE origin, reading and writing the
// live site's saved data, the very sharing the move exists to end.
//
// So every build, on every open (src/sw.ts), looks for it and removes it — quietly, and idempotently:
// once it has worked there is nothing left to find, and the look costs two cheap reads. In this order,
// the registration LAST, because it is the evidence the next open looks for: a removal cut short
// (the tab closed mid-way, a storage error) is simply finished then.
//   1. the old worker's own entry in the IndexedDB it shares with the live worker (public/
//      sw-old-windows.js: one database per origin, one entry per worker's scope) — that entry only;
//   2. every cache Workbox made for that worker. Workbox names a worker's caches
//      `workbox-<what>-<scope>` (workbox-core's cacheNames: prefix, name, and the registration's
//      scope, joined by '-'), so a name ending in '-<old scope>' is the old worker's and nothing
//      else's — the live worker's end in '-https://calendargame.app/', which that never matches;
//   3. the registration itself.
// What it never touches: the live site's own worker, caches, and IndexedDB entry; and the saved data
// (localStorage, sessionStorage), which the two sites shared and which is simply the live site's —
// there is nothing of the old test site's to take out of it.
// A window of the old test build already open keeps running until it is closed or reloaded (removing
// a registration does not stop the pages it serves); reloaded, it follows the redirect.
// ⚠ WHAT IT CANNOT REACH: an old test-site icon on an iPhone's home screen. iOS gives each installed web
// app storage of its own, and the live site never runs inside it; the owner deletes that icon by hand.
// ⚠ TEMPORARY. It exists for devices that opened the old address. Remove this module (and its call in
// src/sw.ts, and its test) once those are known to be clean — the step is recorded in PROJECT.md. The
// live worker's refusal to answer the old address (OLD_TEST_SITE_NAVIGATION, vite.config.js) is NOT
// temporary: GitHub's redirect there is permanent, and the worker must never stand in front of it.

/** The test site's old path on the live domain. */
export const OLD_TEST_SITE_PATH = '/test_version/'
/**
 * Its old worker's scope on `origin`, exactly as a registration reports it — on the live site,
 * https://calendargame.app/test_version/. Made from the page's own origin rather than written out, so
 * the browser lane can prove the whole removal on its own address (tests/browser/oldTestSite); on
 * the test site it names an address no worker ever had, and finds nothing.
 */
export const oldTestSiteScope = (origin: string) => new URL(OLD_TEST_SITE_PATH, origin).href
/**
 * Every navigation to the old address, with or without its trailing slash or a query. The live
 * worker's navigation route is told to leave these to the network (vite.config.js,
 * navigateFallbackDenylist) — otherwise, on a device with the live worker, the old address would be
 * answered with the LIVE app from its cache instead of GitHub's redirect to the test site. (Workbox
 * matches a denylist entry against the path plus the query.)
 */
export const OLD_TEST_SITE_NAVIGATION = /^\/test_version(?:[/?]|$)/

// public/sw-old-windows.js's database, store, and key — the worker's own schema, written out again
// because that file is a plain script the worker imports, outside this module graph. The test runs
// the real file at the old scope and this module against what it wrote, so the two cannot drift
// apart unseen (tests/oldTestSite.test.js).
const SW_DB = 'cg-sw-v1'
const SW_STORE = 'kv'
const oldWindowsKey = (scope: string) => `old-windows ${scope}`

export interface OldTestSiteDevice {
  /** The page's origin (location.origin). */
  origin: string
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistrations'>
  caches: Pick<CacheStorage, 'keys' | 'delete'> | undefined
  indexedDB: IDBFactory | undefined
}

/** The old worker's entry in its IndexedDB, deleted; the live worker's beside it untouched. */
function deleteOldWindowsEntry(idb: IDBFactory, scope: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = idb.open(SW_DB, 1)
    // (only when the database is not there yet — an old worker from before Round 26 never made one.
    // Made as the worker makes it, so the live worker finds what it expects.)
    open.onupgradeneeded = () => open.result.createObjectStore(SW_STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      try {
        const tx = db.transaction(SW_STORE, 'readwrite')
        tx.objectStore(SW_STORE).delete(oldWindowsKey(scope))
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      } catch (error) {
        db.close()
        reject(error)
      }
    }
  })
}

/**
 * Finds the old test site's worker and caches on this device and removes them (see the header).
 * Resolves whether there was anything to remove; rejects on a failure, which the caller leaves to the
 * next open.
 */
export async function removeOldTestSite(device: OldTestSiteDevice): Promise<boolean> {
  const scope = oldTestSiteScope(device.origin)
  const workers = (await device.serviceWorker.getRegistrations()).filter(
    (registration) => registration.scope === scope,
  )
  const cacheNames = device.caches
    ? (await device.caches.keys()).filter((name) => name.endsWith(`-${scope}`))
    : []
  if (workers.length === 0 && cacheNames.length === 0) return false
  if (device.indexedDB) await deleteOldWindowsEntry(device.indexedDB, scope)
  const cacheStorage = device.caches
  if (cacheStorage) await Promise.all(cacheNames.map((name) => cacheStorage.delete(name)))
  await Promise.all(workers.map((registration) => registration.unregister()))
  return true
}
