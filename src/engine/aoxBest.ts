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
// a post-completion Override can retract one of the run's n credited solves (back-browse Path 1 /
// retro Path 5) or add a credit (crediting a miss) — the run's standing stats keep moving after the
// completion recorded the Best. So AoxMode snapshots the ENTIRE pre-run Best object when the run
// records (the cumulative best of every PRIOR run — the floor that can never be lost, the cross-run
// corner the Blitz C2 fix had to add) and, on every post-completion stats change, sets the record to
// reconcileAoxStanding(snapshot, standing stats): still standing (good ≥ n) → the snapshot improved
// by the run's CURRENT avg/median; no longer standing (a credit was retracted) → the snapshot
// unchanged, as if the run never completed. That subsumes the old undo-the-completing-solve rollback
// and closes the back-browse hole (before the fix, only the live-edge reversal rolled the Best back,
// so a back-browse un-credit left a FABRICATED Best standing on a run with fewer than n credits).
// Extracted from main.tsx so it can be fuzzed directly against an independent oracle (best == the
// min avg/median among standing runs). Pure — no React, no app state. Mirrors engine/blitzBest.ts.
// (C2 Part 1.)
// ─────────────────────────────────────────────────────────────────────────
import { calcAvg, calcMed } from './stats.js'

// The shape the persisted store keeps per config (store/progress.ts owns the canonical copy; redeclared
// here, like blitzBest.ts's BlitzBest/SuddenBest, so the engine layer carries no store dependency — the
// two are structurally identical, so a store value passes straight into reconcileAoxBest).
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
// companion stat) — a later run that merely ties does not displace it. Returns the next record plus
// which metric(s) improved (for the "new best ★" marker). The caller snapshots the PRE-call `cur` for
// rollback (restore-on-undo), so this stays a pure forward fold.
export function reconcileAoxBest(
  cur: AoxBest,
  avg: number,
  med: number,
  rid: number | null,
): { next: AoxBest; avgImp: boolean; medImp: boolean } {
  const avgImp = cur.avg == null || avg < cur.avg
  const medImp = cur.med == null || med < cur.med
  const next: AoxBest = {
    avg: avgImp ? avg : cur.avg,
    avgMed: avgImp ? med : cur.avgMed,
    avgRoundId: avgImp ? rid : cur.avgRoundId,
    med: medImp ? med : cur.med,
    medAvg: medImp ? avg : cur.medAvg,
    medRoundId: medImp ? rid : cur.medRoundId,
  }
  return { next, avgImp, medImp }
}

// The recorded run's reconcile target as its standing stats move post-completion. While the run
// STANDS (still has its n credits, with computable stats), Best[its key] = the pre-run record
// improved by the run's CURRENT avg/median — re-fired on every post-completion stats edit, so a
// credited miss (faster standing avg) improves the record and the displayed Mean/Median can
// never silently beat the recorded Best. The moment it stops standing (good < n — a post-end
// Override retracted a credit), the record reverts to the pre-run snapshot, as if the run never
// completed. AoxMode calls this from its reconcile effect; the fuzz drives it directly.
export function reconcileAoxStanding(
  preRun: AoxBest,
  good: number,
  n: number,
  times: number[],
  rid: number | null,
): { next: AoxBest; avgImp: boolean; medImp: boolean } {
  const avg = calcAvg(times)
  const med = calcMed(times)
  if (good < n || avg == null || med == null)
    return { next: { ...preRun }, avgImp: false, medImp: false }
  return reconcileAoxBest(preRun, avg, med, rid)
}

// Field-wise equality for the reconcile effect's write-skip (avoid no-op store writes + marker churn).
export const aoxBestEqual = (a: AoxBest, b: AoxBest): boolean =>
  a.avg === b.avg &&
  a.avgMed === b.avgMed &&
  a.avgRoundId === b.avgRoundId &&
  a.med === b.med &&
  a.medAvg === b.medAvg &&
  a.medRoundId === b.medRoundId
