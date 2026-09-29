// ─────────────────────────────────────────────────────────────────────────
// dotLayout.ts — the 7-dot answer layout's grid geometry (single source of truth)
//
// The logo's 7-position layout used by the Dots answer input (Settings → Display →
// Input; components/WeekdayAnswer) AND by How-to-Play's labelled DotDiagram
// (components/GuidePage) — both derive from THIS file, so the diagram can never drift
// from the real input. The array index is the weekday (0=Sun..6=Sat), so the dot
// buttons stay in DOM order Sun..Sat (the keyboard 0–9 path reads children[idx]); each
// entry is the 1-indexed CSS grid cell (row r, column c) the dot is placed in.
//
// ★ THE LAYOUT HAS THREE ROTATIONS (Settings → Display → Rotate Dots: Standard / 45° CCW /
// 90° CCW), and this file is where the two turned ones are BUILT rather than typed out.
// The standard one below matches the app icon / W5Logo coordinate for coordinate: Sun
// centre, Mon bottom-right, Tue mid-right, Wed top-right, Thu bottom-left, Fri mid-left,
// Sat top-left, with centre-top (r1,c2) + centre-bottom (r3,c2) empty — an H lying against
// the grid's two side columns. 90° stands the H up along the rows; 45° turns it halfway,
// onto the diagonals.
// ─────────────────────────────────────────────────────────────────────────

/** How far the 7-dot layout is turned, counterclockwise — the ⚙ setting itself (Settings →
 *  Display → Rotate Dots, store/settings' `dotRotation`), and the key every geometry table below
 *  is indexed by. ONE type for both: the setting has exactly as many values as there are
 *  layouts, so a second, "geometric" name for the same three values would only be a mapping to
 *  keep in step. (Until round 23 the setting was the boolean `rotateDots` and a two-valued
 *  `DotOrientation` sat here with a function translating one into the other; a three-way pill made
 *  the translation pure duplication.) String values, not degrees as numbers, because the ⚙ pill
 *  tray is generic over string unions and a stored `45` would read as a count. */
export type DotRotation = 'standard' | 'ccw45' | 'ccw90'
/** The three rotations in the order the ⚙ pill tray shows them — and the whole set a stored value
 *  is screened against (store/settings' migrateDotRotation). */
export const DOT_ROTATIONS: readonly DotRotation[] = ['standard', 'ccw45', 'ccw90']
export const isDotRotation = (v: unknown): v is DotRotation =>
  typeof v === 'string' && (DOT_ROTATIONS as readonly string[]).includes(v)

/** A 1-indexed CSS grid cell inside the cluster's lattice (3×3, or 5×5 for 45° — DOT_GRID_SIZE). */
export type DotCell = { r: number; c: number }

// The canonical standard layout — the app icon's own coordinates (see the header note).
const STANDARD: ReadonlyArray<DotCell> = [
  { r: 2, c: 2 }, // 0 Sunday    — centre
  { r: 3, c: 3 }, // 1 Monday    — bottom-right
  { r: 2, c: 3 }, // 2 Tuesday   — mid-right
  { r: 1, c: 3 }, // 3 Wednesday — top-right
  { r: 3, c: 1 }, // 4 Thursday  — bottom-left
  { r: 2, c: 1 }, // 5 Friday    — mid-left
  { r: 1, c: 1 }, // 6 Saturday  — top-left
]

// A 90° quarter-turn COUNTERCLOCKWISE in a 1-indexed 3×3: (r,c) → (4−c, r). Read it off the
// corners — top-left (1,1) lands bottom-left (3,1), top-right (1,3) lands top-left
// (1,1) — and the centre (2,2) is its own image, which is why Sunday never moves.
// ★ COMPUTED, NOT TYPED OUT, and that is the point: a hand-written second array is a
// second thing to keep true, and the ONE test that would catch a typo in it is the same
// test that would have to hold its own copy of the answer. Rotating the canonical array
// makes "the orientations are the same seven days" a fact of construction.
const rotateCcw90 = ({ r, c }: DotCell): DotCell => ({ r: 4 - c, c: r })

// A 45° eighth-turn COUNTERCLOCKWISE, onto a 5×5 lattice: (r,c) → (r − c + 3, r + c − 1).
// Centred on the middle cell (u = c−2, v = r−2, screen y pointing down), a CCW turn by 45° is
// (u,v) → ((u+v)/√2, (v−u)/√2); scaling by √2 keeps every position on whole numbers — that is
// the lattice — at the price of a grid 5 cells across instead of 3. Read it off the corners: top-
// right (1,3) lands top-centre (1,3), top-left (1,1) lands middle-left (3,1), and the centre (2,2)
// lands (3,3), the lattice's own centre. Every image has r + c even, so the seven dots (and the two
// empty cells, which land at (2,2) and (4,4)) sit on a CHECKERBOARD: the odd cells between them are
// space, never a dot. Two turns of this are one rotateCcw90, which is the check that it turns the
// right way. Computed for the same reason as rotateCcw90 above.
const rotateCcw45 = ({ r, c }: DotCell): DotCell => ({ r: r - c + 3, c: r + c - 1 })

/** Weekday index (0=Sun..6=Sat) → grid cell, per rotation. Callers index it with the live
 *  setting: DOT_CELLS[dotRotation][i]. */
export const DOT_CELLS: Record<DotRotation, ReadonlyArray<DotCell>> = {
  standard: STANDARD,
  ccw45: STANDARD.map(rotateCcw45),
  ccw90: STANDARD.map(rotateCcw90),
}

/** How many cells across (and down) each rotation's grid is. index.css states the same fact for
 *  the input (`.dot-cluster[data-dot-rotation="ccw45"]`'s repeat(5,…)); GuidePage's DotDiagram
 *  reads it from here. */
export const DOT_GRID_SIZE: Record<DotRotation, 3 | 5> = { standard: 3, ccw45: 5, ccw90: 3 }

/** ★ THE 45° LAYOUT IS THE STANDARD ONE, TURNED AND SCALED BY THIS — dots and spacing together,
 *  so it is the same shape, only smaller. A rigid 45° turn of the 3×3 needs √2 × the room (its
 *  corners swing out to the diagonal), and the cluster's square box cannot grow: on a phone it is
 *  already as tall as the answer panel allows. Shrinking only the SPACING was rejected — the dots
 *  would touch and their hit areas collapse. 0.8 is the owner-approved ~75–80%, taken at the top
 *  of the range for the bigger targets; it still leaves the outermost dots ~2.7% of the box clear
 *  of its edge, which is room for the 2px drag ring. Standard and 90° are NOT scaled — they fit as
 *  they are, and only one layout is ever on screen.
 *  ⚠ STATED TWICE, because CSS cannot import it: index.css's `--dot-scale` on the 45° cluster
 *  is the same number, and tests/dotRotation checks the two agree. W5Logo's mark uses it through
 *  DOT_MARK_ROTATION below, so the logo turns exactly as the input does. */
export const DIAGONAL_DOT_SCALE = 0.8

// ★ THE EASTER EGG'S ONE LINE. The app mark IS this layout — the W5 glyph draws its
// seven board dots on exactly these cells — so the mark turns with the setting
// (components/W5Logo). The mark is DECORATIVE (aria-hidden, the <h1> beside it carries
// the name), so unlike the input it may turn with a plain CSS transform: there is no
// reading order and no keyboard order to keep honest, and rebuilding the SVG's
// coordinates would buy nothing but a second geometry to maintain. The 45° mark is scaled
// by DIAGONAL_DOT_SCALE, exactly like the 45° input, which also keeps the turned glyph's
// overhang to about the pixel the 90° turn already has (W5Logo's header measures it).
//   ⚠ WHAT CANNOT FOLLOW, so nobody later files it as a bug: the home-screen icon, the
//     iOS launch PNGs (public/apple-splash-*, which are pre-renders of index.html's
//     #boot splash) and the OG card are static FILES. They keep the standard mark
//     whatever this setting says — and so, deliberately, do the three full-screen
//     frames that stand next to them: #boot, the Updating overlay (documented as kept
//     identical to #boot, and shown back-to-back with it on the auto-update path) and
//     the rotate-back overlay (which exists to speak the splash's visual language at
//     the splash's exact size). Turning those would flip the mark mid-launch against a
//     PNG that cannot flip with it. The TITLE BAR is where the player's own mark is
//     drawn, and it is the drawing that follows them; components/W5Logo's `dotRotation`
//     prop defaults to the canonical standard form precisely so a caller has to ASK.
export const DOT_MARK_ROTATION: Record<DotRotation, string> = {
  standard: 'none',
  // CSS turns clockwise for a positive angle; the dots turn CCW.
  ccw45: `rotate(-45deg) scale(${DIAGONAL_DOT_SCALE})`,
  ccw90: 'rotate(-90deg)',
}
