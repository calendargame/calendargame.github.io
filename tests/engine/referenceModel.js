// ─────────────────────────────────────────────────────────────────────────
// tests/engine/referenceModel.js — the fully-INDEPENDENT reference score model (C2 Part 3).
//
// A second, separately-written implementation of the game's SCORING CONTRACT that replays the same
// action stream as the reducer and computes the expected stats from its own per-question ledger —
// WITHOUT the reducer's stack/forwardStack, hasCredit flags, capsules, or snapshots. The fuzz
// (fuzzHarness.js, referenceModel profiles) compares the two after every action.
//
// WHY a second model when the strong oracle already cross-checks: the strong oracle reconstructs
// `good` from the reducer's own per-entry hasCredit flags — it catches aggregate-vs-flag DESYNCS
// (every bug so far) but would miss a state where the aggregate AND the flag are wrong TOGETHER
// (e.g. an override path crediting a question that semantically shouldn't credit, setting both).
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
//   • Everything else — per-question credit/burn/freeze state, the browse cursor, the override
//     target + effect, played/good/streak/best/times derivation — is modeled here from first
//     principles (the contract: How-to-Play + the characterization tests), sharing ZERO code with
//     the reducer (even the streak walk is re-implemented inline).
//
// THE MODEL: questions live in `history` (every question ADVANCED PAST that was scored, in order)
// plus the single `live` slot. Browsing is just a cursor (0 = the live edge; k = standing on
// history[length-k]) — entries never move (unlike the reducer's stack↔forwardStack shuffle).
// Stats are DERIVED, never maintained:
//   played = scored questions  ·  good = credited questions  ·  times = the credited solve times
//   best = the longest credit run in question order  ·  streak = the trailing run (clean edge only)
//
// Per-question scoring rules (the contract):
//   • A question is SCORED (counts a played) by its FIRST stat action — answer / Reveal / Show
//     Codes on the live question / per-question timeout — IF Save Stats was effectively on; that
//     first action FREEZES the question's Save-Stats (ssFrozen), so a later toggle can't re-score
//     or un-score it. One played per question, ever.
//   • It is CREDITED only by a clean first-try correct answer (never revealed/burned first), or by
//     an Override flip TO credited; an Override flip away removes the credit. One override per
//     question at a time — an Undo gives it back, and nothing else ever does (the driver's
//     availability gate enforces reachability; the model asserts it).
//   • Its TIME contribution exists only while credited: a first-try correct contributes its solve
//     time (when timing is tracked); an override-credit contributes the time of the original wrong
//     answer (when tracked); un-crediting removes the contribution.
//   • Only SCORED questions enter history on advance (an unscored question vanishes — it was never
//     played); LOCK_REVEAL resolves a question without scoring it.
//   • Advancing past a scored BURNED non-puzzle question arms the retroactive credit (Path 4).
//   • UNDO (round 23 Q6) reverses the most recent Override, and only while nothing else has happened
//     since: every other action forfeits it. The model does NOT snapshot itself to get there — a
//     snapshot/restore here would be the reducer's own mechanism written twice, and two copies of one
//     idea cannot disagree. Instead each Override path journals only the few facts its effect
//     DESTROYS (a credited time it removed, whether the burned question was also revealed/locked, the
//     armed retro credit, the live slot an advance replaced) and UNDO runs a hand-written INVERSE of
//     that path in the model's own vocabulary (un-flip the entry, pop the pushed question back into
//     the live slot, …). The reducer restores a capsule; the model re-derives the same position by
//     undoing its own moves. If the two ever land in different places, the ref profiles say so.
//
// OVERRIDE target selection mirrors the UI contract's priority (browse target → the held completing
// solve → the live burned question → the armed previous wrong → the most recent history entry); the
// EFFECTS are computed purely from the model's own ledger. Flip direction = the target's CURRENT
// credited state — equivalent to the reducer's snapshot.wasWrong on the reachable surface because a
// question carries at most one un-undone override.
// ─────────────────────────────────────────────────────────────────────────

const freshLive = (ded) => ({
  ded, //          the question is a Deduction puzzle (affects Path-4 arming only)
  ssFrozen: null, // the frozen effective Save-Stats (null = untouched; true = scored)
  credited: false,
  burned: false, //  answered wrong / revealed / codes-burned (the reducer's countedWrong)
  revealed: false,
  locked: false,
  held: false, //    a credited completing solve held on screen (AoX `complete`)
  // This question was the TARGET of an override (its credit was flipped) — spends its one
  // override forever. NOT the same as "an override was clicked while this question was live":
  // a retro flip (Path 5) clicked from a fresh live question targets the PREVIOUS question, and
  // the live one is still virgin when it later enters history (re-click blocking is the driver's
  // availability gate, a UI concern the model doesn't track).
  overridden: false,
  wrongTime: null, // the (first) wrong answer's solve time — the override-credit contribution
  time: null, //      the credited solve-time contribution (null = none)
})

export function createRefModel(initialDed, priorHistory = [], priorTimes = []) {
  return {
    history: [], // advanced-past SCORED questions, in order
    live: freshLive(initialDed),
    cursor: 0, // 0 = live edge; k>0 = browsing history[length-k]
    pendingWrong: false, // Path-4 armed for the LAST history entry
    violations: [], // model-detected protocol breaks (driver/model disagreement)
    // The hydrated prior-session baseline (the hydration net): a continuous mode (Classic/Flash/
    // Deduction) loads lifetime stats but NOT the history behind them. priorHistory = the prior
    // per-question credit flags (a prefix of the whole credit sequence); priorTimes = the prior
    // credited solve times. Folded into the DERIVED stats (compareRefModel) but never browsed or
    // overridden — the reducer's stack can't reach them either, so the cursor/flip logic ignores them.
    // Cleared by RESET (the engine re-inits blank). Empty for a blank/timed start (identical to before).
    priorHistory: priorHistory.slice(),
    priorTimes: priorTimes.slice(),
    // The pending Undo: the journal of the most recent Override (see the OVERRIDE case), or null.
    // Forfeited by every other action (the top of applyRefModel) — the model's own statement of the
    // "only while it is still the last thing you did" contract, compared against the reducer's.
    undo: null,
  }
}

// First stat action on the live question: freeze Save-Stats (scoring it if on).
const freeze = (m, saveStats) => {
  if (m.live.ssFrozen === null) m.live.ssFrozen = saveStats
}

// Advance past the live question: push it if SCORED (else it vanishes), arm/clear the Path-4
// retro credit, and load a fresh live slot. `overridden` marks a push that came from an Override
// path (the question's one override is spent).
const advance = (m, nextDed, overridden = false) => {
  m.cursor = 0
  if (m.live.ssFrozen === true) {
    const targeted = m.live.overridden || overridden
    m.history.push({
      ded: m.live.ded,
      credited: m.live.credited,
      time: m.live.time,
      wrongTime: m.live.wrongTime,
      burned: m.live.burned,
      overridden: targeted,
    })
    // The retro credit arms only for a wrong that was never itself the target of an override —
    // a reversed-away credit must not flip-flop back via Path 4 (one override per question).
    m.pendingWrong = m.live.burned && !m.live.ded && !targeted
  } else {
    m.pendingWrong = false
  }
  m.live = freshLive(nextDed)
}

// Flip a ledger entry's credit (an Override on it). Direction = its current state; the time
// contribution moves with the credit (tracked overrides only).
const flip = (m, entry, tracking) => {
  if (entry.overridden) m.violations.push('MODEL: override on an already-overridden question')
  if (entry.credited) {
    entry.credited = false
    entry.time = null
  } else {
    entry.credited = true
    entry.time = tracking && entry.wrongTime != null ? entry.wrongTime : null
  }
  entry.overridden = true
}

// The inverse of flip(): the credit goes back the way it was, and so does its time — a credit the
// flip took away gets back the time it had (journaled, because the flip destroyed it); a credit the
// flip granted leaves with its time. The entry's one override is unspent again (flip refuses an
// entry that was already overridden, so it cannot have been spent before).
const unflip = (entry, timeBefore) => {
  entry.credited = !entry.credited
  entry.time = entry.credited ? timeBefore : null
  entry.overridden = false
}

// The inverse of advance(): the question it pushed (only a SCORED one was pushed) comes back off
// history into the live slot it left, as the very object advance() replaced.
const unadvance = (m, liveBefore) => {
  if (liveBefore.ssFrozen === true) {
    const popped = m.history.pop()
    if (!popped || popped.ded !== liveBefore.ded)
      m.violations.push('MODEL: undo could not find the question the Override advanced past')
  }
  m.live = liveBefore
  m.cursor = 0
}

// Apply one driver action to the model. `ctx` carries the exogenous display facts:
//   isCorrect — ANSWER only: the clicked option matches the on-screen question.
//   nextDed   — advancing actions: whether the INCOMING question is a Deduction puzzle.
export function applyRefModel(m, kind, action, ctx) {
  const live = m.live
  // Anything that is not an Override or its Undo forfeits the pending Undo — including an action the
  // model treats as a no-op (a locked ANSWER, a BACK with nothing behind): the contract is about what
  // the player DID, not about whether it changed anything.
  if (kind !== 'OVERRIDE' && kind !== 'UNDO') m.undo = null
  switch (kind) {
    case 'ANSWER': {
      if (m.cursor > 0 || live.locked) return // browsing locks the view; a locked question is resolved
      if (ctx.isCorrect) {
        if (!live.burned) {
          freeze(m, action.saveStats)
          if (live.ssFrozen === true) {
            live.credited = true
            live.time = action.elapsed != null && action.tracking ? action.elapsed : null
          }
          if (action.complete) {
            // AoX's Nth solve: credit but HOLD — stays on screen, locked, reversible.
            live.held = true
            live.locked = true
            return
          }
          advance(m, ctx.nextDed)
        } else {
          // Late correct on a burned question: no credit, just move on.
          advance(m, ctx.nextDed)
        }
      } else {
        // Wrong: score it (first touch), break the streak (derived), stay on the question.
        if (!live.burned) {
          freeze(m, action.saveStats)
          live.wrongTime = action.elapsed
        }
        live.burned = true
        m.pendingWrong = false // answering the next question forfeits the retro credit
      }
      return
    }
    case 'REVEAL': {
      if (m.cursor > 0 || live.locked) return // browsing reveal is read-only; locked is resolved
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
      // Read-only review whenever the question is already resolved: browsing, a held completing
      // solve, or an already-revealed answer. Otherwise it's the peek penalty (a scored miss).
      if (m.cursor > 0 || live.held || live.revealed) return
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
      // and locks; an unscored question later vanishes instead of entering history.
      live.locked = true
      live.revealed = true
      return
    }
    case 'TIMEOUT_MISS': {
      // A per-question timeout: a scored miss (one played, first touch only) + resolved. No
      // override path opens (it is not a burn), and the armed retro credit is forfeited.
      if (live.locked) return
      if (!live.burned) freeze(m, action.saveStats)
      live.revealed = true
      live.locked = true
      live.held = false
      m.pendingWrong = false
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
      m.pendingWrong = false
      m.priorHistory = [] // a full Reset re-inits the engine blank — the hydrated baseline is gone too
      m.priorTimes = []
      return
    }
    case 'REGEN': {
      // Swaps an untouched live date in place (kept when burned/revealed — a view rule; the screen
      // says what's displayed now). Browsing never regenerates, and the on-screen date mid-browse
      // is the BROWSED entry — only sync the live slot's identity at the live edge.
      if (m.cursor === 0) live.ded = ctx.liveDedAfter
      return
    }
    case 'OVERRIDE': {
      const tracking = action.tracking
      // One Undo at a time: the button reads Undo whenever one is pending, so an Override on top of
      // one is a driver/contract break.
      if (m.undo) m.violations.push('MODEL: OVERRIDE dispatched while an Undo is pending')
      // Priority mirrors the UI contract; effects are the model's own. Each path journals into
      // m.undo only what its effect destroys — the inverse lives in the UNDO case.
      if (m.cursor > 0) {
        // Path 1 — flip the browsed entry.
        const entry = m.history[m.history.length - m.cursor]
        m.undo = { path: 1, entry, time: entry.time }
        flip(m, entry, tracking)
        return
      }
      if (live.held) {
        // Path 2 — reverse the held completing solve: the credit (and its time) is retracted and
        // the question becomes a burned wrong. It stays on screen when the run fails (noAdvance)
        // or when timing is off; otherwise play moves on.
        m.undo = { path: 2, live, time: live.time, pendingWrong: m.pendingWrong, advanced: false }
        live.credited = false
        live.time = null
        live.burned = true
        live.held = false
        live.overridden = true
        if (action.noAdvance || action.timingOff) {
          live.locked = false
          live.revealed = false
        } else {
          advance(m, ctx.nextDed, true)
          m.undo.advanced = true
        }
        return
      }
      if (live.burned) {
        // Path 3 — credit the live wrong (with the wrong answer's time when tracked).
        m.undo = {
          path: 3,
          live,
          revealed: live.revealed,
          locked: live.locked,
          pendingWrong: m.pendingWrong,
          advanced: false,
        }
        live.credited = true
        live.time = tracking && live.wrongTime != null ? live.wrongTime : null
        live.burned = false
        live.revealed = false
        m.pendingWrong = false // the credit consumed this question's correction
        // AoX completing solve via Override (noAdvance, on a scored question): HOLD the credit on
        // screen — locked + reversible — instead of advancing, exactly like an ANSWER `complete`. So
        // an Ao-N finished via Reveal+Override completes ON the Nth question, not a phantom Nth+1.
        // (Path 3 is only reachable when the question is scored, so ssFrozen is true here.)
        if (action.noAdvance && live.ssFrozen === true) {
          live.held = true
          live.locked = true
          return
        }
        advance(m, ctx.nextDed, true)
        m.undo.advanced = true
        return
      }
      const last = m.history[m.history.length - 1]
      if (m.pendingWrong && last && !last.overridden) {
        // Path 4 — retroactively credit the previous wrong; with timing on, play also moves on
        // (the fresh live question advances — unscored, so it vanishes).
        m.undo = { path: 4, entry: last, live, advanced: !action.timingOff }
        flip(m, last, tracking)
        m.pendingWrong = false
        if (!action.timingOff) advance(m, ctx.nextDed, false)
        return
      }
      if (last && !last.overridden) {
        // Path 5 — retro-flip the most recent history entry. The LIVE question is untouched: the
        // flip targets the previous question, so the live one keeps its own (unspent) override.
        m.undo = { path: 5, entry: last, time: last.time }
        flip(m, last, tracking)
        return
      }
      m.violations.push('MODEL: OVERRIDE dispatched but no model path matched')
      return
    }
    case 'UNDO': {
      // The hand-written inverse of whichever path the journaled Override took (see the header).
      const u = m.undo
      m.undo = null
      if (!u) {
        m.violations.push('MODEL: UNDO dispatched with no Override to undo')
        return
      }
      if (u.path === 1 || u.path === 5) {
        unflip(u.entry, u.time)
      } else if (u.path === 2) {
        // Back onto the held completing solve: credited again with the time it had, locked, not
        // revealed (a held solve is never revealed — Reveal and Show Codes are read-only on it).
        if (u.advanced) unadvance(m, u.live)
        const l = u.live
        l.credited = true
        l.time = u.time
        l.burned = false
        l.held = true
        l.overridden = false
        l.locked = true
        l.revealed = false
        m.pendingWrong = u.pendingWrong
      } else if (u.path === 3) {
        // Back onto the burned question, uncredited — revealed/locked exactly as the burn left it.
        if (u.advanced) unadvance(m, u.live)
        const l = u.live
        l.credited = false
        l.time = null
        l.burned = true
        l.held = false
        l.revealed = u.revealed
        l.locked = u.locked
        m.pendingWrong = u.pendingWrong
      } else {
        // Path 4 — the previous wrong loses its retro credit and the retro credit is armed again; if
        // play had moved on, the live question it moved past comes back (unscored, never pushed).
        unflip(u.entry, null)
        m.pendingWrong = true
        if (u.advanced) unadvance(m, u.live)
      }
      return
    }
    default:
      m.violations.push(`MODEL: unmodeled action ${kind}`)
  }
}

// The model's derived stats vs the reducer's. Returns violation strings (empty = agree).
export function compareRefModel(m, state) {
  const v = [...m.violations]
  m.violations = []
  const liveScored = m.live.ssFrozen === true
  // Fold the hydrated prior-session baseline in as a prefix of the credit sequence + the times pool
  // (the in-session ledger can't reconstruct it). Empty for a blank start → identical to before.
  const seq = [...m.priorHistory, ...m.history.map((e) => e.credited)]
  if (liveScored) seq.push(m.live.credited)

  const played = m.priorHistory.length + m.history.length + (liveScored ? 1 : 0)
  const good = seq.filter(Boolean).length
  const times = [
    ...m.priorTimes,
    ...m.history.filter((e) => e.credited && e.time != null).map((e) => e.time),
    ...(m.live.credited && m.live.time != null ? [m.live.time] : []),
  ]

  // Longest + trailing credit runs, re-implemented inline (sharing nothing with the reducer).
  let best = 0
  let run = 0
  for (const c of seq) {
    run = c ? run + 1 : 0
    if (run > best) best = run
  }
  let trailing = 0
  for (let i = seq.length - 1; i >= 0 && seq[i]; i--) trailing++

  const s = state.stats
  // Undo availability, derived by the model from its own forfeit rule, against the reducer's capsule.
  if (!!m.undo !== (state.undoCapsule != null))
    v.push(
      `REF undo: model ${m.undo ? 'pending' : 'none'}, reducer ${state.undoCapsule ? 'pending' : 'none'}`,
    )
  if (s.played !== played) v.push(`REF played: model ${played}, reducer ${s.played}`)
  if (s.good !== good) v.push(`REF good: model ${good}, reducer ${s.good}`)
  if (s.best !== best) v.push(`REF best: model ${best}, reducer ${s.best}`)
  const a = [...times].sort((x, y) => x - y)
  const b = [...s.times].sort((x, y) => x - y)
  if (a.length !== b.length || a.some((t, i) => t !== b[i]))
    v.push(`REF times: model [${a}], reducer [${b}]`)
  // The trailing streak is asserted only at a CLEAN live edge (not browsing, no pending miss on
  // screen) — mid-correction the displayed streak is transitional by design.
  if (m.cursor === 0 && !m.live.burned && !m.live.revealed && s.streak !== trailing)
    v.push(`REF streak: model ${trailing}, reducer ${s.streak}`)
  return v
}
