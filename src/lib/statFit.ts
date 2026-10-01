// lib/statFit.ts — pure fit math for StatPanel's value auto-fit.
//
// Kept in its own module so the component file only exports components (the react-refresh rule), and so
// the math is trivially unit-testable apart from the DOM wiring (StatPanel measures each value box and
// applies the scale; that part is verified on-device — jsdom has no layout engine).

// The scale to apply to a value so its NATURAL rendered width fits the AVAILABLE box width — capped at 1
// so a value never enlarges past the base font (text-sm). 0 / invalid inputs → 1 (a no-op — e.g. jsdom,
// where element widths are always 0). Because the values use `tabular-nums` (every digit the same advance
// width), a value's width is a clean function of its characters, so this scales smoothly with no
// per-digit jitter.
export const fitScale = (natural: number, avail: number): number =>
  natural > 0 && avail > 0 ? Math.min(1, avail / natural) : 1

// The GROUP version (Round-2, footer-button fit): one scale for a set of labels that must all
// shrink together — the tightest label's ratio governs, capped at 1, and any invalid pair
// (0/negative width — e.g. jsdom) contributes 1 exactly like fitScale, so a partial measure never
// shrinks the group. Pairs are positional: naturals[i] fits into avails[i].
export const sharedFitScale = (naturals: number[], avails: number[]): number =>
  naturals.reduce((scale, natural, i) => Math.min(scale, fitScale(natural, avails[i] ?? 0)), 1)
