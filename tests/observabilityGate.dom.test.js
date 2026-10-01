// @vitest-environment jsdom
//
// Error reporting must never start on a LOCALLY-SERVED build.
//
// `vite preview` (and any headless run pointed at it) serves a real production bundle, so
// import.meta.env.PROD is TRUE there and main.tsx's build-time gate lets it through. It then
// initialises against the live DSN, and because the environment tag is derived from the URL PATH
// (staging is the /test_version/ subpath of the same host), a loopback URL matches neither the live
// root nor staging and files as 'staging' — i.e. local previews land in the very bucket we read to
// check a deploy. So initObservability() carries the runtime half of the gate.
//
// Harness notes: `started` is module scope, so each case imports a FRESH copy (vi.resetModules +
// dynamic import — the backButton.dom pattern). jsdom's window.location can't be reassigned in
// place, so the whole object is swapped (the forceReload.dom pattern). The lazy SDK chunk is
// MOCKED: @sentry/react's init() opens transports against the real project, which a test must
// never do — and the mock is also what makes "did the chunk load?" observable.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sentryClient = vi.hoisted(() => ({ startSentry: vi.fn(), report: vi.fn() }))
vi.mock('../src/observability/sentryClient', () => sentryClient)

// The two eager handlers initObservability() installs to buffer crashes that fire before the SDK
// arrives. Installing them is the first observable thing a real start does.
const BUFFERING_EVENTS = ['error', 'unhandledrejection']

let origLocation
let addSpy

function setHostname(hostname) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: `https://${hostname}/`,
      origin: `https://${hostname}`,
      protocol: 'https:',
      host: hostname,
      hostname,
      pathname: '/',
      search: '',
      hash: '',
    },
  })
}

// Which of the buffering handlers this run installed, in BUFFERING_EVENTS order. Read from the spy's
// call record, not from the live listener set, so the SDK's own stopBuffering() teardown can't erase
// the evidence that a start happened.
function installedBufferingEvents() {
  return BUFFERING_EVENTS.filter((type) => addSpy.mock.calls.some(([t]) => t === type))
}

async function initFreshOn(hostname) {
  setHostname(hostname)
  vi.resetModules()
  const { initObservability } = await import('../src/observability/sentry')
  initObservability()
  // Let the dynamic import()'s .then land — that is where the SDK would actually start.
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  sentryClient.startSentry.mockClear()
  sentryClient.report.mockClear()
  origLocation = window.location
  addSpy = vi.spyOn(window, 'addEventListener')
})

afterEach(() => {
  // Detach anything a run left attached, so a discarded module copy can't answer a later test.
  for (const [type, fn, opts] of addSpy.mock.calls) window.removeEventListener(type, fn, opts)
  addSpy.mockRestore()
  Object.defineProperty(window, 'location', { configurable: true, value: origLocation })
})

describe('observability start gate', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    it(`refuses to start on ${hostname} — no SDK chunk, no global handlers`, async () => {
      await initFreshOn(hostname)
      expect(sentryClient.startSentry).not.toHaveBeenCalled()
      expect(installedBufferingEvents()).toEqual([])
    })
  }

  it('still starts on the deployed host — the guard is loopback-only, not a kill switch', async () => {
    await initFreshOn('calendargame.app')
    expect(sentryClient.startSentry).toHaveBeenCalledTimes(1)
    expect(installedBufferingEvents()).toEqual(BUFFERING_EVENTS)
  })
})
