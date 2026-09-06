import { DOT_MARK_ROTATION, type DotOrientation } from '../lib/dotLayout.js'
// W5Logo — the in-app brand mark beside the title (Stage D3). It's the glyph from the app
// icon (design/icons/icon-piday-trace.svg): the Pi-Day 3/14/1592 day-of-week trace, finger
// positions 2 -> 3 -> 6 landing on the circled answer (6 = Saturday), with the rest of the
// 7-position board as faint dots.
//
// Theme-aware: everything is drawn in `currentColor`, so it inherits the title's text color
// and stays legible on all five themes (light-on-dark for dusk/midnight/nebula, dark-on-light
// for light/parchment) — no per-theme overrides needed. Decorative (aria-hidden); the adjacent
// <h1> carries the accessible name. The viewBox tightly frames the glyph (drawn in the icon's
// 512 coordinate space) so it sits at text height without the icon's purple tile/background.
//
// ★ IT TURNS WITH THE DOT LAYOUT (Settings → Display → Dot Layout), and that is not decoration
// for its own sake: the seven board dots below sit on the SAME seven cells the Dots answer input
// uses (x 202/256/310 = columns 1/2/3, y 196/256/316 = rows 1/2/3 — check them against
// lib/dotLayout's array and they match one for one). How-to-Play tells the player the dots are the
// logo's layout, so a mark that stayed upright while the input turned would make the guide wrong.
//   WHY A PROP, NOT A STORE READ, and why it defaults to UPRIGHT: the mark is drawn twice and only
//   ONE of the two follows the player. The title bar is app chrome and gets `dotOrientation` from
//   App. The rotate-back overlay (components/RotateOverlay) deliberately does NOT pass it: that
//   screen exists to speak the boot splash's visual language at the splash's exact size, and the
//   splash — index.html's #boot, plus the Updating overlay kept identical to it — is pinned to the
//   static iOS launch PNGs (public/apple-splash-*) that are pre-renders of it. A frame that turned
//   while the PNG in front of it could not would flip the mark mid-launch. So the DEFAULT is the
//   canonical brand mark and a caller has to ASK for the player's; lib/dotLayout's DOT_MARK_ROTATION
//   carries the same argument, and the list of static files that can never follow.
//   WHY A CSS TRANSFORM IS ALLOWED HERE when the input's rotation had to be a data change: this
//   glyph is aria-hidden and has no children anything can focus, read out or hit-test, so there is
//   no order for a visual-only turn to falsify. It is applied to the OUTER <svg>, which in HTML
//   flow is a replaced element — so the turn pivots on the element's own centre and the layout box
//   is untouched (24×26 here; the ~1px each side the turned glyph overhangs is inside the flex
//   row's own gap, and `shrink-0` keeps the title from moving either way).
export default function W5Logo({
  className = '',
  size = 26,
  dotOrientation = 'columns',
}: {
  className?: string
  size?: number
  dotOrientation?: DotOrientation
}) {
  const width = Math.round((146 / 158) * size)
  return (
    <svg
      width={width}
      height={size}
      viewBox="178 173 146 158"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ transform: DOT_MARK_ROTATION[dotOrientation] }}
    >
      {/* faint board dots not on the trace (positions 0, 1, 4, 5) */}
      <g fill="currentColor" opacity="0.3">
        <circle cx="256" cy="256" r="10" />
        <circle cx="310" cy="316" r="10" />
        <circle cx="202" cy="316" r="10" />
        <circle cx="202" cy="256" r="10" />
      </g>
      {/* the trace: 2 -> 3 -> 6, one smooth flowing curve (shape W5) */}
      {/* trace dimmed 0.7 — matches the icon master (line dimmer than dots); keep #boot / W5Logo / BootOverlay identical */}
      <path
        d="M310,256 C313,226 313,206 310,196 C300,184 240,184 202,196"
        stroke="currentColor"
        strokeOpacity={0.7}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* on-path nodes 2, 3 (aligned on the right column) */}
      <g fill="currentColor">
        <circle cx="310" cy="256" r="10" />
        <circle cx="310" cy="196" r="10" />
      </g>
      {/* the landed answer (6 = Saturday), circled */}
      <circle cx="202" cy="196" r="9" fill="currentColor" />
      <circle cx="202" cy="196" r="19" fill="none" stroke="currentColor" strokeWidth="5" />
    </svg>
  )
}
