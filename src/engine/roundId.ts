// ─────────────────────────────────────────────────────────────────────────
// engine/roundId.ts — the id a Blitz round / MoX run is tagged with, and the ★ rule that reads it.
//
// ★★ WHY THE ID HAS TO BE UNIQUE FOR ALL TIME, NOT JUST FOR ONE SCREEN (round 23 Q4). A round's id is
// SAVED: every Best record carries the id of the round that set each of its fields (store/progress'
// BlitzBest.scoreRoundId / streakRoundId, SuddenBest.roundId, AoxBest.avgRoundId / medRoundId), and
// those records outlive the screen, the session and the app. Until this file the ids were a counter
// that restarted at 1 on every screen load, so the first round of today and the first round of last
// week were both "round 1" — and three things read that as the SAME round:
//   • the Same Round / Different Rounds tag, which compares the two ids inside one record, read
//     "Same Round" for a best score and a best streak set on different days;
//   • Blitz's old same-round rollback (`cur.scoreRoundId === roundId`), which let a new round 1
//     "roll back" a record an old round 1 had set — the lowering half of the Amnesic contamination
//     bug (Q2);
//   • and the ★, which is now DERIVED from exactly this comparison (isNewBest below), so a colliding
//     id would light a ★ on a record the round on screen never touched.
// So the id is drawn from the wall clock (milliseconds × 1024) plus ten random bits, and never goes
// backwards within a page load. Collisions would need two rounds begun in the same millisecond AND
// the same ten random bits — or a clock set back onto the exact millisecond of an earlier round and
// the same bits — which no human play reaches. The values are ~1.8e15 today, far inside
// Number.MAX_SAFE_INTEGER (~9.0e15, reached around the year 2248), and far above every id the old
// counter ever saved (small integers), so a record saved before this change can never be mistaken
// for one set by a round begun after it.
// ⚠ Records saved BEFORE this change keep their old small ids, and those cannot be repaired: nothing
// recorded which day an old "round 1" was played. The only visible trace is that an old record's
// Same Round tag may read "Same Round" for two rounds that were not the same; it corrects itself the
// first time a new round sets either field.
// ─────────────────────────────────────────────────────────────────────────

let last = 0

/** A fresh round / run id — unique across screen loads, sessions and presets (see the header). */
export function newRoundId(): number {
  const id = Date.now() * 1024 + Math.floor(Math.random() * 1024)
  last = Math.max(id, last + 1)
  return last
}

/**
 * ★ THE "NEW BEST" MARKER, as ONE rule for both run modes (round 23 Q4): a best is marked ★ exactly
 * when the round / run ON SCREEN set it — its saved id is the on-screen one. Nothing is stored for
 * the ★ itself, so it can never disagree with the record beside it: an Override that lowers the
 * record back to an earlier round's value takes the earlier round's id with it and the ★ goes out;
 * a round restored after a preset switch or a reload still carries its id and keeps its ★; a Reset
 * clears the on-screen id and every ★ with it.
 */
export const isNewBest = (
  recordId: number | null | undefined,
  onScreenId: number | null,
): boolean => onScreenId !== null && recordId === onScreenId
