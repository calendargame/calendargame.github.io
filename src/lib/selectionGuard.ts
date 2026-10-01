// lib/selectionGuard.ts — the GuideSection header-toggle guard predicate.
//
// Kept apart from the component (components/GuidePage.tsx) for the same reason as
// lib/sliderValue.ts: the component file only exports components (the react-refresh rule),
// and the decision is trivially unit-testable without rendering anything.
//
// Why it exists: guide section titles are selectable (`select-text` on the title span),
// but the title lives inside the header <button> — so a desktop drag-select across a
// title fires the button's click on mouse-up, and toggling there would collapse the
// panel out from under the selection the user just made. Suppress the toggle exactly
// when the selection is BOTH non-collapsed (a real range, not a bare caret — every
// ordinary click leaves a collapsed selection) AND anchored inside the clicked header —
// a selection elsewhere on the page must not eat taps on other section headers.
export const selectionSuppressesToggle = (
  sel: Pick<Selection, 'isCollapsed' | 'anchorNode'> | null,
  header: Node,
): boolean =>
  sel !== null && !sel.isCollapsed && sel.anchorNode !== null && header.contains(sel.anchorNode)
