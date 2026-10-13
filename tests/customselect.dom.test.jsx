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
import { useRef } from 'react'
import CustomSelect from '../src/components/CustomSelect.jsx'
import { useLayer } from '../src/components/overlayStack.js'
import { installResizeObserver, holdFrames } from './helpers/scrollGeometry.js'

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

  // The owner's ruling of 2026-10-06, which replaced "no key opens it from the trigger": a list
  // opens from the keyboard like any list button. Until then the preset list and the ⚙ menu's
  // "Open in" could not be opened without a pointer at all.
  it('Enter or Space on the closed trigger OPENS the list, and the browser`s own click is refused', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<CustomSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Test" />)
    const trigger = screen.getByRole('button', { name: /^Test,/ })
    for (const key of ['Enter', ' ']) {
      const delivered = fireEvent.keyDown(trigger, { key })
      expect(delivered).toBe(false) // preventDefault: the key must not ALSO click the button shut
      expect(screen.queryAllByRole('option').length).toBe(3)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(options().filter(hasBox).length).toBe(0) // opening moves no cursor
      fireEvent.keyDown(trigger, { key: 'Tab' }) // the list`s own way out
      expect(screen.queryAllByRole('option').length).toBe(0)
    }
    // A chord is not the key: Ctrl+Enter and friends are left to the browser.
    fireEvent.keyDown(trigger, { key: 'Enter', ctrlKey: true })
    expect(screen.queryAllByRole('option').length).toBe(0)
  })

  it('↑ and ↓ open it only while the page is covered — on the open page they are Lookup`s keys', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    // Stands in for the ⚙ menu: a layer that covers the page, with the list`s trigger inside it.
    function Cover({ children }) {
      const box = useRef(null)
      useLayer(true, () => {}, 'cover', undefined, {
        parts: () => [box.current],
        hold: () => box.current,
        walk: () => box.current,
      })
      return (
        <div ref={box} tabIndex={-1}>
          {children}
        </div>
      )
    }
    const select = <CustomSelect value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Test" />
    const view = render(select)
    const trigger = () => screen.getByRole('button', { name: /^Test,/ })
    for (const key of ['ArrowDown', 'ArrowUp']) {
      expect(fireEvent.keyDown(trigger(), { key })).toBe(true) // not claimed: the page`s to use
      expect(screen.queryAllByRole('option').length).toBe(0)
    }
    view.rerender(<Cover>{select}</Cover>)
    for (const key of ['ArrowDown', 'ArrowUp']) {
      expect(fireEvent.keyDown(trigger(), { key })).toBe(false)
      expect(screen.queryAllByRole('option').length).toBe(3)
      fireEvent.keyDown(trigger(), { key: 'Tab' })
      expect(screen.queryAllByRole('option').length).toBe(0)
    }
  })

  it('Shift+Tab closes an open list like Tab does, and the keyboard stays on its button', () => {
    // It used to be left to the browser, which walked focus off the trigger to whatever came
    // before it — the page included — with the list still open.
    const trigger = openWith('b')
    const delivered = fireEvent.keyDown(trigger, { key: 'Tab', shiftKey: true })
    expect(delivered).toBe(false)
    expect(screen.queryAllByRole('option').length).toBe(0)
    expect(document.activeElement).toBe(trigger)
  })

  it('NOTHING in an open list is marked for a focus ring, however the cursor got there', () => {
    // The list`s cursor is its own grey box. An attribute the stylesheet ringed
    // ([data-kbd-cursor]) once put a dark outline on the arrow-reached option of every frosted
    // list in the app, the top bar`s included.
    const trigger = openWith('a')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'End' })
    for (const option of options()) {
      expect(option.hasAttribute('data-kbd-cursor')).toBe(false)
      expect(option.matches(':focus')).toBe(false) // the trigger keeps the real focus
    }
    expect(options().filter(hasBox).length).toBe(1)
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
// A button answers Space with a click on the key's way UP, and not every browser drops that click
// because the key-down was handled: the list opened on the press and closed again on the release.
describe('Space on a list button acts on the way down, and only then', () => {
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('the key-up is swallowed, so no click follows it', () => {
    const trigger = openWith()
    fireEvent.click(trigger) // closed again, with the keyboard on its button
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.queryByRole('listbox')).not.toBeNull()
    expect(fireEvent.keyUp(trigger, { key: ' ' })).toBe(false) // default prevented
    expect(fireEvent.keyUp(trigger, { key: 'Enter' })).toBe(true) // only Space
  })
})

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
// POSITION (round 11). The option panel portals into #root as position:FIXED, so its
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
//   C. page still, the user swipes it              → closes, via the press-outside path (the
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
    // through momentum is the jitter round 11 removed; nothing re-armed it.)
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
    // ⚠ WHICH PATH: the press-outside rule (pointerdown, handed to the top open layer by
    // components/overlayStack). The finger lands outside the panel, on the page it is about to pan,
    // and that is simply a press outside an open popover — it closes there and then, before the
    // page has moved a pixel. No scroll event has been dispatched at this point, which is what
    // proves the path: there is no other one left.
    // (Opening the list put the keyboard on the trigger; a real press elsewhere takes it off again,
    // which jsdom's synthetic event does not do by itself.)
    act(() => trigger.blur())
    fireEvent.pointerDown(document.body)
    expect(optionCount()).toBe(0)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).not.toBe(trigger) // outside-tap semantics: no refocus
    // The other half of the same gesture, and the half that CHANGED on 2026-08-07: a swipe that
    // starts INSIDE the panel is not an outside press, so that listener declines it — and the page
    // it then pans no longer closes the menu either. It stays open, riding above the moving page,
    // still under its trigger in the fixed bar. That is the D sacrifice seen from the user's side.
    fireEvent.click(trigger)
    expect(optionCount()).toBe(3)
    fireEvent.pointerDown(panel())
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

// ── dropdownWidth + triggerMatchesDropdown ─────────────────────────────────────────────────
//
// Two opposite width behaviours the one shared component has to carry: the mode selector's trigger
// matches its own (unchanged) dropdown, while a preset list is exactly the width of its
// (space-filling) trigger. jsdom lays out nothing and reports every rect as 0, so what is pinned
// here is the WIRING — which style each prop produces — not the pixel result (that is verified in a
// real browser and recorded at src/main.tsx's budget block).
describe('CustomSelect — width props', () => {
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
    // …hung from the trigger's RIGHT edge.
    expect(panel().style.right).not.toBe('')
  })

  // THE TOP BAR'S WIDTH RULE (the owner's): a preset list is EXACTLY as wide as the control it
  // opens from — one column under it. Round 24 let the list grow to its longest name (pinned by
  // its left edge, floored at the trigger, capped at the screen), which let it reach over the Mode
  // button beside it; that is undone, and this is what holds it undone.
  const TRIGGER_RECT = {
    top: 40,
    bottom: 63,
    left: 100,
    right: 320,
    x: 100,
    y: 40,
    width: 220,
    height: 23,
    toJSON: () => ({}),
  }
  it("dropdownWidth='match-trigger': the panel is exactly the trigger's width, to the pixel", () => {
    // Mock the wrapper rect so the panel has a concrete width to take (jsdom's real rects are 0).
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(TRIGGER_RECT)
    mountBare({ dropdownWidth: 'match-trigger' })
    fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    expect(panel().style.width).toBe('220px')
    // Nothing that could make it any other width: no floor to grow from, no ceiling to grow to,
    // and no content sizing.
    expect(panel().style.minWidth).toBe('')
    expect(panel().style.maxWidth).toBe('')
    // Hung from the trigger's RIGHT edge like every list here, never pinned by its left to grow
    // rightward. With the trigger's own width, that puts its left edge on the trigger's too.
    expect(panel().style.right).not.toBe('')
    expect(panel().style.left).toBe('')
  })

  // ★ AN OPEN LIST FOLLOWS ITS TRIGGER'S BOX. A rotation (or any change of the fluid root font)
  // resizes the trigger in two steps: the window's `resize` event comes first, and the trigger
  // only settles afterwards — the Mode pill beside a preset pill takes its new least width from a
  // measurement of its own, and the preset pill fills what is left. The list was measured on the
  // event, against a trigger that had not finished moving, and kept that width for as long as it
  // stayed open (390×844 → 844×390: a 122px list under a 136px trigger). It watches the trigger's
  // box itself now.
  it('an open list follows its trigger`s box, whenever that settles — not just the window`s resize event', () => {
    const ro = installResizeObserver() // BEFORE mount: the observer is built as the list opens
    const frames = holdFrames(vi)
    try {
      let rect = TRIGGER_RECT
      rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect)
      const { container } = mountBare({ dropdownWidth: 'match-trigger' })
      fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
      expect(panel().style.width).toBe('220px')
      const wrapper = container.firstElementChild
      expect(ro.isObserved(wrapper)).toBe(true)
      // The screen is turned. The event fires while the trigger is still its old size…
      act(() => void window.dispatchEvent(new Event('resize')))
      expect(panel().style.width).toBe('220px')
      // …and then the trigger settles: narrower, and further left.
      rect = { ...TRIGGER_RECT, left: 60, x: 60, right: 196.25, width: 136.25 }
      act(() => ro.resize(wrapper))
      // ⚠ NOT FROM INSIDE THE OBSERVER'S CALLBACK. Resizing the list there changes boxes other
      // observers are watching, shallower in the page than the trigger — which the browser will not
      // go back for in that frame, and logs as a "ResizeObserver loop". The callback asks for one
      // frame, and the measurement is taken in it.
      expect(panel().style.width).toBe('220px')
      expect(frames.pending()).toBe(1)
      act(() => ro.resize(wrapper)) // (told twice in a frame, it still asks for only one)
      expect(frames.pending()).toBe(1)
      act(() => frames.at(16))
      expect(panel().style.width).toBe('136.25px')
      expect(panel().style.right).toBe(`${document.documentElement.clientWidth - 196.25}px`)
      // Closed, it stops watching — and a frame it had asked for is given up.
      act(() => ro.resize(wrapper))
      expect(frames.pending()).toBe(1)
      fireEvent.keyDown(screen.getByRole('button', { name: /^Test,/ }), { key: 'Escape' })
      expect(ro.isObserved(wrapper)).toBe(false)
      expect(frames.pending()).toBe(0)
    } finally {
      frames.restore()
      ro.restore()
    }
  })

  // ONE ROW SHAPE, IN EVERY LIST (the owner's ruling: no special treatment for the preset list).
  // A list the width of its trigger is still drawn with the ordinary row — the same box, the same
  // 14px ✓ column — as a list that sizes itself.
  it("a 'match-trigger' list draws the same row as a 'content' list", () => {
    const rowOf = (props) => {
      const { unmount } = mountBare(props)
      fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
      const row = screen.getAllByRole('option')[0]
      const shape = {
        box: row.className,
        check: row.children[0].getAttribute('style'),
        label: row.children[1].className,
      }
      unmount()
      document.getElementById('root').remove()
      return shape
    }
    const content = rowOf({})
    expect(rowOf({ dropdownWidth: 'match-trigger' })).toEqual(content)
    for (const c of ['text-[15px]', 'pl-4', 'pr-4', 'gap-2.5', 'flex']) {
      expect(content.box.split(/\s+/)).toContain(c)
    }
    expect(content.check).toContain('width: 14px')
  })

  // What a row of a closed list has room for has to be measurable (lib/presetNameWidth limits a
  // preset's name to it), so a 'match-trigger' select keeps a hidden copy of its list laid out at
  // the trigger's width.
  it("'match-trigger' keeps a hidden row gauge: the list's own rows, at the trigger's width", () => {
    const { container } = mountBare({ dropdownWidth: 'match-trigger' })
    // Closed: still zero options, zero listboxes — the gauge carries no role.
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.queryAllByRole('listbox')).toHaveLength(0)
    const gauge = container.querySelector('[data-select-row-gauge]')
    expect(gauge).not.toBeNull()
    expect(gauge.getAttribute('aria-hidden')).toBe('true')
    expect(gauge.style.visibility).toBe('hidden')
    expect(gauge.style.pointerEvents).toBe('none')
    // The trigger wrapper's width (it is the wrapper's child, out of flow), and no height of its
    // own for any scroller to count.
    expect(gauge.parentElement).toBe(container.firstElementChild)
    expect(gauge.style.position).toBe('absolute')
    expect(gauge.style.width).toBe('100%')
    expect(gauge.style.height).toBe('0px')
    expect(gauge.style.overflow).toBe('hidden')
    // The list's own inset, and one row per option…
    expect(gauge.className.split(/\s+/)).toContain('p-1')
    const gaugeRows = [...gauge.children]
    expect(gaugeRows).toHaveLength(OPTIONS.length)
    // …each boxed, and its ✓ lane sized, EXACTLY as a row of the open list is.
    fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    const liveRows = screen.getAllByRole('option')
    const boxOf = (row) => row.className.split(/\s+/).filter((c) => !/^(bg-|cs-)/.test(c))
    gaugeRows.forEach((row, i) => {
      expect(row.className.split(/\s+/)).toEqual(boxOf(liveRows[i]))
      expect(row.children).toHaveLength(2)
      expect(row.children[0].style.width).toBe(liveRows[i].children[0].style.width)
      expect(row.children[1].className).toBe(liveRows[i].children[1].className)
      expect(row.children[1].textContent).toBe(liveRows[i].children[1].textContent)
    })
  })

  // ★ `leastRowLabel` — THE ONE LEAST WIDTH A 'match-trigger' LIST HAS. A trigger that fills what
  // its row leaves it can be left almost nothing (the preset control on a narrow, tall phone), and
  // a list of exactly that width has rows with no room for a label at all. So the list is its
  // trigger's width OR the width one standard row needs to show this label whole, whichever is
  // more — and that width is MEASURED from a hidden row, never written down.
  describe("leastRowLabel: a 'match-trigger' list is never narrower than a row that shows it", () => {
    const LEAST = 91.3 // what the hidden least-row measures; the list takes it rounded UP
    const VIEW = 360
    const rectAt = (left, width) => ({
      top: 40,
      bottom: 63,
      left,
      right: left + width,
      x: left,
      y: 40,
      width,
      height: 23,
      toJSON: () => ({}),
    })
    // The trigger's wrapper at `left`, `width` wide; the least-row LEAST wide; nothing else laid out.
    const layOut = (left, width) => {
      rectSpy = vi
        .spyOn(Element.prototype, 'getBoundingClientRect')
        .mockImplementation(function () {
          return this.hasAttribute('data-select-least-row') ? rectAt(0, LEAST) : rectAt(left, width)
        })
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(VIEW)
    }
    const open = () => fireEvent.click(screen.getByRole('button', { name: /^Test,/ }))
    const least = (container) => container.querySelector('[data-select-least-row]')
    const gauge = (container) => container.querySelector('[data-select-row-gauge]')
    const edges = () => {
      const right = VIEW - parseFloat(panel().style.right)
      return { left: right - parseFloat(panel().style.width), right }
    }

    it('lays out ONE standard row holding the label, hidden, at its natural width', () => {
      const { container } = mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      const row = least(container)
      expect(row.getAttribute('aria-hidden')).toBe('true')
      expect(row.style.visibility).toBe('hidden')
      expect(row.style.pointerEvents).toBe('none')
      expect(row.style.position).toBe('absolute')
      expect(row.style.width).toBe('max-content')
      expect(row.style.height).toBe('0px')
      expect(row.style.overflow).toBe('hidden')
      // The list's own inset and the list's own row: the same box and cells as the gauge's rows.
      expect(row.className.split(/\s+/)).toContain('p-1')
      expect(row.children).toHaveLength(1)
      const standard = gauge(container).children[0]
      expect(row.children[0].className).toBe(standard.className)
      expect(row.children[0].children).toHaveLength(2)
      expect(row.children[0].children[0].style.width).toBe(standard.children[0].style.width)
      expect(row.children[0].children[1].className).toBe(standard.children[1].className)
      expect(row.children[0].children[1].textContent).toBe('P88')
      // No role, nothing for a screen reader, and no option added to the list.
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it('a trigger wider than the least: the list is the trigger, to the pixel, exactly as without it', () => {
      layOut(80, 220)
      mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      open()
      expect(panel().style.width).toBe('220px')
      expect(panel().style.right).toBe(`${VIEW - 300}px`)
      expect(panel().style.left).toBe('')
      expect(panel().style.minWidth).toBe('')
      expect(panel().style.maxWidth).toBe('')
    })

    it('a trigger narrower than the least: the list is the least, rounded up, from the trigger`s LEFT edge', () => {
      layOut(46, 35.5)
      mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      open()
      expect(panel().style.width).toBe('92px')
      expect(edges().left).toBeCloseTo(46, 6) // where the trigger starts
      expect(edges().right).toBeCloseTo(46 + 92, 6) // …and past its right edge (81.5)
    })

    it('the hidden row gauge is held to the same least, so it describes the row the list will draw', () => {
      layOut(46, 35.5)
      const { container } = mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      expect(gauge(container).style.width).toBe('100%') // the trigger's width, where that is more…
      expect(gauge(container).style.minWidth).toBe('92px') // …and never under the least
    })

    it('with no room to its right it grows leftwards: never nearer the screen`s edge than the trigger stands', () => {
      layOut(VIEW - 5 - 35.5, 35.5) // a narrow trigger 5px from the right edge
      mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      open()
      expect(panel().style.width).toBe('92px')
      expect(edges().right).toBeCloseTo(VIEW - 5, 6)
      expect(edges().left).toBeGreaterThan(0)
    })

    it('…and partly: it goes right as far as the trigger`s own left margin allows, then left', () => {
      layOut(VIEW - 30 - 35.5, 35.5) // 30px of room on the right, and the least needs 56.5 more
      mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      open()
      // min(left, right) of the trigger is 30 here, and the list would have to pass it: it stops there.
      expect(edges().right).toBeCloseTo(VIEW - 30, 6)
      expect(panel().style.width).toBe('92px')
    })

    it('follows the trigger: widened past the least, the list is the trigger again', () => {
      const rect = { left: 46, width: 35.5 }
      rectSpy = vi
        .spyOn(Element.prototype, 'getBoundingClientRect')
        .mockImplementation(function () {
          return this.hasAttribute('data-select-least-row')
            ? rectAt(0, LEAST)
            : rectAt(rect.left, rect.width)
        })
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(VIEW)
      mountBare({ dropdownWidth: 'match-trigger', leastRowLabel: 'P88' })
      open()
      expect(panel().style.width).toBe('92px')
      rect.width = 140
      act(() => void window.dispatchEvent(new Event('resize')))
      expect(panel().style.width).toBe('140px')
      expect(edges().left).toBeCloseTo(46, 6)
    })

    it('without it there is no least-row, and a narrow trigger still means a narrow list', () => {
      layOut(46, 35.5)
      const { container } = mountBare({ dropdownWidth: 'match-trigger' })
      expect(least(container)).toBeNull()
      expect(gauge(container).style.minWidth).toBe('0px')
      open()
      expect(panel().style.width).toBe('35.5px')
    })
  })

  it("a 'content' select has no row gauge — its list sizes itself", () => {
    const { container } = mountBare({ triggerMatchesDropdown: true })
    expect(container.querySelector('[data-select-row-gauge]')).toBeNull()
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ROUND 23 — A LONG LIST, AND A TRIGGER INSIDE A SCROLL REGION (the ⚙ panel's "Open in").
// Presets are unlimited, so the preset lists can be any length, and "Open in" is the first call site
// whose trigger a scroller could move. jsdom lays nothing out, so what is pinned here is the
// structure and the arithmetic; whether it LOOKS right is checked in a real browser and on device.
describe('CustomSelect — long lists, and a trigger inside a scroll region', () => {
  const MANY = Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `Preset ${i}` }))
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })
  const mountIn = (wrapper, props = {}) => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const r = render(
      <CustomSelect value="25" onChange={() => {}} options={MANY} ariaLabel="Test" {...props} />,
      wrapper ? { container: document.body.appendChild(wrapper) } : undefined,
    )
    return { ...r, trigger: screen.getByRole('button', { name: /^Test,/ }) }
  }
  const listRegion = () => screen.getByRole('listbox').querySelector('[data-drag-scroll]')

  it('the panel is capped to the room below it, and its options scroll in an inner region', () => {
    const { trigger } = mountIn()
    fireEvent.click(trigger)
    const panel = screen.getByRole('listbox')
    // (jsdom rewrites calc() expressions in its own way, so only the ingredients are asserted here;
    // the real browser's result is checked on screen.)
    expect(panel.style.maxHeight).toContain('100dvh')
    expect(panel.style.maxHeight).toContain('safe-area-inset-bottom')
    const region = listRegion()
    // The options live in the region (not in the frosted frame, which a fade mask would dissolve).
    expect(region.querySelectorAll('[role="option"]')).toHaveLength(30)
    expect(region.className).toMatch(/overflow-y-auto/)
    expect(region.className).toMatch(/overscroll-contain/)
    expect(panel.className).not.toMatch(/fade-scroll/)
  })

  it('opens with the SELECTED option centred in the region, not at the top of the list', () => {
    // Fabricated geometry: 40px options, a 200px region.
    const offsetTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get')
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    offsetTop.mockImplementation(function () {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this)
      return this.getAttribute('role') === 'option' ? i * 40 : 0
    })
    offsetHeight.mockImplementation(function () {
      return this.getAttribute('role') === 'option' ? 40 : 0
    })
    clientHeight.mockImplementation(function () {
      return this.hasAttribute('data-drag-scroll') ? 200 : 0
    })
    try {
      const { trigger } = mountIn()
      fireEvent.click(trigger)
      // Option 25 sits at 1000px; centred in 200px of region → scrollTop 1000 − 80 = 920.
      expect(listRegion().scrollTop).toBe(920)
      // The keyboard cursor pulls the region only as far as it must: Down from 25 to 26 (1040 …
      // 1080) needs the bottom edge at 1080, so scrollTop 880 already shows it — no move.
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      expect(listRegion().scrollTop).toBe(920)
      fireEvent.keyDown(trigger, { key: 'Home' }) // option 0 at the top → scrolled right up to it
      expect(listRegion().scrollTop).toBe(0)
      fireEvent.keyDown(trigger, { key: 'End' }) // option 29 (1160 … 1200) → its bottom at the edge
      expect(listRegion().scrollTop).toBe(1000)
    } finally {
      offsetTop.mockRestore()
      offsetHeight.mockRestore()
      clientHeight.mockRestore()
    }
  })

  // The region's edges are FADED (the app's shared recipe), so a cursor row stopped flush against an
  // edge sits inside the fade, half dissolved. The cursor is kept clear of it by the fade's own
  // depth — the same margin Lookup's history uses (components/scrollRegion's scrollBandIntoView).
  // jsdom serves no stylesheet, so the depth is given here the way index.css gives it: --fade-h.
  it('the keyboard cursor stops clear of the edge fades, not flush against the edge', () => {
    const offsetTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get')
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    offsetTop.mockImplementation(function () {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this)
      return this.getAttribute('role') === 'option' ? i * 40 : 0
    })
    offsetHeight.mockImplementation(function () {
      return this.getAttribute('role') === 'option' ? 40 : 0
    })
    clientHeight.mockImplementation(function () {
      return this.hasAttribute('data-drag-scroll') ? 200 : 0
    })
    document.documentElement.style.setProperty('--fade-h', '24px')
    try {
      const { trigger } = mountIn()
      fireEvent.click(trigger) // option 25 centred: scrollTop 920, the view is 920 … 1120
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // 26: 1040 … 1080, well inside
      expect(listRegion().scrollTop).toBe(920)
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // 27: 1080 … 1120 — flush with the bottom edge
      expect(listRegion().scrollTop).toBe(1120 + 24 - 200) // lifted clear of the bottom fade
      for (let i = 0; i < 4; i++) fireEvent.keyDown(trigger, { key: 'ArrowUp' }) // back up to 23
      // 23: 920 … 960. The view is 944 … 1144, so it is cut by the top edge → 24px of clearance.
      expect(listRegion().scrollTop).toBe(920 - 24)
    } finally {
      document.documentElement.style.removeProperty('--fade-h')
      offsetTop.mockRestore()
      offsetHeight.mockRestore()
      clientHeight.mockRestore()
    }
  })

  // ★ THE CALLER CONTRACT'S SECOND ROUTE: a trigger inside a scroll region holds that region still
  // for exactly as long as the menu is open, and hands back its own inline values afterwards.
  it('holds the scroll region around the trigger still while open, and lets it go on close', () => {
    const region = document.createElement('div')
    region.style.overflowY = 'auto'
    region.style.scrollbarGutter = ''
    const { trigger } = mountIn(region)
    expect(region.style.overflowY).toBe('auto')
    fireEvent.click(trigger)
    expect(region.style.overflowY).toBe('hidden')
    // jsdom has no scrollbars (offsetWidth === clientWidth), so there is no gutter to reserve.
    expect(region.style.scrollbarGutter).toBe('')
    fireEvent.click(trigger) // close
    expect(region.style.overflowY).toBe('auto')
    region.remove()
  })

  it('reserves the gutter when the region has a classic scrollbar, so nothing shifts sideways', () => {
    const region = document.createElement('div')
    region.style.overflowY = 'scroll'
    Object.defineProperty(region, 'offsetWidth', { configurable: true, value: 317 })
    Object.defineProperty(region, 'clientWidth', { configurable: true, value: 300 })
    const { trigger } = mountIn(region)
    fireEvent.click(trigger)
    expect(region.style.overflowY).toBe('hidden')
    expect(region.style.scrollbarGutter).toBe('stable')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(region.style.overflowY).toBe('scroll')
    expect(region.style.scrollbarGutter).toBe('')
    region.remove()
  })

  it('a trigger with no scroll region around it (the top bar) touches nothing', () => {
    const { trigger } = mountIn()
    const before = document.body.getAttribute('style')
    fireEvent.click(trigger)
    expect(document.body.getAttribute('style')).toBe(before)
  })

  // The dismissal ladder: one Escape closes the menu and NOTHING under it (the ⚙ panel's own Escape
  // is a document-level listener, which this press must never reach).
  it('Escape closes the menu and stops there — a document listener never hears it', () => {
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    try {
      const { trigger } = mountIn()
      fireEvent.click(trigger)
      fireEvent.keyDown(trigger, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(heard).not.toHaveBeenCalled()
      // Closed, an Escape on the trigger is not the menu's to keep: it reaches the document.
      fireEvent.keyDown(trigger, { key: 'Escape' })
      expect(heard).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', heard)
    }
  })
})

// ── A CLASSIC SCROLLBAR MUST NOT COST A ROW ITS WIDTH ────────────────────────────────────────────
// A desktop scrollbar takes its width out of the list's content box the moment the list is long
// enough to scroll — so every row was ~15px narrower in a long list than in a short one, and a name
// that fits a row (and that the hidden row gauge says fits) was cut. A phone's scrollbar is drawn
// OVER the rows' own right-hand padding and takes nothing. A classic one is given that same lane:
// the list measures its scrollbar, and the LABEL'S CELL in each row takes that much back out of
// the row's right-hand padding — so a name has the same room whether or not the list scrolls,
// while the row's own box (its highlight, with its round corners) stops short of the scrollbar.
// (The whole row was once made a scrollbar wider instead: the highlight ran on under the bar and
// lost both right-hand corners and its inset from the list's edge.)
// jsdom lays nothing out, so the scrollbar is stood up as the two numbers it is read from; that
// the name cell is then the same width with one preset as with twenty-five was measured in
// Chromium, with classic scrollbars, at phone and desktop width.
describe('CustomSelect — a classic scrollbar sits over the rows` own lane', () => {
  let bar = 0
  const stubs = []
  const standUpScrollbar = () => {
    const list = (el) => el.hasAttribute?.('data-drag-scroll')
    for (const [prop, of] of [
      ['offsetWidth', (el) => (list(el) ? 220 : 0)],
      ['clientWidth', (el) => (list(el) ? 220 - bar : 0)],
    ])
      stubs.push(
        vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function () {
          return of(this)
        }),
      )
  }
  afterEach(() => {
    stubs.splice(0).forEach((s) => s.mockRestore())
    bar = 0
    cleanup()
    document.getElementById('root')?.remove()
  })
  const list = () => document.querySelector('[role=listbox] [data-drag-scroll]')
  const barVar = () => list().style.getPropertyValue('--scrollbar-w')

  it('the list tells its rows how wide its scrollbar is, as it opens', () => {
    bar = 15
    standUpScrollbar()
    openWith('b')
    expect(barVar()).toBe('15px')
  })

  it('an overlay scrollbar, or a list too short to scroll, is no width at all', () => {
    standUpScrollbar()
    openWith('b')
    expect(barVar()).toBe('0px')
  })

  it('a row is exactly the list`s own box: its highlight ends clear of the scrollbar, corners and inset whole', () => {
    openWith('b')
    for (const row of options()) {
      const classes = row.className.split(/\s+/)
      expect(classes).toContain('w-full')
      expect(classes).toContain('rounded-xl')
      // Nothing makes the row's box any wider than the list gives it.
      expect(classes.filter((c) => c.includes('--scrollbar-w'))).toEqual([])
    }
    expect(list().className.split(/\s+/)).toContain('p-1') // the inset the highlight keeps
  })

  it('the label`s cell takes the scrollbar`s width back, so a name has the same room in a list that scrolls', () => {
    openWith('b')
    for (const row of options()) {
      const [tick, cell, ...rest] = row.children
      expect(rest).toEqual([])
      expect(tick.className).not.toContain('--scrollbar-w')
      expect(cell.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['min-w-0', 'flex-1', 'mr-[calc(-1_*_var(--scrollbar-w,0px))]']),
      )
    }
  })

  it('a sideways overhang is still never scrolled to', () => {
    openWith('b')
    expect(list().className.split(/\s+/)).toContain('overflow-x-hidden')
  })

  it('a window that changes size under an open list is measured again', () => {
    standUpScrollbar()
    openWith('b')
    expect(barVar()).toBe('0px')
    bar = 17 // shorter now: the list scrolls, and its scrollbar has arrived
    act(() => void window.dispatchEvent(new Event('resize')))
    expect(barVar()).toBe('17px')
  })
})
