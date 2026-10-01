// @vitest-environment jsdom
//
// Round 6 — the accordion's grid-template-rows migration; round 7 — the motion clock split;
// Round 8 — one duration for every accordion in the app.
// The Expander slides open/closed by tweening its one grid row 0fr⇄1fr (index.css .expander
// rules), replacing the old measured max-height clamp. Round 7 moved the duration onto the
// --expander-ms var and unified the easing on the Material standard curve
// (ACCORDION_EASE_CSS, lib/accordionMotion). Round 8 finished the job: BOTH consumers now state
// their duration — the guide's coordinator a distance-scaled per-toggle value, the codes
// panel the ACCORDION_MS_FLOOR that formula returns at its size — so the CSS fallback is
// defence only (it must still exist: an unset var makes the calc() invalid and the
// transition would silently become 0s), and CODES_CLOSE_MS derives from that same floor.
// These tests pin the structure the CSS keys off — the grid wrapper class, the open-state
// modifier, the single row div, and the always-mounted content contract (dotDiagram.dom
// relies on closed sections staying queryable) — plus the index.css rules themselves (jsdom
// applies no stylesheets, so the source is the only place to assert them), the cross-module
// timing contracts (the CSS fallback mirrors ACCORDION_MS_FLOOR; the codes panel's slide fits
// inside its freeze window; the GuideSection triangle runs the same var, fallback and curve
// so all finish together), the aria-expanded/aria-controls disclosure contract on BOTH
// accordions, and the coordinator's shared clock (one --expander-ms per toggle, stamped on
// every section). The motion itself is layout-engine truth jsdom cannot see — verified
// on-device (distance-scaled speed across panels of very different lengths, the scroll
// riding the panels' own clock).
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Expander from '../src/components/Expander.jsx'
import { GuideSection } from '../src/components/GuidePage.jsx'
import { MethodBreakdownSection } from '../src/components/MethodBreakdown.jsx'
import { renderGuidePage } from './helpers/guideScroller.jsx'
import {
  ACCORDION_EASE_CSS,
  ACCORDION_MS_FLOOR,
  CODES_CLOSE_MS,
} from '../src/lib/accordionMotion.js'

// The whole-page cases go through renderGuidePage (tests/helpers/guideScroller), which mounts the
// guide the way App does — inside the one scroll box, holding the ref the coordinator dereferences
// on every tap, with real extent behind it. GuideSection on its own needs none of that: it is the
// row, and the coordinator lives a level up.
let guide = null
afterEach(() => {
  guide?.restore()
  guide = null
  cleanup()
})

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
)

// ACCORDION_MS_FLOOR as index.css spells it: seconds, leading zero dropped (240 → ".24").
// Built from the constant so the CSS fallback can never drift from the JS law.
const FLOOR_S = `${ACCORDION_MS_FLOOR / 1000}`.replace(/^0/, '')

// The curve with whitespace/serialization noise removed — jsdom's CSSOM may reformat an
// inline cubic-bezier (spaces, leading zeros), and only the numbers are the contract.
const normalizeEase = (s) => s.replace(/\s+/g, '').replace(/\b0\./g, '.')

describe('Expander structure (grid wrapper + row)', () => {
  it('closed: renders div.expander (no open modifier) wrapping a single row div, children mounted', () => {
    const { container } = render(
      <Expander open={false}>
        <p>panel body</p>
      </Expander>,
    )
    const wrapper = container.firstElementChild
    expect(wrapper.className).toBe('expander')
    expect(wrapper.children).toHaveLength(1)
    const row = wrapper.firstElementChild
    expect(row.tagName).toBe('DIV')
    // Always-mounted contract: closed content stays in the DOM (clipped by CSS, never unmounted).
    expect(row.textContent).toBe('panel body')
  })
  it('open: adds the expander-open modifier (the class the CSS tweens the row 0fr→1fr off)', () => {
    const { container } = render(
      <Expander open>
        <p>panel body</p>
      </Expander>,
    )
    expect(container.firstElementChild.className).toBe('expander expander-open')
  })
  it('toggling open flips ONLY the modifier class — the content node survives both directions', () => {
    const { container, rerender } = render(
      <Expander open={false}>
        <p>panel body</p>
      </Expander>,
    )
    const row = container.firstElementChild.firstElementChild
    const content = row.firstElementChild
    rerender(
      <Expander open>
        <p>panel body</p>
      </Expander>,
    )
    expect(container.firstElementChild.className).toBe('expander expander-open')
    expect(row.firstElementChild).toBe(content)
    rerender(
      <Expander open={false}>
        <p>panel body</p>
      </Expander>,
    )
    expect(container.firstElementChild.className).toBe('expander')
    expect(row.firstElementChild).toBe(content)
  })
})

describe('Expander durationMs prop (the per-toggle --expander-ms clock)', () => {
  it('stamps the inline --expander-ms var when given', () => {
    const { container } = render(
      <Expander open durationMs={350}>
        <p>panel body</p>
      </Expander>,
    )
    expect(container.firstElementChild.style.getPropertyValue('--expander-ms')).toBe('350ms')
  })
  it('leaves the var unset without the prop, so the CSS fallback governs', () => {
    // No production call site takes this branch any more (both state their duration), but
    // the component must keep working without the prop or the fallback would be untestable.
    const { container } = render(
      <Expander open>
        <p>panel body</p>
      </Expander>,
    )
    expect(container.firstElementChild.style.getPropertyValue('--expander-ms')).toBe('')
  })
})

describe('index.css expander rules (the styles the structure above keys into)', () => {
  it('the wrapper is a one-row grid — minmax(0,1fr) column, 0fr row, var-clocked standard-curve transition', () => {
    expect(css).toContain(
      '.expander{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:0fr;' +
        `transition:grid-template-rows calc(var(--expander-ms,${FLOOR_S}s) * var(--motion-scale)) ${ACCORDION_EASE_CSS}}`,
    )
    expect(css).toContain('.expander-open{grid-template-rows:1fr}')
  })
  it('the row div clips (overflow:hidden) and can shrink below its content (min-height:0)', () => {
    expect(css).toContain('.expander>div{min-height:0;overflow:hidden}')
  })
  it('the max-height machinery is gone — no max-height or will-change in any expander rule', () => {
    const expanderRules = css.match(/^\.expander[^{]*\{[^}]*\}/gm) ?? []
    expect(expanderRules.length).toBeGreaterThanOrEqual(3)
    for (const rule of expanderRules) {
      expect(rule).not.toMatch(/max-height|will-change/)
    }
  })
  // The guide-scoped overflow-anchor kill that pairs with the scroll coordinator is pinned in
  // tests/docScroll.dom, with the rest of the rules that say HOW How to Play scrolls. It used to
  // ride on the released document scroller; round 13 rescoped it to [data-guide], and it stayed in
  // that file because the file is the mechanism inventory, not the mechanism it inventoried.
})

describe('cross-module timing contracts (ACCORDION_MS_FLOOR is the one number)', () => {
  // The CSS-declared fallback slide duration in ms — the --expander-ms fallback parsed out of
  // the .expander rule itself. Belt-and-braces in production (both consumers stamp the var),
  // but it is what a panel would run at if one ever stopped, so it must mirror the JS law.
  const durationMs =
    parseFloat(
      css.match(
        /\.expander\{[^}]*transition:grid-template-rows calc\(var\(--expander-ms,([\d.]+)s\) \*/,
      )[1],
    ) * 1000
  it('the CSS fallback mirrors ACCORDION_MS_FLOOR', () => {
    expect(durationMs).toBe(ACCORDION_MS_FLOOR)
  })
  it('the codes panel close finishes inside its CODES_CLOSE_MS freeze window', () => {
    // MethodBreakdownSection holds its frozen inputs for CODES_CLOSE_MS after Hide Codes; the
    // slide must complete first or the panel's contents would change while still visible. It
    // slides at ACCORDION_MS_FLOOR (asserted against the rendered var below), and
    // CODES_CLOSE_MS is derived from that floor — so this can only fail if the buffer is
    // removed outright.
    expect(ACCORDION_MS_FLOOR).toBeLessThan(CODES_CLOSE_MS)
  })
  it('the GuideSection triangle runs the same var, the same fallback, and the same curve', () => {
    const { container } = render(
      <GuideSection id="s" title="Section" openId={null} onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    const triangle = [...container.querySelectorAll('button span')].find(
      (s) => s.textContent === '▼',
    )
    const inline = triangle.style.transitionDuration
    expect(inline).toContain('var(--motion-scale)')
    const fallback = parseFloat(inline.match(/var\(--expander-ms,\s*([\d.]+)s\)/)[1]) * 1000
    expect(fallback).toBe(durationMs)
    expect(normalizeEase(triangle.style.transitionTimingFunction)).toBe(
      normalizeEase(ACCORDION_EASE_CSS),
    )
  })
})

describe('GuideSection wiring into the Expander', () => {
  it('an open section carries expander-open; a closed one does not', () => {
    const { container: openC } = render(
      <GuideSection id="s" title="Section" openId="s" onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    expect(openC.querySelector('.expander').classList.contains('expander-open')).toBe(true)
    const { container: closedC } = render(
      <GuideSection id="s" title="Section" openId={null} onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    expect(closedC.querySelector('.expander').classList.contains('expander-open')).toBe(false)
  })
  it('durationMs reaches BOTH consumers: the panel (via the Expander prop) and the chevron (via the button)', () => {
    const { container } = render(
      <GuideSection id="s" title="Section" openId={null} onToggle={() => {}} durationMs={329}>
        <p>body</p>
      </GuideSection>,
    )
    expect(container.querySelector('.expander').style.getPropertyValue('--expander-ms')).toBe(
      '329ms',
    )
    expect(container.querySelector('button').style.getPropertyValue('--expander-ms')).toBe('329ms')
  })
  it('null durationMs (pre-first-toggle) stamps nothing — the CSS fallback governs', () => {
    const { container } = render(
      <GuideSection id="s" title="Section" openId={null} onToggle={() => {}} durationMs={null}>
        <p>body</p>
      </GuideSection>,
    )
    expect(container.querySelector('.expander').style.getPropertyValue('--expander-ms')).toBe('')
    expect(container.querySelector('button').style.getPropertyValue('--expander-ms')).toBe('')
  })
})

describe('GuideSection accordion contract (aria + coordinator landmarks)', () => {
  it('the header button announces state and points at the panel body it controls', () => {
    const { container } = render(
      <GuideSection id="overview" title="Section" openId={null} onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    const button = container.querySelector('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('guide-panel-overview')
    const panel = document.getElementById('guide-panel-overview')
    expect(panel).not.toBeNull()
    expect(panel.textContent).toBe('body')
  })
  it('aria-expanded tracks the open state', () => {
    const { container } = render(
      <GuideSection id="overview" title="Section" openId="overview" onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    expect(container.querySelector('button').getAttribute('aria-expanded')).toBe('true')
  })
  it('the section wrapper carries the lookup id, and no scroll margin of its own', () => {
    const { container } = render(
      <GuideSection id="overview" title="Section" openId={null} onToggle={() => {}}>
        <p>body</p>
      </GuideSection>,
    )
    const wrapper = container.firstElementChild
    expect(wrapper.id).toBe('guide-sec-overview')
    // Round 8 deleted the scroll-mt that used to sit here. It never had a consumer:
    // nothing in src/ calls scrollIntoView, there is no fragment navigation, and native
    // focus scrolling targets the focused HEADER BUTTON, not this wrapper. The reading
    // line is declared once, as scroll-padding-top on the app's one scrollport
    // (index.css --seat-top on #appScroll), which the focus path DOES honour — pinned in
    // docScroll.dom.
    expect(wrapper.className).not.toContain('scroll-mt')
  })
})

describe('GuidePage toggle coordinator (the shared clock, exclusive open)', () => {
  // ⚠ THE MOUNT IS PART OF THE TEST. The coordinator's second half — read the scroller, measure it,
  // ask lib/accordionMotion for a target — runs on every tap, after the state flip that these two
  // cases assert. Mount the guide without its scroller and the tap still opens the panel and then
  // throws, so both cases pass while everything past the state flip goes unrun. renderGuidePage
  // stands up the real shape, extent included, so a tap here executes the callback end to end; what
  // it LANDS on is tests/guideScroll.dom's, and is not restated below.
  const headers = (container) => [...container.querySelectorAll('button[aria-controls]')]
  it('a toggle stamps ONE shared --expander-ms on every section and opens exactly the tapped one', () => {
    const { container, guide: g } = renderGuidePage()
    guide = g
    const all = headers(container)
    fireEvent.click(all[0])
    // jsdom lays out at zero height, so the distance-scaled clock lands on its 240ms floor —
    // and the SAME value reaches every section (the twin-toggle shared-clock contract).
    for (const h of all) {
      expect(h.style.getPropertyValue('--expander-ms')).toBe('240ms')
    }
    expect(all[0].getAttribute('aria-expanded')).toBe('true')
    expect(all.filter((h) => h.getAttribute('aria-expanded') === 'true')).toHaveLength(1)
  })
  it('tapping another section switches the single open panel; re-tapping closes it', () => {
    const { container, guide: g } = renderGuidePage()
    guide = g
    const all = headers(container)
    fireEvent.click(all[0])
    fireEvent.click(all[3])
    expect(all[0].getAttribute('aria-expanded')).toBe('false')
    expect(all[3].getAttribute('aria-expanded')).toBe('true')
    expect(all.filter((h) => h.getAttribute('aria-expanded') === 'true')).toHaveLength(1)
    fireEvent.click(all[3])
    expect(all.filter((h) => h.getAttribute('aria-expanded') === 'true')).toHaveLength(0)
  })
})

describe('MethodBreakdownSection wiring into the Expander (the codes panel)', () => {
  const DATE = { y: 2024, m: 3, d: 15 }
  const mount = (date = DATE) =>
    render(<MethodBreakdownSection date={date} className="" contentClassName="codes-body" />)

  it('states its duration: ACCORDION_MS_FLOOR, the same clock the guide bottoms out at', () => {
    // Not the CSS fallback by omission (that was the earlier coincidence of 280ms vs 240ms) —
    // the codes panel opts in, so the agreement with CODES_CLOSE_MS is derived, not hoped for.
    const { container } = mount()
    expect(container.querySelector('.expander').style.getPropertyValue('--expander-ms')).toBe(
      `${ACCORDION_MS_FLOOR}ms`,
    )
  })

  it('the toggle announces state and points at the codes body it controls', () => {
    const { container } = mount()
    const button = container.querySelector('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(button.getAttribute('aria-controls'))
    expect(panel).not.toBeNull()
    expect(panel.className).toBe('codes-body')
    // The controlled region is the panel body INSIDE the slider, matching the guide's shape.
    expect(panel.closest('.expander')).not.toBeNull()
  })

  it('aria-expanded tracks the open state through a toggle', () => {
    const { container } = mount()
    const button = container.querySelector('button')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.expander').classList.contains('expander-open')).toBe(true)
  })

  it('with no date the toggle is disabled AND reports itself collapsed', () => {
    const { container } = mount(null)
    const button = container.querySelector('button')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('every mounted copy gets its own panel id (all six live in the tree at once)', () => {
    // The game modes are always mounted (display:none when inactive), so a shared literal id
    // would put five duplicates in the document — hence useId rather than a caller-supplied id.
    const { container } = render(
      <>
        <MethodBreakdownSection date={DATE} className="" contentClassName="codes-body" />
        <MethodBreakdownSection date={DATE} className="" contentClassName="codes-body" />
      </>,
    )
    const ids = [...container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-controls'),
    )
    expect(ids.filter(Boolean)).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})
