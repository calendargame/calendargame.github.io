// ─────────────────────────────────────────────────────────────────────────
// tests/engine/referenceModel.js — the fully-INDEPENDENT reference score model (C2 Part 3).
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
// question identity, never scoring state:
//   • per ANSWER, `isCorrect` (does the clicked option match the on-screen question — date math,
//     separately proven by the date-gen fuzz + invariants);
//   • per advancing/reset/regen action, whether the question now on screen is a Deduction puzzle
//     (`nextDed` from the action's nextDate / `liveDedAfter` from the screen — which date survives
//     a Reset/regen is a VIEW rule about the displayed question, so the model reads the outcome
//     rather than re-deriving keep-vs-replace nuances).
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
//   • ★ THE OVERRIDE, IN THIS MODEL'S OWN VOCABULARY (round 23 Q6): each question keeps the facts of
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
//     recent history question. A press on the live question moves play on only when it credits a
//     question that was not overridden and the driver did not ask to hold (`hold`); nothing else
//     ever moves, and an Undo never does.
//   • An overridden live question is resolved on screen: locked either way, and when the override
//     took its credit away, the answer is shown and it counts as burned. Its as-answered flags are
//     still there underneath, untouched, for the Undo to fall back onto.
//   • Only SCORED questions enter history on advance (an unscored question vanishes — it was never
//     played); LOCK_REVEAL resolves a question without scoring it.
// ─────────────────────────────────────────────────────────────────────────

const freshLive = (ded) => ({
  ded, //          the question is a Deduction puzzle (a display fact; kept for the push)
  ssFrozen: null, // the frozen effective Save-Stats (null = untouched; true = scored)
  // ── how it was ANSWERED (never touched by an Override) ──
  aCredited: false, // a clean first-try correct that counted
  aTime: null, //     that answer's recorded solve time (null = none)
  wrongTime: null, // the (first) miss's solve time — what an overridden credit contributes
  burned: false, //   answered wrong / revealed / codes-burned (the reducer's countedWrong)
  revealed: false,
  locked: false,
  held: false, //     a correct answer held on screen (AoX `complete`)
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

export function createRefModel(initialDed, priorHistory = [], priorTimes = []) {
  return {
    history: [], // advanced-past SCORED questions, in order
    live: freshLive(initialDed),
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

// Advance past the live question: push it if SCORED (else it vanishes) and load a fresh live slot.
// The pushed question keeps everything the Override needs — how it was answered and its bit.
const advance = (m, nextDed) => {
  m.cursor = 0
  const l = m.live
  if (l.ssFrozen === true) {
    m.history.push({
      ded: l.ded,
      aCredited: l.aCredited,
      aTime: l.aTime,
      wrongTime: l.wrongTime,
      overridden: l.overridden,
      oTime: l.oTime,
    })
  }
  m.live = freshLive(nextDed)
}

// Which question the one button means — the model's own reading (see the header). Returns
// 'browsed' | 'live' | 'retro' | null, the same vocabulary the reducer's selector uses, so the
// harness can compare the two answers directly.
export function refTarget(m) {
  if (m.cursor > 0) return 'browsed'
  const l = m.live
  if (l.ssFrozen === true && (l.burned || l.aCredited || l.overridden)) return 'live'
  return m.history.length ? 'retro' : null
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
//   isCorrect — ANSWER only: the clicked option matches the on-screen question.
//   nextDed   — advancing actions: whether the INCOMING question is a Deduction puzzle.
export function applyRefModel(m, kind, action, ctx) {
  const live = m.live
  switch (kind) {
    case 'ANSWER': {
      if (m.cursor > 0 || viewLocked(live)) return // browsing locks the view; a locked question is resolved
      if (ctx.isCorrect) {
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
        advance(m, ctx.nextDed)
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
      advance(m, ctx.nextDed)
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
      // locked question (an overridden one included) is left exactly as it is.
      if (viewLocked(live)) return
      live.locked = true
      live.revealed = true
      return
    }
    case 'TIMEOUT_MISS': {
      // A per-question timeout: a scored miss (one played, first touch only) + resolved. It does not
      // burn the question, so it gives the Override nothing to point at on it.
      if (viewLocked(live)) return
      if (!live.burned) freeze(m, action.saveStats)
      live.revealed = true
      live.locked = true
      live.held = false
      return
    }
    case 'RESET': {
      // Which date survives a Reset (keep-vs-regenerate) is a VIEW rule about the on-screen
      // question — display plumbing, not scoring — so the model takes the answer from the screen
      // (ctx.liveDedAfter) rather than re-deriving it. (The 50× sweep proved the point: two
      // hand-modeled regen rules in a row desynced on browse-view nuances the reducer reads live.)
      m.history = []
      m.live = freshLive(ctx.liveDedAfter)
      m.cursor = 0
      m.priorHistory = [] // a full Reset re-inits the engine blank — the hydrated baseline is gone too
      m.priorTimes = []
      return
    }
    case 'REGEN': {
      // Swaps an untouched live date in place (kept when burned/revealed/credited — a view rule; the
      // screen says what's displayed now). Browsing never regenerates, and the on-screen date
      // mid-browse is the BROWSED entry — only sync the live slot's identity at the live edge.
      if (m.cursor === 0) live.ded = ctx.liveDedAfter
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
      if (t === 'live' && !wasOverridden && credited(q) && !action.hold) advance(m, ctx.nextDed)
      return
    }
    default:
      m.violations.push(`MODEL: unmodeled action ${kind}`)
  }
}

// The model's derived stats vs the reducer's. Returns violation strings (empty = agree).
// `plan` is the reducer's own answer to "what does the button point at, and does it read Undo"
// (overridePlan), compared against the model's independent answer.
export function compareRefModel(m, state, plan) {
  const v = [...m.violations]
  m.violations = []
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
  const a = [...times].sort((x, y) => x - y)
  const b = [...s.times].sort((x, y) => x - y)
  if (a.length !== b.length || a.some((x, i) => x !== b[i]))
    v.push(`REF times: model [${a}], reducer [${b}]`)
  // The trailing streak is asserted only at a CLEAN live edge (not browsing, no miss on screen) —
  // mid-correction the displayed streak is transitional by design.
  if (m.cursor === 0 && !viewBurned(m.live) && !viewRevealed(m.live) && s.streak !== trailing)
    v.push(`REF streak: model ${trailing}, reducer ${s.streak}`)
  return v
}
