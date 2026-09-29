// ─────────────────────────────────────────────────────────────────────────
// engine/parkedHistory.ts — what a casual mode's PARKED HISTORY is, and what comes back from one
// (round 23 Q11).
//
// store/sessionHistory keeps a Classic / Flash / Deduction engine in sessionStorage across a reload
// and never looks inside it; this file is the other half — the text that is parked, and the state that
// is accepted on the way back. (The same split as store/sessionRound and engine/engineMigration for
// the timed modes' parked rounds.) modes/modeHooks' useParkedHistory joins the two.
//
// ★ THE TIMES ARE NOT PARKED. They are already saved, in full, in the stats (every solve is kept since
// round 23 Q3) — tens of thousands of numbers for a long-time player — and the pool is exactly the
// saved pool, so the parked text leaves `stats.times` out and the restore puts the saved one back.
// The times ledger then checks, second by second, that the cards name the pool's tail in play order.
//
// ★ WHAT COMES BACK — NOTHING THAT CANNOT BE CHECKED. A parked history is a claim about the stats
// underneath it, and those stats live somewhere else (store/progress, localStorage — or the session
// copy for an Amnesic preset). So restoreParked takes the engine through the ONE engine restore door
// (engine/engineMigration's restoreParkedEngine: the shape check, the migration, the catch) and then
// accepts it ONLY if it is exactly the state those stats support:
//   • its counts — played, good, streak, best, timesLost — equal the saved ones, and
//   • it satisfies every engine invariant (engine/invariants — the card ledger, the times ledger in
//     play order, every per-card Override record) against the saved TIMES.
// Anything else comes up fresh from the saved stats, exactly as a mount did before Q11. The counts can
// disagree for honest reasons — the save refused the last write (store/storageHealth), live and
// staging were both open in this tab, another tab moved a shared preset on — so that is not reported;
// an unreadable blob or an invariant break is, because no honest path makes one.
// ─────────────────────────────────────────────────────────────────────────
import { forgetOldestCards } from './gameReducer.js'
import type { GameState, Stats } from './gameReducer.js'
import { restoreParkedEngine } from './engineMigration.js'
import { checkGameInvariants } from './invariants.js'
import { captureError } from '../observability/sentry.js'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * The parked text of one engine, plus the screen's own fields (`ui`) when it has any: the state with
 * its `stats.times` left out (see the header).
 */
export function parkedText(engine: GameState, ui?: unknown): string {
  const { times, ...counts } = engine.stats
  return JSON.stringify({
    engine: { ...engine, stats: counts },
    ...(ui === undefined ? {} : { ui }),
  })
}

/**
 * The parked text within `budget` characters, forgetting the engine's oldest cards as needed
 * (gameReducer's forgetOldestCards — every score, badge number and remaining Override stays exact) —
 * or null when even the cards no cut can reach (the browsed card, the ones ahead of it, the live one)
 * do not fit. Each pass measures the oldest cards until they cover the overshoot and forgets that
 * many; another pass only runs when the grown baselines' digits tipped the text back over.
 */
export function fittedParkedText(engine: GameState, ui: unknown, budget: number): string | null {
  let s = engine
  let text = parkedText(s, ui)
  while (text.length > budget) {
    if (s.stack.length === 0) return null
    const over = text.length - budget
    let k = 0
    for (let freed = 0; k < s.stack.length && freed < over; k++)
      freed += JSON.stringify(s.stack[k]).length + 1 // + its comma
    s = forgetOldestCards(s, k)
    text = parkedText(s, ui)
  }
  return text
}

/** A parked history brought back: today's engine state, and the screen's own fields as parked. */
export interface RestoredHistory {
  engine: GameState
  ui: unknown
}

/**
 * A parked history (already out of JSON) back to an engine state over the saved `stats` — or null,
 * which means "start from the saved stats as if nothing were parked". See the header for what it
 * checks and what it reports. `silo` labels any report.
 */
export function restoreParked(
  parked: unknown,
  stats: Stats,
  useJulian: boolean,
  silo: string,
): RestoredHistory | null {
  const blob = isObj(parked) ? parked.engine : undefined
  // The saved pool goes back in before the door, which checks the stats' shape like every other field.
  const engine = restoreParkedEngine(
    isObj(blob) && isObj(blob.stats)
      ? { ...blob, stats: { ...blob.stats, times: stats.times } }
      : blob,
    useJulian,
    silo,
  )
  if (!engine) return null
  const s = engine.stats
  if (
    s.played !== stats.played ||
    s.good !== stats.good ||
    s.streak !== stats.streak ||
    s.best !== stats.best ||
    s.timesLost !== stats.timesLost
  )
    return null
  const broken = checkGameInvariants(engine, useJulian)
  if (broken.length) {
    captureError(new Error('Parked history breaks an engine invariant'), {
      where: 'restore-parked-history',
      mode: silo,
      violations: broken,
    })
    return null
  }
  return { engine, ui: isObj(parked) ? parked.ui : undefined }
}

/**
 * The same, from the parked TEXT as sessionStorage holds it — null for no text, and null (reported)
 * for text that is not JSON at all.
 */
export function restoreParkedText(
  text: string | null,
  stats: Stats,
  useJulian: boolean,
  silo: string,
): RestoredHistory | null {
  if (text === null) return null
  let parked: unknown
  try {
    parked = JSON.parse(text)
  } catch (e) {
    captureError(e, { where: 'restore-parked-history', mode: silo, reason: 'not JSON' })
    return null
  }
  return restoreParked(parked, stats, useJulian, silo)
}
