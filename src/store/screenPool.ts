import { create } from 'zustand'
import { usePresets } from './presets.js'
import { useProgress, onProgressRebase, PROGRESS_DOOR, type StatsKey } from './progress.js'
import { roundOp, type BestMap } from './bestRecords.js'
import { writeSessionRound, discardSessionRound } from './sessionRound.js'
import { discardSessionHistory } from './sessionHistory.js'
import type { Stats } from '../engine/gameReducer.js'
import { noteUnaskedSwap, swapScreenOf } from '../lib/unaskedSwap.js'
import { captureError } from '../observability/sentry.js'
import { amnesicWindowOf } from './amnesicWindow.js'
import { isRecord } from './json.js'

// store/screenPool.ts — THE ONE DOOR THROUGH WHICH A MODE SCREEN WRITES SAVED PROGRESS OR A PARKED
// ROUND, and it lets a screen write only to the copy of the data it was DRAWN for.
//
// ★ WHY (Round 26, F1 — a live defect in v2.29.0). A screen's writes are effects of a commit, and an
// effect runs with the values of the render that scheduled it. A Blitz round that ends on its CLOCK
// (a requestAnimationFrame callback — the one ending that is not a tap) commits in one task; until
// v2.29.x its Best reconcile and its park were passive effects, which React runs in a LATER task. A
// tap in between — a preset switch — swaps the data under the screens (store/presetControl) and runs
// to completion first; the round's old effects then wrote with the old render's values into the NEW
// preset: preset A's result filed in preset B (tests/screenPool.gap.dom). Two layers close it, and this
// file is the first:
//   1. BY CONSTRUCTION, whatever the timing: every write here names the pool (`presetId` - the preset
//      the CALLING RENDER was made under) and is refused unless that preset is still the live one. A
//      preset switch and a preset delete both move it, so a write from a screen drawn for the outgoing
//      preset cannot land in the incoming one. A refused write is SILENT: it is the expected outcome of
//      a rare race, not an impossible state.
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
// number per casual engine, and a move rebuilds that engine IN PLACE on the saved stats
// (engine/useGameEngine's `epoch`, gameReducer's HYDRATE) — Deduction's other two sub-types keep
// their puzzles and clocks — and the screen drops what belonged to the question that went
// (modes/modeHooks' useRebuiltEffect). NEVER A REMOUNT: a remount took with it everything else the
// screen held — a "Reset Stats?" question the player had open, the keyboard's place — for a change
// to nothing but the engine (design 14.4 (12); the browser lane's windowSyncPins pins it).

/** Is `presetId` the pool the app is reading right now? */
const live = (presetId: number): boolean => presetId === usePresets.getState().activeId

/**
 * What a round screen keeps of its round's filings (and parks with it): the result as last filed (`text`,
 * its JSON) and the Amnesic window the round was FIRST filed in (`e`; null: none - its preset was on Off).
 * The window is what tells a later change of the round (an Override) from a correction of a round from
 * before the window - which the window's anchor takes too, so Amnesic's forget keeps it (store/syncRecords'
 * `re`; design-amnesic-close.md 1).
 */
export type Filed = { text: string; e: string | null }
/** Is `v` a round's filings as a screen parks them (null: never filed)? */
export const isFiled = (v: unknown): v is Filed | null =>
  v === null ||
  (isRecord(v) && typeof v.text === 'string' && (v.e === null || typeof v.e === 'string'))

/**
 * File a round's RESULT on its Best record: the round's own values for every field of `map`'s record (a
 * Blitz round's score and its best streak; a MoX run's mean and median - whether or not either beats the
 * record), or null for a round that holds nothing now (taken back whole: put back in play, or no longer
 * standing). It goes to the windows-in-sync door as an op on the record `setup` (store/progressDoor's
 * round; design-q1-q2.md v4, 4.1), which keeps every round's figures beside the record - so a take-back
 * of the round that holds a field lands on the true next value, whoever played it and in whichever
 * window. `filed`: what the screen kept of this round's earlier filings (null: none - this is its first;
 * otherwise an Override of an ended round, a resume, an ending after a resume). Returns what the screen
 * keeps now, or null when nothing was filed: `presetId` is not live (the screen is about to be remounted
 * on the preset that is), or a Reset has since removed the round - there is nothing left of it to change.
 */
export function fileRoundResult(
  presetId: number,
  map: BestMap,
  setup: string,
  roundId: number,
  values: { score: number; streak?: number } | { avg: number; med: number } | null,
  filed: Filed | null,
): Filed | null {
  if (!live(presetId) || PROGRESS_DOOR.roundGone(map, roundId)) return null
  const op = roundOp(map, roundId, values, filed !== null)
  PROGRESS_DOOR.round(map, setup, filed ? { ...op, re: filed.e } : op)
  return { text: JSON.stringify(values), e: filed ? filed.e : amnesicWindowOf(presetId) }
}

/** Park an ended round under its preset (store/sessionRound) — a no-op unless `presetId` is live. */
export function parkRound(presetId: number, mode: 'blitz' | 'aox', snapshot: unknown): void {
  if (live(presetId)) writeSessionRound(presetId, mode, snapshot)
}

/** Forget the round parked under `presetId` — a no-op unless it is live. */
export function unparkRound(presetId: number, mode: 'blitz' | 'aox'): void {
  if (live(presetId)) discardSessionRound(presetId, mode)
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
export function rebaseEngine(presetId: number, key: StatsKey): void {
  discardSessionHistory(presetId, key)
  useScreenEpoch.setState((s) => ({ ...s, [key]: s[key] + 1 }))
  noteUnaskedSwap(swapScreenOf(key))
}

// (another window's stats for a mode, merged in: that engine is rebuilt - store/progress asks here)
onProgressRebase((silo) => rebaseEngine(usePresets.getState().activeId, silo as StatsKey))

const staleReported = new Set<StatsKey>()
/**
 * Mirror a casual engine's stats (`next`) into the pool `presetId`, over `base` — the stats object the
 * mirror last read or wrote (★ above). True when the store holds `next` afterwards; false, with
 * nothing written, when `presetId` is not live or the slice has moved under the mirror. `at`: the
 * engine's stats as they stood after an earlier card (engine/gameReducer's statsAtCard), for an
 * Override of a card from before an Amnesic window (store/progressDoor's correcting).
 */
export function saveModeStats(
  presetId: number,
  key: StatsKey,
  base: Stats,
  next: Stats,
  at: (played: number) => Stats | null,
): boolean {
  if (!live(presetId)) return false
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
    rebaseEngine(presetId, key)
    return false
  }
  PROGRESS_DOOR.correcting(key, at, () => useProgress.getState().setModeStats(key, next))
  return true
}
