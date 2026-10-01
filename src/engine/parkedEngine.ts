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
// ★ A PARKED BLOB IS UNTRUSTED, and the door's whole job is to say so. sessionStorage is per ORIGIN,
// and the live site and the staging build share one (calendargame.app/test_version/) — so a build
// this one has never heard of can have written the slot, and a reload keeps it. Unguarded, the first
// bad read threw inside the engine's lazy initializer at mount, and since the blob outlives the
// reload, every reload died the same way for the rest of the browsing session: a mode screen bricked
// until the tab was closed.
//
// ⚠ THERE IS NO MIGRATION HERE, AND THAT IS DELIBERATE. Both slots are keyed by a name only builds
// with TODAY'S engine shape have ever written (`cg-round-v2`, `cg-history-v1`); the older shapes
// lived under a key this build does not read. A later build that changes the shape changes the key,
// and anything else that turns up in a slot is refused below rather than guessed at.
// ─────────────────────────────────────────────────────────────────────────
import { checkGameInvariants } from './invariants.js'
import { captureError } from '../observability/sentry.js'
import type { GameState } from './gameReducer.js'

/** Is this a non-null object — the first question asked of anything read back out of storage. */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

// A parked blob in, today's engine state out, or null when the blob is not one. Null means "nothing
// is parked": the caller drops its WHOLE snapshot (its own fields ride on this engine, so a fresh
// engine under a restored "ended" screen would be a state no play reaches) and the mode comes up
// fresh — and the slot goes the way its store retires any other (a timed mode's mirror effect
// discards it on its first run; a casual history's is replaced the next time that screen parks).
//
// Two layers, and every rejection is reported with its reason (no honest path produces one):
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
  const state = blob as unknown as GameState
  try {
    const violations = checkGameInvariants(state, useJulian)
    if (violations.length) return reject('breaks an engine invariant', { violations })
  } catch (error) {
    return reject('the invariant check threw', { error })
  }
  return state
}
