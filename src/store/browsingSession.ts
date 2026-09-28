// store/browsingSession.ts — is this boot a GENUINE cold open, or a reload inside the same session?
// (round 23 Q2)
//
// ★ THE OWNER'S RULE, which this file is the whole mechanism for: "only truly closing the app starts
// fresh." A reload — Safari's pull-to-refresh, the app's own auto-update reload, the Reload button on
// the error card — is the SAME browsing session, everywhere on the site: the page you were on stays,
// a finished round stays, and a guest's Amnesic preset stays Amnesic with its session stats.
//
// WHY A MARKER IS NEEDED AT ALL. Almost everything session-lived in this app is already right about
// reloads for free, because it lives in sessionStorage (store/sessionMode, store/sessionRound, the
// Amnesic session stats, the session Lookup overflow): a reload keeps sessionStorage and a real close
// clears it, and nothing has to notice either. The one thing that has to ACT on a cold open is the
// Amnesic reseed (src/main.tsx — guest mode reverts to each preset's saved default on the next open),
// and a boot effect cannot tell a reload from a cold open by itself: both mount <App/> from scratch.
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

const MARKER = 'cg-browsing-session-v1'

/**
 * Mark this browsing session as open, and say whether it was ALREADY open. true = a genuine cold
 * open (no marker — a new session), false = a reload inside a session that was already running.
 * Called once, from src/main.tsx's boot effect; a second call in the same page load (React's dev-mode
 * double effect) answers false, which is correct — the first call already acted.
 */
export function openBrowsingSession(): boolean {
  try {
    const cold = window.sessionStorage.getItem(MARKER) === null
    window.sessionStorage.setItem(MARKER, '1')
    return cold
  } catch {
    return true
  }
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
