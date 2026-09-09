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
// The row itself — ONE flat flex row since Q6 (round 20), not two nested shrink-0 groups, so it is
// resolved structurally (the logo's own parent) rather than by a `justify-between` class that no
// longer exists on it: the switcher is the one control that grows now, and a gap between two
// groups is not where that growth lives any more (main.tsx's budget block argues the whole thing).
const row = () => logo().parentElement
// ⚠ ASKED BY A NAME PREFIX, not by an exact one, and that is the contract rather than a
// convenience: a CustomSelect trigger names itself with its SETTING and its current VALUE
// (components/CustomSelect composes the two), so these read "Preset, Preset 1" and "Mode,
// Classic". The case below pins the whole composed name; everything else only needs the control.
const presetTrigger = () => screen.getByRole('button', { name: /^Preset,/ })
const modeTrigger = () => screen.getByRole('button', { name: /^Mode,/ })
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
    // ONE FLAT ROW since Q6 (round 20) — logo, preset wrapper, mode wrapper, gear wrapper as four
    // direct siblings, not two nested shrink-0 groups. `logo()` IS the first child directly (it
    // needs no wrapper of its own — its className is this file's to set already); the gear sits
    // inside the LAST child's own wrapper, same as before.
    const items = [...row().children]
    expect(items).toHaveLength(4)
    expect(items[0]).toBe(logo())
    expect(items[items.length - 1].contains(gear())).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE BAR'S TWO DROPDOWNS NAME THEMSELVES WITH THEIR VALUE, and this is where that is pinned for
// BOTH — it is one shared component's behaviour (components/CustomSelect), and the failure it
// replaces was shared too: an `aria-label` on the trigger REPLACES the element's content, so each
// control announced its setting and swallowed its value. "Preset, collapsed" told a screen-reader
// user everything except which preset they were in — on the one control the bar exists to carry.
// ⚠ ASSERTED BY ACCESSIBLE NAME, never by an attribute: the name is COMPOSED from two nodes, so
// reading `aria-label` (or `aria-labelledby`) back would pin the mechanism and not the outcome.
describe('the preset and mode triggers announce their value, not just their setting', () => {
  it('names each control with its setting AND what it is currently set to', () => {
    mountApp()
    expect(screen.getByRole('button', { name: 'Preset, Preset 1' })).toBe(presetTrigger())
    expect(screen.getByRole('button', { name: 'Mode, Classic' })).toBe(modeTrigger())
  })

  it('follows the value when it changes', () => {
    mountApp()
    tap(modeTrigger())
    tap(screen.getByRole('option', { name: 'Flash' }))
    expect(screen.getByRole('button', { name: 'Mode, Flash' })).toBe(modeTrigger())
    // …and the six unselected options stacked in the same cell contribute nothing to it: they are
    // aria-hidden, and a hidden node that is not itself referenced adds no text to a name.
    expect(screen.queryByRole('button', { name: /Classic/ })).toBeNull()
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
  it('keeps the mode selector at pr-6, and the row at gap-1.5', () => {
    mountApp()
    // pr-9 → pr-6 on the mode trigger: ~11.7px back at a 15.6px root, and the chevron does not
    // move (it is `absolute right-2` in both selects).
    const mode = modeTrigger().className.split(/\s+/)
    expect(mode).toContain('pr-6')
    expect(mode).not.toContain('pr-9')
    // ONE gap-1.5 now, on the row itself — Q6 flattened two nested shrink-0 groups (each with
    // their own gap-1.5) into one flat row, so there is only the one flex container left to carry
    // it. The four children are single-purpose wrapper elements now, not multi-child flex rows of
    // their own, so none of THEM needs a gap class any more.
    expect(row().className.split(/\s+/)).toContain('gap-1.5')
  })

  it("keeps the logo, mode selector and gear content-sized — only the switcher's wrapper grows", () => {
    mountApp()
    // Q6's invariant, replacing the old "neither group may shrink" one: the bar's failure mode is
    // still deliberately "spill", not "squash" for three of the four controls — a truncated mode
    // name or a clipped gear would be worse than an overflow nobody can hit. What changed is WHICH
    // element absorbs the bar's slack: not a `justify-between` gap between two groups any more, but
    // the preset switcher's own wrapper, which is the one child that is flex-1/min-w-0 instead of
    // shrink-0 (main.tsx's budget block argues why it is the switcher and not one of the other
    // three). tests/presetSwitcher.dom pins what growing actually does to that control's own cell.
    const [logoEl, switcherWrap, modeWrap, gearWrap] = [...row().children]
    // `getAttribute('class')`, not `.className` — the logo is an <svg>, whose `className` is an
    // SVGAnimatedString rather than a plain string (an HTML element's `.split` would work fine,
    // which is exactly the trap: a helper written against the HTML case only breaks the moment an
    // SVG joins the same loop). `getAttribute` reads the same thing uniformly for both.
    for (const el of [logoEl, modeWrap, gearWrap]) {
      expect(el.getAttribute('class').split(/\s+/)).toContain('shrink-0')
    }
    const switcherClasses = switcherWrap.className.split(/\s+/)
    expect(switcherClasses).toContain('flex-1')
    expect(switcherClasses).toContain('min-w-0')
    expect(switcherClasses).not.toContain('shrink-0')
  })
})
