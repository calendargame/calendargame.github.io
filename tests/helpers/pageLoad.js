// tests/helpers/pageLoad.js — A PAGE LOAD AND A REAL CLOSE, for a file that keeps the app's module
// singletons (one that mounts the statically-imported <App/>, or drives the real stores in place).
//
// WHY. The app's stores are created once, when their modules are first imported, and that IS the
// page load: each reads storage then, and never again on its own. A test file imports them once for
// its whole life, so "reload the page" and "close the app and open it again" have to be said some
// other way. (tests/helpers/persistence's reopenApp says it by importing every module afresh — the
// truest model, but the stores it returns are not the ones a mounted <App/> holds.)
//
//   loadPage() — every store reads storage again, in the order a real load evaluates them: the
//                registry (which preset), then the per-preset stores and the Lookup list. And
//                everything a page holds only in memory is gone: the saves a full device refused
//                (store/storageHealth), and its count of how full the device is (store/storageUsage
//                — the device taken as measured already, as the harness takes it for every test).
//   closeApp() — every window of the app gone, and the next one opening: sessionStorage is emptied
//                (the browsing-session marker with it, so the loadPage() that follows is a fresh
//                open), the session this page joined is dropped, and the opener - which finds no
//                window alive and no reload marker (store/amnesicClose's lock dance, which
//                tests/amnesicClose drives with a fake lock manager) - runs the close: Amnesic's
//                forget, and the next session counted.
// A RELOAD is loadPage() on its own; A REAL CLOSE is closeApp() then loadPage(). A file with the app
// mounted unmounts before either and mounts again after.
//
// ⚠ NOT WRAPPED IN act() HERE. zustand's rehydrate() returns a thenable, and an act() handed one
// goes async and leaves its queue open; a caller with the app mounted wraps the call in a BRACED
// act(() => { loadPage() }) itself (tests/amnesic.dom's note on its own relaunch says what the
// unbraced form costs).
import { usePresets } from '../../src/store/presets.js'
import { useSettings } from '../../src/store/settings.js'
import { useModePrefs } from '../../src/store/modePrefs.js'
import { useProgress } from '../../src/store/progress.js'
import { useUserDefaults } from '../../src/store/userDefaults.js'
import { useLookupHistory } from '../../src/store/lookupHistory.js'
import { forgetStorageHealth } from '../../src/store/storageHealth.js'
import { forgetStorageUsage } from '../../src/store/storageUsage.js'
import { forgetJoinedSession } from '../../src/store/amnesicWindow.js'
import { closeSession } from '../../src/store/amnesicClose.js'

export function loadPage() {
  forgetStorageHealth()
  forgetStorageUsage()
  usePresets.persist.rehydrate()
  useSettings.persist.rehydrate()
  for (const store of [useModePrefs, useProgress, useUserDefaults]) store.persist.rehydrate()
  useLookupHistory.persist.rehydrate()
}

export function closeApp() {
  sessionStorage.clear()
  forgetJoinedSession()
  closeSession()
}
