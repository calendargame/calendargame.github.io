import { captureError } from './observability/sentry'

// sw.ts — PWA service-worker registration (auto-update-on-open).
//
// ONE native call, deliberately. This module used to go through vite-plugin-pwa's
// `virtual:pwa-register` helper, which pulled workbox-window in as its own ~5.6 KB precached chunk
// for one thing this app wanted — navigator.serviceWorker.register(swUrl, {scope, type}) — and one
// it very much did not.
//
// In the registerType:'prompt' branch the helper wires two Workbox listeners, `installed` and
// `waiting` (node_modules/vite-plugin-pwa/dist/client/build/register.js). `installed` only fans out
// to onNeedRefresh / onOfflineReady, which this app never passed, so it really was a no-op.
// `waiting` WAS NOT: it runs showSkipWaitingPrompt, which attaches a `controlling` listener whose
// handler reloads the page — `onNeedReload()` if one was passed, and otherwise, taken precisely
// BECAUSE this app passed none, a bare `window.location.reload()`. So the app carried TWO reload
// paths racing the same controllerchange: main.tsx's gated one (hold the "Updating…" screen for
// MIN_UPDATING_MS, then markSkipBootHold() immediately before navigating) and the helper's ungated
// one. Whenever the helper's won, it cut the Updating screen short of its hold AND skipped the
// skip-boot-hold stamp, so the boot it caused then sat through the splash's full artificial hold
// instead. Deleting it is why the update sequence's VISIBLE TIMING changes: what the user sees is
// now exactly, and only, what main.tsx specifies.
//
// The helper's returned updateSW() is deliberately unused (see the LAUNCH bullet below), and
// everything the app actually needs is hand-rolled against the native API in main.tsx already —
// waiting detection, the direct {type:'SKIP_WAITING'} message, the controllerchange handoff, and
// update(). So the dependency bought nothing it was wanted for, and cost a chunk, a precache entry,
// a rogue reload, and the crash below.
//
// THE CRASH. workbox-window 7.4.1's Workbox.register() reads `this._registration.waiting` with no
// guard — the only unguarded `.waiting` of the four in that file. On a device whose Service Worker
// API is stubbed (privacy extension, enterprise shim, bot), register() RESOLVES `undefined` instead
// of resolving a registration or rejecting, which is not spec-legal; `this._registration` is then
// undefined and it threw "Cannot read properties of undefined (reading 'waiting')" from inside a
// minified third-party bundle. That signature has no public report anywhere, so no upstream fix was
// coming, and the report it produced pointed at workbox's code rather than at the real condition.
// The explicit check below turns the same device into a named, actionable report from OUR code, in
// the same place a rejected registration already goes. Nothing else about it changes.
//
// registerType is 'prompt' (vite.config), so a newly-deployed SW INSTALLS but WAITS — it does NOT
// silently activate + reload in the middle of a session. Instead:
//   • On LAUNCH, App's boot effect checks navigator.serviceWorker.getRegistration().waiting (instant,
//     no network — and IN PARALLEL with this module's dynamic import, since the check doesn't need
//     it); if a waiting worker is present (a new version downloaded on a previous visit), App shows
//     the "Updating…" screen, messages the waiting worker DIRECTLY with {type:'SKIP_WAITING'} (a
//     message handler the generateSW worker ships natively), and reloads exactly once on
//     controllerchange. So a fresh deploy lands cleanly + visibly on the NEXT open, not as a silent
//     flash — with no dependence on this module having loaded first. That independence is why this
//     module exports NOTHING and why the update is never applied through a handle it returns:
//     anything main.tsx had to call HERE would race this registration and could silently no-op.
//   • The .then() below kicks off a background registration.update(), so any newer SW downloads +
//     becomes the waiting worker, ready to apply on the next launch.
//   • NO visibility/focus re-check — cold-open only (the owner's call), so it never reloads on a
//     mere app resume.
// The Settings → "Check for updates" button CHECKS first and applies a real update through this same
// registration (round 11); forceReloadLatest is its fallback when there is nothing to hand off to.
//
// This whole path is service-worker behaviour that only runs in a real browser with a built SW
// (devOptions.enabled is false, and jsdom has no SW), so the LIVE behaviour is verified ON-DEVICE on
// staging. What IS testable — what gets registered, and that every failure mode reports exactly once
// instead of crashing — is tests/swRegistration.dom.test.js, which drives this module directly.
//
// No 'serviceWorker' in navigator guard here on purpose: main.tsx's auto-update effect is the sole
// importer and it already gates on exactly that before it dynamically imports this module, so a
// second check would be duplicated, permanently-dead code. And it fails safe either way — a throw at
// module scope rejects that dynamic import, which main.tsx reports as {where:'sw-module-import'}.

// The URL and the scope MUST stay byte-identical to what vite-plugin-pwa's generated helper passed,
// or an existing installation would be joined by a SECOND worker at a different scope. The plugin
// built them (dist/index.js, generateRegisterSW) as `options.buildBase + options.filename` and
// `options.scope || basePath`, where buildBase and basePath are both Vite's resolved `base` and
// filename is the default 'sw.js' — i.e. precisely `${BASE_URL}sw.js` and `BASE_URL`. Verified
// against the BUILT bundle for both bases this app ships from: live '/' → ('/sw.js', scope '/'),
// staging '/test_version/' → ('/test_version/sw.js', scope '/test_version/'). `type` is 'classic'
// because the plugin's ternary picks it whenever devOptions.enabled is false; it is also
// register()'s own default, and it is stated explicitly because generateSW emits a classic script
// and that must never be silently re-derived. All three are pinned by the test file above.
//
// Calling at module scope, not on window 'load', is the helper's `immediate: true` — one of the two
// options this app passed it, and all that option ever did was skip an `await` on the load event.
// (The other was onRegisteredSW, whose only job — the background update() prefetch — is the .then()
// below.)
navigator.serviceWorker
  .register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    type: 'classic',
  })
  .then((registration) => {
    // The stubbed-API case described above. register() must resolve a ServiceWorkerRegistration or
    // reject; a resolved non-registration means this device has no real service worker, which is
    // the same outcome as an outright rejected registration — no offline copy, no update path — so
    // it takes the same route out rather than being quietly skipped.
    if (!registration)
      throw new TypeError(
        `navigator.serviceWorker.register() resolved ${String(registration)} instead of a ServiceWorkerRegistration`,
      )
    // The background prefetch. Its rejection stays SILENT on purpose — unlike a failed
    // registration, a failed update() is the ordinary offline case (no network, nothing newer to
    // find) and the app is fully healthy without it: the worker it already has keeps serving, and
    // the next launch tries again. Reporting it would drown the signal below in expected noise.
    registration.update().catch(() => {})
  })
  // Round 11: registration FAILING is the opposite case — it leaves the app running with NO
  // service worker at all (no offline copy, no update path, and the "Check for updates" button with
  // nothing to apply through). An agent hit exactly that state in July 2026 and nothing anywhere
  // said so, because this reporting did not exist and the rejection had nowhere to go. It is rare
  // and always actionable, so it goes to Sentry. (The OTHER way the same outcome happens — this
  // module's chunk failing to load at all — is captured at the dynamic import in main.tsx; the two
  // fail independently, which is why both halves are wired.)
  .catch((error) => {
    captureError(error, { where: 'sw-register' })
  })
