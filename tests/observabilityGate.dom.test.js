// @vitest-environment jsdom
//
// Error reporting starts on the two sites' own hostnames (src/sites.ts) and NOWHERE ELSE.
//
// A built copy of the app is import.meta.env.PROD wherever it is served — `vite preview`, the browser
// lane, a phone on the laptop's LAN address, a tunnel — so main.tsx's build-time gate lets every one
// of them through, and each would report into the real project as a visitor, into the very data read
// to check a deploy. So initObservability() carries the runtime half of the gate: an ALLOW-list of the
// two hostnames (Round 27; it was a deny-list of the three loopback names, which missed every LAN
// address and tunnel), and the environment each report is filed under comes from the same row.
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
  for (const hostname of [
    'localhost',
    '127.0.0.1',
    '[::1]',
    '192.168.1.20', // a phone on the laptop's LAN address
    '10.0.0.5',
    'quiet-river-1234.trycloudflare.com', // a tunnel to a laptop
    'calendargame.github.io', // GitHub's own name for the live repo (it redirects, but never serves)
    'calendargame.app.example.com', // a look-alike
  ]) {
    it(`refuses to start on ${hostname} — no SDK chunk, no global handlers`, async () => {
      await initFreshOn(hostname)
      expect(sentryClient.startSentry).not.toHaveBeenCalled()
      expect(installedBufferingEvents()).toEqual([])
    })
  }

  for (const [hostname, environment] of [
    ['calendargame.app', 'production'],
    ['test.calendargame.app', 'staging'],
  ]) {
    it(`starts on ${hostname}, filed under '${environment}'`, async () => {
      await initFreshOn(hostname)
      expect(sentryClient.startSentry).toHaveBeenCalledTimes(1)
      expect(sentryClient.startSentry).toHaveBeenCalledWith(environment)
      expect(installedBufferingEvents()).toEqual(BUFFERING_EVENTS)
    })
  }
})
