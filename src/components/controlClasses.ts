// The app's shared control className tokens, extracted verbatim from main.tsx (Q1 phase 1) so the
// mode screens can move into their own modules without re-declaring them. Every comment here is
// the original — these strings encode hard-won layout rules (see Key learnings: rendered height
// must count borders; a box is only flush with button neighbours because its ROW stretches it).
import type { ButtonState } from '../engine/answerButtons.js'

// Reset-style button shared className. Used by Reset Stats (Classic/Deduction/Flash),
// Round Reset (Blitz active), AoX Reset, and the Save-Defaults Clear. (The ⚙ footer's Reset
// Settings / Full Reset pair uses the derived FOOTER_RESET_BTN_CLASS below.)
// border border-transparent completes the RENDERED height (Q4 round-8, the round-4 lesson):
// a solid fill carries no visible border, but every control it is measured against does — the
// grid neighbours Reveal / Override / ‹ › wear `border surface-button`, and the Save-Defaults
// Cancel beside Clear wears `border surface-toggle`. A border counts toward rendered height,
// so without it this button's own height sat 2px under its row's (masked so far only because
// every host stretches its items).
export const RESET_BTN_CLASS =
  'px-3 py-2 rounded-xl bg-rose-600/90 text-white border border-transparent text-sm font-medium'
// Settings-footer variant (Round-3 font normalization, Round-4 one-height tier): the ⚙
// popover's Reset Settings / Full Reset buttons rest at the popover control tier in BOTH
// font (text-xs) and height (py-1.5) — same button in every other way, so it's derived.
// The tier's other controls (the On/Off switches and every PillTray housing — the only two
// kinds the panel has, per THE PICKER RULE) all carry a 1px border, which this pair now
// inherits from RESET_BTN_CLASS rather than appending.
// The game-mode Reset buttons keep text-sm/py-2.
export const FOOTER_RESET_BTN_CLASS = RESET_BTN_CLASS.replace('text-sm', 'text-xs').replace(
  'py-2',
  'py-1.5',
)
// HOW A BUTTON SAYS "YOU CANNOT PRESS THIS" (round 15, B7) — appended by the ⚙ footer's three
// buttons (Save Defaults / Reset Settings / Full Reset) while the app is not offering them, and
// ALWAYS alongside aria-disabled on the same element. The pair is the whole convention: the class
// draws it, the attribute announces it, and the button's own handler guard is what actually makes
// it inert. Three independent statements of one fact, deliberately — see the note at the footer.
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
// the ⚙ gear into the panel drew the drag-select ring on a greyed-out footer button that then did
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
// Compact Reset Stats button variant (smaller py + col-span fit for stats panel).
export const RESET_STATS_BTN_CLASS =
  'w-full px-3 py-1.5 rounded-xl btn-solid border border-transparent text-sm font-medium'
// Reset Stats when ARMED (first tap of the two-tap confirm, Q2): rose/danger fill — the same danger
// colour as RESET_BTN_CLASS — so "tap again to confirm" reads as a warning, not a normal button.
export const RESET_STATS_ARMED_CLASS =
  'w-full px-3 py-1.5 rounded-xl bg-rose-600/90 text-white border border-transparent text-sm font-medium'
// ── THE ⚙ FOOTER'S TWO LINK ROWS — one class from round 7 until this round, now two ──────────
// Round-7 Q2 hoisted a single FOOTER_LINK_ROW_CLASS over both of them on one argument: the
// View/Clear saved-defaults row and the Last Updated / Check for updates / Changelog row were "the
// same kind of row" — a wrapping line of muted footer text links, left-packed, one gap. Neither
// half of that is true of either row any more, so the token could not stay honest as one string:
//   • The saved-defaults pair MOVED INTO THE PINNED BUTTON BLOCK and stopped being left-packed at
//     all — its two links are now centred on the row's THIRDS so they interlock with the three
//     buttons above them. The geometry argument lives at the row itself, in SettingsPanel.
//   • The metadata row stayed where it was and SPREAD: the stamp anchors left, Changelog anchors
//     right as a whole element, and Check for updates sits exactly halfway between the two.
// What a "common base" would have contained after that is the word `items-center` and nothing
// else. A shared token that carries no shared decision is worse than two named ones — the point of
// hoisting was to state a rule in one place, and there is no longer a rule in common — so this is
// a SPLIT, not a rename. Both still live here beside FOOTER_RESET_BTN_CLASS because what makes a
// footer token belong in this file is that it carries an argument, not that it has two callers.
//
// ⚠ THE ~4px RING-CLEARANCE RULE SURVIVED THE SPLIT, but only the metadata row can still state it
// as a gap. Every footer text link wears `rounded-md px-1 -mx-1`: the padding gives the press-drag
// ring 4px of breathing room around the glyphs, and the equal negative margin cancels it so the
// TEXT keeps its exact flow position. So a row's margin boxes ARE its text boxes, and a 12px gap
// between them leaves 12 − 4 − 4 = 4px between the rings the padding draws. gap-3 is that 12px.
// The saved-defaults row cannot express the rule at all: a grid gap would move its two centres off
// the exact thirds, so what clearance it has is whatever the thirds leave it — see the warning at
// that row about how little that is on a narrow phone.
//
// The metadata row: justify-between is what puts the stamp hard left and Changelog hard right, and
// because the three margin boxes are the three text boxes it also splits the slack into two EQUAL
// text-to-text gaps — which is precisely "Check for updates sits halfway between the facing edges
// of its neighbours" (owner's call, this round). gap-3 becomes the MINIMUM those two gaps can
// reach, so the ring clearance above is a floor the free space only ever widens. items-center keeps
// the Last Updated caption vertically aligned with its two button links; flex-wrap is the
// narrow-viewport fallback — at normal widths the row stays one line, and on a line that DOES wrap
// justify-between spreads whatever landed on it, which is the honest consequence of anchoring the
// ends rather than a second rule.
export const FOOTER_META_ROW_CLASS = 'flex items-center flex-wrap justify-between gap-3'
// The saved-defaults pair, now the SECOND row of the pinned button block (SettingsPanel's
// .popover-sticky-footer). Three equal columns and deliberately NO gap, so the column edges fall on
// the exact thirds; each link is then placed across TWO adjacent columns and centred inside that
// span, which lands one centre at 1/3 and the other at 2/3. (Why the spans overlap in the middle
// column, and why that is the point rather than a bug, is argued at the row.)
// It carries its own text tier because it no longer inherits one: it left the metadata block, whose
// text-[11px] text-(--tx-300-60) used to reach it by inheritance, and the pinned block it moved
// into declares no text styling at all.
export const FOOTER_DEFAULTS_ROW_CLASS =
  'grid grid-cols-3 items-center text-[11px] text-(--tx-300-60)'
// Boxed numeric-input shared className (Q18; split base + surface Q7 round-7) — the app's
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
// appearance-none (Q4 round-8) turns the NATIVE form-field treatment off: these boxes fully
// declare their own border, background and radius, so leaving appearance:auto in place is a
// false declaration that also keeps iOS's own inner shadow and focus treatment live on top
// of ours. (Every text input in the app now states this: here, the Lookup date field, and
// SliderValueEditor's edit box via .svalue-input. Range sliders are deliberately untouched —
// their native track/thumb IS the control that index.css styles.)
export const NUM_INPUT_BASE =
  'appearance-none rounded-xl px-2 text-center tabular-nums text-xs focus:outline-hidden focus-ring'
export const NUM_INPUT_CLASS = NUM_INPUT_BASE + ' border surface-tray'
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
export const BASE_BTN = 'w-full rounded-2xl border px-4 py-3 text-base shadow-xs select-none'
// ANSWER_GRID_GAP — the ONE gutter every gap-spaced answer grid wears: the weekday grid below
// (worn by Classic/Flash/Blitz/AoX through the single WeekdayAnswer) and all three Deduction
// sub-mode grids plus the Year sizer strut. Deduction's Day and Year used to run gap-2 while
// Month and the weekday grid ran gap-3, so the gutter visibly CHANGED as you switched Deduction
// sub-mode (Q4 round-9); they were widened onto this token, never the reverse. Sharing it also
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
