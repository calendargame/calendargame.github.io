import { usePresets, presetListed } from './presets.js'
import { amnesicOf, amnesicOnOf } from './settings.js'
import { PROGRESS_DOOR } from './progress.js'
import { door } from './syncedDoc.js'
import { browsingSessionOpen } from './browsingSession.js'
import { discardAllSessionHistories } from './sessionHistory.js'
import { discardAllSessionRounds } from './sessionRound.js'
import {
  readSessionCounter,
  writeSessionCounter,
  joinedSession,
  currentSession,
  type PendingForget,
} from './amnesicWindow.js'
import { captureError } from '../observability/sentry.js'

// store/amnesicClose.ts — THE APP'S CLOSE, AND AMNESIC'S FORGET AT THE NEXT OPEN (design-amnesic-close.md
// 2; store/amnesic says what Amnesic is).
//
// ★ A CLOSE IS EVERY WINDOW OF THE APP GONE. Every window of this build holds a SHARED Web Lock, `cg-app`,
// for its whole life (`joinSession`, before the app is drawn). A lock is held by a live document and let go
// when the document is destroyed - a closed tab, an app swiped away, a crash, iOS evicting it - with no
// event to deliver, and a suspended app still holds it. So at boot a window asks for the lock EXCLUSIVELY,
// "if available":
//   • granted - no other window of the app is alive. A reload (this tab's browsing-session marker is set,
//     store/browsingSession) is not a close: nothing is forgotten. Anything else is a COLD OPEN AFTER A
//     CLOSE: the forget runs (`closeSession`) and, when it forgot anything, the session counter moves on -
//     then, still inside the
//     exclusive lock, the window queues its own shared request and lets go (the lock manager grants a
//     queued request in the same step as the release, so no other window can find the app empty between).
//   • not granted - other windows are alive: it asks for the shared lock (granted at once - or, while an
//     opener holds the exclusive one for its forget, as soon as that is done) and joins the running session.
// Measured reliable in real Chromium and WebKit (design 2: thousands of boots, storms of simultaneous
// opens, not one window booted inside an opener's forget). ⚠ NOT MEASURED: the installed iOS app and iOS
// Safari themselves (the owner's phone), a page in the back-forward cache, a frozen background tab - the
// session check below covers the last two whatever the lock does.
// ⚠ A BROWSER WITHOUT WEB LOCKS cannot tell a close from anything else, so it joins and never forgets: no
// guess stands in for the lock (Safari 15.4 and every current browser have them).
//
// ★ THE FORGET (`closeSession`), for every preset whose Amnesic value is Stats Only or Full at the close: the
// window that just ended - `<the session that ended>:<its switch-on>` (store/amnesicWindow) - is put back
// out of its saved progress, every mode anchored in it to its anchor and, under Full, every Best record too
// (store/progressDoor's forget). Before the app is drawn: nothing ever shows what was forgotten. A forget the
// device refuses (it is full) is held and retried like any save, and written down in the counter
// (`pending`) so every window that opens runs it again until it lands - it is idempotent: a slice put back
// carries no anchor of that window.
// ★ A WINDOW THAT COMES BACK TO A SESSION THAT HAS ENDED - from the browser's back-forward cache, or a
// discarded tab reloading after every window had closed and the app opened again elsewhere - drops what it
// kept for that session (its parked histories and ended rounds: they may name what was forgotten) and
// starts again in the session now running.

const LOCK = 'cg-app'
// (the session this TAB last joined, kept across its reloads)
const JOINED_KEY = 'cg-session-joined-v1'

/**
 * Join the app's session before anything is drawn (src/main.tsx awaits it): close detection, the forget of
 * a session that ended, and the window's shared lock for the rest of its life.
 */
export async function joinSession(): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) {
    enter()
    return
  }
  let shared: Promise<void> | null = null
  try {
    await locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) return
      // no other window of the app is alive: a reload, or a cold open after a close
      if (!browsingSessionOpen()) closeSession()
      shared = holdShared(locks)
    })
    await (shared ?? holdShared(locks))
  } catch (error) {
    // (a lock manager that refuses outright: the window joins, and nothing is forgotten)
    captureError(error instanceof Error ? error : new Error(String(error)), {
      where: 'amnesic-close',
    })
  }
  enter()
}

// The shared lock, held for the document's life (granted while no opener holds the exclusive one).
const holdShared = (locks: LockManager): Promise<void> =>
  new Promise((granted) => {
    void locks.request(LOCK, { mode: 'shared' }, () => {
      granted()
      return new Promise<never>(() => {})
    })
  })

// (the document's one watch for its return from the back-forward cache)
let watching = false
// The window joins the session now running: the device as it is now (an opener's forget may have landed
// while it waited), a forget a full device still owes, and what it kept for a session that has ended.
function enter(): void {
  const n = readSessionCounter().n
  joinedSession(n)
  door.syncAll()
  runPending()
  if (keptFor() !== n) leaveEndedSession()
  noteJoined(n)
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('pageshow', (event) => {
    // (back from the back-forward cache, into a session that has since ended: start again in the new one)
    if (event.persisted && readSessionCounter().n !== currentSession()) {
      leaveEndedSession()
      window.location.reload()
    }
  })
}

/**
 * THE CLOSE: the forget of the session that just ended, for every preset whose Amnesic value is Stats Only
 * or Full now (the value at the close - no window has run since), and the next session counted. Runs
 * inside the exclusive lock, before any window can join.
 * ★ A CLOSE THAT OWES NO FORGET WRITES NOTHING. Every preset on Off (and nothing held from an earlier
 * close): nothing played can be anchored in a window still open - a window opens only at a switch-on, and
 * that switch-on is the preset's counter moving - so the session need not move either, and a device that
 * never uses Amnesic is never written at a load (design-q1-q2.md v4's G7, tests/browser/writeCounts).
 * The session moves exactly when a close forgets: then the window that ended is never reused, even for
 * a mode whose anchor the forget had to leave (R17).
 */
export function closeSession(): void {
  const c = readSessionCounter()
  const owed: PendingForget[] = [...c.pending]
  for (const p of usePresets.getState().presets) {
    const value = amnesicOf(p.id)
    if (value === 'off') continue
    owed.push({ presetId: p.id, e: `${c.n}:${amnesicOnOf(p.id)}`, full: value === 'full' })
  }
  if (!owed.length) return
  writeSessionCounter({ n: c.n + 1, pending: forgetEach(owed) })
}

// A forget a full device held at a close, run again by every window as it joins (idempotent).
function runPending(): void {
  const c = readSessionCounter()
  if (!c.pending.length) return
  const left = forgetEach(c.pending)
  if (left.length !== c.pending.length) writeSessionCounter({ n: c.n, pending: left })
}

// Run each forget; what is left owed (the device refused it - a preset since deleted owes nothing).
const forgetEach = (owed: readonly PendingForget[]): PendingForget[] =>
  owed.filter((f) => presetListed(f.presetId) && !PROGRESS_DOOR.forget(f.presetId, f.e, f.full))

// The session this tab last joined (null: none - its first boot), and the note of it.
const keptFor = (): number | null => {
  try {
    const v = window.sessionStorage.getItem(JOINED_KEY)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
}
const noteJoined = (n: number): void => {
  try {
    window.sessionStorage.setItem(JOINED_KEY, String(n))
  } catch {
    /* storage refused — nothing was kept for the session either */
  }
}
// What this tab kept for a session that has ended goes: its parked histories and ended rounds. (A tab's
// first boot keeps nothing yet: there is nothing to drop.)
function leaveEndedSession(): void {
  if (keptFor() === null) return
  discardAllSessionHistories()
  discardAllSessionRounds()
}
