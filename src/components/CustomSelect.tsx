import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from './overlayStack.js'
import {
  SCROLLER_CORE_CLASS,
  holdScrollRegion,
  scrollFadeClass,
  useScrollEdgeState,
} from './scrollRegion.js'

// CustomSelect — the app's custom dropdown, replacing the native <select>.
//
// Renders a trigger button; when open, the option list is PORTALED to #root so
// it escapes any clipping/overflow ancestor (e.g. the scrollable Settings
// popover) and floats over the page, positioned FIXED against the viewport.
// Full listbox keyboard support (↑/↓/Home/End/Enter/Esc/Tab) and a
// press-outside-to-close handler that correctly treats taps inside the portaled
// panel (and on native scrollbars) as "inside".
//
// AN OPEN LIST IS A LAYER in the app's stack of open things (components/overlayStack), which is
// where Escape, Android Back and a press outside are decided: each closes the TOP layer only. So
// with the ⚙ panel's "Open in" list open, one Escape or one tap outside closes the list and leaves
// the panel, and a second closes the panel.
//
// ⚠ CALLER CONTRACT (Q8, round 11; widened by Q8, round 23) — THE TRIGGER MUST NOT MOVE WHILE THE
// PANEL IS OPEN. The panel is position:fixed and is measured from the trigger's viewport rect on
// open; nothing re-measures it while a scroller moves, by design — re-measuring mid-scroll is
// exactly what produced the momentum jitter round 11's Q8 removed, and a general "reposition on any
// scroll" branch must not come back on spec. There are two ways a call site meets the contract:
//   • ITS TRIGGER LIVES IN FIXED CHROME, which no scroller can move — the top bar's mode selector
//     and preset switcher.
//   • ITS TRIGGER LIVES INSIDE A SCROLL REGION, AND THIS COMPONENT HOLDS THAT REGION STILL for as
//     long as the panel is open (components/scrollRegion's holdScrollRegion) — the ⚙ panel's
//     "Open in" (round 23, Q8), the first call site of this kind, written and tested against that
//     real case as this paragraph used to require of whoever came first. Holding the region still
//     was chosen over following the trigger for three reasons: it cannot jitter, because nothing is
//     re-measured; it stops an iOS momentum glide that was already running when the menu opened (a
//     tap does reach a trigger on an INNER scroller that is still coasting — see the round-13 note
//     below — and following that glide is exactly the per-frame re-measure refused above); and it
//     keeps the trigger from sliding out from under its own panel and behind the region's clipped
//     edge, which following it could not prevent.
//
// ⚠ IT ALSO DEPENDS ON html / body / #root DECLARING NO CONTAINING BLOCK. A transform, filter,
// backdrop-filter, will-change, contain or perspective on any of those three would turn the
// "viewport" this panel is fixed to into a scrolling box and silently bring the drift back.
// tests/containingBlockGuard.test.js fails the build if one ever appears.
//
// ⚠ DISMISS RULE — A SCROLL DOES NOT CLOSE THIS MENU, and that is a decision, not an omission
// (owner's call, 2026-08-07). What closes it: choosing an option, a touch/mouse press OUTSIDE it,
// Escape, Tab, and Android Back. A scroll of any kind does nothing at all.
//
// WHY, because two shipped designs died proving it. The old rule closed on a scroll the user
// STARTED while the menu was open, but not on one that was already gliding when it opened — a
// distinction that has to be drawn from the timing of scroll events, and iOS will not support one.
// Two mechanisms (a `scrollend` boundary, then a measured gap between scroll events) each passed in
// Chromium and each FAILED on the owner's iPhone. The root cause of the harder half was never a
// timing bug at all: WebKit SUPPRESSES the entire touch sequence of a tap that interrupts momentum
// deceleration (UIKitUtilities' _wk_isInterruptingDeceleration — no touchstart, no pointerdown, no
// click), deliberately, since ~2017, with no `touch-action` opt-out. That is the iOS convention
// every native app follows: the first tap stops the page, the second one opens the menu.
// Given that, the owner chose to give up scroll-dismissal outright rather than keep a rule that can
// only be approximated. It costs nothing visually: the trigger lives in the FIXED top bar (the
// caller contract above), so a page scrolling under an open panel leaves the panel exactly where it
// belongs — glued under its own trigger — instead of drifting away from it.
// tests/customselect pins the non-dismissal; tests/scrollEndGuard keeps the `scrollend` route shut.
//
// ⚠ THE SUPPRESSION IS ABOUT THE MAIN SCROLL VIEW, NOT ABOUT TAPS — a correction round 13 earned,
// and the reason that round happened. The paragraph above used to end "so a tap on a coasting page
// cannot open this menu on ANY design", and the owner disproved it on his own device, unprompted,
// by comparing the guide against the app's inner scrollers: fling an INNER scroll region, lift, and
// press this trigger while it is still coasting, and the menu opens first try while the region
// finishes gliding. _wk_isInterruptingDeceleration guards the WKWebView's own main scroll view; an
// overflow:auto box coasting under a position:fixed bar is not it. How to Play was the app's only
// screen scrolling the document, which is why it was the only screen this bit — and it now scrolls
// the same inner container as everything else (src/main.tsx, `switchMode`). What survives untouched
// is the dismiss rule itself: it was the right call for its own reasons, and re-deriving a timing
// rule on top of a platform that never needed one is not on the table.
//
// The panel always opens DOWNWARD. The auto-flip-up branch was deleted in round 11 (Q8): at the
// only call site the space above is structurally negative (measured −45px against a 325px panel —
// the trigger is IN the bar the flip measured its ceiling from), so the branch could not run, and
// once the panel is fixed its `bottom` offset would have had to be re-derived against a different
// box — an untestable edit to unreachable code. A future call site that genuinely needs to flip
// should have it written against that case.
//
// ⚠ STABILITY NOTE: the portal positioning (measurePanel) was tuned against iOS Safari over
// several attempts and is QA-confirmed working. It looks like ordinary geometry but is
// device-sensitive — ALWAYS re-verify on iPhone Safari (browser + PWA) after editing anything here.
//
// Props: value, onChange, options [{value,label}], className (trigger), ariaLabel,
// wrapperRef (forwarded to the wrapper so callers can treat it like the old <select>
// ref), showChevron, and pressDrag (press-drag-select, documented at the prop below).
//
// Extracted from main.jsx in Stage C, Step 4d (verbatim; the only change is
// ReactDOM.createPortal → the directly-imported createPortal — same function).

export interface CustomSelectOption {
  value: string
  label: ReactNode
}
// Measured coordinates for the portaled panel, in VIEWPORT space. The panel is position:fixed, so
// its containing block IS the viewport and a getBoundingClientRect reading needs no conversion:
// right edge pinned to the trigger's, top 6px below it.
interface PanelPos {
  right: number
  top: number
  // The trigger wrapper's own rendered width at the moment the panel opened. Only consumed when
  // dropdownWidth === 'match-trigger' (the preset switcher), where the panel is sized to the
  // space-filling trigger instead of to its widest option; 'content' (the default, the mode
  // selector) ignores it and the panel stays width:max-content exactly as before.
  width: number
}

// The box metrics of ONE dropdown option row, shared by the real portaled rows and the hidden
// width-mirror that triggerMatchesDropdown renders. The two MUST stay byte-identical here: the
// mirror's only job is to report the panel's real rendered width back to the trigger, and it can
// only do that honestly if its rows are padded, gapped and text-sized exactly like the live ones.
// (Everything width-relevant lives in this string; the real row adds only the active/press visual
// state, which changes no dimension.)
const OPTION_ROW_BOX =
  'w-full text-left rounded-xl pl-4 pr-4 py-3 text-[15px] flex items-center gap-2.5'
// What joins the option VALUES into the one string an effect can depend on (the options array
// itself is a new object every render). A value is a mode id or a preset number — never free text
// — so a separator only has to be a character no value contains, and it is written as a visible
// escape rather than as the raw control character, which is invisible in an editor and makes git
// and grep treat the whole file as binary.
const OPTION_VALUE_SEPARATOR = '\u001f'
export default function CustomSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel,
  wrapperRef,
  showChevron = false,
  pressDrag = false,
  dropdownWidth = 'content',
  triggerMatchesDropdown = false,
}: {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  className?: string
  ariaLabel?: string
  wrapperRef?: RefObject<HTMLDivElement | null>
  showChevron?: boolean
  // Q10: how the PORTALED PANEL is sized. 'content' (default) — width:max-content, the panel is as
  // wide as its widest option; this is the mode selector, and it must stay this way (its dropdown's
  // rendered width is not allowed to change). 'match-trigger' — the panel takes the trigger
  // wrapper's live rendered width instead (measured on open, re-measured on resize / visualViewport
  // / --bar-h, same as the panel position); this is the preset switcher, whose trigger already
  // fills the row's leftover space (main.tsx: flex-1 min-w-0), so the menu now fills it too rather
  // than shrink-wrapping to the widest preset name. maxWidth:90vw stays as a clamp for both.
  dropdownWidth?: 'content' | 'match-trigger'
  // Q10: widen the trigger BUTTON to exactly its own dropdown's outer width, WITHOUT changing the
  // dropdown. The mode selector wants this: its dropdown rows use a bigger text tier and more
  // padding than the trigger, so "both size to content" would never make them equal. A hidden
  // mirror of the panel (rendered below, out of flow, aria-hidden) is measured and its width
  // applied as the trigger's min-width — the same "compute the dropdown's natural width once and
  // pin the trigger to it" the panel already does for its own position. The preset switcher does
  // NOT set this: its trigger sizing (w-full, filling flex-1) is owned by main.tsx's row.
  triggerMatchesDropdown?: boolean
  // Q5: enable press-drag-select (the mode selector). The trigger toggles on POINTERDOWN (so a press can
  // drag straight into the just-opened menu and release on an option to pick it — handled by the global
  // pointer controller, lib/pointerGestures: the data-select-trigger marker starts the gesture and the
  // trigger's aria-controls={listboxId} pairs it with the portaled listbox, resolved live by id);
  // its click is suppressed there to avoid a double-toggle. A quick tap still toggles; keyboard (the Tab
  // shortcut's .click(), arrows, Enter) is unaffected — those clicks have no preceding pointer gesture.
  pressDrag?: boolean
}) {
  const [open, setOpen] = useState(false)
  // activeIdx tracks the keyboard-highlighted option (≠ selected value). -1 when nothing is
  // highlighted (e.g. mouse-only interaction). Reset to selected option's index on open so
  // ↑/↓ start from the current value, not the top.
  const [activeIdx, setActiveIdx] = useState(-1)
  const localRef = useRef<HTMLDivElement>(null)
  const ref = wrapperRef || localRef
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Stable unique id for the listbox + its option ids (aria-controls /
  // aria-activedescendant). useId is React's blessed generator — it replaces the old
  // useRef(`...${Math.random()}`).current, which both called an impure function and
  // read a ref during render. Used only as opaque aria/id strings (never queried via a
  // CSS selector), so useId's separator characters are harmless here.
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`
  // ★★ THE TRIGGER'S ACCESSIBLE NAME IS THE LABEL *PLUS* THE VALUE, and it takes two ids because
  // an `aria-label` cannot express it. An aria-label REPLACES an element's content, so the trigger
  // used to wear one and announce "Mode, collapsed" / "Preset, collapsed" — the setting's name with
  // the selected option's text, the one thing a reader needs from a closed dropdown, silently
  // dropped. (The owner's requirement for the preset control's amnesic marker was explicit: an
  // indicator "with a real accessible name". Reading the preset control without its preset name
  // fails that on the enclosing control instead of on the marker.)
  //   WHY aria-labelledby RATHER THAN A COMPOSED STRING. Option labels are ReactNodes, not text —
  // the preset switcher's is a whole element tree carrying a truncating name cell and, for an
  // amnesic preset, an `sr-only` phrase that stands in for it. There is nothing to concatenate at
  // render time. Referencing the two NODES instead hands the name computation to the platform,
  // which walks the selected option's subtree and reads exactly what that option says of itself:
  // "Preset, Weekend, amnesic". The unselected options stacked in the same grid cell are `aria-hidden`, and a hidden
  // node that is not itself the referenced one contributes nothing to a name — which is what keeps
  // the other six modes out of it.
  //   ⚠ THE COMMA LIVES ON THE LABEL: the two referenced nodes' texts are trimmed and joined with
  // a space, so a separator has to be a printing character on one of them or there is none.
  const labelId = `${listboxId}-label`
  const valueId = `${listboxId}-value`
  const selectedIdx = options.findIndex((o) => o.value === value)
  // panelRef points at the PORTALED panel so the press-outside handler can
  // treat taps inside it as "inside" (the panel is no longer a DOM descendant
  // of the wrapper). panelPos holds the measured viewport coordinates for the
  // portal.
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null)
  // Q10 (triggerMatchesDropdown only): measureRef points at the hidden panel-mirror rendered below;
  // triggerMinWidth is its measured outer width, applied as the trigger's min-width so the trigger
  // ends up exactly as wide as the real dropdown. null until measured (and in jsdom, which reports
  // 0 for everything — the trigger then just keeps its natural width, which is all a layout-free
  // environment can mean by "match").
  const measureRef = useRef<HTMLDivElement>(null)
  const [triggerMinWidth, setTriggerMinWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    // No reset in the `false` branch: triggerMinWidth is only ever written when this is true, and
    // the style below is gated on `triggerMatchesDropdown` anyway — a stale value can't paint. (The
    // prop is fixed per call site in this app, so the branch is theoretical either way.)
    if (!triggerMatchesDropdown) return
    const sync = () => {
      const el = measureRef.current
      if (!el) return
      const w = el.getBoundingClientRect().width
      // > 0 guard: jsdom reports 0 for every rect, and a 0 min-width would be a no-op anyway. Only
      // a real layout engine ever gets past here.
      setTriggerMinWidth((prev) => (w > 0 && w !== prev ? w : prev))
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return
    // The mirror's own box changes size when the fluid root font-size does (index.css's clamp, on
    // any viewport resize) or if the option set changes — both are exactly what a ResizeObserver on
    // the mirror reports, so nothing else needs subscribing.
    const ro = new ResizeObserver(sync)
    if (measureRef.current) ro.observe(measureRef.current)
    return () => ro.disconnect()
    // options is a fresh array every render at the mode call site (MODE_LABELS is defined in App's
    // body); depend on a stable signature of it, not its identity, so this doesn't re-subscribe on
    // every render. The mirror re-renders with the new labels regardless, and the ResizeObserver
    // above catches any width change that causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerMatchesDropdown, options.map((o) => o.value).join(OPTION_VALUE_SEPARATOR)])
  // measurePanel reads the trigger's current viewport rect and writes panelPos: right edge
  // aligned to the trigger, 6px below it. Called on open, on resize / visualViewport change, and
  // when --bar-h moves the bar the trigger sits in — and on NOTHING else, in particular never on
  // a scroll (see the effect below).
  // Plain function (no useCallback): it reads ref.current, which a manual dep array can't
  // track at ref.current granularity — useCallback here trips preserve-manual-memoization.
  // The React Compiler memoizes this automatically, so the effect below can list
  // it as a dependency and the compiler keeps its identity stable (no listener re-subscribe).
  const measurePanel = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    // documentElement.clientWidth, NOT window.innerWidth: the CSS `right` offset resolves against
    // the containing block's right edge, and a fixed element's containing block — like
    // clientWidth, unlike innerWidth — EXCLUDES a classic document scrollbar. The bug that
    // established this was guide-mode-only: html[data-doc-scroll] let the DOCUMENT scroll, so
    // desktop Windows browsers put a classic scrollbar on it and innerWidth painted every dropdown
    // one scrollbar-width LEFT of its trigger on the How-to-Play page (overlay-scrollbar platforms
    // were unaffected). Round 13 took the document scroller away, so no mode can show that
    // scrollbar any more and the two reads are equal everywhere today — the app's one scrollbar
    // lives INSIDE #appScroll, which is the bar's sibling and shrinks neither the viewport nor the
    // bar. The clientWidth read stays because it is the containing block's own width BY DEFINITION,
    // which is what this arithmetic needs; innerWidth agreeing with it is a fact about the current
    // layout, not a reason to depend on it.
    // Round 10's sub-pixel sweep (--bar-h, GuidePage's panel heights) deliberately left this
    // read alone: same rounding class, but horizontal, worth ≤0.5px, and sitting on the
    // iOS-QA'd portal geometry path. Nothing here stacks against a hairline border.
    const right = document.documentElement.clientWidth - rect.right
    // NO scroll term, by construction. The panel is position:fixed, so a getBoundingClientRect
    // reading — already viewport-relative — IS its containing-block coordinate, at every scroll
    // offset and in both modes. Round 4 added a ± window.scrollY here to cancel a drift that
    // existed only because the panel was position:absolute while guide mode makes #root static,
    // moving its containing block from the viewport to the document; Q8 removed the cause instead
    // of the symptom. Measured both ways: the absolute panel drifted 1:1 with the page (−394px at
    // 400 scrolled, −1494px at 1500) and needed a reposition per scroll event, while the fixed one
    // holds its exact 6px gap at every offset with ZERO reposition calls — and app mode is
    // pixel-identical either way, since scrollY was always 0 there.
    setPanelPos({ right, top: rect.bottom + 6, width: rect.width })
  }
  // Toggle handler. On the way OPEN it measures where the panel goes — the one thing that can only
  // be decided at that instant. Measurement only happens on open (close is cheap).
  // ★ AND IT PUTS THE KEYBOARD ON THE TRIGGER. The open list is driven from the trigger — ↑/↓,
  // Home/End, Enter and Tab are its onKeyDown, and aria-activedescendant only speaks for an element
  // that has focus — and a press does not put it there on every engine: Safari and Firefox on a Mac
  // do not focus a button that is clicked, and neither does a tap. Without this the list opened
  // with its keys dead, and a screen reader was never told which option the cursor was on.
  const handleToggle = () => {
    if (!open) {
      measurePanel()
      triggerRef.current?.focus()
      // Do NOT pre-highlight the selected option on open. The grey "active" box is a
      // pointer/keyboard cursor, not an open-state indicator (the ✓ already marks the
      // selection). It appears only once the user hovers with a MOUSE or presses an arrow —
      // touch sends neither, so the box never shows on mobile. First ↑/↓ reveals it one step from the
      // selected option — Down just below the ✓, Up just above (see handleTriggerKeyDown).
      setActiveIdx(-1)
    }
    setOpen((v) => !v)
  }
  const closeAndFocus = () => {
    setOpen(false)
    setActiveIdx(-1)
    if (triggerRef.current) triggerRef.current.focus()
  }
  const selectAt = (i: number) => {
    if (i < 0 || i >= options.length) return
    onChange(options[i].value)
    closeAndFocus()
  }
  // Trigger keyboard handler — the open list's keys. (Escape is not here: closing the top layer is
  // components/overlayStack's, whichever element has focus.)
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        // First arrow      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        // First arrow (from the no-cursor -1 state) steps ONE option from the selected one — Down lands
        // just below the ✓, Up just above (owner's call 2026-06-06; previously the first arrow landed on
        // the selected option itself). Clamped at the ends; subsequent arrows keep moving.
        setActiveIdx((i) =>
          i < 0
            ? selectedIdx >= 0
              ? Math.min(options.length - 1, selectedIdx + 1)
              : 0
            : Math.min(options.length - 1, i + 1),
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) =>
          i < 0 ? (selectedIdx >= 0 ? Math.max(0, selectedIdx - 1) : 0) : Math.max(0, i - 1),
        )
      } else if (e.key === 'Home') {
        e.preventDefault()
        setActiveIdx(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setActiveIdx(options.length - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        selectAt(activeIdx >= 0 ? activeIdx : selectedIdx)
      } else if (e.key === ' ') {
        // Space is inert on the trigger (owner's call 2026-06-06) — see the closed-state note below.
        e.preventDefault()
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActiveIdx(-1)
      }
      return
    }
    // Closed: NO key opens the dropdown from the trigger — only the global Tab shortcut, or a mouse
    // click, opens it (owner's call 2026-06-06). The Tab shortcut leaves the trigger focused, and the
    // owner doesn't want a focused-but-invisible trigger to spring open on Enter/Space/arrows. Swallow
    // Enter + Space so the browser's default button activation can't open it either; arrows are simply
    // left alone. They used to fall through to scrolling the page, which was true only while the guide
    // scrolled the DOCUMENT — a focused trigger's nearest scrollable ancestor was the document itself.
    // Round 13 made #appScroll the one scroller and it is this bar's SIBLING, not its ancestor, so an
    // arrow press here now scrolls nothing. Not swallowed even so: preventDefault would claim a key
    // this control has no use for, and the app's own keydown handler already owns ←/→ (the date
    // stepper). (Once open, ↑/↓ navigate, Enter selects, Esc/Tab close — branch above.)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
    }
  }
  // ★ THE OPEN LIST'S ENTRY IN THE APP'S STACK (components/overlayStack). listboxId is a stable
  // per-instance useId, so every select registers distinctly.
  //   • ESCAPE AND ANDROID BACK close it and hand the keyboard back to the trigger — and close ONLY
  //     it: a list opened inside the ⚙ panel sits above the panel in the stack, so the press is
  //     spent here and the panel stays.
  //   • A PRESS OUTSIDE closes it, and the stack hands the press to this list alone while it is the
  //     top layer — so the same tap is never also read by the ⚙ panel as a press outside the panel.
  //     "Outside" is neither the wrapper nor the panel:
  const pressOutside = (e: PointerEvent) => {
    const target = e.target as Element | null
    if (!ref.current || ref.current.contains(target)) return
    // The panel is portaled out of the wrapper, so a tap on an option is NOT contained by
    // ref.current — without this the press would close the dropdown before the option's click
    // (the selection) fired.
    if (panelRef.current && panelRef.current.contains(target)) return
    // Ignore a press that landed in a scrollbar (Windows native scrollbars report the press on the
    // scrolling element itself). Without this, dragging the Settings popover's scrollbar while a
    // dropdown inside it is open closes the dropdown.
    if (target && target.nodeType === 1) {
      const r = target.getBoundingClientRect()
      if (target.scrollHeight > target.clientHeight && e.clientX > r.left + target.clientWidth)
        return
      if (target.scrollWidth > target.clientWidth && e.clientY > r.top + target.clientHeight) return
    }
    setOpen(false)
  }
  useLayer(open, closeAndFocus, listboxId, pressOutside)
  // While open: what RE-MEASURES the panel — and that is now this effect's whole job. Nothing here
  // dismisses (see the dismiss-rule note on the component), and NO SCROLL OF ANY KIND IS SUBSCRIBED
  // TO, which is the point twice over: dismissal is gone, and re-measuring per scroll event through
  // momentum is the jitter round 5 chased and Q8 deleted. The panel does not need it — it is
  // position:fixed under a trigger that lives in fixed chrome, so a moving page moves neither.
  //
  // The three things that DO move the trigger, none of them a page scroll: window resize
  // (rotation); the visualViewport, whose own resize/scroll report iOS moving the VISUAL viewport
  // independently of the layout viewport a fixed element lives in (pinch-zoom pan, the URL bar
  // collapsing) — a different box from the one a page scroll moves; and --bar-h, the trigger's own
  // chrome — main.tsx publishes the fixed bar's measured height there (syncBarHeight, its single
  // writer), so a change to it means the bar resized and the trigger moved, with no resize event to
  // announce it (a font swap, a safe-area shift). The value is compared, not just watched, so the
  // other inline write on <html> (the theme background) costs nothing.
  useEffect(() => {
    if (!open) return
    const reposition = () => measurePanel()
    window.addEventListener('resize', reposition)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', reposition)
      vv.addEventListener('scroll', reposition)
    }
    const readBarH = () => getComputedStyle(document.documentElement).getPropertyValue('--bar-h')
    let lastBarH = readBarH()
    const barObserver = new MutationObserver(() => {
      const next = readBarH()
      if (next === lastBarH) return
      lastBarH = next
      reposition()
    })
    barObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => {
      window.removeEventListener('resize', reposition)
      if (vv) {
        vv.removeEventListener('resize', reposition)
        vv.removeEventListener('scroll', reposition)
      }
      barObserver.disconnect()
    }
    // Depend on [open] alone. measurePanel closes over nothing render-specific (only the stable
    // ref/setPanelPos), so calling a "stale" copy is behavior-identical; listing it would just
    // re-subscribe the listeners every render. useCallback isn't an option here — it reads
    // ref.current, which trips preserve-manual-memoization. The React Compiler memoizes
    // measurePanel automatically, making this exactly correct at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // ★ HOLD THE TRIGGER'S SCROLL REGION STILL WHILE THE PANEL IS OPEN — the second way to meet the
  // caller contract at the top of this file; components/scrollRegion's holdScrollRegion does the
  // work and argues the method. For the top bar's two selects there is no scroll region
  // around the trigger and it does nothing at all. A layout effect, so the hold is in place in the
  // same frame the panel first paints.
  useLayoutEffect(() => {
    if (!open) return
    return holdScrollRegion(ref.current)
    // The ancestor chain is fixed for a mounted select; `open` is the whole trigger for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // ★ A LONG LIST SCROLLS INSIDE THE PANEL (round 23, Q8 — presets are unlimited, so the preset
  // lists can be any length). The panel is capped at the space between its top and the bottom of
  // the viewable area (the maxHeight on the panel below), and its OPTIONS scroll in an inner region
  // (`listRef`) — inner so that the region's edge fades (the app's shared recipe,
  // components/scrollRegion) mask only the options, never the panel's frosted glass, which a mask
  // on the panel itself would dissolve at the edges. Two things keep the right option in view:
  //   • ON OPEN, THE SELECTED OPTION IS CENTRED in the region, so a list opened on its 25th entry
  //     shows the ✓ rather than the top of the list;
  //   • AS THE KEYBOARD CURSOR MOVES, the active option is scrolled just far enough to be whole.
  // Both are plain scrollTop arithmetic on the region, NOT scrollIntoView: scrollIntoView scrolls
  // every scrollable ancestor too, and this panel is portaled into #root — the call could scroll
  // #root or the page behind a fixed menu. The options are measured by offsetTop against the region
  // (it is `relative`, so it is their offsetParent). In a list short enough to fit, both are no-ops:
  // the browser clamps scrollTop to what the region can actually scroll.
  const listRef = useRef<HTMLDivElement>(null)
  const panelShown = open && panelPos !== null
  const { scrolledFromTop, atBottom } = useScrollEdgeState(listRef, panelShown)
  useLayoutEffect(() => {
    if (!panelShown) return
    const list = listRef.current
    const opt = selectedIdx >= 0 ? list?.children[selectedIdx] : null
    if (!list || !(opt instanceof HTMLElement)) return
    list.scrollTop = opt.offsetTop - (list.clientHeight - opt.offsetHeight) / 2
    // On OPEN only: a later re-measure (rotation, --bar-h) must not yank the list back to the ✓.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelShown])
  useLayoutEffect(() => {
    if (!panelShown || activeIdx < 0) return
    const list = listRef.current
    const opt = list?.children[activeIdx]
    if (!list || !(opt instanceof HTMLElement)) return
    if (opt.offsetTop < list.scrollTop) list.scrollTop = opt.offsetTop
    else if (opt.offsetTop + opt.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = opt.offsetTop + opt.offsetHeight - list.clientHeight
  }, [panelShown, activeIdx])
  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        onPointerDown={
          pressDrag
            ? (e) => {
                // Mirror the pointer controller's latch (Q5 rework): only the primary pointer's
                // left/first contact toggles — a second finger or a right-click must not flip the
                // menu mid-gesture.
                if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
                handleToggle()
              }
            : undefined
        }
        onKeyDown={handleTriggerKeyDown}
        data-select-trigger={pressDrag || undefined}
        className={className}
        // Q10: pin the trigger to its dropdown's measured outer width (triggerMatchesDropdown). Both
        // this button and the mirror are border-box, so the mirror's rect width IS the min-width the
        // trigger needs; its natural content is narrower, so it settles at exactly that.
        style={
          triggerMatchesDropdown && triggerMinWidth != null
            ? { minWidth: `${triggerMinWidth}px` }
            : undefined
        }
        // Label + value (see the two ids above). With no `ariaLabel` there is nothing to compose,
        // so the trigger falls back to naming itself from its own content — the selected option —
        // which is the correct answer for a caller that never named the control.
        aria-labelledby={ariaLabel ? `${labelId} ${valueId}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIdx >= 0 ? optionId(activeIdx) : undefined}
      >
        {ariaLabel && (
          <span id={labelId} className="sr-only">
            {ariaLabel},
          </span>
        )}
        <span id={valueId} className="grid items-center">
          {options.map((o) => (
            <span
              key={o.value}
              className={`col-start-1 row-start-1 truncate text-left ${o.value === value ? '' : 'invisible'}`}
              aria-hidden={o.value !== value}
            >
              {o.label}
            </span>
          ))}
        </span>
      </button>
      {/* Q10: the hidden width-mirror (triggerMatchesDropdown only). A faithful, out-of-flow copy
          of the portaled panel — same p-1, same OPTION_ROW_BOX rows, same width:max-content /
          maxWidth:90vw — so its rendered outer width equals the real dropdown's. It carries no
          role and is aria-hidden + visibility:hidden + pointer-events:none, so it is invisible to
          the user, to assistive tech, and to the suite's role queries (closed === zero options
          stays true). position:absolute keeps it out of the row's flex flow and off --bar-h. */}
      {triggerMatchesDropdown && (
        <div
          ref={measureRef}
          aria-hidden="true"
          className="p-1"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            zIndex: -1,
            width: 'max-content',
            maxWidth: '90vw',
          }}
        >
          {options.map((opt) => (
            <div
              key={`w-${opt.value}`}
              className={OPTION_ROW_BOX}
              style={{ color: '#1a1a1a', whiteSpace: 'nowrap' }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  color: '#1a1a1a',
                  fontSize: '1em',
                }}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">{opt.label}</span>
            </div>
          ))}
        </div>
      )}
      {showChevron && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center leading-none text-[7px] text-(--tx-w90)">
          <span>▲</span>
          <span>▼</span>
        </div>
      )}
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            data-select-group={pressDrag || undefined}
            aria-label={ariaLabel}
            // The options' scroll region inside carries the p-1 (below); this box is the frosted
            // frame, a flex column so that region can shrink to the maxHeight and scroll.
            className="rounded-2xl overflow-hidden flex flex-col"
            // position:FIXED (Q8, round 11) — the panel is pinned to the viewport, not to whatever
            // #root's positioning happens to make its containing block. #root is fixed in app mode
            // and static in guide mode, which is what made the same absolute panel obey two
            // different origins; fixed answers to the viewport in both, so the measurement above
            // needs no mode-dependent correction and the panel cannot drift with the page. It also
            // means #root's overflow:hidden no longer clips it (a fixed element's containing block
            // is above #root) — harmless here, since the panel is sized to sit on screen.
            style={{
              position: 'fixed',
              right: panelPos.right,
              top: panelPos.top,
              zIndex: 60,
              background: 'rgba(245,245,247,0.50)',
              WebkitBackdropFilter: 'blur(28px) saturate(120%)',
              backdropFilter: 'blur(28px) saturate(120%)',
              boxShadow: '0 6px 28px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.05)',
              // Q10: 'content' (mode selector, default) keeps the historical max-content sizing
              // untouched; 'match-trigger' (preset switcher) takes the trigger wrapper's live
              // width measured in measurePanel, so the menu fills the same row space the trigger
              // does. The 90vw clamp applies to both.
              width: dropdownWidth === 'match-trigger' ? `${panelPos.width}px` : 'max-content',
              maxWidth: '90vw',
              // Round 23 (Q8): never taller than the room between the panel's top and the bottom of
              // the viewable area, less the same 1rem cushion (and bottom safe area) the ⚙ panel
              // keeps — a longer list scrolls inside (listRef, above). CSS rather than a measured
              // number, so it stays true as the viewport changes without a re-measure.
              maxHeight: `calc(100dvh - ${panelPos.top}px - 1rem - env(safe-area-inset-bottom))`,
            }}
          >
            {/* THE OPTIONS' SCROLL REGION. p-1 + the options' rounded-xl keep the drag-ring
                CONCENTRIC: the 12px inner radius plus the 4px inset sits inside the panel's 16px
                outer radius, so the ring is never clipped and all four corners of the first/last
                options stay round. data-drag-scroll makes it lib/pointerGestures' auto-scroll target,
                so a press-drag down a long top-bar list scrolls it at the edge the way the ⚙ panel
                does. SCROLLER_CORE_CLASS (components/scrollRegion, which says why this list takes no lane)
                includes overscroll-contain, so a fling that hits the end does not scroll the page. */}
            <div
              ref={listRef}
              data-drag-scroll
              className={`relative min-h-0 ${SCROLLER_CORE_CLASS} p-1 ${scrollFadeClass(scrolledFromTop, atBottom)}`}
            >
              {options.map((opt, i) => (
                <button
                  id={optionId(i)}
                  role="option"
                  aria-selected={opt.value === value}
                  key={opt.value}
                  type="button"
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setActiveIdx(i)
                  }}
                  onClick={() => {
                    onChange(opt.value)
                    closeAndFocus()
                  }}
                  className={`${OPTION_ROW_BOX} ${i === activeIdx ? 'bg-black/10' : 'cs-option-press'}`}
                  style={{ color: '#1a1a1a', whiteSpace: 'nowrap' }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      // The reserved check column stays a fixed 14px so row indents never shift,
                      // but the ✓ glyph scales WITH the row's text tier (1em, so ~15px today) —
                      // a hardcoded 14px check would read wrong the moment the tier moves.
                      width: '14px',
                      color: '#1a1a1a',
                      fontSize: '1em',
                    }}
                  >
                    {opt.value === value ? '✓' : ''}
                  </span>
                  {/* min-w-0 flex-1 — Q6, added for the preset switcher's flexible name cell, and
                    harmless for every other caller (the mode selector's plain-text labels draw
                    identically inside a wider invisible box). This span is a FLEX ITEM of the row
                    above (blockified by being a direct child of `flex items-center gap-2.5`), so
                    without flex-1 it stays content-sized — which is exactly right for a caller
                    whose label is plain text, and exactly wrong for one whose label is a cell that
                    needs to fill the row so its OWN children can fill IT in turn. `min-w-0` is the
                    same "let a truncating child shrink" fix as the trigger's own wrapper: without
                    it a flex item's content-based minimum can refuse to shrink at all.
                    ⚠ EVERY ROW GETS THE SAME TREATMENT, which is what keeps a caller's per-row
                    markers (components/PresetSwitcher's amnesic "A") in a COLUMN: every option
                    button is the same width (`w-full` of one shared panel), so flex-1 stretches
                    every row's label cell to that same shared width regardless of that row's own
                    text length — a hardcoded per-row width is no longer what aligns them. */}
                  <span className="min-w-0 flex-1">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>,
          // #root is the app's mount node — always present once the app has rendered.
          document.getElementById('root')!,
        )}
    </div>
  )
}
