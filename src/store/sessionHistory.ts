// store/sessionHistory.ts — a casual mode's back/forward history, kept across a RELOAD (round 23 Q11).
//
// THE OWNER'S RULE (store/browsingSession): "only truly closing the app starts fresh." A reload —
// pull-to-refresh, the app's own update reload, the error card's Reload — is the same browsing
// session. Classic, Flash and Deduction keep their lifetime STATS in store/progress, but the history
// behind them (the cards Back and Forward walk, each with its Override record) lived only in the
// engine's memory, so a reload threw it away. This file keeps it for exactly the session's lifetime.
//
// THIS FILE IS THE STORAGE HALF, and it never looks inside what it stores — the same split as
// store/sessionRound. What a parked history IS (the engine without its saved times, cut to fit), and
// what is accepted on the way back (only through the one engine restore door, and only the exact
// state the saved stats support), is engine/parkedHistory's. The screens' wiring is modes/modeHooks'
// useParkedHistory.
//
// ★ WHEN IT IS WRITTEN — WHEN THE PAGE IS HIDDEN, NOT ON EVERY MOVE. A history is thousands of cards
// long at the far end, and serialising it after every answer would put that cost on every answer.
// Nothing needs it until the page goes away, and a page never goes away unannounced while it is
// usable: every reload fires `pagehide`, and a mobile browser that later discards a backgrounded tab
// fired `visibilitychange` → hidden when it went to the background. So each casual screen parks its
// engine on those two events and at no other time.
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
// ★ SIZE. sessionStorage has a fixed allowance (~5 MB, shared by the whole origin — live and staging
// both), and it also holds things that are NOT best-effort: an Amnesic preset's session stats above
// all, whose refused write puts up the storage-full notice. A history must never be the thing that
// crowds those out, so every history together is held to TOTAL_BUDGET characters, and any one to
// SLOT_BUDGET (so two long histories — say two Deduction sub-types — can both be kept):
//   • a history longer than its slot budget is parked with its OLDEST cards forgotten (engine/
//     parkedHistory's fittedParkedText — the scores, the badge numbers and every remaining card's
//     Override stay exact; Back just stops sooner). At ~140 characters a card that is still ~3,500
//     Classic cards, or roughly two hours of non-stop play;
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
import type { StatsKey } from './progress.js'

const PREFIX = 'cg-history-v1:'
/** The most characters one parked history may take. */
export const SLOT_BUDGET = 500_000
/** The most characters every parked history together may take. */
export const TOTAL_BUDGET = 1_000_000

// The silos are exactly the casual modes' stats silos — one engine each (Deduction runs three).
export type HistorySilo = StatsKey

const slotKey = (dataId: string, silo: HistorySilo) => `${PREFIX}${dataId}:${silo}`

/** This (stats copy, silo)'s parked text, or null when nothing is parked. */
export function readSessionHistory(dataId: string, silo: HistorySilo): string | null {
  try {
    return window.sessionStorage.getItem(slotKey(dataId, silo))
  } catch {
    return null
  }
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
 * Park this (stats copy, silo)'s text — already within SLOT_BUDGET (engine/parkedHistory's
 * fittedParkedText) — making room among the other parked histories first. Never throws: a text the
 * browser refuses removes the slot instead.
 */
export function writeSessionHistory(dataId: string, silo: HistorySilo, text: string): void {
  const key = slotKey(dataId, silo)
  try {
    const store = window.sessionStorage
    try {
      makeRoom(store, key, text.length)
      store.setItem(key, text)
    } catch {
      store.removeItem(key) // refused — and an older copy must not come back in its place
    }
  } catch {
    /* storage refused outright — nothing was ever parked */
  }
}

/** Forget this (stats copy, silo)'s parked history — its screen unmounted, or has nothing to keep. */
export function discardSessionHistory(dataId: string, silo: HistorySilo): void {
  try {
    window.sessionStorage.removeItem(slotKey(dataId, silo))
  } catch {
    /* storage refused — nothing was ever written */
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

/** Forget every parked history of ONE stats copy — setPresetAmnesic, for the session copy. */
export const discardSessionHistoriesOf = (dataId: string): void =>
  discardPrefixed(`${PREFIX}${dataId}:`)

/** Forget every parked history of one preset, both copies — Full Reset and a preset delete. */
export const discardSessionHistories = (presetId: number): void =>
  discardPrefixed(`${PREFIX}${presetId}:`)

/**
 * Does this preset have a parked history on either copy? store/presetControl's isPresetFactory asks,
 * for a preset that is not the one on screen: a parked history is play that comes back the next time
 * that copy's screens mount, so a preset holding one is not factory-fresh.
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
