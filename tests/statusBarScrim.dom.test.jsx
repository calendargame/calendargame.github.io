// @vitest-environment jsdom
//
// statusBarScrim.dom. When a popup opens, its scrim (`fixed inset-0 z-[60] bg-black/40`) covers the
// whole viewport EXCEPT the status bar, which the browser paints itself — so the bar stays bright
// above 40%-darker content, a visible seam.
// src/main.tsx's theme effect answers with the SCRIMMED colour (each --tc channel × 0.6) on TWO
// signals while any popup is up: <meta name="theme-color"> (Android Chrome, pre-26 Safari) and
// <html>'s inline background (a theme change re-tints the installed iOS app's status bar live, and
// re-stamping <html>'s background is the one thing a theme change did that the popup path did
// not). Both are keyed on the app's stack of open things (components/overlayStack) — "is any popup
// open?". The ★★ note there is the account of all three attempts, and says plainly what is still
// unverified on a device.
//
// jsdom has no status bar and no real stylesheet, so this proves what it can: both signals flip to
// the darker value when a popup opens (a real components/Popup, the shell every popup in the app is
// drawn in), and both restore to plain --tc when the last one closes. --tc is seeded as an inline
// custom property (jsdom's getComputedStyle reflects those), and the exact hex asserted is the
// channel-×-0.6 maths itself. The last block reads index.css to pin WHY dimming <html> is
// invisible: #root paints the page background, so the canvas <html> colours sits behind it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { useSettings } from '../src/store/settings.js'
import Popup from '../src/components/Popup.jsx'

const meta = () => document.querySelector("meta[name='theme-color']")
const htmlBg = () => document.documentElement.style.background

// Let the stack's notification, the resulting render and its effect all settle.
const flush = () =>
  act(async () => {
    await Promise.resolve()
  })

// A real popup, opened beside the app: its own React root, the app's one stack. Each needs its own
// id, as every popup in the app has.
let popupSerial = 0
const openScrim = async () => {
  const id = `status-bar-test-${++popupSerial}`
  let popup
  await act(async () => {
    popup = render(
      <Popup id={id} onDismiss={() => {}}>
        <div role="dialog" aria-modal="true" tabIndex={-1} />
      </Popup>,
    )
  })
  await flush()
  return popup
}
const closeScrim = async (popup) => {
  await act(async () => {
    popup.unmount()
  })
  await flush()
}

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
  document.documentElement.style.removeProperty('background') // a case that ends dimmed must not leak it
})

describe('status bar dims to match the scrim while a modal is open', () => {
  it('drives <html> background AND theme-color to the scrimmed colour while a modal is up, and back to plain --tc when it goes', async () => {
    mountApp()
    expect(htmlBg()).toBe('rgb(13, 17, 23)') // #0d1117 — undimmed at rest
    expect(meta().content).toBe('#0d1117')

    const scrim = await openScrim()
    expect(document.querySelectorAll('#root > [data-settings-modal]')).toHaveLength(1)
    // 0d→08 (13×0.6=7.8→8), 11→0a (17×0.6=10.2→10), 17→0e (23×0.6=13.8→14)
    expect(htmlBg()).toBe('rgb(8, 10, 14)')
    expect(meta().content).toBe('#080a0e') // the two signals agree

    await closeScrim(scrim)
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
    expect(meta().content).toBe('#0d1117')
  })

  it('never writes an inline style on <body> — the round-22 body mechanism is gone', async () => {
    // Round 22 dimmed body's inline background-color; it proved inert on the owner's installed app
    // and was deleted (round 23 Q1). Nothing should put it back by accident.
    mountApp()
    const scrim = await openScrim()
    expect(document.body.getAttribute('style') ?? '').toBe('')
    await closeScrim(scrim)
    expect(document.body.getAttribute('style') ?? '').toBe('')
  })

  it('a second modal opening while one is up keeps the dim until the LAST one closes', async () => {
    // The storage-full notice can open over a ⚙ popup, so "a popup closed" is not "no popup is up".
    // The stack is asked whether ANY is open, and this pins that — in both orders.
    mountApp()
    const first = await openScrim()
    const second = await openScrim()
    await closeScrim(second)
    expect(htmlBg()).toBe('rgb(8, 10, 14)') // one is still up
    expect(meta().content).toBe('#080a0e')
    const third = await openScrim()
    await closeScrim(first) // the OLDER one closes first this time
    expect(htmlBg()).toBe('rgb(8, 10, 14)')
    await closeScrim(third)
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
    expect(meta().content).toBe('#0d1117')
  })

  it('follows a theme change made while a modal is up — the dim is always of the CURRENT theme, and closing restores the NEW theme', async () => {
    mountApp()
    const scrim = await openScrim()
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
    expect(htmlBg()).toBe('rgb(144, 139, 128)') // not clobbered to plain, not left on dusk's dim

    await closeScrim(scrim)
    expect(meta().content).toBe('#f0e8d5')
    expect(htmlBg()).toBe('rgb(240, 232, 213)') // restored to the theme in effect NOW, not dusk
  })

  it('a background round-trip / BFCache restore while a modal is up moves nothing, and the mechanism still works after', async () => {
    // The dimmed value lives ONLY in <meta>.content and <html>'s inline style — it is never
    // persisted, and the boot script stamps <html>'s background from the STORED theme on a cold
    // load, when no modal can be up. A BFCache restore freezes and thaws the meta, html's style,
    // the popup and the stack that holds it together, so there is nothing to recompute on resume
    // and the effect has no pagehide/visibilitychange listener by design. This pins that: the value
    // does not drift across a resume, and the mechanism is still live afterward.
    mountApp()
    const scrim = await openScrim()
    expect(meta().content).toBe('#080a0e')

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
    expect(htmlBg()).toBe('rgb(8, 10, 14)')

    await closeScrim(scrim)
    expect(meta().content).toBe('#0d1117') // …and it is still restored when the popup goes
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
    delete document.visibilityState
  })
})

describe('dimming <html> is invisible because #root paints the page background (index.css)', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  // The declaration block of a top-level rule whose selector is exactly `selector`.
  const rule = (selector) => {
    const at = css.split('}').find((chunk) => chunk.trim().startsWith(`${selector}{`))
    return at === undefined ? null : at.slice(at.indexOf('{') + 1)
  }

  it('#root is fixed, full-viewport and opaque with --bg1; body paints no background of its own', () => {
    const root = rule('#root')
    expect(root).toMatch(/position:fixed/)
    expect(root).toMatch(/top:0;left:0;right:0/)
    expect(root).toMatch(/height:100dvh/)
    expect(root).toMatch(/background:var\(--bg1\)/)
    expect(rule('body')).not.toBeNull()
    expect(rule('body')).not.toMatch(/background/)
  })

  it('every theme sets --bg1 equal to --tc, so #root shows exactly the colour the canvas used to', () => {
    const themes = [...css.matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)]
    expect(themes.map((t) => t[1]).sort()).toEqual([
      'dusk',
      'light',
      'midnight',
      'nebula',
      'parchment',
    ])
    for (const [, name, decls] of themes) {
      const bg1 = /--bg1:([^;]+)/.exec(decls)?.[1]
      const tc = /--tc:([^;]+)/.exec(decls)?.[1]
      expect(bg1, name).toBeDefined()
      expect(bg1, name).toBe(tc)
    }
  })
})
