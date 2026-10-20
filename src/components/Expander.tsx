import type { CSSProperties, ReactNode } from 'react'

// Expander — slides its children open/closed via the CSS grid-template-rows 0fr→1fr idiom
// (index.css: .expander / .expander-open / the min-height:0 + overflow:hidden row div).
//
// The wrapper is a one-row grid whose track tweens 0fr⇄1fr off the .expander-open class. The
// browser lays the track out at the TRUE content height, so opening and closing both travel the
// full distance in the same uniform duration — the old measured max-height cap's timing flaws
// (short panels finishing their capped tween early; closing spending dead time collapsing unused
// cap headroom before anything visibly moved) are gone by construction. So is the
// measurement-rounding clipping class (the 2026-06-08 retina bottom-border shave): at open rest
// the track equals the content by LAYOUT, not by a measured px snapshot, so nothing can round a
// hair short — which retires all of the old JS (the scrollHeight measure + 2px open buffer, the
// transitionend/timeout release to `max-height:none`, the reflow-pinned close). Reduce Motion
// needs no JS either: the CSS duration multiplies by var(--motion-scale), which collapses to 0s
// under the OS setting, and a 0s transition is an instant snap — open and close alike. An
// initially-open panel renders with .expander-open on first paint (no animation, no clip), a
// mid-flight reversal retargets smoothly from the current interpolated height (native CSS
// transition behavior), and content stays mounted (and queryable) in both states. Pure
// presentational — no app state.
//
// durationMs (round 7) sets the slide duration: it stamps the --expander-ms CSS var
// inline, which the .expander transition reads with a .24s fallback. BOTH consumers state
// it now (round 8) — the guide's motion coordinator (GuidePage) computes one
// distance-scaled duration per toggle (lib/accordionMotion) and hands the SAME value to both
// panels of an accordion switch so they tween on one shared clock; the codes panel
// (MethodBreakdown) states the ACCORDION_MS_FLOOR that formula returns for panels its size.
// The CSS fallback therefore governs nothing in practice, but it must stay: without the var
// the calc() is invalid at computed-value time and the transition would silently become 0s.
//
// ★ A CLOSED PANEL IS INERT (Round 26 review): its content stays mounted (and its height is what the
// slide animates to), so without this a closed panel was still THERE for a keyboard and a screen
// reader — Tab and Shift+Tab walked into links nobody could see (the Contact link in the closed
// Settings Overview), a screen reader read every closed How to Play section in full, and it read the
// Show Codes box's codes with the box closed, which gives the method away. `inert` takes the closed
// content out of the tab order and out of the accessibility tree in one attribute, and touches
// neither layout nor paint, so the slide is exactly as it was: the attribute goes on the moment a
// panel starts to close (nothing in a closing panel is for pressing) and comes off the moment one
// starts to open, so what is opening can be reached at once.
//
// Extracted from main.jsx in Stage C, Step 4a; rewritten from the max-height technique to the
// grid idiom in round 6 (2026-07-18).
export default function Expander({
  open,
  durationMs,
  children,
}: {
  open: boolean
  durationMs?: number
  children?: ReactNode
}) {
  // Plain ternary, not a template literal: the old `expander${open…` form glued a class
  // token to `${` — the bug class tests/classGlueGuard.test.js now bans (round 7) —
  // and with only two fixed states the conditional needs no interpolation at all.
  return (
    <div
      className={open ? 'expander expander-open' : 'expander'}
      // The cast is the standard React custom-property escape: CSSProperties is closed
      // typing (no --* index signature), but setting vars through `style` is fully supported.
      style={
        durationMs === undefined
          ? undefined
          : ({ '--expander-ms': `${durationMs}ms` } as CSSProperties)
      }
    >
      <div inert={!open}>{children}</div>
    </div>
  )
}
