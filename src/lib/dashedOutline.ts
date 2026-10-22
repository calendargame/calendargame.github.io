// lib/dashedOutline — THE GEOMETRY OF AMNESIC'S DASHED FRAME: the rounded path its line runs along,
// and the whole number of dash-and-gap periods that go round it. components/DashedFrame measures the
// box and draws this; it says why the frame is drawn at all (a dashed border's leftover gap) and why
// these numbers. Pure arithmetic, so tests/dashedFrame can prove it at any size without a layout.

/** The line's width, px — and so the width of the column its dashes cover along each side. */
export const DASHED_LINE = 1.5
/** The dash and the gap, px, before the stretch that makes a whole number of them fit. */
export const DASH = 4.5
export const GAP = 3
/** The dash pattern, in units of one period (the path's length counts as `periods` of them). */
export const DASH_PATTERN = `${DASH / (DASH + GAP)} ${GAP / (DASH + GAP)}`
/** Where along the pattern the path starts: half way along a dash, in the same units. */
export const DASH_OFFSET = DASH / 2 / (DASH + GAP)

export type Box = { width: number; height: number; radius: number }

/**
 * The line for a box: the rounded rectangle its middle runs along, and how many dash-and-gap
 * periods go round it — a whole number, the one nearest to its length at DASH + GAP each. Null for
 * a box too small to draw in.
 * It starts and ends at the middle of the top edge, where DASH_OFFSET puts the middle of a dash: the
 * pattern is then the same on the left of the frame as on the right, mirrored, and the point where
 * the path closes — the one place a pattern that did NOT fit would show — sits in plain view in the
 * middle of a straight edge, where tests/browser/sessionOnlyFrame looks. In a DASH, not a gap,
 * because Chromium draws the two pieces a closed path's dash is cut into at its start as one dash,
 * but drew a gap cut there two thirds of a pixel too long (measured at three widths; WebKit drew
 * both evenly).
 */
export function dashedOutline(box: Box): { d: string; length: number; periods: number } | null {
  if (!(box.width > DASHED_LINE && box.height > DASHED_LINE)) return null
  const { d, length } = outline(box)
  return { d, length, periods: Math.max(1, Math.round(length / (DASH + GAP))) }
}

function outline({ width, height, radius }: Box): { d: string; length: number } {
  const h = DASHED_LINE / 2
  const [x0, y0, x1, y1] = [h, h, width - h, height - h]
  const r = Math.max(0, Math.min(radius - h, (x1 - x0) / 2, (y1 - y0) / 2))
  const arc = (x: number, y: number) => `A ${r} ${r} 0 0 1 ${x} ${y}`
  const middle = (x0 + x1) / 2
  const d = [
    `M ${middle} ${y0}`,
    `H ${x1 - r}`,
    arc(x1, y0 + r),
    `V ${y1 - r}`,
    arc(x1 - r, y1),
    `H ${x0 + r}`,
    arc(x0, y1 - r),
    `V ${y0 + r}`,
    arc(x0 + r, y0),
    `H ${middle}`,
    'Z',
  ].join(' ')
  const length = 2 * (x1 - x0 - 2 * r) + 2 * (y1 - y0 - 2 * r) + 2 * Math.PI * r
  return { d, length }
}
