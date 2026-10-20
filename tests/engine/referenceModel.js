// ─────────────────────────────────────────────────────────────────────────
// tests/engine/referenceModel.js — the fully-INDEPENDENT reference score model.
//
// A second, separately-written implementation of the game's SCORING CONTRACT that replays the same
// action stream as the reducer and computes the expected stats from its own per-question ledger —
// WITHOUT the reducer's stack/forwardStack, hasCredit flags, grids, or Override records. The fuzz
// (fuzzHarness.js, referenceModel profiles) compares the two after every action.
//
// WHY a second model when the strong oracle already cross-checks: the strong oracle reconstructs
// `good` from the reducer's own per-entry hasCredit flags — it catches aggregate-vs-flag DESYNCS
// (every bug so far) but would miss a state where the aggregate AND the flag are wrong TOGETHER
// (e.g. an override crediting a question that semantically shouldn't credit, setting both).
// This model re-derives what SHOULD be credited from the user-visible rules alone, so that class
// disagrees here. It also asserts `played` — which no prior oracle checked at all.
//
// INDEPENDENCE BOUNDARY (designed, not accidental): the model consumes only DISPLAY facts —
// the QUESTION a player can read off the screen, never scoring state:
//   • the question itself — its date, or a puzzle's options and the calendar it was built in — as
//     each one arrives: `next` from an advancing action's nextDate, and `liveAfter` from the screen
//     after a Reset / regen (which date survives those is a VIEW rule about the displayed question,
//     so the model reads the outcome rather than re-deriving keep-vs-replace nuances);
//   • per ANSWER, the option clicked — and the model works out FOR ITSELF whether it is right, with
//     its own calendar arithmetic (refWeekday below: the platform's Date for the Gregorian calendar,
//     Zeller's congruence for the Julian one — neither is the app's Julian-Day-Number formula).
//   • Everything else — per-question credit/burn/freeze state, the browse cursor, which question
//     the Override button points at and what a press does to it, played/good/streak/best/times
//     derivation — is modeled here from first principles (the contract: How-to-Play + the
//     characterization tests), sharing ZERO code with the reducer (even the streak walk is
//     re-implemented inline).
//
// THE MODEL: questions live in `history` (every question ADVANCED PAST that was scored, in order)
// plus the single `live` slot. Browsing is just a cursor (0 = the live edge; k = standing on
// history[length-k]) — entries never move (unlike the reducer's stack↔forwardStack shuffle).
// Stats are DERIVED, never maintained:
//   played = scored questions  ·  good = credited questions  ·  times = the credited contributions
//   best = the longest credit run in question order  ·  streak = the trailing run (clean edge only)
//
// Per-question scoring rules (the contract):
//   • A question is SCORED (counts a played) by its FIRST stat action — answer / Reveal / Show
//     Codes on the live question / per-question timeout — IF Save Stats was effectively on; that
//     first action FREEZES the question's Save-Stats (ssFrozen), so a later toggle can't re-score
//     or un-score it. One played per question, ever.
//   • ★ THE OVERRIDE, IN THIS MODEL'S OWN VOCABULARY (round 23): each question keeps the facts of
//     how it was ANSWERED — `aCredited` (a clean first-try correct that counted), `aTime` (that
//     answer's recorded solve time), `wrongTime` (the first miss's time) — which the Override NEVER
//     touches, plus ONE bit, `overridden`, which is all the Override ever flips. So:
//         credited = aCredited XOR overridden
//     and a credited question contributes `aTime` when not overridden, or `oTime` when it is — the
//     overridden credit's time, taken from `wrongTime` (when tracked) the first time an overridden
//     question counts as credited, and never re-taken. The reducer stores two materialised states
//     and rewrites grids, flags and times on every press; this model stores the answer once and
//     flips a bit. Two mechanisms, one contract — which is the point: if they ever disagree about a
//     score, a time or which question the button means, the ref profiles say so.
//   • WHICH QUESTION the button means (the model's reading of the UI contract): the browsed
//     question when browsing; otherwise the live question when it was scored AND it has something
//     to override (it was answered wrong / revealed / shown the codes, it holds a credit on screen,
//     or it is already overridden) — a pristine per-question timeout does not; otherwise the most
//     recent history question. A question the clock timed out on untouched is never the one,
//     wherever it sits: browsed to, or as the newest history question, the button means nothing. A press on the live question moves play on only when it credits a
//     question that was not overridden and the driver did not ask to hold (`hold`); nothing else
//     ever moves, and an Undo never does.
//   • An overridden live question is resolved on screen: locked either way, and when the override
//     took its credit away, the answer is shown and it counts as burned. Its as-answered flags are
//     still there underneath, untouched, for the Undo to fall back onto.
//   • Only SCORED questions enter history on advance (an unscored question vanishes — it was never
//     played); LOCK_REVEAL resolves a question without scoring it.
//   • ★ THE CALENDAR (round 24). A date on or before October 4, 1582 has two weekdays, and the
//     Julian Calendar setting can be switched at any moment. The contract: a question has ONE
//     calendar, fixed by the FIRST thing that judges it — an answer right or wrong, a Reveal, a Show
//     Codes that shows the answer, either timeout — as the setting stood at that moment (`jul`); a
//     Deduction puzzle's is the one it was built in; and a date only the Julian calendar HAS — a
//     February 29 the Gregorian calendar never had — is a Julian question whatever the setting says,
//     because there is no other calendar to judge it in (gregorianHas below: the platform's Date,
//     asked whether that day of that month exists). Every later judgement of that question, and
//     everything that shows it, reads that. So the model decides right-or-wrong in `jul`, and
//     compareRefModel holds the reducer to two things per question, in play order: the calendar it
//     stamped, and that the answer its grid marks is the model's own answer in that calendar.
// ─────────────────────────────────────────────────────────────────────────

import { statsAtCard } from '../../src/engine/gameReducer.js'

// ── The model's own calendar arithmetic (0 = Sunday … 6 = Saturday) ──────────────────────────────
// Julian applies to a date up to October 4, 1582, and only when the question's calendar says so.
const beforeReform = (q) => q.y < 1582 || (q.y === 1582 && (q.m < 10 || (q.m === 10 && q.d <= 4)))
const gregorianDay = (q) => {
  const dt = new Date(0)
  dt.setUTCFullYear(q.y, q.m - 1, q.d) // the proleptic Gregorian calendar, any year
  return dt
}
const gregorianWeekday = (q) => gregorianDay(q).getUTCDay()
// Does the Gregorian calendar have this day at all? Date rolls a day its month lacks into the next
// month, so the month it lands in says. (Every question the driver draws is a real day in the
// Julian calendar; before the reform, one the Gregorian calendar lacks is the Julian calendar's alone.)
const gregorianHas = (q) => gregorianDay(q).getUTCMonth() === q.m - 1
const onlyJulianHas = (q) => beforeReform(q) && !gregorianHas(q)
// Zeller's congruence, Julian form: January and February count as months 13 and 14 of the year
// before; its 0 is Saturday.
const julianWeekday = (q) => {
  const m = q.m < 3 ? q.m + 12 : q.m
  const y = q.m < 3 ? q.y - 1 : q.y
  const K = y % 100
  const C = Math.floor(y / 100)
  const h = (q.d + Math.floor((13 * (m + 1)) / 5) + K + Math.floor(K / 4) + 5 + 6 * C) % 7
  return (h + 6) % 7
}
export const refWeekday = (q, jul) =>
  jul && beforeReform(q) ? julianWeekday(q) : gregorianWeekday(q)
// The option that is right, in calendar `jul`. A puzzle's is one of its own options whatever the
// calendar (its year, the box holding its month, its day).
export const refAnswer = (q, jul) =>
  q.type === 'year'
    ? q.options.indexOf(q.y)
    : q.type === 'month'
      ? q.boxes.findIndex((b) => b.months.includes(q.m))
      : q.type === 'day'
        ? q.options.indexOf(q.d)
        : refWeekday(q, jul)

const freshLive = (q) => ({
  q, //            the question as displayed (kept for the push, and for its answer)
  jul: undefined, // its calendar — taken at the first judgement, never again (undefined = unjudged)
  answer: undefined, // the model's own answer in that calendar — worked out once (modelAnswer)
  grid: null, //       the reducer's grid this question's answer was last held to, and matched (compareCalendar)
  ssFrozen: null, // the frozen effective Save-Stats (null = untouched; true = scored)
  // ── how it was ANSWERED (never touched by an Override) ──
  aCredited: false, // a clean first-try correct that counted
  aTime: null, //     that answer's recorded solve time (null = none)
  wrongTime: null, // the (first) miss's solve time — what an overridden credit contributes
  burned: false, //   answered wrong / revealed / codes-burned (the reducer's countedWrong)
  revealed: false,
  locked: false,
  held: false, //     a correct answer held on screen (AoX `complete`)
  timedOut: false, // the clock ran out on it untouched — it can never be overridden, wherever it goes
  // ── the Override ──
  overridden: false,
  oTime: undefined, // the overridden credit's time, taken once (undefined = never taken)
})

// The model's view of a question the Override has not flipped vs has.
const credited = (q) => q.aCredited !== q.overridden
const contribution = (q) => (credited(q) ? (q.overridden ? q.oTime : q.aTime) : null)
// The live question as the SCREEN shows it: an overridden one is locked, and shows its answer as a
// miss (burned + revealed) when the override took the credit away. Its as-answered flags stay put.
const viewLocked = (l) => l.overridden || l.locked
const viewRevealed = (l) => (l.overridden ? !credited(l) : l.revealed)
const viewBurned = (l) => (l.overridden ? !credited(l) : l.burned)

export function createRefModel(initialQuestion, priorHistory = [], priorTimes = []) {
  return {
    history: [], // advanced-past SCORED questions, in order
    live: freshLive(initialQuestion),
    cursor: 0, // 0 = live edge; k>0 = browsing history[length-k]
    violations: [], // model-detected protocol breaks (driver/model disagreement)
    // The hydrated prior-session baseline (the hydration net): a continuous mode (Classic/Flash/
    // Deduction) loads lifetime stats but NOT the history behind them. priorHistory = the prior
    // per-question credit flags (a prefix of the whole credit sequence); priorTimes = the prior
    // credited solve times. Folded into the DERIVED stats (compareRefModel) but never browsed or
    // overridden — the reducer's stack can't reach them either, so the cursor/flip logic ignores them.
    // Cleared by RESET (the engine re-inits blank). Empty for a blank/timed start (identical to before).
    priorHistory: priorHistory.slice(),
    priorTimes: priorTimes.slice(),
  }
}

// First stat action on the live question: freeze Save-Stats (scoring it if on).
const freeze = (m, saveStats) => {
  if (m.live.ssFrozen === null) m.live.ssFrozen = saveStats
}
// The live question is being JUDGED: the first time, it takes its calendar — the only one that has
// its date, else the one a puzzle was built in, else the setting at this moment — and keeps it.
// Returns the calendar it is judged in.
const judge = (m, useJulian) => {
  const l = m.live
  if (l.jul === undefined)
    l.jul = onlyJulianHas(l.q) || ((l.q.type ? l.q._jul : undefined) ?? useJulian)
  return l.jul
}

// Advance past the live question: push it if SCORED (else it vanishes) and load a fresh live slot.
// The pushed question keeps everything the Override needs — how it was answered and its bit — and
// the calendar it was judged in.
const advance = (m, next) => {
  m.cursor = 0
  const l = m.live
  if (l.ssFrozen === true) {
    m.history.push({
      q: l.q,
      jul: l.jul,
      answer: l.answer,
      grid: l.grid,
      aCredited: l.aCredited,
      aTime: l.aTime,
      wrongTime: l.wrongTime,
      overridden: l.overridden,
      oTime: l.oTime,
      timedOut: l.timedOut,
    })
  }
  m.live = freshLive(next)
}

// Which question the one button means — the model's own reading (see the header). Returns
// 'browsed' | 'live' | 'retro' | null, the same vocabulary the reducer's selector uses, so the
// harness can compare the two answers directly.
export function refTarget(m) {
  if (m.cursor > 0) return m.history[m.history.length - m.cursor].timedOut ? null : 'browsed'
  const l = m.live
  if (l.ssFrozen === true && (l.burned || l.aCredited || l.overridden)) return 'live'
  const newest = m.history[m.history.length - 1]
  return newest && !newest.timedOut ? 'retro' : null
}
const targetQuestion = (m, t) =>
  t === 'browsed'
    ? m.history[m.history.length - m.cursor]
    : t === 'live'
      ? m.live
      : m.history[m.history.length - 1]

// Flip a question's one bit. The first time it lands on an overridden CREDIT, the credit's time is
// taken from the first miss (when tracking) and kept for every later flip.
const flip = (q, tracking) => {
  q.overridden = !q.overridden
  if (q.overridden && credited(q) && q.oTime === undefined)
    q.oTime = tracking && q.wrongTime != null ? q.wrongTime : null
}

// Apply one driver action to the model. `ctx` carries the exogenous display facts:
//   next      — advancing actions: the INCOMING question.
//   liveAfter — RESET / REGEN: the question the live slot holds afterwards.
// The actions that judge carry the Julian Calendar setting at that moment (`action.useJulian`).
export function applyRefModel(m, kind, action, ctx) {
  const live = m.live
  switch (kind) {
    case 'ANSWER': {
      if (m.cursor > 0 || viewLocked(live)) return // browsing locks the view; a locked question is resolved
      if (action.idx === refAnswer(live.q, judge(m, action.useJulian))) {
        if (!live.burned) {
          freeze(m, action.saveStats)
          if (live.ssFrozen === true) {
            live.aCredited = true
            live.aTime = action.elapsed != null && action.tracking ? action.elapsed : null
          }
          if (action.complete) {
            // AoX's Nth solve: credit but HOLD — stays on screen, locked, overridable.
            live.held = true
            live.locked = true
            return
          }
        }
        // A first-try correct moves on; so does a late correct on a burned question (no credit).
        advance(m, ctx.next)
      } else {
        // Wrong: score it (first touch), break the streak (derived), stay on the question.
        if (!live.burned) {
          freeze(m, action.saveStats)
          live.wrongTime = action.elapsed
        }
        live.burned = true
      }
      return
    }
    case 'REVEAL': {
      if (m.cursor > 0 || viewLocked(live)) return // browsing reveal is read-only; locked is resolved
      judge(m, action.useJulian)
      if (!live.burned) {
        freeze(m, action.saveStats)
        live.wrongTime = action.elapsed
      }
      live.burned = true
      live.revealed = true
      live.locked = true
      return
    }
    case 'SHOW_CODES_OPEN': {
      // Read-only review whenever the question is already resolved: browsing, a correct answer held
      // on screen, an overridden question (locked either way), or an answer already shown. Otherwise
      // it's the peek penalty (a scored miss).
      if (m.cursor > 0 || live.held || live.overridden || live.revealed) return
      judge(m, action.useJulian)
      if (!live.burned) {
        freeze(m, action.saveStats)
        live.wrongTime = action.elapsed
        live.burned = true
      }
      live.revealed = true
      return
    }
    case 'SHOW_CODES_CLOSE':
      return
    case 'NEW': {
      // Returns to the live edge first (browse edits are already in the ledger), then advances.
      advance(m, ctx.next)
      return
    }
    case 'BACK': {
      if (m.cursor < m.history.length) m.cursor++
      return
    }
    case 'FORWARD': {
      if (m.cursor > 0) m.cursor--
      return
    }
    case 'LOCK_REVEAL': {
      // Resolves the question WITHOUT scoring it (a Blitz per-round timeout) — it shows the answer
      // and locks; an unscored question later vanishes instead of entering history. An already
      // locked question (an overridden one included) is left exactly as it is, and so is everything
      // while browsing: the clock belongs to the live question, and the view is a history one.
      if (m.cursor > 0 || viewLocked(live)) return
      judge(m, action.useJulian) // it shows the answer, so it fixes which answer that is
      live.locked = true
      live.revealed = true
      return
    }
    case 'TIMEOUT_MISS': {
      // A per-question timeout: a scored miss (one played, first touch only) + resolved. On an
      // untouched question the question is TIMED OUT — the Override can never point at it, now or
      // after it becomes history; on one already answered wrong it is just the end of a burned
      // question, which stays overridable. Nothing while browsing (see LOCK_REVEAL).
      if (m.cursor > 0 || viewLocked(live)) return
      judge(m, action.useJulian)
      if (!live.burned) {
        freeze(m, action.saveStats)
        live.timedOut = true
      }
      live.revealed = true
      live.locked = true
      live.held = false
      return
    }
    case 'RESET': {
      // Which date survives a Reset (keep-vs-regenerate) is a VIEW rule about the on-screen
      // question — display plumbing, not scoring — so the model takes the answer from the screen
      // (ctx.liveAfter) rather than re-deriving it. (The 50× sweep proved the point: two
      // hand-modeled regen rules in a row desynced on browse-view nuances the reducer reads live.)
      m.history = []
      m.live = freshLive(ctx.liveAfter)
      m.cursor = 0
      m.priorHistory = [] // a full Reset re-inits the engine blank — the hydrated baseline is gone too
      m.priorTimes = []
      return
    }
    case 'REGEN': {
      // Swaps an untouched LIVE question in place (kept when burned/revealed/credited — a view rule;
      // the driver says which question the live slot holds now). It is the live question wherever the
      // cursor is: mid-browse the question on screen is a history one, and the live slot is the one
      // that changes. Nothing scored moves — the model's whole claim about a regen. (Only a question
      // nothing has judged is ever swapped, so its calendar is still to be taken either way.)
      live.q = ctx.liveAfter
      return
    }
    case 'OVERRIDE': {
      const t = refTarget(m)
      if (t === null) {
        m.violations.push('MODEL: OVERRIDE dispatched with nothing for the button to point at')
        return
      }
      const q = targetQuestion(m, t)
      const wasOverridden = q.overridden
      flip(q, action.tracking)
      // The one press that moves play on: the live question newly overridden to a credit, unheld.
      if (t === 'live' && !wasOverridden && credited(q) && !action.hold) advance(m, ctx.next)
      return
    }
    default:
      m.violations.push(`MODEL: unmodeled action ${kind}`)
  }
}

// A judged question's answer, by the model's own arithmetic — worked out ONCE per question and kept
// on the model's record of it. Neither thing it is made from can change afterwards: a question's
// calendar is taken once (judge), and only a question nothing has judged is ever swapped (REGEN).
// compareRefModel asks for it for every question in the history after every action, and working a
// weekday out afresh each time was a third of a whole reference-model profile's run time.
const modelAnswer = (q) => (q.answer ??= refAnswer(q.q, q.jul))

// One question's calendar, model against reducer: the calendar the reducer stamped on its card, and
// every answer that card's grid marks (its green, or the mark an Override leaves on the answer),
// against the model's own answer in the model's own calendar. `card` is the reducer's card as the
// harness hands it over: its record (`meta`, whose `jul` is the stamp) and its grid (`btns`).
// ★ A GRID ALREADY HELD TO THIS QUESTION'S ANSWER IS NOT WALKED AGAIN — and that leaves nothing
// unchecked. The walk reads two things, and neither can have changed since it passed: the model's
// answer is worked out once and kept (modelAnswer), and the grid is the SAME OBJECT, which the
// fuzz froze before this was first called on it (fuzzHarness freezes every state all the way down,
// so a grid that differs in any mark is a different object, and is walked). The question remembers
// the last grid that matched (`grid`); a grid that did not match is remembered by nobody, so it is
// reported again on every comparison until it is gone. The stamp is compared every time — it is one
// comparison. Before this, every mark of every card of the whole history was read again after
// every action — up to a seventh of a reference-model profile's whole run time (measured), spent
// re-proving what had not changed.
const compareCalendar = (v, where, q, card) => {
  const stamped = card.meta.jul
  if (q.jul !== stamped) v.push(`REF calendar: model ${q.jul}, reducer ${stamped} (${where})`)
  if (q.jul === undefined || q.grid === card.btns) return
  const answer = modelAnswer(q)
  let matched = true
  for (const k in card.btns)
    if ((card.btns[k] === 'correct' || card.btns[k] === 'override-wrong') && Number(k) !== answer) {
      v.push(`REF answer: model ${answer}, the reducer's grid marks ${k} (${where})`)
      matched = false
    }
  if (matched && card.btns) q.grid = card.btns
}

// The model's derived stats vs the reducer's. Returns violation strings (empty = agree).
// `plan` is the reducer's own answer to "what does the button point at, and does it read Undo"
// (overridePlan), compared against the model's independent answer. `cards` is the reducer's cards
// as the harness reads them off the state — `history` in play order, and the `live` one — each with
// a `meta` (whose `jul` is the calendar stamped on the card) and a `btns` (the grid it shows).
export function compareRefModel(m, state, plan, cards) {
  const v = [...m.violations]
  m.violations = []
  if (cards.history.length !== m.history.length)
    v.push(`REF history: model ${m.history.length} questions, reducer ${cards.history.length}`)
  else m.history.forEach((q, i) => compareCalendar(v, `question ${i + 1}`, q, cards.history[i]))
  compareCalendar(v, 'the live question', m.live, cards.live)
  const liveScored = m.live.ssFrozen === true
  // Fold the hydrated prior-session baseline in as a prefix of the credit sequence + the times pool
  // (the in-session ledger can't reconstruct it). Empty for a blank start → identical to before.
  const seq = [...m.priorHistory, ...m.history.map(credited)]
  if (liveScored) seq.push(credited(m.live))

  const played = m.priorHistory.length + m.history.length + (liveScored ? 1 : 0)
  const good = seq.filter(Boolean).length
  const times = [...m.priorTimes]
  for (const q of m.history) if (contribution(q) != null) times.push(contribution(q))
  if (liveScored && contribution(m.live) != null) times.push(contribution(m.live))

  // Longest + trailing credit runs, re-implemented inline (sharing nothing with the reducer).
  let best = 0
  let run = 0
  for (const c of seq) {
    run = c ? run + 1 : 0
    if (run > best) best = run
  }
  let trailing = 0
  for (let i = seq.length - 1; i >= 0 && seq[i]; i--) trailing++

  // The button: which question it means, and whether that question is overridden (it reads Undo).
  const t = refTarget(m)
  const reducerTarget = plan ? plan.target : null
  if (t !== reducerTarget) v.push(`REF target: model ${t}, reducer ${reducerTarget}`)
  else if (t !== null && targetQuestion(m, t).overridden !== plan.overridden)
    v.push(
      `REF overridden: model ${targetQuestion(m, t).overridden}, reducer ${plan.overridden} (${t})`,
    )

  const s = state.stats
  if (s.played !== played) v.push(`REF played: model ${played}, reducer ${s.played}`)
  if (s.good !== good) v.push(`REF good: model ${good}, reducer ${s.good}`)
  if (s.best !== best) v.push(`REF best: model ${best}, reducer ${s.best}`)
  // IN ORDER, not as a multiset: the model's questions sit in play order (the hydrated prefix, then
  // history, then the live question), and the reducer keeps its pool the same way — which is what
  // makes the pool's last entry, "Last" on every stat strip, the newest solve. A toggle that put a
  // time back at the end instead of in its question's place disagrees here (second review round, F4).
  if (times.length !== s.times.length || times.some((x, i) => x !== s.times[i]))
    v.push(`REF times: model [${times}], reducer [${s.times}]`)
  // The trailing streak is asserted only at a CLEAN live edge (not browsing, no miss on screen) —
  // mid-correction the displayed streak is transitional by design.
  if (m.cursor === 0 && !viewBurned(m.live) && !viewRevealed(m.live) && s.streak !== trailing)
    v.push(`REF streak: model ${trailing}, reducer ${s.streak}`)

  // ★ THE STATS AS THEY STOOD AFTER AN EARLIER QUESTION (the reducer's statsAtCard - what Amnesic's anchor
  // is corrected to when an Override changes a question from before its window): the model's own prefix
  // of the same ledger, every Override since applied, at the hydrated start, the newest question, and two
  // between - and nothing for a point before the hydrated start or past the newest.
  const prior = m.priorHistory.length
  const own = seq.length - prior
  for (const j of new Set([0, own >> 1, Math.max(0, own - 1), own])) {
    const got = statsAtCard(state, prior + j)
    const pre = seq.slice(0, prior + j)
    const preTimes = [...m.priorTimes]
    const asked = [...m.history, ...(liveScored ? [m.live] : [])].slice(0, j)
    for (const q of asked) if (contribution(q) != null) preTimes.push(contribution(q))
    let pBest = 0
    let pRun = 0
    for (const c of pre) {
      pRun = c ? pRun + 1 : 0
      if (pRun > pBest) pBest = pRun
    }
    const want = {
      played: prior + j,
      good: pre.filter(Boolean).length,
      streak: pRun,
      best: pBest,
      times: preTimes,
    }
    const seen = got && {
      played: got.played,
      good: got.good,
      streak: got.streak,
      best: got.best,
      times: got.times,
    }
    // (the streak at the newest question is the one the strip shows: transitional mid-correction, above)
    if (seen && j === own && !(m.cursor === 0 && !viewBurned(m.live) && !viewRevealed(m.live)))
      seen.streak = want.streak
    if (JSON.stringify(seen) !== JSON.stringify(want))
      v.push(
        `REF statsAtCard(${prior + j}): model ${JSON.stringify(want)}, reducer ${JSON.stringify(seen)}`,
      )
  }
  if (statsAtCard(state, prior - 1) !== null || statsAtCard(state, prior + own + 1) !== null)
    v.push('REF statsAtCard: a point outside the history gave stats')
  return v
}
