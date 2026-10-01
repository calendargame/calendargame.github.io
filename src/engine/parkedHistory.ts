// ─────────────────────────────────────────────────────────────────────────
// engine/parkedHistory.ts — what a casual mode's PARKED HISTORY is, and what comes back from one.
//
// store/sessionHistory keeps a Classic / Flash / Deduction engine in sessionStorage for the browsing
// session and never looks inside it; this file is the other half — the text that is parked, and the
// state that is accepted on the way back. (The same split as store/sessionRound and the mode screens
// for the timed modes' parked rounds.) modes/modeHooks joins the two.
//
// ★ THE TIMES ARE NOT PARKED. They are already saved, in full, in the stats (every solve is kept) —
// tens of thousands of numbers for a long-time player — and the pool is exactly the saved pool, so
// the parked text leaves `stats.times` out and the restore puts the saved one back.
// The times ledger then checks, second by second, that the cards name the pool's tail in play order.
//
// ★ WHAT COMES BACK — NOTHING THAT CANNOT BE CHECKED. A parked history is a claim about the stats
// underneath it, and those stats live somewhere else (store/progress, localStorage — or the session
// copy for an Amnesic preset). So restoreParked accepts a history ONLY if it is exactly the state
// those stats support:
//   • its counts — played, good, streak, best, timesLost — equal the saved ones, and
//   • it comes through the ONE engine restore door (engine/parkedEngine's restoreParkedEngine) with
//     the saved TIMES in place: the shape check, and every engine invariant (engine/invariants — the
//     card ledger, the times ledger in play order, every per-card Override record).
// Anything else comes up fresh from the saved stats, exactly as a mount with nothing parked does. The
// counts can disagree for honest reasons — live and staging were both open in this tab, another tab
// moved a shared preset on — so that is checked FIRST and is not reported; an unreadable blob or an
// invariant break is, because no honest path makes one.
// ─────────────────────────────────────────────────────────────────────────
import { forgetOldestCards } from './gameReducer.js'
import type { GameState, Stats } from './gameReducer.js'
import { isObj, restoreParkedEngine } from './parkedEngine.js'
import { captureError } from '../observability/sentry.js'

/**
 * What a screen parks BESIDE its engine.
 *   `ui`     — the screen's own on/off facts about what it is showing (Flash: is the date shown;
 *              Deduction: its three puzzle filters). Every one is OFF on a fresh screen, which is what
 *              lets "does this park hold anything?" be asked without knowing any of their names.
 *   `config` — the date settings the engine's live question was drawn under, as the screen spells
 *              them. A restore under different settings regenerates an unanswered question, exactly
 *              as changing those settings on a mounted screen does (modes/modeHooks).
 */
export interface ParkedScreen {
  ui?: Record<string, boolean>
  config: string
}

/**
 * The parked text of one engine and its screen: the state with its `stats.times` left out (see the
 * header), the screen's fields beside it.
 */
export function parkedText(engine: GameState, screen: ParkedScreen): string {
  const { times, ...counts } = engine.stats
  return JSON.stringify({ engine: { ...engine, stats: counts }, ...screen })
}

/**
 * The parked text within `budget` characters, forgetting the engine's oldest cards as needed
 * (gameReducer's forgetOldestCards — every score, badge number and remaining Override stays exact) —
 * or null when even the cards no cut can reach (the browsed card, the ones ahead of it, the live one)
 * do not fit. Each pass measures the oldest cards until they cover the overshoot and forgets that
 * many; another pass only runs when the grown baselines' digits tipped the text back over.
 */
export function fittedParkedText(
  engine: GameState,
  screen: ParkedScreen,
  budget: number,
): string | null {
  let s = engine
  let text = parkedText(s, screen)
  while (text.length > budget) {
    if (s.stack.length === 0) return null
    const over = text.length - budget
    let k = 0
    for (let freed = 0; k < s.stack.length && freed < over; k++)
      freed += JSON.stringify(s.stack[k]).length + 1 // + its comma
    s = forgetOldestCards(s, k)
    text = parkedText(s, screen)
  }
  return text
}

/**
 * A parked history brought back: today's engine state, and the screen's own fields AS PARKED — the
 * engine has been through the restore door, these two have not (the slot may hold anything a build on
 * this origin wrote), so they are read with parkedFlag / compared as a whole, never trusted.
 */
export interface RestoredHistory {
  engine: GameState
  ui: unknown
  config: unknown
}

/** Is this on/off fact set in a parked `ui`? Nothing but a real `true` counts. */
export const parkedFlag = (ui: unknown, name: string): boolean => isObj(ui) && ui[name] === true

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
  if (!isObj(parked) || !isObj(blob) || !isObj(blob.stats)) {
    restoreParkedEngine(blob, useJulian, silo) // not a parked engine at all: the door says why
    return null
  }
  // The counts first, straight off the blob (a bare comparison is safe on anything): saved stats that
  // have moved on are an honest disagreement, and must not reach the door to be reported as a break.
  const s = blob.stats
  if (
    s.played !== stats.played ||
    s.good !== stats.good ||
    s.streak !== stats.streak ||
    s.best !== stats.best ||
    s.timesLost !== stats.timesLost
  )
    return null
  // The saved pool goes back in before the door, which holds the times ledger to it.
  const engine = restoreParkedEngine(
    { ...blob, stats: { ...blob.stats, times: stats.times } },
    useJulian,
    silo,
  )
  return engine && { engine, ui: parked.ui, config: parked.config }
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
