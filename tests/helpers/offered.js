// IS THIS CONTROL OFFERED TO THE USER? — the one place in the whole suite that knows how the app
// spells "you cannot press this".
//
// WHY THIS FILE EXISTS. A control the app is not offering used to wear `opacity-60
// pointer-events-none` and nothing else — CSS only — so for years eight test files each carried
// their own `const isDisabled = (btn) => btn.className.includes('pointer-events-none')`. That made
// a Tailwind class string the CONTRACT in eight places at once: change how the app withholds a
// control and eight files go red for a reason none of them names, and no single edit can ever move
// the app off it.
//
// So the question is asked once, here, in the user's terms. A caller says "is this offered", never
// "does this className contain a token", and the day the app withholds a control some other way
// this file changes and nothing else does.
//
// ★ THAT DAY WAS ROUND 15, AND THIS IS THE ONLY FILE IT TOUCHED — which is the whole return on
// the abstraction. The ⚙ footer's three buttons now withhold with `aria-disabled` and DROP
// pointer-events-none (a pointer-events:none element cannot be hovered, so the not-allowed cursor
// they now carry could never have painted). Two spellings are live at once and the app is honest
// about that: the pickers, Show Codes and the accented slider readouts still block pointers, while
// the footer relies on its handler guards. So the predicate asks BOTH questions and a control is
// offered only if neither says otherwise. It is a strictly wider "not offered", so every caller
// written against the old spelling keeps its exact meaning.
// (Check for updates is the one real `disabled` ATTRIBUTE in the app, deliberately — it is
// momentarily busy rather than conditionally meaningless — and tests/checkUpdates pins it directly
// rather than through here.)
//
// ⚠ TWO QUESTIONS, NOT ONE, and keeping them apart is the point of the second export below.
// `pointer-events-none` stops a press; `opacity-60` DRAWS the control as unavailable. The app
// always writes them together, and that is exactly why a test must be able to ask them
// separately: greyed-but-still-pressable and live-looking-but-inert are both real bugs, and a
// single boolean cannot tell them apart. So `isOffered` answers "would a press reach this" and
// `isDimmed` answers "is this drawn as unavailable" — one file owns both spellings.
//
// ⚠ FOUR PLACES DELIBERATELY STILL NAME THE CLASS, and they are not oversights. This list is the
// whole of it: `grep -rn "pointer-events-none" tests/` returns exactly these six assertion sites
// and nothing else (the remaining hits are prose).
//   • tests/settings.dom's PIXEL GATES (~1015/1017) — exact-equality className pins that exist
//     precisely to freeze the string. Routing them through an abstraction would defeat the only
//     thing they do.
//   • tests/settings.dom (~904), in the KEYBOARD describe and NOT in the gates — the bare
//     <PillGroup> render, an exact-equality pin on a component mounted OUTSIDE the app to prove
//     an inherited lock never re-dims. It is about what the component EMITS, not about what the
//     panel offers, and it cannot reach this helper's subject at all.
//   • tests/aox.dom (~1180/1191) — asserts the FULL dim treatment (opacity-60 +
//     cursor-not-allowed + pointer-events-none) as a visual contract, which is a wider claim than
//     "not offered" and would be weakened by this helper.
//   • tests/deduction.dom (~720) — a transparent sizer element that must not intercept pointers.
//     That is a layout fact about an element the user never presses, not an offer.

// `el` is any rendered control. Returns whether the app is offering it — false if a pointer cannot
// reach it OR if it announces itself unavailable. Both spellings, one answer.
export const isOffered = (el) =>
  !el.className.includes('pointer-events-none') && el.getAttribute('aria-disabled') !== 'true'

// `el` is any rendered element. Returns whether the app is DRAWING it as unavailable. Read on the
// element that carries the treatment — for a picker that is the PillGroup housing, which is what
// makes the whole tray, captions included, grey as one piece. Callers that need "does the dim
// REACH this element" (an inherited opacity covers every descendant) ask
// settingsPanel.drawnUnavailable, which walks the containment chain through this predicate.
export const isDimmed = (el) => el.className.includes('opacity-60')
