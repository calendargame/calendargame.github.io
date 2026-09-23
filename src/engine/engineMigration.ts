// ─────────────────────────────────────────────────────────────────────────
// engine/engineMigration.ts — a parked engine state from an OLDER build, brought forward.
//
// store/sessionRound parks whole engine states (an ended Blitz round / MoX run) in sessionStorage,
// and a reload keeps them — so the first build with round 23's per-card Override record meets
// states written by the builds before it, and must load them rather than crash or mis-score.
// This is the ONE door they come through: `restoreParkedEngine` below, which each timed mode calls
// on its parked snapshot at mount, BEFORE anything reads it — so the screen's own fields and its
// engine are kept or dropped together, never one without the other.
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
import {
  blankCard,
  correctIndexOf,
  earnedCredit,
  forEachCard,
  oneBtn,
  overriddenLiveFlags,
} from './gameReducer.js'
import { captureError } from '../observability/sentry.js'
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

// An overridden live card takes today's fixed O flags (gameReducer's overriddenLiveFlags). The old
// engine left an un-credited one UNLOCKED (its Path 2 "stay"), which today would let an answer paint
// over the overridden grid — so the old flags are normalised, never carried over.
// …and the as-answered flags it goes back to on Undo, which the old engine never kept — except ONE:
// the codes penalty. No old Override ever touched `calcPenaltyActive`, so whatever the old state
// carries is the card's as-answered fact, and it is carried into A (dropping it made the first Undo
// forget that Show Codes had been opened, for good — a third state, not a two-state switch). The rest
// is reconstructed: a credited A was a held completing solve (locked, nothing shown or burned —
// exact); an un-credited A had its grid replaced by the answer alone, so it is given the one miss
// shape that grid actually is — a Reveal's, or a Show Codes' when the penalty says so. Those are the
// same two shapes as O's, which is why O's definition serves.
const liveA = (aCredited: boolean, calcPenaltyActive: boolean): LiveFlags => ({
  ...overriddenLiveFlags(aCredited),
  calcPenaltyActive,
})

// Did the clock run out on this LIVE card untouched? The old engine kept no record of it (CardMeta
// .timedOut is new), but the live flags still say it unambiguously: a per-question TIMEOUT_MISS is
// the one action that leaves a card scored with its answer shown and NOT burned — a Reveal burns it,
// and the per-round LOCK_REVEAL shows the answer without scoring. Only a live card can carry those
// flags (a history card sheds them), and only a live card can have timed out in the old app too.
const timedOutLive = (scored: boolean | null, revealed: boolean, countedWrong: boolean): boolean =>
  scored === true && revealed && !countedWrong

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
  if (!overridden) {
    const timedOut = !!ls && timedOutLive(ls.saveStatsFrozen, ls.revealed, ls.countedWrong)
    const meta: CardMeta = { wrongTime, answered: null, ...(timedOut ? { timedOut } : {}) }
    return { ...e, meta, ...(ls ? { liveState: ls } : {}) }
  }
  const ci = correctIndexOf(e, useJulian)
  if (e.isLive && ls) {
    const credited = earnedCredit(e.btns, ls.revealed, ls.countedWrong)
    return {
      ...e,
      btns: oneBtn(ci, credited ? 'correct' : 'override-wrong'),
      liveState: { ...ls, ...overriddenLiveFlags(credited) },
      meta: overriddenMeta(
        credited,
        e.solveTime ?? null,
        wrongTime,
        ci,
        capsule?.snapshot,
        liveA(!credited, ls.calcPenaltyActive),
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

// ⚠ AND THE TIMES POOL IN PLAY ORDER. Today's engine keeps stats.times as the carried-in times
// followed by the cards' times in play order (gameReducer's poolSlot) — "Last" on the stat strip
// reads its end. An older build appended an Override's time wherever it happened (a browsed card's
// credit went on the END, behind newer cards) and dropped by value, so its pool can hold exactly the
// right times in the wrong order. Re-laid here from the cards themselves: the carried-in prefix keeps
// its own order and the cards' times follow in play order, so the mean cannot move. A pool the cards
// do not account for (a corrupt blob) is left exactly as it came, for the tripwire to report — never
// silently "repaired" into a shape nothing played.
const inPlayOrder = (s: GameState): GameState => {
  const named: number[] = []
  forEachCard(s, (e) => {
    if (e.solveTime != null) named.push(e.solveTime)
  })
  const carried = s.stats.times.slice()
  for (const t of named) {
    const i = carried.lastIndexOf(t)
    if (i < 0) return s
    carried.splice(i, 1)
  }
  if (carried.length !== s.timesBase) return s
  return { ...s, stats: { ...s.stats, times: [...carried, ...named] } }
}

export function migrateEngineState(blob: unknown, useJulian: boolean): GameState {
  return inPlayOrder(migrateShape(blob, useJulian))
}

// The per-card record, from whichever build wrote the blob.
function migrateShape(blob: unknown, useJulian: boolean): GameState {
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
  if (!overridden) {
    const timedOut = s.backDepth === 0 && timedOutLive(s.saveStatsThisQ, s.revealed, s.countedWrong)
    return { ...base, card: timedOut ? { ...meta, timedOut } : meta }
  }
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
    ...overriddenLiveFlags(credited),
    card: overriddenMeta(
      credited,
      s.liveSolveTime,
      meta.wrongTime,
      ci,
      prevStatsSnapshot,
      liveA(!credited, s.calcPenaltyActive),
    ),
  }
}

// ★ THE RESTORE DOOR — a parked blob in, today's engine state out, or null when the blob cannot be
// one. Null means "nothing is parked": the caller drops its WHOLE snapshot (its own fields ride on
// this engine, so a fresh engine under a restored "ended" screen would be a state no play reaches)
// and the mode comes up fresh, and its mirror effect then discards the slot on its first run.
//
// ⚠ WHY A BLOB CAN BE UNREADABLE AT ALL. sessionStorage is per ORIGIN, and the live site and the
// staging build share one (calendargame.app/test_version/) — so a build this one has never heard of
// can have written the slot, and a reload keeps it. Unguarded, the first bad read threw inside the
// engine's lazy initializer at mount, and since the blob outlives the reload, every reload died the
// same way for the rest of the browsing session: a mode screen bricked until the tab was closed.
//
// Two layers. The SHAPE check names every field the migration and the first render need before they
// can even be asked — a date, the history arrays, the grid, the stats and their times (each of those
// either throws in the migration or on the screen's first paint). Then the migration itself runs
// inside a catch, so a card deep in the history that is not one (the check does not walk every field
// of every entry, and should not have to) lands here too rather than on the error card. Either way
// the report goes to the same place every other caught failure does, with the reason attached.
export function restoreParkedEngine(
  blob: unknown,
  useJulian: boolean,
  mode: string,
): GameState | null {
  const reject = (reason: string, error?: unknown): null => {
    captureError(error ?? new Error(`Unreadable parked round: ${reason}`), {
      where: 'restore-parked-round',
      mode,
      reason,
    })
    return null
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  if (!isObj(blob)) return reject('not an object')
  const stats = blob.stats
  if (!isObj(blob.date)) return reject('no date')
  if (!Array.isArray(blob.stack) || !Array.isArray(blob.forwardStack))
    return reject('no history arrays')
  if (![...blob.stack, ...blob.forwardStack].every(isObj))
    return reject('a history entry is not a card')
  if (!isObj(blob.persistBtns)) return reject('no grid')
  if (!isObj(stats) || !Array.isArray(stats.times)) return reject('no stats')
  try {
    return migrateEngineState(blob, useJulian)
  } catch (e) {
    return reject('the migration threw', e)
  }
}
