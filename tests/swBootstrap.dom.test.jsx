// @vitest-environment jsdom
//
// The service-worker BOOTSTRAP in main.tsx — the two ways the app can end up with no service worker
// at all, and what it does about each.
//
// src/sw.ts's own failure modes are tests/swRegistration.dom.test.js. This file covers the half that
// lives in the auto-update-on-open effect: the dynamic import of that module, and the branch that
// runs when the browser has no Service Worker API in the first place. Both used to be untestable —
// the effect is import.meta.env.PROD-gated, so under Vitest it simply returned — and the import
// failure was pinned only by a source-text guard that read main.tsx as a string. It happened for
// real in production (a "Failed to fetch dynamically imported module" on a load not yet controlled
// by a worker) while that guard sat there passing, which is what a source guard is worth.
//
// vi.stubEnv('PROD', true) opens the gate so the real production boot path runs. The module-scope
// auto-mount and the observability start in main.tsx are both #root-guarded, and #root is created
// AFTER the import here, so neither fires — this file mounts <App/> itself, exactly as the other DOM
// tests do.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { BUILD_ID_META, UPDATE_CHECK_LABEL } from '../src/lib/updateCheck.js'

// captureError is the observable end of both routes. Mocked (rather than spied) because the real
// module buffers into a private array with no way to read it back.
const sentry = vi.hoisted(() => ({ captureError: vi.fn(), initObservability: vi.fn() }))
vi.mock('../src/observability/sentry', () => sentry)
// src/sw.ts as a chunk that will not load — the production case, where the browser could not fetch
// assets/sw-<hash>.js. Vitest re-wraps whatever a mock factory throws in its own error, so these
// tests assert the ROUTE the rejection takes and not its message; the message is the browser's
// anyway, never ours.
vi.mock('../src/sw.js', () => {
  throw new Error('the register chunk could not be fetched')
})

const OWN_ID = 'a5983de731e1224c945b1abe288e502d'
const NEWER_ID = 'f762bedd56f680561b8a8a1232c1fe1a'
const MIN_UPDATING_MS = 1000 // main.tsx's own timing (module-private there)

let reload, cacheDelete, origLocation, buildMeta

// A FRESH copy of main.tsx per test (vi.resetModules — the observabilityGate.dom pattern): the
// effect under test runs once per module instance, on mount.
const mountApp = async () => {
  vi.resetModules()
  const { App } = await import('../src/main.jsx')
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  let view
  await act(async () => {
    view = render(<App />)
  })
  await settleBoot()
  return view
}
// Let every pending MICROTASK and any due fake timer run. Enough for anything whose promise is
// already settled or settles on the microtask queue (getRegistration, fetch — both mocks here).
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
// Finish the boot effect's async tail. The effect fires two promises it never awaits: a REAL dynamic
// import of src/sw.js and navigator.serviceWorker.getRegistration(). getRegistration is a mock, so
// settle() covers it — but the import is resolved by Vitest's module runner (fetch + transform + the
// mock factory), which is I/O, and no number of microtask flushes can conjure I/O that has not
// finished. Awaiting the SAME module request here is what makes the mount deterministic: the runner
// keys its in-flight requests by resolved id, so `../src/sw.js` here and `./sw.js` in main.tsx are
// one promise — when this returns, the effect's .catch is queued and the settle() below delivers it.
// Without it this file was load-dependent: alone, the import happened to land inside the one settle()
// turn; in a saturated full-suite run it did not, and the file failed wholesale. (The suite's
// standing lesson: a test that only passes when the machine is idle is a broken TEST, and the fix is
// to remove the race — never to raise a timeout. There is no timeout in this file to raise.)
const settleBoot = async () => {
  await import('../src/sw.js').catch(() => {}) // rejects by design — this file mocks it to throw
  await settle()
}
const updatingOverlay = () => document.querySelector('.boot-updating')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('PROD', true)
  localStorage.clear()
  sessionStorage.clear()
  useSettings.getState().resetToFactory()
  sentry.captureError.mockClear()
  cacheDelete = vi.fn().mockResolvedValue(true)
  globalThis.caches = {
    keys: vi.fn().mockResolvedValue(['app-shell', 'assets']),
    delete: cacheDelete,
  }
  // jsdom's location.reload is non-configurable, so the whole object is replaced.
  reload = vi.fn()
  origLocation = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost/',
      origin: 'http://localhost',
      pathname: '/',
      search: '',
      hash: '',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      reload,
      assign() {},
      replace() {},
    },
  })
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: origLocation })
  cleanup()
  document.getElementById('root')?.remove()
  buildMeta?.remove()
  buildMeta = undefined
  delete navigator.serviceWorker
  delete globalThis.caches
  delete globalThis.fetch
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('the register module failing to load (main.tsx → sw-module-import)', () => {
  it('reports it, once, and the app boots anyway', async () => {
    // The chunk is one of two INDEPENDENT ways to end up with no service worker (the other is
    // register() itself failing, inside sw.ts). It is not a crash: the app runs perfectly well
    // without a worker — it just has no offline copy and no update path, and before round 11 nothing
    // anywhere said so.
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    await mountApp()
    expect(sentry.captureError.mock.calls.map(([, ctx]) => ctx)).toEqual([
      { where: 'sw-module-import' },
    ])
    // Still a working app: the gear is on screen and nothing is stuck behind the Updating overlay.
    expect(screen.getByRole('button', { name: /^Settings/ })).toBeInTheDocument()
    expect(updatingOverlay()).toBe(null)
  })
})

describe('no Service Worker API at all', () => {
  // jsdom has none by default, which is exactly the shape of the real case: an old browser, a
  // hardened/privacy build, or a non-secure context. Nothing here is an error — the app is simply
  // running without offline support — so nothing is reported.

  it('the auto-update-on-open effect no-ops — it never even reaches for the register module', async () => {
    // A sharp assertion, not a soft one: src/sw.js is mocked to throw on load in this file, so if the
    // effect had run past its guard the dynamic import would have rejected into captureError with
    // {where:'sw-module-import'}. Silence is proof the guard returned first.
    expect('serviceWorker' in navigator).toBe(false)
    await mountApp()
    expect(sentry.captureError).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Settings/ })).toBeInTheDocument()
    expect(updatingOverlay()).toBe(null)
  })

  it('"Check for updates" still works — it falls through to the hard-reload path', async () => {
    // The button must never be dead just because there is no worker to apply an update through.
    // With no registration to hand off to, forceReloadLatest IS the update path: it skips the
    // unregister step it cannot perform, clears the Cache-API caches, and reloads — so the next
    // load fetches everything fresh from the server. (checkUpdates.dom covers the neighbouring
    // case, where the API exists but getRegistration() answers null.)
    localStorage.setItem('cg-preserve-probe', 'kept') // a neutral key the app never touches
    buildMeta = document.createElement('meta')
    buildMeta.setAttribute('name', BUILD_ID_META)
    buildMeta.setAttribute('content', OWN_ID)
    document.head.appendChild(buildMeta)
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => `${NEWER_ID}\n` }))

    await mountApp()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Settings/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: UPDATE_CHECK_LABEL.idle }))
    })
    await settle()

    // The Updating screen shows FIRST — the check promised an update, so the user sees one land.
    expect(updatingOverlay()).not.toBe(null)
    expect(reload).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_UPDATING_MS + 50)
    })
    expect(cacheDelete).toHaveBeenCalledWith('app-shell')
    expect(cacheDelete).toHaveBeenCalledWith('assets')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('cg-skip-boot-hold')).toBe('1')
    // Saved data is NEVER cleared — only the app/asset cache is.
    expect(localStorage.getItem('cg-preserve-probe')).toBe('kept')
    // And none of it reported anything: a browser without service workers is not a fault.
    expect(sentry.captureError).not.toHaveBeenCalled()
  })
})

describe("the auto-update effect's controllerchange listener", () => {
  // navigator.serviceWorker is a GLOBAL — it outlives the component — so a listener this effect
  // attaches and never detaches lives for the whole page, holding its reload gate and closure with
  // it. The listener was added bare (no {once:true}) and the cleanup did not remove it, so both
  // halves were missing at once: it survived its own firing AND it survived unmount.
  const installWaitingWorker = () => {
    const sw = {
      getRegistration: vi.fn().mockResolvedValue({ waiting: { postMessage: vi.fn() } }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
    return sw
  }

  it('is registered {once:true} and detached on cleanup', async () => {
    const sw = installWaitingWorker()
    const view = await mountApp()
    const added = sw.addEventListener.mock.calls.filter(([type]) => type === 'controllerchange')
    expect(added).toHaveLength(1)
    // {once:true} covers the fired case — the browser detaches it for us. It is safe precisely
    // because the reload gate is already one-shot, so only the FIRST controllerchange ever did
    // anything; a second one was always a no-op that kept the closure alive.
    expect(added[0][2]).toEqual({ once: true })
    // …and the cleanup covers the case {once:true} cannot: controllerchange never arriving at all,
    // which is the entire reason the effect carries a 4s safety net.
    expect(sw.removeEventListener).not.toHaveBeenCalled()
    await act(async () => {
      view.unmount()
    })
    expect(sw.removeEventListener).toHaveBeenCalledWith('controllerchange', added[0][1])
  })
})
