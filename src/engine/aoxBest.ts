// ─────────────────────────────────────────────────────────────────────────
// engine/aoxBest.ts — pure Best-record reconciliation for AoX (the component wrapper layer).
//
// AoX keeps a per-config Best Mean / Best Median record — the FASTEST run a config has produced.
// "Best" here means MINIMUM time (lower is better), the opposite of Blitz's maximum score. A run records
// its Best on completion (the Nth credited solve); a post-completion Override that undoes that solve
// rolls the Best back. The record holds, for EACH of the two metrics, the metric value PLUS its
// companion stat (avgMed = the median of the run that set the best average; medAvg = the average of the
// run that set the best median) and the run id that set it — so the two metrics can come from DIFFERENT
// runs and each carries the matching stats from its own run.
//
// RECONCILE is continuous, like Blitz's. An ended run's history stays browsable and overridable, so
// a press of the Override ⇄ Undo button can retract one of the run's n credited solves (on a browsed
// card, on the card behind the live one, or on the held completing solve) or add a credit back — any
// number of times, in either direction — so the run's standing stats keep moving after the
// completion recorded the Best. So AoxMode snapshots the ENTIRE pre-run Best record at Begin
// (the cumulative best of every PRIOR run — the floor that can never be lost, the cross-run
// corner the Blitz cross-round rollback fix had to add; `undefined` when the config had no record) and, on every
// stats change of a run that counts, sets the record to reconcileAoxStanding(snapshot, standing stats):
// still standing (good ≥ n) → the snapshot improved by the run's CURRENT avg/median; no longer
// standing (a credit was retracted) → the snapshot unchanged, as if the run never completed — which,
// for a config that had no record, is NO RECORD (the key is removed, exactly as Blitz does:
// engine/bestMap). That subsumes the old undo-the-completing-solve rollback
// and closes the back-browse hole (before the fix, only the live-edge reversal rolled the Best back,
// so a back-browse un-credit left a FABRICATED Best standing on a run with fewer than n credits).
// Extracted from main.tsx so it can be fuzzed directly against an independent oracle (best == the
// min avg/median among standing runs, compared and stored at DISPLAY precision — see the ★ comments
// on reconcileAoxBest below for why raw-float comparison was a bug, not a simplification). Pure — no
// React, no app state. Mirrors engine/blitzBest.ts.
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

// Fold a completed run's (avg, med) into the Best record, tagged `rid`. Each metric improves only on a
// STRICT decrease (a faster time), so the FIRST run to reach a given minimum keeps the record (and its
// companion stat) — a later run that merely ties does not displace it. Returns the next record; a
// metric that improved is the one now tagged with `rid`, which is exactly what the "new best ★"
// marker reads (engine/roundId's isNewBest — the ★ is derived from the ids, so this no longer
// reports a separate improved-flag pair). The caller snapshots the PRE-call `cur` for rollback
// (restore-on-undo), so this stays a pure forward fold.
//
// ★ COMPARE AT DISPLAY PRECISION, NOT RAW FLOAT PRECISION. Best Mean / Best Median / Mean / Median are
// NEVER shown to the player except through fmtTime (modeFormat.ts), which rounds to hundredths via
// roundCentis (WCA reg 9f1). So two runs can print IDENTICALLY — "2.13s" and "2.13s" — while their raw
// avg/med floats differ in the fourth-plus decimal (calcAvg/calcMed divide sums, which is where that
// noise comes from). A raw `avg < cur.avg` still fires on that invisible difference and hands the
// record (and with it the ★) to a "new best" no player can ever see or verify — that was the actual bug here, not the strict-`<`
// tie rule itself (a genuine full-precision tie correctly not counting as an improvement is correct
// and unchanged). roundCentis is imported from modeFormat rather than reimplemented: that file's own
// comment explains in detail why a second `Math.round(t * 100)` would silently disagree with it on a
// boundary case like 59.995, and two rounding implementations that can disagree with EACH OTHER is
// exactly the bug class this codebase's comments repeatedly warn against.
//
// ★ STORAGE follows the same reasoning one step further. Once a run improves the record, `next.avg` /
// `next.med` store the ROUNDED value (roundCentis(..)/100), not the raw float — and so do the
// companion stats avgMed/medAvg, which are displayed through fmtTime too. This app's whole philosophy
// is that a stat means exactly what's printed and carries no hidden state (see modeFormat.ts's EM_DASH
// block for the same principle applied to the dash); a persisted Best that is secretly MORE precise
// than anything a player could ever compare it against is exactly the kind of ghost precision that
// philosophy rules out, and it's also what would let a future raw compare reintroduce this same bug.
// This doesn't cost the NEXT comparison anything: roundCentis is idempotent on its own output — for
// every whole-hundredth value in range, centis/100 round-trips through it to the identical centis
// (verified 0..60000s, i.e. every WCA-legal single/average) — so once a value is stored rounded, every
// future compare is exact centis-integer vs. centis-integer and can never itself drift.
export function reconcileAoxBest(
  cur: AoxBest,
  avg: number,
  med: number,
  rid: number | null,
): AoxBest {
  const mean = roundCentis(avg) / 100
  const median = roundCentis(med) / 100
  return betterAoxBest(cur, {
    avg: mean,
    avgMed: median,
    avgRoundId: rid,
    med: median,
    medAvg: mean,
    medRoundId: rid,
  })
}
// ★ WHICH OF TWO RECORDS IS THE BETTER — the one comparison, metric by metric, at display precision
// (the two ★ notes above): `b` takes a metric from `a` only by being STRICTLY faster on it, and takes
// that metric's companion stat and holder with it; a metric it merely ties — or does not have — stays
// with `a`, companion included, EXCEPT when both name the same holder run. Then they are the same
// run seen at two moments, and `b` is the later sighting, so its companion is the current one: a run
// that holds only one metric can have its OTHER stat moved by an Override after it completed (the
// mean shifts while the median holds), and a copy saved before that Override must not put the old
// companion back (Round 26, found with Blitz's companions — engine/blitzBest's header). A run
// completing is this comparison (above: the run's own mean and median, as a record, against the one
// that stood — where `a` never names the run, so the exception cannot arise), and so is anything else
// holding two records for one set-up that must keep the better — store/amnesic, when two tabs have
// each saved one (there `b` is this page's own record, the later one).
const faster = (a: number | null, b: number | null): boolean =>
  b != null && (a == null || roundCentis(b) < roundCentis(a))
const sameRun = (aId: number | null, bId: number | null, a: number | null, b: number | null) =>
  aId != null && aId === bId && a != null && b != null && roundCentis(a) === roundCentis(b)
export function betterAoxBest(a: AoxBest, b: AoxBest): AoxBest {
  const avgImp = faster(a.avg, b.avg)
  const medImp = faster(a.med, b.med)
  const avgSeen = avgImp || sameRun(a.avgRoundId, b.avgRoundId, a.avg, b.avg)
  const medSeen = medImp || sameRun(a.medRoundId, b.medRoundId, a.med, b.med)
  return {
    avg: avgImp ? b.avg : a.avg,
    avgMed: avgSeen ? b.avgMed : a.avgMed,
    avgRoundId: avgImp ? b.avgRoundId : a.avgRoundId,
    med: medImp ? b.med : a.med,
    medAvg: medSeen ? b.medAvg : a.medAvg,
    medRoundId: medImp ? b.medRoundId : a.medRoundId,
  }
}

// The recorded run's reconcile target as its standing stats move post-completion. While the run
// STANDS (still has its n credits, with computable stats), Best[its key] = the pre-run record
// improved by the run's CURRENT avg/median — re-fired on every post-completion stats edit, so a
// credited miss (faster standing avg) improves the record and the displayed Mean/Median can
// never silently beat the recorded Best. The moment it stops standing (good < n — a post-end
// Override retracted a credit), the record reverts to the pre-run one, as if the run never
// completed — `undefined` (NO record) when there was none before it. `n` is the length the run was
// BEGUN at, never the live setting (AoxMode's `run`). AoxMode calls this from its reconcile effect;
// the fuzz drives it directly.
export function reconcileAoxStanding(
  preRun: AoxBest | undefined,
  good: number,
  n: number,
  times: number[],
  rid: number | null,
): AoxBest | undefined {
  const avg = calcAvg(times)
  const med = calcMed(times)
  if (good < n || avg == null || med == null) return preRun
  return reconcileAoxBest(preRun ?? emptyAoxBest(), avg, med, rid)
}

// ── THE RECORD AS IT STANDS WITHOUT THIS RUN — what every reconcile is rebuilt from ─────────────────
// engine/blitzBest's blitzBestWithoutRound argues it in full, and it is the same rule here: the
// floor is not the snapshot taken at Begin (`preRun`) but the record AS IT STANDS (`cur`, read from
// the store at the moment of the write) with this run's own metrics taken back out. A metric this
// run holds — it carries this run's id, and ids never repeat — goes back to what it was before the
// run, companion stat and holder with it; a metric anyone else holds is left exactly as it is. So a
// better Best saved by another tab, or by another run under the same records while this one was
// parked, is never rebuilt over by a run restored after it; and with one writer the result is
// exactly `preRun`. `undefined` when nothing is left.
export function aoxBestWithoutRun(
  preRun: AoxBest | undefined,
  cur: AoxBest | undefined,
  runId: number | null,
): AoxBest | undefined {
  if (!cur) return undefined
  const avgMine = runId !== null && cur.avgRoundId === runId
  const medMine = runId !== null && cur.medRoundId === runId
  const from = preRun ?? emptyAoxBest()
  const rec: AoxBest = {
    avg: avgMine ? from.avg : cur.avg,
    avgMed: avgMine ? from.avgMed : cur.avgMed,
    avgRoundId: avgMine ? from.avgRoundId : cur.avgRoundId,
    med: medMine ? from.med : cur.med,
    medAvg: medMine ? from.medAvg : cur.medAvg,
    medRoundId: medMine ? from.medRoundId : cur.medRoundId,
  }
  return rec.avg === null && rec.med === null ? undefined : rec
}
