// DOM test harness setup (Stage C, Step 6 — the mode-untangle safety net, sub-step 0).
//
// Referenced by vite.config.js `test.setupFiles`, so it runs before EVERY test file is
// imported, in that file's environment. It does two things:
//
//   1. Registers @testing-library/jest-dom matchers on Vitest's `expect`
//      (toBeInTheDocument, toHaveTextContent, etc.). Harmless under Node.
//
//   2. Installs the handful of browser APIs jsdom omits but the app touches at MODULE
//      LOAD or first render — so a jsdom test can import the real app without crashing:
//        - matchMedia       — read at module scope (isTouch) AND in the theme effect, i.e.
//                             BEFORE any component mounts; must exist the moment main.jsx
//                             is imported (a setupFile guarantees that ordering).
//        - ResizeObserver   — three layout effects construct one (bar-height + two
//                             scroll-state observers).
//        - requestAnimationFrame / cancelAnimationFrame — the timer rAF loop + flash bar.
//        - scrollTo         — BFCache scroll-reset effect + Full Reset.
//
// Every stub is INERT (no-op writes, false/empty reads). Characterization tests assert on
// game logic and rendered output, never on real layout geometry, so faithful measurement
// isn't needed — only that these calls don't throw. All stubs are window-guarded so this
// file is a no-op (beyond the matchers) under the Node-environment pure-logic tests.
import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { useProgress } from '../../src/store/progress.js'
import { useModePrefs } from '../../src/store/modePrefs.js'
import { useLookupHistory, useLookupSession } from '../../src/store/lookupHistory.js'
import { discardAllSessionModes } from '../../src/store/sessionMode.js'
import { discardAllSessionRounds } from '../../src/store/sessionRound.js'

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    // matches:false → systemIsDark=false and isTouch=false → deterministic light/desktop
    // baseline. Tests that need a specific theme/pointer can override per-test.
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {}, // deprecated alias, kept for safety
      removeListener: () => {},
      dispatchEvent: () => false,
    })
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0)
    window.cancelAnimationFrame = (id) => clearTimeout(id)
  }
  // jsdom DOES define window.scrollTo, but as a stub that logs "Not implemented" on every
  // call. The app's BFCache scroll-reset effect calls it on mount, so override it
  // unconditionally with a true no-op to keep the harness output clean.
  window.scrollTo = () => {}
  // Same shape, same reason: HTMLCanvasElement.prototype.getContext IS defined, but jsdom logs
  // "Not implemented: ... without installing the canvas npm package" on every call and then
  // returns null anyway (verified — see tests/presetNameWidth.dom.test.js's own probe case,
  // which is what this stub exists to keep quiet). lib/presetNameWidth's measureTextWidthPx
  // already degrades to a 0-width measurement whenever this returns null (the same "measure
  // nothing, refuse nothing" fallback lib/statFit's fitScale uses for a 0-width box) — this
  // override does not change that outcome, it only silences the noise getting there. A test that
  // needs a REAL (fabricated) measurement overrides this again locally, per file.
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = () => null
  }
}

// Saved progress (Stage D1) is a module singleton the app reads, so — like the settings store —
// it can leak stats / bests between tests. Reset it before EVERY test (the DOM tests also
// localStorage.clear() + resetToFactory() in their own beforeEach). Cheap + idempotent.
beforeEach(() => {
  useProgress.getState().resetProgress()
  // The per-mode setup store (Stage D follow-up) is the same kind of persisted singleton.
  useModePrefs.getState().resetModePrefs()
  // Lookup history (Q1, round 20) left store/progress for its own two stores, and it is a module
  // singleton for the SAME reason the two above are: localStorage.clear() (wherever a test file
  // does its own) cannot reach an in-memory value already sitting in either store, so a test that
  // looked something up would otherwise leak it into every later test in the suite — permanent
  // history into the localStorage-backed store, session-only entries into the sessionStorage one.
  // Reset directly rather than via any "resetX" action neither store needs for app code: setting
  // each list to [] both clears memory and (through persist) overwrites whatever was on disk.
  useLookupHistory.getState().setHistory([])
  useLookupSession.getState().setSessionEntries([])
  // The per-preset SESSION PAGE (store/sessionMode, round-21 Q3) is sessionStorage-backed and keyed
  // by preset id, so a test that switches modes leaves a page choice that a later test's cold
  // mountApp() would restore instead of opening on the launch Classic. Same class of leak as the
  // singletons above; cleared the same way, before every test.
  discardAllSessionModes()
  // The per-(preset, mode) PARKED ROUND (store/sessionRound, round-21 Q11) is the same shape of leak:
  // a sessionStorage-backed singleton keyed by preset id, so a test that finishes a Blitz round or a
  // MoX run leaves a parked snapshot a later test's cold mountApp() would restore onto the timed
  // screen. Cleared the same way, before every test.
  discardAllSessionRounds()
})
