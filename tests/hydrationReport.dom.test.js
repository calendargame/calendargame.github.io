// @vitest-environment jsdom
// hydrationReport — A SAVED STORE'S LOAD THAT THREW IS REPORTED, NOT SWALLOWED (store/hydrationReport).
// zustand's `persist` hands a load's error to `onRehydrateStorage` and to nothing else; each store's is
// built by `reportedHydration`, which reports it the way store/progress always reported its own.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

vi.mock('../src/observability/sentry.js', () => ({ captureError: vi.fn() }))

// The stores are created afresh here, after the mock: the test setup (tests/setup/dom.js) has already
// created them once, against the real reporter.
let captureError, reportedHydration, atCreation
const STORES = {}
beforeAll(async () => {
  vi.resetModules()
  ;({ captureError } = await import('../src/observability/sentry.js'))
  ;({ reportedHydration } = await import('../src/store/hydrationReport.js'))
  const { useLookupHistory } = await import('../src/store/lookupHistory.js')
  Object.assign(STORES, {
    settingsRehydrate: (await import('../src/store/settings.js')).useSettings,
    modePrefsRehydrate: (await import('../src/store/modePrefs.js')).useModePrefs,
    userDefaultsRehydrate: (await import('../src/store/userDefaults.js')).useUserDefaults,
    julianRangeRehydrate: (await import('../src/store/julianRange.js')).useJulianRange,
    presetsRehydrate: (await import('../src/store/presets.js')).usePresets,
    progressRehydrate: (await import('../src/store/progress.js')).useProgress,
    lookupHistoryRehydrate: useLookupHistory,
  })
  atCreation = reportedTripwires()
})
const TRIPWIRES = [
  'settingsRehydrate',
  'modePrefsRehydrate',
  'userDefaultsRehydrate',
  'julianRangeRehydrate',
  'presetsRehydrate',
  'progressRehydrate',
  'lookupHistoryRehydrate',
]
const reportedTripwires = () =>
  captureError.mock.calls.map(([, context]) => context?.tripwire).filter(Boolean)

describe('reportedHydration', () => {
  beforeEach(() => captureError.mockClear())

  it('reports a load that threw under its tripwire, and does not run the after-load work', () => {
    const then = vi.fn()
    reportedHydration('xRehydrate', then)()(undefined, new Error('boom'))
    expect(captureError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), {
      tripwire: 'xRehydrate',
    })
    expect(then).not.toHaveBeenCalled()
  })

  it('a good load reports nothing and runs the after-load work with the state', () => {
    const then = vi.fn()
    reportedHydration('xRehydrate', then)()({ a: 1 }, undefined)
    expect(captureError).not.toHaveBeenCalled()
    expect(then).toHaveBeenCalledWith({ a: 1 })
  })

  it('a thrown value that is not an Error is reported as one', () => {
    reportedHydration('xRehydrate')()(undefined, 'text')
    expect(captureError.mock.calls[0][0]).toBeInstanceOf(Error)
  })
})

describe('every saved store reports its own load', () => {
  // ★ The fault this closes: during Round 26's build the ⚙ settings store's load threw at module
  // creation, the store opened on its factory values, and nothing said so.
  it('the stores loaded when the app’s modules were created, and none of them reported a fault', () => {
    expect(Object.keys(STORES).sort()).toEqual([...TRIPWIRES].sort())
    expect(atCreation).toEqual([])
  })

  it.each(TRIPWIRES)('%s: a load that throws is reported under that name', (tripwire) => {
    captureError.mockClear()
    const store = STORES[tripwire]
    const storage = store.persist.getOptions().storage
    const spy = vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('unreadable')
    })
    try {
      store.persist.rehydrate()
    } finally {
      spy.mockRestore()
    }
    expect(reportedTripwires()).toEqual([tripwire])
  })
})
