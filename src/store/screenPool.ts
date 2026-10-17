import { create } from 'zustand'
import { activeDataId } from './amnesic.js'
import { useProgress, onProgressRebase, PROGRESS_DOOR, type StatsKey } from './progress.js'
import { roundOp, type BestMap } from './bestRecords.js'
import { writeSessionRound, discardSessionRound } from './sessionRound.js'
import { discardSessionHistory } from './sessionHistory.js'
import type { Stats } from '../engine/gameReducer.js'
import { noteUnaskedSwap } from '../lib/unaskedSwap.js'
import { captureError } from '../observability/sentry.js'

// store/screenPool.ts — THE ONE DOOR THROUGH WHICH A MODE SCREEN WRITES SAVED PROGRESS OR A PARKED
// ROUND, and it lets a screen write only to the copy of the data it was DRAWN for.
//
// ★ WHY (Round 26, F1 — a live defect in v2.29.0). A screen's writes are effects of a commit, and an
// effect runs with the values of the render that scheduled it. A Blitz round that ends on its CLOCK
// (a requestAnimationFrame callback — the one ending that is not a tap) commits in one task; until
// v2.29.x its Best reconcile and its park were passive effects, which React runs in a LATER task. A
// tap in between — the Amnesic pill, a preset switch — swaps the copy of the data under the screens
// (store/presetControl) and runs to completion first; the round's old effects then wrote with the old
// render's values into the NEW copy: a guest's score filed as a permanent Best, the last guest's
// round parked into the next guest session, preset A's result filed in preset B
// (tests/screenPool.gap.dom). Two layers close it, and this file is the first:
//   1. BY CONSTRUCTION, whatever the timing: every write here names the pool (`dataId` —
//      store/amnesic's activeDataId, "<preset>:saved|stats|session") the CALLING RENDER was made
//      under, and is refused unless that pool is still the live one. A preset switch, an Amnesic
//      change, and a preset delete all move activeDataId, so a write from a screen drawn for the
//      outgoing copy cannot land in the incoming one. A refused write is SILENT: it is the expected
//      outcome of a rare race, not an impossible state.
//   2. In the commit itself: the round screens' reconcile and park are LAYOUT effects (modes/
//      BlitzMode, modes/AoxMode say why), so an ended round is filed and parked in the commit it ends
//      in — no tap can land between. That is what keeps the round's own legitimate Best (layer 1
//      alone would refuse it) and what closes the swap that keeps the copy (Full Reset).
//
// ⚠ EVERY SCREEN WRITER GOES THROUGH HERE — the three casual stat mirrors, the Blitz and MoX round
// results (and their take-backs), and their parks. The raw setters and store/sessionRound's write and
// discard are referenced only by store/progress, this file, and the reset and crash paths that act
// for the app rather than for a screen (tests/screenPoolGuard).
// ★ THE SECOND CONDITION, FOR WINDOWS THAT STAY IN SYNC (design-q1-q2.md v4, 6.1 and Q6's R5): a
// casual mirror's write carries the stats object it last READ from the store (at its mount) or last
// WROTE — its `base` — and is refused when the store's slice has moved under it since: another
// window's answers merged in the gap between a commit and its effects (store/syncedDoc patches the
// slice and moves this engine's data epoch in the same turn, so the screen is about to be rebuilt on
// them). A stale mirror never writes its copy over them. The engine is rebased on the store's stats
// (rebaseEngine), and the refusal is reported once (tripwire `staleMirror`): with the epoch moved in
// the same turn as the slice, it should never be seen. The pool check stays the first condition of
// every write.
// ★ THE REBUILD UNIT IS THE ENGINE, THE DATA UNIT THE SILO (6.1, B V5): `useScreenEpoch` holds one
// number per casual engine. Classic's and Flash's screens are keyed on theirs (src/main.tsx), so a
// move remounts the screen on the saved stats; Deduction's three engines live in one screen, and a
// move rebuilds only that sub-type's engine in place (engine/useGameEngine's `epoch`, gameReducer's
// HYDRATE) — the other two keep their puzzles and clocks.

/** Is `dataId` the pool the app is reading right now? */
const live = (dataId: string): boolean => dataId === activeDataId()

/**
 * File a round's RESULT on its Best record: the round's own values for every field of `map`'s record (a
 * Blitz round's score and its best streak; a MoX run's mean and median - whether or not either beats the
 * record), or null for a round that holds nothing now (taken back whole: put back in play, or no longer
 * standing). It goes to the windows-in-sync door as an op on the record `setup` (store/progressDoor's
 * round; design-q1-q2.md v4, 4.1), which keeps every round's figures beside the record - so a take-back
 * of the round that holds a field lands on the true next value, whoever played it and in whichever
 * window. `filedBefore`: this round's result was filed before (an Override of an ended round, a resume,
 * an ending after a resume). Returns whether it was filed: not when `dataId` is not live (the screen is
 * about to be remounted on the copy that is), nor for a round a Reset has since removed - there is
 * nothing left of it to change.
 */
export function fileRoundResult(
  dataId: string,
  map: BestMap,
  setup: string,
  roundId: number,
  values: { score: number; streak?: number } | { avg: number; med: number } | null,
  filedBefore: boolean,
): boolean {
  if (!live(dataId) || PROGRESS_DOOR.roundGone(map, roundId)) return false
  PROGRESS_DOOR.round(map, setup, roundOp(map, roundId, values, filedBefore))
  return true
}

/**
 * Park an ended round under its bests copy (`bestsId` — store/amnesic's bestsIdOf; store/sessionRound
 * keys by it). A no-op unless the stats pool the screen was drawn for (`dataId`) is live.
 */
export function parkRound(
  dataId: string,
  bestsId: string,
  mode: 'blitz' | 'aox',
  snapshot: unknown,
): void {
  if (live(dataId)) writeSessionRound(bestsId, mode, snapshot)
}

/** Forget the round parked under `bestsId` — a no-op unless `dataId` is live. */
export function unparkRound(dataId: string, bestsId: string, mode: 'blitz' | 'aox'): void {
  if (live(dataId)) discardSessionRound(bestsId, mode)
}

/** Each casual engine's data epoch (★ above). */
export const useScreenEpoch = create<Record<StatsKey, number>>()(() => ({
  classic: 0,
  flash: 0,
  dedDay: 0,
  dedMonth: 0,
  dedYear: 0,
}))

/**
 * Rebuild the engine of silo `key` on the pool's saved stats as they now are — another window's
 * answers came in (store/syncedDoc), or a stale mirror was refused. Only that engine's park goes
 * first (a park describes the history about to be dropped), and it is a question replaced without
 * this window's input (lib/unaskedSwap).
 */
export function rebaseEngine(dataId: string, key: StatsKey): void {
  discardSessionHistory(dataId, key)
  useScreenEpoch.setState((s) => ({ ...s, [key]: s[key] + 1 }))
  noteUnaskedSwap()
}

// (another window's stats for a mode, merged in: that engine is rebuilt - store/progress asks here)
onProgressRebase((silo) => rebaseEngine(activeDataId(), silo as StatsKey))

const staleReported = new Set<StatsKey>()
/**
 * Mirror a casual engine's stats (`next`) into the pool `dataId`, over `base` — the stats object the
 * mirror last read or wrote (★ above). True when the store holds `next` afterwards; false, with
 * nothing written, when `dataId` is not live or the slice has moved under the mirror.
 */
export function saveModeStats(dataId: string, key: StatsKey, base: Stats, next: Stats): boolean {
  if (!live(dataId)) return false
  const now = useProgress.getState().stats[key]
  if (now === next) return true
  if (now !== base) {
    if (!staleReported.has(key)) {
      staleReported.add(key)
      captureError(
        new Error('Saved stats: a screen mirror was refused over stats that had moved'),
        {
          tripwire: 'staleMirror',
          key,
        },
      )
    }
    rebaseEngine(dataId, key)
    return false
  }
  useProgress.getState().setModeStats(key, next)
  return true
}
