// ─────────────────────────────────────────────────────────────────────────
// engine/bestPool.ts — THE BEST SHOWN FOR A SET-UP: the one door every MoX and Blitz Best is read
// through for display.
//
// ★ WHY THE SHOWN BEST IS NOT SIMPLY `map[key]`. Since Round 26 a Best key is built from the date
// settings IN EFFECT (lib/dateConfig). Records saved before that were filed under the settings AS
// STORED, so one set-up's rounds can sit under several keys — a Julian Chance of 50% that did nothing
// with Julian off, say, beside the same set-up's Random. Most of those records were played on exactly
// the dates the in-effect set-up draws (lib/dateConfig's inEffectBestKey says which, from what the
// generator did), so they are that set-up's Bests and keep showing. The Best shown for in-effect key K
// is therefore the best over every stored record whose key maps to K on the same dates — K's own
// record included:
//     shown = bestOf(records whose key is K, or maps to K with samePool)
// A record played on DIFFERENT dates (the generator fault lib/dateConfig describes) maps to K without
// samePool and is never shown, and never mixed into anything.
//
// ★ READ-ONLY, AND NOTHING ELSE CHANGES. No record is rewritten, moved, copied, or merged; writes are
// exactly as before — a round or run files its result on ITS key's own record (store/screenPool's
// fileRoundResult). A legacy record is never written, so nothing can roll into or out of it, and an
// Override or Undo just recomputes what is shown. The one consequence to
// know: K's own stored record can be LOWER than what is shown (the shown Best may live under a legacy
// key). Nothing may read `map[key]` as "the Best" — tests/bestPoolGuard holds every read of a Best map
// in src/ to a named list, and the display reads come through here.
//
// ★ THE MERGE (bestOf*): per field, the best value; on a tie the record whose holder is the EARLIER
// round (`earlier`, below: a clock's ids are wall-clock ordered — engine/roundId — and an id that is
// not a clock's names a round from before them). The winning field brings its holder and its companion
// with it, so "Streak: 9" under Best Score is still that round's streak, the Same Round / Different
// Rounds tag still compares two holder ids, and the ★ (engine/roundId's isNewBest on the shown holder)
// lights only for a round that holds the POOL's Best: a round that beats K's own record but not a
// legacy one gets no ★, and neither does one that only ties a legacy Best.
// Pure, apart from a cache keyed on the map's identity (the stores replace a map on every write).
// ─────────────────────────────────────────────────────────────────────────
import { inEffectBestKey } from '../lib/dateConfig.js'
import { companion, type BlitzBest, type SuddenBest } from './blitzBest.js'
import type { AoxBest } from './aoxBest.js'
import { roundCentis } from '../lib/modeFormat.js'
import { clockRoundId } from './roundId.js'

// The stored keys whose records belong to in-effect key K's pool.
export function poolKeys(map: Readonly<Record<string, unknown>>, K: string): string[] {
  return Object.keys(map).filter((k) => {
    if (k === K) return true
    const m = inEffectBestKey(k)
    return m !== null && m.samePool && m.key === K
  })
}

// Is holder `x` earlier than holder `y`? A clock's ids are in the order their rounds began; a SCOPED id
// (engine/roundId: a v2.26.0 counter, or a value saved before rounds had ids) is a round played before
// any clock's, and none, earliest of all. (Two scoped ids say nothing about each other: neither is
// earlier, and the record first in the pool keeps the tie.)
const order = (id: number | null | undefined): number =>
  id == null ? -2 : clockRoundId(id) ? id : -1
const earlier = (x: number | null | undefined, y: number | null | undefined): boolean =>
  order(x) < order(y)

// ── The three record shapes ─────────────────────────────────────────────────────────────────────
export function bestOfAox(records: readonly AoxBest[]): AoxBest | undefined {
  let avg: AoxBest | undefined
  let med: AoxBest | undefined
  for (const r of records) {
    if (r.avg != null) {
      const better =
        !avg ||
        roundCentis(r.avg) < roundCentis(avg.avg!) ||
        (roundCentis(r.avg) === roundCentis(avg.avg!) && earlier(r.avgRoundId, avg.avgRoundId))
      if (better) avg = r
    }
    if (r.med != null) {
      const better =
        !med ||
        roundCentis(r.med) < roundCentis(med.med!) ||
        (roundCentis(r.med) === roundCentis(med.med!) && earlier(r.medRoundId, med.medRoundId))
      if (better) med = r
    }
  }
  if (!avg && !med) return undefined
  return {
    avg: avg?.avg ?? null,
    avgMed: avg?.avgMed ?? null,
    avgRoundId: avg?.avgRoundId ?? null,
    med: med?.med ?? null,
    medAvg: med?.medAvg ?? null,
    medRoundId: med?.medRoundId ?? null,
  }
}
export function bestOfBlitz(records: readonly BlitzBest[]): BlitzBest | undefined {
  let score: BlitzBest | undefined
  let streak: BlitzBest | undefined
  for (const r of records) {
    if (
      !score ||
      r.score > score.score ||
      (r.score === score.score && earlier(r.scoreRoundId, score.scoreRoundId))
    )
      score = r
    if (
      !streak ||
      r.streak > streak.streak ||
      (r.streak === streak.streak && earlier(r.streakRoundId, streak.streakRoundId))
    )
      streak = r
  }
  if (!score || !streak) return undefined
  return {
    score: score.score,
    scoreStreak: companion(score.scoreStreak),
    scoreRoundId: score.scoreRoundId ?? null,
    streak: streak.streak,
    streakScore: companion(streak.streakScore),
    streakRoundId: streak.streakRoundId ?? null,
  }
}
export function bestOfSudden(records: readonly SuddenBest[]): SuddenBest | undefined {
  let best: SuddenBest | undefined
  for (const r of records)
    if (
      !best ||
      r.score > best.score ||
      (r.score === best.score && earlier(r.roundId, best.roundId))
    )
      best = r
  return best && { score: best.score, roundId: best.roundId ?? null }
}

// ── The door ────────────────────────────────────────────────────────────────────────────────────
const cache = new WeakMap<object, Map<string, unknown>>()
function shown<T>(
  map: Readonly<Record<string, T>>,
  K: string,
  bestOf: (records: readonly T[]) => T | undefined,
): T | undefined {
  let byKey = cache.get(map)
  if (!byKey) cache.set(map, (byKey = new Map()))
  if (byKey.has(K)) return byKey.get(K) as T | undefined
  const result = bestOf(poolKeys(map, K).map((k) => map[k]))
  byKey.set(K, result)
  return result
}
// One per map: the bestOf* functions are told apart by the record shape, and a cache entry must never
// be read back through the wrong one (two maps never share an identity, so per-map is enough).
export const shownAoxBest = (map: Readonly<Record<string, AoxBest>>, K: string) =>
  shown(map, K, bestOfAox)
export const shownBlitzBest = (map: Readonly<Record<string, BlitzBest>>, K: string) =>
  shown(map, K, bestOfBlitz)
export const shownSuddenBest = (map: Readonly<Record<string, SuddenBest>>, K: string) =>
  shown(map, K, bestOfSudden)
