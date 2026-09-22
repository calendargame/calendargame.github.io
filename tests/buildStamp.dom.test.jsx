// @vitest-environment jsdom
//
// The last-run build stamp + the cold-open build-change "Updating" flash (round-6 Q2). The stamp
// (cg-last-build, plain localStorage — lib/buildStamp) records which build's DEPLOY_TS this device
// last booted; every boot restamps. A mismatch means an update landed SILENTLY (the waiting
// worker's activation completed between sessions, or an evicted Safari tab downloaded fresh), so
// App holds the SAME Updating screen for MIN_UPDATING_MS — no reload — before revealing the app.
// Two boots restamp with NO screen: the first-ever visit (no stamp — nothing to announce) and the
// boot right after the REAL Updating flow (the consumed cg-skip-boot-hold flag — that flow already
// showed the screen, and a second one back-to-back is exactly what the owner ruled out). The
// overlay follows the auto flow's css-ready discipline (it must never paint unstyled), and #boot
// hands off to it, never to the app. (Actual paint/SW behavior is on-device territory per the
// standing lesson; these tests pin the logic.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import {
  BUILD_STAMP_KEY,
  readBuildStamp,
  writeBuildStamp,
  buildChanged,
} from '../src/lib/buildStamp.js'

const OLD_STAMP = '2020-01-01T00:00:00.000Z' // any build that is not the running one

describe('buildChanged (pure)', () => {
  it('missing stamp → false (first-ever visit or blocked storage — nothing to announce)', () => {
    expect(buildChanged(null, '2026-07-18T01:35:00.000Z')).toBe(false)
  })

  it('same build → false', () => {
    expect(buildChanged('2026-07-18T01:35:00.000Z', '2026-07-18T01:35:00.000Z')).toBe(false)
  })

  it('different build → true', () => {
    expect(buildChanged(OLD_STAMP, '2026-07-18T01:35:00.000Z')).toBe(true)
  })
})

describe('readBuildStamp / writeBuildStamp (plain localStorage)', () => {
  // ⚠ CLEARED BEFORE AS WELL AS AFTER (round 22's fixer, found by a shuffled run). The first case
  // below asserts "nothing is stored yet" — a precondition this block never actually established,
  // so it passed only while no earlier file left the key behind. Plenty do: the key is App's own
  // build stamp, written on mount by every file that mounts the app, and a file that clears
  // localStorage in ITS beforeEach clears it for itself, not for whoever runs next in the worker.
  beforeEach(() => {
    localStorage.removeItem(BUILD_STAMP_KEY)
  })
  afterEach(() => {
    localStorage.removeItem(BUILD_STAMP_KEY)
  })

  it('round-trips through the cg-last-build key', () => {
    expect(readBuildStamp()).toBeNull()
    writeBuildStamp(OLD_STAMP)
    expect(localStorage.getItem('cg-last-build')).toBe(OLD_STAMP)
    expect(readBuildStamp()).toBe(OLD_STAMP)
  })

  it('blocked storage (privacy modes): reads act like a first visit, writes are silent no-ops', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readBuildStamp()).toBeNull()
    expect(() => writeBuildStamp(OLD_STAMP)).not.toThrow()
    getSpy.mockRestore()
    setSpy.mockRestore()
  })
})

describe('App boot — the cold-open build-change flash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
    useSettings.getState().resetToFactory()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
    document.getElementById('boot')?.remove()
    document.head.querySelector('link[rel="preload"]')?.remove()
    delete window.__cssReady
    delete window.__bootShownAt
    sessionStorage.clear()
  })

  // CustomSelect portals into #root, so the harness must provide one (see app-mount.dom).
  function mountApp() {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    return render(<App />)
  }
  // The real markup: #boot is a BODY-LEVEL sibling of #root, not inside it.
  function mountBootFixture() {
    const boot = document.createElement('div')
    boot.id = 'boot'
    document.body.appendChild(boot)
  }
  // The running build's stamp, captured exactly the way App writes it — a probe mount + read.
  // (DEPLOY_TS is deliberately not reached for here, even though src/deployStamp.ts exports it —
  //  the written stamp IS the observable contract, and reading the constant would assert nothing.)
  function captureCurrentStamp() {
    mountApp()
    const stamp = localStorage.getItem(BUILD_STAMP_KEY)
    cleanup()
    document.getElementById('root')?.remove()
    localStorage.clear()
    return stamp
  }
  const updatingScreen = () => document.querySelector('.boot-updating')

  it('first-ever visit: stamps the running build silently — no Updating screen at any point', () => {
    mountBootFixture()
    mountApp()
    expect(updatingScreen()).toBeNull()
    const stamp = localStorage.getItem(BUILD_STAMP_KEY)
    expect(stamp).not.toBeNull() // restamped at boot (here: the first stamp)
    act(() => {
      vi.advanceTimersByTime(1500) // past the 500ms splash hold AND the would-be 1s flash hold
    })
    expect(updatingScreen()).toBeNull()
    expect(document.getElementById('boot')).toBeNull() // the normal boot path dismissed the splash
    expect(localStorage.getItem(BUILD_STAMP_KEY)).toBe(stamp)
  })

  it('same-build boot: no screen, stamp unchanged', () => {
    const current = captureCurrentStamp()
    writeBuildStamp(current)
    mountApp()
    expect(updatingScreen()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(updatingScreen()).toBeNull()
    expect(localStorage.getItem(BUILD_STAMP_KEY)).toBe(current)
  })

  it('build change: the Updating screen engages, takes #boot, restamps, and reveals the app after the 1s hold', () => {
    const current = captureCurrentStamp()
    writeBuildStamp(OLD_STAMP)
    mountBootFixture()
    mountApp()
    // No preload link in the harness → css is ready → the flash engages on mount; the overlay
    // commit takes #boot down (the handoff — never a frame with neither splash nor overlay).
    expect(updatingScreen()).not.toBeNull()
    expect(document.getElementById('boot')).toBeNull()
    // Restamped immediately (on EVERY boot), not at hold-end.
    expect(localStorage.getItem(BUILD_STAMP_KEY)).toBe(current)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(updatingScreen()).not.toBeNull() // the full MIN_UPDATING_MS hold — the screen must register
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(updatingScreen()).toBeNull() // hold-end reveals the app — no reload on this path
  })

  it('post-update suppression: the boot after the real Updating flow (cg-skip-boot-hold) restamps silently', () => {
    const current = captureCurrentStamp()
    writeBuildStamp(OLD_STAMP) // the reload after a real update always lands on a changed stamp…
    sessionStorage.setItem('cg-skip-boot-hold', '1') // …but that flow already showed the screen
    mountBootFixture()
    mountApp()
    expect(updatingScreen()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(updatingScreen()).toBeNull() // never two screens back-to-back
    expect(localStorage.getItem(BUILD_STAMP_KEY)).toBe(current)
    expect(sessionStorage.getItem('cg-skip-boot-hold')).toBeNull() // one-time: consumed by this boot
  })

  it('css discipline: with the stylesheet preload pending, the flash waits for app-css-ready and #boot stays up', () => {
    captureCurrentStamp()
    writeBuildStamp(OLD_STAMP)
    mountBootFixture()
    const link = document.createElement('link')
    link.rel = 'preload'
    link.setAttribute('as', 'style')
    document.head.appendChild(link)
    mountApp()
    expect(updatingScreen()).toBeNull() // an unstyled Updating frame must never paint
    act(() => {
      vi.advanceTimersByTime(500) // the splash hold elapses…
    })
    expect(document.getElementById('boot')).not.toBeNull() // …but #boot holds: css pending + the flash claimed the handoff
    expect(updatingScreen()).toBeNull()
    act(() => {
      window.__cssReady = true
      window.dispatchEvent(new Event('app-css-ready'))
    })
    expect(updatingScreen()).not.toBeNull() // the flash engages the moment the real stylesheet applies
    expect(document.getElementById('boot')).toBeNull() // …and the overlay commit takes #boot down
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(updatingScreen()).toBeNull()
  })
})
