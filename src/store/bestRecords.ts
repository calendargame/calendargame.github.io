import type { RecordSpec, Rec, FV, RecOp } from './syncRecords.js'
import { scopedRoundId, COUNTER_ROUND_ID, recordTag } from './syncRecords.js'
import { isRecord } from './json.js'
import { roundCentis } from '../lib/modeFormat.js'

// store/bestRecords.ts — THE FOUR BEST MAPS AS THE RECORDS' MERGE SEES THEM (store/syncRecords): what a
// field of each map's record is, which of two values is better, and how a record on disk turns into
// the merge's field form and back (design-q1-q2.md v4, 4.1).
//
//   blitzBest, suddenAmBest  Best Score (with that round's streak beside it) and Best Streak (with that
//                            round's score); higher is better; 0 is no record.
//   suddenBest               Best Score alone; higher is better; 0 is no record.
//   aoxBest                  the best mean (with that run's median) and the best median (with that
//                            run's mean); FASTER is better, to the hundredth the screen shows; null is
//                            no record.
// ★ A ROUND'S RESULT IS AN OP (`roundOp`): its own values for every field of its map - the round's
// score AND its streak, whether or not either beats the record - so a take-back of the round that
// holds a field lands on the true next value, not on the record the round began on.
// ★ READING A RECORD (`toRec`), two things only a reader can do:
//   • a holder id below the clock range is a v2.26.0 COUNTER, scoped to the load it came from
//     (part2-issues #5);
//   • a value with NO holder (a record saved before rounds had ids) gets one that stands for exactly
//     that: a scoped id of its own, the same in every window, so the merge can keep it, compare it,
//     and take it back like any round.
// ★ WRITING ONE (`fromRec`): the app's own shape, plus the tag `w` that names its values (recordTag).

export type BestMap = 'blitzBest' | 'suddenBest' | 'suddenAmBest' | 'aoxBest'
export const BEST_MAPS: readonly BestMap[] = ['blitzBest', 'suddenBest', 'suddenAmBest', 'aoxBest']

type FieldOf = { key: string; comp: string | null; holder: string }
const higher: RecordSpec['better'] = (a, b) => (b ?? 0) > (a ?? 0)
const HIGHER = (fields: readonly string[]): RecordSpec => ({
  fields,
  empty: 0,
  better: higher,
  present: (v) => typeof v === 'number' && v > 0,
  same: (a, b) => (a ?? 0) === (b ?? 0),
})
const centis = (v: number | null) => (v === null ? null : roundCentis(v))
const FASTER: RecordSpec = {
  fields: ['avg', 'med'],
  empty: null,
  better: (a, b) => b !== null && (a === null || centis(b)! < centis(a)!),
  present: (v) => typeof v === 'number',
  same: (a, b) => centis(a) === centis(b),
}

const SCORE_STREAK: FieldOf[] = [
  { key: 'score', comp: 'scoreStreak', holder: 'scoreRoundId' },
  { key: 'streak', comp: 'streakScore', holder: 'streakRoundId' },
]
const MAPS: Record<BestMap, { spec: RecordSpec; fields: FieldOf[] }> = {
  blitzBest: { spec: HIGHER(['score', 'streak']), fields: SCORE_STREAK },
  suddenAmBest: { spec: HIGHER(['score', 'streak']), fields: SCORE_STREAK },
  suddenBest: {
    spec: HIGHER(['score']),
    fields: [{ key: 'score', comp: null, holder: 'roundId' }],
  },
  aoxBest: {
    spec: FASTER,
    fields: [
      { key: 'avg', comp: 'avgMed', holder: 'avgRoundId' },
      { key: 'med', comp: 'medAvg', holder: 'medRoundId' },
    ],
  },
}
export const recordSpec = (map: BestMap): RecordSpec => MAPS[map].spec

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * A record on disk in the merge's field form - null when it holds nothing. `load` is the load the doc
 * it came from was read in (store/syncRecords' loadKeyOf), for its counters; `slot` names the record
 * (its map and set-up), for a value saved with no holder.
 */
export function toRec(map: BestMap, disk: unknown, load: string, slot: string): Rec | null {
  if (!isRecord(disk)) return null
  const { spec, fields } = MAPS[map]
  const f: Record<string, FV> = {}
  for (const fd of fields) {
    const v = num(disk[fd.key]) ?? spec.empty
    if (!spec.present(v)) {
      f[fd.key] = { v: spec.empty, id: null }
      continue
    }
    const raw = num(disk[fd.holder])
    const id =
      raw === null
        ? scopedRoundId(`legacy|${slot}|${fd.key}|${v}`, 0)
        : raw < COUNTER_ROUND_ID
          ? scopedRoundId(load, raw)
          : raw
    f[fd.key] = { v, ...(fd.comp ? { c: num(disk[fd.comp]) } : {}), id }
  }
  // (a pass-through literal a new window wrote carries its own rounds as ops: applied exactly)
  const ops = Array.isArray(disk.ops) ? (disk.ops as RecOp[]) : undefined
  return { f, ...(ops ? { ops } : {}) } as Rec
}

/** A record in field form as the app stores it (tagged: with the tag naming its values), or undefined
 *  for one that holds nothing. */
export function fromRec(
  map: BestMap,
  rec: Rec | null,
  tagged: boolean,
): Record<string, unknown> | undefined {
  if (!rec) return undefined
  const { spec, fields } = MAPS[map]
  if (!fields.some((fd) => spec.present(rec.f[fd.key]?.v ?? spec.empty))) return undefined
  const out: Record<string, unknown> = {}
  for (const fd of fields) {
    const q = rec.f[fd.key] ?? { v: spec.empty, id: null }
    out[fd.key] = spec.present(q.v) ? q.v : spec.empty
    if (fd.comp) out[fd.comp] = spec.present(q.v) ? (q.c ?? null) : null
    out[fd.holder] = spec.present(q.v) ? q.id : null
  }
  if (tagged) out.w = recordTag(out)
  return out
}

/** Is this stored record one a new build wrote and nobody has changed since (its tag names its values)? */
export const taggedRecord = (disk: unknown): boolean =>
  isRecord(disk) && typeof disk.w === 'string' && disk.w === recordTag(disk)

/**
 * A round's result as an op on its map's record: `values` are the round's own figures - for Blitz its
 * score and its best streak; for MoX its mean and median - or null for a round that holds nothing now
 * (taken back whole). `ov`: the round was filed before (a later change to it - an Override, a resume).
 */
export function roundOp(
  map: BestMap,
  id: number,
  values: { score: number; streak?: number } | { avg: number; med: number } | null,
  ov: boolean,
): RecOp {
  const v: RecOp['v'] = {}
  if (map === 'aoxBest') {
    const r = values as { avg: number; med: number } | null
    v.avg = r ? { v: r.avg, c: r.med } : { v: null }
    v.med = r ? { v: r.med, c: r.avg } : { v: null }
  } else if (map === 'suddenBest') {
    v.score = { v: (values as { score: number } | null)?.score ?? 0 }
  } else {
    const r = values as { score: number; streak: number } | null
    v.score = r ? { v: r.score, c: r.streak } : { v: 0 }
    v.streak = r ? { v: r.streak, c: r.score } : { v: 0 }
  }
  return { id, v, ...(ov ? { ov: true } : {}) }
}
