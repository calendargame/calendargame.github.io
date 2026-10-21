// @vitest-environment jsdom
//
// src/sw.ts — what the app registers, and what happens when registering goes wrong.
//
// THIS FILE USED TO BE A SOURCE-TEXT GUARD, and that was the whole problem. sw.ts imported
// 'virtual:pwa-register', a module that only exists inside a real Vite build, so the suite could not
// import it at all; all it could do was read the file and assert that the catch block still contained
// the substring 'captureError('. Two of the conditions it was "covering" then happened in production
// — and neither would have been caught, because a source guard cannot execute anything. (The
// standing lesson: a fixture that only ever exercises the populated state is not coverage.)
//
// Round 12 removed that import — registration is now one direct navigator.serviceWorker.register()
// call — so the module is importable, and every one of these is a real behavioural test that runs
// the actual code. The old source assertions are GONE rather than kept alongside: each is now
// superseded by the behaviour it was standing in for, and a duplicate guard is dead weight.
//
// What is still NOT testable here, and is deliberately verified on-device on the test site: a real service
// worker installing, activating, and taking control. jsdom has no service worker at all — every
// registration below is a stub — so what this file pins is the contract sw.ts holds with that API,
// not the API's own behaviour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// captureError is the observable end of every failure path. Mocked (rather than spied) because the
// real module buffers into a private array with no way to read it back.
const sentry = vi.hoisted(() => ({ captureError: vi.fn(), initObservability: vi.fn() }))
vi.mock('../src/observability/sentry', () => sentry)

let register

// Install a Service Worker API whose register() behaves however this test needs, then load a FRESH
// copy of sw.ts — the module registers at import time, so each case needs its own copy
// (vi.resetModules, the observabilityGate.dom pattern). Awaiting the import is not enough: the
// reporting happens in a .then/.catch off the register() promise, so let the microtasks drain too.
// `registrations` is what getRegistrations() finds: the test site's old worker is cleared from it
// (lib/oldTestSite.ts) at the same import.
const loadSwWith = async (impl, controller = null, registrations = []) => {
  register = vi.fn(impl)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, controller, getRegistrations: vi.fn(async () => registrations) },
  })
  vi.resetModules()
  await import('../src/sw.js')
  await new Promise((r) => setTimeout(r, 0))
}

const reports = () => sentry.captureError.mock.calls

beforeEach(() => {
  sentry.captureError.mockClear()
})
afterEach(() => {
  delete navigator.serviceWorker
  vi.unstubAllEnvs() // the base-relativity case below stubs BASE_URL; undone here so a failed
  // assertion can never leak that base into the next test
})

describe('service-worker registration (src/sw.ts)', () => {
  it('registers the built worker under the app base, at the app base scope, as a classic script', async () => {
    // The single most damaging thing this module could get wrong. vite-plugin-pwa's generated client
    // passed `buildBase + filename` and `scope || basePath` — both of which ARE Vite's resolved base
    // — so the direct call has to reproduce exactly `${BASE_URL}sw.js` and `BASE_URL`. Any drift
    // (a leading './', a trimmed slash, a missing scope) would leave every existing installation
    // beside a second worker at a different scope. Both forms were verified against the BUILT bundle
    // when this replaced the plugin's helper.
    // LITERALS, deliberately — not `${import.meta.env.BASE_URL}sw.js`. An expectation written in the
    // implementation's own expression cannot fail on what that expression RESOLVES to, so it would
    // wave through a hard-coded '/sw.js' in sw.ts, which would go wrong the day the base did. '/' is
    // the base of both sites and of every build (vite.config). Any other base is covered for real
    // by the next case, rather than assumed.
    await loadSwWith(async () => ({ update: vi.fn().mockResolvedValue(undefined) }))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'classic' })
  })

  it('FOLLOWS the base — driven to another base it registers there, not at the root', async () => {
    // The half a single-base assertion can never see. BASE_URL interpolation is what keeps the
    // worker's address and scope the build's own (the test site lived at '/test_version/' until
    // Round 27, and did exactly this). Stubbing the base is what proves the call is base-RELATIVE:
    // a '/sw.js' literal in sw.ts passes the case above and fails this one, and that drift is
    // precisely what would put a second worker at the wrong scope beside every installation.
    vi.stubEnv('BASE_URL', '/sub/')
    await loadSwWith(async () => ({ update: vi.fn().mockResolvedValue(undefined) }))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sub/sw.js', { scope: '/sub/', type: 'classic' })
  })

  it('kicks off the background update() prefetch once registration succeeds', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    await loadSwWith(async () => ({ update }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(reports()).toEqual([])
  })

  it('keeps the update() prefetch SILENT when it fails — an offline no-op is not an error', async () => {
    // The opposite call to every other case here: update() rejecting is the ordinary "no network,
    // nothing newer" case and the app is entirely healthy without it (the worker it already has
    // keeps serving, and the next launch tries again). Reporting it would bury the real signals
    // below in expected noise, and an unhandled rejection would surface it anyway.
    const update = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await loadSwWith(async () => ({ update }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(reports()).toEqual([])
  })

  it('reports a REJECTED registration exactly once, as sw-register', async () => {
    // A 404 on sw.js, a blocked worker, an unsupported scope. The app is left with no offline copy,
    // no update path, and "Check for updates" with nothing to apply through — rare, always
    // actionable, and (before round 11) completely invisible.
    const error = new Error('Failed to register a ServiceWorker: 404')
    await loadSwWith(async () => {
      throw error
    })
    expect(reports()).toEqual([[error, { where: 'sw-register' }]])
  })

  it('reports a registration that RESOLVES undefined — and does not throw', async () => {
    // The production crash this replacement fixed at the root. A device whose Service Worker API is
    // stubbed (privacy extension, enterprise shim, bot) resolves register() with `undefined`, which
    // is not spec-legal. workbox-window 7.4.1 then read `this._registration.waiting` unguarded and
    // threw "Cannot read properties of undefined (reading 'waiting')" from inside a minified
    // third-party bundle — a signature with no public report anywhere and no upstream fix coming.
    // The same device now produces one named report from our own code, and the import still settles.
    await expect(loadSwWith(async () => undefined)).resolves.toBeUndefined()
    expect(reports()).toHaveLength(1)
    const [error, context] = reports()[0]
    expect(context).toEqual({ where: 'sw-register' })
    expect(error).toBeInstanceOf(TypeError)
    // Says what actually happened, in OUR words — the whole point of the change.
    expect(String(error)).toContain('resolved undefined')
  })

  it('reports a registration that resolves null the same way', async () => {
    // Same class of stub, other falsy value. Nothing about the guard is special-cased to undefined.
    await loadSwWith(async () => null)
    expect(reports()).toHaveLength(1)
    expect(reports()[0][1]).toEqual({ where: 'sw-register' })
    expect(String(reports()[0][0])).toContain('resolved null')
  })
})

// Round 26: a window of the new version asks the worker to reload the windows of the version before
// (public/sw-old-windows.js) whenever one may have been left - and only asks: nothing here reloads.
describe('the asks to reload the windows of the version before', () => {
  it('asks the controlling worker on visibility, focus, page-show, and another window’s save', async () => {
    const controller = { postMessage: vi.fn() }
    await loadSwWith(async () => ({ update: vi.fn().mockResolvedValue(undefined) }), controller)
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    for (const type of ['pageshow', 'focus', 'blur']) window.dispatchEvent(new Event(type))
    window.dispatchEvent(new StorageEvent('storage', { key: 'cg-elsewhere' }))
    expect(controller.postMessage).toHaveBeenCalledTimes(5)
    for (const [message] of controller.postMessage.mock.calls)
      expect(message).toEqual({ type: 'SWEEP_OLD_WINDOWS' })
    expect(reports()).toEqual([])
  })

  it('asks nothing of a window no worker controls yet - and does not throw', async () => {
    await loadSwWith(async () => ({ update: vi.fn().mockResolvedValue(undefined) }))
    window.dispatchEvent(new Event('focus'))
    expect(reports()).toEqual([])
  })
})

// Round 27: the test site's OLD address (calendargame.app/test_version/) — its worker is cleared from the
// device at every open. What is cleared, and what never is, is tests/oldTestSite.test.js's; this is
// that sw.ts does it, alongside registering, and quietly.
describe('the test site’s old worker', () => {
  const ok = async () => ({ update: vi.fn().mockResolvedValue(undefined) })

  it('is unregistered at the same import — and the live worker beside it is not', async () => {
    // (this page's own origin, as on the live site: the old address is a path of it)
    const live = { scope: new URL('/', location.origin).href, unregister: vi.fn() }
    const old = { scope: new URL('/test_version/', location.origin).href, unregister: vi.fn() }
    await loadSwWith(ok, null, [live, old])
    expect(old.unregister).toHaveBeenCalledTimes(1)
    expect(live.unregister).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledTimes(1)
    expect(reports()).toEqual([])
  })

  it('is cleared quietly: a failure is neither reported nor thrown (the next open finishes it)', async () => {
    const old = {
      scope: new URL('/test_version/', location.origin).href,
      unregister: vi.fn().mockRejectedValue(new Error('busy')),
    }
    await loadSwWith(ok, null, [old])
    expect(old.unregister).toHaveBeenCalledTimes(1)
    expect(reports()).toEqual([])
  })
})
