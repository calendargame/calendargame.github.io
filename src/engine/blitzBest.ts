// ─────────────────────────────────────────────────────────────────────────
// engine/blitzBest.ts — pure Best-record reconciliation for Blitz (the component wrapper layer).
//
// Blitz keeps a per-config Best Score / Best Streak record, updated when a round ends AND whenever a
// post-round Override edits the just-ended round's score (the BlitzMode `timerDone` effect re-runs on
// S.good / S.best changes). The record holds ONE {score, streak} pair plus the id of the round that
// set each field — which is what the Same Round / Different Rounds tag compares and what the ★ is
// derived from (engine/roundId's isNewBest).
//
// ★★ THE RECORD IS REBUILT FROM THE PRE-ROUND RECORD ON EVERY CALL, the way MoX's
// reconcileAoxStanding has always worked. The caller passes `pre` = the record that stood BEFORE this
// round began (snapshotted at Begin, BlitzMode's prevRoundBestRef), and each field is simply:
//     this round's value, tagged with this round,   if it beats the pre-round value;
//     otherwise the pre-round value WITH ITS OWN HOLDER.
// No "is this the same round?" question is ever asked, because the answer is structural: only THIS
// round can have moved the record since `pre` was taken (the config — the Best key — is locked while
// a round exists). That one rule covers the new high, the Override that raises it, the Override that
// drops it back (never below an earlier round — the cross-round rollback fix), and a drop all the way back.
// ⚠ WHAT IT REPLACED, and why: the old fold took the CURRENT record plus a numeric floor and, on a
// drop, wrote `max(good, floor)` while KEEPING the round's id — so when the floor won, an earlier
// round's score came back credited to the round that had just lost it (a wrong Same Round tag, and,
// now that ★ is derived from the id, a wrong ★). It also asked `cur.scoreRoundId === roundId` to
// recognise its own round, which a round-id counter that restarted at 1 on every screen load answered
// "yes" for a stranger's record — the lowering half of round 23's Amnesic contamination bug.
//
// `undefined` in either direction means NO RECORD: a round begun on a config with none, that has not
// beaten 0 on either field, leaves none behind (rather than a record of 0 that says a round scored
// nothing) — so a round overridden back to 0 removes the record it had created, as if it never scored.
// Extracted so it can be fuzzed directly against an independent oracle (tests/engine/blitzBest: the
// record == the max any round reached, held by the FIRST round to reach it). Pure — no React, no app
// state; `pre` is never mutated.
//
// ★ EACH FIELD CARRIES ITS COMPANION (Round 26, Q10): the holder round's OTHER number — under Best
// Score that round's best streak (`scoreStreak`), under Best Streak that round's score
// (`streakScore`) — so the Best row can say whether one round set both, on a screen too narrow for
// the Same Round / Different Rounds tag. A companion travels with its field: whatever takes the field
// takes the companion, and whatever hands the field back hands back the companion it had.
//   • null = NOT RECORDED: a Best set before Round 26, or one an older build has rewritten (every
//     older write path builds a fresh record of the four older fields, so both companions go missing
//     together — missing, never wrong; tests/blitzBest.olderBuilds holds the real builds to that).
//     Read through `companion`, because a saved record from before this release has no key at all.
//   • ★ THE ONE PLACE A COMPANION CAN MOVE WHILE ITS FIELD STANDS STILL: a round that holds only one
//     field can have its OTHER number changed by an Override after it ended (flip a miss between two
//     short chains: its score rises, its best streak does not). The record's four older fields then
//     look exactly as before — so when two copies of a record tie on a field AND name the same
//     holder, they are the same round seen at two moments, and the LATER one (`b`) has the
//     companion as it now stands (betterBlitzBest). Without that clause a copy saved before the
//     Override would put the old companion back (store/amnesic's merge of two tabs' records).
//   • NO VERSION BUMP and nothing migrated: a record without companions is simply one that has not
//     recorded them, and the older builds' empty-record checks look only at score and streak.
// ⚠ THE OWNER OF THIS SHAPE. store/progress re-exports it rather than declaring its own, so the two
// can never disagree about a field again — every place that BUILDS a BlitzBest is in this file.
// ─────────────────────────────────────────────────────────────────────────

export interface BlitzBest {
  score: number
  scoreStreak: number | null // the Best Score round's best streak (null = not recorded)
  scoreRoundId: number | null
  streak: number
  streakScore: number | null // the Best Streak round's score (null = not recorded)
  streakRoundId: number | null
}
// A companion as a saved record holds it: a number, or — for a record from before Round 26, or one an
// older build rewrote — nothing, which is "not recorded".
export const companion = (v: unknown): number | null => (typeof v === 'number' ? v : null)
export interface SuddenBest {
  score: number
  roundId: number | null
}

// ★ WHICH OF TWO RECORDS IS THE BETTER — the one comparison, field by field: `b` takes a field from
// `a` only by STRICTLY beating it, and takes the holder and the companion with it; a field it merely
// ties stays with `a`, the one that got there first — companion included, EXCEPT when both name the
// same holder (the header's ★: the same round seen twice, `b` the later sighting, so `b`'s companion
// is the current one). A round ending is this comparison (below: the round's result against the
// record before it, where `a` never names the round, so the exception cannot arise), and so is
// anything else that has two records for one set-up and must keep the better — store/amnesic, when
// two tabs have each saved one (there `b` is this page's own record, the later one).
const sameHolder = (x: number | null | undefined, y: number | null | undefined) =>
  x != null && x === y
export function betterBlitzBest(a: BlitzBest, b: BlitzBest): BlitzBest {
  const scoreWins = b.score > a.score
  const streakWins = b.streak > a.streak
  const scoreSeen = scoreWins || (b.score === a.score && sameHolder(a.scoreRoundId, b.scoreRoundId))
  const streakSeen =
    streakWins || (b.streak === a.streak && sameHolder(a.streakRoundId, b.streakRoundId))
  return {
    score: scoreWins ? b.score : a.score,
    scoreStreak: companion(scoreSeen ? b.scoreStreak : a.scoreStreak),
    scoreRoundId: (scoreWins ? b.scoreRoundId : a.scoreRoundId) ?? null,
    streak: streakWins ? b.streak : a.streak,
    streakScore: companion(streakSeen ? b.streakScore : a.streakScore),
    streakRoundId: (streakWins ? b.streakRoundId : a.streakRoundId) ?? null,
  }
}
// …and for the sudden-death record, which is one field.
export const betterSuddenBest = (a: SuddenBest, b: SuddenBest): SuddenBest =>
  b.score > a.score ? b : a

const NO_RECORD: BlitzBest = {
  score: 0,
  scoreStreak: null,
  scoreRoundId: null,
  streak: 0,
  streakScore: null,
  streakRoundId: null,
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
  if (!pre && good <= 0 && engBest <= 0) return undefined
  return betterBlitzBest(pre ?? NO_RECORD, {
    score: good,
    scoreStreak: engBest,
    scoreRoundId: roundId,
    streak: engBest,
    streakScore: good,
    streakRoundId: roundId,
  })
}
// Per-question sudden-death Best record — score only; the same rebuild.
export function reconcileSuddenBest(
  pre: SuddenBest | undefined,
  good: number,
  roundId: number | null,
): SuddenBest | undefined {
  const round = { score: good, roundId }
  return pre ? betterSuddenBest(pre, round) : good > 0 ? round : undefined
}

// ── THE RECORD AS IT STANDS WITHOUT THIS ROUND — what every reconcile is rebuilt from ───────────────
// "Rebuild from the pre-round record" (above) rests on one claim: only THIS round can have moved
// the record since `pre` was taken. That is true of one screen in one tab, and it is false the
// moment the record has another writer — and it has two:
//   • ANOTHER TAB. A round ends here and is parked; the same preset is played in a second tab, which
//     saves a better Best; this tab is then reloaded. The saved record it loads is the other tab's —
//     and the restored round, rebuilding from the floor it parked with, wrote its own older result
//     straight over it.
//   • ANOTHER ROUND UNDER THE SAME RECORDS, while this one was parked (the Off and Stats Only values
//     of one preset share their Bests).
// So the floor is not the snapshot: it is the record AS IT STANDS (`cur`, read from the store at the
// moment of the write) with this round's own contribution taken back out. Field by field — a field
// this round holds (it carries this round's id, and ids never repeat: engine/roundId) goes back to
// what it was before the round (`pre`); every other field is whoever holds it now, which is the
// pre-round holder when nobody else has written, and the newcomer when somebody has.
// ★ WITH ONE WRITER THIS IS EXACTLY `pre` — the fields the round does not hold are the pre-round
// ones, untouched — so nothing changes for a round played and overridden in one tab; the fuzz in
// tests/engine/blitzBest holds that equality over random rounds. `undefined` when nothing is left
// (no record before the round, and nothing in the record that is not this round's).
// ⚠ What it cannot see is a write this tab's store never loaded: two tabs both open and both
// playing, neither reloaded, still save whole maps over each other (the store keeps no cross-tab
// merge). This closes the restore door; that one is the store's.
const mine = (holder: number | null, roundId: number | null): boolean =>
  roundId !== null && holder === roundId

export function blitzBestWithoutRound(
  pre: BlitzBest | undefined,
  cur: BlitzBest | undefined,
  roundId: number | null,
): BlitzBest | undefined {
  if (!cur) return undefined
  const scoreMine = mine(cur.scoreRoundId, roundId)
  const streakMine = mine(cur.streakRoundId, roundId)
  const rec: BlitzBest = {
    score: scoreMine ? (pre?.score ?? 0) : cur.score,
    scoreStreak: companion(scoreMine ? pre?.scoreStreak : cur.scoreStreak),
    scoreRoundId: scoreMine ? (pre?.scoreRoundId ?? null) : cur.scoreRoundId,
    streak: streakMine ? (pre?.streak ?? 0) : cur.streak,
    streakScore: companion(streakMine ? pre?.streakScore : cur.streakScore),
    streakRoundId: streakMine ? (pre?.streakRoundId ?? null) : cur.streakRoundId,
  }
  return rec.score === 0 && rec.streak === 0 ? undefined : rec
}

// The same for the sudden-death record, which is one field.
export function suddenBestWithoutRound(
  pre: SuddenBest | undefined,
  cur: SuddenBest | undefined,
  roundId: number | null,
): SuddenBest | undefined {
  if (!cur) return undefined
  return mine(cur.roundId, roundId) ? pre : cur
}
