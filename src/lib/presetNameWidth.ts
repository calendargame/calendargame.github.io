import { PRESET_NAME_COL, PRESET_NAME_CELL_SELECTOR } from '../components/PresetSwitcher.jsx'

// lib/presetNameWidth.ts — THE LIVE, PIXEL-WIDTH CAP on a preset name AS IT IS TYPED (Q6, round
// 20), replacing the fixed MAX_PRESET_NAME=12 character cap that used to be the only thing
// stopping a keystroke in the rename field (components/PresetManager).
//
// ★★ THE MECHANISM, resolved in conversation with the owner rather than picked here. The rename
// field lives in a ⚙ modal with plenty of its own width — NOT the constraint. The constraint is a
// DIFFERENT, separately-mounted control: the preset switcher's own rendered name cell, in the
// fixed top bar (components/PresetSwitcher). His own words, choosing the switcher's budget over
// the modal field's: "it's the switcher's tighter one of course since that's what determines how
// much can be displayed." So every keystroke measures the CANDIDATE text's real rendered pixel
// width against the switcher's CURRENT live cell width, and refuses (or truncates, for a
// paste-shaped change bigger than one keystroke) whatever would not fit — the same shape as a
// native `maxLength` refusing a keystroke, just width-based instead of count-based.
//
// ★ WHY THIS FILE, AND WHY THE SPLIT INSIDE IT. Two things live here that would otherwise have to
// live inside components/PresetManager, and both are worth pulling out for the same reason
// lib/statFit and lib/sliderValue already are: the DECISION is pure and trivially testable, the
// MEASUREMENT is not (it needs a live canvas and a live DOM element, neither of which jsdom
// provides — its `HTMLCanvasElement.getContext('2d')` returns `null` rather than implementing
// anything, verified empirically rather than assumed, see the test file, and tests/setup/dom.js
// silences the "not implemented" warning that call logs). `measureTextWidthPx` below degrades to a
// 0-width measurement whenever that happens, so every candidate "fits" in a plain jsdom test unless
// a test deliberately fakes the canvas back in. Keeping the pure predicate
// (`fitsWithinWidth`) separate from the impure measurement (`measureTextWidthPx`,
// `readSwitcherBudget`) is what lets the DECISION be tested directly with fabricated numbers, while
// a thinner integration test proves only that PresetManager's wiring calls the right functions.
//
// ── THE CROSS-COMPONENT WIDTH READ ────────────────────────────────────────────────────────────
//
// ★★ THIS IS THE HARD PART, AND IT IS SOLVED BY FOLLOWING AN EXISTING HOUSE PATTERN RATHER THAN
// INVENTING ONE. The rename field (mounted inside a ⚙ modal) and the switcher's name cell (mounted
// in the fixed top bar) are SIBLINGS somewhere far up the tree, not parent and child, so React
// props and context have no clean path between them — the same shape of problem this app has
// already solved by reaching across the DOM directly where its own tree does not offer a path:
// main.tsx's `document.querySelector('[data-settings-modal]')`, the game's
// `document.querySelectorAll('[data-key="..."]')` shortcuts, `[data-answer-grid="true"]`.
// `readSwitcherBudget` below is the same idiom: `PRESET_NAME_CELL_SELECTOR`
// (components/PresetSwitcher) names a stable `data-*` hook on the switcher's own flexible name
// cell — not the whole trigger, the cell specifically, which is the element whose ACTUAL rendered
// width is the number that matters — and this function reads it fresh, at the moment it is
// needed, with no ref-forwarding chain and no store of its own to keep in sync.
//
// ⚠ THE FALLBACK, for the element-not-found case components/PresetSwitcher documents as
// "impossible in practice" (the top bar is always mounted) — coded defensively anyway, because
// "impossible in practice" is not "impossible", and this suite mounts PresetManager on its own in
// several places with no top bar at all.
//   CHOSEN: refuse to grow the cap past a SAFE MINIMUM, rather than fall back to the old
//   character-count behaviour. The character count doesn't answer "how many pixels" — the whole
//   reason this file exists — and falling back to it could let a name back in that the (missing)
//   switcher might not actually be able to show, which is the exact failure this mechanism exists
//   to prevent. The minimum below is the switcher's own documented FLOOR (PRESET_NAME_COL,
//   components/PresetSwitcher) converted to a pixel estimate at a conservative root font size, so
//   the fallback promises no more than the switcher is guaranteed to render at minimum — never a
//   number invented independently of the control it is standing in for.
const FALLBACK_ROOT_PX = 15.6 // index.css's fluid clamp at its narrowest common case (360×800)
// Parsed FROM PRESET_NAME_COL rather than re-typed as a literal, so this can never silently drift
// from the floor it is standing in for if that constant is ever tuned.
const FALLBACK_EM = parseFloat(PRESET_NAME_COL)
const FALLBACK_BUDGET_PX = FALLBACK_EM * 0.875 * FALLBACK_ROOT_PX // 6em at text-sm (0.875rem) ≈ 82px
const FALLBACK_FONT = `${(0.875 * FALLBACK_ROOT_PX).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`

export interface SwitcherBudget {
  /** The switcher's name cell, as it is rendered on screen RIGHT NOW — not an estimate. */
  widthPx: number
  /** That cell's own computed font, read straight off the live element via getComputedStyle, so a
   *  candidate is measured in the SAME font it will actually be shown in rather than a guess at it. */
  font: string
}

/**
 * Read the preset switcher's live rendered name-cell width and font. Returns `null` when the cell
 * cannot be found (or reports a non-positive width, which jsdom's zero-everywhere layout always
 * does — see the test file for how that path is exercised) — the caller falls back to
 * FALLBACK_BUDGET_PX / FALLBACK_FONT rather than trusting a number that cannot be real.
 */
export function readSwitcherBudget(): SwitcherBudget | null {
  let cell: Element | null
  try {
    cell = document.querySelector(PRESET_NAME_CELL_SELECTOR)
  } catch {
    return null
  }
  if (!cell) return null
  const rect = cell.getBoundingClientRect()
  if (!(rect.width > 0)) return null
  return { widthPx: rect.width, font: getComputedStyle(cell).font }
}

// A shared, lazily-created canvas — one per module load, not one per keystroke. jsdom does not
// implement canvas at all: `getContext('2d')` there returns `null` rather than throwing (verified
// — see tests/presetNameWidth.dom.test.js's own probe case), which the plain null-check below
// already handles. The try/catch is for a REAL browser that has canvas disabled outright (some
// locked-down configurations throw on the property access itself, the same shape store/presets'
// presetScopedStorage already guards against for localStorage) — a case this suite cannot
// reproduce but code should not assume away.
let sharedCanvas: HTMLCanvasElement | null = null
const get2dContext = (): CanvasRenderingContext2D | null => {
  try {
    if (!sharedCanvas) sharedCanvas = document.createElement('canvas')
    return sharedCanvas.getContext('2d')
  } catch {
    return null
  }
}

/**
 * The real rendered pixel width of `text` set in `font` (a CSS font shorthand, as returned by
 * `getComputedStyle(...).font`). 0 wherever canvas is unavailable (this suite's jsdom, or a
 * browser that has disabled it) — the same "measure nothing, refuse nothing" degradation
 * lib/statFit's fitScale already uses for a 0-width measurement.
 */
export const measureTextWidthPx = (text: string, font: string): number => {
  const ctx = get2dContext()
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

// ── THE PURE DECISION ─────────────────────────────────────────────────────────────────────────
//
// "Does this candidate fit in this budget" — kept apart from both measurement functions above
// specifically so it can be unit-tested with FABRICATED widths, independent of canvas or the DOM.
export const fitsWithinWidth = (measuredWidthPx: number, budgetPx: number): boolean =>
  measuredWidthPx <= budgetPx

/**
 * Given a candidate that does NOT fit, find the longest PREFIX that does — the same shape as a
 * native `maxLength` truncating an over-length paste rather than refusing the whole edit. A plain
 * character-by-character trim rather than a binary search: preset names are short by the time this
 * ever runs (store/presets' MAX_PRESET_NAME is the outer bound on anything reaching this function
 * at all), so the loop is cheap, and unlike a binary search over a proportional font it never has
 * to reason about whether width is monotonic in some clever partial way — it just is what it is.
 */
export function fitTextToWidth(text: string, font: string, budgetPx: number): string {
  let fitted = text
  while (fitted.length > 0 && !fitsWithinWidth(measureTextWidthPx(fitted, font), budgetPx)) {
    fitted = fitted.slice(0, -1)
  }
  return fitted
}

export interface CandidateResult {
  /** What the field should show — `candidate` unchanged if it fit, its longest fitting prefix if not. */
  text: string
  /** Whether anything had to be cut. Drives the width-language rejection note in PresetManager. */
  capped: boolean
}

/**
 * The one call components/PresetManager's rename field makes on every keystroke: reads the
 * switcher's live budget (falling back to the safe minimum above when it cannot), measures the
 * candidate against it, and returns what the field should actually show.
 */
export function capCandidateToSwitcherWidth(candidate: string): CandidateResult {
  const budget = readSwitcherBudget()
  const widthPx = budget?.widthPx ?? FALLBACK_BUDGET_PX
  const font = budget?.font ?? FALLBACK_FONT
  if (fitsWithinWidth(measureTextWidthPx(candidate, font), widthPx)) {
    return { text: candidate, capped: false }
  }
  return { text: fitTextToWidth(candidate, font, widthPx), capped: true }
}
