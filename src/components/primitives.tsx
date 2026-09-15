import type { ReactNode } from 'react'

// primitives.tsx — tiny stateless presentational components reused across the UI.
//
// NewBestStar — the small ★ shown next to a stat value when a new personal best
//               was just set (best Mean / Median / Score panels).
// GroupLabel   — the ⚙ popover's TOP-tier heading (Global, Per-preset).
// SectionLabel — the small uppercase tracking-widest heading used inside the
//                Settings popover (Date Format, Calendar System, Year Range, …).
// Kbd          — the <kbd> chip used by the keyboard-shortcut rows in How-to-Play.
//
// ★★ THE ⚙ PANEL'S HEADING HIERARCHY IS THREE TIERS, AND THE RULE LIVES HERE because this is where
// the two class strings that draw it do. Round-22 Q4 added the top one; the pair below it is
// unchanged, and the convention note in components/SettingsPanel points at this block.
//
//   1. GROUP   — GroupLabel.               Global · Per-preset
//                CENTERED, 11px, semibold, wide tracking, --tx-100-80 (the panel's bright label
//                tone). The panel divides into exactly two of these and everything else nests
//                inside one of them, so they are the only headings that get a rule of their own —
//                a heavier, brighter border-t than any section divider (the class is in
//                SettingsPanel, beside the sections that wear it, because it is a DIVIDER rather
//                than a label).
//   2. SECTION — SectionLabel, LEFT.       Display · Dates · Stats
//                10px, normal weight, --tx-300-60. A category INSIDE a group.
//   3. CAPTION — SectionLabel, CENTERED.   Dark · Light · Written · Numeric
//                The same 10px muted string, centered — a sub-label naming one FAMILY of
//                alternatives within a single setting's picker.
//
// ⚠ TIERS 1 AND 3 ARE BOTH CENTERED AND THAT IS NOT A COLLISION — it is why tier 1 is a separate
// component rather than `<SectionLabel className="text-center">`. Before Q4 the centered spelling
// was RESERVED for tier 3 precisely so it could never out-rank tier 2, and centering the two group
// headings would have re-created exactly that clash. They out-rank tier 2 on three axes at once
// (larger, semibold, and two tone steps brighter) and tier 3 on all three as well, so alignment is
// the one thing they share and never the thing that distinguishes them. Do not "unify" these back
// into one component with a modifier: the reason there are two is that they must not be able to
// drift into looking alike.
//
// Each carries its own className constant (kept beside the component that uses it,
// the single source of truth). Pure visual, no state. Extracted from main.jsx in
// Stage C, Step 4c. (Reset-button class consts + buttonStateClass stayed in
// main.jsx — they belong to the answer-grid / reset-flow code, a separate concern.)

// ★ "new best" star className — appears next to a stat value when a new best was set.
const NEW_BEST_STAR_CLASS = 'text-(--acc) font-bold ml-0.5 text-[8px]'
// Settings popover section label className (small uppercase tracking-widest). Exported for the one
// place that needs the raw class on a non-div element (GuidePage's Divider <span>); everything else
// should use the SectionLabel component.
export const SECTION_LABEL_CLASS = 'text-[10px] uppercase tracking-widest text-(--tx-300-60)'
// The ⚙ panel's TOP-tier group heading (tier 1 above). Shares the uppercase treatment so it still
// reads as the same family of heading, and differs on every other axis: centered rather than left,
// 11px rather than 10, semibold rather than normal, tracking a notch wider than `tracking-widest`
// (0.1em) so the extra weight does not read as merely bolder, and --tx-100-80 — the tone the panel's
// own setting NAMES wear, two steps up from the muted --tx-300-60 the tier below it uses. An
// arbitrary tracking value rather than a Tailwind step because there is none between widest and
// nothing; 0.18em is the measured point where the two sizes' letter rhythm stops matching.
const GROUP_LABEL_CLASS =
  'text-center text-[11px] uppercase font-semibold tracking-[0.18em] text-(--tx-100-80)'
// <kbd> styling used by the keyboard shortcut rows in HtP.
const KBD_CLASS =
  'inline-block panel rounded-sm px-1.5 py-0.5 text-[11px] font-mono min-w-6 text-center shrink-0'

export const NewBestStar = () => <sup className={NEW_BEST_STAR_CLASS}>★</sup>
// ⚠ NO `className` PROP, unlike SectionLabel below, and that is the point rather than an omission:
// SectionLabel takes one because it has to serve two of the three tiers (its centered spelling IS
// tier 3). This heading has exactly one appearance, and a per-call override is how a fourth,
// undocumented tier would appear.
export const GroupLabel = ({ children }: { children?: ReactNode }) => (
  <div className={GROUP_LABEL_CLASS}>{children}</div>
)
export const SectionLabel = ({
  children,
  className = '',
}: {
  children?: ReactNode
  className?: string
}) => <div className={`${SECTION_LABEL_CLASS}${className ? ' ' + className : ''}`}>{children}</div>
export const Kbd = ({ children }: { children?: ReactNode }) => (
  <kbd className={KBD_CLASS}>{children}</kbd>
)
