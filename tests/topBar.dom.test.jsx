// @vitest-environment jsdom
//
// topBar.dom — THE FIXED TOP BAR after the rebuild that removed the "Calendar Game" wordmark and
// put the preset switcher in its place (logo far left, preset, mode, ⚙ far right).
//
// ★ WHAT THIS FILE IS FOR. Three things, and they are three because each one is a different KIND
// of claim:
//   1. THE NAME. The wordmark is gone from the screen, and the accessible name it was carrying is
//      not — an sr-only <h1> inside a <header>/banner landmark. This is the half of the change that
//      could go wrong invisibly: delete the heading and the app is unlabelled to assistive
//      technology; keep it visible and the owner's real-estate complaint is unaddressed. So both
//      halves are asserted together, and the file will not let one pass without the other.
//   2. THE ORDER. Logo, preset, mode, gear — the owner's layout, in the DOM order a screen reader
//      and a tab sequence follow, which here is also the painted order (one flex row, no `order`
//      utilities anywhere in the bar; if one is ever added this file's claim needs revisiting).
//   3. THE ⚙ EXCLUSION. Pressing the preset trigger while the ⚙ panel is open must open the menu
//      rather than slam the panel shut under the finger — the same rule the mode selector has had
//      since round 5, now owed to a second control. It is wired by a required `wrapperRef` prop
//      (components/PresetSwitcher) into App's click-outside handler, and this is the behaviour that
//      proves the wiring rather than restating it.
//
// ⚠⚠ WHAT NO CASE IN HERE CAN PROVE, said plainly. jsdom has NO LAYOUT ENGINE: it lays out no flex
// box, resolves no `em`, and reports no width. So nothing below is evidence that the four controls
// FIT — and "fits" is the actual defect this rebuild was fixing (the shipped bar overflowed its
// line by ~12.9px at 360px, spilling the mode selector to ~2.7px from the screen edge against a
// ~15.6px gutter on the left). What the fit rests on is a measurement taken OUTSIDE this suite, in
// a real layout engine, and recorded at the budget block in src/main.tsx. The last case here is a
// PROXY for it: it pins the two width cuts that budget spends, because a future edit that quietly
// restores either one would put the overflow back and no test in this repo could see it.
// ⚠ AND THE MEASUREMENT ITSELF WAS DESKTOP CHROMIUM, NOT AN IPHONE. Glyph advances and the system
// UI font differ there; only the owner's device can confirm the real thing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import {
  mountApp,
  resetAppState,
  tap,
  openSettings,
  isSettingsOpen,
  outsideTarget,
  gear,
} from './helpers/settingsPanel.jsx'

const bar = () => screen.getByRole('banner')
// The row itself and its two groups. Resolved through the utility that makes the row a row, which
// is also the class the budget below is about — see that case for why a class read is the honest
// most this environment can offer.
const row = () => bar().querySelector('.justify-between')
const presetTrigger = () => screen.getByRole('button', { name: 'Preset' })
const modeTrigger = () => screen.getByRole('button', { name: 'Mode' })
// The mark. aria-hidden by design (W5Logo says why), so it has no role to ask for — and its
// absence from the accessibility tree is exactly why the <h1> below has to exist.
const logo = () => bar().querySelector('svg[aria-hidden="true"]')

// a is before b in document order.
const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  resetAppState()
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  resetAppState()
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the app still says its own name, without printing it', () => {
  it('keeps ONE h1 named Calendar Game, and it is the sr-only one', () => {
    mountApp()
    const headings = screen.getAllByRole('heading', { name: 'Calendar Game' })
    expect(headings).toHaveLength(1)
    const h1 = headings[0]
    expect(h1.tagName).toBe('H1')
    // The whole point of the pair: same accessible name as before, no paint. jsdom cannot prove
    // "no paint" — it computes no styles for a class — so what is asserted is the CONTRACT the
    // paint hangs off. (In Chromium at 360×800 the element measures 1×1, which is the actual
    // evidence; it is recorded here rather than in an assertion because this environment cannot
    // reproduce it.)
    expect(h1.className.split(/\s+/)).toContain('sr-only')
  })

  it('prints the words nowhere else in the bar', () => {
    mountApp()
    // Leaf elements only, so the wrappers that merely CONTAIN the heading are not counted as
    // printing it. If the wordmark ever comes back as a visible node, it lands in this list.
    const carriers = [...bar().querySelectorAll('*')].filter(
      (el) => !el.firstElementChild && el.textContent.trim() === 'Calendar Game',
    )
    expect(carriers).toHaveLength(1)
    expect(carriers[0].tagName).toBe('H1')
  })

  it('wraps the bar in a banner landmark, which is what makes the hidden heading reachable', () => {
    mountApp()
    // One banner, and it is the bar itself — not some wrapper around it, or --bar-h's seven
    // readers and the shade writer would be measuring a different box than the one they name.
    expect(bar().classList.contains('htp-sticky-bar')).toBe(true)
    expect(bar().contains(screen.getByRole('heading', { name: 'Calendar Game' }))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("the owner's layout: logo, preset, mode, gear", () => {
  it('puts the four controls in that order, all inside the bar', () => {
    mountApp()
    const items = [logo(), presetTrigger(), modeTrigger(), gear()]
    for (const el of items) expect(bar().contains(el)).toBe(true)
    for (let i = 0; i < items.length - 1; i++) expect(precedes(items[i], items[i + 1])).toBe(true)
  })

  it('leaves the mark first and the gear last in the row, with nothing after either', () => {
    mountApp()
    const groups = [...row().children]
    expect(groups).toHaveLength(2) // left (mark + preset), right (mode + gear)
    expect(groups[0].firstElementChild).toBe(logo())
    expect(groups[1].lastElementChild.contains(gear())).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the ⚙ panel and the preset trigger', () => {
  it('stays open when the preset trigger is pressed, and the preset menu opens', () => {
    mountApp()
    openSettings()
    expect(isSettingsOpen()).toBe(true)
    tap(presetTrigger())
    // Both, not either: the panel survived AND the press did its own job. A handler that closed
    // the panel would also have left the menu open, so the second assertion alone proves nothing.
    expect(isSettingsOpen()).toBe(true)
    expect(screen.getByRole('listbox', { name: 'Preset' })).toBeInTheDocument()
  })

  it('still closes on a press that is genuinely outside — the exclusion is not a broken handler', () => {
    mountApp()
    openSettings()
    tap(outsideTarget())
    expect(isSettingsOpen()).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE WIDTH BUDGET, as far as this environment can guard it. Read the ⚠⚠ at the top of the file
// first: these are class reads, not measurements, and they are here because the two numbers below
// are the whole difference between a bar that fits four controls at 360px and the one that
// shipped spilling three. src/main.tsx carries the arithmetic and the measured slack.
describe('the width cuts that paid for the fourth control', () => {
  it('keeps the mode selector at pr-6 and the row at gap-1.5', () => {
    mountApp()
    // pr-9 → pr-6 on the mode trigger: ~11.7px back at a 15.6px root, and the chevron does not
    // move (it is `absolute right-2` in both selects).
    const mode = modeTrigger().className.split(/\s+/)
    expect(mode).toContain('pr-6')
    expect(mode).not.toContain('pr-9')
    // gap-2 → gap-1.5 on all three gaps in the row: ~5.9px back, and the margin that carries the
    // fit past a 360-wide phone tall enough to max out the fluid root font.
    for (const el of [row(), ...row().children]) {
      expect(el.className.split(/\s+/)).toContain('gap-1.5')
    }
  })

  it('still refuses to squeeze: neither group may shrink', () => {
    mountApp()
    // The bar's failure mode is deliberately "spill", not "squash" — a truncated mode name or a
    // clipped gear would be worse than an overflow nobody can hit any more. Both groups keep
    // shrink-0, which is what makes the budget a fixed sum rather than something flex negotiates.
    for (const g of row().children) expect(g.className.split(/\s+/)).toContain('shrink-0')
  })
})
