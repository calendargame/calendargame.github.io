import type { ReactNode } from 'react'

// primitives.tsx — tiny stateless presentational components reused across the UI.
//
// NewBestStar — the small ★ shown next to a stat value when a new personal best
//               was just set (best Mean / Median / Score panels).
// SectionLabel — the small uppercase tracking-widest heading used inside the
//                Settings popover (Date Format, Calendar System, Year Range, …).
// Kbd          — the <kbd> chip used by the keyboard-shortcut rows in How-to-Play.
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
// <kbd> styling used by the keyboard shortcut rows in HtP.
const KBD_CLASS =
  'inline-block panel rounded-sm px-1.5 py-0.5 text-[11px] font-mono min-w-6 text-center shrink-0'

export const NewBestStar = () => <sup className={NEW_BEST_STAR_CLASS}>★</sup>
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
