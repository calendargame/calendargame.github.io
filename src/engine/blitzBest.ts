// ─────────────────────────────────────────────────────────────────────────
// engine/blitzBest.ts — the shape of the Blitz Best records.
//
// Blitz keeps a per-config Best Score / Best Streak record (blitzBest, and suddenAmBest for Per Question
// with Allow Mistakes on) and a Best Score record for sudden death (suddenBest). A record holds each
// field's value plus the id of the round that set it — which is what the Same Round / Different Rounds
// tag compares and what the ★ is derived from (engine/roundId's isNewBest).
//
// A round's result is FILED, not folded: when a round ends, and after every post-round Override that
// moves it, its own score and best streak go to the record as that round's figures (modes/BlitzMode,
// through store/screenPool's fileRoundResult), and the record — store/syncRecords, the windows-in-sync
// door's merge of Best records — keeps every round's figures beside it. So a field is the best any
// standing round reached, held by the FIRST round to reach it (a round that only ties a field leaves
// it with the round that got there first), and an Override that drops the round that holds it hands
// it to the next best round — whoever played it, in whichever window. A round put back in play takes
// its result back whole until it ends again. A config no standing round has scored on has NO record
// (not a record of 0, which would make a preset that holds nothing look played-in).
//
// ★ EACH FIELD CARRIES ITS COMPANION (Round 26, Q10): the holder round's OTHER number — under Best
// Score that round's best streak (`scoreStreak`), under Best Streak that round's score
// (`streakScore`) — so the Best row can say whether one round set both, on a screen too narrow for
// the Same Round / Different Rounds tag. A companion travels with its field: whatever takes the field
// takes the companion, and a round's companion is always its figure as it NOW stands (an Override
// after the round ended can move a round's other number while the field it holds stands still).
//   • null = NOT RECORDED: a Best set before Round 26, or one an older build has rewritten (every
//     older write path builds a fresh record of the four older fields, so both companions go missing
//     together — missing, never wrong; tests/blitzBest.olderBuilds holds the real builds to that).
//     Read through `companion`, because a saved record from before this release has no key at all.
//   • NO VERSION BUMP and nothing migrated: a record without companions is simply one that has not
//     recorded them, and the older builds' empty-record checks look only at score and streak.
// ⚠ THE OWNER OF THIS SHAPE. store/progress re-exports it rather than declaring its own, so the two
// can never disagree about a field again.
// ─────────────────────────────────────────────────────────────────────────

export interface BlitzBest {
  score: number
  scoreStreak: number | null // the Best Score round's best streak (null = not recorded)
  scoreStreakOf?: number | null // the round that streak is of (companionOf)
  scoreRoundId: number | null
  streak: number
  streakScore: number | null // the Best Streak round's score (null = not recorded)
  streakScoreOf?: number | null // the round that score is of (companionOf)
  streakRoundId: number | null
}
// A companion as a saved record holds it: a number, or — for a record from before Round 26, or one an
// older build rewrote — nothing, which is "not recorded".
export const companion = (v: unknown): number | null => (typeof v === 'number' ? v : null)
// ★ A COMPANION IS ITS HOLDER'S, OR UNKNOWN (design v5, 4.1 - the review lane's (c)). This build writes,
// beside each companion, the id of the round it belongs to (`scoreStreakOf` beside `scoreStreak`, …). A
// companion is believed only when that id is the field's holder: v2.26.0 SPREADS a record when one of
// its rounds beats a field ({ ...cur, score, scoreRoundId }), and so keeps the OLD holder's companion -
// and its id - beside the new holder. Read as written, that is another round's number under this one's
// Best; read through here, it is unknown, and the screen shows a dash. A record with no such id (an
// older build's own fresh record) is believed as written.
/** The stored field naming whose companion `comp` is. */
export const companionHolderKey = (comp: string): string => `${comp}Of`
/** A stored record's companion `comp` of the field its `holder` holds - null when it is not recorded, or
 *  the id written beside it names another round. */
export function companionOf(rec: object, comp: string, holder: string): number | null {
  const r = rec as Readonly<Record<string, unknown>>
  const c = companion(r[comp])
  const of = r[companionHolderKey(comp)]
  return c === null || of === undefined || of === null || of === r[holder] ? c : null
}
export interface SuddenBest {
  score: number
  roundId: number | null
}
