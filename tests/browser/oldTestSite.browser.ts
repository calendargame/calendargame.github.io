// oldTestSite — THE TEST SITE'S OLD ADDRESS, GONE FROM A DEVICE (Round 27, Q1; src/lib/oldTestSite.ts).
// Until Round 27 the test site was the /test_version/ path of the live domain, with a service worker of
// its own at that scope. Now GitHub answers that address with a permanent redirect to the test site's
// own domain — but a device that had the old worker never sees it: the worker answers the address from
// its cache. This plays that device, in a real browser: the old worker installed (its Workbox-named
// cache, its entry in the IndexedDB the two workers shared), the address then moved; and asserts that
// opening the live app once clears all three, and that from then on the address reaches the redirect
// instead of being answered — by the old worker, or by the live worker, whose scope '/' holds the old
// address too (vite.config.js: navigateFallbackDenylist).
//
// ★ ITS OWN SITE, WITH WORKERS ALLOWED, like oldWindows.browser.ts (which says why the rest of the lane
// keeps them out): `dist` at the root of a server of its own, the beacon's tag taken out of index.html
// (that file says why); beside it, at /test_version/, a stand-in for the old test site — a page that
// registers a worker at that scope, and the worker: the real public/sw-old-windows.js imported (as the
// old test build's worker imported it), a cache named the way Workbox names its own, and every visit
// in its scope answered from that cache. After "the move", /test_version/<path> is a 301 to <path> on a
// second server — another origin, as https://test.calendargame.app is (on this one, the live worker
// would rightly answer the redirect's target with the app).
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'
import { test, expect, appReady } from './support/app'
import { DIST, HOST } from './support/builtSite.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}
const BEACON = /\s*<script [^>]*static\.cloudflareinsights\.com[^>]*><\/script>/
const OLD_PAGE = `<!doctype html><title>the old test site</title>
<script>navigator.serviceWorker.register('/test_version/sw.js', { scope: '/test_version/' })</script>`
const OLD_BUILD = 'the old test build, from its worker’s cache'
const OLD_WORKER = `importScripts('/sw-old-windows.js')
const CACHE = 'workbox-precache-v2-' + self.registration.scope
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.put(self.registration.scope, new Response(${JSON.stringify(OLD_BUILD)})),
    ),
  )
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate')
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(self.registration.scope)))
})`
const MOVED_PAGE = '<!doctype html><title>the test site, at its own address</title>'

const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, HOST, done))
  return `http://${HOST}:${(server.address() as AddressInfo).port}`
}

async function serveSite() {
  let moved = false
  // The test site at its own address: another origin.
  const testSite = createServer((_req, res) => {
    res.setHeader('Content-Type', TYPES['.html'])
    res.end(MOVED_PAGE)
  })
  const testOrigin = await listen(testSite)
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    const send = (type: string, body: string | Buffer) => {
      res.setHeader('Content-Type', type)
      res.setHeader('Cache-Control', 'no-cache')
      res.end(body)
    }
    if (path === '/test_version' || path.startsWith('/test_version/')) {
      if (moved) {
        res.statusCode = 301
        // (path and query kept, as GitHub's own redirect keeps them)
        const rest = (req.url ?? '').replace(/^\/test_version\/?/, '')
        res.setHeader('Location', `${testOrigin}/${rest}`)
        return res.end()
      }
      if (path === '/test_version/sw.js') return send(TYPES['.js'], OLD_WORKER)
      return send(TYPES['.html'], OLD_PAGE)
    }
    let file = normalize(join(DIST, path.slice(1) || 'index.html'))
    if (file === DIST || file.endsWith(sep)) file = join(file, 'index.html')
    if (!file.startsWith(DIST + sep)) {
      res.statusCode = 404
      return res.end()
    }
    try {
      const body = readFileSync(file)
      send(
        TYPES[extname(file)] ?? 'application/octet-stream',
        file.endsWith('index.html') ? body.toString('utf8').replace(BEACON, '') : body,
      )
    } catch {
      res.statusCode = 404
      res.end()
    }
  })
  const origin = await listen(server)
  const close = (s: Server) => new Promise<void>((done) => s.close(() => done()))
  return {
    origin,
    testOrigin,
    move: () => void (moved = true),
    close: () => Promise.all([close(server), close(testSite)]),
  }
}

// What this origin holds: its workers' scopes, its cache names, and the old-windows entries in the
// IndexedDB the workers share (public/sw-old-windows.js's database, read as that file reads it).
const deviceOf = (p: Page) =>
  p.evaluate(async () => {
    const entries = await new Promise<string[]>((done) => {
      const open = indexedDB.open('cg-sw-v1', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('kv')
      open.onerror = () => done([])
      open.onsuccess = () => {
        const db = open.result
        const read = db.transaction('kv').objectStore('kv').getAllKeys()
        read.onsuccess = () => {
          db.close()
          done((read.result as string[]).sort())
        }
      }
    })
    return {
      workers: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope).sort(),
      caches: (await caches.keys()).sort(),
      entries,
    }
  })

test('opening the live app once clears the old test site, and its address then reaches the redirect', async ({
  browser,
}) => {
  const site = await serveSite()
  const OLD_SCOPE = `${site.origin}/test_version/`
  const LIVE_SCOPE = `${site.origin}/`
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  // The lane's rules for its own contexts (support/app): nothing leaves the machine, and an error a
  // page raises or logs fails the test.
  await context.route(
    (url) => url.origin !== site.origin && url.origin !== site.testOrigin,
    (route) => route.fulfill({ status: 204, body: '' }),
  )
  const errors: string[] = []
  context.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  context.on('weberror', (e) => errors.push(`uncaught: ${e.error().message}`))
  try {
    // ── the device before the move: the old test site visited, its worker active
    const page = await context.newPage()
    await page.goto(OLD_SCOPE)
    await page.evaluate(async () => void (await navigator.serviceWorker.ready))
    await expect
      .poll(() => deviceOf(page))
      .toEqual({
        workers: [OLD_SCOPE],
        caches: [`workbox-precache-v2-${OLD_SCOPE}`],
        entries: [`old-windows ${OLD_SCOPE}`],
      })

    // ── the move: GitHub redirects the address now — and the old worker never hears of it
    site.move()
    await page.goto(OLD_SCOPE)
    await expect(page.locator('body')).toHaveText(OLD_BUILD)
    expect(page.url()).toBe(OLD_SCOPE)

    // ── the live app, opened once: the old worker, its cache, and its entry are gone; the live
    // site's own worker, cache, and entry are there
    await page.goto(LIVE_SCOPE)
    await appReady(page)
    await expect
      .poll(() => deviceOf(page), { timeout: 30_000 })
      .toEqual({
        workers: [LIVE_SCOPE],
        caches: [`workbox-precache-v2-${LIVE_SCOPE}`],
        entries: [`old-windows ${LIVE_SCOPE}`],
      })

    // ── with the live worker in charge of the page, the old address reaches the redirect: neither
    // the old build from a cache nor the live app answers it
    await page.reload()
    await appReady(page)
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await page.goto(`${OLD_SCOPE}?from=a-bookmark`)
    await expect(page).toHaveTitle('the test site, at its own address')
    expect(page.url()).toBe(`${site.testOrigin}/?from=a-bookmark`)

    // ── and the app still opens, offline-ready, at its own address
    await page.goto(LIVE_SCOPE)
    await appReady(page)
    expect(errors, 'a page raised or logged an error').toEqual([])
  } finally {
    await context.close()
    await site.close()
  }
})
