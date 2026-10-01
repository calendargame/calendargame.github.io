import { useContext, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { PillGroupLock } from './pillGroupLock.js'

// PillGroup — the radiogroup HOUSING every ⚙ Settings picker sits in: the role, its accessible
// name, the lock, and the KEYBOARD CONTRACT that role="radiogroup" promises. Round-8 gave the
// trays role="radiogroup" / role="radio" / aria-checked; round 9 added the half that was
// missing, because announcing a convention the app does not keep is worse than announcing none.
//
// THE CONTRACT (WAI-ARIA APG, radio group):
//   • ROVING TABINDEX — the whole group is ONE tab stop, not one per pill. The selected pill
//     carries tabIndex 0 and every other pill -1, so Tab enters and leaves the group while the
//     arrows move WITHIN it. Before this, the panel's 26 pills were 26 separate tab stops. The
//     group appoints that pill (see the layout effect); a segment is never a tab stop on its own.
//   • ARROWS — Right/Down = next, Left/Up = previous, both WRAPPING; Home/End jump to the ends.
//     Selection FOLLOWS focus: a radio group is one choice, so landing on a pill is choosing it.
//     The vertical arrows are not decoration here — Date Format and Theme STACK two trays, so
//     Down genuinely means "the row below". Space and Enter need no code: a segment is a real
//     <button>, so the browser already turns both into the click the tray listens for.
//   • A LOCKED group is INERT: no tab stop at all (tabIndex -1 everywhere, so Tab passes it by)
//     AND it SWALLOWS the six keys it owns — moving nothing, but consuming them, because
//     tabIndex -1 still permits programmatic focus. Merely declining to act would be worse than
//     doing nothing: App's global handler maps ArrowLeft/ArrowRight to the game's history
//     buttons, so a released arrow steps the puzzle behind the open panel. Inert means the keys
//     stop here. This is the counterpart of the dim's pointer-events-none, which by itself stops
//     pointers and nothing else.
//
// WHY THE GROUP OWNS THIS AND NOT THE TRAY: a group is a CHOICE, not a row (THE PICKER RULE,
// stated at the Display section — which lives in components/SettingsPanel since round 14, not
// main.tsx). Date Format is five formats across TWO trays, and
// Theme is five themes across two trays whenever Use System is off — a tray-scoped
// implementation would give those groups two tab stops and would refuse to arrow from the last
// Written format into the first Numeric one. Scoping to the group makes the one-tray and
// two-tray cases the same case.
//
// HOW IT REACHES THE PILLS: the group finds its radios by role, in DOM order, and drives the
// chosen one with focus() then click(). Going through the DOM instead of a registry of options
// is what keeps this primitive value-agnostic — PillTray keeps `value`/`onChange` and its own
// generic type, the group owns focus — and DOM order is the only ordering guaranteed to match
// what the user sees, because it IS what the user sees.
//
// ⚠ ONE HALF OF THE CONTRACT IS DORMANT IN THIS APP, by an older decision: plain Tab never
// reaches these groups, because App's global keydown handler binds it to opening the mode
// selector (main.tsx, "Tab: toggle the mode selector dropdown"). The roving tabindex is still
// what assistive tech reads, and CLICKING a pill is the entry path that works today — PillTray
// focuses the segment it activates, so this holds on Safari too, which does not focus a <button>
// on click of its own accord — after which every arrow key below is live. Un-dorming Tab is a
// decision about what Tab should mean app-wide, not one this primitive can make, and the two are
// independent: the arrows work today either way.

// A radio's selector, and the ONE place this file knows how a pill is spelled.
const RADIO = '[role="radio"]'
// The two arrow axes, as the step they take through the group. Both pairs are listed because a
// radio group answers to both (WAI-ARIA APG) — and here the vertical pair is the one that crosses
// between the stacked trays of the Date Format and Theme groups.
const ARROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}
// The visible half of the lock, for every picker in the panel. `disabled` is the single source of
// all of it — this dim, aria-disabled on the group and on each segment, PillTray's onChange guard,
// and the inertness above — so a locked picker cannot be locked four ways out of five.
const LOCK_CLASS = 'opacity-60 pointer-events-none'

export function PillGroup({
  label,
  disabled,
  className,
  children,
}: {
  // The group's accessible name. OMITTING it is meaningful: a radiogroup must have a name, so a
  // PillGroup without one is not a group at all — just the div that supplies its children's
  // spacing, with no role, no keyboard handling and no lock of its own. That is exactly what the
  // Theme block needs, where which wrapper is the real group follows Use System Settings.
  label?: string
  // Locked. Omitted = INHERIT the enclosing group's lock (components/pillGroupLock), so a plain
  // unlabelled spacing wrapper — the Theme block has one in both Use-System states — can never
  // silently unlock the group it sits inside. An inherited lock carries every behaviour of a
  // declared one but does NOT re-draw its dim (see the render).
  disabled?: boolean
  // The caller's own layout classes. The lock's dim is appended by this component, so no call
  // site spells it out.
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inheritedLock = useContext(PillGroupLock)
  const locked = disabled ?? inheritedLock
  // The dim is drawn ONCE, by the element the lock was DECLARED on — never by one that merely
  // inherited it. opacity multiplies through the tree, so a nested wrapper re-applying
  // opacity-60 inside a locked group would render it at 0.36, and the Theme block already nests
  // wrappers inside a group: it is one `disabled=` prop away. Declaring covers inheriting by
  // construction — the element that declares a lock wraps everything the lock applies to.
  // An unlabelled wrapper is TRANSPARENT — no role, no keys, no lock of its own — so every
  // behaviour below is gated on the group being real. `locked` gates the second, narrower
  // question: a locked group is real (it still consumes its keys), it just moves nothing.
  const isGroup = label !== undefined

  // THE TAB STOP, appointed here and nowhere else. A segment declares itself permanently
  // un-tabbable (PillTray renders a constant tabIndex -1) and this hands the 0 out, because the
  // question "which pill is the tab stop" is only answerable at group scope: the pill holding the
  // value, wherever among the group's trays it lives. Two other answers are folded in — a LOCKED
  // group appoints nobody (nothing else keeps a keyboard out; the dim's pointer-events-none stops
  // pointers only), and a group whose value matches NO option anywhere in it, which a stale saved
  // setting could produce, falls back to the first radio rather than dropping out of the tab
  // order. So: never two stops, never zero.
  //
  // The single writer is the point, not an implementation detail. React writes a prop only when
  // its VALUE changes, so a tabIndex it thinks is already -1 stays whatever anyone else last set
  // — an imperative 0 written for the stale-value case would survive into the state that no
  // longer wants it, and the group would have two tab stops. One authority, writing every radio
  // every pass, cannot drift. No dependency array for the same reason: aria-checked is re-rendered
  // by React on every pass, so this re-reads it on every pass. It is a LAYOUT effect, so it lands
  // in the same frame as the render it corrects.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !isGroup) return
    const radios = [...el.querySelectorAll<HTMLElement>(RADIO)]
    const selected = radios.findIndex((r) => r.getAttribute('aria-checked') === 'true')
    const stop = locked ? -1 : selected === -1 ? 0 : selected
    radios.forEach((r, i) => {
      r.tabIndex = i === stop ? 0 : -1
    })
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !isGroup) return
    const step = ARROW_STEP[e.key]
    // The six keys a radio group OWNS. Recognised before the lock is consulted, because owning a
    // key and acting on it are different questions: a locked group still has to swallow them.
    if (step === undefined && e.key !== 'Home' && e.key !== 'End') return
    const radios = [...el.querySelectorAll<HTMLElement>(RADIO)]
    const from = radios.indexOf(document.activeElement as HTMLElement)
    if (from === -1) return // the press didn't come from one of our radios — leave it alone
    e.preventDefault() // the arrows would otherwise scroll the popover out from under the pills
    // App's global handler maps ArrowLeft/ArrowRight to the game's history back/forward buttons
    // (main.tsx, the [data-key] walk). A key this group owns must stop here, or moving between
    // pills — or pressing an arrow inside a LOCKED group, which moves nothing at all — would also
    // step the puzzle behind the panel.
    e.stopPropagation()
    if (locked) return // inert: consumed, but nothing moves and nothing is chosen
    const n = radios.length
    // The modulo IS the wrap, in both directions (+ n keeps a backwards step off the front
    // positive).
    const to = step !== undefined ? (from + step + n) % n : e.key === 'Home' ? 0 : n - 1
    radios[to].focus()
    // Selection follows focus. click() rather than a callback is what lets the group stay
    // value-agnostic: the tray's own onClick — including its lock guard — is the single path by
    // which a pill is ever chosen, whether the pointer or the keyboard asked for it.
    radios[to].click()
  }

  const dimmedClass = className ? `${className} ${LOCK_CLASS}` : LOCK_CLASS
  return (
    <PillGroupLock.Provider value={locked}>
      <div
        ref={ref}
        className={disabled === true ? dimmedClass : className}
        onKeyDown={onKeyDown}
        role={isGroup ? 'radiogroup' : undefined}
        aria-label={label}
        // The lock, announced at GROUP scope as well as on every segment (PillTray reads the same
        // boolean through the context). Without it a screen reader enters a locked picker being
        // told it is live and only discovers otherwise one element in. Only a real group carries
        // it — an unlabelled wrapper has no role for the state to qualify.
        aria-disabled={(isGroup && locked) || undefined}
      >
        {children}
      </div>
    </PillGroupLock.Provider>
  )
}
