// sw-old-windows.js — EVERY WINDOW OF THE VERSION BEFORE COMES ONTO THIS ONE (Round 26, owner-approved).
// Loaded into the service worker the build generates (vite.config: workbox.importScripts), so it runs in
// every new version's worker.
//
// THE PROBLEM. An update is applied when the app is next opened (src/sw.ts, src/main.tsx: a waiting
// worker is told to take over, and the window that found it reloads). Every OTHER window of the app that
// was open at that moment went on running the version before - for as long as it stayed open - and an
// older version beside the new one is the windows-in-sync door's hardest case (design-q1-q2.md 2.8:
// every named residual needs an older window to be open).
// WHAT THIS DOES. When this worker takes over, it writes down the windows open at that moment: every one
// of them runs the version before. Once it is ACTIVE it brings each onto this version by reloading it
// (WindowClient.navigate to its own address) - a window in the background at once, a window on screen at
// its next hide or blur, so nothing is pulled from under the player's eyes or fingers. A window of this
// version asks the worker to look again whenever its own visibility or focus changes (src/sw.ts) - the
// moment another window may have been left. A window opened after the takeover is not on the list, and
// a window that asks is taken off it (it runs this version).
// ⚠ NEVER INSIDE `activate`. A navigation awaited in the activate event's waitUntil waits for the very
// activation it is part of, and neither finishes (tried in Chromium and WebKit: the windows hang). The
// list is written there; the reloads come from the 'activated' state change and from the windows' asks.
// ★ THE LIST IS KEPT IN IndexedDB, not in memory: the browser stops an idle worker whenever it likes, and
// the windows still on the list must be found by whichever start of the worker hears the next ask.
// ⚠ IT REACHES ONLY THIS WORKER'S OWN WINDOWS. The live site and the test site share one origin (one
// IndexedDB) but not one scope, so the test site's worker never reaches a live window, or the other way
// round: each looks only at the windows it controls, and keeps its list under its own scope.
// ★ TESTED where it can be: tests/swOldWindows.test.js runs this file against a fake worker scope (every
// rule above), and the browser lane (tests/browser/oldWindows.browser.ts) deploys a build, opens windows,
// deploys another, and watches them land on it. Headless browsers report every window visible and
// focused, so the lane asks with `anyVisible` - a flag honoured on a loopback address only.
;(() => {
  const DB = 'cg-sw-v1'
  const STORE = 'kv'
  const KEY = `old-windows ${self.registration.scope}`
  // One transaction on the store; resolves the request's result (null on any failure - the list is a
  // convenience: without it nothing is reloaded, and nothing breaks).
  const idb = (mode, act) =>
    new Promise((resolve) => {
      let open
      try {
        open = indexedDB.open(DB, 1)
      } catch {
        resolve(null)
        return
      }
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const db = open.result
        let request = null
        try {
          const tx = db.transaction(STORE, mode)
          request = act(tx.objectStore(STORE))
          tx.oncomplete = () => {
            db.close()
            resolve(request ? request.result : null)
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            resolve(null)
          }
        } catch {
          db.close()
          resolve(null)
        }
      }
    })
  const readOld = () => idb('readonly', (s) => s.get(KEY)).then((v) => (Array.isArray(v) ? v : []))
  const writeOld = (ids) => idb('readwrite', (s) => s.put(ids, KEY))

  // The takeover: the windows this worker controls now ran the version before. (A first install controls
  // nothing - nothing is written; the windows that loaded it are this version already.)
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window' })
        .then((windows) => writeOld(windows.map((w) => w.id))),
    )
  })

  // One look at a time, in order.
  let looking = Promise.resolve()
  const look = (o) => (looking = looking.then(() => reload(o)).catch(() => {}))
  async function reload({ atTakeover = false, anyVisible = false, asker = null } = {}) {
    const stored = await readOld()
    if (!stored.length) return
    const old = new Set(stored)
    // (a window that asks runs this version: never one to reload, whatever id a browser gave it)
    if (asker) old.delete(asker)
    const windows = await self.clients.matchAll({ type: 'window' })
    const left = []
    for (const w of windows) {
      if (!old.has(w.id)) continue
      // in the background - or, after the takeover's own look, left for another window (blurred)
      const away = w.visibilityState === 'hidden' || (!atTakeover && !w.focused)
      if (!away && !anyVisible) {
        left.push(w.id)
        continue
      }
      try {
        await w.navigate(w.url)
      } catch {
        left.push(w.id) // (not one this worker may reload yet: asked again at the next look)
      }
    }
    // (a window closed since, or reloaded - a reload is a new window - is off the list)
    await writeOld(left)
  }
  if (self.serviceWorker)
    self.serviceWorker.addEventListener('statechange', () => {
      if (self.serviceWorker.state === 'activated') look({ atTakeover: true })
    })
  const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname)
  self.addEventListener('message', (event) => {
    const d = event.data
    if (d && d.type === 'SWEEP_OLD_WINDOWS')
      event.waitUntil(
        look({
          anyVisible: LOOPBACK && d.anyVisible === true,
          asker: event.source ? event.source.id : null,
        }),
      )
  })
})()
