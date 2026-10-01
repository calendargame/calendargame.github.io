import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildIdUrl,
  checkForUpdate,
  makeCheckNonce,
  readOwnBuildId,
  UPDATE_RESULT_MS,
} from '../lib/updateCheck.js'
import type { UpdateCheckState } from '../lib/updateCheck.js'
import { useSettingsCloseEffect } from './useSettingsCloseEffect.js'

// useUpdateCheck — the ⚙ Settings "Check for updates" button's whole INTERACTION, in one place.
//
// The feature has always been three parts, and until round 15 only two of them had a home:
//   • THE DETECTOR — "is a different build deployed?" — src/lib/updateCheck.ts, pure, and the long
//     account of why it is a build-identity file (and not cache:'reload', not DEPLOY_TS, not
//     registration.update()) lives there.
//   • THE INTERACTION — this file. One button whose LABEL IS ITS STATE, the 3s result window, the
//     refusal of a second in-flight check, and the abort-on-close below.
//   • THE APPLIER — App's applyUpdate, passed in. It stays in main.tsx deliberately: it raises the
//     Updating overlay (setUpdating), claims the overlay through to a navigation
//     (updateReloadPendingRef, shared with the build-change flash), and drives the reload gate /
//     forceReloadLatest — all App-and-module-scope machinery this hook has no business owning. From
//     here it is simply "there is something to get; take it from here". It answers whether it TOOK
//     the update. When it did it is TERMINAL: every route out of it navigates, so nothing below runs
//     afterwards and `updateCheck` is deliberately left reading 'checking' underneath the full-screen
//     overlay. When it DECLINED (a save the device refused is unsaved, and a reload would lose it —
//     App says why on screen) the button simply goes back to rest: nothing was applied, and the same
//     press finds the same update once the reason is gone.
//
// STATE MACHINE: idle → checking → (current | offline) → idle after UPDATE_RESULT_MS, or → the
// applier when there is something to get (→ idle if it declines). A press during a RESULT starts another check (the result
// is information, not a mode you have to dismiss); a press during 'checking' cannot happen — the
// button is disabled — and is refused anyway so a synthetic click cannot start a second in-flight
// check.
//
// ★ WHERE THIS HOOK MAY BE CALLED FROM: APP, AND NOTHING THAT UNMOUNTS WHEN ⚙ SETTINGS CLOSES.
// The abort-on-close below is a useSettingsCloseEffect, and that hook seeds its wasOpenRef from the
// first value it ever sees (useSettingsCloseEffect.ts:37) — a caller mounted while the panel is
// open and unmounted on close never produces the true→false transition, so its body NEVER RUNS.
// Nothing throws, and the suite would not catch it either: the unmount teardown at the bottom of
// this file also aborts the controller, and "reopening shows the resting label" would be satisfied
// by the state being destroyed rather than by the reset. So moving this call into a conditionally
// rendered settings panel would silently delete the abort while every existing case stayed green.
// It is a code-review gate, and this paragraph is it. App passes the panel the two values below.
export function useUpdateCheck(
  settingsOpen: boolean,
  // App's applier. Expected to be referentially stable (a useCallback with no deps in main.tsx);
  // it is an honest dependency of onCheckUpdates below rather than a ref, so an unstable one only
  // costs the button a new onClick identity per render — never a stale applier.
  // Returns whether it took the update (true ⇒ a navigation is coming).
  applyUpdate: (reg: ServiceWorkerRegistration | null) => boolean,
): { updateCheck: UpdateCheckState; onCheckUpdates: () => void } {
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>('idle')
  const updateResultTimerRef = useRef<number | undefined>(undefined)
  const updateCheckAbortRef = useRef<AbortController | null>(null)
  const onCheckUpdates = useCallback(() => {
    if (updateCheck === 'checking') return
    if (updateResultTimerRef.current !== undefined) {
      window.clearTimeout(updateResultTimerRef.current)
      updateResultTimerRef.current = undefined
    }
    updateCheckAbortRef.current?.abort()
    const controller = new AbortController()
    updateCheckAbortRef.current = controller
    setUpdateCheck('checking')
    void (async () => {
      let reg: ServiceWorkerRegistration | null = null
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator)
          reg = (await navigator.serviceWorker.getRegistration()) ?? null
      } catch {
        /* no registration readable — the identity fetch still answers the question */
      }
      if (controller.signal.aborted) return
      const verdict = await checkForUpdate({
        ownId: readOwnBuildId(document),
        url: buildIdUrl(import.meta.env.BASE_URL, makeCheckNonce()),
        hasWaitingWorker: Boolean(reg?.waiting),
        // Wrapped, not passed by reference: a bare `fetch` detached from window throws Illegal
        // Invocation in some engines, and an engine with no fetch at all must throw INSIDE
        // checkForUpdate's try (where it reads as 'offline') rather than out here.
        fetchImpl: (input, init) => fetch(input, init),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (verdict === 'update') {
        if (!applyUpdate(reg)) setUpdateCheck('idle')
        return
      }
      setUpdateCheck(verdict)
      updateResultTimerRef.current = window.setTimeout(() => {
        updateResultTimerRef.current = undefined
        setUpdateCheck('idle')
      }, UPDATE_RESULT_MS)
    })()
  }, [updateCheck, applyUpdate])
  // Closing ⚙ Settings ends the whole interaction early: the pending revert timer is cleared, the
  // label is back at rest for the next open, and an in-flight check is ABORTED rather than left to
  // land behind a panel the user has just dismissed — a full-screen Updating overlay appearing
  // after the menu closed would be the app acting on its own. Fires only when the state actually
  // moved while the panel was open, which is exactly when there is anything to undo
  // (useSettingsCloseEffect's contract). See the caller rule above: this is the load-bearing line.
  useSettingsCloseEffect(settingsOpen, [updateCheck], () => {
    updateCheckAbortRef.current?.abort()
    if (updateResultTimerRef.current !== undefined) {
      window.clearTimeout(updateResultTimerRef.current)
      updateResultTimerRef.current = undefined
    }
    setUpdateCheck('idle')
  })
  // Unmount teardown: drop an in-flight check and any pending revert. The refs are this hook's own
  // timer/abort handles, so reading them at teardown is exactly the point.
  useEffect(
    () => () => {
      updateCheckAbortRef.current?.abort()
      if (updateResultTimerRef.current !== undefined)
        window.clearTimeout(updateResultTimerRef.current)
    },
    [],
  )
  return { updateCheck, onCheckUpdates }
}
