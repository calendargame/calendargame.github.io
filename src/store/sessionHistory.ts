// store/sessionHistory.ts — a casual mode's back/forward history, kept across a RELOAD (round 23 Q11).
//
// THE OWNER'S RULE (store/browsingSession): "only truly closing the app starts fresh." A reload —
// pull-to-refresh, the app's own update reload, the error card's Reload — is the same browsing
// session. Classic, Flash and Deduction keep their lifetime STATS in store/progress, but the history
// behind them (the cards Back and Forward walk, each with its Override record) lived only in the
// engine's memory, so a reload threw it away. This file keeps it for exactly the session's lifetime.
//
// ★ WHEN IT IS WRITTEN — WHEN THE PAGE IS HIDDEN, NOT ON EVERY MOVE. A history is thousands of cards
// long at the far end, and serialising it after every answer would put that cost on every answer.
// Nothing needs it until the page goes away, and a page never goes away unannounced while it is
// usable: every reload fires `pagehide`, and a mobile browser that later discards a backgrounded tab
// fired `visibilitychange` → hidden when it went to the background. So each casual screen parks its
// engine on those two events (modes/modeHooks' useParkedHistory) and at no other time.
// ★ WHEN IT IS RETIRED — WHEN THE SCREEN THAT WROTE IT UNMOUNTS. A reload never unmounts anything (the
// page just stops), so a parked history outlives the reload it was written for; but every other way a
// screen goes — a preset switch, an Amnesic toggle, Full Reset, a crash onto the error card — is a
// real unmount, and the screen's cleanup discards its slot. That is what keeps this "a reload keeps
// it" and not also "a preset switch keeps it": a preset switch starts the casual history over, as it
// always has. (It also means a history that somehow crashes its screen cannot come back and crash it
// again: the crash unmounted the screen, and the unmount threw the history away.) Full Reset remounts
// the SAME stats copy, whose new screen reads its slot in the render before the old one's cleanup
// runs — so Full Reset discards the preset's histories itself, first (src/main.tsx's fullReset).
//
// ★ WHAT IT TRUSTS ON THE WAY BACK — NOTHING IT CANNOT CHECK. A parked history is a claim about the
// stats underneath it, and the stats live somewhere else (store/progress, localStorage — or the
// session copy for an Amnesic preset). So the restore (restoreParked) takes the engine through the
// ONE engine restore door (engine/engineMigration's restoreParkedEngine: the shape check, the
// migration, the catch) and then accepts it ONLY if it is exactly the state those stats support:
//   • its counts — played, good, streak, best, timesLost — equal the saved ones, and
//   • it satisfies every engine invariant (engine/invariants — the card ledger, the times ledger in
//     play order, every per-card Override record) against the saved TIMES.
// Anything else comes up fresh from the saved stats, exactly as before this file existed. The stats
// can disagree for honest reasons — the save refused the last write (store/storageHealth), live and
// staging were both open in this tab, another tab moved a shared preset — so a disagreement is not
// reported; an invariant break or an unreadable blob is, because no honest path makes one.
//
// ★ THE TIMES ARE NOT PARKED. They are already saved, in full, in the stats (every solve is kept since
// round 23 Q3) — tens of thousands of numbers for a long-time player — and the pool is exactly the
// saved pool, so the parked copy leaves `stats.times` out and the restore puts the saved one back.
// The times ledger then checks, second by second, that the cards name the pool's tail in play order.
//
// ★ SIZE. sessionStorage has a fixed allowance (~5 MB, shared by the whole origin — live and staging
// both), and it also holds things that are NOT best-effort: an Amnesic preset's session stats above
// all, whose refused write puts up the storage-full notice. A history must never be the thing that
// crowds those out, so every history together is held to TOTAL_BUDGET characters, and any one to
// SLOT_BUDGET (so two long histories — say two Deduction sub-types — can both be kept):
//   • a history longer than its slot budget is parked with its OLDEST cards forgotten
//     (engine/gameReducer's forgetOldestCards — the scores, the badge numbers and every remaining
//     card's Override stay exact; Back just stops sooner). At ~140 characters a card that is still
//     ~3,500 Classic cards, or roughly two hours of non-stop play;
//   • if all of them together would pass the total budget, the OTHER screens' parked histories are
//     dropped, longest first, until this one fits — the screen being parked is the one in use;
//   • a write the browser refuses anyway removes the slot, so an older parked copy can never come
//     back in its place. The history then simply starts over on the reload — the pre-Q11 behaviour,
//     never an error, and never the storage-full notice (this is a convenience, not saved data).
//
// ⚠ THE KEY IS `cg-history-v1:<dataId>:<silo>` — one entry per (stats copy, silo), so parking one
// silo never re-serialises another's thousands of cards, and "forget this preset" is a prefix sweep.
// KEYED BY THE STATS COPY (store/amnesic's dataId, "<presetId>:saved" / "<presetId>:session") for the
// same reason store/sessionRound is: a history only ever comes back over the copy it was played on.
// No older build knows the prefix, so none of them reads it (live and staging share this origin); a
// later build that changes the parked shape must change the version in the prefix, and the restore
// door refuses any blob it cannot read anyway.
// ⚠ Every access is try/catch-wrapped: sessionStorage throws on the property access in locked-down
// browsing, where a history simply is not kept.
import { forgetOldestCards } from '../engine/gameReducer.js'
import type { GameState, Stats } from '../engine/gameReducer.js'
import { restoreParkedEngine } from '../engine/engineMigration.js'
import { checkGameInvariants } from '../engine/invariants.js'
import type { StatsKey } from './progress.js'
import { captureError } from '../observability/sentry.js'

const PREFIX = 'cg-history-v1:'
/** The most characters one parked history may take. Exported for tests. */
export const SLOT_BUDGET = 500_000
/** The most characters every parked history together may take. Exported for tests. */
export const TOTAL_BUDGET = 1_000_000

// The silos are exactly the casual modes' stats silos — one engine each (Deduction runs three).
export type HistorySilo = StatsKey

const slotKey = (dataId: string, silo: HistorySilo) => `${PREFIX}${dataId}:${silo}`

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * The parked text of one engine (plus the screen's own fields, `ui`, if it has any): the state with
 * its `stats.times` left out (see the header). Exported so the reload fuzz parks exactly what the app
 * parks.
 */
export function parkedText(engine: GameState, ui?: unknown): string {
  const { times, ...counts } = engine.stats
  return JSON.stringify({
    engine: { ...engine, stats: counts },
    ...(ui === undefined ? {} : { ui }),
  })
}

/** A parked history brought back: today's engine state, and the screen's own fields as parked. */
export interface RestoredHistory {
  engine: GameState
  ui: unknown
}

/**
 * A parked history (already out of JSON) back to an engine state over the saved `stats` — or null,
 * which means "start from the saved stats as if nothing were parked". See the header for what it
 * checks and what it reports. Exported so the reload fuzz restores exactly as the app restores.
 */
export function restoreParked(
  parked: unknown,
  stats: Stats,
  useJulian: boolean,
  silo: HistorySilo,
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
 * This (stats copy, silo)'s parked history, restored over the saved `stats` — or null when nothing is
 * parked or what is parked cannot stand (see the header). Read once, at the screen's mount.
 */
export function restoreSessionHistory(
  dataId: string,
  silo: HistorySilo,
  stats: Stats,
  useJulian: boolean,
): RestoredHistory | null {
  let text: string | null
  try {
    text = window.sessionStorage.getItem(slotKey(dataId, silo))
  } catch {
    return null
  }
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

// The parked text of `engine` within `budget` characters, forgetting its oldest cards as needed — or
// null when even the cards the cut cannot reach (the browsed card, the ones ahead of it, the live
// one) do not fit. Each pass measures the oldest cards until they cover the overshoot and forgets that
// many; a second pass only runs when the new baselines' digits tipped the text back over.
function fitted(engine: GameState, ui: unknown, budget: number): string | null {
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

// Every OTHER parked history, longest first dropped, until they and `incoming` characters fit the
// total budget.
function makeRoom(store: Storage, own: string, incoming: number): void {
  const others: [string, number][] = []
  let total = incoming
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k === null || k === own || !k.startsWith(PREFIX)) continue
    const n = store.getItem(k)?.length ?? 0
    others.push([k, n])
    total += n
  }
  others.sort((a, b) => b[1] - a[1])
  for (const [k, n] of others) {
    if (total <= TOTAL_BUDGET) return
    store.removeItem(k)
    total -= n
  }
}

/**
 * Park this (stats copy, silo)'s engine — and the screen's own fields, if it has any — for the reload
 * that may follow. Called by modes/modeHooks' useParkedHistory when the page is hidden. Within the
 * budgets above, and never throws: a history that cannot be kept is removed instead.
 */
export function parkSessionHistory(
  dataId: string,
  silo: HistorySilo,
  engine: GameState,
  ui?: unknown,
): void {
  const key = slotKey(dataId, silo)
  try {
    const store = window.sessionStorage
    try {
      const text = fitted(engine, ui, SLOT_BUDGET)
      if (text === null) {
        store.removeItem(key)
        return
      }
      makeRoom(store, key, text.length)
      store.setItem(key, text)
    } catch {
      store.removeItem(key) // refused — and an older copy must not come back in its place
    }
  } catch {
    /* storage refused outright — nothing was ever parked */
  }
}

// Remove every parked history whose key starts with `prefix` (the trailing `:` every caller's prefix
// ends in is load-bearing: without it preset 1 would claim preset 11's histories).
const discardPrefixed = (prefix: string): void => {
  try {
    const store = window.sessionStorage
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k !== null && k.startsWith(prefix)) doomed.push(k)
    }
    for (const k of doomed) store.removeItem(k)
  } catch {
    /* storage refused — nothing was ever written */
  }
}

/** Forget this (stats copy, silo)'s parked history — its screen unmounted, or its engine is fresh. */
export const discardSessionHistory = (dataId: string, silo: HistorySilo): void => {
  try {
    window.sessionStorage.removeItem(slotKey(dataId, silo))
  } catch {
    /* storage refused — nothing was ever written */
  }
}

/** Forget every parked history of ONE stats copy — setPresetAmnesic, for the session copy. */
export const discardSessionHistoriesOf = (dataId: string): void =>
  discardPrefixed(`${PREFIX}${dataId}:`)

/** Forget every parked history of one preset, both copies — Full Reset and a preset delete. */
export const discardSessionHistories = (presetId: number): void =>
  discardPrefixed(`${PREFIX}${presetId}:`)

/**
 * Does this preset have a parked history on either copy? store/presetControl's isPresetFactory asks:
 * a parked history is play the player can still see after the next reload, so a preset holding one
 * is not factory-fresh.
 */
export const hasSessionHistory = (presetId: number): boolean => {
  try {
    const store = window.sessionStorage
    for (let i = 0; i < store.length; i++)
      if (store.key(i)?.startsWith(`${PREFIX}${presetId}:`)) return true
  } catch {
    /* storage refused — nothing was ever parked */
  }
  return false
}

/**
 * Forget every parked history, all presets. The app never needs this — a full close clears the
 * session and the browser does that — but the test harness has no "close the browser" event, so
 * tests/setup/dom.js calls it before every test (the same reason it resets the parked rounds).
 */
export const discardAllSessionHistories = (): void => discardPrefixed(PREFIX)
