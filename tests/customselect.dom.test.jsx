// @vitest-environment jsdom
//
// CustomSelect — the "active cursor" highlight behavior (the mode-selector popover).
//
// The grey active box (bg-black/10) is a pointer/keyboard cursor, NOT an open-state
// indicator: it must NOT appear just from opening (so it never shows on mobile, where there's
// no hover/arrow input), it appears on a real MOUSE hover or an arrow key, and the first arrow
// steps ONE option from the selected one (Down → below the ✓, Up → above). The trigger opens ONLY
// via the global Tab shortcut or a mouse click — Enter/Space/arrows do NOT open it from the trigger.
// The check mark (✓) marks the selection, independent of the box.
// (Behavior updated 2026-06-06; the box-on-open suppression was 2026-06-01.)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import CustomSelect from '../src/components/CustomSelect.jsx'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

// The active box is `bg-black/10` as its own class; inactive options get `active:bg-black/10`
// (a press-only pseudo). The leading space distinguishes the standalone token from the pseudo.
const hasBox = (btn) => btn.className.includes(' bg-black/10')
const options = () => screen.getAllByRole('option')

function openWith(value = 'b') {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  render(<CustomSelect value={value} onChange={() => {}} options={OPTIONS} ariaLabel="Test" />)
  const trigger = screen.getByRole('button', { name: /^Test,/ })
  fireEvent.click(trigger) // open the popover
  return trigger
}

describe('CustomSelect — active-cursor highlight', () => {
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('shows NO active box when the popover just opened (the mobile / no-input case)', () => {
    openWith('b')
    expect(options().some(hasBox)).toBe(false) // nothing highlighted on open
    // …but the selected option still carries its check mark.
    const selected = options().find((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected.textContent).toContain('✓')
    expect(selected.textContent).toContain('Beta')
  })

  it('the first ArrowDown highlights the option BELOW the selected one', () => {
    const trigger = openWith('b') // Beta (index 1) → first Down lands on Gamma (index 2)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].textContent).toContain('Gamma')
  })

  it('the first ArrowUp highlights the option ABOVE the selected one', () => {
    const trigger = openWith('b') // Beta (1) → first Up lands on Alpha (0)
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].textContent).toContain('Alpha')
  })

  it('ArrowDown steps down one option at a time and clamps at the last', () => {
    const trigger = openWith('a') // Alpha (0)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // → Beta (1)
    expect(options().filter(hasBox)[0].textContent).toContain('Beta')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // → Gamma (2)
    expect(options().filter(hasBox)[0].textContent).toContain('Gamma')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // clamps at Gamma (last)
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].textContent).toContain('Gamma')
  })

  it('the trigger does NOT open on Enter / Space / arrows (only Tab or a mouse click opens it)', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<CustomSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Test" />)
    const trigger = screen.getByRole('button', { name: /^Test,/ })
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      fireEvent.keyDown(trigger, { key })
      expect(screen.queryAllByRole('option').length).toBe(0) // stays closed — no keyboard open from the trigger
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    }
    fireEvent.click(trigger) // a mouse click still opens it
    expect(screen.queryAllByRole('option').length).toBe(3)
  })

  it('a MOUSE hover highlights an option, a TOUCH pointer does not', () => {
    openWith('b')
    const gamma = options().find((o) => o.textContent.includes('Gamma'))
    fireEvent.pointerEnter(gamma, { pointerType: 'touch' })
    expect(hasBox(gamma)).toBe(false) // touch → no box (mobile stays clean)
    fireEvent.pointerEnter(gamma, { pointerType: 'mouse' })
    expect(hasBox(gamma)).toBe(true) // mouse → box (desktop hover)
  })
})

// ── The trigger's ACCESSIBLE NAME ────────────────────────────────────────────────────────────
//
// It is the label PLUS the selected option, and it has to be composed rather than declared: an
// `aria-label` REPLACES an element's content, so the trigger used to announce its setting and
// swallow its value — "Mode" without "Classic", "Preset" without the preset. Both live call sites
// are pinned end-to-end in tests/topBar.dom; these two cases are the component's own contract,
// including the branch neither call site exercises (no ariaLabel at all).
describe('CustomSelect — the trigger names its setting AND its value', () => {
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const mountBare = (props) => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<CustomSelect value="b" onChange={() => {}} options={OPTIONS} {...props} />)
  }

  it('joins the two with a comma, and leaves the unselected options out of it', () => {
    mountBare({ ariaLabel: 'Test' })
    expect(screen.getByRole('button', { name: 'Test, Beta' })).toBeTruthy()
    // Alpha and Gamma are stacked in the same cell, aria-hidden; a hidden node that is not itself
    // referenced contributes no text to a name.
    expect(screen.queryByRole('button', { name: /Alpha|Gamma/ })).toBeNull()
  })

  it('falls back to naming itself from its content when the caller gave no label', () => {
    mountBare({})
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy()
  })
})

// ── The fixed portal panel: position, what closes it, and --bar-h ────────────────────────────
//
// POSITION (Q8, round 11). The option panel portals into #root as position:FIXED, so its
// containing block is the viewport in both of the app's layouts and its coordinates are simply
// the trigger's viewport rect — no scroll term, no mode-dependent correction. That replaces the
// round-4 ± window.scrollY patch, which existed only because the panel was position:absolute
// while guide mode (html[data-doc-scroll]) MADE #root static, moving the panel's containing block
// to the document origin. Both halves of that are history now — round 13 deleted the document
// scroller, so #root is fixed in every mode — and the assertion here is deliberately STRONGER than
// either: the old test pinned a particular scroll term, this one pins that the panel's position
// does not depend on any scroll AT ALL.
// The auto-flip-up branch is gone with it (owner's call): at the only call site the trigger is
// inside the bar the flip measured its ceiling from, so the space above is structurally negative
// and the branch was unreachable. Its three tests are gone for the same reason — testing an
// unreachable branch is how it survives.
//
// ⚠ WHAT CLOSES IT (rewritten 2026-08-07, and the direction REVERSED — read this before
// "fixing" anything below). A SCROLL DOES NOT CLOSE THIS MENU. Choosing an option closes it, a
// press outside it closes it, Escape/Tab close it, Android Back closes it. A document scroll does
// nothing whatsoever, and that is the OWNER'S EXPLICIT DECISION (2026-08-07), not an oversight.
//
// It was a dismiss rule for three rounds, and the rule needed to tell "a scroll you started with
// the menu open" (dismiss) from "a scroll that was already gliding when you opened it" (leave
// alone). Drawing that line means timing scroll events, and two mechanisms — a `scrollend`
// boundary, then a measured gap between scroll events — each PASSED IN CHROMIUM and each FAILED on
// the owner's iPhone. The half that made the whole thing impossible was never a timing bug: WebKit
// deliberately suppresses the entire touch sequence of a tap that interrupts momentum deceleration
// (no touchstart, no pointerdown, no click — since ~2017, with no `touch-action` opt-out), so a tap
// on a coasting page cannot open this menu under ANY design. Given a rule that could only ever be
// approximated, the owner chose to drop it: the menu now behaves like a native iOS menu, and
// because its trigger is in the FIXED top bar the panel simply rides along, still glued under the
// button it belongs to, while the page moves.
// The owner's cases, as they now stand:
//   A. tap the trigger while the page still coasts → the platform eats that tap; the first tap
//      stops the page and the second opens the menu. Nothing to test in jsdom: the event never
//      reaches the app. (What IS testable and IS fixed: once open, it stays open — below.)
//   B. the page is already gliding when it opens   → opens, and the glide neither closes nor moves
//      it;
//   C. page still, the user swipes it              → closes, via the touchstart-outside path (the
//      test says so and proves which path did it);
//   D. page still, then a scroll STARTS            → DELIBERATELY GIVEN UP. It stays open. Pinned
//      below so nobody restores the dismissal by reflex.
// No clock, no scroll cadences, no end-of-scroll signal: with nothing timing-dependent left, a
// scroll event is just an event that must have no effect, whatever its target.
describe('CustomSelect — the fixed portal panel (position, what closes it, --bar-h)', () => {
  let rectSpy
  // All triggers share one mocked rect — only the CustomSelect wrapper's rect is read while
  // these tests run (jsdom's real getBoundingClientRect is all-zeros, useless for geometry).
  // Callable again mid-test to MOVE the trigger, which is how "did it re-measure?" is asked.
  const mockRect = ({ top, bottom, left, right }) => {
    const rect = {
      top,
      bottom,
      left,
      right,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    }
    if (rectSpy) rectSpy.mockReturnValue(rect)
    else rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  }
  const setScrollY = (v) =>
    Object.defineProperty(window, 'scrollY', { configurable: true, value: v })
  // One frame of a moving page. There is deliberately no clock and no cadence any more: the
  // component subscribes to no document scroll at all, so what a scroll event costs the panel does
  // not depend on when it arrives, how many arrive, or what came before. (The old suite drove a
  // mocked monotonic performance.now() because the rule it pinned was timing-dependent — that
  // whole harness went with the rule.)
  const docScroll = () => fireEvent.scroll(document)
  const barTriggerRect = { top: 40, bottom: 63, left: 200, right: 300 }
  const movedTriggerRect = { top: 900, bottom: 923, left: 200, right: 300 }
  const optionCount = () => screen.queryAllByRole('option').length

  afterEach(() => {
    rectSpy?.mockRestore()
    rectSpy = undefined
    setScrollY(0) // jsdom never scrolls on its own; pin the mock back to the app-mode value
    document.documentElement.style.removeProperty('--bar-h') // back to the 0 the app never sets in jsdom
    cleanup()
    document.getElementById('root')?.remove()
  })

  const mount = (props = {}) => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(
      <CustomSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Test" {...props} />,
    )
    return screen.getByRole('button', { name: /^Test,/ })
  }
  const panel = () => screen.getByRole('listbox')

  it('is position:fixed, 6px under the trigger with their right edges aligned', () => {
    mockRect(barTriggerRect)
    fireEvent.click(mount())
    expect(panel().style.position).toBe('fixed')
    expect(panel().style.top).toBe(`${63 + 6}px`)
    expect(panel().style.right).toBe(`${document.documentElement.clientWidth - 300}px`)
    expect(panel().style.bottom).toBe('') // opens down; there is no flip-up branch left
  })

  it('places the panel IDENTICALLY at every document scroll offset (the term is gone, not retuned)', () => {
    mockRect(barTriggerRect)
    const trigger = mount()
    fireEvent.click(trigger)
    const atRest = { top: panel().style.top, right: panel().style.right }
    fireEvent.click(trigger) // close
    // A deeply scrolled guide page. Under the old absolute panel this same open painted the menu
    // 1500px away from its trigger unless a matching correction term was applied.
    setScrollY(1500)
    fireEvent.click(trigger)
    expect({ top: panel().style.top, right: panel().style.right }).toEqual(atRest)
    expect(panel().style.top).toBe(`${63 + 6}px`)
  })

  // ⚠⚠ THE PIN. The owner decided on 2026-08-07 that a scroll must NOT close this menu — case D,
  // given up on purpose so that cases B and C can be right on a real iPhone instead of right in
  // Chromium. If you are here because this test is in your way, the answer is not to delete it:
  // read the block above the describe, then go and ask the owner. Three rounds of engineering went
  // into learning that the rule this test forbids cannot be built on iOS.
  it('D, DELIBERATELY GIVEN UP — a scroll started with the menu open leaves it open and unmoved', () => {
    mockRect(barTriggerRect)
    const trigger = mount()
    fireEvent.click(trigger)
    expect(optionCount()).toBe(3)
    // Move the trigger's rect first, so a re-measure would be visible in the assertions below: the
    // panel must neither close NOR reposition on any of this. (Re-measuring per scroll event
    // through momentum is the jitter Q8 removed; nothing re-armed it.)
    mockRect(movedTriggerRect)
    // Every shape of scroll the app can see, with the menu open on a page that was standing still:
    // iOS's status-bar tap to the top and an ordinary page scroll (fired at the Document), the
    // documentElement target a previous round wrongly believed WebKit sometimes used, and an
    // element scroll (the settings popover's inner wrapper, the Lookup list).
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    for (let i = 0; i < 12; i++) {
      docScroll()
      fireEvent.scroll(document.documentElement)
      fireEvent.scroll(scroller)
    }
    expect(optionCount()).toBe(3) // still open
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(panel().style.top).toBe(`${63 + 6}px`) // still exactly where it opened
    scroller.remove()
  })

  it('B — the page is already gliding when it opens: it opens, and the glide never touches it', () => {
    mockRect(barTriggerRect)
    // The owner's case B: he taps the iOS status bar, the page glides to the top, and he taps the
    // trigger while it is still moving. (Case A — tapping during MOMENTUM after a flick — cannot be
    // reproduced here or anywhere: WebKit suppresses that tap's entire touch sequence before the
    // page sees it, so there is no event for a test to fire. The platform's answer is that the
    // first tap stops the page; this test covers what happens once a tap does land.)
    for (let i = 0; i < 3; i++) docScroll() // the glide is already running…
    const trigger = mount()
    fireEvent.click(trigger) // …when the menu opens
    expect(optionCount()).toBe(3)
    mockRect(movedTriggerRect) // again, so a re-measure would show
    for (let i = 0; i < 20; i++) docScroll() // and the glide runs on underneath it
    expect(optionCount()).toBe(3)
    expect(panel().style.top).toBe(`${63 + 6}px`)
    // Opening during a glide is not a special state the component remembers, so what closes it is
    // unchanged: pick an option, press outside, Escape. Escape here, which also refocuses.
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(optionCount()).toBe(0)
    expect(document.activeElement).toBe(trigger)
  })

  it('C — page still, the user swipes: the TOUCH closes it, and it is the touch that does it', () => {
    mockRect(barTriggerRect)
    const trigger = mount()
    fireEvent.click(trigger)
    expect(optionCount()).toBe(3)
    // ⚠ WHICH PATH: the click-outside listener (mousedown/touchstart). The finger lands outside the
    // panel, on the page it is about to pan, and that is simply a press outside an open popover —
    // it closes there and then, before the page has moved a pixel. No scroll event has been
    // dispatched at this point, which is what proves the path: there is no other one left.
    fireEvent.touchStart(document.body)
    expect(optionCount()).toBe(0)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).not.toBe(trigger) // outside-tap semantics: no refocus
    // The other half of the same gesture, and the half that CHANGED on 2026-08-07: a swipe that
    // starts INSIDE the panel is not an outside press, so that listener declines it — and the page
    // it then pans no longer closes the menu either. It stays open, riding above the moving page,
    // still under its trigger in the fixed bar. That is the D sacrifice seen from the user's side.
    fireEvent.click(trigger)
    expect(optionCount()).toBe(3)
    fireEvent.touchStart(panel())
    expect(optionCount()).toBe(3)
    for (let i = 0; i < 12; i++) docScroll()
    expect(optionCount()).toBe(3)
  })

  it('re-measures when --bar-h changes, which moves the trigger without a window resize', async () => {
    // A font swap or safe-area shift re-heights the fixed bar; main.tsx publishes the new height
    // on <html> and fires no resize event. The panel watches that property because its trigger
    // lives in that bar.
    mockRect(barTriggerRect)
    fireEvent.click(mount())
    expect(panel().style.top).toBe(`${63 + 6}px`)
    mockRect({ top: 48, bottom: 71, left: 200, right: 300 }) // the bar grew 8px; the trigger moved
    await act(async () => {
      document.documentElement.style.setProperty('--bar-h', '80px')
    })
    expect(panel().style.top).toBe(`${71 + 6}px`)
    // An unrelated inline write on <html> (the theme background) is not a bar change.
    mockRect({ top: 300, bottom: 323, left: 200, right: 300 })
    await act(async () => {
      document.documentElement.style.background = '#000'
    })
    expect(panel().style.top).toBe(`${71 + 6}px`)
  })
})

// ── Q10: dropdownWidth + triggerMatchesDropdown ─────────────────────────────────────────────────
//
// Two opposite width behaviours the one shared component now has to carry, so the mode selector's
// trigger can match its own (unchanged) dropdown while the preset switcher's dropdown matches its
// (space-filling) trigger. jsdom lays out nothing and reports every rect as 0, so what is pinned
// here is the WIRING — which style each prop produces — not the pixel result (that is verified in a
// real browser and recorded at src/main.tsx's budget block).
describe('CustomSelect — Q10 width props', () => {
  let rectSpy
  afterEach(() => {
    rectSpy?.mockRestore()
    rectSpy = undefined
    cleanup()
    document.getElementById('root')?.remove()
  })
  const mountBare = (props) => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    return render(
      <CustomSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Test" {...props} />,
    )
  }
  const panel = () => screen.getByRole('listbox')

  it("defaults dropdownWidth to 'content' — the panel stays width:max-content", () => {
    mountBare({})
    fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    expect(panel().style.width).toBe('max-content')
    expect(panel().style.maxWidth).toBe('90vw')
  })

  it("dropdownWidth='match-trigger' sizes the panel to the trigger wrapper's measured width", () => {
    // Mock the wrapper rect so the panel has a concrete width to copy (jsdom's real rects are 0).
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      bottom: 63,
      left: 100,
      right: 320,
      x: 100,
      y: 40,
      width: 220,
      height: 23,
      toJSON: () => ({}),
    })
    mountBare({ dropdownWidth: 'match-trigger' })
    fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    expect(panel().style.width).toBe('220px') // the trigger wrapper's rect width, not max-content
    expect(panel().style.maxWidth).toBe('90vw') // the clamp survives
  })

  it('triggerMatchesDropdown renders a hidden width-mirror that is invisible to roles and the user', () => {
    const { container } = mountBare({ triggerMatchesDropdown: true })
    // Closed: still zero options, zero listboxes — the mirror carries no role.
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.queryAllByRole('listbox')).toHaveLength(0)
    // The mirror: aria-hidden, visibility:hidden, out of flow, one row per option.
    const mirror = container.querySelector('div[aria-hidden="true"][style*="visibility: hidden"]')
    expect(mirror).not.toBeNull()
    expect(mirror.style.position).toBe('absolute')
    expect(mirror.querySelectorAll(':scope > div')).toHaveLength(OPTIONS.length)
    // Each mirror row is boxed by the SAME shared class string as a real dropdown row — the width
    // pieces (text tier, side padding, gap) must match or the mirror measures the wrong number.
    const mirrorRow = mirror.querySelector(':scope > div').className.split(/\s+/)
    for (const c of ['text-[15px]', 'pl-4', 'pr-4', 'gap-2.5', 'flex']) {
      expect(mirrorRow).toContain(c)
    }
    // …and the real rows carry it too (open the menu and read one).
    fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    const realRow = screen.getAllByRole('option')[0].className.split(/\s+/)
    for (const c of ['text-[15px]', 'pl-4', 'pr-4', 'gap-2.5', 'flex']) {
      expect(realRow).toContain(c)
    }
  })

  it('without a layout engine, triggerMatchesDropdown leaves the trigger with no forced min-width', () => {
    // The 0-width mirror measurement is discarded (the > 0 guard), so the trigger keeps its
    // natural width — all "match" can mean where nothing has a width.
    mountBare({ triggerMatchesDropdown: true })
    expect(screen.getByRole('button', { name: /^Test,/ }).style.minWidth).toBe('')
  })
})
