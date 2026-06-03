// constants.js — small shared constants used across modules.
//
// CODES_CLOSE_MS — how long the codes panel holds its "frozen" date values after
// the user hides it, before releasing to the latest values. Must be ≥ the CSS
// .expander close animation (0.28s) plus a small buffer so the panel's contents
// don't visibly change while it's still sliding shut. Shared by the codes panel
// (MethodBreakdownSection) and AoxMode's own frozen-date logic.
//
// Extracted from main.jsx in Stage C, Step 4f/4g (it became a cross-module
// shared value once the codes panel moved to its own file).
export const CODES_CLOSE_MS = 310 // frozen-date unfreeze delay; >= CSS .expander close (.28s) + small buffer
