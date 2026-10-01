// store/sessionHistory.ts — a casual mode's back/forward history, kept for the BROWSING SESSION.
//
// THE OWNER'S RULE (store/browsingSession): "only truly closing the app starts fresh." Classic, Flash
// and Deduction keep their lifetime STATS in store/progress, but the history behind them (the cards
// Back and Forward walk, each with its Override record) and the question waiting to be answered live
// only in the engine's memory — so anything that rebuilt the screen threw them away. This file keeps
// them for exactly the session's lifetime, across everything that rebuilds a screen without the
// player asking for a clean start:
//   • a RELOAD — a browser reload, the app's own update reload, the error card's Reload;
//   • a PRESET SWITCH — each preset's history is waiting when you switch back to it;
//   • an AMNESIC interlude — your own history, parked for the guest's visit, returns with your own
//     stats when the guest is done (and the guest's is thrown away with the guest's session).
// A real close clears it (the browser drops sessionStorage; nothing here schedules a wipe).
//
// THIS FILE IS THE STORAGE HALF, and it never looks inside what it stores — the same split as
// store/sessionRound. What a parked history IS (the engine without its saved times, cut to fit), and
// what is accepted on the way back (only through the one engine restore door, and only the exact
// state the saved stats support), is engine/parkedHistory's. The screens' wiring — when they park,
// and what the question on screen does when it comes back — is modes/modeHooks'.
//
// ★ WHEN IT IS WRITTEN — WHEN A SCREEN IS ABOUT TO GO AWAY, NOT ON EVERY MOVE. A history is thousands
// of cards long at the far end, and serialising it after every answer would put that cost on every
// answer. Nothing needs it until the screen goes, and a screen never goes unannounced:
//   • the PAGE going away or to the background — every reload fires `pagehide`, and a mobile browser
//     that later discards a backgrounded tab fired `visibilitychange` → hidden on the way out;
//   • the STATS COPY underneath the screens being swapped — a preset switch, an Amnesic toggle, the
//     active preset being deleted — which src/main.tsx sees in its registry subscription, while the
//     outgoing screens are still mounted and still hold the outgoing copy.
// Both call modes/modeHooks' parkCasualHistories, which parks every mounted casual screen under the
// stats copy it was MOUNTED on. ⚠ A screen does NOT park when it unmounts: an unmount cannot tell a
// preset switch from a Full Reset or a crash, and parking on either of those would bring back
// exactly what they exist to throw away.
// ★ WHEN IT IS RETIRED — BY WHATEVER CLEARS THE HISTORY IT DESCRIBES, at the moment it clears it, so
// a park can never bring cleared data back:
//   • Reset Stats / "Enable and Reset Stats" / Flash's Reset — the engine's own reset; the screen
//     discards its slot in the same breath (modes/modeHooks' useParkedHistory);
//   • Full Reset — discards the preset's histories, both copies, BEFORE its remount (src/main.tsx);
//   • a preset DELETE — store/presetControl's clearPresetStorage, after the registry write that
//     parks the outgoing screens, so the delete has the last word;
//   • an Amnesic toggle — the SESSION copy's histories, with that copy's stats, same ordering;
//   • a mode screen that CRASHES — src/main.tsx's error boundary hook, so a history that somehow
//     breaks its screen cannot come back after the Reload and break it again.
//
// ★ SIZE. sessionStorage has a fixed allowance (~5 MB, shared by the whole origin — live and staging
// both), and it also holds things that are NOT best-effort: an Amnesic preset's session stats above
// all, whose refused write puts up the storage-full notice. A history must never be the thing that
// crowds those out, so every history together is held to TOTAL_BUDGET characters, and any one to
// SLOT_BUDGET (so two long histories — say two Deduction sub-types — can both be kept):
//   • a history longer than its slot budget is parked with its OLDEST cards forgotten (engine/
//     parkedHistory's fittedParkedText — the scores, the badge numbers and every remaining card's
//     Override stay exact; Back just stops sooner). Measured: a weekday card is ~165 characters, so
//     that is still ~3,000 Classic or Flash cards; a Deduction puzzle carries its options, so Day and
//     Year keep ~2,000 and Month (the largest, ~520) ~950 — an hour or more of non-stop play each;
//   • if all of them together would pass the total budget, OTHER parked histories are dropped,
//     longest first, until the one being written fits. ★ THE SCREEN IN USE IS WRITTEN LAST
//     (parkCasualHistories orders the writes), so it is the one history that always survives; the
//     ones dropped are other modes', other sub-types' and other presets';
//   • a write the browser refuses anyway removes the slot, so an older parked copy can never come
//     back in its place. The history then simply starts over — never an error, and never the
//     storage-full notice (this is a convenience, not saved data).
//
// ⚠ THE KEY IS `cg-history-v1:<dataId>:<silo>` — one entry per (stats copy, silo), so parking one
// silo never re-serialises another's thousands of cards, and "forget this preset" is a prefix sweep.
// KEYED BY THE STATS COPY (store/amnesic's dataId, "<presetId>:saved" / "<presetId>:session") for the
// same reason store/sessionRound is: a history only ever comes back over the copy it was played on.
// No older build knows the prefix, so none of them reads it (live and staging share this origin); a
// later build that changes the parked shape must change the version in the prefix, and the restore
// door refuses any blob it cannot read anyway.
// ⚠ THE VALUE IS ONE MARK AND THEN THE TEXT. The mark is this file's own, the one thing it needs to
// know about a slot without opening it: does it hold PLAY (history, an answered question, a screen
// setting — anything the player would miss), or only the unanswered question a screen was waiting
// on? Every casual screen parks, played-in or not, because the waiting question has to come back
// too; but only the first kind makes a preset "not factory-fresh" (hasSessionHistory).
// ⚠ Every access is try/catch-wrapped: sessionStorage throws on the property access in locked-down
// browsing, where a history simply is not kept.
import type { StatsKey } from './progress.js'

const PREFIX = 'cg-history-v1:'
const HOLDS_PLAY = '1'
const QUESTION_ONLY = '0'
/** The most characters one parked history may take. */
export const SLOT_BUDGET = 500_000
/** The most characters every parked history together may take. */
export const TOTAL_BUDGET = 1_000_000

// The silos are exactly the casual modes' stats silos — one engine each (Deduction runs three).
export type HistorySilo = StatsKey

const slotKey = (dataId: string, silo: HistorySilo) => `${PREFIX}${dataId}:${silo}`

/** This (stats copy, silo)'s parked text, or null when nothing readable is parked. */
export function readSessionHistory(dataId: string, silo: HistorySilo): string | null {
  try {
    const value = window.sessionStorage.getItem(slotKey(dataId, silo))
    if (value === null) return null
    const mark = value[0]
    return mark === HOLDS_PLAY || mark === QUESTION_ONLY ? value.slice(1) : null
  } catch {
    return null
  }
}

// Every OTHER parked history, longest first dropped, until they and `incoming` characters fit the
// total budget. Both budgets count a history's TEXT (the mark in front of it is not part of it), so
// two histories at the slot budget are exactly the total budget.
function makeRoom(store: Storage, own: string, incoming: number): void {
  const others: [string, number][] = []
  let total = incoming
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k === null || k === own || !k.startsWith(PREFIX)) continue
    const n = Math.max(0, (store.getItem(k)?.length ?? 0) - 1)
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
 * fittedParkedText) — making room among the other parked histories first. `holdsPlay` says whether
 * the text is more than a waiting question (see the header). Never throws: a text the browser
 * refuses removes the slot instead.
 */
export function writeSessionHistory(
  dataId: string,
  silo: HistorySilo,
  text: string,
  holdsPlay: boolean,
): void {
  const key = slotKey(dataId, silo)
  try {
    const store = window.sessionStorage
    try {
      makeRoom(store, key, text.length)
      store.setItem(key, (holdsPlay ? HOLDS_PLAY : QUESTION_ONLY) + text)
    } catch {
      store.removeItem(key) // refused — and an older copy must not come back in its place
    }
  } catch {
    /* storage refused outright — nothing was ever parked */
  }
}

/** Forget this (stats copy, silo)'s parked history — its engine was reset, or it cannot be parked. */
export function discardSessionHistory(dataId: string, silo: HistorySilo): void {
  try {
    window.sessionStorage.removeItem(slotKey(dataId, silo))
  } catch {
    /* storage refused — nothing was ever written */
  }
}

// Every parked-history key that starts with `prefix` (the trailing `:` every caller's prefix ends in
// is load-bearing: without it preset 1 would claim preset 11's histories).
const keysUnder = (store: Storage, prefix: string): string[] => {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k !== null && k.startsWith(prefix)) keys.push(k)
  }
  return keys
}

const discardPrefixed = (prefix: string): void => {
  try {
    const store = window.sessionStorage
    for (const k of keysUnder(store, prefix)) store.removeItem(k)
  } catch {
    /* storage refused — nothing was ever written */
  }
}

/**
 * Forget every parked history of ONE stats copy — setPresetAmnesic for the session copy, and a
 * crashed mode screen for the copy it was showing.
 */
export const discardSessionHistoriesOf = (dataId: string): void =>
  discardPrefixed(`${PREFIX}${dataId}:`)

/** Forget every parked history of one preset, both copies — Full Reset and a preset delete. */
export const discardSessionHistories = (presetId: number): void =>
  discardPrefixed(`${PREFIX}${presetId}:`)

/**
 * Does this preset have PLAY parked on either copy — a history, an answered question, a screen
 * setting; anything beyond the unanswered question a screen was waiting on? store/presetControl's
 * isPresetFactory asks, for a preset that is not the one on screen: parked play comes back the next
 * time that copy's screens mount, so a preset holding some is not factory-fresh. (A preset the player
 * merely looked at has parked questions and nothing else, and still is.)
 */
export const hasSessionHistory = (presetId: number): boolean => {
  try {
    const store = window.sessionStorage
    return keysUnder(store, `${PREFIX}${presetId}:`).some(
      (k) => store.getItem(k)?.[0] === HOLDS_PLAY,
    )
  } catch {
    return false // storage refused — nothing was ever parked
  }
}

/**
 * Forget every parked history, all presets. The app never needs this — a full close clears the
 * session and the browser does that — but the test harness has no "close the browser" event, so
 * tests/setup/dom.js calls it before every test (the same reason it resets the parked rounds).
 */
export const discardAllSessionHistories = (): void => discardPrefixed(PREFIX)
