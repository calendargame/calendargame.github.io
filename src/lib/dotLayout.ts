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
// ★ THE LAYOUT NOW HAS TWO ORIENTATIONS (Settings → Display → Dot Layout), and this
// file is where the second one is BUILT rather than typed out. The upright one below
// matches the app icon / W5Logo coordinate for coordinate: Sun centre, Mon
// bottom-right, Tue mid-right, Wed top-right, Thu bottom-left, Fri mid-left, Sat
// top-left, with centre-top (r1,c2) + centre-bottom (r3,c2) empty. Seen as a picture
// it is an H lying against the grid's two side columns — which is exactly what the
// setting's two labels name: the weekday triples run down COLUMNS, or (rotated) along
// ROWS.
// ─────────────────────────────────────────────────────────────────────────

/** Which way the 7-dot layout is turned. The names describe WHAT YOU SEE — the two
 *  weekday triples running down the side columns, or along the top and bottom rows —
 *  deliberately not "rotate", which in this app already means "turn your device"
 *  (components/RotateOverlay). This is the GEOMETRY's own type — two physical layouts — and it
 *  stays two-valued even though the ⚙ setting that picks one (Settings → Display, `rotateDots`
 *  in store/settings) is a boolean: the picker's two named options were always an on/off shape,
 *  but a grid cell still has to be told WHICH of the two layouts to place a dot on. */
export type DotOrientation = 'columns' | 'rows'

/** The boolean setting → the geometry it selects. The ONE place that ternary is written — every
 *  consumer (main.tsx's W5Logo and the four mode screens, WeekdayAnswer, GuidePage's DotDiagram)
 *  derives through this function rather than repeating `rotateDots ? 'rows' : 'columns'` at each
 *  call site, which is exactly the class of duplication this codebase's own comments warn against
 *  (see aoxBest.ts / modeFormat.ts's shared roundCentis). Callers differ only in what they gate
 *  the ARGUMENT on — W5Logo additionally requires `inputStyle==='dots'` (there is nothing on
 *  screen for the mark to correspond to otherwise), while WeekdayAnswer and DotDiagram pass
 *  `rotateDots` straight through for their own separate reasons (see each call site). */
export const dotOrientationFor = (rotateDots: boolean): DotOrientation =>
  rotateDots ? 'rows' : 'columns'

/** A 1-indexed CSS grid cell inside the 3×3 cluster. */
export type DotCell = { r: number; c: number }

// The canonical upright layout — the app icon's own coordinates (see the header note).
const COLUMNS: ReadonlyArray<DotCell> = [
  { r: 2, c: 2 }, // 0 Sunday    — centre
  { r: 3, c: 3 }, // 1 Monday    — bottom-right
  { r: 2, c: 3 }, // 2 Tuesday   — mid-right
  { r: 1, c: 3 }, // 3 Wednesday — top-right
  { r: 3, c: 1 }, // 4 Thursday  — bottom-left
  { r: 2, c: 1 }, // 5 Friday    — mid-left
  { r: 1, c: 1 }, // 6 Saturday  — top-left
]

// A quarter turn COUNTERCLOCKWISE in a 1-indexed 3×3: (r,c) → (4−c, r). Read it off the
// corners — top-left (1,1) lands bottom-left (3,1), top-right (1,3) lands top-left
// (1,1) — and the centre (2,2) is its own image, which is why Sunday never moves.
// ★ COMPUTED, NOT TYPED OUT, and that is the point: a hand-written second array is a
// second thing to keep true, and the ONE test that would catch a typo in it is the same
// test that would have to hold its own copy of the answer. Rotating the canonical array
// makes "the two orientations are the same seven days" a fact of construction.
const rotateCcw = ({ r, c }: DotCell): DotCell => ({ r: 4 - c, c: r })

/** Weekday index (0=Sun..6=Sat) → grid cell, per orientation. Callers index it with the
 *  live setting: DOT_CELLS[dotOrientation][i]. */
export const DOT_CELLS: Record<DotOrientation, ReadonlyArray<DotCell>> = {
  columns: COLUMNS,
  rows: COLUMNS.map(rotateCcw),
}

// ★ THE EASTER EGG'S ONE LINE. The app mark IS this layout — the W5 glyph draws its
// seven board dots on exactly these cells — so the mark turns with the setting
// (components/W5Logo). The mark is DECORATIVE (aria-hidden, the <h1> beside it carries
// the name), so unlike the input it may turn with a plain CSS transform: there is no
// reading order and no keyboard order to keep honest, and rebuilding the SVG's
// coordinates would buy nothing but a second geometry to maintain.
//   ⚠ WHAT CANNOT FOLLOW, so nobody later files it as a bug: the home-screen icon, the
//     iOS launch PNGs (public/apple-splash-*, which are pre-renders of index.html's
//     #boot splash) and the OG card are static FILES. They keep the upright mark
//     whatever this setting says — and so, deliberately, do the three full-screen
//     frames that stand next to them: #boot, the Updating overlay (documented as kept
//     identical to #boot, and shown back-to-back with it on the auto-update path) and
//     the rotate-back overlay (which exists to speak the splash's visual language at
//     the splash's exact size). Turning those would flip the mark mid-launch against a
//     PNG that cannot flip with it. The TITLE BAR is where the player's own mark is
//     drawn, and it is the drawing that follows them; components/W5Logo's `dotOrientation`
//     prop defaults to the canonical upright form precisely so a caller has to ASK.
export const DOT_MARK_ROTATION: Record<DotOrientation, string> = {
  columns: 'none',
  rows: 'rotate(-90deg)', // CSS turns clockwise for a positive angle; the dots turn CCW.
}
