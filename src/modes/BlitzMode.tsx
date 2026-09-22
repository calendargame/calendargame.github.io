// BlitzMode — the countdown screen: Per Round and Per Question timing, the Allow Mistakes
// sudden-death variant, and Best Score/Streak with round-id rollback. Extracted verbatim from
// main.tsx (Q1 phase 1); it was already a module-level sibling of App taking everything through
// props, so nothing about its behaviour changes by living here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ModeProps, FmtDate, GenDate } from './modeTypes.js'
import { useButtonFlash, usePlayClock } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import { RESET_BTN_CLASS } from '../components/controlClasses.js'
import {
  fmtTime,
  truncTime,
  fmtBlitzT,
  fmtAccuracyPct,
  SLIDER_READOUT_WIDEST,
} from '../lib/modeFormat.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import RunBreakdown from '../components/RunBreakdown.jsx'
import CardNumber from '../components/CardNumber.jsx'
import OverrideButton from '../components/OverrideButton.jsx'
import SliderValueEditor from '../components/SliderValueEditor.jsx'
import BlitzBestRow from '../components/BlitzBestRow.jsx'
import { NewBestStar } from '../components/primitives.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { calcAvg, calcLast, calcMed } from '../engine/stats.js'
import { buildRunBreakdown } from '../engine/runBreakdown.js'
import { reconcileBlitzBest, reconcileSuddenBest } from '../engine/blitzBest.js'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import type { BlitzBest, SuddenBest } from '../store/progress.js'
import { useUserDefaults, effectivePrefDefaults } from '../store/userDefaults.js'
import { useGameEngine, withoutPendingUndo } from '../engine/useGameEngine.js'
import type { GameState } from '../engine/gameReducer.js'
import { usePresets } from '../store/presets.js'
import { readSessionRound, writeSessionRound, discardSessionRound } from '../store/sessionRound.js'
import { useBackButton } from '../components/useBackButton.js'

// The Best records that stood BEFORE the current round (snapshotted at Begin) — the reconcile
// floor and the Override-resume revert target. Named so the ref below and the round snapshot
// (round-21 Q11) share one shape.
interface PrevRoundBest {
  blitzBk: string
  suddenBk: string
  blitz?: BlitzBest
  sudden?: SuddenBest
  suddenAm?: BlitzBest
}

// The "new best ★" markers that stood BEFORE the current round, for the same config keys — the ★
// half of PrevRoundBest (see prevRoundStarsRef for why it is a separate snapshot).
interface PrevRoundStars {
  blitz?: { score: boolean; streak: boolean }
  sudden?: boolean
  suddenAm?: { score: boolean; streak: boolean }
}

// Set (or, with nothing lit, drop) one config's ★ markers — returning the SAME map when nothing
// changes, so a reconcile that lands where it already was is not a re-render.
function setStars<T>(map: Record<string, T>, key: string, stars: T | null): Record<string, T> {
  if (stars === null) {
    if (!(key in map)) return map
    const nx = { ...map }
    delete nx[key]
    return nx
  }
  if (JSON.stringify(map[key]) === JSON.stringify(stars)) return map
  return { ...map, [key]: stars }
}

// A score+streak record's ★ markers after a reconcile: each lit if it was lit before the round, or if
// the round's record now beats the pre-round record — nothing else can have raised it, because the
// config (the key) is locked while a round exists. null = neither lit (the key is dropped).
function roundStars(
  before: { score: boolean; streak: boolean } | undefined,
  next: BlitzBest,
  floor: BlitzBest | undefined,
): { score: boolean; streak: boolean } | null {
  const score = !!before?.score || next.score > (floor?.score ?? 0)
  const streak = !!before?.streak || next.streak > (floor?.streak ?? 0)
  return score || streak ? { score, streak } : null
}

// Round-21 Q11 — the shape BlitzMode parks in store/sessionRound for an ENDED round. It round-trips
// its own engine state plus the component fields the completed view (and a post-round Override)
// need; store/sessionRound never looks inside it. `currentRoundId` + `prevRoundBest` are what keep
// the Best-reconcile / Override-rollback correct on a restored round — without them a later Override
// that drops the round's score could leave a fabricated Best standing, or wipe a legitimate one.
// `remain` is the round's clock as it stopped — what an Override that rescues the restored round
// resumes from (Per Round) and what its readout shows. OPTIONAL because a blob parked by an earlier
// build has none; such a round restores with the configured round length, which is what every build
// before this one showed on that readout anyway.
interface BlitzRoundSnapshot {
  engine: GameState
  timerDone: boolean
  showTimerDate: boolean
  active: boolean
  currentRoundId: number | null
  prevRoundBest: PrevRoundBest
  remain?: number
}

// ============================================================
// BlitzMode — the Blitz game mode on the shared engine (mode-untangle Step 3).
//
// Self-contained + always-mounted. KEY INSIGHT: App resets stats on every blitz Begin,
// so the engine `S` already IS the round score — Blitz needs NO reducer changes. BlitzMode
// = the engine + a countdown (Per Round `blitzSec` / Per Question `qSec`) + Best Score/
// Streak tracking. Begin = engine.resetStats() (fresh round) + start timer; answering uses
// the engine; a round ends on the clock or on a wrong with Allow Mistakes off (either
// timing sub-mode — the two toggles are fully independent, C3a). Best is reconciled in an
// effect when a round ends (set to max, tagged with the round id) and ROLLED BACK there
// too when an Override drops the round that set it.
// ============================================================
function BlitzMode({
  visible,
  genDate,
  minY,
  maxY,
  useJulian,
  saveStats,
  dateFormat,
  randomFormat,
  inputStyle = 'buttons',
  dotOrientation = 'columns',
  leapChance,
  janFebChance,
  julianChance,
  fmtDate,
  settingsOpen,
  clockPaused,
  onFreshChange,
}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }) {
  const perQ = useModePrefs((s) => s.blitzPerQ),
    setPerQ = useModePrefs((s) => s.setBlitzPerQ) // persisted (mode-prefs store)
  const allowMistakes = useModePrefs((s) => s.blitzAllowMistakes),
    setAllowMistakes = useModePrefs((s) => s.setBlitzAllowMistakes) // persisted (mode-prefs store)
  const timingOff = useModePrefs((s) => s.blitzTimingOff),
    setTimingOff = useModePrefs((s) => s.setBlitzTimingOff) // persisted; VISUAL-ONLY (Q8) — blanks the timing trio, the engine clock never stops (no arm/reset)
  // Round-21 Q11 — the ended round this (preset, mode) parked before its last unmount, read EXACTLY
  // ONCE at mount. On a preset switch the always-mounted screens remount (src/main.tsx
  // remountScreens) and usePresets' activeId is ALREADY the INCOMING preset by the time this runs —
  // switchPreset writes the registry before it rehydrates the stores, one synchronous turn
  // (store/presetControl). So this is the incoming preset's OWN parked round and never the one just
  // left; the preset-id key is the whole contamination guard (a blob keyed to preset 1 is
  // unreachable while preset 2 is up). Factored into one read so the six initializers below don't
  // each call sessionStorage.
  const [parkedRound] = useState<BlitzRoundSnapshot | null>(() =>
    readSessionRound<BlitzRoundSnapshot>(usePresets.getState().activeId, 'blitz'),
  )
  // Only ENDED rounds are ever parked, so a restored round always has active === false; it is read
  // from the blob for symmetry rather than assumed.
  const [active, setActive] = useState(parkedRound?.active ?? false)
  const [timerDone, setTimerDone] = useState(parkedRound?.timerDone ?? false)
  const [breakdownOpen, setBreakdownOpen] = useState(false) // the round breakdown popup (components/RunBreakdown) — ephemeral, dies with the round
  const [showTimerDate, setShowTimerDate] = useState(parkedRound?.showTimerDate ?? false)
  const blitzSec = useModePrefs((s) => s.blitzSec),
    setBlitzSec = useModePrefs((s) => s.setBlitzSec) // persisted (mode-prefs store)
  const qSec = useModePrefs((s) => s.blitzQSec),
    setQSec = useModePrefs((s) => s.setBlitzQSec) // persisted (mode-prefs store)
  // `clockRemainRef` — the running sub-mode's remaining seconds as last drawn (the countdown writes it
  // every frame), as STAMPED when the round ended, or as PARKED with an ended round (round 22's fixer:
  // the park used to omit it, so a restored Per Round round that an Override rescued resumed with a
  // hard-coded 60 s whatever its length and whatever it had left). One ref serves both sub-modes
  // because Per Round / Per Question is idle-locked: it cannot change while there is a round for the
  // value to belong to. With nothing parked, the configured length is the honest starting value.
  const blitzStartRef = useRef<number | null>(null),
    blitzPausedAtRef = useRef<number | null>(null),
    blitzPausedAccRef = useRef(0),
    clockRemainRef = useRef(parkedRound?.remain ?? (perQ ? qSec : blitzSec))
  const blitzBarRef = useRef<HTMLSpanElement | null>(null),
    blitzTimeRef = useRef<HTMLSpanElement | null>(null)
  const qDeadlineRef = useRef<number | null>(null),
    qPausedAtRef = useRef<number | null>(null),
    qPausedAccRef = useRef(0)
  const suddenBarRef = useRef<HTMLSpanElement | null>(null),
    suddenTimeRef = useRef<HTMLSpanElement | null>(null)
  // Blitz all-time bests persist across reloads (Stage D1): from the progress store — per-round
  // (blitzBest), per-Q sudden death (suddenBest), and per-Q + Allow Mistakes (suddenAmBest, C3a).
  // (The "new best ★" markers below stay local — they're per-session UI, not persisted.)
  const blitzBest = useProgress((s) => s.blitzBest),
    setBlitzBest = useProgress((s) => s.setBlitzBest)
  const suddenBest = useProgress((s) => s.suddenBest),
    setSuddenBest = useProgress((s) => s.setSuddenBest)
  const suddenAmBest = useProgress((s) => s.suddenAmBest),
    setSuddenAmBest = useProgress((s) => s.setSuddenAmBest)
  const [blitzBestNew, setBlitzBestNew] = useState<
      Record<string, { score: boolean; streak: boolean }>
    >({}),
    [suddenBestNew, setSuddenBestNew] = useState<Record<string, boolean>>({})
  const [suddenAmBestNew, setSuddenAmBestNew] = useState<
    Record<string, { score: boolean; streak: boolean }>
  >({})
  // Restored from the parked round (round-21 Q11) so the Best-reconcile effect's same-round rollback
  // still recognises THIS round after a remount — a null id there makes `cur.scoreRoundId === roundId`
  // false, so a post-restore Override that drops the score would fail to roll a fabricated Best back.
  // nextRoundIdRef is pushed past the restored id so the next Begin cannot reuse it within this mount.
  const currentRoundIdRef = useRef<number | null>(parkedRound?.currentRoundId ?? null),
    nextRoundIdRef = useRef(Math.max(1, (parkedRound?.currentRoundId ?? 0) + 1))
  // The FULL Best records that stood BEFORE the current round (snapshotted at Begin), serving two
  // jobs from one snapshot: (a) the reconcile's cross-round rollback FLOOR — a later Override that
  // drops THIS round's score must not pull Best below the earlier round it overwrote (mirrors
  // AoX's prevBestSnapRef; C2 — cross-round Best rollback); (b) the resume-REVERT — when an
  // Override credits a misclick and RESUMES the round, the Best the interrupted round provisionally
  // saved is rolled back wholesale to these records (it re-saves only when the round genuinely
  // ends). (C2 Q2-A.)
  // Restored from the parked round (round-21 Q11): a resume via Override reverts the interrupted
  // round's provisional Best to THESE records, so after a remount they have to be the real pre-round
  // records and not the `{blitzBk:'',…}` fresh-mount stub — otherwise resumeRound would `delete`
  // the wrong (empty) key and leave a legitimate Best in place, or drop one that should stand.
  const prevRoundBestRef = useRef<PrevRoundBest>(
    parkedRound?.prevRoundBest ?? { blitzBk: '', suddenBk: '' },
  )
  // …and the ★ markers that stood with those records, snapshotted at the same Begin. A ★ is keyed by
  // CONFIG, not by round, so it cannot simply be cleared when a round's record rolls back — that would
  // wipe a ★ an EARLIER round legitimately earned under the same config. It is restored the way the
  // record is: a round's ★ is exactly "the pre-round ★, or this round beat the pre-round record".
  // Kept OUT of PrevRoundBest (which store/sessionRound parks) on purpose: the ★ markers themselves
  // are per-mount state that a remount wipes, so a parked copy would resurrect stars the remount had
  // already cleared. A restored round starts with no ★ floor, exactly matching its empty ★ maps.
  const prevRoundStarsRef = useRef<PrevRoundStars>({})
  // saveStats:true ALWAYS (like AoX): the round tracks internally regardless of the global Save
  // Stats toggle, which now gates only the DISPLAY (a dimmed strip of "—"), whether a Best is recorded,
  // and whether Override shows while off. Always-tracking keeps the misclick-rescue credit
  // integrity-safe in practice mode (good ≤ played — played is always incremented on the wrong),
  // so an unscored question can't hit the good>played landmine. (C2 Q2-B; was `saveStats`.)
  const eng = useGameEngine({
    label: 'blitz',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats: true,
    timingOff: false,
    // Round-21 Q11 — seed the reducer from the parked ended round when there is one (a getter, read
    // once in the lazy init). `parkedRound` was keyed to the ACTIVE preset at mount, so this only
    // ever restores the incoming preset's own round and cannot pull in the one just left.
    getInitialState: () => parkedRound?.engine ?? null,
  }) // Blitz: timing always tracked
  const { state, correct, overrideAvail: engOverrideAvail, undoAvail } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode (Q1). Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/useBackButton.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const S = state.stats
  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse

  // A round ended by a player ACTION (not the clock) is RESUMABLE via Override — credit the
  // resolved question + continue. countedWrong is set by a wrong answer, a Reveal, OR a Show
  // Codes; a TIMER end on a pristine question (LOCK_REVEAL / TIMEOUT_MISS) does NOT set it, so
  // the clock simply running out is correctly NOT resumable. One deliberate corner (per-Q +
  // Allow Mistakes, C3a): a wrong answer leaves the round running with countedWrong SET, so a
  // timeout on that burned question ends the round with countedWrong still true — that end IS
  // resumable (crediting the wrong resumes with a fresh question clock, exactly what a
  // judged-correct answer would have granted before the expiry; owner-ratified). So "reveal or
  // show codes then override" continues the round, same as a misclick (owner's call, C2 —
  // override is uniform). The resume reverts the interrupted round's provisionally-saved Best
  // (see resumeRound). One source of truth for both the resume (onOverride) and any
  // round-end-resumable check.
  const resumableEnd = timerDone && state.countedWrong
  // Override availability is uniform — NOT gated on the live `saveStats` (owner's call, C2: gating
  // it made Override more forgiving when Save Stats is ON than OFF, which is backwards). Blitz
  // always-tracks internally (saveStats:true above), so engOverrideAvail (which uses the frozen
  // effective save-stats, always true here) is correct in both states; the credit is just
  // invisible in practice mode (stats dimmed, no Best recorded).
  const overrideAvail = engOverrideAvail

  // The per-config Best silo keys. blitzBk leads with an m/n Allow-Mistakes marker (both
  // per-round variants share the one blitzBest map); suddenBk has NO AM segment — for
  // per-question, AM-ness is the MAP split (suddenBest = sudden death, suddenAmBest = Allow
  // Mistakes on, C3a), because the two record shapes differ (score-only vs score+streak).
  const blitzBk = `${allowMistakes ? 'm' : 'n'}${blitzSec}|${randomFormat ? 'random' : dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`
  const suddenBk = `${qSec}|${randomFormat ? 'random' : dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`

  const resetTimerBars = () => {
    if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
    if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
  }
  const stopRound = () => {
    blitzStartRef.current = null
    blitzPausedAtRef.current = null
    blitzPausedAccRef.current = 0
    qDeadlineRef.current = null
    qPausedAtRef.current = null
    qPausedAccRef.current = 0
  }
  // The running sub-mode's remaining seconds at `now`, from the clock refs (pause accumulators
  // included), or null when no clock is armed. The ONE copy of each countdown formula: the frame
  // loop draws from it, endRound stamps from it, and an Override notes it for its Undo.
  const clockRemainAt = (now: number): number | null => {
    if (!perQ)
      return blitzStartRef.current == null
        ? null
        : Math.max(0, blitzSec - (now - blitzStartRef.current - blitzPausedAccRef.current) / 1000)
    return qDeadlineRef.current == null
      ? null
      : Math.max(0, (qDeadlineRef.current + qPausedAccRef.current - now) / 1000)
  }
  // Draw `r` remaining seconds on the running sub-mode's bar + readout (and keep clockRemainRef in
  // step). Direct DOM writes, like every frame of the countdown — a React render per frame would be
  // the expensive way to move one bar.
  const paintClock = (r: number) => {
    clockRemainRef.current = r
    if (!perQ) {
      const sx = Math.max(0, Math.min(1, r / blitzSec))
      if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(' + sx + ')'
      if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(r)
    } else {
      const sx = qSec > 0 ? Math.max(0, Math.min(1, r / qSec)) : 1
      if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(' + sx + ')'
      if (suddenTimeRef.current) suddenTimeRef.current.textContent = Math.ceil(r) + 's'
    }
  }
  // A restored ended round shows the clock it stopped on — the readout and bar it had before the
  // switch — rather than the full length the markup renders. A layout effect so the first paint is
  // already right. Mount-only: after this, every change to the clock is drawn by the code that makes it.
  useLayoutEffect(() => {
    if (parkedRound) paintClock(clockRemainRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design (see above)
  }, [])
  // The round-over state with the clock stopped — the ONE writer of `timerDone = true`. endRound is
  // how play reaches it; the only other caller is an Undo putting back a round an Override resumed,
  // which must NOT restamp the remaining from the resumed clock (it restores the stamp it noted).
  const settleEnded = () => {
    setActive(false)
    setShowTimerDate(true)
    setTimerDone(true)
    stopRound()
  }
  const endRound = () => {
    // Stamp the EXACT remaining time at this instant into clockRemainRef BEFORE settleEnded() nulls
    // the clock refs, so a later Override-resume (Per Round) continues from the true remaining rather
    // than the last rAF frame's value (up to a frame stale, always in the player's favor), and an Undo
    // that re-ends a resumed round can put back the readout this ending left. On a clock-expiry end
    // the remaining is already ~0. (F: Blitz resume sub-frame timer drift.)
    const r = clockRemainAt(performance.now())
    if (r != null) clockRemainRef.current = r
    settleEnded()
  }

  // Countdown loop (Per Round drains the round clock; Per Question drains the question clock). On 0
  // the round ends — per-round timeout shows the answer with no stat (lockReveal); per-Q timeout
  // counts a miss (timeoutMiss). Gated off while the rotate-back overlay pauses the clock (Q11) so
  // the round can't drain — or expire — behind the overlay.
  useEffect(() => {
    if (!active || clockPaused) return
    let raf = 0
    const loop = () => {
      const r = clockRemainAt(performance.now())
      if (r != null) {
        paintClock(r)
        if (r <= 0.001) {
          if (!perQ) eng.lockReveal()
          else eng.timeoutMiss()
          endRound()
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clockRemainAt / paintClock / endRound are behavior-stable (they close over only the deps listed, stable setters and refs); excluded so their identity change doesn't restart the countdown
  }, [active, perQ, blitzSec, qSec, eng, clockPaused])

  // Rotate-overlay clock freeze (Q11). The countdown math above ALREADY carries pause
  // bookkeeping — blitzPausedAcc is subtracted from the round's elapsed, qPausedAcc extends
  // the question deadline (designed in with the clocks, dormant until now) — and this effect
  // is what engages it: while the rotate-back overlay covers the app (clockPaused), stamp the
  // pause start; on rotate-back (the cleanup) fold the paused span into the accumulators so
  // both clocks resume exactly where they stopped. The rAF loop is gated off while paused
  // (nothing visible to draw, and the round must not expire behind the overlay). Both
  // sub-modes' refs are stamped unconditionally — the idle one's accumulator is reset by armClock
  // (Begin / a fresh question clock / a resume / an Undo) before its clock ever reads it; the
  // null-guards make the fold a no-op if the round was torn down mid-pause (stopRound nulls them).
  useEffect(() => {
    if (!clockPaused) return
    const at = performance.now()
    blitzPausedAtRef.current = at
    qPausedAtRef.current = at
    return () => {
      const dt = performance.now() - at
      if (blitzPausedAtRef.current != null) {
        blitzPausedAtRef.current = null
        blitzPausedAccRef.current += dt
      }
      if (qPausedAtRef.current != null) {
        qPausedAtRef.current = null
        qPausedAccRef.current += dt
      }
    }
  }, [clockPaused])

  // Arm the running sub-mode's clock with `r` seconds left — the one home for the stamp (pause
  // bookkeeping cleared, display redrawn). Per Round: the round started (blitzSec − r) ago. Per
  // Question: the deadline is r from now. Begin arms a full clock; a correct answer, an in-round
  // Override credit that advanced (C3a) and the Override-rescue resume arm a FRESH question clock;
  // an Undo arms whatever the untouched clock would read now.
  const armClock = (r: number) => {
    const now = performance.now()
    if (!perQ) {
      blitzStartRef.current = now - (blitzSec - r) * 1000
      blitzPausedAccRef.current = 0
      blitzPausedAtRef.current = null
    } else {
      qDeadlineRef.current = now + r * 1000
      qPausedAccRef.current = 0
      qPausedAtRef.current = null
    }
    paintClock(r)
  }
  const begin = () => {
    eng.resetStats() // fresh round (S→0, history clear, new date)
    currentRoundIdRef.current = nextRoundIdRef.current++
    // Snapshot the FULL Best records standing before this round (per the active config) — the
    // reconcile floor + the resume-revert target — and the ★ markers standing with them.
    prevRoundBestRef.current = {
      blitzBk,
      suddenBk,
      blitz: blitzBest[blitzBk],
      sudden: suddenBest[suddenBk],
      suddenAm: suddenAmBest[suddenBk],
    }
    prevRoundStarsRef.current = {
      blitz: blitzBestNew[blitzBk],
      sudden: suddenBestNew[suddenBk],
      suddenAm: suddenAmBestNew[suddenBk],
    }
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    armClock(perQ ? qSec : blitzSec)
  }
  const onAnswer = (i: number) => {
    if (!active) return
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i })
    eng.answer(i)
    if (i === correct) {
      if (perQ) armClock(qSec) // a new date gets a fresh question clock
      // per-round: round continues; engine already advanced to the next date
    } else {
      // Wrong: ends the round only when Allow Mistakes is off (either timing sub-mode). With
      // AM on the component does NOTHING — the engine has marked the wrong, counted played,
      // broken the streak, and stayed on the question: per-round keeps its countdown, and
      // per-Q keeps the SAME draining question clock (no refresh) until a correct answer or an
      // Override credit advances (C3a).
      if (!allowMistakes) {
        eng.lockReveal()
        endRound()
      }
    }
  }
  // Put an ENDED round back on the clock with `remain` seconds left. Two doors use it: an Override
  // that RESCUES a round a player action ended (a wrong answer, a Reveal, or a Show Codes — or, in
  // per-Q + Allow Mistakes, the clock expiring on a question already answered wrong; see
  // resumableEnd), and an Undo of an Override that ENDED a running round. Two halves: (1) revert the
  // active sub-mode's Best AND its ★ to the pre-round records (the round's provisional save is gone;
  // it re-saves only when the round genuinely ends) — safe to branch on the live prefs, the toggles
  // are idle-locked; (2) re-arm the clock. The rescue passes Per Round the stamped remaining (the
  // countdown continues WHERE IT STOPPED) and Per Question a fresh qSec on the (already-advanced)
  // next date — restoring the pre-rewrite behavior the Blitz mode-untangle dropped (original 7176a50
  // did exactly this; C2 Q2-A). The Undo passes what the never-stopped clock would read now.
  const resumeRound = (remain: number) => {
    const snap = prevRoundBestRef.current
    const stars = prevRoundStarsRef.current
    if (!perQ) {
      setBlitzBest((prev) => {
        const nx = { ...prev }
        if (snap.blitz) nx[snap.blitzBk] = snap.blitz
        else delete nx[snap.blitzBk]
        return nx
      })
      setBlitzBestNew((p) => setStars(p, snap.blitzBk, stars.blitz ?? null))
    } else if (allowMistakes) {
      setSuddenAmBest((prev) => {
        const nx = { ...prev }
        if (snap.suddenAm) nx[snap.suddenBk] = snap.suddenAm
        else delete nx[snap.suddenBk]
        return nx
      })
      setSuddenAmBestNew((p) => setStars(p, snap.suddenBk, stars.suddenAm ?? null))
    } else {
      setSuddenBest((prev) => {
        const nx = { ...prev }
        if (snap.sudden) nx[snap.suddenBk] = snap.sudden
        else delete nx[snap.suddenBk]
        return nx
      })
      setSuddenBestNew((p) => setStars(p, snap.suddenBk, stars.sudden ? true : null))
    }
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    // ⚠ THE BREAKDOWN BELONGS TO THE ROUND THAT ENDED, and this is the one door that puts an ENDED
    // round back on the clock (AoX's override-resume is the same door in that mode, with the same
    // line). `breakdownShown` ANDs the flag with availability, so the popup is already off the
    // screen the instant the round is live again — but the FLAG would survive, and the next time
    // this round ended the breakdown would spring open with nobody having asked for it. Belt and
    // braces: the only route into this state with the popup up was App's keyboard handler walking
    // the DOM for [data-key="O"] and finding Override through the scrim, which the same change
    // closed (src/main.tsx, the modal gate on its Category 1 and 2). This line is what makes it not
    // matter.
    setBreakdownOpen(false)
    armClock(remain)
  }
  // ── Override ⇄ Undo (round 23 Q6) ──────────────────────────────────────────────────────────
  // An Override can change the ROUND, not just the score: it can rescue an ended round (resumeRound)
  // and it can end a running one (a flip-to-wrong with Allow Mistakes off). The engine's Undo puts
  // the score back; this puts the round back. Everything it needs is noted here, BEFORE the Override
  // runs — the round's id, whether it was running, its clock's remaining seconds, and the play clock
  // (usePlayClock: rotate-overlay time excluded). No absolute clock stamps are kept: they are only
  // meaningful beside the pause accumulators of the clock that made them, which a resume or an end
  // re-zeroes. One slot, because only one Override can be pending, and every Override overwrites it.
  //
  // ★ THE CLOCK RULE IS "AS IF THE OVERRIDE NEVER HAPPENED", and that means two different things:
  //   • The round was RUNNING: an untouched clock would have kept running, so the Undo arms whatever
  //     it would read now. Standing it still instead would be a free pause — and a real one: a retro
  //     Override (Path 5) leaves the live date on screen, so Override → think → Undo → answer would
  //     buy unlimited thinking time on every question. It also stops a per-question Override that
  //     advanced (which granted a fresh qSec) from refilling the question clock it undoes.
  //     ⚠ THIS INCLUDES AN OVERRIDE THAT ENDED THE ROUND (a to-wrong flip with Allow Mistakes off),
  //     even though the clock was stopped in between, and it is deliberate: that flip is a retro
  //     Path 5, the question it leaves is the LIVE one, and an ended round keeps its date on screen
  //     (showTimerDate). A clock handed back where it stopped would be the same free pause through a
  //     different door — Override (round "ends"), think as long as you like, Undo, answer. What the
  //     player is charged is only the time they spent looking at that question, so toggling cannot
  //     cost more than playing; the drain the ended-round rule below guards against is the one where
  //     the waiting bought nothing.
  //   • The round had ENDED: its clock was stopped, so the Undo re-ends it with the remaining the
  //     Override found. Letting the resumed seconds count would make Override ⇄ Undo drain an ended
  //     round's clock a toggle at a time — and nothing is gained by waiting on a resumed round, because
  //     the date an Override advances to is freshly drawn every time.
  // The Best records and their ★ need nothing here: prevRoundBestRef / prevRoundStarsRef are written
  // only by Begin, the reconcile effect folds every change onto them, and resumeRound reverts to them,
  // so any number of toggles lands where the last one says.
  // ⚠ ACCEPTED EDGE: a clock that runs out between the Override and the Undo ends the round as it
  // always does — LOCK_REVEAL / TIMEOUT_MISS are engine actions, so they end the undo window and the
  // button goes back to Override. That is the contract (the window is only as long as nothing
  // happens), and the clock running out is something happening.
  const playNow = usePlayClock(clockPaused)
  const undoRoundRef = useRef<{
    roundId: number | null
    wasActive: boolean
    remain: number
    at: number
  } | null>(null)
  // Override-to-wrong is a mistake: flipping a CORRECT answer to wrong (a live first-try
  // reversal, or retro-flipping the most-recent correct history entry) ends the round when
  // Allow Mistakes is off — exactly like a real wrong answer (bug #1); with AM on the round
  // keeps going in either timing sub-mode (C3a). Wrong→credit overrides (countedWrong /
  // pendingWrongOverride) are corrections and never end the round. Detect the to-wrong
  // direction from the same fields the reducer reads.
  const onOverride = () => {
    // A round ended by an action (wrong / Reveal / Show Codes — see `resumableEnd` above) is
    // RESUMABLE: crediting the resolved question via Override continues the round instead of
    // leaving it dead, and resumeRound reverts the interrupted round's provisional Best. Captured
    // BEFORE override mutates state. (C2 Q2-A + the uniform-override extension.)
    let flipToWrong = false
    if (state.canOverrideCorrect && state.prevStatsSnapshot)
      flipToWrong = !state.prevStatsSnapshot.wasWrong
    else if (eng.retroOverrideEligible) {
      const last = state.stack[state.stack.length - 1]
      flipToWrong = !!(last?.capsule?.snapshot && !last.capsule.snapshot.wasWrong)
    }
    undoRoundRef.current = {
      roundId: currentRoundIdRef.current,
      wasActive: active,
      remain: active ? (clockRemainAt(performance.now()) ?? 0) : clockRemainRef.current,
      at: playNow(),
    }
    if (state.countedWrong) setFlashWithTimeout({ type: 'good', idx: correct })
    eng.override() // credit (Path 3/4/5); the round then resumes (rescue) or the timerDone effect reconciles
    if (resumableEnd) resumeRound(perQ ? qSec : clockRemainRef.current)
    else if (active && flipToWrong && !allowMistakes) endRound()
    else if (active && perQ && (state.countedWrong || state.pendingWrongOverride != null)) {
      // The override ADVANCED the live question (Path 3 credits this burned question and
      // advances; Path 4 credits the previous wrong and advances — overrideAvail already
      // excludes the spent-target Path-4 no-op) — a new date must never inherit the old date's
      // drained clock, exactly as a correct answer refreshes it (C3a). `state` here is the
      // PRE-dispatch snapshot (the same idiom flipToWrong reads above), and the three branches
      // are mutually exclusive: a retro flip requires neither field set, so it correctly
      // leaves the live question's clock draining.
      armClock(qSec)
    }
  }
  const onUndo = () => {
    eng.undo()
    const snap = undoRoundRef.current
    undoRoundRef.current = null
    // A snapshot from another round cannot be pending (Begin/Reset dispatch a RESET, which ends the
    // undo window, and a parked round is restored with none) — the id check says so rather than
    // trusting it.
    if (!snap || snap.roundId !== currentRoundIdRef.current) return
    if (snap.wasActive) {
      // The clock never stopped: arm what it would read now. If the Override ended the round, this
      // is the resume door (Best + ★ back to the pre-round records, which the ended round had
      // provisionally overwritten); if the round kept running, just the clock — a per-question
      // Override that advanced had re-armed it for a date the Undo has taken away again.
      const r = Math.max(0, snap.remain - (playNow() - snap.at) / 1000)
      if (active) armClock(r)
      else resumeRound(r)
    } else if (active) {
      // The Override resumed an ended round: end it again, with the readout it had. settleEnded, not
      // endRound — the stamp is the one noted, not the resumed clock's. The reconcile effect then
      // re-saves the round's Best exactly as the original ending did (resumeRound had reverted it).
      paintClock(snap.remain)
      settleEnded()
    }
    // Ended before and after (an Override on a finished round's history): the score was the whole
    // change, and the engine has put it back.
  }
  const onReveal = () => {
    eng.reveal()
    endRound()
  }
  // Opening Show Codes during an active round ends the round (so Best Score is recorded and
  // the countdown stops), exactly like Reveal — bug #3. The original applyCalcPenalty ended
  // the round for an active timer; the Blitz migration dropped it (bare eng.showCodes).
  const onShowCodes = (open: boolean) => {
    eng.showCodes(open)
    if (open && active) endRound()
  }
  const resetRound = () => {
    eng.resetStats()
    setActive(false)
    setTimerDone(false)
    setBreakdownOpen(false) //  the breakdown belongs to the round being cleared
    setShowTimerDate(false)
    stopRound()
    resetTimerBars()
  } // App's arm (resets stats for blitz)

  // Leaving the mode mid-round ABANDONS the round (the original App discarded an active round
  // on switch-away; AoX resets a hidden running run and Flash stops a live flash the same way —
  // this teardown was missed in the Blitz migration). Without it the hidden rAF countdown kept
  // draining behind display:none: a per-question timeout would count a phantom MISS in absentia,
  // and the round would end + reconcile a Best for play the user walked away from. The ended
  // (timerDone) state DOES survive a detour, like AoX's done run. (C2 fix; pinned in blitz.dom.)
  // ⚠ Both directives below are repositioned, not new behaviour — same cause as the other
  // extracted modes: in main.tsx's one-line style the call, the closing brace and the dep array
  // shared a line, so a single trailing directive covered all of it. Prettier splits them and a
  // line directive only covers its own line. The set-state disable is new for the reason recorded
  // in FlashMode: the React Compiler never analyzed this component inside main.tsx, so the rule
  // was silent there. Q1 is a verbatim move; ▶ queued for proper review as its own item.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible && active) resetRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // On the ⚙ popover CLOSE (Q2), reconcile Blitz against the new settings: an ACTIVE round OR an
  // ENDED round (timerDone) RESETS as if Reset was pressed — its config (and any recorded Best) is now
  // stale. This RESTORES the documented "a settings change ends an active Blitz round" behavior the
  // mode-untangle dropped (BlitzMode had no settings effect; AoX does this via its own close-effect)
  // AND applies the ended-round reset so the round on screen always matches the current settings. Idle
  // has no live round/date to reconcile. Deferred to close (batched, no per-keystroke churn). The two
  // timer lengths are in the deps because Reset Settings can now restore them mid-round (round-6 Q7):
  // the sliders are idle-locked, so the only in-popover writer of blitzSec/qSec is Reset Settings, and a
  // reset that lands a fresh timer must reconcile the running/ended round exactly as a panel change does.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [
      randomFormat,
      dateFormat,
      useJulian,
      minY,
      maxY,
      leapChance,
      janFebChance,
      julianChance,
      blitzSec,
      qSec,
    ],
    () => {
      if (active || timerDone) resetRound()
    },
  )

  // Reconcile Best when a round is over: set to max(S) tagged with the round id, and roll
  // back when an Override has dropped the score of the round that set the Best. The ★ markers are
  // set EXACTLY on every write rather than OR-folded (roundStars): an Override that raises a Best
  // and its Undo that lowers it again must take the ★ with it — and must not take a ★ an earlier
  // round earned under the same config, which is what the pre-round ★ snapshot is for. Runs on
  // S changes while timerDone (covers both round-end and post-round override). Three-way by
  // sub-mode (safe on live prefs — the toggles are idle-locked): per-round → blitzBest;
  // per-Q + Allow Mistakes → suddenAmBest, the SAME BlitzBest shape + reconcile (C3a);
  // per-Q sudden death → suddenBest (score only).
  useEffect(() => {
    if (!timerDone) return
    if (!saveStats) return // practice mode (Save Stats off): the round plays + tracks internally but records NO Best (C2 Q2-B — now that the engine always tracks, gate the Best here like AoX does)
    const rid = currentRoundIdRef.current
    if (!perQ) {
      setBlitzBest((prev) => {
        const cur = prev[blitzBk] ?? {
          score: 0,
          streak: 0,
          scoreRoundId: null,
          streakRoundId: null,
        }
        const fb = prevRoundBestRef.current
        const next = reconcileBlitzBest(cur, S.good, S.best, rid, {
          score: fb.blitz?.score ?? 0,
          streak: fb.blitz?.streak ?? 0,
        })
        if (
          next.score === cur.score &&
          next.streak === cur.streak &&
          next.scoreRoundId === cur.scoreRoundId &&
          next.streakRoundId === cur.streakRoundId
        )
          return prev
        setBlitzBestNew((p) =>
          setStars(p, blitzBk, roundStars(prevRoundStarsRef.current.blitz, next, fb.blitz)),
        )
        return { ...prev, [blitzBk]: next }
      })
    } else if (allowMistakes) {
      setSuddenAmBest((prev) => {
        const cur = prev[suddenBk] ?? {
          score: 0,
          streak: 0,
          scoreRoundId: null,
          streakRoundId: null,
        }
        const fb = prevRoundBestRef.current
        const next = reconcileBlitzBest(cur, S.good, S.best, rid, {
          score: fb.suddenAm?.score ?? 0,
          streak: fb.suddenAm?.streak ?? 0,
        })
        if (
          next.score === cur.score &&
          next.streak === cur.streak &&
          next.scoreRoundId === cur.scoreRoundId &&
          next.streakRoundId === cur.streakRoundId
        )
          return prev
        setSuddenAmBestNew((p) =>
          setStars(p, suddenBk, roundStars(prevRoundStarsRef.current.suddenAm, next, fb.suddenAm)),
        )
        return { ...prev, [suddenBk]: next }
      })
    } else {
      setSuddenBest((prev) => {
        const cur = prev[suddenBk] ?? { score: 0, roundId: null }
        const next = reconcileSuddenBest(
          cur,
          S.good,
          rid,
          prevRoundBestRef.current.sudden?.score ?? 0,
        )
        if (next.score === cur.score && next.roundId === cur.roundId) return prev
        const floor = prevRoundBestRef.current.sudden?.score ?? 0
        const lit = !!prevRoundStarsRef.current.sudden || next.score > floor
        setSuddenBestNew((p) => setStars(p, suddenBk, lit ? true : null))
        return { ...prev, [suddenBk]: next }
      })
    }
  }, [
    timerDone,
    saveStats,
    S.good,
    S.best,
    perQ,
    allowMistakes,
    blitzBk,
    suddenBk,
    setBlitzBest,
    setSuddenBest,
    setSuddenAmBest,
  ])

  // Round-21 Q11 — mirror an ENDED round to sessionStorage, keyed by the ACTIVE preset, exactly as
  // the effect above mirrors the round's Best to store/progress. On the remount a preset switch
  // causes, the mount-time reads restore whatever is parked for the now-active preset (see
  // `parkedRound`). Only an ENDED round is parked; every other state DISCARDS the slot:
  //   • in-progress (active, !timerDone) → discard, so a mid-round switch parks nothing and the
  //     remount starts fresh — the owner's requirement — and any stale blob from a prior round goes;
  //   • idle after a manual Reset / Begin / an Override that resumed the round → discard, the park
  //     is no longer the truth.
  // `state` is a dep so a post-round Override (which edits the ended round's engine state and
  // re-runs the Best-reconcile effect above) re-parks the updated snapshot. currentRoundIdRef and
  // prevRoundBestRef are written only by begin(), which also flips active/timerDone, so they are
  // already stable whenever timerDone is true and need no dep of their own. clockRemainRef needs none
  // either: every writer that can leave a round ended — endRound's stamp, and the Undo that re-ends a
  // resumed round (paintClock) — writes it in the same handler that flips timerDone, before this runs.
  useEffect(() => {
    const pid = usePresets.getState().activeId
    if (timerDone)
      writeSessionRound(pid, 'blitz', {
        engine: withoutPendingUndo(state),
        timerDone,
        showTimerDate,
        active,
        currentRoundId: currentRoundIdRef.current,
        prevRoundBest: prevRoundBestRef.current,
        remain: clockRemainRef.current,
      })
    else discardSessionRound(pid, 'blitz')
  }, [timerDone, active, showTimerDate, state])

  // Both toggles are bare idle-gated flips — fully independent since C3a (the old auto-off
  // coupling died with the sudden-death-only per-Q). The idle lock (also mirrored by the
  // pointer-events dim on the buttons) is what makes the live-prefs branching above safe.
  const togglePerQ = () => {
    if (active || timerDone) return
    setPerQ((v) => !v)
  }
  const toggleAllowMistakes = () => {
    if (active || timerDone) return
    setAllowMistakes((v) => !v)
  }

  // Freshness for App's isFullyReset. The two timer lengths compare against their EFFECTIVE
  // defaults — the saved personal defaults when they exist (Q7, store/userDefaults); the
  // excluded config (perQ, allowMistakes, the visual-only timingOff — Q8) stays factory-fixed
  // (not capturable), so each compares to its launch constant (Full Reset returns them all).
  const defBlitzSec = useUserDefaults((s) => effectivePrefDefaults(s.saved).blitzSec)
  const defBlitzQSec = useUserDefaults((s) => effectivePrefDefaults(s.saved).blitzQSec)
  const blitzIsFresh =
    state.stats.played === 0 &&
    state.stats.good === 0 &&
    state.stats.streak === 0 &&
    state.stats.best === 0 &&
    state.stats.times.length === 0 &&
    state.stack.length === 0 &&
    state.forwardStack.length === 0 &&
    state.backDepth === 0 &&
    state.locked === false &&
    state.revealed === false &&
    state.countedWrong === false &&
    state.canOverrideCorrect === false &&
    state.pendingWrongOverride === null &&
    state.overrideUsedThisQ === false &&
    state.undoCapsule === null &&
    state.calcOpen === false &&
    active === false &&
    timerDone === false &&
    breakdownOpen === false &&
    showTimerDate === false &&
    perQ === false &&
    allowMistakes === true &&
    timingOff === false &&
    blitzSec === defBlitzSec &&
    qSec === defBlitzQSec &&
    Object.keys(blitzBest).length === 0 &&
    Object.keys(suddenBest).length === 0 &&
    Object.keys(suddenAmBest).length === 0 &&
    flash === null
  useEffect(() => {
    onFreshChange?.(blitzIsFresh)
  }, [blitzIsFresh, onFreshChange])

  const shouldShowTimerDate = active || showTimerDate
  const optionsDisabled = !active || state.locked || state.calcOpen || state.calcPenaltyActive
  const timerBlocksReveal = !shouldShowTimerDate
  const revealDisabled =
    (state.locked && state.revealed) ||
    state.calcOpen ||
    state.calcPenaltyActive ||
    timerBlocksReveal ||
    timerDone
  const timerBusy = active
  // Streak is hidden only in per-Q sudden death: there a wrong ends the round, so streak
  // always equals score. With Allow Mistakes on it behaves exactly like per-round (C3a).
  const showStreak = !perQ || allowMistakes
  // The timing trio (Last/Mean/Median) carries a VISUAL-ONLY hide toggle (Q8): tap any of the
  // three to blank them all. Unlike Classic/Flash/Deduction there is NO engine timingOff and NO
  // "Enable and Reset Stats?" arm — Blitz always tracks (saveStats:true above), so hiding can never
  // desync (structurally desync-proof). (Persisted as blitzTimingOff — excluded from the defaults
  // system.) Save Stats off drops the toggle, exactly as it does for the scoring trio.
  //
  // ★ `off` is the USER'S hide toggle and nothing else (C1, round 16) — so it is `timeHidden`
  // below and NOT a `!saveStats` term, and the scoring trio (Score/Accuracy/Streak — untoggleable,
  // the score IS the mode) carries no `off` at all. The Save-Stats fact is `dimmed` on the panel
  // below: one flag, whole strip.
  //
  // ★★ HIDING QUIETS ONLY A ROUND THAT IS STILL GOING. An ENDED round (`timerDone`) shows its
  // times and drops the toggle — the same guard AoX carries on a completed run, and Blitz was the
  // one mode missing it, so its time boxes stayed tappable on a screen where AoX's were already
  // inert. Two sibling modes disagreeing about the same screen.
  //
  // WHY `timerDone` IS THE SIGNAL, and it is worth being exact because Blitz names nothing
  // "complete". `setTimerDone(true)` has exactly ONE writer — settleEnded(), reached through endRound()
  // or through an Undo re-ending a round its Override had resumed — and EVERY way a round can finish
  // routes through it, in BOTH timing sub-modes: the Per Round countdown hitting 0, any
  // single question's Per Question clock hitting 0, a wrong answer with Allow Mistakes off, Reveal,
  // Show Codes, and an override-to-wrong with Allow Mistakes off. (The ⚙ panel is NOT one of them:
  // opening it leaves the round running, and closing it after changing a setting the round depends on
  // RESETS the round to idle rather than ending it — the useSettingsCloseEffect above.) So there is
  // no per-sub-mode branch to write here: one flag already means "this round is over" everywhere.
  // It is also the flag the Best-reconcile effect gates on — a Blitz round that ends on a wrong in
  // sudden death still RECORDS its result, so it is a finished round, not an abandoned one. AoX
  // makes the same call from the other direction: its failed run records no Best, and since round
  // 22 its strip is STILL a result readout (its `isLocked` is done OR failed), because what an ended
  // strip owes the player is the times it ran up, not a verdict on how it ended. The two modes agree.
  //
  // ⚠ BOTH HALVES MOVE TOGETHER — dropping `fn` while leaving `off: timingOff` would be a trap, not
  // half a fix. Tapping a time box is the ONLY writer of blitzTimingOff in the whole app (it is
  // excluded from the defaults system and survives Reset Settings; only Full Reset clears it), so a
  // player who had hidden the trio would end a round facing three blank boxes and no way to reveal
  // the round's own times without resetting the round away. Masking the pref on this screen and
  // taking the toggle with it is one coherent state: the ended strip is a plain result readout.
  // The pref itself is never written here — resume an ended round via Override (resumeRound clears
  // timerDone) and the hide the player chose is back, untouched.
  //
  // ⚠ With Save Stats OFF the whole strip is dimmed to '—' and `tFn` was already null; an ended
  // round now reads '—' there rather than blank, because `timeHidden` goes false. That is the
  // dimmed strip's uniform statement and it is exactly what AoX does in the same state.
  const timeHidden = timingOff && !timerDone
  const tFn = saveStats && !timerDone ? () => setTimingOff((v) => !v) : null
  // ── THE ROUND BREAKDOWN (sub-group 3C) ──────────────────────────────────────────────────────
  // The same panel MoX opens, on the same gesture and for the same reason: an ENDED round's stat
  // strip is already inert (the line above drops `tFn` on `timerDone`, and the scoring boxes never
  // had one), so tapping anywhere on it opens the round solve-by-solve. It fell out of the MoX work
  // for the price of these three lines because Blitz's Begin is a full engine RESET — so the round's
  // history IS the whole engine history, and the times ledger's carried-in count is 0, which is what
  // makes the rows add up to the strip's Mean exactly.
  // ⚠ `timerDone` is the right flag: every way a Blitz round can end routes through settleEnded(),
  // sudden-death losses included, so a lost round opens its breakdown exactly like one the clock
  // ended — the rule AoX adopted for its failed runs in round 22 (its `isLocked`). (The long
  // argument is in the timing note directly above.) Gated on `saveStats` for the reason MoX is: a
  // dimmed strip reading '—' must not be a door to the numbers it is declining to show.
  //
  // ⚠ AND ON `visible`, which is not paranoia — it is the one guard the mode's own display:none
  // cannot supply. The popup PORTALS to #root, so it sits outside this screen's hidden wrapper: a
  // round left finished on screen and then a keyboard mode-switch (the shortcut keys still fire while
  // the panel is up) would leave this card floating over a different mode. Gating availability on
  // `visible` unmounts it with the screen it belongs to, which also pops its overlay registration.
  const breakdownAvail = timerDone && saveStats && visible
  const breakdownShown = breakdownOpen && breakdownAvail
  const statsArr = [
    { label: 'Score', value: `${S.good}/${S.played}`, fn: null },
    { label: 'Accuracy', value: fmtAccuracyPct(S.good, S.played), fn: null },
    ...(showStreak ? [{ label: 'Streak', value: `${S.streak}/${S.best}`, fn: null }] : []),
    { label: 'Last', value: truncTime(calcLast(S.times)), off: timeHidden, fn: tFn },
    { label: 'Mean', value: fmtTime(calcAvg(S.times)), off: timeHidden, fn: tFn },
    { label: 'Median', value: fmtTime(calcMed(S.times)), off: timeHidden, fn: tFn },
  ]
  const date = state.date
  const dateText = shouldShowTimerDate ? fmtDate(date.y, date.m, date.d, date._fmt) : '—'
  const bScore = blitzBest[blitzBk],
    sScore = suddenBest[suddenBk],
    saScore = suddenAmBest[suddenBk]
  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      {/* dimmed = Save Stats off = nothing is being recorded (whole strip, every value '—'); the
          timing trio you hid yourself renders BLANK while the round is going, from `off` in
          statsArr — an ended round shows its times and takes no taps at all (timeHidden/tFn
          above). See StatPanel. */}
      <StatPanel
        stats={statsArr}
        dimmed={!saveStats}
        onActivate={breakdownAvail ? () => setBreakdownOpen(true) : null}
        activateLabel={perQ ? 'Show run breakdown' : 'Show round breakdown'}
      />
      {/* Mounted only while up — see the component header, and the twin site in modes/AoxMode. */}
      {breakdownShown && (
        <RunBreakdown
          onClose={() => setBreakdownOpen(false)}
          data={buildRunBreakdown(state, useJulian)}
          fmtDate={fmtDate}
          title={perQ ? 'Run Breakdown' : 'Round Breakdown'}
        />
      )}
      {!perQ && <BlitzBestRow rec={bScore} newFlags={blitzBestNew[blitzBk]} />}
      {perQ && allowMistakes && <BlitzBestRow rec={saScore} newFlags={suddenAmBestNew[suddenBk]} />}
      {perQ && !allowMistakes && (
        <div className="mt-3 text-xs text-(--tx-300-60)">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[125px]">
              Best Score: {sScore?.score ?? '—'}
              {suddenBestNew[suddenBk] && <NewBestStar />}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={toggleAllowMistakes}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${active || timerDone ? ' opacity-60 pointer-events-none' : ''}`}
        >
          Allow Mistakes
        </button>
        <button
          type="button"
          onClick={togglePerQ}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border btn-solid border-transparent ${active || timerDone ? ' opacity-60 pointer-events-none' : ''}`}
        >
          {perQ ? 'Per Question' : 'Per Round'}
        </button>
      </div>
      <div className="mt-3">
        {!perQ ? (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="10"
              max="300"
              step="5"
              value={blitzSec}
              onChange={(e) => {
                const v = +e.target.value
                setBlitzSec(v)
                if (!active) {
                  clockRemainRef.current = v
                  if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(v)
                  if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
              disabled={active || timerDone}
              style={
                {
                  '--rng-fill': Math.round(((blitzSec - 10) / 290) * 100) + '%',
                } as React.CSSProperties
              }
              className="flex-1 disabled:opacity-40"
            />
            <SliderValueEditor
              value={blitzSec}
              min={10}
              max={300}
              snap={5}
              disabled={active || timerDone}
              inputMode="numeric"
              label="Blitz round timer"
              format={fmtBlitzT}
              toText={String}
              widest={SLIDER_READOUT_WIDEST}
              onCommit={(v) => {
                setBlitzSec(v)
                if (!active) {
                  clockRemainRef.current = v
                  if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(v)
                  if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="1"
              max="30"
              step="0.5"
              value={qSec}
              onChange={(e) => {
                const v = +e.target.value
                setQSec(v)
                if (!active) {
                  if (suddenTimeRef.current) suddenTimeRef.current.textContent = v + 's'
                  if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
              disabled={active || timerDone}
              style={
                { '--rng-fill': Math.round(((qSec - 1) / 29) * 100) + '%' } as React.CSSProperties
              }
              className="flex-1 disabled:opacity-40"
            />
            <SliderValueEditor
              value={qSec}
              min={1}
              max={30}
              snap={0.5}
              disabled={active || timerDone}
              inputMode="decimal"
              label="Blitz question timer"
              format={(v) => v + 's'}
              toText={String}
              widest={SLIDER_READOUT_WIDEST}
              onCommit={(v) => {
                setQSec(v)
                if (!active) {
                  if (suddenTimeRef.current) suddenTimeRef.current.textContent = v + 's'
                  if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
            />
          </div>
        )}
      </div>
      <div className="mt-5">
        {!perQ && (
          <div className="mb-3">
            <div className="text-center text-xs tabular-nums text-(--tx-200-80) mb-1">
              <span ref={blitzTimeRef}>{fmtBlitzT(blitzSec)}</span>
            </div>
            <div className="bar">
              <span ref={blitzBarRef} style={{ width: '100%' }}></span>
            </div>
          </div>
        )}
        {perQ && (
          <div className="mb-3">
            <div className="text-center text-xs tabular-nums text-(--tx-200-80) mb-1">
              <span ref={suddenTimeRef}>{qSec}s</span>
            </div>
            <div className="bar">
              <span ref={suddenBarRef} style={{ width: '100%' }}></span>
            </div>
          </div>
        )}
        <div className="mt-4 rounded-2xl panel p-4">
          <div className="text-center relative">
            <CardNumber state={state} show={state.backDepth > 0} />
            <div className="text-3xl font-bold">{dateText}</div>
          </div>
          <WeekdayAnswer
            key={state.gridEpoch}
            inputStyle={inputStyle}
            dotOrientation={dotOrientation}
            persistBtns={state.persistBtns}
            flash={flash}
            optionsDisabled={optionsDisabled}
            onPick={onAnswer}
          />
        </div>
        <div className="mt-4 rounded-2xl panel p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {active || timerDone ? (
              <button
                type="button"
                data-key="N"
                className={`col-span-1 ${RESET_BTN_CLASS}`}
                onClick={resetRound}
              >
                Reset
              </button>
            ) : (
              <button
                type="button"
                data-key="N"
                className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium"
                onClick={begin}
              >
                Begin
              </button>
            )}
            <div className="col-span-1 flex gap-1">
              <button
                type="button"
                data-key="ArrowLeft"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${timerBusy || state.stack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.back}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&lt;</span>
              </button>
              <button
                type="button"
                data-key="ArrowRight"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${timerBusy || state.forwardStack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.forward}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&gt;</span>
              </button>
            </div>
            <button
              type="button"
              data-key="R"
              className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={onReveal}
            >
              Reveal
            </button>
            <OverrideButton
              overrideAvail={overrideAvail}
              undoAvail={undoAvail}
              onOverride={onOverride}
              onUndo={onUndo}
            />
          </div>
          <MethodBreakdownSection
            date={shouldShowTimerDate ? date : null}
            open={state.calcOpen}
            onOpenChange={onShowCodes}
            className=""
            contentClassName="mt-2 rounded-2xl thin px-4 pt-[3px] pb-1.5"
            useJulian={state.backDepth > 0 ? (date?._jul ?? useJulian) : useJulian}
            displayedFormat={date?._fmt || dateFormat}
          />
        </div>
      </div>
    </div>
  )
}

export default BlitzMode
