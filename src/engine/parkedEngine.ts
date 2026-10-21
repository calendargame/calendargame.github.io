// ─────────────────────────────────────────────────────────────────────────
// engine/parkedEngine.ts — THE RESTORE DOOR: the one way a parked engine state comes back.
//
// Two stores park whole engine states in sessionStorage for the browsing session: store/sessionRound
// (an ended Blitz round / MoX run) and store/sessionHistory (a casual mode's history). Every one of
// them comes back through `restoreParkedEngine` below — each timed mode calls it on its parked
// snapshot at mount, and engine/parkedHistory calls it for the casual modes — BEFORE anything reads
// the state, so a screen's own fields and its engine are kept or dropped together, never one without
// the other.
//
// ★ A PARKED BLOB IS UNTRUSTED, and the door's whole job is to say so. sessionStorage is per ORIGIN
// and a tab keeps it across an update's reload (and until Round 27 the test site shared this origin,
// at calendargame.app/test_version/) — so a build this one has never heard of can have written the
// slot, and a reload keeps it. Unguarded, the first
// bad read threw inside the engine's lazy initializer at mount, and since the blob outlives the
// reload, every reload died the same way for the rest of the browsing session: a mode screen bricked
// until the tab was closed.
//
// ⚠ A DIFFERENT SHAPE IS NEVER MIGRATED, AND THAT IS DELIBERATE. Both slots are keyed by a name only
// builds with TODAY'S engine shape have ever written (`cg-round-v2`, `cg-history-v1`); the older
// shapes lived under a key this build does not read. A later build that changes the shape changes the
// key, and anything else that turns up in a slot is refused below rather than guessed at.
//
// ★ A JUDGED CARD WITH NO CALENDAR IS REFUSED QUIETLY (`holdsUnstampedCard`, below). Builds up to
// v2.27.3 judged a card without recording which calendar they judged it in (CardMeta.jul); every
// build since stamps its own. Until Round 26 this door gave such a card its calendar back, read off
// its grid, for the release in which a tab could still go from one of those builds to this one; that
// went in the release that turned sealing on (store/progressStorage), once every copy of the app on
// a device stamped its cards. One honest path can still bring such a card: sessionStorage outlives
// its page, so a browser tab last used on one of those builds, evicted and reloaded by the browser
// or reopened from history, can hold one. So it is refused like a blob this build cannot read — the
// mode starts from its saved stats — but NOT REPORTED: it is not a defect, and a report would send
// whoever reads it after a bug that is not one.
// ─────────────────────────────────────────────────────────────────────────
import { checkGameInvariants } from './invariants.js'
import { captureError } from '../observability/sentry.js'
import type { GameState } from './gameReducer.js'

/** Is this a non-null object — the first question asked of anything read back out of storage. */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

// A card an older build judged: its grid marks something (it has been judged), and its record names
// no calendar. Asked of a blob whose shape has already been checked (restoreParkedEngine, below).
const unstamped = (btns: unknown, meta: unknown): boolean =>
  isObj(btns) && Object.keys(btns).length > 0 && !(isObj(meta) && typeof meta.jul === 'boolean')
function holdsUnstampedCard(blob: Record<string, unknown>): boolean {
  const history = [...(blob.stack as unknown[]), ...(blob.forwardStack as unknown[])]
  return (
    unstamped(blob.persistBtns, blob.card) ||
    history.some((e) => isObj(e) && unstamped(e.btns, e.meta))
  )
}

// A parked blob in, today's engine state out, or null when the blob is not one. Null means "nothing
// is parked": the caller drops its WHOLE snapshot (its own fields ride on this engine, so a fresh
// engine under a restored "ended" screen would be a state no play reaches) and the mode comes up
// fresh — and the slot goes the way its store retires any other (a timed mode's park effect
// discards it on its first run; a casual history's is replaced the next time that screen parks).
//
// Every rejection but one is reported with its reason (no honest path produces one); the one is a
// judged card with no calendar, refused quietly (see the header). Two layers:
//   • the SHAPE check names every field the invariant walk and the first render need before they can
//     even be asked — a date, the history arrays, each card's Override record (the Override button
//     reads it on the first paint), the grid, the stats and their times;
//   • then the state must satisfy EVERY ENGINE INVARIANT (engine/invariants — the ledgers, every
//     card's Override record). That walk runs inside a catch, so a card deep in the history that is
//     not one (the shape check does not walk every field of every entry, and should not have to)
//     lands here too rather than on the error card.
export function restoreParkedEngine(
  blob: unknown,
  useJulian: boolean,
  mode: string,
): GameState | null {
  const reject = (reason: string, extra?: { error?: unknown; violations?: string[] }): null => {
    captureError(extra?.error ?? new Error(`Unreadable parked engine: ${reason}`), {
      where: 'restore-parked-engine',
      mode,
      reason,
      ...(extra?.violations ? { violations: extra.violations } : {}),
    })
    return null
  }
  if (!isObj(blob)) return reject('not an object')
  const stats = blob.stats
  if (!isObj(blob.date)) return reject('no date')
  if (!Array.isArray(blob.stack) || !Array.isArray(blob.forwardStack))
    return reject('no history arrays')
  if (![...blob.stack, ...blob.forwardStack].every((e) => isObj(e) && isObj(e.meta)))
    return reject('a history entry is not a card')
  if (!isObj(blob.card)) return reject('no card record')
  if (!isObj(blob.persistBtns)) return reject('no grid')
  if (!isObj(stats) || !Array.isArray(stats.times)) return reject('no stats')
  if (holdsUnstampedCard(blob)) return null // quietly: a tab an older build last used (the header)
  try {
    const state = blob as unknown as GameState
    const violations = checkGameInvariants(state, useJulian)
    if (violations.length) return reject('breaks an engine invariant', { violations })
    return state
  } catch (error) {
    return reject('the invariant check threw', { error })
  }
}
