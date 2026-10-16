// The app's shared control className tokens, extracted verbatim from main.tsx (the main.tsx split) so the
// mode screens can move into their own modules without re-declaring them. Every comment here is
// the original — these strings encode hard-won layout rules (see Key learnings: rendered height
// must count borders; a box is only flush with button neighbours because its ROW stretches it).
import type { ButtonState } from '../engine/answerButtons.js'

// Reset-style button shared className. Used by Reset Stats (Classic/Deduction/Flash),
// Round Reset (Blitz active), AoX Reset, and the Save-Defaults Clear. (The ⚙ panel's Reset
// Settings / Full Reset pair uses the derived PANEL_RESET_BTN_CLASS below.)
// border border-transparent completes the RENDERED height (round 8, the round-4 lesson):
// a solid fill carries no visible border, but every control it is measured against does — the
// grid neighbours Reveal / Override / ‹ › wear `border surface-button`, and the ⚙ panel's
// View/Clear Saved Defaults pair wears `border surface-toggle`. A border counts toward rendered
// height, so without it this button's own height sat 2px under its row's (masked so far only
// because every host stretches its items).
// ⚠ THE NEIGHBOUR NAMED HERE USED TO BE "the Save-Defaults Cancel beside Clear", and round 22 removed
// every Cancel button in the app — so the EXAMPLE moved to a surviving `surface-toggle` pair while
// the RULE did not move at all. It is still measured against real neighbours: the ⚙ panel's trio
// (Save Defaults / Reset Settings / Full Reset share one row), and the mode screens' reset buttons
// beside their bordered grid controls. The two places this class now stands ALONE in its row — a
// ConfirmModal's confirm and the preset manager's Delete, both `w-full` since round 22 — keep the border
// for the same reason every variant does: the token is one height tier, not a per-row measurement.
// ring-on-fill: on this fill the keyboard's focus ring is white, like the label, and drawn a little
// way in — the theme's own ring colour is the card's text colour, which in the two light themes is
// dark and sinks into the rose (index.css, "THE KEYBOARD FOCUS RING"; .btn-solid carries the same
// for the purple).
export const RESET_BTN_CLASS =
  'px-3 py-2 rounded-xl bg-rose-600/90 text-white ring-on-fill border border-transparent text-sm font-medium'
// Settings-panel variant (Round-3 font normalization, Round-4 one-height tier): the ⚙
// popover's Reset Settings / Full Reset buttons (the panel's pinned footer until Round 26 moved
// them to head the Per-preset section — hence no longer FOOTER_RESET_BTN_CLASS) rest at the popover control tier in BOTH
// font (text-xs) and height (py-1.5) — same button in every other way, so it's derived.
// The tier's other controls (the On/Off switches and every PillTray housing — the only two
// kinds the panel has, per THE PICKER RULE) all carry a 1px border, which this pair now
// inherits from RESET_BTN_CLASS rather than appending.
// The game-mode Reset buttons keep text-sm/py-2.
export const PANEL_RESET_BTN_CLASS = RESET_BTN_CLASS.replace('text-sm', 'text-xs').replace(
  'py-2',
  'py-1.5',
)
// HOW A BUTTON SAYS "YOU CANNOT PRESS THIS" (round 15) — appended by the ⚙ panel's trio
// (Save Defaults / Reset Settings / Full Reset) and Clear Saved Defaults while the app is not
// offering them, and ALWAYS alongside aria-disabled on the same element. The pair is the whole
// convention: the class draws it, the attribute announces it, and the button's own handler guard is
// what actually makes it inert. Three independent statements of one fact, deliberately — see the
// note at the trio, in SettingsPanel's Per-preset section.
//
// ⚠ NO pointer-events-none, and its ABSENCE is the load-bearing part. These three carried
// `opacity-60 pointer-events-none` until round 15 and nothing else: CSS-only withholding, which
// leaves a control that is greyed, unhittable by a mouse, silent to a screen reader — and still a
// tab stop. A keyboard user reached it, was told nothing, pressed it and got nothing. Removing
// pointer-events-none is what lets the cursor below actually paint (a pointer-events:none element
// is never hit-tested, so any cursor declared on it is dead), and it is why the hover rule in
// index.css now excludes aria-disabled: without that, a dimmed Save Defaults would brighten under
// the pointer while telling it not-allowed.
//
// ⚠ AND IT IS WHY lib/pointerGestures NOW FILTERS aria-disabled EXPLICITLY (gestureTarget). Becoming
// hit-testable made these three visible to the press-drag controller for the first time: a drag from
// the ⚙ gear into the panel drew the drag-select ring on a greyed-out trio button that then did
// nothing on release. The invariant "a ring means a release will act" used to ride on
// pointer-events-none too, so removing the block here means the gesture layer has to state it. If
// you ever put pointer-events-none back on these, that filter stays — it is the honest rule and no
// longer a workaround for this class.
//
// ⚠ NOT SHARED WITH MethodBreakdown's CODES_BTN_DISABLED_CLASS, which is the same three tokens
// PLUS pointer-events-none. It looks like a dedup and is not: that button keeps the pointer block,
// so the strings genuinely differ. Converging them means deciding whether Show Codes should also
// become hittable-but-inert, which is its own change with its own gate.
export const NOT_OFFERED_BTN_CLASS = 'opacity-60 cursor-not-allowed'
// Compact Reset Stats button variant (smaller py + col-span fit for stats panel). Round 21
// removed the ARMED variant — the two-tap confirm became the shared ConfirmModal, so this caption
// never changes colour or text now.
export const RESET_STATS_BTN_CLASS =
  'w-full px-3 py-1.5 rounded-xl btn-solid border border-transparent text-sm font-medium'
// ── THE ⚙ FOOT'S TWO-ITEM LINES ─────────────────────────────────────────────────────────────
// The pinned foot of the ⚙ panel is three information lines (Round 26): Contact; Storage used with
// Changelog at the right; Last Updated with Check for updates at the right. The last two are this
// token, and it is a named token because it carries an argument.
//
// ⚠ THE ~4px RING-CLEARANCE RULE: every foot text link wears `rounded-md px-1 -mx-1` — the
// padding gives the press-drag ring 4px of breathing room around the glyphs, and the equal
// negative margin cancels it so the TEXT keeps its exact flow position. So a row's margin boxes
// ARE its text boxes, and a 12px gap between them leaves 12 − 4 − 4 = 4px between the rings the
// padding draws. gap-x-3 is that 12px, and it is the FLOOR between the two items — the free space
// only ever widens it.
//
// THE RIGHT ANCHOR is the last child's auto left margin (`[&>:last-child]:ml-auto`), written here
// so the rule lives once and no item has to carry it: the first item sits hard left, the second
// hard right, under each other from line to line, so the foot reads as a left column and a right
// column. An auto margin rather than justify-between because of the one case the two differ in.
//
// ⚠ THE ONE CASE: A LINE TOO NARROW FOR ITS PAIR. At every phone size both lines hold their pair
// on one line (tests/browser/settingsFoot sweeps it, with the text made a tenth wider to stand for
// the iPhone's wider font), but a window narrower than any phone and as tall as one — an iPad's
// 320px-wide Slide Over — cannot fit "Last Updated: …" beside "Check for updates" at the root size
// that height gives. Dropping flex-wrap would make that line run out of the card;
// wrapping is the honest answer, and three things keep it looking like the rest of the foot:
//   • gap-y-0.5 — the wrapped line sits the foot's own line spacing (its space-y-0.5) below the
//     first, not the 12px the column gap would give it. Round 25's foot wore a single gap-3, and
//     on the owner's iPhone that put Changelog's wrapped line 12.7px down where every other line
//     sat 2.1px apart — the defect this token was rewritten for.
//   • the auto margin keeps a wrapped right item at the RIGHT, in the right column, where
//     justify-between would have dropped a lone item to the left;
//   • items-center keeps the stamp's caption level with its button on the line they share.
export const FOOTER_META_ROW_CLASS =
  'flex flex-wrap items-center gap-x-3 gap-y-0.5 [&>:last-child]:ml-auto'
// Boxed numeric-input shared className (split into base + surface in round 7) — the app's
// second shared input idiom beside SliderValueEditor: a bordered box with centered tabular
// digits at the text-xs control tier. Used by the AoX run-length field (mode screen + the
// Save Defaults popup, both appending " py-1 w-14 shrink-0") and the ⚙ Year Range pair
// (" py-1.5 w-16"). These boxes NEVER declare a height — the engine derives one from the inner
// line box — and an <input> derives it through different machinery than a <button> does, landing
// ~2px apart in WebKit even when every class, padding and border matches. So a box is only ever
// flush with button neighbors because its ROW STRETCHES it (the AoX run-length row, items-stretch),
// never because the token strings agree. Anywhere that rule is dropped the box sits visibly proud;
// three rounds of trying to prove the derived heights match instead all failed on device.
// The surface is the site-wide interactive-border rule applied — border weight
// signals role (thin-bd dividers, panel/card-bd containers, sbtn-bd interactive controls):
// inputs are controls you act on, so every one wears surface-tray (stgl-bg + sbtn-bd, the
// no-hover interactive surface the settings segment trays share), matching the buttons —
// never the container .panel these boxes once borrowed. (The top-bar chrome — mode
// selector, gear, stat panel — deliberately STAYS .panel: the container tier, owner call.)
// NUM_INPUT_BASE carries the geometry alone so the DefaultsCard's dirty variant
// (NUM_INPUT_DIRTY_CLASS, defined beside the card) swaps the whole surface, not a token.
// appearance-none (round 8) turns the NATIVE form-field treatment off: these boxes fully
// declare their own border, background and radius, so leaving appearance:auto in place is a
// false declaration that also keeps iOS's own inner shadow and focus treatment live on top
// of ours. (Every text input in the app now states this: here, the Lookup date field, and
// SliderValueEditor's edit box via .svalue-input. Range sliders are deliberately untouched —
// their native track/thumb IS the control that index.css styles.)
export const NUM_INPUT_BASE = 'appearance-none rounded-xl px-2 text-center tabular-nums text-xs'
export const NUM_INPUT_CLASS = NUM_INPUT_BASE + ' border surface-tray'
// …NOT IN EFFECT (Round 26 — a Year Range pair while the other Julian setting is chosen): the same
// box, hollow — index.css's .tray-dormant in place of .surface-tray, the look a ⚙ picker's tray wears
// in the same state (components/PillGroup says what the three looks mean).
export const NUM_INPUT_DORMANT_CLASS = NUM_INPUT_BASE + ' border tray-dormant'
// Presentational primitives (NewBestStar, SectionLabel, Kbd) + their class consts → src/components/primitives.jsx, imported at top.
// buttonStateClass — picks the className for an answer-grid button based on its
// persistent state (correct/wrong-latest/wrong-prev/override-wrong) and any active
// flash animation. Returns just the state-class portion; the caller composes the
// full className (base + state + lock/dim).
//   ps        — persistBtns[idx] value or undefined
//   isFlashing — whether a flash is active for this button index
//   flashGood — when flashing, whether it's a good or bad flash
//   idleClass — fallback for idle state (varies between AoX 'surface-button' and App's idleBtn)
export const buttonStateClass = (
  ps: ButtonState | undefined,
  isFlashing: boolean,
  flashGood: boolean,
  idleClass: string,
) => {
  if (ps === 'correct') return 'btn-correct-persist border-transparent'
  if (ps === 'wrong-latest') return 'btn-wrong-persist border-transparent'
  if (ps === 'wrong-prev') return 'btn-wrong-dim border-transparent'
  if (ps === 'override-wrong') return 'btn-override-wrong border-transparent'
  if (isFlashing) return (flashGood ? 'flash-good' : 'flash-bad') + ' border-transparent'
  return idleClass
}
// BASE_BTN — the shared answer-button className. Worn as-is by every weekday grid; Deduction
// derives its own text-sm variant from it (see `baseBtn` in DeductionMode).
export const BASE_BTN = 'w-full rounded-2xl border px-4 py-3 text-base select-none'
// ANSWER_GRID_GAP — the ONE gutter every gap-spaced answer grid wears: the weekday grid below
// (worn by Classic/Flash/AoX/Blitz through the single WeekdayAnswer) and all three Deduction
// sub-mode grids plus the Year sizer strut. Deduction's Day and Year used to run gap-2 while
// Month and the weekday grid ran gap-3, so the gutter visibly CHANGED as you switched Deduction
// sub-mode (round 9); they were widened onto this token, never the reverse. Sharing it also
// puts every layout on ONE column lattice: at a common gap g, a 6-col grid's col-span-2 is
// exactly a 3-col column ((W−2g)/3) and its col-span-3 exactly a 2-col column ((W−g)/2), so
// Deduction's 2-/3-/6-col grids and the weekday 2-col grid share invisible column edges —
// an identity that mixed gaps broke by a few px.
// NOT a rule about "every answer grid": the Dots input is not gap-spaced at all (a square 3×3
// place-items:center cluster whose spacing is --dot-frac), so it carries no gap token — see
// .dot-cluster in index.css.
// ⚠ CSS NEEDS THIS NUMBER TOO, AND CANNOT READ IT. A Tailwind class name is not something CSS can
// resolve, so index.css declares its own --answer-gap — as the SPACING STEP this class carries,
// `calc(var(--spacing) * 3)`, not the 0.75rem that resolves to, so the only thing copied across the
// join is the integer 3 — and TWO rules spend it: .dot-box's
// --ans-h (the dot box's height, which must equal the 4-row weekday grid's, and which counts three
// of these gutters) and [data-hit-pad]'s --hit-half (half a gutter, the reach of an answer button's
// extended hit area — sub-group 1B). Both now read the one variable, so the only join left to
// police is this token against that variable, and tests/answerHitPad.test.js fails the build if
// they ever disagree. Change this and change --answer-gap with it.
export const ANSWER_GRID_GAP = 'gap-3'

// THE DATE CARD'S CENTRE AND ITS DATE — the same two in every mode (index.css's .date-card and
// .date-line say why the date is one line at one size per screen; components/CardNumber's badge is
// positioned against the centre, which is why it stays `relative`).
export const DATE_CARD_CLASS = 'text-center relative date-card'
export const DATE_LINE_CLASS = 'date-line font-bold'
