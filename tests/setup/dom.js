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
}

// Saved progress (Stage D1) is a module singleton the app reads, so — like the settings store —
// it can leak stats / bests / Lookup history between tests. Reset it before EVERY test (the
// DOM tests also localStorage.clear() + resetSettings() in their own beforeEach). Cheap + idempotent.
beforeEach(() => {
  useProgress.getState().resetProgress()
  // The per-mode setup store (Stage D follow-up) is the same kind of persisted singleton.
  useModePrefs.getState().resetModePrefs()
})
