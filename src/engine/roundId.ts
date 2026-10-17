// ─────────────────────────────────────────────────────────────────────────
// engine/roundId.ts — the id a Blitz round / MoX run is tagged with, and the ★ rule that reads it.
//
// ★★ WHY THE ID HAS TO BE UNIQUE FOR ALL TIME, NOT JUST FOR ONE SCREEN. A round's id is
// SAVED: every Best record carries the id of the round that set each of its fields (store/progress'
// BlitzBest.scoreRoundId / streakRoundId, SuddenBest.roundId, AoxBest.avgRoundId / medRoundId), and
// those records outlive the screen, the session and the app. Until this file the ids were a counter
// that restarted at 1 on every screen load, so the first round of today and the first round of last
// week were both "round 1" — and three things read that as the SAME round:
//   • the Same Round / Different Rounds tag, which compares the two ids inside one record, read
//     "Same Round" for a best score and a best streak set on different days;
//   • Blitz's old same-round rollback (`cur.scoreRoundId === roundId`), which let a new round 1
//     "roll back" a record an old round 1 had set — the lowering half of the Amnesic contamination
//     bug (round 23);
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

// ★ AND ABOVE EVERY ROUND THIS WINDOW HAS SEEN — THE HYBRID CLOCK (design-q1-q2.md v4, 2.3). Windows stay in
// sync (store/syncRecords): a Reset's bound is a round id, and every round begun after a window saw
// another round, or a Reset, must be numbered above it however the device clock moves. So `last` is
// raised by every round id the window reads (`roundClock.hi`, set by the records' merge) as well as by
// every id it draws; an id is the wall clock's, or one more than the highest seen, whichever is higher.
// A v2.26.0 counter, scoped to its load (store/syncRecords' scopedRoundId), is no clock's and never moves it.
let last = 0

/** A fresh round / run id — unique across screen loads, sessions and presets (see the header). */
export function newRoundId(): number {
  const id = Date.now() * 1024 + Math.floor(Math.random() * 1024)
  last = Math.max(id, last + 1)
  return last
}

/** This window's round clock, as the records' merge reads and raises it (store/syncRecords' RoundClock). */
export const roundClock = {
  /** The highest round id this window has drawn or seen. */
  get hi(): number {
    return last
  },
  set hi(id: number) {
    last = Math.max(last, id)
  },
  /** The id a round begun now would get (never consumed): what a Reset made now bounds. */
  peek: (): number => Math.max(Date.now() * 1024, last + 1),
}

// ★ THE RANGES A SAVED ROUND ID IS IN. The clock's (this file, and v2.27.3 onward: ms x 1024 plus ten
// random bits) lie between the two bounds below. Under COUNTER_ROUND_ID is a v2.26.0 COUNTER (from 1 per
// mount of its screen, the same in every load); at or above SCOPED_ROUND_ID is such a counter SCOPED to
// the load it came from, or a value saved with no holder at all, given one (store/syncRecords'
// scopedRoundId, store/bestRecords) - an id that names one round, and says nothing about when it was
// played except that it was before any clock's. No clock reaches SCOPED_ROUND_ID for a century (2^52 ms
// x 1024 is the year 2109).
/** An id below this is a v2.26.0 counter. */
export const COUNTER_ROUND_ID = 2 ** 40
/** A scoped id (a counter with the load it came from, or a holder-less value's) is at or above this. */
export const SCOPED_ROUND_ID = 2 ** 52
/** Is `id` a round id a Reset's bound and the round clock speak for (a clock's, not a scoped one)? */
export const clockRoundId = (id: number): boolean => id < SCOPED_ROUND_ID

/**
 * ★ THE "NEW BEST" MARKER, as ONE rule for both run modes: a best is marked ★ exactly
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
