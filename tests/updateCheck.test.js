// tests/updateCheck.test.js — the detector behind "Check for updates" (round 11).
//
// The button used to reload unconditionally; it now asks first, and every way that question can be
// answered is pinned here. Three of these tests exist because the OPPOSITE behaviour was measured
// on a real Workbox service worker and would silently break the feature if a later edit "simplified"
// it back: the cache-busting parameter must not be one Workbox strips, a worker already parked in
// `waiting` must count as an update on its own, and an unanswerable question must never be rounded
// into a verdict in either direction.
//
// The DOM half — the four labels, the strut, the 3s revert, the applier and its forceReloadLatest
// fallback — is tests/checkUpdates.dom.test.jsx.
import { describe, it, expect, vi } from 'vitest'
import {
  BUILD_ID_FILE,
  BUILD_ID_META,
  CHECK_PARAM,
  UPDATE_CHECK_LABEL,
  UPDATE_CHECK_CEILING_MS,
  UPDATE_RESULT_MS,
  buildIdUrl,
  checkForUpdate,
  makeCheckNonce,
  readOwnBuildId,
} from '../src/lib/updateCheck.js'

// Two build ids in the shape the build actually writes (sha256 hex): the runtime refuses a body
// that is not a plausible id token, so test fixtures must be real ones.
const OWN = 'a'.repeat(64)
const NEWER = 'f762bedd56f680561b8a8a1232c1fe1a3f50e7e55d1a200ebf32c9e430e3d570'

// A fetch that answers with a body, or fails, and records the URL + init it was called with.
const okFetch = (body, ok = true) => {
  const calls = []
  const impl = vi.fn(async (url, init) => {
    calls.push({ url, init })
    return { ok, text: async () => body }
  })
  impl.calls = calls
  return impl
}

describe('the cache-busting parameter (measured against a real Workbox SW)', () => {
  it('is not one Workbox strips before matching a precache route', () => {
    // Workbox's shipped ignoreURLParametersMatching defaults are [/^utm_/, /^fbclid$/]. A parameter
    // matching either is REMOVED before the precache route is matched, so the service worker would
    // answer from its cache with the very build we are trying to see past — the check would compare
    // this build against itself and report "Up to date" forever.
    expect(CHECK_PARAM).not.toMatch(/^utm_/)
    expect(CHECK_PARAM).not.toMatch(/^fbclid$/)
    expect(CHECK_PARAM.length).toBeGreaterThan(0)
  })

  it('makes every check a distinct URL, even twice inside one millisecond', () => {
    expect(makeCheckNonce(1000, 0.1)).not.toBe(makeCheckNonce(1000, 0.9))
    expect(makeCheckNonce(1000, 0.5)).not.toBe(makeCheckNonce(2000, 0.5))
    expect(makeCheckNonce()).toMatch(/^[0-9a-z]+$/)
  })
})

describe('buildIdUrl — the identity file, under the app base', () => {
  it('resolves against the LIVE root and the STAGING subpath', () => {
    // Staging is a subpath of the same host (calendargame.app/test_version/). A root-absolute URL
    // would read the APEX build's identity and compare two different sites — staging would report
    // an update forever, or none, depending on which was newer.
    expect(buildIdUrl('/', 'abc')).toBe(`/${BUILD_ID_FILE}?${CHECK_PARAM}=abc`)
    expect(buildIdUrl('/test_version/', 'abc')).toBe(
      `/test_version/${BUILD_ID_FILE}?${CHECK_PARAM}=abc`,
    )
  })

  it('never welds the filename onto a base that lost its trailing slash', () => {
    expect(buildIdUrl('/test_version', 'abc')).toBe(
      `/test_version/${BUILD_ID_FILE}?${CHECK_PARAM}=abc`,
    )
  })
})

describe('the four labels', () => {
  it('all fit the resting label, which is therefore a sound strut', () => {
    // The button reserves the resting label's width with a hidden strut so the Changelog link
    // beside it cannot shift. That promise holds only while every other label is no wider — a
    // future fifth state (or a wordier "No connection") would break the layout silently, so the
    // constraint lives here rather than in a comment.
    const resting = UPDATE_CHECK_LABEL.idle
    expect(resting).toBe('Check for updates')
    for (const [state, label] of Object.entries(UPDATE_CHECK_LABEL)) {
      expect(label.length, `${state} label is wider than the strut`).toBeLessThanOrEqual(
        resting.length,
      )
      expect(label, `${state} label must not end in a period`).not.toMatch(/\.$/)
      expect(label.trim()).toBe(label)
    }
  })

  it('a result shows for exactly 3s and the network give-up is a much longer failure bound', () => {
    expect(UPDATE_RESULT_MS).toBe(3000)
    expect(UPDATE_CHECK_CEILING_MS).toBeGreaterThan(UPDATE_RESULT_MS)
  })
})

describe('readOwnBuildId — which build this page is running', () => {
  // A stand-in document, so this file stays in the fast Node environment. It also PINS the
  // selector: the meta name here and the one vite.config.js injects are the same exported
  // constant, and this asserts the reader really looks for that one.
  const docWith = (content) => ({
    querySelector(selector) {
      expect(selector).toBe(`meta[name="${BUILD_ID_META}"]`)
      return content === null ? null : { getAttribute: () => content }
    },
  })

  it('reads the meta the build injected', () => {
    expect(readOwnBuildId(docWith(` ${OWN} `))).toBe(OWN)
  })

  it('is null when there is no meta at all (dev, tests, a page built before this feature)', () => {
    expect(readOwnBuildId(docWith(null))).toBe(null)
    expect(readOwnBuildId(docWith(''))).toBe(null)
    expect(readOwnBuildId(docWith('   '))).toBe(null)
  })

  it('is null for content that is not a build id at all', () => {
    // Null means "cannot compare", which checkForUpdate answers with 'current'. Accepting junk here
    // would instead make it unequal to every real id — an update reported on every press, forever.
    expect(readOwnBuildId(docWith('<!doctype html>'))).toBe(null)
    expect(readOwnBuildId(docWith('short'))).toBe(null)
  })
})

describe('checkForUpdate', () => {
  const base = { url: '/build-id.txt?cg=1', ownId: OWN, hasWaitingWorker: false }

  it('a worker already WAITING is an update on its own — and asks the network nothing', async () => {
    // Reproduced during the Q7 research: with a worker already parked, a fresh registration.update()
    // reports nothing new. The parked worker IS the downloaded update, so it is checked first and
    // the network is never consulted — this branch must not depend on a connection.
    const fetchImpl = okFetch(OWN)
    expect(await checkForUpdate({ ...base, hasWaitingWorker: true, fetchImpl })).toBe('update')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a different deployed id is an update; the same id is not', async () => {
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch(NEWER) })).toBe('update')
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch(OWN) })).toBe('current')
  })

  it('tolerates the trailing newline the build writes', async () => {
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch(`${OWN}\n`) })).toBe('current')
  })

  it('a body that is not a build id is "offline" — NOT an update', async () => {
    // The dangerous one. A host answering the identity fetch with an HTML page — a single-page-app
    // navigation fallback, a proxy notice, a captive portal — returns ok:true with a body that
    // compares unequal to our id. Read naively that is "an update is available", on every press,
    // forever: the button would apply an update that never resolves. It is not an answer, so it is
    // not treated as one.
    expect(
      await checkForUpdate({
        ...base,
        fetchImpl: okFetch('<!doctype html><html><head><title>Calendar Game</title>'),
      }),
    ).toBe('offline')
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch('{"error":"not found"}') })).toBe(
      'offline',
    )
  })

  it('a non-ok response, an empty body, or a thrown fetch are all "offline", never a verdict', async () => {
    // The failure direction matters: an error page answering 200, or a captive portal, must not be
    // allowed to say "Up to date" — and must not claim an update either. Unanswered is its own
    // state, which is why the button has a third label.
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch(NEWER, false) })).toBe('offline')
    expect(await checkForUpdate({ ...base, fetchImpl: okFetch('   ') })).toBe('offline')
    const thrower = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await checkForUpdate({ ...base, fetchImpl: thrower })).toBe('offline')
  })

  it('with no own id to compare (dev/tests) it reports current — never a fabricated update', async () => {
    // A null own id compares unequal to every real id, so a naive comparison would report an
    // update on every press forever, in dev and in any build that somehow shipped without its meta.
    expect(await checkForUpdate({ ...base, ownId: null, fetchImpl: okFetch(NEWER) })).toBe(
      'current',
    )
  })

  it('gives up on a hung network at the ceiling, and aborts the request it gave up on', async () => {
    vi.useFakeTimers()
    try {
      let seenSignal
      const hang = vi.fn(
        (url, init) =>
          new Promise((_resolve, reject) => {
            seenSignal = init.signal
            init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const verdict = checkForUpdate({ ...base, fetchImpl: hang, timeoutMs: 5000 })
      await vi.advanceTimersByTimeAsync(4999)
      expect(seenSignal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(seenSignal.aborted).toBe(true)
      expect(await verdict).toBe('offline')
    } finally {
      vi.useRealTimers()
    }
  })

  it("the CALLER's abort (settings closing) cancels the request too", async () => {
    const controller = new AbortController()
    let seenSignal
    const hang = vi.fn(
      (url, init) =>
        new Promise((_resolve, reject) => {
          seenSignal = init.signal
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const verdict = checkForUpdate({ ...base, fetchImpl: hang, signal: controller.signal })
    controller.abort()
    expect(await verdict).toBe('offline')
    expect(seenSignal.aborted).toBe(true)
  })

  it('an already-aborted caller signal never reaches the network', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async (url, init) => {
      if (init.signal.aborted) throw new Error('aborted')
      return { ok: true, text: async () => NEWER }
    })
    expect(await checkForUpdate({ ...base, fetchImpl, signal: controller.signal })).toBe('offline')
  })
})
