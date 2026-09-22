// ─────────────────────────────────────────────────────────────────────────
// engine/engineMigration.ts — a parked engine state from an OLDER build, brought forward.
//
// store/sessionRound parks whole engine states (an ended Blitz round / MoX run) in sessionStorage,
// and a reload keeps them — so the first build with round 23's per-card Override record meets
// states written by the builds before it, and must load them rather than crash or mis-score.
// This is the ONE door they come through: useGameEngine's lazy initializer, for every parked state.
//
// TWO LEGACY SHAPES, both from the one-override-per-question engine:
//   • v2.25.0 — history entries carry `overrideUsed` (the per-question lock) and a `capsule`
//     ({ snapshot: the pre-answer stats, wrongTime }); the state carries `canOverrideCorrect`,
//     `pendingWrongOverride`, `prevStatsSnapshot`, `overrideUsedThisQ` and `wrongTime`.
//   • 44dd83f → round-23 fixers — the same, plus a whole-state `undoCapsule` (usually null, since the
//     park stripped it at write time from 2744a3b on, but an earlier blob can carry one).
// Today's shape replaces all of that with one CardMeta per card (see gameReducer's AnsweredState).
//
// ★ WHAT COMES BACK EXACTLY, AND WHAT CANNOT. A card that was never overridden is exact: its grid,
// credit and time were always its as-answered state, and its capsule's wrongTime is its first
// wrong's time. A card that WAS overridden comes back overridden (the button reads Undo on it) with
// its credit, and the time it contributes, exactly right — but its as-answered GRID was destroyed by
// the old Override paths, which overwrote it with the answer alone. It comes back showing the answer
// (a lone green) in its as-answered state instead of the original reds. That is the honest limit:
// the reds are not anywhere to recover, and inventing some would be worse. The as-answered TIME is
// recovered where the old engine kept it (a retro-flipped entry's capsule snapshot) and is null
// where an old path had already thrown it away.
//
// Idempotent: a state already in today's shape passes through unchanged, entry by entry, so the
// door can run on every restore without knowing which build wrote the blob.
// ─────────────────────────────────────────────────────────────────────────
import { blankCard, correctIndexOf, earnedCredit, oneBtn } from './gameReducer.js'
import type {
  AnsweredState,
  CardMeta,
  GameState,
  LiveFlags,
  LiveState,
  Question,
  StackEntry,
} from './gameReducer.js'
import type { Btns } from './answerButtons.js'

// ── The legacy fields, typed so every read below is checked (all optional: either build may be absent) ──
interface LegacySnapshot {
  contributedTime?: number | null
}
interface LegacyCapsule {
  snapshot?: LegacySnapshot | null
  wrongTime?: number | null
}
interface LegacyLiveState extends Partial<LiveState> {
  canOverrideCorrect?: boolean
  pendingWrongOverride?: unknown
}
type LegacyEntry = Question & {
  btns?: Btns
  hasCredit?: boolean
  isLive?: boolean
  solveTime?: number | null
  liveState?: LegacyLiveState
  meta?: CardMeta
  overrideUsed?: boolean
  capsule?: LegacyCapsule
}
type LegacyState = Omit<GameState, 'stack' | 'forwardStack' | 'card'> & {
  stack: LegacyEntry[]
  forwardStack: LegacyEntry[]
  card?: CardMeta
  wrongTime?: number | null
  overrideUsedThisQ?: boolean
  prevStatsSnapshot?: LegacySnapshot | null
  canOverrideCorrect?: boolean
  pendingWrongOverride?: unknown
  undoCapsule?: unknown
}

// The live flags of the two overridden live shapes, as today's engine writes them (gameReducer's
// OVERRIDE): a credited O holds the card locked with the answer alone in green; an un-credited O is
// a resolved miss. The old engine left the un-credited one UNLOCKED (its Path 2 "stay"), which today
// would let an answer paint over the overridden grid — so it is normalised, never carried over.
const O_CREDIT: Pick<LiveFlags, 'locked' | 'revealed' | 'countedWrong'> = {
  locked: true,
  revealed: false,
  countedWrong: false,
}
const O_MISS: Pick<LiveFlags, 'locked' | 'revealed' | 'countedWrong'> = {
  locked: true,
  revealed: true,
  countedWrong: true,
}
// …and the as-answered flags an overridden LIVE card goes back to on Undo, which the old engine
// never kept. A credited A was a held completing solve (locked, nothing shown or burned — exact);
// an un-credited A had its grid replaced by the answer alone, so it is given the one miss shape that
// grid actually is — a Reveal's.
const liveA = (aCredited: boolean): LiveFlags => ({
  ...(aCredited ? O_CREDIT : O_MISS),
  calcPenaltyActive: false,
})

// The O record of an overridden card: its as-answered state is the opposite credit, shown as the
// answer alone (see the header), with the time the old engine kept for it — only a credited A has
// one. O's frozen time is whatever the card contributes now, if O credits.
const overriddenMeta = (
  credited: boolean,
  solveTime: number | null,
  wrongTime: number | null,
  correctIdx: number,
  snapshot: LegacySnapshot | null | undefined,
  live?: LiveFlags,
): CardMeta => {
  const answered: AnsweredState = {
    btns: oneBtn(correctIdx, 'correct'),
    hasCredit: !credited,
    solveTime: !credited ? (snapshot?.contributedTime ?? null) : null,
    ...(live ? { live } : {}),
  }
  return { wrongTime, answered, ...(credited ? { oTime: solveTime } : {}) }
}

// One history / forward entry. Already migrated (it has `meta`) → unchanged. Otherwise its lock bit
// and capsule become its CardMeta, and an overridden one has its grid normalised to the answer alone
// — the old engine could leave it otherwise (a browse Reveal painted a green over 'override-wrong').
const migrateEntry = (raw: LegacyEntry, useJulian: boolean): StackEntry => {
  const { overrideUsed, capsule, liveState, ...e } = raw
  const ls: LiveState | undefined = liveState
    ? {
        locked: !!liveState.locked,
        revealed: !!liveState.revealed,
        countedWrong: !!liveState.countedWrong,
        calcPenaltyActive: !!liveState.calcPenaltyActive,
        saveStatsFrozen: liveState.saveStatsFrozen ?? null,
      }
    : undefined
  if (e.meta) return { ...e, meta: e.meta, ...(ls ? { liveState: ls } : {}) }
  const wrongTime = capsule?.wrongTime ?? null
  // The parked LIVE card carries its lock bit even when an old Path 5 only aimed THROUGH it at the
  // card behind — so, exactly as for the card on screen, it counts as overridden only if it was
  // scored. (A scored live card can never have been a Path-5 bystander: Path 5 needed it untouched.)
  const overridden = !!overrideUsed && (!e.isLive || ls?.saveStatsFrozen === true)
  if (!overridden)
    return { ...e, meta: { wrongTime, answered: null }, ...(ls ? { liveState: ls } : {}) }
  const ci = correctIndexOf(e, useJulian)
  if (e.isLive && ls) {
    const credited = earnedCredit(e.btns, ls.revealed, ls.countedWrong)
    return {
      ...e,
      btns: oneBtn(ci, credited ? 'correct' : 'override-wrong'),
      liveState: { ...ls, ...(credited ? O_CREDIT : O_MISS) },
      meta: overriddenMeta(
        credited,
        e.solveTime ?? null,
        wrongTime,
        ci,
        capsule?.snapshot,
        liveA(!credited),
      ),
    }
  }
  const credited = !!e.hasCredit
  return {
    ...e,
    btns: oneBtn(ci, credited ? 'correct' : 'override-wrong'),
    meta: overriddenMeta(credited, e.solveTime ?? null, wrongTime, ci, capsule?.snapshot),
  }
}

export function migrateEngineState(blob: unknown, useJulian: boolean): GameState {
  const {
    card,
    wrongTime,
    overrideUsedThisQ,
    prevStatsSnapshot,
    canOverrideCorrect,
    pendingWrongOverride,
    undoCapsule,
    ...s
  } = blob as LegacyState
  const stack = s.stack.map((e) => migrateEntry(e, useJulian))
  const forwardStack = s.forwardStack.map((e) => migrateEntry(e, useJulian))
  const base: GameState = { ...s, stack, forwardStack, card: card ?? blankCard() }
  if (card) return base
  // The card on screen. Its lock bit is `overrideUsedThisQ`, and ⚠ that bit is set by an old Path 5
  // on the FRESH live card too (the press aimed at the card behind it) — so it means "this card was
  // overridden" only when the card was scored, which a Path-5 bystander never is. A browsed card is
  // always scored (Back sets saveStatsThisQ).
  const overridden = !!overrideUsedThisQ && s.saveStatsThisQ === true
  const meta: CardMeta = { wrongTime: wrongTime ?? null, answered: null }
  if (!overridden) return { ...base, card: meta }
  const ci = correctIndexOf(s.date, useJulian)
  if (s.backDepth > 0) {
    const credited = s.browseHasCredit
    return {
      ...base,
      persistBtns: oneBtn(ci, credited ? 'correct' : 'override-wrong'),
      revealed: true,
      card: overriddenMeta(credited, s.liveSolveTime, meta.wrongTime, ci, prevStatsSnapshot),
    }
  }
  const credited = earnedCredit(s.persistBtns, s.revealed, s.countedWrong)
  return {
    ...base,
    persistBtns: oneBtn(ci, credited ? 'correct' : 'override-wrong'),
    ...(credited ? O_CREDIT : O_MISS),
    card: overriddenMeta(
      credited,
      s.liveSolveTime,
      meta.wrongTime,
      ci,
      prevStatsSnapshot,
      liveA(!credited),
    ),
  }
}
