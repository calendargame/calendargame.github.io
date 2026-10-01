// @vitest-environment jsdom
//
// "Check for updates" — the settings-footer button, rebuilt in round 11 to actually CHECK.
//
// It used to be a lie by construction: press it and it showed the Updating screen, waited, and ran
// forceReloadLatest() — unregistering the service worker and deleting every cache — whether or not
// anything had changed. So it claimed an update on every press and destroyed the offline copy each
// time. This file supersedes tests/forceReload.dom.test.jsx and keeps all of its assertions: the
// hammer still exists and still preserves localStorage, but it is now the FALLBACK the button
// reaches for only when it has promised an update the gentle path cannot deliver.
//
// The detector's own logic (what the verdicts are and why) is tests/updateCheck.test.js; this file
// is the wiring: the four labels, the strut, the disabled state, the 3s revert, the settings-close
// reset, and the three routes out of a positive check.
//
// Not verifiable here (jsdom has no service worker and no layout): that the strut actually holds
// the row steady on screen, and the real SKIP_WAITING → controllerchange handoff. Those are staging
// device checks, as all SW behaviour in this app is.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import { mountApp, openSettings, closeSettings, resetAppState } from './helpers/settingsPanel.jsx'
import { BUILD_ID_META, UPDATE_CHECK_LABEL, CHECK_PARAM } from '../src/lib/updateCheck.js'
import { useSettings } from '../src/store/settings.js'
import { useStorageHealth } from '../src/store/storageHealth.js'

// The applier reports a failed update() to Sentry, so what it does NOT report is testable too — see
// the abandonment pair at the end. Mocked (rather than spied) because the real module buffers into a
// private array with no way to read it back.
const sentry = vi.hoisted(() => ({ captureError: vi.fn(), initObservability: vi.fn() }))
vi.mock('../src/observability/sentry', () => sentry)

const OWN_ID = 'a5983de731e1224c945b1abe288e502d'
const NEWER_ID = 'f762bedd56f680561b8a8a1232c1fe1a'

// main.tsx's own timings (MIN_UPDATING_MS / UPDATE_HANDOFF_MS are module-private there).
const MIN_UPDATING_MS = 1000
const UPDATE_HANDOFF_MS = 8000

describe('Check for updates (check, then apply)', () => {
  let reload, unregister, cacheDelete, swListeners, origLocation, buildMeta

  // The running build's identity, exactly as vite.config.js's buildIdentity plugin injects it.
  const setOwnBuildId = (id) => {
    buildMeta = document.createElement('meta')
    buildMeta.setAttribute('name', BUILD_ID_META)
    buildMeta.setAttribute('content', id)
    document.head.appendChild(buildMeta)
  }

  // The deployed build's identity file. `null` body = the network refused the question entirely.
  const serveBuildId = (body) =>
    vi.fn(async (url, init) => {
      if (body === null) throw new TypeError('Failed to fetch')
      if (init?.signal?.aborted) throw new Error('aborted')
      return { ok: true, text: async () => body, url }
    })

  const installServiceWorker = (registration) => {
    swListeners = {}
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
        addEventListener: (type, fn) => {
          ;(swListeners[type] ??= []).push(fn)
        },
        // A REAL removal, so "did the applier detach what it attached?" is answerable by reading
        // swListeners rather than by trusting a spy. (It was a no-op stub, which quietly made every
        // detach look identical to no detach at all.)
        removeEventListener: (type, fn) => {
          swListeners[type] = (swListeners[type] ?? []).filter((f) => f !== fn)
        },
      },
    })
  }
  const fireControllerChange = () => {
    for (const fn of swListeners.controllerchange ?? []) fn()
  }

  // The button, whatever label it is currently wearing. Found by ACCESSIBLE NAME, which is the live
  // label alone — the strut beside it is aria-hidden, so it contributes width and nothing else.
  // (textContent would read both spans at once, which is the point of the strut.)
  const checkButton = () => {
    for (const name of Object.values(UPDATE_CHECK_LABEL)) {
      const found = screen.queryByRole('button', { name })
      if (found) return found
    }
    throw new Error('the Check for updates button is not on screen')
  }
  const label = () => checkButton().querySelector('span:not([aria-hidden])').textContent
  // The full-screen "Updating…" screen (BootOverlay's updating variant). Present only while an
  // update is actually being applied.
  const updatingOverlay = () => document.querySelector('.boot-updating')
  // Let every pending microtask (getRegistration → fetch → text) and any due timer run.
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  const press = async () => {
    await act(async () => {
      fireEvent.click(checkButton())
    })
    await settle()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    sentry.captureError.mockClear()
    resetAppState()
    sessionStorage.clear() // the skip-boot-hold assertions must see THIS test's stamp
    setOwnBuildId(OWN_ID)
    unregister = vi.fn().mockResolvedValue(true)
    cacheDelete = vi.fn().mockResolvedValue(true)
    globalThis.caches = {
      keys: vi.fn().mockResolvedValue(['app-shell', 'assets']),
      delete: cacheDelete,
    }
    installServiceWorker(null)
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
    delete globalThis.caches
    delete globalThis.fetch
    vi.useRealTimers()
  })

  it('says "Up to date" — and touches NOTHING — when the deployed build is this one', async () => {
    // The whole point of the item. The old button reloaded here, wiping the offline copy for a
    // press that had nothing to get.
    globalThis.fetch = serveBuildId(`${OWN_ID}\n`)
    mountApp()
    openSettings()
    expect(label()).toBe('Check for updates')
    await press()
    expect(label()).toBe('Up to date')
    expect(reload).not.toHaveBeenCalled()
    expect(unregister).not.toHaveBeenCalled()
    expect(cacheDelete).not.toHaveBeenCalled()
    expect(updatingOverlay()).toBe(null) // not even the screen — nothing happened, and it says so
  })

  it('asks the network with a cache-busting parameter, under the app base', async () => {
    // A plain URL would be answered by the service worker out of its precache — the build we are
    // trying to see past. Measured, not assumed: see tests/updateCheck.test.js.
    const fetchImpl = serveBuildId(OWN_ID)
    globalThis.fetch = fetchImpl
    mountApp()
    openSettings()
    await press()
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toMatch(new RegExp(`^/build-id\\.txt\\?${CHECK_PARAM}=.+$`))
  })

  it('reverts to the resting label after exactly 3s, and not before', async () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    mountApp()
    openSettings()
    await press()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(label()).toBe('Up to date')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(label()).toBe('Check for updates')
  })

  it('says "No connection" when the question cannot be answered — never a verdict', async () => {
    globalThis.fetch = serveBuildId(null)
    mountApp()
    openSettings()
    await press()
    expect(label()).toBe('No connection')
    expect(reload).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(label()).toBe('Check for updates')
  })

  it('is DISABLED while checking, and underlined only at rest', async () => {
    // The label is the state, so the control must be in the state its label reports. The underline
    // is the interaction signal: the three status labels are not offering an action, so they do not
    // wear it (the round-3 block-hover mistake).
    let release
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, text: async () => OWN_ID })
        }),
    )
    mountApp()
    openSettings()
    const resting = checkButton().querySelector('span:not([aria-hidden])')
    expect(resting.className).toContain('underline')
    await press()
    expect(label()).toBe('Checking…')
    expect(checkButton().disabled).toBe(true)
    expect(checkButton().querySelector('span:not([aria-hidden])').className).not.toContain(
      'underline',
    )
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(label()).toBe('Up to date')
    expect(checkButton().disabled).toBe(false)
    expect(checkButton().querySelector('span:not([aria-hidden])').className).not.toContain(
      'underline',
    )
  })

  it('carries a hidden strut at the resting label, so the Changelog link cannot shift', async () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    mountApp()
    openSettings()
    const strut = checkButton().querySelector('[aria-hidden="true"]')
    expect(strut.textContent).toBe(UPDATE_CHECK_LABEL.idle)
    await press()
    // Still there, still the RESTING label — the strut is the reserved width, not a mirror of the
    // current one — and still hidden from the accessible name, which is now the status.
    expect(checkButton().querySelector('[aria-hidden="true"]').textContent).toBe(
      UPDATE_CHECK_LABEL.idle,
    )
    expect(screen.getByRole('button', { name: 'Up to date' })).toBe(checkButton())
  })

  it('a press during a result starts another check', async () => {
    const fetchImpl = serveBuildId(OWN_ID)
    globalThis.fetch = fetchImpl
    mountApp()
    openSettings()
    await press()
    expect(label()).toBe('Up to date')
    await press()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(label()).toBe('Up to date')
  })

  it('closing Settings clears the result early and cancels the pending revert', async () => {
    globalThis.fetch = serveBuildId(OWN_ID)
    mountApp()
    openSettings()
    await press()
    expect(label()).toBe('Up to date')
    closeSettings()
    openSettings()
    expect(label()).toBe('Check for updates')
    // The timer the first check armed must be gone, not merely overtaken: if it were still live it
    // would fire into the reopened panel and blank a state the user did not create.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(label()).toBe('Check for updates')
  })

  it('closing Settings mid-check drops the in-flight answer instead of acting behind the panel', async () => {
    // A full-screen Updating overlay appearing after the menu was dismissed would be the app acting
    // on its own. The check is aborted; nothing lands.
    let release
    globalThis.fetch = vi.fn(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          release = () => resolve({ ok: true, text: async () => NEWER_ID })
        }),
    )
    mountApp()
    openSettings()
    await press()
    expect(label()).toBe('Checking…')
    closeSettings()
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(MIN_UPDATING_MS + 100)
    })
    expect(reload).not.toHaveBeenCalled()
    openSettings()
    expect(label()).toBe('Check for updates')
  })

  describe('when there IS an update', () => {
    it('hands off to a WAITING worker without asking the network at all', async () => {
      // A parked worker is a downloaded update by definition — and the case a fresh
      // registration.update() reports nothing for. It must not depend on a connection.
      const postMessage = vi.fn()
      const fetchImpl = serveBuildId(NEWER_ID)
      globalThis.fetch = fetchImpl
      installServiceWorker({ waiting: { postMessage }, installing: null, update: vi.fn() })
      mountApp()
      openSettings()
      await press()
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
      // The Updating screen IS up here — the counterpart of the "Up to date" case, where it never
      // appears at all. That pair is the whole behaviour change.
      expect(updatingOverlay()).not.toBe(null)
      // The reload waits for BOTH the handoff and the visible hold.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_UPDATING_MS + 50)
      })
      expect(reload).not.toHaveBeenCalled()
      await act(async () => {
        fireControllerChange()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(reload).toHaveBeenCalledTimes(1)
      // The offline copy SURVIVES — the old button destroyed it on every press.
      expect(unregister).not.toHaveBeenCalled()
      expect(cacheDelete).not.toHaveBeenCalled()
      // The boot this reload causes skips the splash's artificial hold: the user just watched ≥1s
      // of Updating.
      expect(sessionStorage.getItem('cg-skip-boot-hold')).toBe('1')
    })

    it('is HELD while a save the device refused is unsaved — the reload would lose it', async () => {
      // Every route out of the applier reloads the page, and a refused save lives only in this
      // page's memory (store/storageHealth). So the update waits, and the player is told why.
      const realSetItem = Storage.prototype.setItem
      let full = true
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (full && key === 'cg-settings-v1')
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return realSetItem.call(this, key, value)
      })
      const postMessage = vi.fn()
      installServiceWorker({ waiting: { postMessage }, installing: null, update: vi.fn() })
      mountApp()
      act(() => useSettings.getState().setMinY(1600)) // refused: the device is full
      expect(useStorageHealth.getState().unsaved).toBe(true)
      act(() => useStorageHealth.getState().dismissStorageNotice())
      openSettings()
      await press()
      expect(postMessage).not.toHaveBeenCalled()
      expect(updatingOverlay()).toBe(null)
      expect(label()).toBe('Check for updates') // back at rest: nothing was applied
      expect(useStorageHealth.getState().noticeOpen).toBe(true) // …and the reason is on screen
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPDATE_HANDOFF_MS + MIN_UPDATING_MS)
      })
      expect(reload).not.toHaveBeenCalled()
      // Room again, and the held save goes through: the same press now applies the update.
      full = false
      act(() => useSettings.getState().setMaxY(2100))
      expect(useStorageHealth.getState().unsaved).toBe(false)
      act(() => useStorageHealth.getState().dismissStorageNotice())
      await press()
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
      expect(updatingOverlay()).not.toBe(null)
      spy.mockRestore()
    })

    it('fetches + installs a new worker when none is waiting yet', async () => {
      const postMessage = vi.fn()
      const reg = { waiting: null, installing: null, update: vi.fn() }
      reg.update.mockImplementation(async () => {
        reg.waiting = { postMessage }
      })
      globalThis.fetch = serveBuildId(NEWER_ID)
      installServiceWorker(reg)
      mountApp()
      openSettings()
      await press()
      expect(reg.update).toHaveBeenCalled()
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    })

    it('falls back to the HAMMER when there is no registration to hand off to', async () => {
      // The reported-failure state: registration failed, so the app is running with no service worker. Having
      // promised an update, the button must produce one — and clearing the caches is the only way
      // left. These are tests/forceReload.dom.test.jsx's original assertions, on their new route.
      localStorage.setItem('cg-preserve-probe', 'kept') // a neutral key the app never touches
      globalThis.fetch = serveBuildId(NEWER_ID)
      mountApp()
      openSettings()
      await press()
      expect(reload).not.toHaveBeenCalled() // the Updating screen shows first
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_UPDATING_MS + 50)
      })
      expect(unregister).toHaveBeenCalledTimes(2) // both registrations
      expect(cacheDelete).toHaveBeenCalledWith('app-shell')
      expect(cacheDelete).toHaveBeenCalledWith('assets')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('cg-skip-boot-hold')).toBe('1')
      // Saved data is NEVER cleared — only the app/asset cache is.
      expect(localStorage.getItem('cg-preserve-probe')).toBe('kept')
    })

    it('falls back to the HAMMER when the handoff never arrives', async () => {
      // The round-7 residue: the check saw a difference the service worker cannot resolve. Rather
      // than sit on the Updating screen forever, it wipes the caches and reloads.
      const reg = { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) }
      globalThis.fetch = serveBuildId(NEWER_ID)
      installServiceWorker(reg)
      mountApp()
      openSettings()
      await press()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPDATE_HANDOFF_MS - 100)
      })
      expect(reload).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(unregister).toHaveBeenCalled()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('a successful handoff never lets the hammer fire afterwards', async () => {
      // The safety timeout must not wipe the caches of a page that already reloaded cleanly.
      const reg = { waiting: { postMessage: vi.fn() }, installing: null, update: vi.fn() }
      globalThis.fetch = serveBuildId(NEWER_ID)
      installServiceWorker(reg)
      mountApp()
      openSettings()
      await press()
      await act(async () => {
        fireControllerChange()
        await vi.advanceTimersByTimeAsync(MIN_UPDATING_MS + 50)
      })
      expect(reload).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPDATE_HANDOFF_MS)
      })
      expect(unregister).not.toHaveBeenCalled()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('an update() the applier ABANDONED is not reported — the app never files its own error', async () => {
      // A real Sentry event class, manufactured by this code. Past the handoff deadline the applier
      // gives up and forceReloadLatest takes over — and forceReloadLatest UNREGISTERS the worker,
      // which makes the reg.update() still in flight reject with InvalidStateError. That rejection
      // went straight to captureError({where:'update-apply'}), so every hammer fallback that
      // happened to still have an update() outstanding reported a failure the app had caused by
      // walking away. Abandoning an operation now settles the applier first: nothing it started can
      // report, hand off, or hold a listener afterwards.
      let rejectUpdate
      const reg = {
        waiting: null,
        installing: null,
        update: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectUpdate = reject
            }),
        ),
      }
      globalThis.fetch = serveBuildId(NEWER_ID)
      installServiceWorker(reg)
      mountApp()
      openSettings()
      await press()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPDATE_HANDOFF_MS + 50)
      })
      expect(reload).toHaveBeenCalledTimes(1) // the hammer took over
      expect(swListeners.controllerchange ?? []).toEqual([]) // …and took its listener down with it
      await act(async () => {
        rejectUpdate(new DOMException('The ServiceWorker was unregistered', 'InvalidStateError'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(sentry.captureError).not.toHaveBeenCalled()
    })

    it('an update() that fails while the applier is still LIVE is reported', async () => {
      // The other half, so the fix above can never become "silence everything". A genuine update()
      // failure inside the handoff window is still the actionable signal it always was.
      const boom = new Error('update failed')
      const reg = { waiting: null, installing: null, update: vi.fn().mockRejectedValue(boom) }
      globalThis.fetch = serveBuildId(NEWER_ID)
      installServiceWorker(reg)
      mountApp()
      openSettings()
      await press()
      expect(sentry.captureError).toHaveBeenCalledWith(boom, { where: 'update-apply' })
    })
  })
})
