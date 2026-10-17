// ─────────────────────────────────────────────────────────────────────────
// engine/aoxBest.ts — the MoX Best record's shape, and a run's RESULT as it is filed on it.
//
// AoX keeps a per-config Best Mean / Best Median record — the FASTEST run a config has produced.
// "Best" here means MINIMUM time (lower is better), the opposite of Blitz's maximum score. The record
// holds, for EACH of the two metrics, the metric value PLUS its companion stat (avgMed = the median of
// the run that set the best average; medAvg = the average of the run that set the best median) and the
// run id that set it — so the two metrics can come from DIFFERENT runs and each carries the matching
// stats from its own run.
//
// A run's result is FILED, not folded: while a run stands, its own mean and median go to the record as
// that run's figures (aoxRunResult, below; modes/AoxMode, through store/screenPool's fileRoundResult),
// and the record — store/syncRecords, the windows-in-sync door's merge of Best records — keeps every
// run's figures beside it. So a press of the Override ⇄ Undo button that retracts one of an ended run's
// credits (on a browsed card, on the card behind the live one, or on the held completing solve) or adds
// one back moves exactly that run's figures, and the record is always the fastest standing run, held by
// the first run to reach it — whichever window ran it (store/bestRecords' FASTER: compared at display
// precision, ties staying with the run that got there first).
// ─────────────────────────────────────────────────────────────────────────
import { calcAvg, calcMed } from './stats.js'
import { roundCentis } from '../lib/modeFormat.js'

// The shape the persisted store keeps per config. This file builds every one, so it owns the shape;
// store/progress re-exports it (as it does engine/blitzBest's), and the engine layer still carries no
// store dependency.
export interface AoxBest {
  avg: number | null
  avgMed: number | null
  avgRoundId: number | null
  med: number | null
  medAvg: number | null
  medRoundId: number | null
}

// The empty Best (no run recorded yet) — what a fresh config reads.
export const emptyAoxBest = (): AoxBest => ({
  avg: null,
  avgMed: null,
  avgRoundId: null,
  med: null,
  medAvg: null,
  medRoundId: null,
})

// ★ COMPARE AT DISPLAY PRECISION, NOT RAW FLOAT PRECISION. Best Mean / Best Median / Mean / Median are
// NEVER shown to the player except through fmtTime (modeFormat.ts), which rounds to hundredths via
// roundCentis (WCA reg 9f1). So two runs can print IDENTICALLY — "2.13s" and "2.13s" — while their raw
// avg/med floats differ in the fourth-plus decimal (calcAvg/calcMed divide sums, which is where that
// noise comes from). A raw `avg < cur.avg` still fires on that invisible difference and hands the
// record (and with it the ★) to a "new best" no player can ever see or verify. So the record compares
// at display precision (store/bestRecords' FASTER), with roundCentis imported from modeFormat rather
// than reimplemented: that file's own comment explains in detail why a second `Math.round(t * 100)`
// would silently disagree with it on a boundary case like 59.995, and two rounding implementations
// that can disagree with EACH OTHER is exactly the bug class this codebase's comments repeatedly warn
// against.
//
// ★ STORAGE follows the same reasoning one step further. A run's figures are filed ROUNDED
// (roundCentis(..)/100), not as the raw float — its mean, its median, and so the companion stats
// avgMed/medAvg, which are displayed through fmtTime too. This app's whole philosophy is that a stat
// means exactly what's printed and carries no hidden state (see modeFormat.ts's EM_DASH block for the
// same principle applied to the dash); a persisted Best that is secretly MORE precise than anything a
// player could ever compare it against is exactly the kind of ghost precision that philosophy rules
// out, and it's also what would let a future raw compare reintroduce this same bug. This doesn't cost
// the NEXT comparison anything: roundCentis is idempotent on its own output — for every whole-hundredth
// value in range, centis/100 round-trips through it to the identical centis (verified 0..60000s, i.e.
// every WCA-legal single/average) — so once a value is stored rounded, every future compare is exact
// centis-integer vs. centis-integer and can never itself drift.

// A RUN'S RESULT, as its Best record files it (modes/AoxMode, through store/screenPool's
// fileRoundResult): while the run STANDS (it still has its n credits, with computable stats), its
// CURRENT mean and median, rounded (the ★ notes above: stored rounded, compared rounded);
// otherwise null — it holds nothing, and the record is the best of every other run. Re-filed on every
// post-completion stats edit, so a credited miss (a faster standing mean) improves the record and the
// displayed Mean/Median can never silently beat the recorded Best. `n` is the length the run was BEGUN
// at, never the live setting (AoxMode's `run`).
export function aoxRunResult(
  good: number,
  n: number,
  times: number[],
): { avg: number; med: number } | null {
  const avg = calcAvg(times)
  const med = calcMed(times)
  if (good < n || avg == null || med == null) return null
  return { avg: roundCentis(avg) / 100, med: roundCentis(med) / 100 }
}
