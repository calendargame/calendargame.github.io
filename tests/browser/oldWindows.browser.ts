// oldWindows — A DEPLOY BRINGS EVERY WINDOW OF THE VERSION BEFORE ONTO IT (Round 26, owner-approved;
// public/sw-old-windows.js). Deploy A, open windows, deploy B, take the update the way a player does
// (the next window opened finds it waiting and applies it), and the windows still on A land on B.
//
// ★ ITS OWN SITE AND ITS OWN WORKER. The rest of the lane keeps the service worker out
// (playwright.config.ts says why); this test is about nothing else, so it opens its own browser
// context with workers allowed, on a server of its own: `dist` served at the lane's base, on another
// port (so another origin - nothing it saves or installs reaches a test beside it), as deploy A or
// deploy B. A is `dist` with its build id changed (index.html's, build-id.txt's, and the worker's
// precache revision of index.html - so B's worker is a new worker to the browser, as a real deploy's
// is); B is `dist` as built.
// ⚠ HEADLESS WINDOWS ARE ALWAYS ON SCREEN. Both engines report every headless window visible and
// focused, whatever is done to it (tried: another page in front, the page frozen, focus emulation, the
// window minimised) - so "a window in the background is reloaded at once, one on screen at its next
// hide or blur" cannot be watched here. What is asserted is that windows on screen are LEFT alone, and
// then, with the `anyVisible` ask (honoured on a loopback address only), that the worker reloads every
// window it wrote down onto B. The hidden and blurred cases are tests/swOldWindows.test.js's, against
// the same file.
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'
import { test, expect, appReady } from './support/app'
import { DIST, HOST, builtBase } from './support/builtSite.js'

const A = 'lane-deploy-A'
const B = readFileSync(join(DIST, 'build-id.txt'), 'utf8').trim()
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

// The site, as deploy A until `deploy('B')`.
async function serveDeploys() {
  let deployed: 'A' | 'B' = 'A'
  const base = builtBase()
  const asA = (file: string, body: Buffer) => {
    if (file.endsWith('index.html'))
      return body.toString('utf8').replace(/(name="cg-build" content=")[^"]*/, `$1${A}`)
    if (file.endsWith('build-id.txt')) return A
    if (file.endsWith(`${sep}sw.js`))
      return body.toString('utf8').replace(/(url:"index.html",revision:")[^"]*/, `$1${A}`)
    return body
  }
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (!path.startsWith(base)) {
      res.statusCode = 404
      return res.end()
    }
    let file = normalize(join(DIST, path.slice(base.length) || 'index.html'))
    if (file === DIST || file.endsWith(sep)) file = join(file, 'index.html')
    if (!file.startsWith(DIST + sep)) {
      res.statusCode = 404
      return res.end()
    }
    try {
      const body = readFileSync(file)
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
      // (every request reaches the server, so a deploy is seen as soon as it is made)
      res.setHeader('Cache-Control', 'no-cache')
      res.end(deployed === 'A' ? asA(file, body) : body)
    } catch {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, HOST, done))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${HOST}:${port}${base}`,
    origin: `http://${HOST}:${port}`,
    deploy: (which: 'A' | 'B') => void (deployed = which),
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

// The build a window is running (its document says so), or null while it is between documents.
const buildOf = (p: Page) =>
  p
    .evaluate(() => document.querySelector('meta[name="cg-build"]')?.getAttribute('content'))
    .catch(() => null)
// The worker's list of windows still on the version before (opened as the worker opens it, and kept
// under its scope).
const oldWindows = (p: Page) =>
  p.evaluate(
    (scope) =>
      new Promise<string[] | null>((done) => {
        const open = indexedDB.open('cg-sw-v1', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('kv')
        open.onerror = () => done(null)
        open.onsuccess = () => {
          const db = open.result
          const read = db.transaction('kv').objectStore('kv').get(`old-windows ${scope}`)
          read.onsuccess = () => {
            db.close()
            done(read.result ?? null)
          }
        }
      }),
    new URL(p.url()).origin + builtBase(),
  )
const original = (p: Page) =>
  p.evaluate(() => (window as unknown as { laneOriginal?: true }).laneOriginal ?? false)

test('after a deploy, every window of the version before lands on the new one', async ({
  browser,
}) => {
  const site = await serveDeploys()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  // The lane's rules for its own contexts (support/app): nothing leaves the machine, and an error a
  // page raises or logs fails the test.
  await context.route(
    (url) => url.origin !== site.origin,
    (route) => route.fulfill({ status: 204, body: '' }),
  )
  const errors: string[] = []
  context.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  context.on('weberror', (e) => errors.push(`uncaught: ${e.error().message}`))
  const open = async () => {
    const p = await context.newPage()
    await p.goto(site.url)
    await appReady(p)
    return p
  }
  try {
    // ── deploy A, and two windows of it, both under its worker
    const first = await open()
    await first.evaluate(async () => void (await navigator.serviceWorker.ready))
    await first.reload() // (a first visit's page is not the worker's; from its next load on, it is)
    await appReady(first)
    const second = await open()
    for (const p of [first, second]) {
      await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
      expect(await buildOf(p)).toBe(A)
      await p.evaluate(
        () => void ((window as unknown as { laneOriginal?: true }).laneOriginal = true),
      )
    }

    // ── deploy B: found in the background, and waiting (the update is never applied mid-session)
    site.deploy('B')
    await first.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update()
    })
    await expect
      .poll(() =>
        first.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true)
    expect([await buildOf(first), await buildOf(second)]).toEqual([A, A])

    // ── the next window opened applies it (src/main.tsx: "Updating…", then a reload onto B)
    const third = await context.newPage()
    await third.goto(site.url)
    await expect.poll(() => buildOf(third), { timeout: 30_000 }).toBe(B)
    await appReady(third)

    // The windows open at the takeover are written down. The two of A are on screen, so they are left
    // alone - the asks the new window makes as it opens (src/sw.ts) reload nothing on screen - and the
    // list settles on exactly them (the third window's own document of A is gone: it reloaded).
    await expect.poll(() => oldWindows(third).then((list) => list?.length)).toBe(2)
    expect([await original(first), await original(second)]).toEqual([true, true])
    expect([await buildOf(first), await buildOf(second)]).toEqual([A, A])

    // ── they are left: the worker reloads both onto B (`anyVisible`, as both are always on screen here)
    await third.evaluate(() =>
      navigator.serviceWorker.controller!.postMessage({
        type: 'SWEEP_OLD_WINDOWS',
        anyVisible: true,
      }),
    )
    for (const p of [first, second]) {
      await expect.poll(() => buildOf(p), { timeout: 30_000 }).toBe(B)
      await appReady(p)
      expect(await original(p)).toBe(false) // (a new document: it was reloaded, not patched)
    }
    expect(await oldWindows(third)).toEqual([])
    expect(errors, 'a page raised or logged an error').toEqual([])
  } finally {
    await context.close()
    await site.close()
  }
})
