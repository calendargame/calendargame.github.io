// @vitest-environment jsdom
//
// statusBarScrim.dom. When a popup opens, its scrim (`fixed inset-0 z-[60] bg-black/40`) covers the
// whole viewport EXCEPT the phone's status bar, which the phone paints itself — so the bar stayed
// bright above 40%-darker content, a visible seam.
//
// What the installed iOS app reads was established on the owner's phone (the ★★ note above App's
// theme effect in src/main.tsx has every result): the status bar takes the colour of the TOPMOST
// SOLID fixed layer touching the top edge of the screen, and nothing else — not the theme-color
// tag, not <html>'s or <body>'s background, not anything under a see-through scrim. So the top
// popup's scrim carries a solid strip along its top edge (components/Popup), in the colour the
// dimmed top bar already shows there. That colour is `--status-dim`, written by App's theme effect.
//
// jsdom has no status bar and no real stylesheet, so this proves what it can:
//   • the strip exists exactly while a popup is up, exactly once however many are stacked, in the
//     TOP popup, drawn before its card;
//   • `--status-dim` is the theme colour through one 40% dim (the channel-×-0.6 maths itself, as a
//     plain hex), and it follows a theme change made under an open popup;
//   • a tap on the strip is a tap on the dim;
//   • <html>'s background is the PAGE background and never dims; <body> carries no inline style;
//   • the theme-color tag (Android's signal) still dims and restores;
//   • index.css gives the strip the geometry that makes it the topmost solid layer at the top edge.
// --tc is seeded as an inline custom property (jsdom's getComputedStyle reflects those).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { useSettings } from '../src/store/settings.js'
import Popup from '../src/components/Popup.jsx'

const meta = () => document.querySelector("meta[name='theme-color']")
const htmlBg = () => document.documentElement.style.background
const statusDim = () => document.documentElement.style.getPropertyValue('--status-dim')
const strips = () => [...document.querySelectorAll('[data-status-bar-dim]')]

// Let the stack's notification, the resulting render and its effect all settle.
const flush = () =>
  act(async () => {
    await Promise.resolve()
  })

// A real popup, opened beside the app: its own React root, the app's one stack. Each needs its own
// id, as every popup in the app has.
let popupSerial = 0
const openScrim = async (onDismiss = () => {}) => {
  const id = `status-bar-test-${++popupSerial}`
  let popup
  await act(async () => {
    popup = render(
      <Popup id={id} onDismiss={onDismiss}>
        <div role="dialog" aria-modal="true" tabIndex={-1} data-card={id} />
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
  document.documentElement.style.removeProperty('--status-dim')
  document.documentElement.style.removeProperty('background')
})

describe('the status-bar strip: a solid layer at the top edge while a popup is open', () => {
  it('is there exactly while a popup is up, inside the scrim and drawn before the card', async () => {
    mountApp()
    expect(strips()).toHaveLength(0)

    const popup = await openScrim()
    const scrim = document.querySelector('#root > [data-settings-modal]')
    expect(strips()).toHaveLength(1)
    const [strip] = strips()
    expect(strip.parentElement).toBe(scrim)
    expect(strip.className).toBe('status-bar-dim')
    // Before the card in the scrim, and a plain element: nothing to focus, nothing to read out.
    expect(scrim.firstElementChild).toBe(strip)
    expect(strip.nextElementSibling.getAttribute('role')).toBe('dialog')
    expect(strip.hasAttribute('tabindex')).toBe(false)
    expect(strip.textContent).toBe('')

    await closeScrim(popup)
    expect(strips()).toHaveLength(0)
  })

  it('there is exactly ONE however many popups are stacked, always in the top one, until the LAST closes', async () => {
    // The storage-full notice can open over a ⚙ popup. Only the top popup paints the dim, and the
    // strip rides with the dim — so one of each at any depth, in both closing orders.
    mountApp()
    const first = await openScrim()
    const second = await openScrim()
    const scrims = () => [...document.querySelectorAll('#root > [data-settings-modal]')]
    expect(scrims()).toHaveLength(2)
    expect(strips()).toHaveLength(1)
    expect(strips()[0].parentElement).toBe(scrims()[1]) // the one in front

    await closeScrim(second)
    expect(strips()).toHaveLength(1)
    expect(strips()[0].parentElement).toBe(scrims()[0]) // the one that is on top now

    const third = await openScrim()
    await closeScrim(first) // the OLDER one closes first this time
    expect(strips()).toHaveLength(1)
    expect(strips()[0].parentElement).toBe(scrims()[0])
    await closeScrim(third)
    expect(strips()).toHaveLength(0)
  })

  it('a tap on the strip is a tap on the dim — it closes the popup; a press that ends on the card does not', async () => {
    mountApp()
    const onDismiss = vi.fn()
    await openScrim(onDismiss)
    const [strip] = strips()
    const card = document.querySelector('[data-settings-modal] [role="dialog"]')
    const scrim = document.querySelector('#root > [data-settings-modal]')

    // Down on the strip, up over the card: the click lands on the scrim (the nearest element holding
    // both ends), and it is not a tap on the dim.
    fireEvent.pointerDown(strip)
    fireEvent.pointerUp(card)
    fireEvent.click(scrim)
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.pointerDown(strip)
    fireEvent.pointerUp(strip)
    fireEvent.click(strip)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('the colours: --status-dim, the theme-color tag, and a page background that never dims', () => {
  it('--status-dim is the theme colour through one dim, as a plain hex, popup or not', async () => {
    mountApp()
    // 0d→08 (13×0.6=7.8→8), 11→0a (17×0.6=10.2→10), 17→0e (23×0.6=13.8→14). Written at rest too,
    // so it is already right on the frame a popup opens.
    expect(statusDim()).toBe('#080a0e')
    const popup = await openScrim()
    expect(statusDim()).toBe('#080a0e')
    await closeScrim(popup)
    expect(statusDim()).toBe('#080a0e')
  })

  it('<html> keeps the plain theme colour with a popup up — it is the page background, not a signal', async () => {
    // v2.27.0 dimmed it, and on the owner's phone that did nothing: the installed app never reads
    // <html>'s background while a popup is up. With #root transparent again the canvas IS the page,
    // so dimming it would darken the whole screen twice.
    mountApp()
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
    const popup = await openScrim()
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
    await closeScrim(popup)
    expect(htmlBg()).toBe('rgb(13, 17, 23)')
  })

  it('never writes an inline style on <body>', async () => {
    // Round 22 dimmed body's inline background-color; it was inert on the device and was deleted.
    mountApp()
    const popup = await openScrim()
    expect(document.body.getAttribute('style') ?? '').toBe('')
    await closeScrim(popup)
    expect(document.body.getAttribute('style') ?? '').toBe('')
  })

  it('the theme-color tag dims while any popup is up and restores when the last one closes', async () => {
    mountApp()
    expect(meta().content).toBe('#0d1117')
    const first = await openScrim()
    const second = await openScrim()
    expect(meta().content).toBe('#080a0e')
    await closeScrim(second)
    expect(meta().content).toBe('#080a0e') // one is still up
    await closeScrim(first)
    expect(meta().content).toBe('#0d1117')
  })

  it('follows a theme change made while a popup is up — the dim is always of the CURRENT theme', async () => {
    mountApp()
    const popup = await openScrim()
    // The theme CAN change under an open popup — with Use System Settings on, the OS going dark at
    // sunset does it. The effect keys on activeTheme, so it re-reads --tc; here the change is driven
    // through the store directly (the same activeTheme path), with the new theme's --tc seeded by
    // hand because jsdom has no stylesheet to supply it. Parchment is neither factory theme, so the
    // switch is a real change whatever the OS reports.
    expect(document.documentElement.getAttribute('data-theme')).not.toBe('parchment')
    document.documentElement.style.setProperty('--tc', '#f0e8d5') // parchment
    await act(async () => {
      useSettings.getState().setUseSystem(false)
      useSettings.getState().setManualTheme('parchment')
    })
    await flush()
    expect(document.documentElement.getAttribute('data-theme')).toBe('parchment')
    // f0→90 (240×0.6=144), e8→8b (232×0.6=139.2), d5→80 (213×0.6=127.8)
    expect(statusDim()).toBe('#908b80')
    expect(meta().content).toBe('#908b80')
    expect(htmlBg()).toBe('rgb(240, 232, 213)') // the page follows the theme, undimmed
    expect(strips()).toHaveLength(1) // the same strip, now wearing the new colour through the property

    await closeScrim(popup)
    expect(meta().content).toBe('#f0e8d5')
    expect(statusDim()).toBe('#908b80')
  })

  it('a background round-trip / BFCache restore while a popup is up moves nothing', async () => {
    // Nothing here is persisted and nothing listens for pagehide/visibilitychange by design: a
    // BFCache restore freezes and thaws the strip, the property, the tag, the popup and the stack
    // that holds it together, so there is nothing to recompute on resume.
    mountApp()
    const popup = await openScrim()
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
    expect(strips()).toHaveLength(1)
    expect(statusDim()).toBe('#080a0e')
    expect(meta().content).toBe('#080a0e')

    await closeScrim(popup)
    expect(strips()).toHaveLength(0)
    expect(meta().content).toBe('#0d1117')
    delete document.visibilityState
  })
})

describe('the geometry that makes the strip what the phone reads (index.css)', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  // The declaration block of a top-level rule whose selector is exactly `selector`.
  const rule = (selector) => {
    const at = css.split('}').find((chunk) => chunk.trim().startsWith(`${selector}{`))
    return at === undefined ? null : at.slice(at.indexOf('{') + 1)
  }

  it('the strip is fixed along the whole top edge, solid, above the dim and below the card', () => {
    const strip = rule('.status-bar-dim')
    expect(strip).toMatch(/position:fixed/)
    expect(strip).toMatch(/top:0;left:0;right:0/)
    // Its colour is the literal hex App writes — no alpha, no colour function for the phone to resolve.
    expect(strip).toMatch(/background:var\(--status-dim\)/)
    // -1 inside the scrim's own stacking context: over the scrim's see-through fill, under the card.
    expect(strip).toMatch(/z-index:-1/)
    // rem, not px: it must stay inside the top bar's own 1.25rem top padding on every screen.
    const height = /height:([\d.]+)rem/.exec(strip)
    expect(height).not.toBeNull()
    expect(Number(height[1])).toBeGreaterThan(0)
    expect(Number(height[1])).toBeLessThanOrEqual(1.25)
  })

  it('#root and body paint no background — the canvas <html> stamps is the page', () => {
    const root = rule('#root')
    expect(root).toMatch(/position:fixed/)
    expect(root).toMatch(/top:0;left:0;right:0/)
    expect(root).toMatch(/height:100dvh/)
    expect(root).not.toMatch(/background/)
    expect(rule('body')).not.toBeNull()
    expect(rule('body')).not.toMatch(/background/)
  })

  it('every theme sets --bg1 equal to --tc, so the top bar under the dim shows exactly --status-dim', () => {
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
