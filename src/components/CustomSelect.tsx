import { useState, useRef, useEffect, useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useBackButton } from './useBackButton.js'

// CustomSelect — the app's custom dropdown, replacing the native <select>.
//
// Renders a trigger button; when open, the option list is PORTALED to #root so
// it escapes any clipping/overflow ancestor (e.g. the scrollable Settings
// popover) and floats over the page, positioned FIXED against the viewport.
// Full listbox keyboard support (↑/↓/Home/End/Enter/Space/Esc/Tab) and a
// click-outside-to-close handler that correctly treats taps inside the portaled
// panel (and on native scrollbars) as "inside".
//
// ⚠ CALLER CONTRACT (Q8, round 11) — THE TRIGGER MUST LIVE IN FIXED CHROME. The panel is
// position:fixed and is measured from the trigger's viewport rect on open; nothing re-measures it
// while a scroller moves, by design. The app's one call site is the mode selector in the fixed top
// bar, which no scroller can move. A future call site inside a SCROLLING region needs repositioning
// WRITTEN AND TESTED against that real case — do not assume it, and do not restore a general
// "reposition on any scroll" branch on spec: this component had one, it was provably unexercisable
// (one live instance, trigger in fixed chrome), and re-measuring mid-scroll is exactly what
// produced the momentum jitter Q8 removed.
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
}
export default function CustomSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel,
  wrapperRef,
  showChevron = false,
  pressDrag = false,
}: {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  className?: string
  ariaLabel?: string
  wrapperRef?: RefObject<HTMLDivElement | null>
  showChevron?: boolean
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
  // the preset switcher's is a whole element tree carrying a truncating name cell and an `sr-only`
  // ", amnesic" sibling. There is nothing to concatenate at render time. Referencing the two NODES
  // instead hands the name computation to the platform, which walks the selected option's subtree
  // and reads exactly what a sighted user sees plus what the sr-only text adds: "Preset, Weekend,
  // amnesic". The unselected options stacked in the same grid cell are `aria-hidden`, and a hidden
  // node that is not itself the referenced one contributes nothing to a name — which is what keeps
  // the other six modes out of it.
  //   ⚠ THE COMMA LIVES ON THE LABEL, for the same reason PresetSwitcher's marker puts one on
  // ", amnesic": the name-from-content algorithm TRIMS each referenced node's text before joining
  // them with a space, so a separator has to be a printing character or there is none.
  const labelId = `${listboxId}-label`
  const valueId = `${listboxId}-value`
  const selectedIdx = options.findIndex((o) => o.value === value)
  // panelRef points at the PORTALED panel so the click-outside handler can
  // treat taps inside it as "inside" (the panel is no longer a DOM descendant
  // of the wrapper). panelPos holds the measured viewport coordinates for the
  // portal.
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null)
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
    setPanelPos({ right, top: rect.bottom + 6 })
  }
  // Toggle handler. On the way OPEN it measures where the panel goes — the one thing that can only
  // be decided at that instant. Measurement only happens on open (close is cheap).
  const handleToggle = () => {
    if (!open) {
      measurePanel()
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
  // Trigger keyboard handler — opens dropdown with ↑/↓/Enter/Space, then arrow nav happens
  // via the document-level handler below (set up only when open). Standard listbox pattern.
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndFocus()
      } else if (e.key === 'ArrowDown') {
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
  // Android hardware Back closes an open dropdown instead of quitting the app (Q1). listboxId is a
  // stable per-instance useId, so multiple selects (mode + the settings dropdowns) register distinctly.
  useBackButton(open, () => setOpen(false), listboxId)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null
      if (!ref.current || ref.current.contains(target)) return
      // The panel is portaled out of the wrapper, so a tap on an option is NOT
      // contained by ref.current — without this, the mousedown/touchstart handler
      // would close the dropdown before the option's click (selection) fired.
      if (panelRef.current && panelRef.current.contains(target)) return
      // Ignore mousedowns that landed in a scrollbar (Windows native scrollbars register
      // mousedown on the scrolling element itself). Without this, dragging the Settings
      // popover's scrollbar while a dropdown inside it is open closes the dropdown.
      const t = target
      if (t && t.nodeType === 1) {
        const r = t.getBoundingClientRect()
        const cx = 'clientX' in e ? e.clientX : null
        const cy = 'clientY' in e ? e.clientY : null
        if (t.scrollHeight > t.clientHeight && cx != null && cx > r.left + t.clientWidth) return
        if (t.scrollWidth > t.clientWidth && cy != null && cy > r.top + t.clientHeight) return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('touchstart', h)
    }
  }, [open, ref])
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
            // p-1 + the options' rounded-xl keep the drag-ring CONCENTRIC: the 12px inner radius
            // plus the 4px inset sits inside the 16px outer radius, so the ring is never clipped
            // by overflow-hidden and all four corners of the first/last options stay round.
            className="rounded-2xl overflow-hidden p-1"
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
              width: 'max-content',
              maxWidth: '90vw',
            }}
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
                className={`w-full text-left rounded-xl pl-4 pr-4 py-3 text-[15px] flex items-center gap-2.5 ${i === activeIdx ? 'bg-black/10' : 'cs-option-press'}`}
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
                <span>{opt.label}</span>
              </button>
            ))}
          </div>,
          // #root is the app's mount node — always present once the app has rendered.
          document.getElementById('root')!,
        )}
    </div>
  )
}
