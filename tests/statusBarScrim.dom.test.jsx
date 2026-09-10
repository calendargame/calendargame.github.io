// @vitest-environment jsdom
//
// statusBarScrim.dom — Q8 (round 21). iOS tints the status bar from <meta name="theme-color">. When
// a modal opens, its scrim (`fixed inset-0 z-[60] bg-black/40`) covers the whole viewport EXCEPT
// that strip, so the bar stays bright above 40%-darker content — a visible seam. src/main.tsx's
// theme effect now hands iOS the SCRIMMED colour (each --tc channel × 0.6) while any modal is up,
// keyed on a MutationObserver watching <body> for the [data-settings-modal] marker every modal
// scrim carries (SettingsPanel's popups AND RunBreakdown, which portal from different subtrees).
//
// jsdom has no status bar and no real stylesheet, so this proves the one thing it can: the meta's
// content flips to the darker value when a [data-settings-modal] node appears under #root (where
// every real modal portals) and restores when it leaves. --tc is seeded as an inline custom
// property (jsdom's getComputedStyle reflects those), and the exact hex asserted is the
// channel-×-0.6 maths itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'

const meta = () => document.querySelector("meta[name='theme-color']")

// Let the MutationObserver microtask, the resulting setState and its effect all settle.
const flush = () =>
  act(async () => {
    await Promise.resolve()
  })

beforeEach(() => {
  resetAppState()
  const m = document.createElement('meta')
  m.setAttribute('name', 'theme-color')
  document.head.appendChild(m)
  document.documentElement.style.setProperty('--tc', '#0d1117') // dusk
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  meta()?.remove()
  document.documentElement.style.removeProperty('--tc')
})

describe('status bar dims to match the scrim while a modal is open', () => {
  it('flips theme-color to the scrimmed colour when a [data-settings-modal] node appears, and restores when it goes', async () => {
    mountApp()
    expect(meta().content).toBe('#0d1117') // undimmed at rest

    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    // 0d→08 (13×0.6=7.8→8), 11→0a (17×0.6=10.2→10), 17→0e (23×0.6=13.8→14)
    expect(meta().content).toBe('#080a0e')

    await act(async () => {
      scrim.remove()
    })
    await flush()
    expect(meta().content).toBe('#0d1117') // restored to plain --tc
  })

  it('a background round-trip / BFCache restore while a modal is up moves nothing, and the mechanism still works after', async () => {
    // The dimmed value lives ONLY in <meta>.content — it is never persisted, and the boot script
    // stamps <html>'s background from the STORED theme, not the meta. A BFCache restore freezes and
    // thaws the DOM meta, the scrim node and React's `anyModalOpen` together, so there is nothing to
    // recompute on resume and the Q8 effect has no pagehide/visibilitychange listener by design.
    // This pins that: the value does not drift across a resume, and the observer/effect are still
    // live afterward.
    mountApp()
    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    expect(meta().content).toBe('#080a0e') // dimmed while the modal is up

    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('pagehide'))
      })
    }
    const restore = new Event('pageshow')
    Object.defineProperty(restore, 'persisted', { value: true })
    await act(async () => {
      window.dispatchEvent(restore)
    })
    await flush()
    expect(meta().content).toBe('#080a0e') // untouched by the resume — the modal is still up
    expect(document.documentElement.style.background).toBe('rgb(13, 17, 23)') // canvas never dimmed

    await act(async () => {
      scrim.remove()
    })
    await flush()
    expect(meta().content).toBe('#0d1117') // …and the observer still restores it when the modal goes
    delete document.visibilityState
  })

  it('leaves <html> background on the plain colour throughout — only the meta follows the modal', async () => {
    mountApp()
    expect(document.documentElement.style.background).toBe('rgb(13, 17, 23)') // #0d1117

    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    expect(meta().content).toBe('#080a0e') // meta dimmed…
    expect(document.documentElement.style.background).toBe('rgb(13, 17, 23)') // …canvas not
  })
})
