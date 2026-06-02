import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// CustomSelect — the app's custom dropdown, replacing the native <select>.
//
// Renders a trigger button; when open, the option list is PORTALED to #root so
// it escapes any clipping/overflow ancestor (e.g. the scrollable Settings
// popover) and floats over the page. Full listbox keyboard support
// (↑/↓/Home/End/Enter/Space/Esc/Tab) and a click-outside-to-close handler that
// correctly treats taps inside the portaled panel (and on native scrollbars)
// as "inside".
//
// ⚠ STABILITY NOTE: the portal positioning (measurePanel) and open-direction
// logic (handleToggle + the openUp override) were tuned against iOS Safari over
// several attempts and are QA-confirmed working. They look like ordinary
// geometry but are device-sensitive — ALWAYS re-verify on iPhone Safari
// (browser + PWA) after editing anything here.
//
// Props: value, onChange, options [{value,label}], className (trigger),
// wrapperClassName (outer relative div), ariaLabel, wrapperRef (forwarded to the
// wrapper so callers can treat it like the old <select> ref), showChevron, and
// openUp (force upward — used by the theme selects at the bottom of Settings).
//
// Extracted from main.jsx in Stage C, Step 4d (verbatim; the only change is
// ReactDOM.createPortal → the directly-imported createPortal — same function).
export default function CustomSelect({
  value,
  onChange,
  options,
  className,
  wrapperClassName,
  ariaLabel,
  wrapperRef,
  showChevron = false,
  openUp = false,
}) {
  const [open, setOpen] = useState(false)
  // activeIdx tracks the keyboard-highlighted option (≠ selected value). -1 when nothing is
  // highlighted (e.g. mouse-only interaction). Reset to selected option's index on open so
  // ↑/↓ start from the current value, not the top.
  const [activeIdx, setActiveIdx] = useState(-1)
  const localRef = useRef(null)
  const ref = wrapperRef || localRef
  const triggerRef = useRef(null)
  const listboxId = useRef(`cs-list-${Math.random().toString(36).slice(2, 9)}`).current
  const optionId = (i) => `${listboxId}-opt-${i}`
  const selectedIdx = options.findIndex((o) => o.value === value)
  // panelRef points at the PORTALED panel so the click-outside handler can
  // treat taps inside it as "inside" (the panel is no longer a DOM descendant
  // of the wrapper). openUpwardRef holds the flip decision as a ref (not state)
  // so measurePanel can read it synchronously within the same toggle that sets
  // it. panelPos holds the measured viewport coordinates for the portal.
  const panelRef = useRef(null)
  const openUpwardRef = useRef(false)
  const [panelPos, setPanelPos] = useState(null)
  // measurePanel reads the trigger's current viewport rect and writes panelPos:
  // right edge aligned to the trigger, 6px below it (top) when opening down, or
  // 6px above it (bottom) when flipping up. Called on open and on scroll/resize
  // so the portaled panel stays pinned to its trigger.
  const measurePanel = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    if (openUpwardRef.current) setPanelPos({ right, bottom: window.innerHeight - rect.top + 6 })
    else setPanelPos({ right, top: rect.bottom + 6 })
  }
  // Toggle handler measures available space the moment the dropdown opens.
  // Each option button is ~45px tall (py-3 + text-[15px]) plus a small panel
  // margin. If space below the trigger in the viewport isn't enough AND there's
  // more space above, flip upward. visualViewport height is used (it excludes
  // Safari's bottom toolbar) so bottom-of-screen dropdowns don't open down into
  // toolbar-covered space. The 16px buffer keeps the panel off the edge.
  // Measurement only happens on open (close is cheap).
  const handleToggle = () => {
    if (!open && ref.current) {
      if (openUp) {
        // Caller forces upward (theme selects — always room above them).
        openUpwardRef.current = true
      } else {
        const rect = ref.current.getBoundingClientRect()
        const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight
        const spaceBelow = vh - rect.bottom - 16
        const spaceAbove = rect.top - 16
        const estimatedHeight = options.length * 45 + 10
        openUpwardRef.current = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
      }
      measurePanel()
      // Do NOT pre-highlight the selected option on open. The grey "active" box is a
      // pointer/keyboard cursor, not an open-state indicator (the ✓ already marks the
      // selection). It appears only once the user hovers with a MOUSE or presses an arrow —
      // touch sends neither, so the box never shows on mobile. First ↑/↓ reveals it on the
      // selected option (see handleTriggerKeyDown).
      setActiveIdx(-1)
    }
    setOpen((v) => !v)
  }
  const closeAndFocus = () => {
    setOpen(false)
    setActiveIdx(-1)
    if (triggerRef.current) triggerRef.current.focus()
  }
  const selectAt = (i) => {
    if (i < 0 || i >= options.length) return
    onChange(options[i].value)
    closeAndFocus()
  }
  // Trigger keyboard handler — opens dropdown with ↑/↓/Enter/Space, then arrow nav happens
  // via the document-level handler below (set up only when open). Standard listbox pattern.
  const handleTriggerKeyDown = (e) => {
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndFocus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        // First arrow (from the no-cursor -1 state) reveals the box ON the selected option;
        // subsequent arrows move it. So the cursor first appears where the ✓ is.
        setActiveIdx((i) => (i < 0 ? (selectedIdx >= 0 ? selectedIdx : 0) : Math.min(options.length - 1, i + 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (i < 0 ? (selectedIdx >= 0 ? selectedIdx : 0) : Math.max(0, i - 1)))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setActiveIdx(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setActiveIdx(options.length - 1)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        selectAt(activeIdx >= 0 ? activeIdx : selectedIdx)
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActiveIdx(-1)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleToggle()
    }
  }
  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return
      // The panel is portaled out of the wrapper, so a tap on an option is NOT
      // contained by ref.current — without this, the mousedown/touchstart handler
      // would close the dropdown before the option's click (selection) fired.
      if (panelRef.current && panelRef.current.contains(e.target)) return
      // Ignore mousedowns that landed in a scrollbar (Windows native scrollbars register
      // mousedown on the scrolling element itself). Without this, dragging the Settings
      // popover's scrollbar while a dropdown inside it is open closes the dropdown.
      const t = e.target
      if (t && t.nodeType === 1) {
        const r = t.getBoundingClientRect()
        if (
          t.scrollHeight > t.clientHeight &&
          e.clientX != null &&
          e.clientX > r.left + t.clientWidth
        )
          return
        if (
          t.scrollWidth > t.clientWidth &&
          e.clientY != null &&
          e.clientY > r.top + t.clientHeight
        )
          return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('touchstart', h)
    }
  }, [open])
  // Keep the portaled panel pinned to its trigger while open: any scroll
  // (capture phase, since scroll doesn't bubble — this catches the settings
  // popover's inner scroll wrapper) or viewport resize re-measures panelPos.
  useEffect(() => {
    if (!open) return
    const reposition = () => measurePanel()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', reposition)
      vv.addEventListener('scroll', reposition)
    }
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      if (vv) {
        vv.removeEventListener('resize', reposition)
        vv.removeEventListener('scroll', reposition)
      }
    }
  }, [open])
  return (
    <div ref={ref} className={`relative ${wrapperClassName || ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIdx >= 0 ? optionId(activeIdx) : undefined}
      >
        <span className="grid items-center">
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
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center leading-none text-[7px] text-white/90">
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
            aria-label={ariaLabel}
            className="rounded-2xl overflow-hidden"
            style={{
              position: 'absolute',
              right: panelPos.right,
              ...(panelPos.top != null ? { top: panelPos.top } : { bottom: panelPos.bottom }),
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
                className={`w-full text-left pl-4 pr-8 py-3 text-[15px] flex items-center gap-2.5 ${i === activeIdx ? 'bg-black/10' : 'active:bg-black/10'}`}
                style={{ color: '#1a1a1a', whiteSpace: 'nowrap' }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '14px',
                    color: '#1a1a1a',
                    fontSize: '14px',
                  }}
                >
                  {opt.value === value ? '✓' : ''}
                </span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>,
          document.getElementById('root'),
        )}
    </div>
  )
}
