// BlitzMode — the countdown screen: Per Round and Per Question timing, the Allow Mistakes
// sudden-death variant, and Best Score/Streak rebuilt from the pre-round record. Extracted verbatim from
// main.tsx (the main.tsx split); it was already a module-level sibling of App taking everything through
// props, so nothing about its behaviour changes by living here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ModeProps, FmtDate, GenDate } from './modeTypes.js'
import { useButtonFlash, useMountedBestsId, useMountedDataId } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import { RESET_BTN_CLASS, DATE_CARD_CLASS } from '../components/controlClasses.js'
import { dateLineShapes } from '../lib/dateLineFit.js'
import DateLine from '../components/DateLine.jsx'
import {
  fmtTime,
  truncTime,
  fmtBlitzT,
  fmtAccuracyPct,
  SLIDER_READOUT_WIDEST,
  EM_DASH,
} from '../lib/modeFormat.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import RunBreakdown from '../components/RunBreakdown.jsx'
import CardNumber from '../components/CardNumber.jsx'
import OverrideButton from '../components/OverrideButton.jsx'
import SliderValueEditor from '../components/SliderValueEditor.jsx'
import BlitzBestRow from '../components/BlitzBestRow.jsx'
import { BestColumn, BestLine, BestSubLine } from '../components/BestReadout.jsx'
import { NewBestStar } from '../components/primitives.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { calcAvg, calcLast, calcMed } from '../engine/stats.js'
import { buildRunBreakdown } from '../engine/runBreakdown.js'
import { shownBlitzBest, shownSuddenBest } from '../engine/bestPool.js'
import { newRoundId, isNewBest } from '../engine/roundId.js'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import { useUserDefaults, effectivePrefDefaults } from '../store/userDefaults.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import {
  creditsLiveCard,
  liveCredited,
  overrideAdvances,
  showCodesPenalizes,
  topCardNumber,
} from '../engine/gameReducer.js'
import type { GameState } from '../engine/gameReducer.js'
import { readSessionRound } from '../store/sessionRound.js'
import { fileRoundResult, parkRound, unparkRound } from '../store/screenPool.js'
import type { ParkedSnapshot } from '../store/sessionRound.js'
import { restoreParkedEngine } from '../engine/parkedEngine.js'
import { useBackButton } from '../components/overlayStack.js'

// ★ THE RECORD A ROUND'S RESULT IS FILED ON: the Best map of the sub-mode it was played in, and its set-up
// key there — both fixed at Begin, the round's own and never the live settings (the ⚙ panel can move
// those while the round sits ended; it is reset when the panel closes).
const BLITZ_MAPS = ['blitzBest', 'suddenBest', 'suddenAmBest'] as const
interface RoundRecord {
  map: (typeof BLITZ_MAPS)[number]
  setup: string
}
// Read off an untrusted blob (the slot may hold anything a build on this origin wrote).
const isRoundRecord = (v: unknown): v is RoundRecord =>
  typeof v === 'object' &&
  v !== null &&
  BLITZ_MAPS.includes((v as RoundRecord).map) &&
  typeof (v as RoundRecord).setup === 'string'

// Round 21 — the shape BlitzMode parks in store/sessionRound for an ENDED round. It round-trips
// its own engine state plus the component fields the completed view (and a post-round Override)
// need; store/sessionRound never looks inside it. `currentRoundId`, `record` and `filed` are what keep
// a restored round's result filed right — an Override on it after a reload changes the same round's
// result on the same record, and a press that hands it back takes back exactly that — and
// `currentRoundId` is also what keeps the restored round's ★ lit (it is read off the ids).
// `remain` is the round's clock as it stopped — what an Override that rescues the restored round
// resumes from (Per Round) and what its readout shows.
// WHY A ROUND ENDED — the one fact that decides whether it can come back, and what its clock does
// while it waits (round 23):
//   'clock'  — the countdown expired on a card the player had not already burned. Never resumable:
//              running out of time is not a misclick.
//   'answer' — the LIVE card became a scored miss (a wrong with Allow Mistakes off, a Reveal, a Show
//              Codes, or a Per Question expiry on a card already answered wrong). Its answer is on
//              screen, so there is nothing left to read and the clock FREEZES at the stamp the
//              ending took. Crediting that card resumes the round. (This is the old `resumableEnd`.)
//   'toggle' — a press flipped some card to a miss with Allow Mistakes off. The LIVE card is
//              untouched and still unresolved ON SCREEN, so the clock keeps DRAINING while the round
//              sits ended (see `remainNow`): a frozen clock here would be a free pause — press,
//              study the date at leisure, press back. Putting that card's credit back resumes the
//              round on the SAME live card, charged for every second of the gap.
type EndKind = 'clock' | 'answer' | 'toggle'

interface BlitzRoundSnapshot {
  engine: GameState
  timerDone: boolean
  showTimerDate: boolean
  active: boolean
  currentRoundId: number | null
  // The record its result is filed on, and the result as last filed there (JSON; null: never filed).
  record: RoundRecord
  filed: string | null
  // The configuration the round was played under (`roundConfig` in the component, which argues it).
  config: string
  remain: number
  // Why this round ended, and — for a 'toggle' end only — the WALL-CLOCK instant it ended at, so the
  // charge for the gap survives the remount a preset switch causes (every performance.now()-based
  // stamp restarts there; Date.now() does not).
  endKind: EndKind
  endedAt: number | null
  // Does this round count toward the Bests — was Save Stats on as it FIRST ended (`recordedRef` in
  // the component, which argues it).
  recorded: boolean
}

// ============================================================
// BlitzMode — the Blitz game mode on the shared engine (mode-untangle Step 3).
//
// Self-contained + always-mounted. KEY INSIGHT: App resets stats on every blitz Begin,
// so the engine `S` already IS the round score — Blitz needs NO reducer changes. BlitzMode
// = the engine + a countdown (Per Round `blitzSec` / Per Question `qSec`) + Best Score/
// Streak tracking. Begin = engine.resetStats() (fresh round) + start timer; answering uses
// the engine; a round ends on the clock or on a wrong with Allow Mistakes off (either
// timing sub-mode — the two toggles are fully independent). A round's RESULT is filed on its Best
// record while the round is over — at its end and after every Override that moves it — as the round's
// own figures (store/screenPool's fileRoundResult): the record keeps every round's figures beside it,
// so a field the round beats is held by its id, and an Override that drops the round hands the field
// to the next best round, whichever window played it.
// ============================================================
function BlitzMode({
  visible,
  genDate,
  minY,
  maxY,
  useJulian,
  saveStats,
  dateFormat,
  randomFormat = false,
  dateDraw,
  inputStyle = 'buttons',
  dotRotation = 'standard',
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
    setTimingOff = useModePrefs((s) => s.setBlitzTimingOff) // persisted; VISUAL-ONLY — blanks the timing trio, the engine clock never stops (no arm/reset)
  // ★ THE BESTS COPY THIS SCREEN WAS MOUNTED ON, read once — every parked-round read, write and
  // discard below uses it (modes/modeHooks' useMountedBestsId argues why) — and the STATS copy, which
  // every one of those writes names to store/screenPool, so a write from this screen can only ever
  // land in the copy it was drawn for.
  const bestsId = useMountedBestsId()
  const dataId = useMountedDataId()
  const blitzSec = useModePrefs((s) => s.blitzSec),
    setBlitzSec = useModePrefs((s) => s.setBlitzSec) // persisted (mode-prefs store)
  const qSec = useModePrefs((s) => s.blitzQSec),
    setQSec = useModePrefs((s) => s.setBlitzQSec) // persisted (mode-prefs store)
  // The per-config Best silo keys. blitzBk leads with an m/n Allow-Mistakes marker (both
  // per-round variants share the one blitzBest map); suddenBk has NO AM segment — for
  // per-question, AM-ness is the MAP split (suddenBest = sudden death, suddenAmBest = Allow
  // Mistakes on), because the two record shapes differ (score-only vs score+streak). The tail is the
  // date settings IN EFFECT (`dateDraw` — modes/modeTypes) and useJulian, so a setting that is not in
  // effect never moves a key; the Bests filed under stored values before Round 26 are read through
  // engine/bestPool's door (the display, below).
  const dateConfig = `${dateDraw}|${useJulian}`
  const blitzBk = `${allowMistakes ? 'm' : 'n'}${blitzSec}|${dateConfig}`
  const suddenBk = `${qSec}|${dateConfig}`
  // ★ THE CONFIGURATION A ROUND IS PLAYED UNDER — the timing sub-mode, Allow Mistakes, and the Best
  // key of the sub-mode in play (its timer length and every date setting): everything that decides
  // which record the round's result is filed on, what its clock runs to and
  // which dates a resumed round would draw. A round carries the one it was BEGUN under
  // (roundConfigRef), a PARKED round carries it into the snapshot, and it comes back only if it is
  // still exactly the live one.
  // WHY: the settings and the per-mode setup are shared by every copy of a preset's stats and bests, so a guest's
  // interlude can change them under a parked round (the idle guest screen's Per Question / Allow
  // Mistakes toggles and its sliders are all live). The mount reconcile branches on the LIVE
  // sub-mode, so a restored Per Round round wrote its score into the Per Question records — a Best
  // in a sub-mode never played — and one restored over a changed year range resumed drawing the new
  // range's dates into a round filed under the old one, raising that Best with dates it does not
  // cover. A round that no longer matches is simply not restored: the screen comes up idle, exactly
  // as a settings change resets a round that is on screen, and the Bests it set stay as saved.
  // ★ …AND THE SHAPE OF THE BEST RECORDS THE ROUND CARRIES (Round 26, Q10 — the leading
  // `companions|`). Since Round 26 a record carries each field's companion (engine/blitzBest), and an
  // OLDER build sharing this origin (a tab that moves between the test site and the live one keeps its
  // session) would restore such a round and reconcile it with records of its own four fields — an
  // Override there that moves only a companion (the holder round's other number; its four fields
  // standing still) is a record its fileBest sees as unchanged, so the companion would stay: WRONG,
  // not missing. Proven on the real older builds (tests/blitzBest.olderBuilds). No older build
  // computes this configuration, so an older build declines the round — its screen comes up idle and
  // the Bests stay as saved — and this build declines an older build's round the same way (its blob
  // also lacks the `record` this build files on).
  const roundConfig = `companions|${perQ ? 'q' : 'r'}|${allowMistakes ? 'm' : 'n'}|${perQ ? suddenBk : blitzBk}`
  // The ended round this (bests copy, mode) parked before its last unmount, read EXACTLY ONCE at
  // mount. On a preset switch or an Amnesic change the always-mounted screens remount (src/main.tsx
  // remountScreens) and the INCOMING copy is ALREADY the one named by the time this runs —
  // switchPreset / setPresetAmnesic name the incoming copy before they rehydrate the stores, one
  // synchronous turn (store/presetControl). So this is the incoming copy's OWN parked round and never
  // the one just left; the copy key is the whole contamination guard (a blob keyed to preset 1's
  // saved copy is unreachable while preset 2, or preset 1's guest session, is up). Factored into one
  // read so the initializers below don't each call sessionStorage. Two gates, before any initializer
  // reads the snapshot, and either one drops the WHOLE snapshot so the screen never shows an "ended"
  // round over a fresh engine:
  //   • the round was played under exactly the live configuration (`roundConfig` above);
  //   • the engine inside comes through the one restore door (engine/parkedEngine's
  //     restoreParkedEngine) — a blob this build cannot read is not a round.
  // (…and a blob that does not say whether its ending was recorded is not one this build parked.)
  const [parkedRound] = useState<BlitzRoundSnapshot | null>(() => {
    const snap = readSessionRound<ParkedSnapshot<BlitzRoundSnapshot>>(bestsId, 'blitz')
    if (
      !snap ||
      snap.config !== roundConfig ||
      typeof snap.recorded !== 'boolean' ||
      !isRoundRecord(snap.record) ||
      !(snap.filed === null || typeof snap.filed === 'string')
    )
      return null
    const engine = restoreParkedEngine(snap.engine, useJulian, 'blitz')
    return engine ? { ...snap, engine } : null
  })
  // The configuration the round on screen was begun under — written by Begin, restored with a parked
  // round (which by the gate above is the live one). A ref: nothing renders from it.
  const roundConfigRef = useRef(parkedRound?.config ?? roundConfig)
  // Only ENDED rounds are ever parked, so a restored round always has active === false; it is read
  // from the blob for symmetry rather than assumed.
  const [active, setActive] = useState(parkedRound?.active ?? false)
  const [timerDone, setTimerDone] = useState(parkedRound?.timerDone ?? false)
  // Why the round on screen ended (null while there is no ended round).
  const [endKind, setEndKind] = useState<EndKind | null>(parkedRound?.endKind ?? null)
  // The wall-clock instant a 'toggle' end happened — what `remainNow` charges the gap against. A ref,
  // not state: nothing renders from it directly (the drain effect below paints from remainNow), and it
  // must be readable by the press that resumes without waiting for a re-render.
  const endedAtRef = useRef<number | null>(parkedRound?.endedAt ?? null)
  const [breakdownOpen, setBreakdownOpen] = useState(false) // the round breakdown popup (components/RunBreakdown) — ephemeral, dies with the round
  const [showTimerDate, setShowTimerDate] = useState(parkedRound?.showTimerDate ?? false)
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
  const qDeadlineRef = useRef<number | null>(null),
    qPausedAtRef = useRef<number | null>(null),
    qPausedAccRef = useRef(0)
  // The countdown's bar and readout — ONE of each, for whichever timing sub-mode is in play (it is
  // idle-locked, so they can never belong to two at once). Painted by drawClock alone: neither has
  // any content React renders, so nothing React does can put back a value drawClock has replaced.
  const clockBarRef = useRef<HTMLSpanElement | null>(null),
    clockTimeRef = useRef<HTMLSpanElement | null>(null)
  // Blitz all-time bests persist across reloads (Stage D1): from the progress store — per-round
  // (blitzBest), per-Q sudden death (suddenBest), and per-Q + Allow Mistakes (suddenAmBest).
  // Their ★ markers are not stored anywhere: each is DERIVED from the record's own round id (see
  // `roundId` below and engine/roundId's isNewBest).
  // Every write to them goes through store/screenPool's door, named with this screen's copy.
  const blitzBest = useProgress((s) => s.blitzBest)
  const suddenBest = useProgress((s) => s.suddenBest)
  const suddenAmBest = useProgress((s) => s.suddenAmBest)
  // ★ THE ROUND ON SCREEN — its id, from Begin until Reset (null while there is none). Every Best field
  // this round sets is held by it (the filing below), and a Best marked with it IS "a best the
  // round on screen set", which is the whole of the ★ rule (engine/roundId's isNewBest; round 23
  // standardized Blitz on MoX's meaning). State, not a ref, because the ★ renders from it.
  // ⚠ NEVER-REPEATING (engine/roundId's newRoundId), because the id is SAVED inside the Best records:
  // the counter that restarted at 1 on every screen load made today's round 1 and last week's round 1
  // the same round to the Same Round tag and to the rollback that used to compare ids.
  // Restored from the parked round (round 21), so a round that comes back after a preset switch
  // or a reload is still the round its records name — its ★ comes back with it, and its filings keep
  // naming it.
  const [roundId, setRoundId] = useState<number | null>(parkedRound?.currentRoundId ?? null)
  // ★ WHERE THE ROUND ON SCREEN FILES ITS RESULT, AND WHAT IT LAST FILED THERE. The record is the round's
  // own (RoundRecord, fixed at Begin). `filedRef` is its result as last filed (JSON) — null until the
  // round's first filing: a filing that would say the same again is skipped, and every later one is an
  // Override of the round's result (store/screenPool's `filedBefore`). Both are restored with a parked
  // round, so after a reload an Override on it changes the same round's result on the same record.
  const roundRecordRef = useRef<RoundRecord>(
    parkedRound?.record ?? { map: 'blitzBest', setup: blitzBk },
  )
  const filedRef = useRef<string | null>(parkedRound?.filed ?? null)
  // ★ DOES THE ROUND ON SCREEN COUNT TOWARD THE BESTS? Decided ONCE, by the Save Stats setting as the
  // round FIRST ends, and it is the round's for the rest of its life: null from Begin until that first
  // ending, then true or false until Reset or the next Begin — through every Override and Undo, a
  // resume and the ending after it, a guest's interlude and a reload (it is parked with the round).
  // The filing effect below takes the verdict; Begin and Reset clear it.
  // WHY IT IS REMEMBERED RATHER THAN READ LIVE. The reconcile used to gate on the live setting, so a
  // practice round sitting ended on screen was recorded the moment Save Stats was turned back on —
  // a Best for a round played while nothing counted — and, since the setting is shared by a preset's
  // copies, a guest flipping it recorded the owner's PARKED practice round when it came
  // back. The other direction was wrong too: a recorded round whose score an Override then lowered
  // kept its old Best for as long as Save Stats was off.
  // WHY ONCE PER ROUND AND NOT ONCE PER ENDING. A press can put an ended round back in play, and the
  // press after it can end it again without a single date being answered in between (Override, then
  // Undo, on the card that ended it). When every ending was judged afresh, that pair of presses was a
  // way to change the verdict of a round already played: turn Save Stats on, press twice, and the
  // practice round became a recorded Best; turn it off, press twice, and a recorded round lost its.
  // A round is practice or it is not, from its first ending on.
  const recordedRef = useRef<boolean | null>(parkedRound?.recorded ?? null)
  // File the round's result (or, null, take it back whole) — only a round that COUNTS (recordedRef)
  // ever files anything, in either direction.
  const fileResult = (values: { score: number; streak?: number } | null) => {
    if (roundId === null || !recordedRef.current) return
    const text = JSON.stringify(values)
    if (filedRef.current === text || (values === null && filedRef.current === null)) return
    const { map, setup } = roundRecordRef.current
    if (fileRoundResult(dataId, map, setup, roundId, values, filedRef.current !== null))
      filedRef.current = text
  }
  // saveStats:true ALWAYS (like AoX): the round tracks internally regardless of the global Save
  // Stats toggle, which now gates only the DISPLAY (a dimmed strip of "—"), whether a Best is recorded,
  // and whether Override shows while off. Always-tracking keeps the misclick-rescue credit
  // integrity-safe in practice mode (good ≤ played — played is always incremented on the wrong),
  // so an unscored question can't hit the good>played landmine. (It was `saveStats`.)
  const eng = useGameEngine({
    label: 'blitz',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats: true,
    timingOff: false,
    play: visible && active ? 'live' : 'idle', // while a round is under way
    // Round 21 — seed the reducer from the parked ended round when there is one (a getter, read
    // once in the lazy init). `parkedRound` was keyed to the bests copy live at mount, so this only
    // ever restores the incoming copy's own round and cannot pull in the one just left.
    getInitialState: () => parkedRound?.engine ?? null,
  }) // Blitz: timing always tracked
  // Override availability is uniform — NOT gated on the live `saveStats` (owner's call: gating
  // it made Override more forgiving when Save Stats is ON than OFF, which is backwards). Blitz
  // always-tracks internally (saveStats:true above), so the engine's overrideAvail (which uses the
  // frozen effective save-stats, always true here) is correct in both states; the credit is just
  // invisible in practice mode (stats dimmed, no Best recorded).
  const { state, correct, overrideAvail, overridden } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode. Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/overlayStack.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const S = state.stats
  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse

  // (Round 23: `resumableEnd = timerDone && state.countedWrong` lived here — one boolean standing
  // for "a player action, not the clock, ended this round". It became the `endKind` the ending itself
  // records, because a press can now end a round too, and that end has different clock rules from an
  // action's; see EndKind at the top and `onOverride`. The old corner it documented still holds and is
  // recorded where the countdown decides its kind: a Per Question expiry on a card the player had
  // ALREADY answered wrong is an 'answer' end, and crediting that card resumes the round with a fresh
  // question clock — exactly what a judged-correct answer would have granted before the expiry.)

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
  // Draw `r` remaining seconds on the running sub-mode's bar + readout. Direct DOM writes, like every
  // frame of the countdown — a React render per frame would be the expensive way to move one bar.
  // ⚠ SPLIT FROM paintClock ON PURPOSE (round 23). A 'toggle'-ended round's remaining is DERIVED
  // (`remainNow` = the stamped base minus the wall-clock gap), so its drain loop must draw without
  // writing the base back — storing the charged value while the stamp stood still would charge the
  // same seconds again on the next frame, and the clock would drain at compounding speed.
  const drawClock = (r: number) => {
    const length = perQ ? qSec : blitzSec
    const sx = length > 0 ? Math.max(0, Math.min(1, r / length)) : 1
    if (clockBarRef.current) clockBarRef.current.style.transform = 'scaleX(' + sx + ')'
    drawReadout(r)
  }
  // The time left, in words — the readout half of drawClock. Whole seconds, rounded up, as a countdown
  // reads — but NEVER MORE THAN THE LIMIT (Round 26 review): a Per Question limit can be a half second
  // (the slider's step), and 7.5 rounded up read "8s" at Begin, a second above what the slider had
  // just said. So the readout starts on the limit itself ("7.5s", the slider's own value in its own
  // place) and is whole seconds from the moment that is the larger. (A Per Round limit is a multiple
  // of five seconds: rounding it up never passes it.)
  const drawReadout = (r: number) => {
    if (clockTimeRef.current)
      clockTimeRef.current.textContent = perQ ? Math.min(Math.ceil(r), qSec) + 's' : fmtBlitzT(r)
  }
  // …and the same draw that also records `r` as the round's remaining. Everything that CHANGES the
  // clock goes through here; only the derived drain loop uses drawClock directly.
  const paintClock = (r: number) => {
    clockRemainRef.current = r
    drawClock(r)
  }
  // ★ AN ENDED ROUND'S CLOCK, AS IT READS NOW — the one place the freeze/drain rule lives (see
  // EndKind). An 'answer' or 'clock' end froze at its stamp; a 'toggle' end has been draining ever
  // since, in wall-clock seconds, minus any time the rotate-back overlay held the app (the pause
  // effect below pushes `endedAt` forward, exactly as the live clocks fold a pause into their
  // accumulators — the gap charges the player for thinking, not for turning their phone).
  const remainNow = () =>
    endKind === 'toggle' && endedAtRef.current != null
      ? Math.max(0, clockRemainRef.current - (Date.now() - endedAtRef.current) / 1000)
      : clockRemainRef.current
  // The countdown's first drawing: a restored ended round shows the clock it stopped on — the readout
  // and bar it had before the switch — and with nothing parked it is the configured length. The
  // markup renders neither (clockBarRef), so this is the one draw before Begin. A layout effect so the
  // first paint is already right. Mount-only: after this, every change to the clock is drawn by the
  // code that makes it — and while no round is up the countdown is not on screen at all (the slot
  // shows the slider), so a length changed in the meantime is drawn by the Begin that uses it.
  // A round parked mid-'toggle'-gap is drawn at its CHARGED reading (drawClock, so the stamped base
  // survives for remainNow to keep charging against) — the seconds spent in the other preset count.
  useLayoutEffect(() => {
    drawClock(remainNow())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design (see above)
  }, [])
  // The round-over state with the clock stopped — the ONE writer of `timerDone = true`, and of
  // `endKind`. endRound is how play reaches it; a press that ends a running round calls it too.
  const settleEnded = (kind: EndKind) => {
    setActive(false)
    setShowTimerDate(true)
    setTimerDone(true)
    setEndKind(kind)
    // Only a 'toggle' end has a gap to charge; the other two freeze, so they must not leave a stamp
    // a later 'toggle' end could be charged against.
    endedAtRef.current = kind === 'toggle' ? Date.now() : null
    stopRound()
  }
  const endRound = (kind: EndKind) => {
    // Stamp the EXACT remaining time at this instant into clockRemainRef BEFORE settleEnded() nulls
    // the clock refs, so a later Override-resume (Per Round) continues from the true remaining rather
    // than the last rAF frame's value (up to a frame stale, always in the player's favor), and an Undo
    // that re-ends a resumed round can put back the readout this ending left. On a clock-expiry end
    // the remaining is already ~0. (F: Blitz resume sub-frame timer drift.)
    const r = clockRemainAt(performance.now())
    if (r != null) clockRemainRef.current = r
    settleEnded(kind)
  }

  // Countdown loop (Per Round drains the round clock; Per Question drains the question clock). On 0
  // the round ends — per-round timeout shows the answer with no stat (lockReveal); per-Q timeout
  // counts a miss (timeoutMiss). Gated off while the rotate-back overlay pauses the clock so
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
          // 'clock' unless the card the clock ran out on was ALREADY a scored miss — the Per Question
          // + Allow Mistakes corner where a wrong answer leaves the round running on the same card.
          // That end is the one the player can still fix by crediting that card, so it is an 'answer'
          // end (exactly the old `resumableEnd`, which read countedWrong for the same reason).
          // Neither timeout action sets countedWrong, so this pre-dispatch read is also its value after.
          endRound(state.countedWrong ? 'answer' : 'clock')
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clockRemainAt / paintClock / endRound are behavior-stable (they close over only the deps listed, stable setters and refs); excluded so their identity change doesn't restart the countdown. `state.countedWrong` needs no dep of its own: `eng` carries `state`, so every engine change already re-runs this with a fresh closure.
  }, [active, perQ, blitzSec, qSec, eng, clockPaused])

  // Rotate-overlay clock freeze. The countdown math above ALREADY carries pause
  // bookkeeping — blitzPausedAcc is subtracted from the round's elapsed, qPausedAcc extends
  // the question deadline (designed in with the clocks, dormant until now) — and this effect
  // is what engages it: while the rotate-back overlay covers the app (clockPaused), stamp the
  // pause start; on rotate-back (the cleanup) fold the paused span into the accumulators so
  // both clocks resume exactly where they stopped. The rAF loop is gated off while paused
  // (nothing visible to draw, and the round must not expire behind the overlay). Both
  // sub-modes' refs are stamped unconditionally — the idle one's accumulator is reset by armClock
  // (Begin / a fresh question clock / a resume / an Undo) before its clock ever reads it; the
  // null-guards make the fold a no-op if the round was torn down mid-pause (stopRound nulls them).
  // A LAYOUT effect, for the park's sake: the park (below) relies on this cleanup moving a 'toggle'
  // end's stamp before its own body runs, which holds only while the two share a phase.
  useLayoutEffect(() => {
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
      // …and the same fold for a 'toggle'-ended round's draining gap (round 23). It cannot use an
      // accumulator like the two above, because the gap is measured in WALL-CLOCK time so that it
      // survives a preset switch — so the stamp itself moves forward by the paused span, which leaves
      // `Date.now() − endedAt` reading exactly the un-paused gap. Same rule, one clock later: an
      // ended round charges for thinking, never for turning the phone.
      if (endedAtRef.current != null) endedAtRef.current += dt
    }
  }, [clockPaused])

  // ★ THE ENDED ROUND THAT IS STILL DRAINING (round 23). A 'toggle'-ended round keeps its clock
  // running (see EndKind), and the player can SEE the readout — so it has to be drawn, or the screen
  // would promise time the round no longer has. This is the countdown loop's other half: it paints
  // remainNow() and, at zero, demotes the end to 'clock' — the round waited out its own clock, so
  // there is nothing left to resume into and it can never come back. No engine action fires (the live
  // card was never judged; nothing was played), and the demotion is what makes that permanent.
  useEffect(() => {
    if (!timerDone || endKind !== 'toggle' || clockPaused) return
    let raf = 0
    const loop = () => {
      const r = remainNow()
      drawClock(r)
      if (r <= 0.001) {
        // Bank the zero into the base and drop the stamp BEFORE demoting: from here remainNow() is
        // the plain frozen read, and it must agree with the 0 on screen — a base still saying 27
        // seconds behind a readout saying none would offer a resume the round has not got.
        paintClock(0)
        setEndKind('clock')
        endedAtRef.current = null
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remainNow / paintClock are behavior-stable (refs + the deps listed); excluded so their per-render identity does not restart the sweep
  }, [timerDone, endKind, clockPaused, perQ, blitzSec, qSec])

  // Arm the running sub-mode's clock with `r` seconds left — the one home for the stamp (pause
  // bookkeeping cleared, display redrawn). Per Round: the round started (blitzSec − r) ago. Per
  // Question: the deadline is r from now. Begin arms a full clock; a correct answer and an in-round
  // Override credit that ADVANCED arm a FRESH question clock; a resume arms what the ended
  // round has left — its frozen stamp, or, for a 'toggle' end, the stamp charged for the gap.
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
    setRoundId(newRoundId())
    // The record this round files its result on (the sub-mode and set-up it is played under), and
    // nothing filed yet.
    roundRecordRef.current = perQ
      ? { map: allowMistakes ? 'suddenAmBest' : 'suddenBest', setup: suddenBk }
      : { map: 'blitzBest', setup: blitzBk }
    filedRef.current = null
    roundConfigRef.current = roundConfig
    recordedRef.current = null // a fresh round: whether it counts is settled when it first ends
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    setEndKind(null) // a fresh round has not ended
    endedAtRef.current = null
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
      // Override credit advances.
      if (!allowMistakes) {
        eng.lockReveal()
        endRound('answer') // the live card is now a resolved miss — crediting it resumes the round
      }
    }
  }
  // Put an ENDED round back on the clock with `remain` seconds left — the ONE door back, used by the
  // Override ⇄ Undo press below for both kinds of end it can undo (see EndKind and `onOverride`).
  // Two halves: (1) take the round's result back off its record (the round's provisional filing is
  // gone; it files again only when the round genuinely ends — and its ★, derived from the record's
  // ids, goes out with it); (2) re-arm the clock with whatever the caller says is left. An 'answer' end passes Per Round its frozen stamp (the countdown continues WHERE IT
  // STOPPED) and Per Question a fresh qSec on the already-advanced next date (restoring the
  // pre-rewrite behaviour the Blitz mode-untangle dropped — original 7176a50 did exactly this);
  // a 'toggle' end passes the stamp CHARGED for the gap, in both sub-modes, because its live
  // card never left the screen and no fresh date was drawn.
  const resumeRound = (remain: number) => {
    // What is taken back is THIS round's result, and only it: the record falls to the best of every
    // other round, whoever played it since. (Through store/screenPool: a press on a screen drawn for a
    // copy that is no longer live takes nothing back from the one that is — that screen is about to be
    // remounted anyway.)
    fileResult(null)
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    // (The breakdown, if it was open, goes with the ending: its flag is put down the moment the
    // round is no longer over — the guard beside `breakdownAvail`. The only route here with the popup
    // up was App's keyboard handler finding Override through the scrim, which is closed too.)
    setEndKind(null) // live again: nothing ended, and nothing to charge a gap against
    endedAtRef.current = null
    armClock(remain)
  }
  // ── Override ⇄ Undo (round 23: one permanent per-card toggle) ─────────────────────
  // ONE PRESS, BOTH DIRECTIONS — and it can change the ROUND, not just the score: it can put an ended
  // round back on the clock, and it can end a running one. Which of those it does is read off the
  // engine's plan (what this press will do, and to which card) BEFORE the press, from the same object
  // the reducer acts on, so the round's half and the score's half can never be told different stories.
  //
  // ★ THE TWO ROUND RULES, and they are each other's inverse:
  //   • A press that leaves a card a MISS while the round is RUNNING and Allow Mistakes is off ENDS
  //     it — the long-standing "an override to a wrong is a mistake like any other", now reachable
  //     from the Undo direction too. That is a 'toggle' end: the live card was never touched, so its
  //     clock keeps draining while the round waits (EndKind). It cannot BE the live card, and that is
  //     structural rather than lucky — taking a credit away needs a credited card, and the only
  //     credited card that ever sits at the live edge is one a press HELD there, which only ever
  //     happens on a round that is already ended.
  //   • A press on an ENDED round that leaves the round LEGAL again resumes it. "Legal" is the round's
  //     own rule: with Allow Mistakes off, no misses at all; with it on, the card whose miss ended the
  //     round — the live one — credited. A 'clock' end is never legal again (the time is gone), a
  //     round being BROWSED is not resumed under the player's feet, and a clock with nothing left on
  //     it cannot be resumed into.
  // Nothing is remembered between presses: both halves are derived, every time, from the state and the
  // plan — which is what makes any number of presses on any cards land where the last one says. The
  // Best records and their ★ need nothing here either: the filing effect files the round's result as
  // it now stands, resumeRound takes it back, and the ★ is read off the records' round ids — a
  // restored round included, since it keeps its id.
  const onOverride = () => {
    const plan = eng.overridePlan
    if (!plan) return
    // The round as this press will leave it. `played` never moves (a toggle neither adds nor removes a
    // card) and `good` moves by one in the card's new direction; the live card's credit is the plan's
    // own when the press targets it. A press that ADVANCES is deliberately counted here as crediting
    // "the live card": the card it credits is the cause of an 'answer' end, and fixing that cause is
    // what makes the round legal again, wherever the engine then files the card.
    const goodAfter = S.good + (plan.credits ? 1 : -1)
    const liveCreditAfter = plan.target === 'live' ? plan.credits : liveCredited(state)
    // …and the clock that resume would arm. ⚠ THE GATE IS THIS NUMBER, NOT THE STAMP, and the
    // difference is a ratified corner: a Per Question round whose clock expired on a card the player
    // had already answered wrong stamps ~0 remaining, yet crediting that card resumes it with a FRESH
    // question clock — exactly what a judged-correct answer would have granted a moment earlier. Gating
    // on the stamp would have silently killed that rescue. Every other end resumes into its own
    // remaining, so for them the two readings are the same number.
    const resumeWith = endKind === 'answer' && perQ ? qSec : remainNow()
    const resumes =
      timerDone &&
      endKind !== 'clock' &&
      state.backDepth === 0 &&
      (allowMistakes ? liveCreditAfter : S.played === goodAfter) &&
      resumeWith > 0.001
    // ⚠ THE ONE PLACE BLITZ ASKS THE ENGINE TO HOLD: a press that credits the live card while the
    // round is STAYING ended must not move play on, because advancing would draw a fresh date onto a
    // dead round — a question nobody can answer, carrying a Q№ nobody played. While the round runs,
    // or when this press resumes it, the credit advances exactly as it always has.
    const hold = timerDone && !resumes
    const advances = overrideAdvances(plan, hold)
    // The green pulse on a press that credits the live card — held on an ended round or not (the
    // engine's creditsLiveCard, one rule for every mode).
    if (creditsLiveCard(plan)) setFlashWithTimeout({ type: 'good', idx: correct })
    eng.override({ hold })
    if (resumes) {
      // 'answer': Per Round continues from its frozen stamp, Per Question gets a fresh clock on the
      // date the credit advanced to (owner-ratified — that card's answer was already on screen).
      // 'toggle': the stamp CHARGED for the gap, in both sub-modes, on the same live card.
      resumeRound(resumeWith)
    } else if (active && !plan.credits && !allowMistakes) {
      endRound('toggle')
    } else if (active && perQ && advances) {
      // A fresh question clock for the fresh date, exactly as a correct answer grants one — a new date
      // must never inherit the drained clock of the one before it. This is the ONLY in-round arm
      // a press makes: a toggle on any card that is not the live one leaves the live question's clock
      // alone, which is what stops Override ⇄ Undo refilling it a press at a time.
      armClock(qSec)
    }
  }
  const onReveal = () => {
    eng.reveal()
    endRound('answer') // the live card is a resolved miss now, with its answer on screen
  }
  // Opening Show Codes during an active round ends the round (so Best Score is recorded and
  // the countdown stops), exactly like Reveal — bug #3. The original applyCalcPenalty ended
  // the round for an active timer; the Blitz migration dropped it (bare eng.showCodes).
  const onShowCodes = (open: boolean) => {
    // Read BEFORE the dispatch: does this open penalise the live date? (A browsed date's codes are a
    // read-only review and change nothing.)
    const resolvesLive = open && showCodesPenalizes(state)
    eng.showCodes(open)
    if (open && active) endRound('answer')
    // ★ THE ONE WAY A 'toggle' GAP CAN END WITHOUT A PRESS. Show Codes is the only control still
    // offered on an ENDED round that resolves the live card — and that is exactly what a 'toggle' end
    // was waiting on: the card's answer is now on screen, so there is nothing left to read and the
    // clock must stop draining. Convert the end to 'answer' and freeze the remaining at its CHARGED
    // value, so the gap already spent is kept and no further second is charged. (Reveal is withheld
    // while timerDone and the grid does not answer, so no other route reaches this.)
    // ⚠ ONLY WHEN IT DID RESOLVE THE LIVE DATE (`resolvesLive`). The codes open on an ended round
    // while BROWSING too, and there they are a read-only review of a past date: the live date stays
    // unanswered, so the drain must go on. Converting there was a free pause on demand, and in Per
    // Question an 'answer' end resumes with a fresh question clock — on the same unanswered date.
    else if (resolvesLive && timerDone && endKind === 'toggle') {
      paintClock(remainNow())
      setEndKind('answer')
      endedAtRef.current = null
    }
  }
  const resetRound = () => {
    eng.resetStats()
    setRoundId(null) // no round on screen — and so no ★: a best is marked only while its round is up
    recordedRef.current = null // …and no verdict: it belonged to the round being cleared
    setActive(false)
    setTimerDone(false)
    setEndKind(null) //  no round, so no end
    endedAtRef.current = null
    setShowTimerDate(false)
    stopRound()
    // ★ A RESET ROUND IS A RESET COUNTDOWN (Q11): the full configured length, as the remaining the
    // next Begin starts from and on the readout (which the slot hides the moment the round is gone).
    // This reset once left the readout on whatever the round last drew — a countdown frozen through
    // the Reset.
    // ⚠ BUT NOT ON THE BAR, WHICH IS STILL ON SCREEN, FADING OUT (the slot's cross-fade, .range-clock,
    // under Reduce Motion off): drawn full here, it flashed a whole countdown for the length of the
    // fade where the round's own reading had been. It fades out as the round left it; every way the
    // countdown comes back on screen draws it first — Begin and a resume through armClock, a restored
    // round through the mount draw.
    clockRemainRef.current = perQ ? qSec : blitzSec
    drawReadout(clockRemainRef.current)
  } // App's arm (resets stats for blitz)

  // Leaving the mode mid-round ABANDONS the round (the original App discarded an active round
  // on switch-away; AoX resets a hidden running run and Flash stops a live flash the same way —
  // this teardown was missed in the Blitz migration). Without it the hidden rAF countdown kept
  // draining behind display:none: a per-question timeout would count a phantom MISS in absentia,
  // and the round would end + reconcile a Best for play the user walked away from. The ended
  // (timerDone) state DOES survive a detour, like AoX's done run. (Pinned in blitz.dom.)
  // ⚠ Both directives below are repositioned, not new behaviour — same cause as the other
  // extracted modes: in main.tsx's one-line style the call, the closing brace and the dep array
  // shared a line, so a single trailing directive covered all of it. Prettier splits them and a
  // line directive only covers its own line. The set-state disable is new for the reason recorded
  // in FlashMode: the React Compiler never analyzed this component inside main.tsx, so the rule
  // was silent there. The main.tsx split is a verbatim move; ▶ queued for proper review as its own item.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible && active) resetRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // On the ⚙ popover CLOSE, reconcile Blitz against the new settings: an ACTIVE round OR an
  // ENDED round (timerDone) RESETS as if Reset was pressed — its config (and any recorded Best) is now
  // stale. This RESTORES the documented "a settings change ends an active Blitz round" behavior the
  // mode-untangle dropped (BlitzMode had no settings effect; AoX does this via its own close-effect)
  // AND applies the ended-round reset so the round on screen always matches the current settings. Idle
  // has no live round/date to reconcile. Deferred to close (batched, no per-keystroke churn). The two
  // timer lengths are in the deps because Reset Settings can now restore them mid-round (round 6):
  // the sliders are idle-locked, so the only in-popover writer of blitzSec/qSec is Reset Settings, and a
  // reset that lands a fresh timer must reconcile the running/ended round exactly as a panel change does.
  // Per-Round/Question and Allow Mistakes are in the deps for ANOTHER WINDOW'S change of them (the
  // third case, components/useSettingsCloseEffect): here they are idle-locked, so they never change
  // under a live or ended round — but a change made in another window does, and resets it the same way.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [dateDraw, useJulian, blitzSec, qSec, perQ, allowMistakes],
    () => {
      if (active || timerDone) resetRound()
    },
  )

  // FILE THE ROUND'S RESULT while it is over — when it ends AND after every post-round Override that moves
  // its stats: the round's own score and best streak (sudden death: its score), on the record of the
  // sub-mode and set-up it was played under (roundRecordRef — never the live keys, which the ⚙ panel can
  // move while the round sits ended). The record keeps every round's figures beside it
  // (store/syncRecords), so an Override that raises the round's score takes a field only by beating
  // every other round, and the one that lowers it again hands the field to the next best round —
  // whoever played it, in whichever window, since — with nothing to remember here (the ★ is read off
  // the records' ids).
  // ★ ONLY A ROUND THAT COUNTS FILES (recordedRef): a round that first ended in practice mode (Save
  // Stats off) plays and tracks internally but records NO Best, whatever the setting or an Override
  // does afterwards — and a recorded one keeps being filed whatever the setting does afterwards.
  // The verdict is taken here, ONCE, in the commit the round first ends in, from the Save Stats value
  // that commit rendered with; a round put back in play and ended again keeps the one it has.
  // ★ A LAYOUT EFFECT, AND THE PARK BELOW IS ONE TOO (Round 26, F1): both run INSIDE the commit the
  // round ends in, so there is no moment in which an ended round is on screen and not yet filed and
  // parked — and so no tap (an Amnesic change, a preset switch, Full Reset) can land between the two.
  // As passive effects they ran in a later task when the round ended on its clock (a frame callback,
  // not a tap), and a tap in that gap had already swapped the copy under them: a guest's score was
  // filed as a permanent Best (tests/screenPool.gap.dom). Every filing also names this screen's copy
  // to store/screenPool, which refuses it once that copy is not the live one — whatever the timing.
  useLayoutEffect(() => {
    if (!timerDone) return
    if (recordedRef.current === null) recordedRef.current = saveStats
    fileResult(
      roundRecordRef.current.map === 'suddenBest'
        ? { score: S.good }
        : { score: S.good, streak: S.best },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerDone, saveStats, S.good, S.best, roundId, dataId])

  // Round 21 — mirror an ENDED round to sessionStorage, keyed by the bests copy this screen was
  // mounted on (`bestsId`), exactly as the effect above mirrors the round's Best to store/progress. On
  // the remount a preset switch or an Amnesic change causes, the mount-time reads restore whatever is
  // parked for the now-live copy (see `parkedRound`). Only an ENDED round is parked; every other state DISCARDS the slot:
  //   • in-progress (active, !timerDone) → discard, so a mid-round switch parks nothing and the
  //     remount starts fresh — the owner's requirement — and any stale blob from a prior round goes;
  //   • idle after a manual Reset / Begin / an Override that resumed the round → discard, the park
  //     is no longer the truth.
  // `state` is a dep so a post-round Override (which edits the ended round's engine state and
  // re-runs the filing effect above) re-parks the updated snapshot — and with it what that effect
  // filed (filedRef, written in the same commit, before this runs). `roundId` is a dep only because it
  // is state read here; it and roundRecordRef are written only by begin(), which also flips
  // active/timerDone, so they are already stable whenever timerDone is true (the refs need no dep of
  // their own). clockRemainRef needs none
  // either: every writer that can leave a round ended — endRound's stamp, the drain loop's final zero,
  // and Show Codes freezing a 'toggle' gap — writes it in the same commit that changes timerDone or
  // endKind, before this runs.
  // ⚠ `clockPaused` IS a dep, for the one ref that moves on its own: endedAtRef. The rotate pause's
  // release pushes a 'toggle' end's stamp forward by the paused span (the pause effect above), and
  // without a re-park the blob kept the stamp from before the pause — so a preset switch after a
  // rotation charged the restored round for every second the overlay was up. The release runs as that
  // effect's CLEANUP, and React runs every cleanup of a commit before any effect body, so this body —
  // re-run because `clockPaused` changed in the same commit — always parks the moved stamp. That holds
  // only while the two share a PHASE: both are layout effects (the filing above says why this one
  // is), so the pause's cleanup still runs before this body.
  useLayoutEffect(() => {
    // (`endKind` is set by the same call that sets `timerDone` — settleEnded — so the two tests are
    // one fact; naming both is what lets the snapshot's `endKind` be the plain type.)
    if (timerDone && endKind)
      parkRound(dataId, bestsId, 'blitz', {
        engine: state,
        timerDone,
        showTimerDate,
        active,
        currentRoundId: roundId,
        record: roundRecordRef.current,
        filed: filedRef.current,
        config: roundConfigRef.current,
        remain: clockRemainRef.current,
        // WHY this round ended, and — for a 'toggle' end — the wall-clock instant it did, so the
        // charge for the gap keeps running across the switch instead of resetting to free.
        endKind,
        endedAt: endedAtRef.current,
        // The round's verdict, taken by the filing effect above — which is declared first, so it
        // has already run in the commit that first ended the round.
        recorded: recordedRef.current === true,
      } satisfies BlitzRoundSnapshot)
    else unparkRound(dataId, bestsId, 'blitz')
  }, [timerDone, active, showTimerDate, state, endKind, clockPaused, roundId, bestsId, dataId])

  // Both toggles are bare idle-gated flips — fully independent since Per Question gained Allow Mistakes (the old auto-off
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
  // defaults — the saved personal defaults when they exist (store/userDefaults); the
  // excluded config (perQ, allowMistakes, the visual-only timingOff) stays factory-fixed
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
    // Nothing on the card: never wrong, never overridden (round 23 — one record replaced the four
    // flags the old Override machinery kept here; same pair as modeHooks.engineFresh).
    state.card.wrongTime === null &&
    state.card.answered === null &&
    state.calcOpen === false &&
    active === false &&
    timerDone === false &&
    endKind === null &&
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
  // always equals score. With Allow Mistakes on it behaves exactly like per-round.
  const showStreak = !perQ || allowMistakes
  // The timing trio (Last/Mean/Median) carries a VISUAL-ONLY hide toggle: tap any of the
  // three to blank them all. Unlike Classic/Deduction/Flash there is NO engine timingOff and NO
  // "Enable and Reset Stats?" arm — Blitz always tracks (saveStats:true above), so hiding can never
  // desync (structurally desync-proof). (Persisted as blitzTimingOff — excluded from the defaults
  // system.) Save Stats off drops the toggle, exactly as it does for the scoring trio.
  //
  // ★ `off` is the USER'S hide toggle and nothing else (round 16) — so it is `timeHidden`
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
  // It is also the flag the result-filing effect gates on — a Blitz round that ends on a wrong in
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
  // The open flag never outlives what justified it — put down, not masked, the moment the breakdown
  // has nothing to show (modes/AoxMode argues it at the twin of this line: leaving the screen with
  // the popup up and coming back used to reopen it) — but not by a Save Stats change, which only
  // another window can make while it is up (modes/AoxMode, B V7).
  if (breakdownOpen && !(timerDone && visible)) setBreakdownOpen(false)
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
  // A round is UP from Begin until Reset — running, or ended and not yet reset. It locks the round's
  // set-up controls, swaps Begin for Reset, and is which face the ONE slot shows (the ★ above the
  // slot in the markup). The slider = the time limit of the timing sub-mode in play, with everything
  // its two controls need.
  const roundUp = active || timerDone
  const slider = perQ
    ? {
        min: 1,
        max: 30,
        step: 0.5,
        value: qSec,
        set: setQSec,
        label: 'Blitz question timer',
        inputMode: 'decimal' as const,
        format: (v: number) => v + 's',
        fill: Math.round(((qSec - 1) / 29) * 100) + '%',
      }
    : {
        min: 10,
        max: 300,
        step: 5,
        value: blitzSec,
        set: setBlitzSec,
        label: 'Blitz round timer',
        inputMode: 'numeric' as const,
        format: fmtBlitzT,
        fill: Math.round(((blitzSec - 10) / 290) * 100) + '%',
      }
  // ★ THE BESTS SHOWN: each the pool's, through the one door (engine/bestPool) — this set-up's own
  // record and every record filed for the same dates under stored values before Round 26. Never
  // `blitzBest[blitzBk]` and the like: that record can be lower than what the pool holds.
  const bScore = shownBlitzBest(blitzBest, blitzBk),
    sScore = shownSuddenBest(suddenBest, suddenBk),
    saScore = shownBlitzBest(suddenAmBest, suddenBk)
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
        // The Best readouts, in the row under the strip (components/BestReadout, which StatPanel
        // renders): one record per sub-mode, and sudden death's is a score alone.
        bests={
          !perQ ? (
            <BlitzBestRow rec={bScore} roundId={roundId} />
          ) : allowMistakes ? (
            <BlitzBestRow rec={saScore} roundId={roundId} />
          ) : (
            <BestLine>
              <BestColumn>
                <div>
                  Best Score: {sScore?.score ?? EM_DASH}
                  {isNewBest(sScore?.roundId, roundId) && <NewBestStar />}
                </div>
                {/* One number, so no small line — but the line's height, so the row stays put
                    when Allow Mistakes is turned on and off beneath it. */}
                <BestSubLine spacer />
              </BestColumn>
            </BestLine>
          )
        }
      />
      {/* Mounted only while up — see the component header, and the twin site in modes/AoxMode. */}
      {breakdownOpen && (
        <RunBreakdown
          onClose={() => setBreakdownOpen(false)}
          data={buildRunBreakdown(state, useJulian)}
          fmtDate={fmtDate}
          title={perQ ? 'Run Breakdown' : 'Round Breakdown'}
        />
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={toggleAllowMistakes}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${roundUp ? ' opacity-60 pointer-events-none' : ''}`}
        >
          Allow Mistakes
        </button>
        <button
          type="button"
          onClick={togglePerQ}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border btn-solid border-transparent ${roundUp ? ' opacity-60 pointer-events-none' : ''}`}
        >
          {perQ ? 'Per Question' : 'Per Round'}
        </button>
      </div>
      {/* ★ ONE SLOT: THE TIME LIMIT'S SLIDER, AND THE COUNTDOWN IT SETS (Q12, the owner's idea — a try
          for his phone). The two were never useful at the same moment: idle, the countdown under the
          slider only repeated the slider's own number; from Begin until Reset the slider was a dimmed
          control nobody could move. So they share one row:
            • IDLE — the slider and its value box (tap the value to type), as before.
            • FROM BEGIN UNTIL RESET (`roundUp`) — the same track is the countdown. The slider fades
              out, thumb and fill with it, and the countdown's track fades in exactly over it: the same
              size, the same unfilled colour (the range rules in index.css), full at Begin and draining
              from there. The value box's place shows the time left, in the same cell and the same type,
              so the number never moves. A round that has ENDED keeps its countdown on screen, where it
              stopped (or still draining, after a tap ended it — see EndKind), until Reset brings the
              slider back. Nothing changes size: the input stays mounted under the countdown, so the
              track keeps its box, and the value cell keeps the widest-value strut.
            • The cross-fade is decorative and runs on --motion-scale (index.css's .range-slot /
              .range-clock): with Reduce Motion it is instant. The drain itself is the countdown's
              functional motion, transform:scaleX on a GPU layer, exactly the .bar countdown's.
            • KEYBOARD AND SCREEN READERS: while it is a countdown the slider is disabled (not
              operable, not focusable) and hidden from assistive tech, the value box with it; what is
              there instead is a timer, read as "Time left" and its value. */}
      <div className="mt-3 flex items-center gap-2">
        <span className="relative flex-1 min-w-0">
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={slider.value}
            onChange={(e) => slider.set(+e.target.value)}
            disabled={roundUp}
            aria-hidden={roundUp || undefined}
            aria-label={slider.label}
            style={{ '--rng-fill': slider.fill } as React.CSSProperties}
            className={`range-slot block w-full ${roundUp ? 'opacity-0' : 'opacity-100'}`}
          />
          <span
            aria-hidden="true"
            className={`range-clock ${roundUp ? 'opacity-100' : 'opacity-0'}`}
          >
            <span ref={clockBarRef} />
          </span>
        </span>
        {/* The value cell: the value box and the time left stacked in ONE grid area, so they share a
            box — the value box's widest-value strut sets it, and both are one text-xs line in it, on
            one baseline. (The flex wrapper keeps the value box's inline-block from sitting on a line
            of the row's own, larger, text.) */}
        <span className="grid shrink-0">
          <span className={`col-start-1 row-start-1 flex ${roundUp ? 'invisible' : 'visible'}`}>
            <SliderValueEditor
              key={perQ ? 'question' : 'round'}
              value={slider.value}
              min={slider.min}
              max={slider.max}
              snap={slider.step}
              disabled={roundUp}
              inputMode={slider.inputMode}
              label={slider.label}
              format={slider.format}
              toText={String}
              widest={SLIDER_READOUT_WIDEST}
              onCommit={slider.set}
            />
          </span>
          <span
            role="timer"
            className={`col-start-1 row-start-1 whitespace-nowrap tabular-nums text-xs text-right ${roundUp ? 'visible' : 'invisible'}`}
          >
            <span className="sr-only">Time left </span>
            <span ref={clockTimeRef} />
          </span>
        </span>
      </div>
      <div className="mt-4 rounded-2xl panel p-4">
        <div className={DATE_CARD_CLASS}>
          <CardNumber state={state} show={state.backDepth > 0} />
          <DateLine
            numberDigits={String(topCardNumber(state)).length}
            shapes={dateLineShapes(
              [state.date, ...state.stack, ...state.forwardStack],
              dateFormat,
              randomFormat,
              minY,
              maxY,
            )}
          >
            {dateText}
          </DateLine>
        </div>
        <WeekdayAnswer
          key={state.gridEpoch}
          screen="blitz"
          inputStyle={inputStyle}
          dotRotation={dotRotation}
          persistBtns={state.persistBtns}
          flash={flash}
          optionsDisabled={optionsDisabled}
          onPick={onAnswer}
        />
      </div>
      <div className="mt-4 rounded-2xl panel p-3 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {roundUp ? (
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
          <OverrideButton avail={overrideAvail} overridden={overridden} onToggle={onOverride} />
        </div>
        <MethodBreakdownSection
          date={shouldShowTimerDate ? date : null}
          open={state.calcOpen}
          onOpenChange={onShowCodes}
          className=""
          useJulian={eng.julian}
          displayedFormat={date?._fmt || dateFormat}
        />
      </div>
    </div>
  )
}

export default BlitzMode
