import W5Logo from './W5Logo.jsx'

// RotateOverlay (Q11) — the full-screen "rotate back to portrait" screen for the platforms the
// manifest's orientation:'portrait' can't hard-lock (iOS parses + ignores the key; locked
// Android installs never rotate, so they never see this). Rendered by App while
// landscapeBlocked (touch device + CSS landscape + short viewport — the gate lives in App so
// the same boolean also pauses the countdown modes via clockPaused). Speaks the boot-splash
// visual language: the same .boot-overlay/.boot-mark/.boot-glow frame as #boot / BootOverlay
// (theme-aware bg + light-theme logo recolor come from those classes) with the W5 mark at the
// splash's exact size (W5Logo size 188 = the 174×188 splash glyph — no duplicated SVG). The
// fixed z-100 cover also blocks every interaction with the sideways app beneath it; rotating
// back unmounts it, no dismiss affordance by design.
// ⚠ IT DELIBERATELY DOES NOT PASS `dotOrientation`, so the mark here stays upright even when the
// player has turned the Dots layout (Settings → Display → Rotate Dots CCW) and the TITLE BAR's mark has
// turned with it. That is the whole reason W5Logo's prop defaults to upright: this frame is the
// splash's glyph at the splash's size, and the splash is pinned to the static iOS launch PNGs
// (public/apple-splash-*) that are pre-renders of index.html's #boot and can follow nothing. Turn
// this one and the mark flips against a PNG that cannot. The argument in full is at W5Logo and at
// lib/dotLayout's DOT_MARK_ROTATION; if the mismatch is ever reported as a bug, it is this comment
// and not the code that should be read first.
function RotateOverlay() {
  return (
    <div className="boot-overlay">
      <div className="boot-mark">
        <div className="boot-glow" />
        <W5Logo size={188} />
      </div>
      <div className="rotate-caption">Rotate back to portrait</div>
    </div>
  )
}

export default RotateOverlay
