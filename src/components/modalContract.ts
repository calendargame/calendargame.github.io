import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// ─────────────────────────────────────────────────────────────────────────
// components/modalContract — what it takes to be a MODAL in this app, in one place.
//
// The app has one modal idiom and now five users of it: the four ⚙ Settings popups (Save Defaults,
// the defaults manager, the Clear confirm, the Changelog) and the run breakdown that the MoX/Blitz
// stat strip opens on a finished run. Every one of them owes the same five things, and until this
// module existed four of them owed it four times over — four near-identical Escape effects sitting
// in a row in SettingsPanel, and a Tab trap that only the popups declared inside that one component
// could reach. The fifth user is what made the copies indefensible: a modal living in a MODE screen
// could not import any of it, so it would either have grown a fifth copy or quietly skipped a term.
//
// THE CONTRACT, all five terms:
//   1. FOCUS ON OPEN — the card is tabIndex={-1} role="dialog" aria-modal="true" and takes focus, so
//      a screen reader announces a modal and the keyboard starts inside it. (One line at the call
//      site; there is nothing to share.)
//   2. ESCAPE, IN THE CAPTURE PHASE — useModalEscape below. Capture + stopPropagation is what keeps
//      the press from reaching App's document-level Escape handler, which would close the whole
//      settings panel (or, for the breakdown, do whatever the screen underneath does with Escape).
//   3. ANDROID BACK — useBackButton (components/useBackButton), which is also the app's open-overlay
//      registry and, since round 18, what takes the keyboard down when anything opens.
//   4. THE TAB TRAP — trapModalTab below, on the scrim, so Tab cycles the modal's own controls and
//      wraps at the ends instead of walking into the page underneath.
//   5. [data-settings-modal] ON THE SCRIM — the marker App's click-outside and Tab-shortcut handlers
//      read to decide "a modal is up". The name is historical (the first four were all settings
//      popups) and is deliberately NOT being renamed: it is a published contract between this file
//      and two handlers in main.tsx, and a rename buys nothing a comment cannot say.
// ⚠ Terms 1, 3 and 5 stay at the call site, because each is a single expression that reads better
// where it applies. This module owns the two that were being copied.
// ─────────────────────────────────────────────────────────────────────────

// The scrim: full-screen, above everything, centring its card, and carrying the marker. Callers add
// their own onClick (target===currentTarget ⇒ a click on the scrim itself dismisses) and onKeyDown.
export const MODAL_SCRIM_CLASS =
  'fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4'
// The card: the popover's own surface language, py-4 only — horizontal padding belongs to the rows
// and to any inner scroll region, so the scroller's right padding is the text-free lane the iOS
// overlay scrollbar paints in (components/scrollRegion). focus:outline-hidden because term 1 focuses
// it programmatically and a focus ring on a whole dialog is noise, not information.
export const MODAL_CARD_CLASS =
  'card rounded-2xl py-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden'
// The card's elevation. An inline style rather than a class because that is how the four existing
// popups already spell it; sharing the literal is the point.
export const MODAL_CARD_SHADOW = { boxShadow: '0 0 8px rgba(0,0,0,0.12)' } as const

// Term 2 — Escape dismisses this modal, and only this modal.
//
// CAPTURE PHASE + stopPropagation: App's Escape handler is a document keydown in the BUBBLE phase,
// so a capture-phase listener here runs first and can stop the press before the page underneath
// interprets it. Without that, Escape in a settings popup closed the popup AND the panel behind it.
//
// `guardTextEntry` covers modals that contain a text box: those boxes own their own Escape (it
// discards the edit and stops propagation), so the modal must not also treat the press as a dismiss
// — the player's first Escape gets the field back, and a second one, with nothing focused, reaches
// here. type="range" is deliberately NOT guarded: a slider keeps focus after an adjust, and a
// focused slider must not swallow the dismiss. Modals whose only controls are buttons pass false.
//
// `close` is read through a ref, exactly as useBackButton reads its own: the listener is attached
// once per open, and a caller's inline arrow must not re-attach it on every render.
export function useModalEscape(open: boolean, close: () => void, guardTextEntry: boolean) {
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (guardTextEntry) {
        const ae = document.activeElement as HTMLInputElement | null
        if (ae && ae.tagName === 'INPUT' && ae.type !== 'range') return
      }
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [open, guardTextEntry])
}

// Term 4 — the focus trap. Goes on the SCRIM's onKeyDown, so it sees every Tab inside the modal.
// Plain Tab / Shift+Tab traverse natively in the middle and WRAP at the ends; focus never escapes to
// the page under the scrim. A one-control modal is the degenerate case and works: first === last, so
// Tab wraps in place. stopPropagation keeps the press from the app-wide Tab shortcut (which would
// open the mode selector behind the modal); that shortcut's own handler also bails while a
// [data-settings-modal] is mounted, for presses that start outside this tree.
export const trapModalTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'Tab') return
  e.stopPropagation()
  const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input'))
  if (f.length === 0) return
  const first = f[0],
    last = f[f.length - 1],
    ae = document.activeElement
  if (e.shiftKey) {
    if (ae === first || !e.currentTarget.contains(ae)) {
      e.preventDefault()
      last.focus()
    }
  } else if (ae === last || !e.currentTarget.contains(ae)) {
    e.preventDefault()
    first.focus()
  }
}
