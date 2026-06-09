// ─────────────────────────────────────────────────────────────────────────
// engine/blitzBest.ts — pure Best-record reconciliation for Blitz (the component wrapper layer).
//
// Blitz keeps a per-config Best Score / Best Streak record, updated when a round ends AND whenever a
// post-round Override edits the just-ended round's score (the BlitzMode `timerDone` effect re-runs on
// S.good / S.best changes). The record holds ONE {score, streak} pair plus the round id that set each,
// so the reconcile can tell "this round is improving its own record" from "a different round".
//
// The subtle part is ROLLBACK: when an Override drops the score of the round that set the Best, the
// Best must fall — but only as far as the best round that still stands. Because the record was
// OVERWRITTEN when this round beat the previous best, that previous value would be lost; so the caller
// passes `fallback` = the Best that stood BEFORE this round began (snapshotted at Begin). The rollback
// restores max(thisRound, fallback) — never below an earlier round's real achievement. (Before the C2
// fix it restored just `thisRound`, dropping Best below an earlier round; AoX already snapshotted its
// prior best, Blitz did not.) Extracted from main.tsx so it can be fuzzed directly against an
// independent oracle (best == the max good any round actually reached). Pure — no React, no app state.
// ─────────────────────────────────────────────────────────────────────────

export interface BlitzBest {
  score: number
  streak: number
  scoreRoundId: number | null
  streakRoundId: number | null
}
export interface SuddenBest {
  score: number
  roundId: number | null
}

// Per-round (Blitz) Best record after this round reached `good` (with engine best-streak `engBest`),
// tagged `roundId`. `fallback` = the Best standing before this round (the rollback floor).
export function reconcileBlitzBest(
  cur: BlitzBest,
  good: number,
  engBest: number,
  roundId: number | null,
  fallback: { score: number; streak: number },
): BlitzBest {
  let next = { ...cur }
  if (good > cur.score) next = { ...next, score: good, scoreRoundId: roundId }
  else if (cur.scoreRoundId === roundId && good < cur.score)
    next = { ...next, score: Math.max(good, fallback.score) }
  if (engBest > cur.streak) next = { ...next, streak: engBest, streakRoundId: roundId }
  else if (cur.streakRoundId === roundId && engBest < cur.streak)
    next = { ...next, streak: Math.max(engBest, fallback.streak) }
  return next
}

// Per-question (sudden-death) Best record — score only; same new-high / same-round-rollback logic.
export function reconcileSuddenBest(
  cur: SuddenBest,
  good: number,
  roundId: number | null,
  fallback: number,
): SuddenBest {
  if (good > cur.score) return { score: good, roundId }
  if (cur.roundId === roundId && good < cur.score)
    return { ...cur, score: Math.max(good, fallback) }
  return cur
}
