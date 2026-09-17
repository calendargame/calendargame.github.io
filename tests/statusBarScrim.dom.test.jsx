// @vitest-environment jsdom
//
// statusBarScrim.dom — round 21 Q8, reworked round 22 Q7. When a modal opens, its scrim
// (`fixed inset-0 z-[60] bg-black/40`) covers the whole viewport EXCEPT the status bar, which the
// browser paints itself — so the bar stays bright above 40%-darker content, a visible seam.
// src/main.tsx's theme effect answers with the SCRIMMED colour (each --tc channel × 0.6) on TWO
// signals while any modal is up: <meta name="theme-color"> (Android Chrome, pre-26 Safari) and
// <body>'s inline background-color (the lever WebKit bug 309956 shows re-tints an iOS 26 home-screen
// app's status bar). Both are keyed on a MutationObserver watching #root for the
// [data-settings-modal] marker every modal scrim carries. The ★★ note there is the sourced account
// of which platform reads which, and says plainly what is still unverified on a device.
//
// jsdom has no status bar and no real stylesheet, so this proves what it can: both signals flip to
// the darker value when a [data-settings-modal] node appears under #root (where every real modal
// portals), and both restore when it leaves — the meta to plain --tc, and body's inline colour to
// NOTHING, so the stylesheet's own `body{background:var(--bg1)}` is back in charge. --tc is seeded
// as an inline custom property (jsdom's getComputedStyle reflects those), and the exact hex asserted
// is the channel-×-0.6 maths itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { useSettings } from '../src/store/settings.js'

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
  document.body.removeAttribute('style') //  a case that ends with a modal up must not leak its dim
})

describe('status bar dims to match the scrim while a modal is open', () => {
  // ★ Round 22 Q7. The body half, and "restores exactly" is the load-bearing part: the inline value
  // is REMOVED on close rather than written back as --tc, so a theme switched while (or after) the
  // modal was up is still followed by the stylesheet. Asserted through the `style` attribute as well
  // as the property, so a written-back colour cannot pass by happening to equal today's theme.
  it('drives <body> background to the scrimmed colour while a modal is up, and removes it — not restores a colour — when it goes', async () => {
    mountApp()
    expect(document.body.style.backgroundColor).toBe('') //  at rest: the stylesheet owns body

    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    expect(document.body.style.backgroundColor).toBe('rgb(8, 10, 14)') //  #080a0e, as the meta
    expect(meta().content).toBe('#080a0e') //                               the two signals agree

    await act(async () => {
      scrim.remove()
    })
    await flush()
    expect(document.body.style.backgroundColor).toBe('')
    expect(document.body.getAttribute('style') ?? '').not.toMatch(/background/)
    expect(meta().content).toBe('#0d1117')
  })

  it('a second modal opening while one is up keeps the dim until the LAST one closes', async () => {
    // A ConfirmModal can open over a ⚙ popup, so "a modal closed" is not "no modal is up". The
    // observer re-queries the whole tree on every change, and this pins that.
    mountApp()
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.setAttribute('data-settings-modal', '')
    second.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(first)
      document.getElementById('root').appendChild(second)
    })
    await flush()
    await act(async () => {
      second.remove()
    })
    await flush()
    expect(document.body.style.backgroundColor).toBe('rgb(8, 10, 14)') //  one is still up
    expect(meta().content).toBe('#080a0e')
    await act(async () => {
      first.remove()
    })
    await flush()
    expect(document.body.style.backgroundColor).toBe('')
    expect(meta().content).toBe('#0d1117')
  })

  it('follows a theme change made while a modal is up — the dim is always of the CURRENT theme', async () => {
    mountApp()
    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    // The theme CAN change under an open popup — with Use System Settings on, the OS going dark at
    // sunset does it. The effect keys on activeTheme, so it re-reads --tc; here the change is driven
    // through the store directly (the same activeTheme path), with the new theme's --tc seeded by
    // hand because jsdom has no stylesheet to supply it. Parchment is neither factory theme, so the
    // switch is a real change whatever the OS reports.
    expect(document.documentElement.getAttribute('data-theme')).not.toBe('parchment')
    document.documentElement.style.setProperty('--tc', '#f0e8d5') //  parchment
    await act(async () => {
      useSettings.getState().setUseSystem(false)
      useSettings.getState().setManualTheme('parchment')
    })
    await flush()
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
    // f0→90 (240×0.6=144), e8→8b (232×0.6=139.2), d5→80 (213×0.6=127.8)
    expect(meta().content).toBe('#908b80')
    expect(document.body.style.backgroundColor).toBe('rgb(144, 139, 128)')
  })

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
    // The dimmed value lives ONLY in <meta>.content and <body>'s inline style — it is never
    // persisted, and the boot script stamps <html>'s background from the STORED theme, not either. A BFCache restore freezes and
    // thaws the DOM meta, body's style, the scrim node and React's `anyModalOpen` together, so there is nothing to
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
    expect(document.body.style.backgroundColor).toBe('rgb(8, 10, 14)') //  body held its dim too

    await act(async () => {
      scrim.remove()
    })
    await flush()
    expect(meta().content).toBe('#0d1117') // …and the observer still restores it when the modal goes
    expect(document.body.style.backgroundColor).toBe('')
    delete document.visibilityState
  })

  it('leaves <html> background on the plain colour throughout — only body and the meta follow the modal', async () => {
    mountApp()
    expect(document.documentElement.style.background).toBe('rgb(13, 17, 23)') // #0d1117

    const scrim = document.createElement('div')
    scrim.setAttribute('data-settings-modal', '')
    await act(async () => {
      document.getElementById('root').appendChild(scrim)
    })
    await flush()
    expect(meta().content).toBe('#080a0e') //                                    meta dimmed…
    expect(document.body.style.backgroundColor).toBe('rgb(8, 10, 14)') //          …body dimmed…
    expect(document.documentElement.style.background).toBe('rgb(13, 17, 23)') // …canvas not
  })
})
