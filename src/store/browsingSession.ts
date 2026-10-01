// store/browsingSession.ts — is this boot a GENUINE cold open, or a reload inside the same session?
//
// ★ THE OWNER'S RULE, which this file is the whole mechanism for: "only truly closing the app starts
// fresh." A reload — Safari's pull-to-refresh, the app's own auto-update reload, the Reload button on
// the error card — is the SAME browsing session, everywhere on the site: the page you were on stays,
// a finished round stays, and a guest's Amnesic preset stays Amnesic with its session stats.
//
// WHY A MARKER IS NEEDED AT ALL. Almost everything session-lived in this app is already right about
// reloads for free, because it lives in sessionStorage (store/sessionMode, store/sessionRound,
// store/sessionHistory, store/sessionGuide, the Amnesic session stats, the session Lookup overflow):
// a reload keeps sessionStorage and a real close clears it, and nothing has to notice either. The one
// things that have to ACT on a cold open are the Amnesic reseed (src/main.tsx — guest mode reverts to
// each preset's saved default on the next open) and the "Open in" pin (store/presets — a fresh open
// lands in the pinned preset, a reload stays where the player was), and neither can tell a reload
// from a cold open by itself: both boot the page from scratch.
// Round 21 ran the reseed on every mount and called a reload "a reopen"; the owner reversed that.
// So the question is asked of sessionStorage itself: the marker below is written on the first boot of
// a session and survives every reload of it, so its ABSENCE is exactly "the browser started a new
// session" — the same fact everything else here already leans on, read from the same place.
//
// ⚠ A BROWSER THAT REFUSES sessionStorage answers "cold" every time. That is the consistent answer
// rather than a guess: in such a browser the Amnesic session stats were never written anywhere but
// memory, so a reload has ALREADY thrown the guest's session away — reseeding the flag to its saved
// default is the only state that matches what is left.
// ⚠ ⚠ UNVERIFIABLE FROM HERE: that swiping the installed iOS app away clears its sessionStorage (the
// expected behaviour — a new process, a new browsing session). The owner checks it on his device.

// ⚠ index.html's pre-React boot script reads this key too (it has to resolve the preset a load opens
// in before any module exists — see browsingSessionOpen below); tests/bootTheme.dom runs that script
// against this file's marker, so the two spellings cannot drift.
const MARKER = 'cg-browsing-session-v1'

/**
 * Is this browsing session ALREADY open — i.e. is this page load a reload inside it rather than a
 * fresh open? A pure read, for the one thing that has to know BEFORE the app has booted: the
 * "Open in" pin (store/presets' hydrate `merge`, and index.html's boot script beside it), which
 * decides the preset a FRESH OPEN lands in and must leave a reload on the preset the player was on.
 * False in a browser that refuses sessionStorage, for the reason given in the header.
 */
export function browsingSessionOpen(): boolean {
  try {
    return window.sessionStorage.getItem(MARKER) !== null
  } catch {
    return false
  }
}

/**
 * Mark this browsing session as open, and say whether it was ALREADY open. true = a genuine cold
 * open (no marker — a new session), false = a reload inside a session that was already running.
 * Called once, from src/main.tsx's boot effect; a second call in the same page load (React's dev-mode
 * double effect) answers false, which is correct — the first call already acted.
 */
export function openBrowsingSession(): boolean {
  const cold = !browsingSessionOpen()
  try {
    window.sessionStorage.setItem(MARKER, '1')
  } catch {
    /* storage refused — every load is a cold open here (see the header) */
  }
  return cold
}

/**
 * Forget the marker, i.e. "the browser closed". The app never needs this — a real close clears the
 * session and the browser does that — but the test harness has no close event, so tests/setup/dom.js
 * calls it before every test (the same reason it resets the session page and parked-round singletons),
 * which makes each test's first mount the cold open a new visit would be.
 */
export function forgetBrowsingSession(): void {
  try {
    window.sessionStorage.removeItem(MARKER)
  } catch {
    /* storage refused — nothing was ever written */
  }
}
