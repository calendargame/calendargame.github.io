// THE ⚙ SETTINGS PANEL, as an ABSTRACTION — the one place in the suite that is allowed to know
// WHERE the panel lives and HOW it is reached.
//
// WHY THIS FILE EXISTS, and it is the same reason tests/helpers/guideScroller.jsx exists. The
// panel is about to be lifted out of the 2,287-line App component in src/main.tsx, and the gate on
// that move is falsifiable and absolute: THE BEHAVIOUR NET PASSES WITH ZERO EDITS. A test that has
// to be edited on the far side of a move proves nothing about the move — it proves only that
// somebody made it green again. Round 13 established the pattern (the guide's scroller was
// abstracted one group AHEAD of the move it was built for, and passing unchanged is what made that
// round trustworthy); this is the same play for the settings panel.
//
// So before a single line of main.tsx is restructured, every existing test that was written
// against WHERE the panel lives — its DOM nesting, its harness, the class string that dims a
// button — is rewritten to ask this file instead. The questions the net asks are the user's:
// "open the panel", "what is the switch for Save Stats", "is Reset Settings offered", "is this
// picker locked", "which modal is up". None of them names a component, a parent element, or a
// Tailwind token. This file answers them, and this file is the only one that may.
//
// ⚠ THE RULE FOR THIS FILE IS THAT IT MAY CHANGE AND NOTHING ELSE MAY. If the extraction breaks a
// resolution here, fix it here — that is the whole point, and it is why the resolutions below
// prefer CONTRACTS the app states out loud (the popover's id, a control's accessible name, a
// role) over positions in a tree, which is what a move actually disturbs.
//
// ⚠ WHAT THIS FILE MUST NOT SWALLOW. The PIXEL GATES describe at the foot of tests/settings.dom is
// the owner's deliberate zero-pixel-movement gate and is INTENTIONALLY implementation-coupled — it
// asserts child counts, element identity, and exact className strings. Those tests do NOT come
// through here, they say so themselves, and routing them through an abstraction would delete the
// only thing they do.
//
// ⚠ WHAT THIS FILE STILL CANNOT DO, so no group of the net may imply it does. jsdom has no layout
// engine and no pointer engine. Three panel behaviours are therefore DEVICE CHECKS and nothing
// here pretends otherwise: the footer's auto-fit (fitFooterBtns measures at width 0, so it is a
// no-op in every test), the press-drag gestures as GESTURES (the geometry — hit-testing, the
// edge-band auto-scroll, the feel), and whether the gear's onPointerDown + onClick pair
// double-toggles on real touch hardware. What IS reachable here is the controller's DECISIONS —
// installPointerGestures runs against the real document, so a press-drag release can be driven
// end-to-end with the hit-test supplied (pressDragFromGear below). That is a real gesture, not a
// state poke, and it is the only form of one this environment can deliver honestly.
import { expect } from 'vitest'
import { screen, within, render, fireEvent, act } from '@testing-library/react'
import { App } from '../../src/main.jsx'
import { useSettings } from '../../src/store/settings.js'
import { useModePrefs } from '../../src/store/modePrefs.js'
import { useUserDefaults, effectiveSettingsDefaults } from '../../src/store/userDefaults.js'
import { useProgress } from '../../src/store/progress.js'
import { useLookupHistory, useLookupSession } from '../../src/store/lookupHistory.js'
import { usePresets, makePresetRegistryDefaults } from '../../src/store/presets.js'
import { discardSessionStats } from '../../src/store/amnesic.js'
// Re-exported so the panel helper's API is complete at one import, while the definition lives in
// the file that owns the question — mode-screen tests ask "is this offered" about game controls
// that have nothing to do with settings, and should not be importing from a settings helper.
import { isOffered, isDimmed } from './offered.js'
export { isOffered, isDimmed }

// ── Standing the app up ───────────────────────────────────────────────────────────────────────

// THE RECONCILED RESET LIST, and it is a decision rather than a union taken by accident.
//
// The seven files that drove the panel each reset a different subset, and the differences were
// historical, not meaningful: every one cleared localStorage and the settings store; four also
// cleared the saved-defaults snapshot; two also cleared sessionStorage; several repeated the two
// resets tests/setup/dom.js ALREADY performs before every test in the suite (progress and mode
// prefs — see its foot).
//
// What is load-bearing is `clearDefaults()`. The four stores are in-memory module singletons
// hydrated at import, so localStorage.clear() does NOT put the saved snapshot back to null — a
// test that saves personal defaults leaks them into every later test in its file unless the store
// itself is cleared. Three of the seven files omitted it and got away with it only because they
// never save a snapshot. Including it costs those three nothing and removes the trap.
//
// LOOKUP HISTORY IS THE SAME TRAP, ONE STORE OVER (Q1, round 20). It is no longer one of the four
// per-preset stores above — it moved to its own store/lookupHistory, precisely because it is SHARED
// across every preset rather than swapped per preset — but it is still an in-memory module
// singleton `localStorage.clear()` cannot reach, so a case that looks something up leaks it into
// every later case in its file unless reset directly, same as tests/setup/dom.js's global net
// already does before every test in the whole suite. It is included here too, redundantly with
// that net, for the same reason resetProgress() already is: a case reading this function does not
// have to go check a second file to know what a "clean device" means.
//
// sessionStorage is DELIBERATELY NOT HERE. It is not app state — it holds the post-update
// splash-skip flag and the update-attempt loop breaker (src/main.tsx), which only the two files
// that mount across a simulated build change care about. Those two keep their own explicit
// sessionStorage.clear(), where it reads as the setup for the thing they are testing instead of
// as a line nobody can account for.
//
// THE PRESET REGISTRY goes back too, and BEFORE the clear rather than after it. Same trap as
// clearDefaults, one level up: the registry is another in-memory singleton, so a case that creates
// or switches presets would leave every later case in its file reading and writing a DIFFERENT
// preset's keys — and, because preset 1's keys are the un-namespaced ones the whole suite has
// always used, the symptom would be "nothing was saved" rather than anything that names presets.
// Resetting it writes, hence the ordering: a device that has never been played on has no registry
// entry at all (store/presets — a default registry says nothing a missing one does not), which is
// the state every case in this suite is entitled to assume.
export function resetAppState() {
  // ★ AN AMNESIC PRESET'S STATS ARE THE ONE PIECE OF APP STATE localStorage.clear() CANNOT REACH —
  // they live in sessionStorage (store/amnesic) — so a case that turns Amnesic on would otherwise
  // leave a session copy standing for every later case in its file, and the symptom would be
  // "stats I never wrote" rather than anything naming amnesia. Discarded through the app's own
  // call, so this file still never spells a storage key, and BEFORE the registry goes back to its
  // defaults, because the registry is what says which presets have a copy to discard.
  // ⚠ NOT sessionStorage.clear(). The other two things that live there are not app state — the
  // post-update splash-skip flag and the update-attempt loop breaker (src/main.tsx) — and the two
  // files that care about them keep their own explicit clear, where it reads as the setup for the
  // thing they are testing instead of as a line nobody can account for.
  for (const preset of usePresets.getState().presets) discardSessionStats(preset.id)
  usePresets.setState(makePresetRegistryDefaults())
  localStorage.clear()
  useSettings.getState().resetToFactory()
  useModePrefs.getState().resetModePrefs()
  useUserDefaults.getState().clearDefaults()
  useProgress.getState().resetProgress()
  useLookupHistory.getState().setHistory([])
  useLookupSession.getState().setSessionEntries([])
}

// Mounts the real <App/> with the panel CLOSED, and returns Testing Library's render result.
// The #root div is not decoration: the bar's two dropdowns and all five settings modals portal
// into it, so without one they render nowhere. App's own tree mounts into RTL's container, so
// there is no duplicate auto-mount. Pair with the usual `cleanup()` +
// `document.getElementById('root')?.remove()` in an afterEach.
export function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// THE OS COLOUR-SCHEME SIGNAL, made controllable. tests/setup/dom.js stubs matchMedia to a flat
// `matches:false` with no-op listeners, which fixes every test at "light system, and the OS never
// changes its mind" — so neither the dark-system branch of the Use-System seed nor the live
// matchMedia listener at src/main.tsx:364 has ever been driven.
//
// INSTALL BEFORE mountApp: systemIsDark is read in a useState INITIALIZER (main.tsx:325), so a
// stub swapped in after the mount is never consulted for the starting value. `set(dark)` then
// delivers a real 'change' to whatever the app subscribed with, which is the OS changing its mind
// while the app is running. Restore in an afterEach or the next file in the worker inherits it.
//
// Every OTHER query answers false, exactly as the standing stub does — the app also asks about
// orientation and pointer coarseness, and this helper has no opinion on those.
export function installSystemColorScheme({ dark = false } = {}) {
  const previous = window.matchMedia
  let isDark = dark
  const listeners = new Set()
  window.matchMedia = (query) => {
    const isSchemeQuery = query.includes('prefers-color-scheme: dark')
    return {
      media: query,
      onchange: null,
      // A getter, not a snapshot: the app holds ONE MediaQueryList across the whole session and
      // re-reads .matches, so a frozen boolean would model a browser that cannot change.
      get matches() {
        return isSchemeQuery && isDark
      },
      addEventListener: (type, fn) => {
        if (isSchemeQuery && type === 'change') listeners.add(fn)
      },
      removeEventListener: (type, fn) => listeners.delete(fn),
      addListener: (fn) => {
        if (isSchemeQuery) listeners.add(fn)
      },
      removeListener: (fn) => listeners.delete(fn),
      dispatchEvent: () => false,
    }
  }
  return {
    set(nextDark) {
      isDark = nextDark
      act(() => {
        for (const fn of listeners) fn({ matches: isDark })
      })
    },
    restore() {
      window.matchMedia = previous
    },
  }
}

// ── Android Back, and the jsdom trap underneath it ───────────────────────────────────────────
//
// THE PROBLEM, and it is entirely an artefact of the test environment — nothing here is a claim
// about the app. Closing an overlay through the UI runs useBackButton's popOverlay, which sets a
// private `ignorePop` flag and calls history.back() to unwind the entry that overlay pushed. The
// resulting popstate is meant to arrive and be swallowed, clearing the flag. jsdom performs the
// traversal on a LATER task, so two things can go wrong before it does:
//   1. a synthetic Back fired in the meantime is swallowed by the pending flag INSTEAD — so the
//      panel does not close, and the real traversal closes something later, out of nowhere; and
//   2. worse, ANY pushState in the meantime CANCELS the queued traversal outright — so its
//      popstate never comes and the flag stays set FOREVER. Verified: open a modal, close it by
//      Escape, reopen it, press Back — the Back does nothing, and every later Back in that test is
//      one press behind. No amount of waiting fixes it; the event being waited for was cancelled.
//
// Both of these would have been rediscovered by whoever wrote the first Android-Back case, so the
// helper carries the whole problem and no case in the net has to know any of it.
//
// THE FIX IS A MIRROR OF THAT PRIVATE FLAG, kept honestly: it is set by exactly what sets the real
// one (a history.back() call) and cleared by exactly what clears it (the next popstate, whatever
// its origin). So after the wait, `backGuardArmed` says whether a guarded traversal was cancelled
// — and if it was, ONE sacrificial popstate consumes the stale flag without touching the overlay
// stack, because that is precisely what a set flag makes a popstate do. A boolean, not a count,
// because the flag it mirrors is a boolean: two cancelled traversals still leave one flag set, and
// a second sacrificial dispatch would eat a real overlay.
//
// The patch is installed once, at import, and it calls through — the app's own behaviour is
// untouched. It is per test FILE (each gets its own module registry), so nothing leaks sideways.
let backGuardArmed = false
if (typeof window !== 'undefined') {
  const nativeBack = window.history.back.bind(window.history)
  window.history.back = () => {
    backGuardArmed = true
    nativeBack()
  }
  // Registered AFTER useBackButton's own module listener (this file imports the app first), so it
  // observes the same popstate one step later — which is exactly the mirror we want.
  window.addEventListener('popstate', () => {
    backGuardArmed = false
  })
}

// Wait for jsdom's queued traversals to land, then clear a guard left armed by one that was
// cancelled. One setTimeout(0) is not enough under full-suite load (a delivered popstate can queue
// another traversal), so wait until QUIESCENT: two consecutive ticks with no popstate, bounded
// at 20. Safe at any moment, including with an overlay open.
async function drainHistory() {
  await act(async () => {
    let quiet = 0
    let seen = 0
    const count = () => {
      seen++
    }
    window.addEventListener('popstate', count)
    for (let i = 0; i < 20 && quiet < 2; i++) {
      seen = 0
      await new Promise((r) => setTimeout(r, 0))
      quiet = seen === 0 ? quiet + 1 : 0
    }
    window.removeEventListener('popstate', count)
  })
  if (backGuardArmed) act(() => window.dispatchEvent(new PopStateEvent('popstate')))
}

// ── The gestures every route is built from ────────────────────────────────────────────────────

// A FINGER TAP on `el`, as the whole gesture rather than as the one event a handler happens to
// want. mousedown THEN click, because the panel has two listeners that fire on the press half and
// never see the click — the click-outside handler (document mousedown/touchstart) and the Full
// Reset disarm listener (document mousedown/touchstart, capture) — and a test that fired only
// `click` would report "tapping this control does not disarm Full Reset" as a pass.
//
// ⚠ KNOWN LIMIT, MUTATION-VERIFIED (round 14 review). Both halves fire inside ONE act(), so React
// never re-renders between them and a click handler still sees the state the press half wrote. That
// makes the Full Reset disarm listener testable in one direction only: severing it (never disarm)
// goes red as it should, but INVERTING it — disarming on every press including the confirming one —
// leaves the whole defaults suite green, because the click closure still reads fullResetArmed as
// true and fires the reset. On a real device the press and the release are separate tasks, so that
// inversion would re-arm instead of firing and Full Reset would become unfireable by any route.
// Closing it needs a variant that puts an act() boundary BETWEEN the halves for the confirming tap;
// do not simply split this one, which every existing case is written against.
export const tap = (el) =>
  act(() => {
    fireEvent.mouseDown(el)
    fireEvent.click(el)
  })

// A key press with nothing focused — the app's global shortcut handler listens on `window`, so
// this is how a user's K / F / G / H / Escape / Tab actually arrives.
export const pressKey = (key, init = {}) => act(() => fireEvent.keyDown(window, { key, ...init }))

// A key press aimed at one element, for the handlers that live ON a control (a picker's arrows, a
// year box's Enter/Escape, a modal's Tab trap). Returns whether the app REFUSED the press
// (preventDefault) — which is the whole assertion for the year boxes' minus block, and for an
// arrow a locked group must swallow.
export const pressKeyOn = (el, key, init = {}) => {
  let delivered = true
  act(() => {
    delivered = fireEvent.keyDown(el, { key, ...init })
  })
  return { prevented: !delivered }
}

// A REAL PRESS-DRAG-RELEASE, starting on the ⚙ gear and ending wherever `target` resolves.
//
// This is the app's press-drag menu gesture end to end, against the REAL controller
// (installPointerGestures, mounted by App): pointerdown on the gear opens the panel, the finger
// travels into it, and the release acts on whatever is under it — clicking a pill and asking the
// panel to dismiss (data-drag-dismiss), clicking a footer control without dismissing
// (data-drag-stay), or focusing a year box for typing (data-drag-focus). Which of the three
// happens is the controller's decision, never this helper's; all this supplies is the hit-test
// jsdom cannot perform.
//
// `target` is a FUNCTION, not an element, and that is forced: the release target lives inside a
// panel that does not exist until the pointerdown has opened it. It is called once the panel is up.
//
// The events are hand-built MouseEvents carrying pointerId/isPrimary/pointerType — the recipe
// tests/pointerGestures.test.js proved — because jsdom ships no PointerEvent constructor, and both
// the gear's own guard and the controller's latch read those three fields.
//
// ⚠⚠ AFTER THIS RETURNS, THE NEXT CLICK ON THE GEAR IS SWALLOWED. Read this before writing any
// case that press-drags and then expects a later gear tap to do something.
//
// The gear carries `data-select-trigger` and toggles on POINTERDOWN, so the controller ALWAYS arms
// click suppression on it at release (src/lib/pointerGestures.ts — an unsuppressed click would
// double-toggle the panel). That arming is cleared by exactly three things: the click that
// consumes it, the next POINTERDOWN, or a 1s fallback timer. A real browser delivers the click and
// the arming dies with it. jsdom delivers nothing, and `tap()` fires mousedown + click — neither
// is a pointerdown — so the arming survives and eats that click in the capture phase. Under FAKE
// TIMERS the 1s fallback never fires either, so it survives indefinitely.
//
// The consequence is silent, which is what makes it worth a paragraph: `closeSettings()` defaults
// to a gear tap, so after a press-drag it is a NO-OP that throws nothing and leaves the panel open.
// A case that then reads something still rendered will pass while having closed nothing. So after
// a press-drag, either stand the app up again, or travel a route that is not a click
// (closeSettings('key')), and assert isSettingsOpen() so a regression fails loudly.
export function pressDragFromGear(target) {
  const previousHitTest = document.elementFromPoint
  let hit = null
  document.elementFromPoint = () => hit
  try {
    act(() => gear().dispatchEvent(pointerEvent('pointerdown')))
    hit = typeof target === 'function' ? target() : target
    act(() => document.dispatchEvent(pointerEvent('pointerup')))
  } finally {
    if (previousHitTest) document.elementFromPoint = previousHitTest
    else delete document.elementFromPoint
  }
}

// ANDROID HARDWARE BACK. The browser pops its own history entry before the app hears anything, so
// the popstate IS the press — there is nothing else to synthesise. ASYNC, and it settles jsdom's
// history first, which is the whole of what the block above exists for: `await pressBack()`.
export async function pressBack() {
  await drainHistory()
  act(() => window.dispatchEvent(new PopStateEvent('popstate')))
}

const pointerEvent = (type) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  Object.defineProperty(e, 'isPrimary', { value: true })
  Object.defineProperty(e, 'pointerType', { value: 'touch' })
  return e
}

// ── Opening and closing ───────────────────────────────────────────────────────────────────────

// THE ROUTES. The panel has one open state and many ways in and out, and the net asserts that
// every route produces the IDENTICAL transition — which is what matters, because that transition
// is what fires all six useSettingsCloseEffect callers. Routing every test through this table is
// what makes "and now by the other route" a one-word change instead of a rewrite.
//
// EVERY ENTRY IS A REAL GESTURE. Not one of them writes settingsOpen: they press the gear, they
// send a key to the window the app is listening on, they tap a page element outside the panel,
// they dispatch the popstate a hardware Back produces, they drive the pointer controller. A route
// that poked state would make the whole group vacuous — the transition is the subject.
//
// Routes taking an argument take it through `opts`, so the caller reads as the gesture it is:
//   closeSettings('modeKey', { key: 'F' })         — the user pressed F
//   closeSettings('modeMenu', { mode: 'Flash' })   — the user picked Flash from the bar's menu
//   closeSettings('dragDismiss', { on: () => pickerPills('Input')[1] })
const MODE_KEYS = { classic: 'K', flash: 'F', blitz: 'B', aox: 'A', deduction: 'D', lookup: 'L' }

const OPEN_ROUTES = {
  // A plain activation of the gear — the keyboard route, and what every existing test has used.
  gear: () => tap(gear()),
  // The TOUCH route, which is a different code path: the gear acts on pointerdown (so a finger can
  // drag straight into the panel) and the controller then suppresses the click the browser still
  // delivers. Nothing in the suite has ever exercised it against the real button.
  gearPress: () => pressDragFromGear(() => gear()),
  key: () => pressKey('G'),
}

const CLOSE_ROUTES = {
  gear: () => tap(gear()),
  gearPress: () => pressDragFromGear(() => gear()),
  key: () => pressKey('G'),
  // Escape, which the panel handles on the document — and deliberately does NOT handle while a
  // text-entry input has focus.
  escape: () => act(() => fireEvent.keyDown(document.body, { key: 'Escape' })),
  // A tap on the page behind the panel. Defaults to the bar's own background (outsideTarget
  // below), which is a real thing a finger can land on and is outside all FOUR excluded regions
  // (the gear wrapper, the panel card, and the mode and preset selects). Pass `on` for the cases
  // that need a specific target — including document.documentElement, the Windows scrollbar-drag
  // case that must NOT close it.
  outside: ({ on } = {}) => tap(on ?? outsideTarget()),
  // Android hardware Back. ⚠ ASYNC — `await closeSettings('back')`. It settles jsdom's history
  // first; see pressBack and the block above it for the trap that makes that necessary. Every
  // other route is synchronous, and awaiting those is harmless, so a sweep can await uniformly.
  back: pressBack,
  // A mode letter. Defaults to K (Classic) because it is the one mode switch that changes nothing
  // else about the fixture when the app is already there.
  modeKey: ({ key = 'K', mode } = {}) => pressKey(mode ? MODE_KEYS[mode] : key),
  // H — the How to Play toggle, which closes the panel by the same line as the mode letters.
  guideKey: () => pressKey('H'),
  // Opening the bar's mode dropdown from the panel and picking an option. Two gestures, and the
  // pairing is the point: the pick must register AND close the panel, rather than the panel
  // slamming shut on the press that opened the menu and swallowing the choice.
  modeMenu: ({ mode = 'Flash' } = {}) => {
    openModeMenu()
    tap(screen.getByRole('option', { name: mode }))
  },
  // Full Reset's two taps, which close the panel as one of their many outcomes.
  fullReset: () => {
    tap(fullResetButton())
    tap(fullResetButton())
  },
  // A press-drag release on a member of the panel — the gesture that both activates the control
  // and dismisses the menu. `on` resolves the release target once the panel is up; it defaults to
  // the first Input pill because that is the plainest dismissing member there is.
  //
  // ⚠ THIS ROUTE RE-PRESSES THE GEAR, because that is what the gesture IS: the controller only
  // pairs a drag with a menu when the press STARTED on the menu's trigger. So it is not usable as
  // "close the panel that is already open" — it opens on the press and dismisses on the release,
  // net one closed panel, which is exactly the user's experience of it.
  dragDismiss: ({ on } = {}) => {
    if (isSettingsOpen())
      throw new Error(
        "closeSettings('dragDismiss'): this gesture STARTS on the gear, so it has to begin with " +
          'the panel closed — the press opens it and the release dismisses it, net one closed ' +
          'panel. Do not openSettings() first.',
      )
    pressDragFromGear(() => (on ? (typeof on === 'function' ? on() : on) : pickerPills('Input')[0]))
  },
}

const travel = (table, via, verb, opts) => {
  const go = table[via]
  if (!go)
    throw new Error(`${verb}: no such route "${via}" (have: ${Object.keys(table).join(', ')})`)
  // Returned, not swallowed: the Back route is async (see pressBack), so a caller has to be
  // able to await it. Every other route returns undefined, which awaits harmlessly — so a sweep
  // over the whole table can `await` uniformly instead of special-casing one entry.
  return go(opts)
}

// Open the panel. `via` defaults to the gear because that is the route a finger takes.
export const openSettings = (via = 'gear', opts) => travel(OPEN_ROUTES, via, 'openSettings', opts)
// Close it. Same route names mean the same gestures.
export const closeSettings = (via = 'gear', opts) =>
  travel(CLOSE_ROUTES, via, 'closeSettings', opts)

// The route names as DATA, so "the apply lands through EVERY close route" can be a loop rather
// than six copy-pasted tests — and so a route added here is automatically swept by the groups that
// sweep. Note `fullReset` and `modeMenu` change far more than the panel's open state, so a sweep
// over ALL of them is rarely what a test means; pick the subset the case is about.
export const OPEN_ROUTE_NAMES = Object.keys(OPEN_ROUTES)
export const CLOSE_ROUTE_NAMES = Object.keys(CLOSE_ROUTES)

// The default "somewhere else on the page" a tap can land on: THE BAR'S OWN BACKGROUND. A real,
// visible, non-interactive surface outside the gear wrapper, the panel card, both selects and
// every modal — which is the definition of "outside" the panel's own rule uses.
//
// ⚠ IT USED TO BE THE <h1> TITLE, AND THAT STOPPED BEING HONEST when the top-bar rebuild removed
// the visible "Calendar Game" wordmark: the heading survives as an sr-only element (it is the app's
// only accessible name — see the bar's markup in src/main.tsx), so every tap routed through it
// would have kept PASSING while aiming at a 1×1 clipped box no finger can land on. The bar element
// itself is the honest replacement and is not a lesser one: the rebuilt row leaves ~23px of bare
// bar between the preset switcher and the mode selector at 360px, plus the full-width strip left
// and right of the 30rem wrapper on anything wider, so this is exactly the surface a real
// outside-tap lands on. Resolved by the class main.tsx puts on it, the same handle every other
// bar-reading test in the suite uses.
export const outsideTarget = () => {
  const bar = document.querySelector('.htp-sticky-bar')
  if (!bar) throw new Error('outsideTarget: no .htp-sticky-bar in the document')
  return bar
}

// ── Finding the panel ─────────────────────────────────────────────────────────────────────────

// THE PANEL CARD, resolved by the id and by nothing else. `settings-popover` is a stated contract
// with three separate consumers already: the gear's aria-controls names it, the press-drag pointer
// controller pairs a gesture with the menu by resolving that id live, and the suite's own scroller
// queries key off it. So it is the one handle that survives the card being rendered by a different
// component, which is exactly the move this file is insurance against. Null while the panel is
// closed — a closed panel has no DOM at all (it is conditionally rendered, never hidden).
export const panelEl = () => document.getElementById('settings-popover')

// Is the panel up? The plain question, so a test never has to decide whether "null" or "throws" is
// how absence reads. A closed panel is not in the DOM, which is what makes this total.
export const isSettingsOpen = () => panelEl() !== null

// A query scope for everything inside the panel. TEXT queries must come through here rather than
// off `screen`, and that is load-bearing: How to Play is always-mounted, so its display:none copy
// of the guide sits in the DOM on every screen — and the guide names half of this panel's controls
// in prose. A global getByText matches those sentences as readily as the control. ROLE queries
// need no such scoping (they skip display:none subtrees), but coming through here anyway keeps
// "inside the panel" a claim the query makes rather than one the reader has to take on faith.
export function panel() {
  const el = panelEl()
  if (!el) throw new Error('panel(): the ⚙ settings panel is not open')
  return within(el)
}

// ── The gear ──────────────────────────────────────────────────────────────────────────────────

// The gear button. A PREFIX match because its accessible name GROWS: 'Settings (modified)',
// 'Settings (update)', 'Settings (modified, update)'. The exact composition is a contract of its
// own and is asserted through gearIndicator() below, never by how this locates the button.
//
// ⚠ THE PATTERN IS ANCHORED AT BOTH ENDS OF THE WORD, and the tightening is not cosmetic. A bare
// /^Settings/ also matches the How-to-Play guide's own 'Settings Overview' section header, which
// is a real <button> whose accessible name is its title (components/GuidePage) — so while the
// guide is the VISIBLE mode two buttons match and this throws "found multiple elements". Role
// queries skip display:none subtrees, which is the only reason it does not throw on every screen.
// `( \(|$)` admits exactly the four names the gear can wear and nothing that merely starts with
// the word, so the gear stays reachable from inside How to Play.
export const gear = () => screen.getByRole('button', { name: /^Settings( \(|$)/ })

// WHAT THE GEAR IS TELLING THE USER, as the independent things it says rather than as the markup
// that says them:
//   • bar      — the violet "your settings differ from your defaults" stripe. Drawn only while the
//                panel is CLOSED (an open gear is solid purple and wears no stripe).
//   • name     — the accessible name, which is where BOTH signals are always readable, open or
//                closed. About a dozen helpers across five test files find the gear by this
//                string, so its format is load-bearing well beyond any one test.
//   • controls — the id the gear says its menu has, RAW: the string while the panel is open, null
//                while it is closed. Both answers are the contract (the press-drag controller
//                resolves this id live, so a gear that named a menu while none was mounted would
//                pair a gesture with nothing), so it is not collapsed to a boolean.
//
// ⚠ THE UPDATE DOT IS NOT HERE, it has its own accessor (gearDot below). tests/changelog.dom reads
// the marker's raw attributes (`toHaveAttribute('data-lit','false')`), which is the STRONGER form:
// 'true', 'false' and "no marker at all" are three different answers, and a boolean here would
// collapse the last two into one. Same refusal as `announced` and `segments` further down.
export const gearIndicator = () => {
  const el = gear()
  return {
    bar: el.className.includes('gear-modified'),
    name: el.getAttribute('aria-label'),
    controls: el.getAttribute('aria-controls'),
  }
}

// THE TWO UPDATE MARKERS, as RAW tri-state reads — 'true' (lit), 'false' (slot reserved, dark),
// null (no marker on this host at all). The distinction is real and load-bearing: the inline
// marker beside the Changelog link reserves its slot in BOTH states so lighting up shifts nothing,
// while a host with no marker is a different failure entirely. A boolean would erase that.
//
// Resolved by the marker's own `data-update-dot` attribute rather than by anything about the host,
// because the attribute IS the component's published contract (components/UpdateDot) and the
// host's className stopped saying anything about it in round 8.
//
// ⚠ THE CHANGELOG LINK IS RESOLVED BY PREFIX, for the same reason the gear is, and getting this
// wrong made the accessor throw in the ONE state it exists to describe. The link's accessible name
// GROWS to 'Changelog, update' the moment its dot lights — the sr-only word beside the aria-hidden
// marker is the only update signal a screen reader has left once the gear's dot has been retired,
// and it carries a printing comma deliberately (src/main.tsx explains why a leading space would be
// trimmed away). An exact-name match therefore resolves nothing exactly when the dot is lit.
const updateDot = (host) =>
  host.querySelector('[data-update-dot]')?.getAttribute('data-lit') ?? null
export const gearDot = () => updateDot(gear())
export const changelogDot = () => updateDot(changelogLink())

// ── Switches ──────────────────────────────────────────────────────────────────────────────────

// Every On/Off switch in the panel, by the setting it controls — the label a screen reader hears
// and a caller writes. Exported as data so "change each of them individually" is a sweep rather
// than four hand-written tests. Order is the panel's own, top to bottom.
// ⚠ 'Amnesic' is the one entry that is NOT a ⚙ setting: the value belongs to the PRESET
// (store/presets' `Preset.amnesic`) and is written through store/presetControl, so it is absent
// from the Save Defaults snapshot and never lights the gear. It is listed here because this list is
// "every On/Off switch in the panel", which is a question about the panel, not about the store.
// ⚠ 'Dot Layout' joined in Q3 (round 20) — it was a two-option PillTray before and is a switch now
// (store/settings' `rotateDots`), on THE PICKER RULE's own logic: a choice between exactly two
// named alternatives IS an on/off shape.
export const SWITCH_LABELS = [
  'Random Format',
  'Dot Layout',
  'Use System Settings',
  'Julian Calendar (pre-Oct 15, 1582)',
  'Save Stats',
  'Amnesic',
]

// A SWITCH, by the name of the setting it controls. This replaces
// `panel().getByText(label).parentElement.querySelector('button')` — an accessor that encoded the
// row's exact DOM nesting and was used by a dozen tests, so any wrapper introduced anywhere in the
// panel silently resolved .parentElement to a different element and the tests either failed
// confusingly or passed vacuously.
//
// It works because every switch now NAMES its setting (the aria-label added to all four in
// src/main.tsx). Their visible content is the state — "On"/"Off", identical on all four — so
// before that there was nothing to ask for and the DOM walk was the only way in.
export const settingSwitch = (label) => panel().getByRole('button', { name: label })

// What the switch READS — 'On' or 'Off'. The switch's visible content IS its state (these are
// deliberately plain buttons, not role="switch" with a checked state), so this is the user's
// answer and not a paraphrase of one.
export const switchState = (label) => settingSwitch(label).textContent.trim()

// Flip one. A real tap, so the Full Reset disarm listener sees the press like it would any other.
export const toggleSwitch = (label) => tap(settingSwitch(label))

// The switch's ROW: the label and its control as the user sees them together. Resolved by walking
// UP from the control to the nearest ancestor that also carries the setting's visible text, so a
// wrapper introduced between them changes nothing here. Wanted by the assertions that are about
// the row rather than the switch — "a switch is ONE On/Off button, not a tray of alternatives".
export function switchRow(label) {
  const control = settingSwitch(label)
  for (let node = control.parentElement; node && node !== panelEl(); node = node.parentElement)
    if ([...node.children].some((c) => c !== control && c.textContent.trim() === label)) return node
  throw new Error(`switchRow(${label}): found the switch but no row carrying its label`)
}

// ── Captioned rows ────────────────────────────────────────────────────────────────────────────

// A CAPTION — 'Written', 'Numeric', 'Dark', 'Light'. A SectionLabel DIV, so the filter never
// catches the same-named 'Light' PILL (a BUTTON). Wanted on its own by the cases that ask whether
// a lock's dim reaches the caption as well as the pills.
export function caption(text) {
  const el = panel()
    .getAllByText(text)
    .find((node) => node.tagName === 'DIV')
  if (!el) throw new Error(`caption(${text}): no caption by that name in the panel`)
  return el
}

// A VISUAL ROW, found by its caption. Which radiogroup owns a theme row depends on Use System
// Settings, but the row itself is there in both states, so the caption is the only stable handle.
// Replaces `getAllByText(caption).find(DIV).parentElement`, whose .parentElement was the same
// silent mis-resolution hazard as the switch accessor.
//
// From the caption the row is the nearest ancestor that holds it AND the pills it introduces — a
// definition that stays true however many wrappers sit between them.
export function row(text) {
  const label = caption(text)
  for (let node = label.parentElement; node && node !== panelEl(); node = node.parentElement)
    if (node.querySelector('[role="radio"]')) return node
  throw new Error(`row(${text}): the caption introduces no pills`)
}

// The pills a captioned row shows, and which of them are lit. Both exist because the theme block
// is the one place where the ROW and the GROUP are different subjects: with Use System off, one
// 'Theme' group spans two rows, and "the row not holding the pick shows no selection" can only be
// asked per row.
export const rowPills = (text) => within(row(text)).getAllByRole('radio')
export const rowChosen = (text) => litLabels(rowPills(text))

const litLabels = (pills) =>
  pills.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent.trim())

// ── Pickers and their locks ───────────────────────────────────────────────────────────────────

// Every picker in the panel is a labelled radiogroup, so one accessor serves them all.
export const picker = (name) => screen.getByRole('radiogroup', { name })
// The same question where "no such group" is a legitimate answer — with Use System OFF there is no
// 'Dark theme' group at all, and with it ON there is no 'Theme' group. Absence is the assertion,
// so it needs a query that can return null instead of throwing.
export const queryPicker = (name) => screen.queryByRole('radiogroup', { name })
export const pickerPills = (name) => within(picker(name)).getAllByRole('radio')
// The labels currently lit in a picker.
export const pickerChosen = (name) => litLabels(pickerPills(name))

// The panel's pickers by radiogroup name, with Use System ON (which is what splits the theme block
// into two groups; turning it OFF replaces both with one 'Theme'). Exported as data for the sweeps.
export const PICKER_NAMES = [
  'Date Format',
  'Input',
  'Dark theme',
  'Light theme',
  'Leap Year Chance',
  'Jan/Feb Chance on Leap Years',
  'Julian Chance',
]
// The four that can LOCK, and the only four — Jan/Feb Chance is the deliberate negative control
// (it has no lock branch at all) and the theme groups never take `disabled`.
export const LOCKABLE_PICKERS = ['Input', 'Date Format', 'Leap Year Chance', 'Julian Chance']

// A PICKER'S LOCK, reported as the things the USER meets rather than as the class that happens to
// draw them. All of them come from ONE `disabled` on the PillGroup, which is exactly why they are
// read together: asserting them as a set is what proves a locked picker cannot end up locked four
// ways out of five.
//
//   offered   — a press reaches the picker at all.
//   dimmed    — it is DRAWN as unavailable. Separate from `offered` on purpose: greyed-but-live
//               and live-but-unpressable are both real bugs, and one boolean cannot tell them apart.
//   announced — what the GROUP tells assistive tech ('true' | null). A screen reader entering a
//               locked picker used to be told it was live and only found out one element in.
//   segments  — what each SEGMENT tells assistive tech, in DOM order. Raw attribute values, not
//               booleans: "absent" and "false" are different answers and the net must be able to
//               insist on absent.
//   tabStops  — how many pills Tab can land on. pointer-events-none stops pointers and nothing
//               else, so this is the half of the lock a keyboard user meets.
//   chosen    — the labels currently lit. A lock must PRESERVE the pick, so it is read here too.
export function pickerLockState(name) {
  const group = picker(name)
  const pills = within(group).getAllByRole('radio')
  return {
    offered: isOffered(group),
    dimmed: isDimmed(group),
    announced: group.getAttribute('aria-disabled'),
    segments: pills.map((b) => b.getAttribute('aria-disabled')),
    tabStops: pills.filter((b) => b.tabIndex === 0).length,
    chosen: litLabels(pills),
  }
}

// THE WHOLE LOCK, ASSERTED AS ONE CLAIM. `disabled` on the PillGroup publishes five consequences
// at once, and the only useful question is whether they agree — a picker locked four ways out of
// five is a real bug that no per-facet assertion can see. This is the reconciled definition:
// tests/settings.dom carried a private four-facet copy (it predates the group's own aria-disabled)
// and the net's picker file carried a five-facet one. The FIVE-facet form wins, because the
// missing facet is the one a screen reader meets first — a group announcing itself live while
// every segment inside it says otherwise.
export function expectLock(name, locked) {
  const s = pickerLockState(name)
  expect(s.offered).toBe(!locked)
  expect(s.dimmed).toBe(locked)
  expect(s.announced).toBe(locked ? 'true' : null)
  s.segments.forEach((v) => expect(v).toBe(locked ? 'true' : null))
  expect(s.tabStops).toBe(locked ? 0 : 1)
}

// WHICH pill the keyboard would land on, by name. pickerLockState reports how MANY tab stops a
// picker has, which is the whole answer for a locked group (zero) and only half of it for an
// unlocked one: "the stop came back on the CHOSEN pill, untouched" needs the identity.
export function tabStopLabel(name) {
  const stop = pickerPills(name).find((b) => b.tabIndex === 0)
  return stop ? (stop.getAttribute('aria-label') ?? stop.textContent.trim()) : null
}

// A pill in this picker that is NOT the current pick, by accessible name. Wanted by every "a press
// on a locked picker changes nothing" case, which is vacuous if it presses the pill already lit.
export function otherPillName(name) {
  const pill = pickerPills(name).find((b) => b.getAttribute('aria-checked') !== 'true')
  if (!pill) throw new Error(`otherPillName(${name}): every pill is already chosen`)
  return pill.getAttribute('aria-label') ?? pill.textContent.trim()
}

// DOES THE DIM REACH THIS ELEMENT? A lock is drawn by fading one housing, and CSS opacity covers
// every descendant — so "the lock visibly covers the captions, not just the pills" is a question
// about CONTAINMENT, not about which element carries the class. Walking the chain is how the
// treatment actually works, which is why it survives any re-parenting the extraction introduces:
// what matters is that some ancestor between the element and the card is faded, never which one.
export function drawnUnavailable(el) {
  for (let node = el; node && node !== panelEl(); node = node.parentElement)
    if (isDimmed(node)) return true
  return false
}

// Pick a pill by its visible label (or accessible name — the Date Format halves each state theirs,
// so 'Written MDY' and 'Numeric MDY' are distinguishable while both read 'MDY').
export const pickPill = (name, label) =>
  tap(within(picker(name)).getByRole('radio', { name: label }))

// Put the keyboard on one pill. The entry path a user has is clicking a pill (PillTray focuses the
// segment it activates), so this exists only for the cases that need focus WITHOUT an activation —
// "a picker that locks while one of its own pills holds focus".
export const focusPill = (name, label) =>
  act(() => within(picker(name)).getByRole('radio', { name: label }).focus())

// An arrow key sent to a picker, from wherever the keyboard is inside it. Returns `prevented`,
// because the assertion for a LOCKED group is that it swallows the press: App's global handler
// maps ArrowLeft/ArrowRight to the game's history buttons, so an arrow that escaped a locked
// picker would step the puzzle behind the panel.
//
// ⚠ IT PUTS THE KEYBOARD IN THE GROUP FIRST when the keyboard is somewhere else, and that is
// fidelity rather than convenience: the group's handler bails outright unless the press came FROM
// one of its own radios (`radios.indexOf(document.activeElement) === -1` → return), so an arrow
// fired at an unfocused pill is not "an arrow the group swallowed", it is an arrow the group never
// heard. The seat it takes is the CHOSEN pill, which is where a user's keyboard would be — the
// only entry path into a group is clicking a pill, and PillTray focuses the segment it activates.
export function arrowPicker(name, key) {
  const pills = pickerPills(name)
  if (!pills.includes(document.activeElement)) {
    const seat = pills.find((b) => b.getAttribute('aria-checked') === 'true') ?? pills[0]
    act(() => seat.focus())
  }
  return pressKeyOn(document.activeElement, key)
}

// ── The footer ────────────────────────────────────────────────────────────────────────────────

// ANY control in the panel, by its accessible name — the three footer buttons (Save Defaults,
// Reset Settings, Full Reset) and the footer's four text links (View Saved Defaults, Clear Saved
// Defaults, Check for updates, Changelog) alike. They are all <button>, and one accessor covers
// them because the only thing that differs is which tier of affordance they wear, which is paint.
//
// Scoped to the panel, so it can never accidentally resolve to a same-named button inside one of
// the modals that portal OUT of the card — 'Save' and 'Close' exist in both places. A RegExp is
// accepted because two of these controls RENAME themselves: Full Reset's caption swaps to
// 'Confirm?' once armed, and Check for updates has four labels because the label is its state.
export const footerButton = (name) => panel().getByRole('button', { name })

// Full Reset under EITHER caption. Its label is the state machine's only readout, so a helper that
// could only find it at rest would go blind exactly when the machine is running.
export const fullResetButton = () => footerButton(/^(Full Reset|Confirm\?)$/)

// The Changelog link, under EITHER of its two names. Same shape as fullResetButton and the same
// reason: its accessible name grows to 'Changelog, update' while its dot is lit (see updateDot
// above), so an exact match goes blind in the state worth reading. Everything that reaches this
// link — the dot reader, the modal opener — comes through here, so there is one definition.
export const changelogLink = () => footerButton(/^Changelog/)

// Press a footer control. Deliberately usable on a control the app is NOT offering, and it stays
// usable BY DESIGN across two rounds of changing how the app withholds these three. The dim has
// never been enforced by jsdom — first because it was pure CSS, now because these three withhold
// with `aria-disabled`, which is an announcement and not a browser-level block. Either way a
// programmatic or keyboard activation still reaches the handler, which is precisely how the net can
// ask what pressing a dimmed button DOES.
// ⚠ AND THAT QUESTION IS THE REASON THE APP DOES NOT USE A REAL `disabled`: jsdom refuses to
// dispatch activation on one, so the guards would become unaskable. All three carry a guard now
// (round 14 added the two that were missing); this helper is how the net proves it.
export const tapFooter = (name) => tap(footerButton(name))

// THE FOUR OFFERS, in one read — the question G6 asks nine different ways and G5 asks about a
// window where the four DISAGREE.
//
// ⚠ THE GEAR IS READ FROM ITS NAME, not from its violet bar, and that is required rather than
// convenient: the bar is drawn only while the panel is CLOSED, and the three footer buttons exist
// only while it is OPEN, so no single moment shows both. The accessible name carries the same flag
// in both states. The exact composition of that name is gearIndicator()'s subject, not this one's.
export function offers() {
  return {
    gear: /\bmodified\b/.test(gearIndicator().name ?? ''),
    saveDefaults: isOffered(footerButton('Save Defaults')),
    resetSettings: isOffered(footerButton('Reset Settings')),
    fullReset: isOffered(fullResetButton()),
  }
}

// THE WHOLE "NOT OFFERED" TREATMENT ON A FOOTER BUTTON, ASSERTED AS ONE CLAIM — the same shape as
// expectLock above, and for the same reason. Round 15 (B7) made withholding a THREE-part statement
// and the only useful question is whether the parts agree: the class DRAWS it unavailable, the
// aria-disabled ANNOUNCES it unavailable, and the handler guard makes it INERT. Asked one facet at
// a time, "greyed and unpressable but announced to a screen reader as an ordinary live button"
// passes every assertion and is precisely the defect B7 was opened for.
//
// ⚠ `tabStop` IS EXPECTED TRUE IN BOTH STATES, and that is the decision rather than an oversight.
// B7 chose aria-disabled over a real `disabled` so a keyboard user can still REACH the button and
// be told why it does nothing. A `disabled` would report tabStop false here, which is why the facet
// is in the tuple: it is the one that tells the two spellings apart.
export function footerOfferState(name) {
  const el = name === 'Full Reset' ? fullResetButton() : footerButton(name)
  return {
    offered: isOffered(el),
    dimmed: isDimmed(el),
    announced: el.getAttribute('aria-disabled'),
    tabStop: el.tabIndex === 0,
  }
}

// The three footer captions in left-to-right order — what the row READS, which is how the Full
// Reset arm announces itself ('Full Reset' → 'Confirm?').
export const footerCaptions = () => [
  footerButton('Save Defaults').textContent.trim(),
  footerButton('Reset Settings').textContent.trim(),
  fullResetButton().textContent.trim(),
]

// FULL RESET'S TWO-TAP MACHINE, as the user meets it: what the button says, whether it wears the
// armed ring, and whether it is being offered at all.
export function fullResetState() {
  const el = fullResetButton()
  return {
    caption: el.textContent.trim(),
    armed: el.className.includes('ring-2'),
    offered: isOffered(el),
  }
}

// THE PANEL'S BOTTOM BOUNDARY — the sticky footer block, which is what makes the list scroll
// instead of the panel growing off-screen.
//
// ⚠ RESOLVED BY `.popover-sticky-footer`, WHICH HAS NO CSS RULE ANYWHERE (pre-existing defect D6 —
// round 13 removed the rule and tests/guideScroll.dom separately asserts its ABSENCE from the
// stylesheet). It reads as dead markup and is not: it is this element's only stable identity, and
// the class survives precisely so the footer can be named. Do not delete it as cruft.
export function panelFooter() {
  const el = panelEl()?.querySelector('.popover-sticky-footer')
  if (!el) throw new Error('panelFooter(): the panel is not open, or its sticky footer is gone')
  return el
}

// How strongly the footer says "there is more list above me" — the continuous 0…1 the edge hook
// writes, ramping with how much unread content remains and reaching 0 at the bottom. A raw string
// read, because "written as 0" and "never written at all" are different answers and the resting
// state is the one that shipped a bug.
export const footerShade = () => panelFooter().style.getPropertyValue('--shade')

// ── The panel's scroller ──────────────────────────────────────────────────────────────────────

// The panel's own scroll region — the inner wrapper the list lives in. Resolved by
// `data-drag-scroll`, which is a STATED contract rather than a position: the press-drag controller
// resolves it live as the menu's auto-scroll target, so it names this element by identity.
export function panelScroller() {
  const el = panelEl()?.querySelector('[data-drag-scroll]')
  if (!el) throw new Error('panelScroller(): the panel is not open, or its scroll region is gone')
  return el
}

// HOW MANY scroll regions the panel publishes, which is a different question and a real one: the
// controller resolves the marker LIVE and acts on the first it finds, so a second one introduced
// by a re-parenting would silently take over the auto-scroll and nothing would throw. Asking
// panelScroller() whether the card contains it cannot fail — it was found by querying inside the
// card — so this is the form of the claim that can.
export const panelScrollerCount = () =>
  panelEl() ? panelEl().querySelectorAll('[data-drag-scroll]').length : 0

// WHICH EDGES THE PANEL IS FEATHERING, as the two independent answers rather than as the one class
// that happens to encode both. `fade-scroll-both` is not a third state — it is top AND bottom —
// and a test that matched class strings would say so where a user sees two separate masks.
export function panelFades() {
  const c = panelScroller().className
  return {
    top: c.includes('fade-scroll-top') || c.includes('fade-scroll-both'),
    bottom: c.includes('fade-scroll-bottom') || c.includes('fade-scroll-both'),
  }
}

// ── The Year Range pair ───────────────────────────────────────────────────────────────────────

// The two year-range text boxes, by which END of the range they hold. The suite historically found
// them by their current VALUE, which cannot survive a test that types into them — and G5 exists to
// do exactly that. They now carry their own accessible names ("Earliest Year" / "Latest Year",
// src/main.tsx), added for the screen-reader gap they had, and that name is what we ask for here.
// ⚠ NOT data-drag-focus, which was the obvious handle and is the wrong one: that attribute is a
// GENERAL press-drag opt-in read live by src/lib/pointerGestures.ts, so it happens to identify these
// two boxes today only because nothing else in the panel has opted in yet. The day something does,
// a positional query over it would silently return the wrong element or throw across every
// year-range case at once. A name is the box's own identity; the marker is a mechanism it borrows.
const YEAR_INPUT_NAMES = { min: 'Earliest Year', max: 'Latest Year' }
export function yearInput(which) {
  const name = YEAR_INPUT_NAMES[which]
  if (!name) throw new Error(`yearInput: expected 'min' or 'max', got ${JSON.stringify(which)}`)
  return panel().getByRole('textbox', { name })
}

// What the box SHOWS. Not what the store holds — the whole of G5 is about the window in which
// those two disagree.
export const yearValue = (which) => yearInput(which).value

// Put the keyboard in the box. Load-bearing well beyond the typing cases: the two store→text sync
// effects bail while the box has focus, so "a store write from elsewhere does not overwrite what
// is being typed" is only a real test if the box is genuinely focused.
export const focusYear = (which) => act(() => yearInput(which).focus())

// TYPE into a box. `change` is the honest event here — it is what React's controlled input sees
// for every route text arrives by (keystrokes, paste, IME, autofill), and the box's own filter
// (`'' or /^\d*$/`) is what decides whether the characters land. So junk simply does not appear,
// which is the assertion, rather than being blocked by the test harness.
//
// Does NOT commit. Committing is blur or Enter, and the gap between typed and committed is the
// state the at-defaults booleans used to disagree about — three of them, before round 14 collapsed
// them into one. They agree now, and since round 15 that one boolean COUNTS the typed text, so this
// helper is what moves all four offers without moving a single setting.
export const typeYear = (which, text) =>
  act(() => fireEvent.change(yearInput(which), { target: { value: text } }))

// A raw key press into a box, returning whether the app refused it — the minus block lives on
// keydown (and separately on beforeInput, below), and "refused" is the only observable it has.
export const keyInYear = (which, key) => pressKeyOn(yearInput(which), key)

// The OTHER half of the minus block: the beforeInput path, which is what catches an insertion the
// keydown never described. `char` is ONE character; returns `prevented`, same as keyInYear.
//
// ⚠ IT DISPATCHES A KEYPRESS, AND THAT IS NOT A MISTAKE. React does not listen to the native
// `beforeinput` event: onBeforeInput is a synthesised event, fed from `textInput` where the engine
// has TextEvent and from `keypress` where it does not. jsdom has no TextEvent, so keypress is the
// ONLY native event that reaches the app's handler here — I verified all four candidates against
// the real inputs, and a hand-built InputEvent('beforeinput') reaches nothing at all. React derives
// the inserted character from `which`, which is why that is what is set.
//
// So this drives React's fallback plugin rather than the path a phone would take. What it proves
// is still the app's own contract — "an insertion carrying a minus is refused" — and if React ever
// stops synthesising from keypress this returns false and the case fails LOUDLY rather than
// passing on a press nobody handled.
//
// ⚠ WHAT IT CANNOT DO: a MULTI-character insertion (a paste of "-5", an IME commit). The fallback
// carries exactly one char, so there is no honest way to express one here — that stays a device
// check, and no case may imply the net covers it.
export function beforeInputYear(which, char) {
  if (typeof char !== 'string' || char.length !== 1)
    throw new Error(
      `beforeInputYear: expected ONE character, got ${JSON.stringify(char)} — a multi-character ` +
        'insertion is not reachable in jsdom (see this helper).',
    )
  const el = yearInput(which)
  let delivered = true
  act(() => {
    const e = new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: char })
    Object.defineProperty(e, 'which', { value: char.charCodeAt(0) })
    delivered = el.dispatchEvent(e)
  })
  return { prevented: !delivered }
}

// COMMIT what is typed, by either route a user has. 'blur' is a REAL blur when the box holds focus
// (which is what the app's own click-outside close forces before unmounting), falling back to a
// dispatched blur when it does not. 'enter' is the key, which commits and then blurs itself.
export function commitYear(which, via = 'blur') {
  const el = yearInput(which)
  if (via === 'enter') return keyInYear(which, 'Enter')
  if (via !== 'blur')
    throw new Error(`commitYear: expected 'blur' or 'enter', got ${JSON.stringify(via)}`)
  act(() => {
    if (document.activeElement === el) el.blur()
    else fireEvent.blur(el)
  })
  return { prevented: false }
}

// ESCAPE in a year box: throw the edit away, give up the keyboard, leave the panel standing. Still
// named for the GESTURE rather than the intent, because this is the spot where the two of them came
// apart — round 14 fixed both, and the history is worth keeping so neither can quietly come back:
//
//   1. IT USED TO COMMIT A PARSEABLE VALUE INSTEAD OF REVERTING IT. The handler queued the revert
//      (setMinInputVal(String(minY))) and then blurred the box synchronously; onBlur's commitMin ran
//      inside that same batch still closing over the PRE-revert text, so the typed number won and
//      landed in the store. Only unparseable text actually reverted, via commitMin's NaN branch —
//      which is presumably why nobody noticed. The revert is now flushed before the blur.
//   2. IT USED TO CLOSE THE PANEL. The panel's document-level Escape handler carves out text inputs
//      by reading document.activeElement, and the box had already blurred itself by the time that
//      handler ran, so the carve-out no longer applied. The box now stops the press propagating.
//
// ⚠ SO THIS HELPER IS NOT A SYNONYM FOR "press Escape". It delivers the press INSIDE the box, which
// is the only way to exercise either fix; an Escape aimed at the page takes the panel's own handler
// and closes the panel, which is correct and is a different case.
export const escapeYear = (which) => keyInYear(which, 'Escape')

// ── Everything the panel currently reads ──────────────────────────────────────────────────────

// EVERY VALUE THE PANEL SHOWS, in one snapshot — the observable RESULT a reset or a round trip is
// judged by. "Reset Settings snaps all fifteen values to their defaults" and "all fifteen
// settings round-trip through a saved snapshot" are both one comparison against this.
//
// The theme keys are conditional because the panel's SHAPE is: with Use System ON the two rows are
// two independently settable groups, and with it OFF they are one group holding a single pick.
// Reporting the shape it is actually in is the honest answer — a fixed set of keys would have to
// invent a value for a group that does not exist.
export function panelValues() {
  const values = {
    randomFormat: switchState('Random Format'),
    dateFormat: pickerChosen('Date Format'),
    input: pickerChosen('Input'),
    // Dot Layout is a SWITCH now (Q3, round 20), not a picker — read through switchState like every
    // other On/Off setting in this snapshot, rather than pickerChosen.
    dotLayout: switchState('Dot Layout'),
    useSystem: switchState('Use System Settings'),
    minYear: yearValue('min'),
    maxYear: yearValue('max'),
    leapChance: pickerChosen('Leap Year Chance'),
    janFebChance: pickerChosen('Jan/Feb Chance on Leap Years'),
    useJulian: switchState('Julian Calendar (pre-Oct 15, 1582)'),
    julianChance: pickerChosen('Julian Chance'),
    saveStats: switchState('Save Stats'),
  }
  if (queryPicker('Theme')) return { ...values, theme: pickerChosen('Theme') }
  return {
    ...values,
    darkTheme: pickerChosen('Dark theme'),
    lightTheme: pickerChosen('Light theme'),
  }
}

// WHAT THEME IS ON SCREEN, asked of the document rather than of the store — which is the whole
// point of the Use-System cases: the contract is that the LOOK does not jump, and a store value
// cannot say whether it did.
export const documentTheme = () => document.documentElement.getAttribute('data-theme')

// The footer's build stamp, as the user reads it. Its date follows the Date Format setting through
// the numeric-coercing recipe, so a WRITTEN format still renders it numerically — which is the
// assertion, and it needs the whole string.
export const lastUpdatedText = () =>
  panel()
    .getByText(/^Last Updated:/)
    .textContent.trim()

// ── Check for updates ─────────────────────────────────────────────────────────────────────────

// The Check-for-updates control, found under whichever of its four labels it currently wears. The
// LABEL IS THE STATE, so an accessor tied to the resting name would lose the control exactly when
// there is something to observe.
export const checkUpdatesControl = () =>
  footerButton(/^(Check for updates|Checking…|Up to date|No connection)$/)

// The three things one variable drives, read together because they are only correct together:
//   label      — what it says, which IS the state.
//   disabled   — the NATIVE disabled attribute. This control is the app's one deliberate exception
//                to the CSS-only dim (tests/checkUpdates pins it on purpose, so a rewrite that
//                swapped to aria-disabled fails there), which is why this is `.disabled` and not
//                isOffered().
//   underlined — the interaction signal, worn ONLY at rest. The three status labels are status,
//                not an offer, and a control wearing the signal while not offering the thing is
//                the mistake this deliberately guards.
//
// ⚠ THE LABEL IS READ OFF THE LIVE SPAN, NEVER OFF THE BUTTON. The control holds its resting label
// TWICE — an aria-hidden copy that exists only to reserve width, so the Changelog link beside it
// cannot shift as the label changes, stacked under the live one. `el.textContent` therefore reads
// "Check for updatesChecking…" and would make every label assertion in G11 quietly wrong. (The
// accessible name is unaffected: the name algorithm skips aria-hidden, which is why finding the
// button by its label still works.)
export function checkUpdatesState() {
  const live = [...checkUpdatesControl().querySelectorAll('span')].find(
    (s) => s.getAttribute('aria-hidden') !== 'true',
  )
  if (!live) throw new Error('checkUpdatesState(): the control has no visible label span')
  return {
    label: live.textContent.trim(),
    disabled: checkUpdatesControl().disabled,
    // Worn ONLY at rest: the other three labels are status, not an offer.
    underlined: live.className.includes('underline'),
  }
}

// ── The five modals ───────────────────────────────────────────────────────────────────────────

// THE FIVE SETTINGS MODALS, by short key, with the title each one publishes as its accessible
// name. The manager carries two titles because it retitles itself for the FACTORY view (nothing
// saved yet), and both are the same modal — so the key resolves either, while a caller that means
// one specific view still passes that exact title.
//
// ⚠ `presets` NAMES THE PRESET MANAGER'S **LIST** VIEW ONLY. That card has a second view — its
// delete confirmation, "Delete this preset?" — which replaces the list inside the SAME dialog
// rather than stacking a second one on it (components/PresetManager argues why at length). So the
// table's job here is unchanged: it names the view every modal OPENS on, which is the view every
// `openModal` loop below is about. A case that means the confirmation asks for that title by name,
// and tests/presetManager.dom is where those live.
export const MODAL_TITLES = {
  save: 'Save current settings as your defaults?',
  manage: /^(Your saved defaults|Default settings)$/,
  clear: 'Clear your saved defaults?',
  changelog: "What's new",
  presets: 'Presets',
}
export const MODAL_KEYS = Object.keys(MODAL_TITLES)
const titleFor = (nameOrKey) =>
  typeof nameOrKey === 'string' && nameOrKey in MODAL_TITLES ? MODAL_TITLES[nameOrKey] : nameOrKey

// A settings modal — the Save Defaults popup, the defaults manager, the Clear confirm, the
// Changelog popup. Takes either a short key from the table above or a literal accessible name (the
// form the files that predate the table use, and still the right form when a case is specifically
// about WHICH title the manager is showing).
//
// Asked of the DIALOG by its accessible name rather than of its title TEXT, which is the only form
// that still answers correctly: How to Play is always-mounted and its prose names several of these
// titles, and a role query skips display:none subtrees where a text query does not.
export const modalCard = (nameOrKey) => screen.getByRole('dialog', { name: titleFor(nameOrKey) })
// The same question where "none" is a legitimate answer — "the popup dismissed and the panel
// survived".
export const queryModalCard = (nameOrKey) =>
  screen.queryByRole('dialog', { name: titleFor(nameOrKey) })

// IS ANY MODAL UP? Asked through `[data-settings-modal]`, the marker App itself resolves live in
// two places (the Tab guard at main.tsx:1093 and the click-outside rule at 1347) — so this is the
// app's own definition of "a settings modal is mounted", not a second one invented here.
export const anyModalOpen = () => document.querySelector('[data-settings-modal]') !== null

// A modal's SCRIM — the full-screen backdrop a tap can land on. Resolved from the card outward
// through the same published marker, so it survives any wrapper the extraction adds between them.
export function modalScrim(key) {
  const scrim = modalCard(key).closest('[data-settings-modal]')
  if (!scrim) throw new Error(`modalScrim(${key}): the modal is up but carries no scrim marker`)
  return scrim
}

// The ⚙ panel's Presets section — its one control, at the HEAD of the card rather than in the
// footer with the other four modal openers. Resolved by its accessible name and scoped to the
// panel, which is the same resolution footerButton makes; it is a separate export only because
// calling a button in the first section a "footer" button would be a lie the next reader has to
// unpick. (Why the section sits first at all is argued in components/SettingsPanel: a preset is the
// CONTAINER every setting under it belongs to.)
export const managePresetsButton = () => panel().getByRole('button', { name: 'Manage Presets' })

// How each modal is OPENED from the panel — three footer links, one footer button, and the Presets
// section's. Keyed the same way, so `openModal('clear')` reads as the user's route and not as a
// lookup.
const MODAL_OPENERS = {
  save: () => footerButton('Save Defaults'),
  manage: () => footerButton('View Saved Defaults'),
  clear: () => footerButton('Clear Saved Defaults'),
  changelog: changelogLink,
  presets: managePresetsButton,
}
export function openModal(key) {
  const opener = MODAL_OPENERS[key]
  if (!opener) throw new Error(`openModal: no such modal "${key}" (have: ${MODAL_KEYS.join(', ')})`)
  tap(opener())
}

// THE PRECONDITION FOR REACHING THE SAVE POPUP AT ALL, and it is deliberately explicit rather than
// folded into openModal('save').
//
// Round 14 closed defect D7: all three ⚙ footer buttons now short-circuit their own handlers while
// they are dimmed, so Save Defaults opens its popup only while something actually diverges from the
// effective defaults. Before that, the dim was CSS-only and a programmatic press opened the popup
// from a pristine state — which is how a dozen cases whose SUBJECT is the popup (its chrome, its
// focus trap, its five dismiss routes) happened to reach it.
//
// Those cases need the divergence arranged, and it has to be a value they do not otherwise read, or
// the fixture starts answering the question. Jan/Feb Chance is that value: it is captured in the
// snapshot like any other panel setting, it is the one chance picker that NEVER locks, and no case
// in the net or in saveDefaults.dom.test.jsx asserts it. Call it, then open the popup.
//
// ⚠ It is NOT inside openModal on purpose. A helper that silently moved a setting to make a button
// work would hide state from the cases that go on to save a snapshot and read it back.
//
// ⚠ It asks the app what "default" currently MEANS rather than hard-coding the factory value,
// because several cases call it twice — once to reach the popup, and again after a Save has made
// the value it just moved the new saved default. A fixed literal would silently stop diverging.
export const makeSaveable = () =>
  act(() => {
    const def = effectiveSettingsDefaults(useUserDefaults.getState().saved).janFebChance
    useSettings.getState().setJanFebChance(def === '50' ? '25' : '50')
  })

// EVERY WAY A MODAL GOES AWAY, and the group asserts they are not interchangeable: four of them
// DISCARD pending edits and one of them (`save`) commits.
//   dismiss — the modal's own dismiss control, under whichever caption it currently wears. The
//             manager rests with a single 'Close' and swaps it for 'Cancel' the moment a row is
//             edited, so naming one caption would go blind in the state that matters.
//   save    — the commit control. Only the two DefaultsCard modals have one.
//   scrim   — a FINGER TAP on the backdrop. Cancels the POPUP only; the panel stays up behind it.
//             ⚠ IT IS `tap`, NOT `click`, AND THAT IS THE WHOLE PAIRING. The modal's own dismiss
//             fires on click, but the claim "and the panel is still up behind it" is about the
//             panel's click-outside rule — which listens on document mousedown/touchstart and
//             never sees a click at all (src/main.tsx). A click-only route satisfies that half by
//             never consulting the rule, so it would report "panel survived" even with the rule's
//             `[data-settings-modal]` carve-out deleted. mousedown THEN click drives both.
//   escape  — the capture-phase handler, which consumes the press so the panel's own Escape never
//             sees it.
//   back    — Android hardware Back. LIFO: the modal goes first, the panel on the next press.
//             ⚠ ASYNC — `await closeModal(key, 'back')`; see pressBack for why.
//   panel   — closing the SETTINGS panel, which closes the modal as a child flow.
const MODAL_CLOSE_ROUTES = {
  dismiss: (key) => tap(within(modalCard(key)).getByRole('button', { name: /^(Cancel|Close)$/ })),
  save: (key) => tap(within(modalCard(key)).getByRole('button', { name: 'Save' })),
  scrim: (key) => tap(modalScrim(key)),
  escape: () => act(() => fireEvent.keyDown(document.body, { key: 'Escape' })),
  back: () => pressBack(),
  panel: () => closeSettings('gear'),
}
export const MODAL_CLOSE_ROUTE_NAMES = Object.keys(MODAL_CLOSE_ROUTES)
export function closeModal(key, via = 'dismiss') {
  const go = MODAL_CLOSE_ROUTES[via]
  if (!go)
    throw new Error(
      `closeModal: no such route "${via}" (have: ${MODAL_CLOSE_ROUTE_NAMES.join(', ')})`,
    )
  return go(key) // 'back' is async — see the route table above
}

// A modal's own controls, by accessible name in DOM order — which IS the read-only/dirty state the
// two DefaultsCard modals publish: one 'Close' at rest, 'Cancel' + 'Save' once a row is edited.
export const modalButtons = (key) =>
  within(modalCard(key))
    .getAllByRole('button')
    .map((b) => (b.getAttribute('aria-label') ?? b.textContent).trim())

// A Tab inside a modal, which its scrim's trap owns. Sent from wherever the keyboard currently is
// (the card itself the moment the modal opens), so the wrap at each end is a real traversal rather
// than a press aimed at a chosen element. Returns `prevented` — the trap's only other observable,
// and the one that still discriminates on a modal holding a SINGLE control (the Changelog's lone
// Close button is both ends of the cycle, so "it landed on the first" is true either way there).
export function tabInModal(key, { shift = false } = {}) {
  const scrim = modalScrim(key)
  const from = scrim.contains(document.activeElement) ? document.activeElement : modalCard(key)
  return pressKeyOn(from, 'Tab', { shiftKey: shift })
}

// THE CONTROLS A TAB CAN REACH INSIDE A MODAL, in DOM order — the cycle the trap is a claim about.
// Resolved from the SCRIM rather than the card, because the scrim is the element that carries the
// trap and therefore defines the region being cycled.
//
// ⚠ WHY jsdom MAKES THIS NECESSARY, and it is worth stating so no case re-derives it: jsdom
// implements no native tab navigation, so a Tab pressed with the keyboard on the CARD moves
// nothing — and the trap itself does nothing either, because the card is neither end of the cycle
// and the scrim does contain it, so no branch of the handler fires. A case that pressed Tab from
// the card and asserted "focus is still inside the modal" would therefore assert
// `card.contains(card)`, and would pass with the trap deleted. Seating the keyboard on a real END
// of the cycle is the only way to make the wrap observable here.
export const modalTabStops = (key) => [...modalScrim(key).querySelectorAll('button,input')]

// Put the keyboard on one END of that cycle, so the next Tab is a wrap rather than a no-op.
export function focusModalEdge(key, edge) {
  const stops = modalTabStops(key)
  if (!stops.length)
    throw new Error(`focusModalEdge(${key}): the modal offers no focusable control`)
  if (edge !== 'first' && edge !== 'last')
    throw new Error(`focusModalEdge: expected 'first' or 'last', got ${JSON.stringify(edge)}`)
  const el = edge === 'first' ? stops[0] : stops[stops.length - 1]
  act(() => el.focus())
  return el
}

// The changelog's entry dates, as the user reads them. They follow the Date Format setting through
// the numeric-coercing recipe, so a WRITTEN format still renders them numerically. Matched by the
// numeric date SHAPE the three numeric formats produce (`4/27/1828`, `27.4.1828`, `1828-4-27`),
// which is what the assertion is about — not by any wrapper they happen to sit in.
export const changelogEntryDates = () =>
  [...modalCard('changelog').querySelectorAll('*')]
    .filter(
      (el) => el.children.length === 0 && /^-?\d+[-/.]\d+[-/.]\d+$/.test(el.textContent.trim()),
    )
    .map((el) => el.textContent.trim())

// ── The bar's mode menu ───────────────────────────────────────────────────────────────────────

// The mode dropdown lives in the BAR, not in the panel — but three groups need it: picking a mode
// from it is one of the panel's close routes, and "a Tab did NOT open it" is the assertion behind
// both the modal Tab guard and the panel's own.
//
// Tab is the app-wide route to it (main.tsx's global handler focuses and clicks the trigger), so
// that is the gesture; the dropdown's open panel publishes role="listbox".
export const openModeMenu = () => pressKey('Tab')
export const modeMenuOpen = () => screen.queryByRole('listbox') !== null
export const pickMode = (label) => tap(screen.getByRole('option', { name: label }))

// WHICH MODE THE BAR IS SHOWING — the answer the menu leaves behind, which is what "the pick was
// not swallowed" and "Full Reset landed on Classic" both need. It belongs beside the three above:
// this file already owns the bar's mode menu, and an accessor for opening it with none for reading
// the result is half a subject.
//
// ⚠ READ OFF THE LIVE LEAF SPAN, for the same reason checkUpdatesState() is. The trigger STACKS
// every mode label in one grid cell — invisible width struts, so the bar cannot resize as the mode
// changes — and hides all but the current one, so its textContent reads them all run together.
//
// ⚠ AND THE LIVE ONE IS FOUND BY BEING A LEAF THAT IS NOT HIDDEN, never by matching the string
// 'false'. That is the reconciliation of two definitions the net carried: the other one asked for
// `aria-hidden === 'false'`, which works only because React happens to serialise the literal
// boolean onto the live option (components/CustomSelect renders `aria-hidden={o.value !== value}`).
// A routine a11y tidy-up to `aria-hidden={o.value !== value || undefined}` — dropping the
// attribute instead of writing 'false', which is the more conventional spelling — would leave that
// version finding nothing while changing nothing a user meets. This form asks the question the
// markup actually answers.
//
// ⚠ AND IT LOOKS INSIDE THE VALUE CELL, not at the whole button. The trigger's accessible name is
// COMPOSED from two nodes — an sr-only span carrying the setting's name, then the cell holding the
// options — so the button's first leaf span is now the word "Mode," itself. The cell is reached the
// way the name is: through aria-labelledby's second id, which is the component's own statement of
// which node is the value.
export function currentMode() {
  const trigger = screen.getByRole('button', { name: /^Mode,/ })
  const valueId = (trigger.getAttribute('aria-labelledby') ?? '').split(' ')[1]
  const cell = valueId && document.getElementById(valueId)
  if (!cell) throw new Error("currentMode(): the bar's mode trigger names no value node")
  const live = [...cell.querySelectorAll('span')].find(
    (s) => s.children.length === 0 && s.getAttribute('aria-hidden') !== 'true',
  )
  if (!live) throw new Error("currentMode(): the bar's mode trigger has no live label span")
  return live.textContent.trim()
}

// ── Two things OUTSIDE the panel that only the panel's own outcomes need ──────────────────────

// THE APP'S ONE SCROLL CONTAINER, by the id index.css and the scroll-ownership effect both name.
// Not a mode-screen accessor (which this file refuses): it is app chrome, and "Full Reset puts you
// back at the top of the page" is a panel outcome with no other readout.
export function appScroller() {
  const el = document.getElementById('appScroll')
  if (!el) throw new Error('appScroller(): #appScroll is not in the tree')
  return el
}

// THE FULL-SCREEN "Updating…" SCREEN (BootOverlay's updating variant). It is the user-visible
// consequence the check-for-updates abort-on-close exists to PREVENT, and the question cannot be
// asked through the panel — the overlay deliberately lives outside it, which is the whole problem.
// Null when it is not up, because absence is the assertion.
export const updatingOverlay = () => document.querySelector('.boot-updating')
