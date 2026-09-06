// ─────────────────────────────────────────────────────────────────────────
// engine/runBreakdown.ts — a finished run/round, solve by solve.
//
// Pure: (GameState) => the ordered list of cards that were PLAYED, each with the date it asked, the
// second it is contributing to the mean, and whether it earned its point — plus the summary line
// the popup prints above them (components/RunBreakdown). No React, no app state, no formatting;
// the caller owns every string.
//
// ★ THE SUMMARY IS COMPUTED FROM THE ROWS, and that is the whole design, not an implementation
// detail. The obvious alternative — print `calcAvg(state.stats.times)` at the top and list the rows
// underneath — makes the headline agree with the stats strip BY CONSTRUCTION while leaving it free
// to disagree with the rows directly beneath it, which is the one contradiction a player would
// actually catch. Deriving both from the same array makes the panel internally consistent by
// construction instead, and moves the remaining claim — "these rows ARE the mean on the strip" —
// somewhere it can be enforced: the times ledger (StackEntry.solveTime + GameState.liveSolveTime),
// which checkGameInvariants asserts after every dispatch and the fuzz proves across millions of
// games. So the breakdown is a live proof of the headline rather than a second opinion about it.
//
// ⚠ WHAT MAKES THE ROWS COMPLETE — worth stating because it is the same argument the card ledger
// makes for the Q# badge, and it is what keeps this file from needing any state of its own. Every
// browsable history entry is exactly one increment of `played`, so walking the history in order and
// keeping the cards that were COUNTED yields exactly `played` rows. The one card the stacks cannot
// supply is the one on screen, which is why `state.date` is spliced in at its position rather than
// appended: browsing back POPS cards off `stack` and parks them in `forwardStack`, so mid-browse the
// on-screen card sits BETWEEN the two.
//
// ⚠ WHAT THE ROWS DO NOT KNOW, stated plainly rather than guessed at. A missed card can say THAT it
// was missed and, from its own answer grid, which of three shapes the miss had — you picked a wrong
// day, the answer was shown to you, or an Override took the credit back. It cannot say whether "the
// answer was shown" was a Reveal, a Show Codes, or a Blitz timeout: those three write byte-identical
// records (a lone green, nothing else), and the engine records no reason. Inventing a fourth field to
// separate them was considered and REJECTED for now — it would be a new per-question field threaded
// through the five Override paths, which is where this app's hardest bugs have always lived, bought
// for a distinction the panel never claimed to make. So the mark says exactly what is known: `shown`
// means "the answer was on screen", and the guide says the same. If the distinction is ever wanted,
// it is a per-question `missKind` set at REVEAL / SHOW_CODES / TIMEOUT_MISS and carried by advance()
// exactly the way `solveTime` is — the ledger built here is the pattern to copy.
// ─────────────────────────────────────────────────────────────────────────
import { earnedCredit } from './gameReducer.js'
import type { GameState, Question, StackEntry } from './gameReducer.js'
import type { Btns } from './answerButtons.js'
import { calcAvg, calcMed } from './stats.js'

// Why a card did NOT earn its point. null = it did (no mark is drawn).
//   'wrong'    — a wrong day was picked on this card (a later correct answer does not un-miss it).
//   'shown'    — the answer was on screen: Reveal, Show Codes, or a timeout. See the ⚠ note above.
//   'override' — the card WAS credited and an Override took it back.
export type SolveMark = 'wrong' | 'shown' | 'override' | null

export interface BreakdownRow {
  n: number //             1-based position in the run — the card's own number, matching the Q# badge
  question: Question //    the date (or Deduction puzzle) this card asked, with its _fmt/_jul snapshot
  time: number | null //   the second this card contributes to the mean; null = it contributes none
  credited: boolean
  mark: SolveMark
}

export interface BreakdownSummary {
  solves: number //        credited cards — the ones the mean is made of
  cards: number //         cards played, credited or not (= `played`)
  mean: number | null
  median: number | null
  fastest: number | null
  slowest: number | null
  spread: number | null // slowest − fastest; null unless there are at least two times to span
}

export interface RunBreakdown {
  rows: BreakdownRow[]
  summary: BreakdownSummary
  // The row indices to accent. Both null when there is nothing to distinguish (no times, or every
  // time identical — accenting one of two equal solves as "the fastest" would be a coin toss the
  // panel presented as a fact). FIRST occurrence wins a tie between distinct rows.
  fastestIdx: number | null
  slowestIdx: number | null
}

// One card, normalised out of the three shapes the engine stores it in (a history entry, the parked
// live entry, the card on screen) so the walk below can treat them alike.
interface CardView {
  question: Question
  btns: Btns
  counted: boolean //   did this card take its `played` increment? (uncounted cards are not rows)
  credited: boolean
  time: number | null
}

// A plain history entry — one that has been through advance(), so its bookkeeping is settled.
// Every such entry is counted, by the card ledger's correspondence (see GameState.historyBase).
const fromEntry = (e: StackEntry): CardView => ({
  question: e,
  btns: e.btns ?? {},
  counted: true,
  credited: !!e.hasCredit,
  time: e.solveTime ?? null,
})

// The LIVE card parked in forwardStack by BACK. Its `hasCredit` there is a raw computeHasCredit of
// the grid (BACK stores it that way, and the streak recompute re-derives rather than trusting it),
// so the credit is recomputed here through the same earnedCredit rule advance() would apply on the
// way past — otherwise a live card that had been REVEALED would list as a credited solve.
const fromLiveEntry = (e: StackEntry): CardView => {
  const ls = e.liveState
  return {
    question: e,
    btns: e.btns ?? {},
    counted: ls?.saveStatsFrozen === true,
    credited: earnedCredit(e.btns, !!ls?.revealed, !!ls?.countedWrong),
    time: e.solveTime ?? null,
  }
}

// The card actually on screen. Two cases, and they differ in every field that matters:
//   • at the live edge — it is mid-play, so its credit comes from the live flags and it counts only
//     if some stat action froze Save-Stats to true on it (a fresh card has not, and is not a row).
//   • browsing back — it is a settled history entry that BACK popped off the stack, so it counts,
//     and its credit is `browseHasCredit`, the flag Override maintains while you browse.
const fromCurrent = (state: GameState): CardView =>
  state.backDepth === 0
    ? {
        question: state.date,
        btns: state.persistBtns,
        counted: state.saveStatsThisQ === true,
        credited: earnedCredit(state.persistBtns, state.revealed, state.countedWrong),
        time: state.liveSolveTime,
      }
    : {
        question: state.date,
        btns: state.persistBtns,
        counted: true,
        credited: state.browseHasCredit,
        time: state.liveSolveTime,
      }

// The mark for an un-credited card, read off the answer grid it already carries — no new engine
// state. Order matters: an Override that reversed a credit leaves 'override-wrong' AND (for a
// wrong-then-reversed card) nothing else, while a card the player simply got wrong keeps its reds,
// so 'override-wrong' is tested first as the more specific fact. A card with neither had a lone
// green synthesised onto it, which happens exactly when the answer was shown rather than picked.
const markOf = (btns: Btns): SolveMark => {
  const vals = Object.values(btns)
  if (vals.includes('override-wrong')) return 'override'
  if (vals.some((v) => v === 'wrong' || v === 'wrong-latest' || v === 'wrong-prev')) return 'wrong'
  return 'shown'
}

export function buildRunBreakdown(state: GameState): RunBreakdown {
  // The run in order: the cards behind the one on screen, the one on screen, then the cards ahead of
  // it. forwardStack is stored nearest-LAST (BACK appends), so reversing it walks forward in time.
  const ordered: CardView[] = [
    ...state.stack.map(fromEntry),
    fromCurrent(state),
    ...state.forwardStack
      .slice()
      .reverse()
      .map((e) => (e.isLive ? fromLiveEntry(e) : fromEntry(e))),
  ]
  const rows: BreakdownRow[] = []
  for (const c of ordered) {
    if (!c.counted) continue //  a card nothing was recorded for was never played — not a row
    rows.push({
      n: rows.length + 1,
      question: c.question,
      time: c.time,
      credited: c.credited,
      mark: c.credited ? null : markOf(c.btns),
    })
  }
  const times = rows.map((r) => r.time).filter((t): t is number => t != null)
  const fastest = times.length ? Math.min(...times) : null
  const slowest = times.length ? Math.max(...times) : null
  // Accent nothing when there is nothing to tell apart. One time is both the fastest and the
  // slowest, and so is every time in a run where they all tie — an accent on one of them would be
  // an arbitrary pick dressed up as a result.
  const distinct = fastest != null && slowest != null && fastest !== slowest
  return {
    rows,
    summary: {
      solves: rows.filter((r) => r.credited).length,
      cards: rows.length,
      mean: calcAvg(times),
      median: calcMed(times),
      fastest,
      slowest,
      spread: distinct ? slowest - fastest : null,
    },
    fastestIdx: distinct ? rows.findIndex((r) => r.time === fastest) : null,
    slowestIdx: distinct ? rows.findIndex((r) => r.time === slowest) : null,
  }
}
