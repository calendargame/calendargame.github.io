// ─────────────────────────────────────────────────────────────────────────
// engine/blitzBest.ts — pure Best-record reconciliation for Blitz (the component wrapper layer).
//
// Blitz keeps a per-config Best Score / Best Streak record, updated when a round ends AND whenever a
// post-round Override edits the just-ended round's score (the BlitzMode `timerDone` effect re-runs on
// S.good / S.best changes). The record holds ONE {score, streak} pair plus the id of the round that
// set each field — which is what the Same Round / Different Rounds tag compares and what the ★ is
// derived from (engine/roundId's isNewBest).
//
// ★★ THE RECORD IS REBUILT FROM THE PRE-ROUND RECORD ON EVERY CALL (round 23 Q4), the way MoX's
// reconcileAoxStanding has always worked. The caller passes `pre` = the record that stood BEFORE this
// round began (snapshotted at Begin, BlitzMode's prevRoundBestRef), and each field is simply:
//     this round's value, tagged with this round,   if it beats the pre-round value;
//     otherwise the pre-round value WITH ITS OWN HOLDER.
// No "is this the same round?" question is ever asked, because the answer is structural: only THIS
// round can have moved the record since `pre` was taken (the config — the Best key — is locked while
// a round exists). That one rule covers the new high, the Override that raises it, the Override that
// drops it back (never below an earlier round — the C2 fix), and a drop all the way back.
// ⚠ WHAT IT REPLACED, and why: the old fold took the CURRENT record plus a numeric floor and, on a
// drop, wrote `max(good, floor)` while KEEPING the round's id — so when the floor won, an earlier
// round's score came back credited to the round that had just lost it (a wrong Same Round tag, and,
// now that ★ is derived from the id, a wrong ★). It also asked `cur.scoreRoundId === roundId` to
// recognise its own round, which a round-id counter that restarted at 1 on every screen load answered
// "yes" for a stranger's record — the lowering half of Q2's Amnesic bug.
//
// `undefined` in either direction means NO RECORD: a round begun on a config with none, that has not
// beaten 0 on either field, leaves none behind (rather than a record of 0 that says a round scored
// nothing) — so a round overridden back to 0 removes the record it had created, as if it never scored.
// Extracted so it can be fuzzed directly against an independent oracle (tests/engine/blitzBest: the
// record == the max any round reached, held by the FIRST round to reach it). Pure — no React, no app
// state; `pre` is never mutated.
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

// Per-round (Blitz) — and per-question + Allow Mistakes — Best record after this round reached `good`
// (with engine best-streak `engBest`), tagged `roundId`, rebuilt from `pre` (the record before the
// round). Strict improvement: a round that only TIES a field leaves it with the round that got there
// first.
export function reconcileBlitzBest(
  pre: BlitzBest | undefined,
  good: number,
  engBest: number,
  roundId: number | null,
): BlitzBest | undefined {
  const preScore = pre?.score ?? 0
  const preStreak = pre?.streak ?? 0
  const scoreWins = good > preScore
  const streakWins = engBest > preStreak
  if (!pre && !scoreWins && !streakWins) return undefined
  return {
    score: scoreWins ? good : preScore,
    scoreRoundId: scoreWins ? roundId : (pre?.scoreRoundId ?? null),
    streak: streakWins ? engBest : preStreak,
    streakRoundId: streakWins ? roundId : (pre?.streakRoundId ?? null),
  }
}

// Per-question sudden-death Best record — score only; the same rebuild.
export function reconcileSuddenBest(
  pre: SuddenBest | undefined,
  good: number,
  roundId: number | null,
): SuddenBest | undefined {
  if (good > (pre?.score ?? 0)) return { score: good, roundId }
  return pre
}
