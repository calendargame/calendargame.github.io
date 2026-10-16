// store/windowSync.ts — WHEN this window hears that the saved data changed under it (design-q1-q2.md v4,
// 2.7 and 6.5), and in what order it then does things.
//
// THE NOTICES:
//   • a `storage` event — another window (a tab, the installed app, the other site: live and staging
//     share one origin) wrote or removed a key. Handed to the door (store/syncedDoc), which merges that
//     doc at once and writes once the notices queued with it have all been handled.
//   • becoming VISIBLE, `pageshow`, `focus`, `resume` — events are queued for a frozen page and MISSED by a
//     page restored from the back/forward cache, so a return reads every doc as the device holds it now.
//     ONE return per burst: the four tend to arrive together, and they are coalesced.
// ★ ON A RETURN, CLOCKS FIRST (6.5, B V4). A hidden window adopts another window's changes into its
// books at once but patches its STORES only on its return — and before it does, every round whose time
// ran out while it was hidden ends, from its own refs, filing its Best as it would have at its own last
// frame (`onReturn`'s settle callbacks, registered by the round screens). Only then are the stores
// patched and the screens' reactions run — so a round that ran out ends before a remote setting change
// resets it, exactly as it does behind an open ⚙ panel.
import { door as defaultDoor, type Door } from './syncedDoc.js'
import { SCRATCH_KEY } from './storageHealth.js'

const settlers = new Set<() => void>()
/**
 * Run `settle` first thing on every return to this window (a round screen ending a round whose time ran
 * out while the window was hidden). Returns the unregister.
 */
export function onReturn(settle: () => void): () => void {
  settlers.add(settle)
  return () => {
    settlers.delete(settle)
  }
}

/** Listen for the notices (once per page, from App's boot effect). Returns the removal. */
export function installWindowSync(d: Door = defaultDoor): () => void {
  if (typeof window === 'undefined') return () => {}
  let area: Storage | null = null
  try {
    area = window.localStorage
  } catch {
    return () => {}
  }
  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== area || e.key === SCRATCH_KEY) return
    d.notice(e.key, e.oldValue, e.newValue)
  }
  let returning = false
  const onBack = () => {
    if (document.visibilityState === 'hidden' || returning) return
    returning = true
    queueMicrotask(() => {
      returning = false
      for (const settle of [...settlers]) settle()
      d.syncAll()
      d.setHidden(false)
    })
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') d.setHidden(true)
    else onBack()
  }
  d.setHidden(document.visibilityState === 'hidden')
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onBack)
  window.addEventListener('focus', onBack)
  document.addEventListener('resume', onBack)
  return () => {
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onBack)
    window.removeEventListener('focus', onBack)
    document.removeEventListener('resume', onBack)
  }
}
