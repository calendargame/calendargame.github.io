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
//        - offsetParent     — the one layout fact the app's KEYBOARD handler asks (see below).
//
// Every other stub is INERT (no-op writes, false/empty reads). Characterization tests assert on
// game logic and rendered output, never on real layout geometry, so faithful measurement
// isn't needed — only that these calls don't throw. All stubs are window-guarded so this
// file is a no-op (beyond the matchers) under the Node-environment pure-logic tests.
import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { useProgress } from '../../src/store/progress.js'
import { useModePrefs } from '../../src/store/modePrefs.js'
import { useLookupHistory } from '../../src/store/lookupHistory.js'
import { forgetJoinedSession } from '../../src/store/amnesicWindow.js'
import { discardAllSessionModes } from '../../src/store/sessionMode.js'
import { discardAllSessionDedTypes } from '../../src/store/sessionDedType.js'
import { discardAllSessionRounds } from '../../src/store/sessionRound.js'
import { discardAllSessionHistories } from '../../src/store/sessionHistory.js'
import { discardGuidePlace } from '../../src/store/sessionGuide.js'
import { discardLookupScreen } from '../../src/store/sessionLookup.js'
import { forgetBrowsingSession } from '../../src/store/browsingSession.js'
import { useSettings } from '../../src/store/settings.js'
import { forgetSessionPreset } from '../../src/store/sessionPreset.js'
import { forgetStorageHealth } from '../../src/store/storageHealth.js'
import { door } from '../../src/store/syncedDoc.js'
import { useSwapEpoch, NO_SWAPS } from '../../src/lib/unaskedSwap.js'
import { forgetStorageUsage } from '../../src/store/storageUsage.js'
import { useUserDefaults } from '../../src/store/userDefaults.js'
import { usePresets, makePresetRegistryDefaults } from '../../src/store/presets.js'

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
  // ★ offsetParent — SO THE KEYBOARD SHORTCUTS CAN BE TESTED AT ALL. App's key handler finds the
  // button a game key means by walking the page for the one that is ON SCREEN (src/main.tsx: the
  // answer grid for 0–9, the [data-key] walk for N / R / O / C / S / ← / →), and "on screen" is
  // `offsetParent !== null` — every mode screen stays mounted, hidden with display:none, so each
  // key has five buttons and one of them showing. jsdom does no layout: offsetParent is null for
  // EVERY element, so the handler skipped every button and no game key did anything in any test.
  // A key test could only ever prove a press was ignored, and it "proved" that of every key.
  // So the harness gives offsetParent the one rule the app relies on, for every DOM test: null for
  // an element that is not in the document or sits inside a display:none subtree (inline — the
  // suite loads no stylesheet, and the mode screens hide themselves inline — or the `hidden`
  // attribute), its parent element otherwise. It is not the browser's real positioned ancestor,
  // and nothing in the app asks for that: both readers only compare it with null.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      if (!this.isConnected) return null
      for (let el = this; el; el = el.parentElement)
        if (el.hidden || el.style?.display === 'none') return null
      return this.parentElement
    },
  })
}

// Saved progress (Stage D1) is a module singleton the app reads, so — like the settings store —
// it can leak stats / bests between tests. Reset it before EVERY test (the DOM tests also
// localStorage.clear() + resetToFactory() in their own beforeEach). Cheap + idempotent.
beforeEach(() => {
  // EVERY CASE STARTS ON AN EMPTY DEVICE (localStorage), and the windows-in-sync door's BOOKS
  // (store/syncedDoc) - this page's knowledge of each saved doc, module state that a close would drop
  // with the page - are forgotten with it. Both FIRST: every reset below is then a write onto a device
  // that holds nothing, which is what it models. (The order matters since the door merges: a registry
  // put back to one preset over a device still listing a previous case's five would be read as a
  // window that never knew of them, and the five would be kept - the membership rule, design 8.1.)
  if (typeof localStorage !== 'undefined') localStorage.clear()
  door.forget()
  // …and the unasked-swap guard (lib/unaskedSwap): page state a close drops, and the next case's
  // clock (fake timers start it afresh) may sit before a swap the last case noted.
  useSwapEpoch.setState(NO_SWAPS)
  // ⚠⚠ THE REGISTRY GOES BACK FIRST, AND THE ORDER IS THE WHOLE POINT — it decides WHERE every reset
  // below lands. The per-preset stores persist through a preset-SCOPED storage (store/presets'
  // presetDoc), so while the registry still says "preset 2" a reset writes preset 2's
  // namespaced keys: a file that switched presets in one test left `cg-settings-v1~p2` behind for the
  // next, written by this very net a moment after the file's own localStorage.clear(). Nothing in the
  // app reads that key afterwards — but store/presetControl's createPreset does (its skip loop refuses
  // an id whose keys already exist), so the next test's "createPreset then switch to preset 2" got
  // preset 3 and switched to a preset that did not exist. Found by a shuffled run (round 22's fixer).
  // It is the same ordering tests/helpers/settingsPanel's resetAppState states for the same reason;
  // this is the global net saying it for every file, including the ones with a reset of their own.
  usePresets.setState(makePresetRegistryDefaults())
  // …and with it the active preset's AMNESIC VALUE and its switch-on counter (store/settings - fields of
  // its settings, which the factory reset of the 16 does not touch, by design), and the app session this
  // page joined (store/amnesicWindow - page state a close drops; the device's counter went with the clear).
  useSettings.setState({ amnesic: 'off', amnesicOn: 0 })
  forgetJoinedSession()
  // …and the session's record of WHICH PRESET it is on (store/sessionPreset), for the same reason
  // and by the same route: it is what a reload lands in, so one left by an earlier test would put a
  // later test's "reload" on a preset that test never opened.
  forgetSessionPreset()
  useProgress.getState().resetProgress()
  // The per-mode setup store (Stage D follow-up) is the same kind of persisted singleton.
  useModePrefs.getState().resetModePrefs()
  // Lookup history (round 20) left store/progress for its own store, and it is a module singleton
  // for the SAME reason the two above are: localStorage.clear() (wherever a test file does its own)
  // cannot reach an in-memory value already sitting in the store, so a test that looked something up
  // would otherwise leak it into every later test in the suite. Reset directly rather than via any
  // "resetX" action the store does not need for app code: setting the list to [] both clears memory
  // and (through persist) overwrites whatever was on disk.
  useLookupHistory.getState().setHistory([])
  // The per-preset SESSION PAGE (store/sessionMode, round 21) is sessionStorage-backed and keyed
  // by preset id, so a test that switches modes leaves a page choice that a later test's cold
  // mountApp() would restore instead of opening on the launch Classic. Same class of leak as the
  // singletons above; cleared the same way, before every test.
  discardAllSessionModes()
  // …and the Deduction sub-type each window is on (store/sessionDedType), the same kind of place.
  discardAllSessionDedTypes()
  // The per-(preset, mode) PARKED ROUND (store/sessionRound, round 21) is the same shape of leak:
  // a sessionStorage-backed singleton keyed by preset id, so a test that finishes a Blitz round or a
  // MoX run leaves a parked snapshot a later test's cold mountApp() would restore onto the timed
  // screen. Cleared the same way, before every test.
  discardAllSessionRounds()
  // …and the casual modes' PARKED HISTORY (store/sessionHistory), parked when the page hides or the
  // stats copy underneath the screens is swapped, and read back by a screen's mount: a test that
  // does either would otherwise hand its history to the next test's first mount. Cleared the same
  // way, before every test.
  discardAllSessionHistories()
  // …and How to Play's place parked for a reload (store/sessionGuide) — same leak.
  discardGuidePlace()
  // …and Lookup's screen kept for a reload (store/sessionLookup) — same leak.
  discardLookupScreen()
  // The BROWSING-SESSION MARKER (store/browsingSession) is what tells a genuine cold open
  // from a reload — it survives a reload and not a close. The harness has no close event, so without
  // this every test after the first in a worker would boot as a "reload". Forgetting it here makes
  // each test's first mount the fresh visit it models; a test that wants a reload simply remounts
  // without forgetting it.
  forgetBrowsingSession()
  // The STORAGE-FULL state (store/storageHealth) is in-memory module state: the saves a full device
  // refused, held for their destinations, and whether the notice is up. A test that fills the device would
  // otherwise leave the next one mid-episode — a notice that never opens, or one already open.
  forgetStorageHealth()
  // …and so is what the page knows about HOW FULL the device is (store/storageUsage): its running
  // count, the limit it measured, a warning it has shown. Forgotten the same way — and the device is
  // taken to have been measured already, so an ordinary test is not a device waiting to be measured
  // (a mounted app would otherwise write megabytes of scratch two seconds into any test that runs
  // that long). tests/storageUsage.dom starts from "never measured" where that is the subject.
  forgetStorageUsage()
  // The SAVED PERSONAL DEFAULTS snapshot (store/userDefaults) is the last singleton of this shape,
  // and it was the one this net was missing — found by a shuffled run (round 22's fixer), where a
  // file that saves a snapshot left it standing for whatever file ran next in the same worker.
  // It is the widest leak of the lot, because almost nothing reads the snapshot directly: what reads
  // it is the word "default" everywhere else — the gear indicator, both trio dims, Full Reset's
  // own dim, every mode screen's freshness report — so the symptom is never "a default is wrong", it
  // is a button in the wrong state three files away. A file that wants a snapshot saves it in its
  // own beforeEach, as several already do; this only guarantees nobody INHERITS one.
  useUserDefaults.getState().clearDefaults()
})
