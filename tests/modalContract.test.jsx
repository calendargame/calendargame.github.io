// @vitest-environment jsdom
//
// components/modalContract — the two pieces this module owns, unit-tested against fabricated DOM so
// the degenerate cases are provable without standing up a whole modal:
//   • useModalEscape — capture-phase, stopPropagation, the text-entry guard;  (covered broadly by
//     the settings-panel suites — not re-proved here)
//   • trapModalTab — the focus trap, and specifically its ZERO-control and ONE-control degenerate
//     branches (round 21: the run breakdown and the Changelog popup dropped their Close buttons, so
//     a card whose only content is text now reaches the trap with nothing to cycle).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { trapModalTab } from '../src/components/modalContract.js'

// A scrim element holding a role="dialog" card, matching the real markup trapModalTab runs against:
// the handler is on the SCRIM (its onKeyDown), and `e.currentTarget` is therefore the scrim.
function mountScrim(cardInnerHTML) {
  const scrim = document.createElement('div')
  scrim.setAttribute('role', 'presentation')
  const card = document.createElement('div')
  card.setAttribute('role', 'dialog')
  card.tabIndex = -1
  card.innerHTML = cardInnerHTML
  scrim.appendChild(card)
  document.body.appendChild(scrim)
  return { scrim, card }
}

// A synthetic React-style KeyboardEvent for the handler: only the fields trapModalTab reads.
function tabEvent(scrim, { shiftKey = false, key = 'Tab' } = {}) {
  return {
    key,
    shiftKey,
    currentTarget: scrim,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('trapModalTab', () => {
  it('ignores every key that is not Tab', () => {
    const { scrim } = mountScrim('<button>Only</button>')
    const e = tabEvent(scrim, { key: 'Enter' })
    trapModalTab(e)
    expect(e.stopPropagation).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('ZERO controls: consumes the Tab and pins focus on the dialog card (round 21)', () => {
    const { scrim, card } = mountScrim('<p>just some prose, nothing to focus</p>')
    // Start with focus somewhere else entirely — a real page element under the scrim.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const e = tabEvent(scrim)
    expect(() => trapModalTab(e)).not.toThrow()
    expect(e.stopPropagation).toHaveBeenCalled() // still shields the app-wide Tab shortcut
    expect(e.preventDefault).toHaveBeenCalled() // the press is consumed, not allowed to walk out
    expect(document.activeElement).toBe(card) // focus pinned on the dialog, not left outside
  })

  it('ZERO controls: Shift+Tab behaves the same — focus stays on the card', () => {
    const { scrim, card } = mountScrim('<p>prose</p>')
    const e = tabEvent(scrim, { shiftKey: true })
    trapModalTab(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(card)
  })

  it('ONE control: first === last, so Tab off it wraps in place', () => {
    const { scrim } = mountScrim('<button>Only</button>')
    const only = scrim.querySelector('button')
    only.focus()
    const e = tabEvent(scrim)
    trapModalTab(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(only)
  })

  it('two controls: Tab off the last wraps to the first, Shift+Tab off the first wraps to the last', () => {
    const { scrim } = mountScrim('<button>A</button><button>B</button>')
    const [a, b] = scrim.querySelectorAll('button')

    b.focus()
    const fwd = tabEvent(scrim)
    trapModalTab(fwd)
    expect(fwd.preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(a)

    a.focus()
    const back = tabEvent(scrim, { shiftKey: true })
    trapModalTab(back)
    expect(back.preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(b)
  })

  it('two controls: a Tab from the MIDDLE of the cycle is left to native traversal (only the ends wrap)', () => {
    const { scrim } = mountScrim('<button>A</button><button>B</button><button>C</button>')
    const b = scrim.querySelectorAll('button')[1]
    b.focus()
    const e = tabEvent(scrim)
    trapModalTab(e)
    expect(e.stopPropagation).toHaveBeenCalled() // the shortcut shield always fires
    expect(e.preventDefault).not.toHaveBeenCalled() // …but the middle is not an end, so no wrap
    expect(document.activeElement).toBe(b)
  })
})
