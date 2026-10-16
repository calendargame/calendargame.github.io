import { activeDataId } from './amnesic.js'
import { useProgress, type ProgressValues, type StatsKey } from './progress.js'
import { writeSessionRound, discardSessionRound } from './sessionRound.js'
import type { Stats } from '../engine/gameReducer.js'

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
// ⚠ EVERY SCREEN WRITER GOES THROUGH HERE — the three casual stat mirrors, the Blitz and MoX Best
// reconciles and take-backs, and their parks. The raw setters and store/sessionRound's write and
// discard are referenced only by store/progress, this file, and the reset and crash paths that act
// for the app rather than for a screen (tests/screenPoolGuard).
// ⚠ BUILT TO BE EXTENDED, NOT REPLACED (design-q1-q2.md, Q2): windows that stay in sync add a second
// condition to the same door — a casual mirror's write carries the stats object it last read, and is
// refused when the store's slice has moved under it (another window's answer adopted in the gap) —
// and route the casual park through it. The pool check here stays the first condition of every write.

/** Is `dataId` the pool the app is reading right now? */
const live = (dataId: string): boolean => dataId === activeDataId()

/** The four Best maps, by name. */
export type RoundBestMap = 'blitzBest' | 'suddenBest' | 'suddenAmBest' | 'aoxBest'
export type RoundBests = Pick<ProgressValues, RoundBestMap>

// Each map's own setter, by map name.
type Update<M extends RoundBestMap> = (prev: RoundBests[M]) => RoundBests[M]
const SETTER: { [M in RoundBestMap]: (next: Update<M>) => void } = {
  blitzBest: (next) => useProgress.getState().setBlitzBest(next),
  suddenBest: (next) => useProgress.getState().setSuddenBest(next),
  suddenAmBest: (next) => useProgress.getState().setSuddenAmBest(next),
  aoxBest: (next) => useProgress.getState().setAoxBest(next),
}

/**
 * File a round's result into one Best map of the pool `dataId` — `next` builds the map from the one
 * the store holds, as the raw setter's updater does. A no-op unless `dataId` is live.
 */
export function fileRoundBest<M extends RoundBestMap>(
  dataId: string,
  map: M,
  next: Update<M>,
): void {
  if (live(dataId)) SETTER[map](next)
}

/**
 * The four Best maps as the pool `dataId` holds them — what a round rebuilds its record from — or
 * null when `dataId` is not live: no floor is ever read from a copy the screen was not drawn for.
 */
export function roundBests(dataId: string): RoundBests | null {
  if (!live(dataId)) return null
  const { blitzBest, suddenBest, suddenAmBest, aoxBest } = useProgress.getState()
  return { blitzBest, suddenBest, suddenAmBest, aoxBest }
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

/** Mirror a casual engine's stats into the pool `dataId` — a no-op unless it is live. */
export function saveModeStats(dataId: string, key: StatsKey, stats: Stats): void {
  if (live(dataId)) useProgress.getState().setModeStats(key, stats)
}
