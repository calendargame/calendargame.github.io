// ★ THE HOOKS ARE NAMED IMPORTS, AND THAT IS LOAD-BEARING — DO NOT "TIDY" IT BACK TO
// `import * as React` + `const { useEffect, … } = React`. That form defeats the react-hooks /
// React-Compiler ESLint rules' detection: they resolve hooks through the import, so a namespace
// binding makes the WHOLE FILE invisible to them. (This file inherited the bad form from main.tsx,
// which carried it until round 16 — main.tsx now uses named imports too, and the two
// set-state-in-effect violations that had been hiding behind it were fixed rather than suppressed.
// LookupCard.tsx and MethodBreakdown.tsx are the last two files still calling their hooks as
// React.useX, and are still invisible to the rules — see the escalation with round 16. modeHooks
// and useSettingsCloseEffect also write `import * as React`, but ONLY for React.DependencyList in a
// type position; their hooks are named imports, so the rules do see them.)
// Verified by probe in round 14 — swapping this one line back takes `eslint` on this file from
// reporting a genuine react-hooks/set-state-in-effect error (in the Full Reset safety net, see
// ~line 545) to clean. Nothing about the code changes; only whether anything is looking at it.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import {
  janFebChanceApplies,
  julianChanceApplies,
  leapChanceApplies,
  yearRangeInEffect,
} from '../lib/dateConfig.js'
import { fmt, numericFormatOf } from '../lib/format.js'
import { YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN } from '../lib/calendar.js'
import { blockMinus, blockMinusBI } from '../lib/modeFormat.js'
import { largestFit } from '../lib/textFit.js'
import { UPDATE_CHECK_LABEL } from '../lib/updateCheck.js'
import type { UpdateCheckState } from '../lib/updateCheck.js'
import { GroupLabel, SectionLabel } from './primitives.jsx'
import { PillTray } from './PillTray.jsx'
import { PillGroup } from './PillGroup.jsx'
import { UpdateDot } from './UpdateDot.jsx'
import DefaultsCard from './DefaultsCard.jsx'
import ConfirmModal from './ConfirmModal.jsx'
import PresetManager from './PresetManager.jsx'
import CustomSelect from './CustomSelect.jsx'
import { PresetOptionLabel, ShortStockNameRoom } from './PresetSwitcher.jsx'
import QuotedName from './QuotedName.jsx'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import { useStorageUsage } from '../store/storageUsage.js'
import { StoragePercent } from './StorageUsagePopup.jsx'
import Popup from './Popup.js'
import { useLayer } from './overlayStack.js'
import { MODAL_CARD_CLASS } from './modalContract.js'
import {
  WRITTEN_FORMATS,
  NUMERIC_FORMATS,
  INPUT_STYLES,
  DOT_ROTATION_OPTIONS,
  AMNESIC_OPTIONS,
  DARK_THEMES,
  LIGHT_THEMES,
  CHANCE_OPTIONS,
  LEAP_CHANCE_OPTIONS,
} from './settingsOptions.js'
import { PRACTICE_MODE_OPTIONS, OTHER_PAGE_OPTIONS } from '../lib/modes.js'
import {
  PANEL_RESET_BTN_CLASS,
  NOT_OFFERED_BTN_CLASS,
  FOOTER_META_ROW_CLASS,
  YEAR_INPUT_BASE,
  YEAR_INPUT_CLASS,
  YEAR_INPUT_DORMANT_CLASS,
} from './controlClasses.js'
import { BUILD_IS_DEPLOYED, DEPLOY_TS } from '../deployStamp.js'
import { APP_VERSION } from '../appVersion.js'
import { CHANGELOG } from '../changelog.js'
import { useSettings, SETTINGS_DEFAULTS } from '../store/settings.js'
import { useJulianRange } from '../store/julianRange.js'
import type { SettingsValues } from '../store/settings.js'
import { useModePrefs } from '../store/modePrefs.js'
import {
  useUserDefaults,
  effectivePrefDefaults,
  effectiveAmnesicDefault,
  normalizeAoxN,
} from '../store/userDefaults.js'
import type { PrefDefaults, SavedSettings } from '../store/userDefaults.js'
import { usePresets } from '../store/presets.js'
import { useActiveAmnesicMode } from '../store/amnesic.js'
import type { AmnesicMode } from '../store/amnesicMode.js'
import { setPresetAmnesic, setOpenInPreset } from '../store/presetControl.js'
import type { YearMirror, YearRangeMirrors } from './useYearRangeMirrors.js'

// ============================================================
// SettingsPanel — the ⚙ popover card and its modals: Save Defaults, the defaults manager, the
// Changelog and the preset manager, plus three shared ConfirmModals (Full Reset, Reset Settings,
// Clear Saved Defaults) since round 21.
//
// ★ IT IS RENDERED ONLY WHILE THE PANEL IS OPEN: App renders `{settingsOpen && <SettingsPanel …/>}`.
// That is a HARD constraint, not a style choice. A closed panel must have no DOM at all — the test
// suite's role queries are unscoped by design (role queries skip display:none, which is the only
// reason the always-mounted How-to-Play copy does not collide), so an always-mounted-and-hidden
// panel would make getAllByRole('radio') count double and fail in ways that look nothing like the
// cause. It is also what lets the modal state below simply DIE on close instead of needing four
// effects to clear it.
//
// ★ AND ONLY IN ONE PLACE IN THE TREE: as a sibling of the bar's title/gear row, inside the bar's
// `relative` inner wrapper. The card is `absolute left-4 right-4 top-full`, so all three of those
// resolve against that wrapper as containing block — rendered anywhere else, or wrapped in a div of
// its own, the panel silently detaches from the bar. Hence the FRAGMENT below whose first child is
// the card itself. (The `--bar-h` half of the max-height calc is NOT position-dependent: it is a
// root custom property, inherited everywhere.)
//
// ★ IT MUST NOT BE MEMOISED, and it must never call useSettingsCloseEffect.
//   • No React.memo, no useMemo around the element, no memoised props object. PillGroup's tab-stop
//     layout effect and the trio's caption fit below both deliberately have NO dependency array, because
//     they must re-read the DOM on every pass; memoising the panel out of a render leaves a stale
//     tab stop and a stale fit.
//   • useSettingsCloseEffect seeds its "was open" ref from the FIRST value it sees, so a caller
//     that mounts while the panel is open and unmounts on close never produces a true→false
//     transition and its body NEVER RUNS — silently, with nothing thrown. Every apply-on-close in
//     the app depends on that transition. Its six callers are App and the five always-mounted mode
//     screens, none of which unmount; this component is the one place that must not join them. In
//     particular useUpdateCheck() is called by APP and its result passed in as two props, precisely
//     because it contains one.
//
// WHAT STAYS IN App AND ARRIVES AS PROPS: the panel's open state and every write to it, its entry in
// the app's stack of open things with its press-outside rule (three of that rule's four refs live
// in the BAR), the drag-dismiss listener, the gear-dot retire effect, the four at-defaults booleans the GEAR renders while the
// panel is closed, resetSettings/fullReset (which reach App's whole world), and the Year Range text
// mirrors (whose lifetime must outlive this component's — see useYearRangeMirrors).
//
// WHAT IT READS STRAIGHT FROM THE STORES: the sixteen settings values and their setters, and the
// saved-defaults snapshot. Individually selected, never as one object selector, so the panel
// re-renders only for the value that changed.
// ============================================================

export type SettingsPanelProps = {
  /** App's popover ref. App creates it because two things it owns read it: the press-outside
   *  handler (including its blur-before-close) and the drag-dismiss listener. */
  cardRef: RefObject<HTMLDivElement | null>
  /** Live state diverges from the effective defaults, in EITHER store. Computed in App because the
   *  GEAR renders it while the panel is closed; passing it is what stops the gear's violet bar and
   *  the two Per-preset buttons' dims from drifting apart. */
  settingsModified: boolean
  /** The whole app is at launch state. Thirteen terms, six of which App owns and five of which are
   *  reported UP from the mode screens — the panel gets the answer, never the inputs. */
  isFullyReset: boolean
  /** All five mode screens are at their launch state — the aggregate isFullyReset is built on. Not
   *  used by the panel itself: it is handed to components/PresetManager, whose ✕ may skip its
   *  confirmation only when the active preset's screens hold nothing a delete would throw away (a
   *  round or run in progress is stored nowhere else — store/presetControl's isPresetFactory). */
  screensFresh: boolean
  /** pressResetSettings — the GUARDED presser, not App's total resetSettings (which is also Full
   *  Reset's delegate and must stay unconditional). */
  onResetSettings: () => void
  /** App's fullReset, with its two load-bearing internal orderings intact. */
  onFullReset: () => void
  /** The live mode. Read at exactly one place below — the Input picker's lock — and the condition
   *  is `==='deduction'` EXACTLY. Must be the live value, never a memoised one. */
  mode: string
  /** The theme actually on screen, which App derives from an OS signal it owns. The Use-System
   *  switch seeds manualTheme from it, so a panel that recomputed it from store values alone would
   *  jump the user's look on a system-dark machine. */
  activeTheme: string
  /** The EFFECTIVE pref defaults. Passed rather than recomputed: it is a useMemo in App whose
   *  IDENTITY matters (prefsAtDefaults is a zustand selector closing over it). */
  defPrefs: PrefDefaults
  /** The Year Range boxes' text mirrors, one per pair (Julian off, Julian on) — App state, because a
   *  half-typed year survives a close. */
  yearRangeOff: YearRangeMirrors
  yearRangeOn: YearRangeMirrors
  minYearRef: RefObject<HTMLInputElement | null>
  maxYearRef: RefObject<HTMLInputElement | null>
  julianMinYearRef: RefObject<HTMLInputElement | null>
  julianMaxYearRef: RefObject<HTMLInputElement | null>
  /** The update-check state machine's label-state and its trigger. THE LABEL IS THE STATE. */
  updateCheck: UpdateCheckState
  onCheckUpdates: () => void
  /** The Changelog link's dot. App owns the flag because it is set by the build-change detection
   *  AND the newest-entry comparison together (src/changelog, CHANGELOG_SEEN_KEY); the panel is its
   *  only reader and its only retirer. */
  changelogDot: boolean
  onRetireChangelogDot: () => void
}

// ★ WHY A SETTING IS NOT IN EFFECT (Round 26) — one sentence each, given to a screen reader on every
// option of the setting (components/PillGroup's `dormant`, and the Year Range boxes'), never drawn:
// the outlined look is what a sighted player is shown. A setting that is not in effect is still
// changeable, and changing it changes nothing until it is in effect again (lib/dateConfig: the
// generator, the resets, and the Best keys all read only the settings in effect).
// The least the Save Defaults / Reset Settings / Full Reset captions shrink to on one line, as a share
// of the panel's text tier — 11px beside 12px, the floor they have always had — before they take two
// lines instead (fitTrioCaptions).
const TRIO_FLOOR = 11 / 12

const NOT_IN_EFFECT = {
  randomFormat: 'Practice dates ignore this while Random Format is on.',
  deduction: 'Not in use in Deduction.',
  buttons: 'Not in use while Input is Buttons.',
  noLeapYear: 'Not in use: your year range has no leap year.',
  onlyLeapYears: 'Not in use: every year in your range is a leap year.',
  julianOff: 'Not in use while Julian Calendar is off.',
  julianOn: 'Not in use while Julian Calendar is on.',
  no1582: 'Not in use: your year range does not include 1582.',
} as const
// The pages whose dates Date Format does not set while Random Format is on: the four weekday
// practice modes. NOT Deduction — its codes panel lays its codes out in Date Format's reading order
// whatever the puzzle's own format (modes/DeductionMode's MethodBreakdownSection) — and not Lookup or
// How to Play, where Date Format is the format of everything shown (Lookup's typing order and
// answers, the menu's own dates).
const DATE_FORMAT_IDLE_PAGES = new Set(['classic', 'flash', 'aox', 'blitz'])

// ★ A YEAR BOX IS NEVER NARROWER THAN ITS LONGEST YEAR, IN THE DEVICE'S OWN FONT (Round 26, Q7).
// The four boxes share the row (each pair, and each box in it, takes an equal part), but no box
// may be given less than the room its longest year needs — and how wide "11582" is depends on the
// font (DejaVu Sans, a Linux desktop's, sets it 18% wider than Windows' Segoe UI). So the box's
// floor is not a number: it is a SIZER in the box's own grid cell, invisible and of no height,
// set in the box's own type (its padding, border, size, and figures) and holding a run of each
// digit at the longest year's length, one per line ("00000" to "99999"). The cell is as wide as
// the widest of them — no year is wider, whatever the font, proportional figures included — and
// the box fills the cell (controlClasses' YEAR_INPUT_BASE keeps the rest of the floor small). Where
// the four floors do not fit on one row (a font or a text size far wider than any this app was
// drawn in), the row WRAPS: the Julian On pair goes under the
// Julian Off one, each pair whole. Nothing is ever cut or scrolled sideways.
// tests/browser/notInEffect holds both, in three fonts.
const YEAR_DIGITS = String(Math.max(YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN)).length
const YEAR_SIZER_TEXT = [...'0123456789'].map((digit) => digit.repeat(YEAR_DIGITS)).join('\n')
// ONE YEAR BOX — the Year Range row has four (two pairs), and each behaves exactly as the one pair
// always did: digits only while typing, the commit on leaving (blur or Enter), Escape throwing the
// typing away (the ★ notes at the row say why it is written this way).
function YearBox({
  name,
  mirror,
  committed,
  inputRef,
  reasonId,
}: {
  name: string
  mirror: YearMirror
  committed: number
  inputRef: RefObject<HTMLInputElement | null>
  // The id of its pair's "not in effect" reason, while the pair is not the one in use.
  reasonId?: string
}) {
  return (
    <span className="grid flex-1">
      <input
        ref={inputRef}
        aria-describedby={reasonId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={name}
        data-drag-focus
        value={mirror.value}
        onChange={(e) => {
          if (e.target.value === '' || /^\d*$/.test(e.target.value)) mirror.setValue(e.target.value)
        }}
        onBlur={mirror.commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            mirror.commit()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            const el = e.currentTarget
            flushSync(() => mirror.setValue(String(committed)))
            el.blur()
          }
          blockMinus(e)
        }}
        onBeforeInput={blockMinusBI}
        // Not in effect: the same box, hollow (index.css's .tray-dormant in place of .surface-tray).
        // w-0 min-w-full: the box gives the cell no width of its own, and fills the one it is given.
        className={`${reasonId ? YEAR_INPUT_DORMANT_CLASS : YEAR_INPUT_CLASS} py-1.5 col-start-1 row-start-1 w-0 min-w-full`}
      />
      <span
        aria-hidden
        className={`${YEAR_INPUT_BASE} border border-transparent col-start-1 row-start-1 h-0 overflow-clip invisible whitespace-pre`}
      >
        {YEAR_SIZER_TEXT}
      </span>
    </span>
  )
}
// ONE PAIR — its caption over its two boxes, the "→" between them. The pair not in use is drawn not
// in effect (`dormant`, its reason): outlined, still typed into and saved.
function YearPair({
  caption,
  mirrors,
  min,
  max,
  minRef,
  maxRef,
  dormant,
}: {
  caption: string
  mirrors: YearRangeMirrors
  min: number
  max: number
  minRef: RefObject<HTMLInputElement | null>
  maxRef: RefObject<HTMLInputElement | null>
  dormant?: string
}) {
  const id = useId()
  const reasonId = dormant ? id : undefined
  return (
    // flex-auto: a pair starts at its boxes' floors and takes an equal part of what is left; the
    // caption (w-0 min-w-full) adds nothing to that, so the two pairs are always alike.
    <div className="flex-auto space-y-1.5">
      {dormant && (
        <span id={id} hidden>
          {dormant}
        </span>
      )}
      <SectionLabel className="text-center w-0 min-w-full">{caption}</SectionLabel>
      <div className="flex items-center gap-1.5">
        <YearBox
          name={`Earliest Year, ${caption}`}
          mirror={mirrors.min}
          committed={min}
          inputRef={minRef}
          reasonId={reasonId}
        />
        <span className="text-(--tx-300-60) text-sm shrink-0">→</span>
        <YearBox
          name={`Latest Year, ${caption}`}
          mirror={mirrors.max}
          committed={max}
          inputRef={maxRef}
          reasonId={reasonId}
        />
      </div>
    </div>
  )
}

export function SettingsPanel({
  cardRef,
  settingsModified,
  isFullyReset,
  screensFresh,
  onResetSettings,
  onFullReset,
  mode,
  activeTheme,
  defPrefs,
  yearRangeOff,
  yearRangeOn,
  minYearRef,
  maxYearRef,
  julianMinYearRef,
  julianMaxYearRef,
  updateCheck,
  onCheckUpdates,
  changelogDot,
  onRetireChangelogDot,
}: SettingsPanelProps) {
  // The settings the panel owns on screen, selected individually (Zustand selector subscriptions)
  // so a write to one never re-renders the panel for the other thirteen. App binds the same VALUES
  // for its at-defaults comparison and for date generation; the SETTERS are the panel's alone.
  const useSystem = useSettings((s) => s.useSystem)
  const setUseSystem = useSettings((s) => s.setUseSystem)
  const darkTheme = useSettings((s) => s.darkTheme)
  const setDarkTheme = useSettings((s) => s.setDarkTheme)
  const lightTheme = useSettings((s) => s.lightTheme)
  const setLightTheme = useSettings((s) => s.setLightTheme)
  const manualTheme = useSettings((s) => s.manualTheme)
  const setManualTheme = useSettings((s) => s.setManualTheme)
  const minY = useSettings((s) => s.minY)
  const maxY = useSettings((s) => s.maxY)
  const julianMinY = useJulianRange((s) => s.julianMinY)
  const julianMaxY = useJulianRange((s) => s.julianMaxY)
  const useJulian = useSettings((s) => s.useJulian)
  // The Year Range in effect — the pair for the Julian Calendar setting as it stands — which is the
  // range the chance rows' "does it apply?" questions are asked about (lib/dateConfig).
  const range = yearRangeInEffect(useJulian, { minY, maxY }, { julianMinY, julianMaxY })
  const setUseJulian = useSettings((s) => s.setUseJulian)
  const saveStats = useSettings((s) => s.saveStats)
  const setSaveStats = useSettings((s) => s.setSaveStats)
  const dateFormat = useSettings((s) => s.dateFormat)
  const setDateFormat = useSettings((s) => s.setDateFormat)
  const randomFormat = useSettings((s) => s.randomFormat)
  const setRandomFormat = useSettings((s) => s.setRandomFormat)
  const inputStyle = useSettings((s) => s.inputStyle)
  const setInputStyle = useSettings((s) => s.setInputStyle)
  const dotRotation = useSettings((s) => s.dotRotation)
  const setDotRotation = useSettings((s) => s.setDotRotation)
  // defaultMode (round 21) — the per-preset "Default Mode" picker under the Per-preset label. A
  // ⚙ setting like every other in this store: captured by Save Defaults, restored by Reset Settings
  // (App's settingsAtDefaults includes it, so a change lights the gear and un-dims Save Defaults).
  // It only takes visible effect on a cold open or a preset switch — main.tsx consumes it there.
  const defaultMode = useSettings((s) => s.defaultMode)
  const setDefaultMode = useSettings((s) => s.setDefaultMode)
  const leapChance = useSettings((s) => s.leapChance)
  const setLeapChance = useSettings((s) => s.setLeapChance)
  const janFebChance = useSettings((s) => s.janFebChance)
  const setJanFebChance = useSettings((s) => s.setJanFebChance)
  const julianChance = useSettings((s) => s.julianChance)
  const setJulianChance = useSettings((s) => s.setJulianChance)
  // Save Stats toggle. Flips the global ⚙ setting; each always-mounted mode component reads the new
  // saveStats prop itself (display dimming + Best-recording gate). Save Stats is not a
  // date-generation setting, so it never regenerates a date.
  const toggleSaveStats = () => setSaveStats((v) => !v)
  // ── AMNESIC (the row directly under Save Stats) ──────────────────────────────────────────────
  //
  // ★ THE PAIR IS THE POINT, AND IT IS WHY THESE TWO ROWS TOUCH. Save Stats answers "does this
  // COUNT"; Amnesic answers "does it LAST" — Off: all of it; Stats Only: the round modes' Bests,
  // and not the stats; Full: none of it. They are ORTHOGONAL, not exclusive — in an amnesic preset
  // you may still want Save Stats off for throwaway questions so even the session's count does not
  // move. Folding the two into one picker (Saved / Amnesic / Off) was proposed and the owner
  // correctly killed it: it would have made two independent facts look like one choice. (Amnesic's
  // OWN three values are one fact — how much lasts — which is why it is a picker and Save Stats
  // stays a switch; and Save Stats has no matching middle value, by the owner's ruling.)
  //
  // ⚠ A FIELD OF THE PRESET'S SETTINGS, BUT NOT ONE OF THE 16 (store/settings; design-q1-q2.md v4, 9):
  // it stays across a real close and every window of the preset follows it, like any setting — and
  // it is written only through store/presetControl, which pairs the write with the storage work it
  // implies. The reasons are argued at the top of store/amnesic; the one that matters here is that the
  // 16 can be overwritten wholesale by Reset Settings, with no rehydration and no screen remount, and
  // this value decides WHICH COPY the stats and bests are read from.
  // ⚠⚠ WHERE IT LIVES IS NOT WHETHER IT COUNTS, AND THIS COMMENT USED TO CONFLATE THE TWO. It said
  // two things followed from the value not being a settings value: that it is not in the Save
  // Defaults snapshot, and that it never lights the gear's "modified" bar. BOTH WERE WRONG, in two
  // separate rounds. Round 20 put it IN the snapshot (commitSaveDefaults below writes it, and Reset
  // Settings / Full Reset restore it), and round 22 put it into the comparison that lights the
  // bar (main.tsx's settingsAtDefaults) — because leaving it out of ONE shared expression that also
  // dims Save Defaults meant an amnesic-only change could never be saved as a default at all. So
  // the honest statement is the plain one: Amnesic is captured and restored exactly like a setting,
  // and it is judged exactly like one; only the way it is WRITTEN is different, and that difference
  // is what the paragraph above is about.
  const activePresetId = usePresets((s) => s.activeId)
  const amnesic = useActiveAmnesicMode()
  // The active preset's NAME, for the Presets section's one line of prose at the head of the panel.
  // A selector rather than `activePreset()` from store/presetControl: this has to RE-RENDER when the
  // name changes (the manage modal below can rename it while the panel is open), and a plain
  // getState() read would not. The `?? ''` covers the one frame a caller could read between an
  // applyRegistry and its own next line — store/presets' normalizeRegistry guarantees activeId names
  // a listed preset on every load, so it is a type obligation rather than a state the app reaches.
  const activePresetName = usePresets((s) => s.presets.find((p) => p.id === s.activeId)?.name ?? '')
  // ── GLOBAL: the "Open in" pin (round 21) ─────────────────────────────────────────────────
  // App-global, not per-preset — it lives on the registry (store/presets' openInPreset), read here
  // and written through store/presetControl. NOT captured by Save
  // Defaults (no registry field is in any snapshot). The picker offers "Last used" plus one entry
  // per preset; a fresh app open then lands in the pinned preset, or in whatever was active last
  // time when it is 'last'. Options rebuild when the preset list changes (rename / add / delete),
  // and each preset is drawn by components/PresetSwitcher's PresetOptionLabel — the same row the
  // top-bar switcher draws, truncation and the spoken ", amnesic" included, because it is the same list.
  const presetList = usePresets((s) => s.presets)
  const openInPreset = usePresets((s) => s.openInPreset)
  const openInOptions = [
    { value: 'last', label: 'Last used' },
    ...presetList.map((p) => ({ value: String(p.id), label: <PresetOptionLabel preset={p} /> })),
  ]
  const openInValue = openInPreset === 'last' ? 'last' : String(openInPreset)
  const changeOpenIn = (v: string) => setOpenInPreset(v === 'last' ? 'last' : Number(v))
  // ⚠ NO CONFIRMATION DIALOG, deliberately, and the owner cut one that had been drafted ("I say
  // neither, just leave it for htp"). A dialog would exist to stop somebody forgetting the state
  // they were in — and people build a whole preset around being amnesic or not, so that is not the
  // problem they have. The How-to-Play section carries the explanation instead.
  // The teardown, the zero start and the discard all belong to setPresetAmnesic; this is a tap.
  // ⚠ IT ALSO MOVES THE FOUR OFFERS AS OF ROUND 22 — the gear's bar, and the Save Defaults /
  // Reset Settings / Full Reset dims — because App compares this value against the preset's saved
  // default now. Nothing here does that; `settingsModified` arrives as a prop and this tap simply
  // changes one of the values it is computed from, exactly as flipping Save Stats above does.
  const changeAmnesic = (mode: AmnesicMode) => setPresetAmnesic(activePresetId, mode)
  // The saved-defaults snapshot. A store value, so it is read here directly — but the EFFECTIVE
  // defaults derived from it (defPrefs) arrive as a prop, because their memo identity is load
  // bearing up in App.
  const savedDefaults = useUserDefaults((s) => s.saved)
  const saveUserDefaults = useUserDefaults((s) => s.saveDefaults)
  const clearUserDefaults = useUserDefaults((s) => s.clearDefaults)

  // Full Reset (round 21) and Reset Settings (round 21) confirmation popups. Both are the
  // shared ConfirmModal now — the owner's rule that EVERY reset-style action asks with a popup that
  // names what it does and whether it is per-preset or app-wide. Full Reset was a two-tap in-place
  // arm (state + refs + a 3s timer + a site-wide capture-phase disarm listener + a during-render
  // safety net) and Reset Settings had no confirmation at all; both are one boolean now.
  const [fullResetConfirmOpen, setFullResetConfirmOpen] = useState(false)
  const [resetSettingsConfirmOpen, setResetSettingsConfirmOpen] = useState(false)
  // Save Defaults confirmation popup state. pendSettings snapshots the full 16-value panel at
  // OPEN (the popup doesn't edit panel values); pendPrefs seeds the four editable mode-screen rows
  // from the live modePrefs store at open, and pendSeed keeps that seed for the shared card's
  // dirty-row comparison (round 6). Edits touch ONLY this pending snapshot — every dismiss route
  // (scrim tap, Escape, Android Back) discards it; Save commits it (aoxN normalized). Closing the
  // panel discards it by unmounting. (The popup's Cancel button is gone; it was a fourth
  // spelling of that same discard — see components/DefaultsCard.)
  const [saveDefaultsOpen, setSaveDefaultsOpen] = useState(false)
  // A ref, and it is safe to re-create it per panel open: it is written by openSaveDefaults and
  // read only at commit, and the popup cannot outlive the panel that opened it.
  const pendSettingsRef = useRef<SavedSettings | null>(null)
  const [pendPrefs, setPendPrefs] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  const [pendSeed, setPendSeed] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  // Defaults manager (editable since round 6) popup state — View Saved Defaults' window onto the
  // saved (or, with nothing saved, factory) defaults, on the SAME shared card as the Save popup.
  // managePrefs is its pending snapshot, seeded from the EFFECTIVE defaults (defPrefs) at open; the
  // seed itself needs no copy — defPrefs cannot change while the modal is up (this modal owns the
  // only editor). Any dismiss — scrim tap, Escape, Android Back — discards the edits.
  const [manageDefaultsOpen, setManageDefaultsOpen] = useState(false)
  const [managePrefs, setManagePrefs] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  // Clear-saved-defaults confirm popup (round 6; folded onto the shared ConfirmModal in round
  // 21): the Clear Saved Defaults button asks before it forgets the snapshot. Just a boolean now — the
  // portal, the scrim, focus-on-open, capture Escape and Android Back all live in ConfirmModal.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  // Changelog popup — the plain-words what-changed list (src/changelog), opened from the
  // pinned foot's Changelog link. Its two dot flags live up in App with the build-stamp detection that
  // lights them; this popup only READS the link's and asks App to retire it.
  const [changelogOpen, setChangelogOpen] = useState(false)
  // The preset manager (sub-group 4C) — another user of the modal contract, opened from the
  // Presets section at the head of the panel. The card holds its own pending RENAME, which never
  // leaves it; what lives here is the open flag and — since the Cancel buttons went — which preset the delete
  // confirmation is asking about.
  // ⚠ IT CARRIES NO PENDING SNAPSHOT, unlike the two DefaultsCard modals, and that is the design
  // rather than an omission: every act inside it — create, rename, reorder, delete — is committed
  // to the registry the moment it happens, so nothing in it is a pending edit a dismiss has to
  // discard. Deleting is the only irreversible one, and it is the one with a confirmation — except
  // on a preset that holds nothing a player could miss, where the ✕ skips straight to the delete
  // (components/PresetManager's pressDelete). This flag is simply never set on that route.
  const [presetsOpen, setPresetsOpen] = useState(false)
  // ★★ WHY THE DELETE CONFIRMATION'S SUBJECT LIVES UP HERE AND NOT IN THE CARD. It used to be
  // components/PresetManager's own `useState`, which was right while the card had a Cancel button:
  // the question was posed and answered entirely inside it. Round 22 removed every Cancel in the app on
  // the owner's rule that a dismiss says the same thing — and for THIS card that was not true, so
  // it had to be MADE true. Dismissing the manager while the question is up now means "back to the
  // list", and a second dismiss closes the card: the dismissal LADDER (dismissPresets below), the
  // same shape the rename field has always had (the first Escape belongs to the name, the second to
  // the card).
  // A ladder is a decision about a dismiss, and the dismiss handlers are this component's — it
  // hands the popup its onDismiss, as it does for the other popups. So this is the fact the
  // dismisser needs, held where the dismisser is, rather than a callback reaching down into the card
  // to ask. The card takes it as a prop and stays the owner of everything that is genuinely about
  // drawing the two views.
  // ⚠ AN ID, NOT THE PRESET OBJECT, for the reason the card's own version was an id: the registry
  // can be rewritten under an open card (a rename, a reorder), and a captured object goes stale
  // where an id resolves fresh on every render.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  // Scroll-state tracking for the two inner scroll regions this component owns — the popover's
  // scroll wrapper and the changelog popup's list — both on the shared useScrollEdgeState
  // (components/scrollRegion; the round 7 extraction of what were per-region copies of one
  // listener). The flags drive the shared edge indicators:
  //   …ScrolledFromTop → top fade (no shadow at the top — no fixed UI there)
  //   …AtBottom        → bottom fade (both signal "more below")
  // Both fade flags combine into fade-scroll-both inside scrollFadeClass when both edges overflow.
  // The popover ALSO hands the hook its sticky footer as the bottom boundary surface: that shadow
  // is continuous now (--shade, round 10 item B), so it is no longer derived from popoverAtBottom
  // at the JSX — the hook writes it. The changelog names no boundary surface; its Close row is
  // plain, so both trailing arguments are omitted.
  //
  // ★ THE POPOVER'S `active` ARGUMENT IS THE LITERAL `true`, and that is the honest value now: this
  // component only exists while the panel is open, so the region is live for its whole life. What
  // the old `settingsOpen` argument bought — never flashing stale fade or shadow state from the
  // previous open — is now delivered by remounting instead, from the same initial values the hook's
  // deactivation cleanup used to restore.
  //
  // ★ AND IT IS DECLARED BEFORE THE TRIO'S CAPTION FIT BELOW, deliberately: the first painted
  // frame's fade/shadow answer is measured against the pre-fit button height (the trio heads the
  // Per-preset section, inside this scroll region, since Round 26) and corrected asynchronously.
  // Keep the relative order.
  const popoverInnerScrollRef = useRef<HTMLDivElement | null>(null)
  const popoverFooterRef = useRef<HTMLDivElement | null>(null)
  const { scrolledFromTop: popoverScrolledFromTop, atBottom: popoverAtBottom } = useScrollEdgeState(
    popoverInnerScrollRef,
    true,
    undefined,
    popoverFooterRef,
  )
  const changelogScrollRef = useRef<HTMLDivElement | null>(null)
  const { scrolledFromTop: changelogScrolledFromTop, atBottom: changelogAtBottom } =
    useScrollEdgeState(changelogScrollRef, changelogOpen)
  // The trio's caption fit (Round-2, when the trio was the panel's pinned footer; it heads the
  // Per-preset section since Round 26): Save Defaults / Reset Settings / Full Reset are three equal
  // flex-1 buttons, and on a narrow phone, or in a wide font, a caption can be wider than its button.
  // ★ A CAPTION IS NEVER CUT (the Round 26 review: in Verdana "Reset Settings" was cut by 1.8px at
  // 390 wide and 9.3px at 280; in the stock font by a pixel at 280). What happens instead, in order:
  //   1. ONE SHARED SIZE, smaller: all three captions shrink together (never per button — unequal
  //      captions across a matched row read as a glitch), to the largest size at which the widest
  //      fits its button — but not below TRIO_FLOOR of the panel's text tier (text-xs), the size the
  //      captions have always been allowed to give (11px beside 12px).
  //   2. TWO LINES where that floor is not enough: every caption breaks at its space ("Reset /
  //      Settings"), all three together, so the row stays matched — the buttons grow a line taller
  //      rather than shrink past legibility — at the largest size, up to the full tier, at which
  //      each caption's longest word fits.
  //   (A font so wide that even a word does not fit at the floor shrinks further than it: whole
  //   words, never cut.)
  // ★ MEASURED AS LAID-OUT TEXT (a Range over the caption), at each size tried (lib/textFit's
  // largestFit: a font is not trusted to scale evenly). The fit used to read each caption span's
  // scrollWidth — which an inline span does not have (it is 0), so the fit never once shrank
  // anything and the clip went unseen. Applied to the BUTTON, not the caption: the caption
  // inherits it, so the button's line-box strut shrinks WITH the text and the label stays
  // vertically centred (sizing the span alone left it ~0.6px low on-device, the owner's 2026-07-13
  // catch). In jsdom nothing is laid out (every width is 0) and nothing changes.
  const trioRef = useRef<HTMLDivElement | null>(null)
  const fitTrioCaptions = () => {
    const row = trioRef.current
    if (!row) return
    const labels = Array.from(row.querySelectorAll<HTMLElement>('[data-fitlabel]'))
    const buttons = labels.map((l) => l.parentElement!)
    if (labels.length === 0) return
    // Back to the resting size and one line before anything is measured, so a re-run measures the
    // captions as they are, not as the last fit left them (StatPanel's feedback-loop rule).
    buttons.forEach((b) => (b.style.fontSize = ''))
    labels.forEach((l) => (l.style.whiteSpace = ''))
    // The room inside the narrowest button (they are equal, but nothing here depends on that).
    const room = Math.min(
      ...buttons.map((b) => {
        const cs = getComputedStyle(b)
        const sides = [
          'paddingLeft',
          'paddingRight',
          'borderLeftWidth',
          'borderRightWidth',
        ] as const
        return (
          b.getBoundingClientRect().width - sides.reduce((sum, k) => sum + parseFloat(cs[k]), 0)
        )
      }),
    )
    if (!(room > 0)) return
    const base = parseFloat(getComputedStyle(buttons[0]).fontSize)
    const sizeAt = (scale: number) =>
      buttons.forEach((b) => (b.style.fontSize = scale < 1 ? `${base * scale}px` : ''))
    // The widest caption — or, `byWord`, the widest single word of any — at `scale` of the tier.
    const widestAt = (byWord: boolean) => (scale: number) => {
      sizeAt(scale)
      return Math.max(
        ...labels.map((l) => {
          const text = l.firstChild
          if (!(text instanceof Text)) return 0
          const pieces = byWord ? text.data.split(' ') : [text.data]
          let at = 0
          return Math.max(
            ...pieces.map((piece) => {
              const range = document.createRange()
              range.setStart(text, at)
              range.setEnd(text, at + piece.length)
              at += piece.length + 1
              return range.getBoundingClientRect().width
            }),
          )
        }),
      )
    }
    const oneLine = largestFit(room, widestAt(false))
    if (oneLine >= TRIO_FLOOR) return sizeAt(oneLine)
    labels.forEach((l) => (l.style.whiteSpace = 'normal'))
    sizeAt(largestFit(room, widestAt(true)))
  }
  // Dep-less like StatPanel's: cheap (3 spans), and this component only exists while the panel is
  // open, so there is no closed state to bail out of. It re-reads on EVERY render pass on purpose —
  // do not give it a dependency array and do not memoise this component out of a pass.
  useLayoutEffect(() => {
    fitTrioCaptions()
  })
  // A web-font swap changes the natural widths, so document.fonts.ready refits too. Deps are []
  // rather than the old [settingsOpen]: mount IS the open now.
  useEffect(() => {
    const row = trioRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitTrioCaptions())
    ro.observe(row)
    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready)
      document.fonts.ready.then(() => {
        if (!cancelled) fitTrioCaptions()
      })
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [])

  // Every popup below is a card inside components/Popup, which owns the whole popup contract
  // (components/modalContract): the scrim, focus into the dialog on open and back out on close,
  // Escape, Android Back, the scrim tap and the Tab trap. What this component owes each one is its
  // open flag, its card, and what a dismiss means.
  // ⚠ WHY FOCUS-ON-OPEN MATTERS HERE IN PARTICULAR: without it focus stays on the Save Defaults
  // button UNDER the scrim, and keyboard/AT input keeps operating the live settings panel while
  // commitSaveDefaults would still save the snapshot captured at open — a silent divergence between
  // what's on screen and what Save persists.
  // ⚠ THE PRESET MANAGER ALSO FOCUSES ITSELF, for the one case the shell cannot see: its card has
  // two views (the list, and the delete question) and swapping between them can remove the control
  // that had the keyboard, with the popup neither opening nor becoming the top one. That effect is
  // components/PresetManager's, keyed on the view.

  // Save Defaults: open the confirmation popup, seeding the pending snapshot from the LIVE
  // stores (panel captured whole; the four mode-screen prefs become editable rows). The seed is
  // kept alongside the pending copy for the shared card's dirty-row highlight.
  const openSaveDefaults = () => {
    // The same short-circuit the other two trio buttons carry — all three are equally inert while
    // dimmed. Without it, a keyboard user could open this popup with nothing to save. It can sit
    // INSIDE this function because the function IS the press and nothing else calls it; that is
    // exactly what is not true of App's resetSettings, whose guard had to go on the button.
    if (!settingsModified) return
    const s = useSettings.getState()
    const j = useJulianRange.getState()
    pendSettingsRef.current = {
      ...(Object.fromEntries(
        Object.keys(SETTINGS_DEFAULTS).map((k) => [k, s[k as keyof SettingsValues]]),
      ) as SettingsValues),
      // …and the Julian-on Year Range, which rides in the snapshot's settings (store/userDefaults'
      // SavedSettings says why there).
      julianMinY: j.julianMinY,
      julianMaxY: j.julianMaxY,
    }
    const p = useModePrefs.getState()
    const seeded = {
      flashMs: p.flashMs,
      blitzSec: p.blitzSec,
      blitzQSec: p.blitzQSec,
      aoxN: normalizeAoxN(p.aoxN),
    }
    setPendPrefs(seeded)
    setPendSeed(seeded)
    setSaveDefaultsOpen(true)
  }
  const closeSaveDefaults = useCallback(() => setSaveDefaultsOpen(false), [])
  // The defaults manager (round 6): seed the pending copy from the EFFECTIVE defaults — the
  // saved snapshot when one exists, the factory values otherwise (aoxN normalized so the readout
  // starts on its committed form). defPrefs itself doubles as the seed prop.
  const openManageDefaults = () => {
    setManagePrefs({ ...defPrefs, aoxN: normalizeAoxN(defPrefs.aoxN) })
    setManageDefaultsOpen(true)
  }
  const closeManageDefaults = useCallback(() => setManageDefaultsOpen(false), [])
  const closeClearConfirm = useCallback(() => setClearConfirmOpen(false), [])
  const closeFullResetConfirm = useCallback(() => setFullResetConfirmOpen(false), [])
  const closeResetSettingsConfirm = useCallback(() => setResetSettingsConfirmOpen(false), [])
  const closeChangelog = useCallback(() => setChangelogOpen(false), [])
  // Closing the preset manager clears any pending delete WITH it, as one act: the pair IS the
  // invariant "a closed card has no question pending", so re-opening the manager can never land on
  // a confirmation nobody asked for. Reaching it with one pending is not possible through the ladder
  // below — that is the whole point of the ladder — but the invariant costs one line and does not
  // depend on that argument staying true.
  const closePresets = useCallback(() => {
    setPresetsOpen(false)
    setPendingDeleteId(null)
  }, [])
  const clearPendingDelete = useCallback(() => setPendingDeleteId(null), [])
  // ★★ THE DISMISSAL LADDER, and it is ONE handler rather than a second modal. While the delete
  // confirmation is up, a dismiss steps back to the LIST; a second dismiss closes the card. That is
  // what makes "tap outside / Escape / Back all mean cancel" true for this card too, which is the
  // premise every Cancel button was removed on — and the delete confirmation's Cancel was the ONE in
  // the app that was not merely a third spelling of a dismiss (it went back to the list, where every
  // dismiss route closed the whole card), so removing it without this would have left a question
  // with no way out but destroying the card and re-opening it.
  // ⚠ NOT memoized, deliberately: it reads `pendingDeleteId` on every call, and the stack holds
  // every close through a post-commit ref (components/overlayStack), so a fresh identity per render
  // re-registers nothing.
  // ★ AND A NAME BOX IS LEFT FIRST (Q17): a dismiss that closes the card is a way of leaving the
  // name box that has the keyboard, so the rename is attempted as every way of leaving attempts it
  // (components/PresetManager fills leavePresetNameBox in). Only Back ever reaches this with a box
  // in use — a tap on the dim has left the box already, and Escape in a box is the box's own key.
  // If the device refused that name, the card stays with the note under its row, and this says so
  // with `false` (components/Popup's onDismiss may decline); the next dismiss closes it.
  const leavePresetNameBox = useRef<(() => boolean) | null>(null)
  const dismissPresets = () => {
    if (pendingDeleteId !== null) clearPendingDelete()
    else if (leavePresetNameBox.current?.()) return false
    else closePresets()
  }
  // Opening the changelog retires the link's dot — the breadcrumb's last stop. First tap only in
  // effect: once the flag is cleared the guard never re-fires (nothing re-marks it until the next
  // build change). The flag itself is App's, so the retire is a callback up.
  const openChangelog = () => {
    setChangelogOpen(true)
    if (changelogDot) onRetireChangelogDot()
  }
  // Save commits the EDITED pending snapshot (never the live stores — they stay untouched); from
  // here on Reset Settings / Full Reset / the gear indicator mean THESE values by "default".
  // ⚠ amnesic RIDES ALONG, READ LIVE AT COMMIT (round 20) — NOT frozen into a ref at open like
  // pendSettingsRef. The popup has no UI for it (it is not shown or editable here — see the note at
  // changeAmnesic), so unlike the 16 settings values there is nothing a user could edit out from
  // under a captured-at-open snapshot; reading the bound `amnesic` (a live store subscription
  // declared with the panel's other values above) at the moment of commit is equivalent to
  // capturing it at open and one line simpler. The owner's confirmed decision — flagged as a real
  // tradeoff and reaffirmed — is that this value is real ARCHITECTURE from here on: Reset Settings
  // and Full Reset both restore it.
  // ⚠⚠ AND IT IS ONLY REACHABLE AT ALL BECAUSE OF ROUND 22. openSaveDefaults above refuses to
  // open while `settingsModified` is false, and until then that boolean was blind to this exact
  // value — so an Amnesic-only change dimmed the button, the popup never opened, and this line
  // never ran. The capture was written; the door to it was shut. Folding amnesic into App's
  // settingsAtDefaults is what opened it, and it is why that fix had to go in the shared expression
  // rather than in a Save-Defaults-only test.
  const commitSaveDefaults = () => {
    if (pendSettingsRef.current)
      saveUserDefaults({
        settings: pendSettingsRef.current,
        prefs: { ...pendPrefs, aoxN: normalizeAoxN(pendPrefs.aoxN) },
        amnesic,
      })
    setSaveDefaultsOpen(false)
  }
  // The manager's Save (round 6) writes ONLY the four shown values into the snapshot: the 16
  // ⚙-panel values pass through AS-SAVED, byte-identical (never re-captured from the live store —
  // the owner's rule: this popup edits exactly what it shows). With nothing saved yet it CREATES
  // the snapshot — the factory ⚙ values plus these edits, the natural flow from the factory view
  // (Clear Saved Defaults is offered from then on).
  // ⚠ amnesic PASSES THROUGH UNCHANGED, THE SAME AS THE 15 SETTINGS (round 20) — this popup shows
  // and edits none of it (Amnesic is set only in ⚙ → Stats), so it is not this popup's to
  // re-capture. Previously-saved value when one exists, factory (Off — a fresh preset is never
  // amnesic) when creating the snapshot from the factory view: effectiveAmnesicDefault's own
  // "nothing saved = factory" rule, and its reading of a snapshot an older build saved.
  const commitManageDefaults = () => {
    saveUserDefaults({
      settings: savedDefaults ? savedDefaults.settings : SETTINGS_DEFAULTS,
      prefs: { ...managePrefs, aoxN: normalizeAoxN(managePrefs.aoxN) },
      amnesic: effectiveAmnesicDefault(savedDefaults),
    })
    setManageDefaultsOpen(false)
  }
  // The Clear confirm's destructive half (round 6): forget the snapshot — live settings stay
  // untouched, factory semantics take over everywhere (the effective* helpers).
  const confirmClearDefaults = () => {
    clearUserDefaults()
    setClearConfirmOpen(false)
  }
  // Full Reset (round 21): open the ConfirmModal. The dimmed-button short-circuit stays here for
  // the same reason openSaveDefaults carries its own — the class draws the button unavailable and
  // aria-disabled announces it, but this line is the one that makes it INERT for a keyboard press
  // or an assistive-technology activation. It replaced the two-tap arm's `if (isFullyReset) return`
  // first line and does exactly the same job.
  const openFullResetConfirm = () => {
    if (isFullyReset) return
    setFullResetConfirmOpen(true)
  }
  const confirmFullReset = () => {
    setFullResetConfirmOpen(false)
    onFullReset()
  }
  // Reset Settings (round 21) — it had NO confirmation at all before this round. Same
  // dimmed-button short-circuit as Save Defaults and Full Reset: `settingsModified` is what makes
  // pressing the greyed button do nothing (onResetSettings is App's guarded presser, so calling it
  // when nothing diverges is already a safe no-op — this just keeps the popup from opening empty).
  const openResetSettingsConfirm = () => {
    if (!settingsModified) return
    setResetSettingsConfirmOpen(true)
  }
  const confirmResetSettings = () => {
    setResetSettingsConfirmOpen(false)
    onResetSettings()
  }
  // ★ THE DELETE QUESTION IS A LAYER OF ITS OWN in the app's stack of open things
  // (components/overlayStack), over the Manage Presets popup that draws it. It has to be: Escape
  // and Back each close the TOP entry and nothing else, so the question needs an entry for them to
  // close — one whose close steps back to the list — or the first press would take the whole card.
  // (For Back there is a mechanical reason as well: a real Back press removes the top entry BEFORE
  // calling its close, so a single 'presets' entry that only stepped back to the list would leave
  // the card open with nothing registered, and the next press would take the ⚙ panel with it.)
  // It passes no press handler: a tap outside lands on the popup's scrim, whose dismiss is
  // dismissPresets — the same ladder, reached from the third route.
  // ⚠ The popup's own dismiss STAYS the laddered handler even though the question's entry always
  // answers Escape and Back first: one dismiss function for all three routes is what keeps them
  // provably identical, and the scrim tap genuinely needs both branches.
  useLayer(pendingDeleteId !== null, clearPendingDelete, 'presets-delete')

  // Save Defaults confirmation popup. components/Popup portals it to #root — deliberately
  // OUTSIDE the popover card (the ⚙ trigger's aria-controls menu), so its DOM is invisible to the
  // press-drag controller (a drag-release on popup content can never drag-dismiss the panel) and it
  // escapes the card's overflow/max-height context (a true centered popup — scrim + the popover's
  // own card/shadow language). While it is open it is the top of the app's stack, so a press on it —
  // scrim included — is never offered to the ⚙ panel underneath as a press "outside" the panel;
  // every dismiss route cancels the POPUP only, and closing the panel cancels it too (this whole
  // component unmounting). The card itself is
  // the shared DefaultsCard (round 6 — the one place the four rows, their recipes, and the
  // dirty-row accent live; see its header comment): row labels are Title Case (the ⚙ panel's label
  // tier) with every paired aria-label mirroring its visible text exactly — no case drift to
  // maintain, WCAG label-in-name safe. Edits touch ONLY the pending snapshot: the three sliders
  // mirror the mode screens' (same ranges/steps/--rng-fill, and the same tap-to-type
  // SliderValueEditor readouts — the popup seeds from the LIVE prefs, so its ranges must stay a
  // superset of every committable value) and the N field shares the AoX input's validation trio
  // (one idiom, one clamp): digits only while typing (the pending snapshot never holds junk),
  // and blur and Enter normalize-commit with the shared normalizeAoxN clamp (2–1000, fallback 10).
  // ESCAPE DISCARDS THE FIELD'S EDIT (round 15 — both this field and the AoX screen's own moved
  // off normalize-commit together, so Escape means one thing app-wide). Escape on the field is the
  // smaller undo; the discard for the WHOLE popup is any dismiss route — a second Escape, with the
  // field no longer focused, a scrim tap, or Android Back. (The popup's Cancel button, which used
  // to be a fourth way to say that, is gone.)
  const saveDefaultsJsx = saveDefaultsOpen && (
    <Popup id="save-defaults" onDismiss={closeSaveDefaults}>
      <DefaultsCard
        titleId="save-defaults-title"
        title="Save current settings as your defaults?"
        subline="Also saved from the mode screens:"
        prefs={pendPrefs}
        seed={pendSeed}
        setPrefs={setPendPrefs}
        onSave={commitSaveDefaults}
      />
    </Popup>
  )
  // The defaults manager popup (made editable in round 6): View Saved Defaults' window onto
  // the defaults — the same shared popup shell as the Save popup, rendering the SAME shared
  // DefaultsCard in manage mode. It seeds from the EFFECTIVE defaults (defPrefs — forward-merged, so a legacy
  // snapshot missing a field shows factory, never undefined) and rests read-only with NO button row
  // at all (round 21); edit any row and it goes dirty — a full-width Save, the restricted-write
  // note, the accent-tier value highlights (see DefaultsCard, which argues why that row lost its
  // Cancel). Title, subline, and footnote adapt to whether
  // a snapshot exists: with none saved the card is the clearly-labelled FACTORY view, and Save from
  // there CREATES the snapshot.
  const manageDefaultsJsx = manageDefaultsOpen && (
    <Popup id="manage-defaults" onDismiss={closeManageDefaults}>
      <DefaultsCard
        titleId="manage-defaults-title"
        manage
        title={savedDefaults ? 'Your saved defaults' : 'Default settings'}
        subline={
          savedDefaults ? undefined : "These are the factory defaults — you haven't saved your own."
        }
        note={
          savedDefaults
            ? 'Every ⚙ menu setting is also part of the snapshot, captured as it was when you saved.'
            : undefined
        }
        prefs={managePrefs}
        seed={defPrefs}
        setPrefs={setManagePrefs}
        onSave={commitManageDefaults}
      />
    </Popup>
  )
  // The Clear confirm, Full Reset and Reset Settings popups render at the foot of this component's
  // fragment as <ConfirmModal>s — see there for the copy. The card and its single rose-tier confirm
  // button live in that component; this file keeps only the open booleans and the confirm/cancel
  // callbacks. (The cancel callbacks outlived the Cancel BUTTON: they are what the scrim tap, Escape
  // and Android Back call.)

  // Changelog popup: the plain-words what-changed list (src/changelog, newest day first),
  // opened from the pinned foot's Changelog link — the same shared popup shell and card recipes as the
  // popups above. It carries NO dismiss control at all: the scrim tap, Escape and Android Back
  // already dismiss it, and the owner wanted the row back. CHANGELOG renders AS-IS: the ten-day cap
  // lives in the data itself (see the charter in
  // src/changelog), so what the module holds is exactly what a visitor downloads and exactly what
  // draws here — no entry ships only to be refused. The list sits inside its own scroll region on
  // the shared settings recipe (round 7, components/scrollRegion): the card owns py-4 only while
  // the title and scroll region each carry px-4, so the scroller's 1rem right padding
  // is the text-free lane the iOS scrollbar paints in; SCROLL_REGION_CLASS + scrollFadeClass (fed
  // by the changelogScrollRef edge listener up with the popover's) add the edge fades, and max-h
  // keeps a long history scrolling within the card without growing it off-screen. Entry dates
  // render through the foot's Last-Updated recipe (fmt + numericFormatOf) so they follow the
  // user's Date Format setting; the bullet list is the guide's UL idiom (list-disc + the
  // --mut-color marker). The card is heading row → list and NOTHING else — the heading row
  // gained the app's version on its right on 2026-08-10 (the note at the row explains the markup and
  // why the id moved onto a span), and it is still one row: a one-line "Shows the last ten days
  // with updates." notice once sat below the scroller, and the owner removed it on the rule that this popup answers WHAT CHANGED, while how the app
  // keeps its history is documentation — so the ten-day cap is explained in How to Play (the
  // Updates section) and nowhere else. Don't re-add it here. With zero focusable controls Tab
  // keeps the keyboard on the dialog card (the no-control case of components/overlayStack's Tab
  // rule) rather than letting it walk out to the panel beneath.
  const storageFigure = useStorageUsage((u) => u.figure)
  const storageWarning = useStorageUsage((u) => u.warning)
  const openStorageUsage = useStorageUsage((u) => u.openPopup)
  const changelogJsx = changelogOpen && (
    <Popup id="changelog" onDismiss={closeChangelog}>
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className={MODAL_CARD_CLASS}
      >
        {/* THE HEADING ROW: "What's new" left, the app's version right (2026-08-10). This popup is
              the version's ONLY home — not the ⚙ panel's "Last Updated" row, which has no space for
              it and which the owner will not give a second line to. Here it costs nothing: it sits
              in the panel someone opens to ask what changed, which is the same question.
              ★ WHY THE ID IS ON A SPAN AND NOT ON THIS ROW — the one thing not to "tidy". The card
              above is aria-labelledby="changelog-title", so whatever carries that id IS the dialog's
              accessible name. Put the id on the row and every screen reader announces the dialog as
              "What's new v2.19.0" on every open, and the name changes on every deploy — a moving
              landmark, and a version number read aloud to someone who did not ask for one. The id
              wraps ONLY the words, so the name stays exactly "What's new" (pinned by
              changelog.dom.test, and the whole suite reaches this dialog through
              getByRole('dialog', { name: "What's new" }), so a regression fails ~30 cases at once).
              The version is still IN the dialog and still read in its content, just not in its name.
              STYLING, decided rather than defaulted: text-xs, normal weight, tabular-nums (so the
              digits do not jitter between versions), and --tx-200-80 — the SAME token the changelog
              entry bullets use, so the version reads as part of this card's text rather than as a
              fourth kind of grey. NOT the muted marker token (--mut-color): that is calibrated for
              decorative punctuation, and this is already demoted three ways (smaller, lighter, and
              sitting beside a bright semibold heading).
              ⚠ THE MEASURED REASON IS NOT THE ONE THAT WAS PREDICTED, so it is written down as
              measured. The muted token was expected to fail on the LIGHT and PARCHMENT themes, which
              have the least contrast headroom. It does not: on those two, --mut-color and
              --tx-200-80 resolve to the same colour and both land at 4.62 / 4.59 against this card.
              The penalty is on the DARK themes, where the muted token is far dimmer than the text
              one — measured against the built app in a real browser, contrast vs the card:
                  --tx-200-80   dusk 9.12  midnight 9.67  slate 8.91  sepia 8.91  light 4.62  parch 4.59
                  --mut-color   dusk 5.69  midnight 5.95  slate 5.61  sepia 5.61  light 4.62  parch 4.59
              So the choice is right and is never worse — it is simply four themes that would have
              paid for it, not two. Every value above clears WCAG AA for normal text (4.5).
              items-baseline, not items-center: the version's baseline sits on the heading's, which is
              what makes two different type sizes read as one line. */}
        <div className="px-4 flex items-baseline justify-between gap-2">
          <span id="changelog-title" className="text-sm font-semibold text-(--tx-50)">
            What's new
          </span>
          <span className="text-xs tabular-nums text-(--tx-200-80)">v{APP_VERSION}</span>
        </div>
        <div
          ref={changelogScrollRef}
          className={`${SCROLL_REGION_CLASS} max-h-[55vh] space-y-3 ${scrollFadeClass(changelogScrolledFromTop, changelogAtBottom)}`}
        >
          {CHANGELOG.map((en) => {
            const [yy, mo, da] = en.date.split('-').map(Number)
            return (
              <div key={en.date} className="space-y-1">
                <div className="text-xs font-semibold text-(--tx-100-80)">
                  {fmt(yy, mo, da, numericFormatOf(dateFormat))}
                </div>
                <ul className="list-disc pl-4 space-y-1 marker:text-(--mut-color) text-xs text-(--tx-200-80)">
                  {en.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </Popup>
  )

  // The preset manager: the same shared popup shell as the four above. The card is
  // components/PresetManager, which holds the whole surface: the list, the rename fields, the
  // reorder handles, and the delete confirmation it swaps itself into.
  // ⚠ ITS DISMISS IS dismissPresets, NOT THE STRAIGHT CLOSE — the card's dismissal ladder, so a tap
  // outside while the delete question is up returns to the list exactly as Escape and Back do
  // (those two reach the question's own stack entry first; see useLayer above).
  const presetsJsx = presetsOpen && (
    <Popup id="presets" onDismiss={dismissPresets}>
      <PresetManager
        pendingDeleteId={pendingDeleteId}
        setPendingDeleteId={setPendingDeleteId}
        screensFresh={screensFresh}
        leaveNameBoxRef={leavePresetNameBox}
      />
    </Popup>
  )

  return (
    <>
      {/* ★ THE CARD IS THE FIRST CHILD OF THIS FRAGMENT AND HAS NO WRAPPER. It renders at the bar's
          slot, and it is `absolute left-4 right-4 top-full` against the bar's `relative` inner
          wrapper — an extra div here would become the containing block and detach the panel.
          Elevation + bottom cushion: this popover is a FLOATING surface (it pops over the page,
          which stays live and undimmed behind it — only a popup dims the page), so it wears the
          FLOATING shadow (`float-shadow`, index.css's three shadow roles) — the same one as every
          popup's card and every dropdown list — NOT the directional `elev-shadow-down` (that one
          is the scroll-BOUNDARY cue for fixed bars/headers/footers, the wrong language for a
          free-floating panel). Its fill is SOLID in every theme (--card-bg, index.css), so nothing
          on the page behind shows through this panel.
          Bottom cushion: the calc uses REM, not px, so it matches the rem-based side insets EXACTLY
          — left-4/right-4 = 1rem, and the app's root font is FLUID (html{font-size:clamp(...)}), so
          1rem ≠ 16px; a hardcoded px cushion would NOT equal the sides and would drift per-device.
          max-height = 100dvh - REAL measured bar height (--bar-h, a ROOT custom property, so it is
          inherited here wherever this renders) - 0.5rem (the mt-2 top gap, so it cancels) - 1rem
          cushion - bottom safe-area → the panel stops exactly 1rem above the viewable-area bottom =
          the SAME gap as its sides, on every device (Safari nav bar, installed-app home indicator,
          Android nav-bar/pill). env(safe-area-inset-bottom) is 0 on iOS (no viewport-fit=cover in
          index.html) — it only matters on edge-to-edge Android. (Tailwind arbitrary value:
          underscores become spaces, so calc() emits the whitespace CSS requires.)
          Press-drag contract (lib/pointerGestures): the CARD is the ⚙ trigger's menu —
          id="settings-popover" pairs it via the gear's aria-controls (the id IS the pairing; the
          card deliberately carries no [data-select-group], so a drag that STARTS inside it still
          scrolls natively instead of drag-selecting); the whole card is in drag scope, the pinned
          foot included. data-drag-dismiss opts it into close-on-drag-pick (App's drag-dismiss
          listener → the apply-on-close pass); the data-drag-stay regions opt back out — the
          Per-preset section's five buttons, the pinned foot, the Open in list, and the Manage
          Presets button (the theme block was one until round-8 dropped it, so a drag-pick on a
          theme pill now dismisses like the date-format pills). Each of those opens a popup or a
          list (every popup portals OUT of this card, so a drag-release on popup content can never
          drag-dismiss the panel), and the panel has to stay up behind it. The Year Range inputs
          are data-drag-focus (release = focus for typing, panel stays open). The inner scroll
          wrapper is data-drag-scroll — the controller's auto-scroll target + edge-band geometry.
          Scroll recipe (round 7): the wrapper wears SCROLL_REGION_CLASS + scrollFadeClass
          (components/scrollRegion) — this popover IS the reference treatment (card py-4 only, the
          px-4 scrollbar lane inside the scroller, edge fades) every other scroll region now
          shares.
          ⚠ pb-px AND THE 1px TAKEN BACK BELOW IT (Round 26, the owner's iPhone): the scroll area's
          height is fractional — it is what the card has left — while the browser's furthest scroll
          position is a whole pixel, so at the very end of the list up to a pixel of the last
          control could stay under the scroll area's bottom edge. On his phone that was the
          Amnesic pill's bottom border, cut by 0.2px (Chromium drops the line outright). One pixel
          of padding at the end of the list keeps every border of the last control inside, and
          the margin under the scroll area is the card's space-y-4 less that same pixel, so the
          distance from the last control to the foot's line is unchanged. tests/browser/
          settingsScrollEnd sweeps it.
          tabIndex −1 + its name: the card is what HOLDS the keyboard when the menu opens and the
          keyboard is not already in the top bar (components/overlayStack's "THE KEYBOARD'S REACH";
          src/main.tsx hands it over as the menu's `hold`) — so the first Tab lands on the first
          control and a key pressed before that acts on nothing. It is not in the Tab order itself
          and, like a popup's dialog, it draws no ring. */}
      <div
        ref={cardRef}
        id="settings-popover"
        role="group"
        aria-label="Settings menu"
        tabIndex={-1}
        data-drag-dismiss
        className="absolute left-4 right-4 top-full mt-2 z-50 rounded-2xl card float-shadow py-4 space-y-4 flex flex-col max-h-[calc(100dvh_-_var(--bar-h)_-_0.5rem_-_1rem_-_env(safe-area-inset-bottom))]"
      >
        <div
          ref={popoverInnerScrollRef}
          data-drag-scroll
          className={`${SCROLL_REGION_CLASS} pb-px mb-[calc(var(--spacing)*4_-_1px)] flex-1 min-h-0 space-y-4 ${scrollFadeClass(popoverScrolledFromTop, popoverAtBottom)}`}
        >
          {/* SETTINGS regrouped into 3 categories: Display (how it's shown + how you answer +
              theme), Dates (which dates get generated), Stats. Each category is a SectionLabel
              header; the former per-setting headings are now muted sub-labels (the Leap-Year
              header+sub-label pattern). Every control + its behaviour is unchanged — purely a
              regroup. */}
          {/* ── GLOBAL — THE PANEL'S FIRST SECTION, AND FIRST IS THE ARGUMENT ─────────────────
              This section holds what belongs to the WHOLE APP rather than to one preset: which
              preset a fresh open lands in ("Open in"), and the door to Manage Presets (inherently
              cross-preset). Everything BELOW the "Per-preset" label is the current preset's alone.
              That split is the owner's one-line rule ("only the current preset, ALL settings apply
              to that preset only including defaults and all that") drawn as layout rather than
              buried in a sentence — and round 21 made it explicit by giving the global items
              their own header instead of filing them under "Presets" with the rest.
              ★★ AND ROUND 22 GAVE THAT SPLIT ITS OWN VISUAL TIER, because until then it had
              none: "Global" and "Per-preset" were drawn as plain left-aligned SectionLabels, the
              SAME rank as the Display / Dates / Stats headers nested underneath them, above an
              identical section divider. The panel therefore LOOKED like five peer sections when it
              is really two groups with three categories inside the second. Both headings are
              GroupLabels now — centered, larger, semibold, brighter — and the divider above
              "Per-preset" is the panel's only heavy one. The three-tier rule, and why tier 1 and
              tier 3 may both be centered without colliding, is written out in components/
              primitives beside the two class strings that draw it.
              ⚠ IT IS WHY Display WEARS `pt-3 border-t` — the divider separates sections; Display is
              no longer the panel's first, so it is no longer the exception.
              ⚠ THE LINE OF PROSE IS NOT DUPLICATION OF THE GUIDE. How to Play explains what a
              preset IS and what Save Defaults captures; this says which preset you are in, that the
              Per-preset half of THIS card — its five buttons first — acts on it, and that "Open in"
              does not — a question asked by someone whose finger is already over Full Reset.
              THE MANAGE PRESETS BUTTON is a full-width `surface-toggle` — the app's no-fill
              interactive recipe (shared with View/Clear Saved Defaults below and with the manager's
              own row controls) at the panel's control tier (text-xs, py-1.5), not btn-solid: opening
              a manager is
              neither constructive nor destructive, and violet in this panel means "this saves
              something" (Save Defaults). It is deliberately NOT drawn as a switch row — THE PICKER
              RULE below reserves label-left/one-button-right for on/off settings. */}
          <div className="space-y-2">
            <GroupLabel>Global</GroupLabel>
            <div className="text-xs text-(--tx-200-80)">
              You are on <QuotedName name={activePresetName} strong />. Everything under Per-preset,
              your saved defaults included, belongs to that preset alone. The two settings here
              apply to the whole app.
            </div>
            {/* OPEN IN (round 21) — where a fresh app open lands. "Last used" is today's
                behaviour (the preset that was active when the app last closed); pick a preset to
                pin it instead. NOT captured by Save Defaults (it is global — see
                store/presetControl's setOpenInPreset).
                ★★ A DROPDOWN, NOT A TRAY, SINCE ROUND 23 — the one exception THE PICKER RULE
                below now names, and the reason is that presets are UNLIMITED. A tray has one segment
                per option, so its height grew with the preset count, and pill rows were rejected
                outright: at 10 presets there are 11 options, and any fixed per-row count leaves a lone
                orphan on the last row. The owner's requirement was that this control "should stay
                the same height", so the list lives in a panel that FLOATS over the ⚙ card (nothing in
                it moves when the list opens) and the closed trigger is one row whose height no
                preset count can change. It is the SAME control as the top-bar preset switcher —
                components/CustomSelect, the same list drawn by the same PresetOptionLabel — so it is
                learned once. A popup (scrim + card) was considered and turned down: heavier than
                "pick one from a list".
                • CustomSelect HOLDS THE ⚙ CARD'S SCROLL REGION STILL while this list is open — its
                  panel is fixed to where the trigger was when it opened, so the trigger must not move
                  (CustomSelect's caller contract, whose second route this is the first user of).
                • No pressDrag: this trigger is not the start of a gesture. A press-drag from the ⚙
                  that releases HERE clicks it, which opens the list rather than picking from it —
                  the owner accepted that cost; it is the Year Range boxes' pattern (release, then
                  type). And because that click must not take the panel down with it (the card is
                  data-drag-dismiss, like the Manage Presets button below), the wrapper carries
                  data-drag-stay — without it the release would open the list and close the panel
                  that holds it in the same breath.
                • The trigger wears the tray's own housing (border, surface-tray, rounded-xl, the
                  text-xs control tier) so it sits in this panel's rhythm at the height the tray's
                  single row had; the ▲▼ chevron is the switcher's, and says "this opens a list". */}
            <div className="text-xs text-(--tx-200-80) pt-1">Open in</div>
            <div data-drag-stay>
              <CustomSelect
                value={openInValue}
                onChange={changeOpenIn}
                options={openInOptions}
                ariaLabel="Open in"
                showChevron
                dropdownWidth="match-trigger"
                leastRowLabel={<ShortStockNameRoom />}
                className="w-full min-w-0 border surface-tray rounded-xl px-3 py-1.5 pr-6 text-xs font-medium text-left text-(--tx-100-80)"
              />
            </div>
            {/* ⚠⚠ data-drag-stay, AND IT IS NOT DECORATION — IT IS WHAT MAKES THIS BUTTON WORK AT
                ALL FROM THE GESTURE THE OWNER USES MOST. The ⚙ card is data-drag-dismiss, so a
                press-drag that starts on the gear and releases on a control inside it clicks the
                control AND closes the panel (lib/pointerGestures: `menu.hasAttribute
                ('data-drag-dismiss') && !member.closest('[data-drag-stay]')`). That is right for a
                setting — release on a theme pill and the panel gets out of the way — and it is
                catastrophic for a MODAL OPENER: the panel closing unmounts this component, and the
                modal it just opened goes with it, so the gesture would look like a button that does
                nothing. Every other modal opener in this card says the same for the same reason —
                the Per-preset section's five buttons (their wrapper) and the pinned foot's Storage
                used and Changelog links (the foot itself) — and this button stands alone in its
                section, so it says it for itself. */}
            <button
              type="button"
              data-drag-stay
              onClick={() => setPresetsOpen(true)}
              className="w-full px-3 py-1.5 rounded-xl text-xs font-medium border surface-toggle text-(--tx-100-80)"
            >
              Manage Presets
            </button>
          </div>
          {/* ── PER-PRESET — the header the owner asked for over everything that is saved per
              preset (round 21). Display / Dates / Stats and the five buttons all act on the ACTIVE
              preset; this label makes that visible instead of leaving it to How to Play.
              ★ THE FIVE BUTTONS ARE THE SECTION'S FIRST THING (Round 26, the owner's call). They
              were the panel's pinned foot until then, and the foot took ~217 of the panel's 760px
              on a 390×844 phone — a list squeezed into the top two thirds of its own card by
              buttons pressed a few times a session. In the scrolling page they cost the list
              nothing, and FIRST under this label is where they belong: they act on everything
              below it and on nothing above it, so the heading names their reach. The pinned foot
              keeps only the information lines. Then the caption, which points DOWN at what the
              buttons act on; then Default Mode — the page this preset opens on — the first such
              setting, captured by Save Defaults like the rest.
              ★★ THE PANEL'S ONE HEAVY DIVIDER, and it is the ONLY place `border-t-2` and the
              --bd-500-40 tone appear in this card: every section divider below is `border-t` on
              --bd-500-20, so this rule is twice the weight and twice the contrast of any of them,
              with pt-4 rather than pt-3 under it. That is the whole difference between "another
              section starts here" and "the panel's second half starts here", and it is why the
              treatment is written inline rather than lifted into a shared constant — a constant
              would invite a second user, and a second heavy rule is exactly what would stop this
              one reading as THE split.
              ★★ AND IT REALLY DOES SPAN THE CARD, EDGE TO EDGE — `-mx-4 px-4` on this div, which is
              what the owner asked for and what an earlier draft of this comment wrongly claimed was
              impossible. That draft reasoned that a scroll container clips overflow past its
              inline-START edge and cannot scroll to it, so the rule's left 1rem would vanish while
              its right survived. The premise is real and the conclusion does not follow, because
              NOTHING OVERFLOWS: the scroller carries the px-4 lane (components/scrollRegion — the
              card owns py-4 only), a −1rem margin reaches exactly its PADDING edge, and the padding
              box IS the clipping box. Measured in a real browser at 375px rather than argued:
              scrollWidth stays equal to clientWidth (no horizontal overflow appears, so no second
              scrollbar and nothing unreachable), and the rule lands flush on both of the card's
              inner edges.
              ⚠ THE px-4 PUTS THE SECTION'S CONTENTS BACK IN THE COLUMN the negative margin took
              them out of, to the pixel — every control below this label lines up with every control
              above it, exactly as before. It is deliberately the ONE line in the card that reaches
              the edges: that is the whole difference between "another section starts here" and "the
              panel's second half starts here", and every other divider stays in the column. */}
          <div className="space-y-2 pt-4 -mx-4 px-4 border-t-2 border-(--bd-500-40)">
            <GroupLabel>Per-preset</GroupLabel>
            {/* THE FIVE BUTTONS — two rows, one block. data-drag-stay on the block, because every
                one of the five opens a popup: the card is data-drag-dismiss, so a press-drag from
                the ⚙ that released here would otherwise click the button AND close the panel, and
                the popup it just opened would unmount with it (the Manage Presets button above
                argues it at length). The rows sit space-y-2 apart — the same 0.5rem as the gap-2
                between the buttons inside each row, so the five read as one grid. */}
            <div data-drag-stay className="space-y-2">
              <div ref={trioRef} className="flex gap-2">
                {/* No hidden caption twins any more (round 21): every caption in this trio is
                    static text now that the Full Reset two-tap arm — the one caption that swapped
                    ("Full Reset" → "Confirm?") — is a ConfirmModal. fitTrioCaptions measures the
                    live data-fitlabel spans directly, resetting each to its base size first so the
                    shrink cannot compound. */}
                {/* ★ HOW THESE THREE SAY "NOT RIGHT NOW" — one convention, stated three ways, and
                    round 15 is the round that finished it. Each is
                      (a) DRAWN unavailable — NOT_OFFERED_BTN_CLASS (controlClasses);
                      (b) ANNOUNCED unavailable — aria-disabled, so a screen reader stops calling it
                          an ordinary button while it does nothing;
                      (c) INERT — the handler guard inside each onClick, which round 14 added and
                          which is the only one of the three that is actually the BEHAVIOUR.
                    Belt and braces on purpose: (a) and (b) are what the user is told, (c) is what
                    is true. Delete any one of them and the other two start lying.
                    ⚠ AND (b) DOES ONE MORE JOB, off this file: lib/pointerGestures reads
                    aria-disabled to decide these are not gesture targets, so a press-drag from the
                    ⚙ gear neither rings one under the finger nor synthesizes a click on it. That job
                    used to belong to the pointer-events-none round 15 removed — see
                    NOT_OFFERED_BTN_CLASS. So the attribute is load-bearing twice over; it is not
                    decoration you can drop for a `title` or a tooltip.
                    ⚠ aria-disabled AND NOT `disabled`, decided on evidence and not on taste:
                      • It is already this app's convention — PillGroup, PillTray, SliderValueEditor
                        and MethodBreakdown's Show Codes all withhold with aria-disabled, and
                        index.css names `.btn-solid[aria-disabled="true"]` FIRST in its unavailable
                        rule. The one real `disabled` is Check for updates, which is a different
                        thing: momentarily busy, not conditionally meaningless.
                      • A real `disabled` DROPS FOCUS when it is applied to the focused element.
                        These three go dim as a RESULT of being pressed — press Reset Settings and
                        it dims itself — so a keyboard user would be thrown back to <body> by their
                        own successful action. aria-disabled leaves focus where it is and
                        re-announces.
                      • It keeps them discoverable. `disabled` removes them from the tab order
                        outright, which trades "reachable but silent" for "not there at all"; the
                        complaint this fixes is the silence, not the reachability.
                      • And it keeps the guards TESTABLE: jsdom refuses to dispatch activation on a
                        real `disabled` button, so the net could no longer ask what pressing a
                        dimmed button does — the exact question round 14's guards exist to answer.
                    Save Defaults is constructive → btn-solid purple (the Begin-button language),
                    keeping rose exclusively for the two destructive neighbors. It dims when live
                    state already equals the saved defaults (factory when none saved) — nothing new
                    to save. Each caption sits in a data-fitlabel span: one line
                    (whitespace-nowrap) unless fitTrioCaptions gives all three two, and never cut —
                    the fit runs before the first frame is drawn, so the button's overflow-hidden
                    clips nothing a player ever sees. */}
                <button
                  type="button"
                  onClick={openSaveDefaults}
                  aria-disabled={!settingsModified || undefined}
                  className={`flex-1 px-3 py-1.5 rounded-xl btn-solid border border-transparent text-xs font-medium overflow-hidden ${!settingsModified ? NOT_OFFERED_BTN_CLASS : ''}`}
                >
                  <span data-fitlabel className="whitespace-nowrap">
                    Save Defaults
                  </span>
                </button>
                {/* Reset Settings and Full Reset both open a ConfirmModal now (round 21). Reset
                    Settings had no confirmation before; Full Reset was a two-tap in-place arm whose
                    caption swapped to "Confirm?" and whose button wore an armed ring — all of that
                    is gone, the caption is static, and the popup carries the warning instead. */}
                <button
                  type="button"
                  onClick={openResetSettingsConfirm}
                  aria-disabled={!settingsModified || undefined}
                  className={`flex-1 ${PANEL_RESET_BTN_CLASS} overflow-hidden ${!settingsModified ? NOT_OFFERED_BTN_CLASS : ''}`}
                >
                  <span data-fitlabel className="whitespace-nowrap">
                    Reset Settings
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openFullResetConfirm}
                  aria-disabled={isFullyReset || undefined}
                  className={`flex-1 ${PANEL_RESET_BTN_CLASS} overflow-hidden ${isFullyReset ? NOT_OFFERED_BTN_CLASS : ''}`}
                >
                  <span data-fitlabel className="whitespace-nowrap">
                    Full Reset
                  </span>
                </button>
              </div>
              {/* ── THE SAVED-DEFAULTS PAIR — the block's SECOND ROW (round 6; restyled round 21).
                  Two plain EQUAL-WIDTH PILL BUTTONS filling the row directly under the trio — the
                  RESET_BTN_CLASS pill geometry (px-3 py-1.5 rounded-xl border, text-xs
                  font-medium, the border-transparent rendered-height rule) on the neutral
                  `surface-toggle` surface, NOT the rose fill: View only navigates and Clear only
                  OPENS a confirm, so neither is a destructive act in its own right (the same
                  reasoning that keeps PresetManager's ✕ off the rose fill). Plain flex-1 siblings
                  with the trio's own gap read as one control tier with the trio above.
                  Order: View LEFT of Clear, matching the trio's left→right escalation.
                  Both are ALWAYS MOUNTED (round 20). View Saved Defaults opens the defaults manager
                  on its clearly-labelled FACTORY view when nothing is saved. Clear Saved Defaults
                  opens a small CONFIRM modal (one red-tier Clear button) rather than firing
                  immediately — and with nothing saved there is nothing FOR it to clear, so it DIMS
                  AND LOCKS instead of disappearing: the identical three-part convention the trio
                  withholds with (see the trio's comment above) — NOT_OFFERED_BTN_CLASS draws it
                  unavailable, aria-disabled announces it, and the onClick guard is what actually
                  makes it inert. View is always offered, unlike Save Defaults directly above it,
                  which dims and locks whenever live == saved. */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openManageDefaults}
                  className="flex-1 px-3 py-1.5 rounded-xl text-xs font-medium border surface-toggle text-(--tx-100-80)"
                >
                  View Saved Defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (savedDefaults !== null) setClearConfirmOpen(true)
                  }}
                  aria-disabled={savedDefaults === null || undefined}
                  className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-medium border surface-toggle text-(--tx-100-80) ${savedDefaults === null ? NOT_OFFERED_BTN_CLASS : ''}`}
                >
                  Clear Saved Defaults
                </button>
              </div>
            </div>
            <div className="text-[0.6875rem] text-(--tx-300-60)">
              Everything below is saved for this preset. Save Defaults captures it, and the two
              Reset buttons restore it.
            </div>
            <div className="text-xs text-(--tx-200-80) pt-1">Default Mode</div>
            {/* Two stacked trays, one setting — the Date Format family pattern. The row that does
                not hold the active value shows no selected segment. */}
            <PillGroup label="Default Mode" className="space-y-1.5">
              <PillTray
                value={defaultMode}
                onChange={setDefaultMode}
                options={PRACTICE_MODE_OPTIONS}
              />
              <PillTray
                value={defaultMode}
                onChange={setDefaultMode}
                options={OTHER_PAGE_OPTIONS}
              />
            </PillGroup>
          </div>
          <div className="space-y-2 pt-3 border-t border-(--bd-500-20)">
            <SectionLabel>Display</SectionLabel>
            <div className="text-xs text-(--tx-200-80)">Date Format</div>
            {/* ★ EVERY SWITCH NAMES ITS SETTING (aria-label), on all four of them — this one, Use
                System Settings, the Julian Calendar toggle and Save Stats. Their visible
                content is the STATE ("On"/"Off"), which is the same two words on all four, so without
                a name a screen reader hears identical buttons and nothing can address one of them
                except by walking the DOM from its label span. The setting name is the row's label
                text VERBATIM, so speaking what you see still activates the switch and there is no
                second wording to keep in step. Not role="switch": that would change what these
                announce (a checked state) and the panel's a11y pass deliberately keeps them plain
                buttons whose text IS the state. */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-(--tx-200-80)">Random Format</span>
              <button
                type="button"
                aria-label="Random Format"
                onClick={() => setRandomFormat((v) => !v)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${randomFormat ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}`}
              >
                {randomFormat ? 'On' : 'Off'}
              </button>
            </div>
            {/* ★ THE PICKER RULE (round-9) — the panel has exactly TWO kinds of control, and each
                gets exactly ONE treatment. State it here, obey it everywhere below:
                  • SWITCH — a setting that is simply on/off (Random Format, Use System Settings,
                    Julian Calendar, Save Stats): label left, ONE On/Off button right.
                  • PICKER — a choice among named alternatives: ONE merged PillTray tray
                    (components/PillTray, where the concentric-housing recipe lives). Where the
                    alternatives fall into named families, each family gets its own centred caption
                    and the trays STACK.
                The housing is what says "these options are mutually exclusive", so it cannot be a
                per-group decoration: a picker drawn as loose gap-separated buttons reads exactly
                like the in-game rows that are genuinely INDEPENDENT toggles (Allow Mistakes,
                One-by-One), which is the confusion the rule exists to remove. Round-8 had trays on
                Date Format and Theme only; round-9 converted the two hold-outs (Input, and the
                three chance rows) — so the panel is now trays and switches, with ONE exception:
                  • DROPDOWN — a choice among an OPEN-ENDED list, whose length the player decides.
                    Exactly one: "Open in" (round 23), because presets are unlimited and a tray
                    grows a segment per option. It is argued at the control, above.
                Caption hierarchy (already correct, don't disturb it): the setting NAME is a
                left-aligned sentence-case sub-label; FAMILY captions are centred uppercase
                SectionLabels — tier 3 of the panel's three-tier heading rule, stated in
                components/primitives. Name → optional family captions → tray(s).
                Date Format is the family case: five ids in two trays, both reading and writing the
                SAME setting, so the half that doesn't hold the active id shows no selected segment.
                The two trays share ONE ROW (round-10 revert of round-9's stack). Theme stacks out
                of NECESSITY — five theme names measured at zero headroom on any phone narrower than
                the owner's — and round-9 mistook that forced layout for a rule and applied it here
                too, costing ~61px of scrolling for consistency with a case that had no choice.
                These labels are m/d/y-sized, so both trays fit a row comfortably at every width we
                ship. THE RULE IS ABOUT HOUSINGS, NOT AXIS: each named family gets its own captioned
                tray; whether the trays sit side by side or stack is a FIT question, answered per
                group. ONE PillGroup spans BOTH trays, on the wrapper that already exists to hold
                them: a group is a CHOICE, not a row, and two groups would each report "nothing
                selected" whenever the live format lived in the other half — and would also split
                one keyboard choice into two tab stops that refuse to arrow into each other. That
                wrapper is also the dim, so the lock provably covers the captions. Written / Numeric
                stay plain captions — the halves ride in the pills' accessible names
                (WRITTEN_FORMATS/NUMERIC_FORMATS), which keeps the two 'MDY's apart. Every picker
                below states its state ONCE, on its PillGroup: `dormant` (not in effect — outlined,
                still changeable, its reason read to a screen reader) or `disabled` (cannot be used —
                faded, locked). Round 26 made the first of those the rule for everything kept but
                idle (the owner: "dimmed means not in effect right now, not locked").
                ★ DATE FORMAT IS NOT IN EFFECT ONLY WHERE IT IS NOT: Random Format on, on a page
                whose dates it does not set (DATE_FORMAT_IDLE_PAGES, which says why Deduction,
                Lookup, and How to Play are not among them). */}
            <PillGroup
              label="Date Format"
              dormant={
                randomFormat && DATE_FORMAT_IDLE_PAGES.has(mode)
                  ? NOT_IN_EFFECT.randomFormat
                  : undefined
              }
              className="flex gap-2"
            >
              <div className="flex-1 space-y-1.5">
                <SectionLabel className="text-center">Written</SectionLabel>
                <PillTray value={dateFormat} onChange={setDateFormat} options={WRITTEN_FORMATS} />
              </div>
              <div className="flex-1 space-y-1.5">
                <SectionLabel className="text-center">Numeric</SectionLabel>
                <PillTray value={dateFormat} onChange={setDateFormat} options={NUMERIC_FORMATS} />
              </div>
            </PillGroup>
            {/* Input — Buttons / Dots (the logo's 7-dot answer layout). A picker with no families,
                so: one tray, no captions. Not in effect in Deduction (answers aren't weekdays; the
                value is kept and still changeable), like Julian/Leap-Year Chance when they don't
                apply — the state sits on the GROUP, so the housing goes hollow as one piece. The
                condition is `==='deduction'` EXACTLY, and it is LIVE: every other mode has Input in
                effect. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Input</div>
            <PillGroup
              label="Input"
              dormant={mode === 'deduction' ? NOT_IN_EFFECT.deduction : undefined}
            >
              <PillTray value={inputStyle} onChange={setInputStyle} options={INPUT_STYLES} />
            </PillGroup>
            {/* Rotate Dots — how far the 7-dot layout is TURNED counterclockwise: Standard / 45° CCW /
                90° CCW (lib/dotLayout, the one geometry both the real input and How-to-Play's
                diagram derive from). ITS SHAPE HAS FOLLOWED THE PICKER RULE ABOVE EACH TIME IT
                CHANGED: two named options (Columns / Rows) were a PillTray until round 20
                recognised them as an on/off shape and made them a SWITCH; round 23 added 45°,
                and three named alternatives are a PICKER again — one tray, no families, like
                Input above it. The row name is "Rotate Dots" rather than round 21's "Rotate Dots
                CCW" (the owner's call then, reversing an older "not labelled Rotate" argument —
                the plain-language win beat the word's second meaning on RotateOverlay's
                turn-your-device screen): the direction now rides in the pills themselves, so
                saying it twice would only crowd the row.
                ★ IT IS NOT IN EFFECT WHENEVER THERE ARE NO DOTS ON SCREEN TO TURN (round 26: drawn
                outlined and still changeable — it used to lock), which is two conditions and
                not one: Deduction (whose answers are not weekdays at all — the same
                `mode === 'deduction'` the Input picker above uses, shared on purpose, because a
                live control sitting directly beneath a dead one, both about dots, would read as a
                bug in the lock), and ANY mode while Input is on Buttons — the second half is what
                makes the mark's own fix (main.tsx's W5Logo call site) necessary in the first place:
                with Input on Buttons there is nothing on screen for a turned mark to correspond to,
                so the CONTROL that could turn it is not in effect either, not just the mark itself.
                Stated once, as PillGroup's `dormant`, like every other picker.
                ⚠ IT IS NEVER A RESET — the value is kept, and can be changed, while it is not in
                effect, exactly as Julian Chance behaves when the year range makes it moot. Switch
                Input back to Dots and the rotation you chose is still selected.
                ⚠ THE LOCK AND THE MARK ARE GATED ON DIFFERENT THINGS, written down so it is not later
                reported as a bug: this picker idles on Deduction OR Input-on-Buttons, while the
                title-bar mark is gated on Input alone (main.tsx passes `<W5Logo>` the setting only
                while `inputStyle==='dots'`). So on Buttons the mark is upright in every mode; and
                in Deduction with Input on Dots the picker is outlined but the mark still shows the
                rotation chosen. How to Play says exactly this. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Rotate Dots</div>
            <PillGroup
              label="Rotate Dots"
              dormant={
                mode === 'deduction'
                  ? NOT_IN_EFFECT.deduction
                  : inputStyle !== 'dots'
                    ? NOT_IN_EFFECT.buttons
                    : undefined
              }
            >
              <PillTray
                value={dotRotation}
                onChange={setDotRotation}
                options={DOT_ROTATION_OPTIONS}
              />
            </PillGroup>
            <div className="text-xs text-(--tx-200-80) pt-1">Theme</div>
            {/* Flipping Use System Settings OFF seeds the manual theme from what is ALREADY on
                screen (activeTheme — App's, because it folds in an OS signal App owns), so the
                switch never jumps the user to a different look: the pill that was lit stays lit, now
                as the single manual pick. Both values are read from the RENDER closure, BEFORE the
                flip. An OFF→ON round trip leaves manualTheme wherever the OFF pass parked it, but
                that value is DORMANT while the OS decides, and App's settingsAtDefaults
                compares only the theme values actually in effect — so the round trip cannot leave
                the gear falsely reading "modified". */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-(--tx-200-80)">Use System Settings</span>
              <button
                type="button"
                aria-label="Use System Settings"
                onClick={() => {
                  if (useSystem) setManualTheme(activeTheme)
                  setUseSystem((v) => !v)
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${useSystem ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}`}
              >
                {useSystem ? 'On' : 'Off'}
              </button>
            </div>
            {/* The five themes as two PillTray rows (round-8), replacing the dropdowns they used to
                hide behind. The SAME two rows render in both Use-System states — the panel no
                longer changes height when the switch is flipped — and the centered Dark / Light
                captions carry the whole state difference:
                  • Use System ON  — two INDEPENDENT picks (the OS decides which row is live), so
                    each row reads and writes its own store value.
                  • Use System OFF — ONE pick across BOTH rows: both rows read manualTheme, so the
                    row that doesn't hold it shows no selected segment.
                Captions stay CENTERED in both states — they are TIER 3 of the panel's three-tier
                heading rule (components/primitives states it in full beside the classes that draw
                it): a centered SectionLabel is a sub-label naming one FAMILY inside a single
                setting, and the left-aligned spelling is reserved for the DISPLAY / DATES / STATS
                category headers a tier above, which a left-aligned caption here would out-rank.
                ⚠ ROUND 22 ADDED A TIER ABOVE BOTH — the centered, larger, semibold GroupLabels
                on "Global" and "Per-preset" — and it did NOT relax this rule: the whole reason that
                tier is its own component with its own class string is that tier 1 and tier 3 share
                an ALIGNMENT and must never share anything else, so a caption that grew weight or
                size would be the collision this note exists to prevent.
                Neither row is marked "in use" — the OS owns that, and a marker would imply the
                app does. NEITHER ROW IS EVER DIMMED, in either state: none of these three
                PillGroups ever takes `disabled`. This is a SHAPE change, not a lock, and dimming or
                hiding the inactive row is a change the owner explicitly rejected.
                No data-drag-stay (round-8, owner's call): a press-drag from the gear that releases
                on a theme pill DISMISSES the panel, exactly like the date-format pills — "if I want
                to change both, I'd just tap settings instead of doing the dragging thing."
                The RADIOGROUPS follow the selection semantics above rather than the two rows, for
                the same reason the date-format trays share one group: a group is a CHOICE. Use
                System ON = two independent picks = two groups. OFF = one pick across both rows =
                ONE group spanning them, so the row that doesn't hold manualTheme isn't announced as
                an empty choice of its own — and one pick answers to one tab stop and one arrow
                walk. The shared wrapper is not an element added to carry a role — it is also what
                supplies the 8px between the rows that the section's space-y-2 gave them as
                siblings. Which of the three wrappers is the real group is exactly which of them is
                NAMED: an unnamed PillGroup is just the div (a radiogroup must have a name to be
                one), so the switch moves the role, the keyboard and nothing else. All five theme
                names are distinct, so no pill needs an ariaLabel. */}
            <PillGroup className="space-y-2" label={useSystem ? undefined : 'Theme'}>
              <PillGroup className="space-y-1.5" label={useSystem ? 'Dark theme' : undefined}>
                <SectionLabel className="text-center">Dark</SectionLabel>
                <PillTray
                  value={useSystem ? darkTheme : manualTheme}
                  onChange={useSystem ? setDarkTheme : setManualTheme}
                  options={DARK_THEMES}
                />
              </PillGroup>
              <PillGroup className="space-y-1.5" label={useSystem ? 'Light theme' : undefined}>
                <SectionLabel className="text-center">Light</SectionLabel>
                <PillTray
                  value={useSystem ? lightTheme : manualTheme}
                  onChange={useSystem ? setLightTheme : setManualTheme}
                  options={LIGHT_THEMES}
                />
              </PillGroup>
            </PillGroup>
          </div>
          <div className="space-y-2 pt-3 border-t border-(--bd-500-20)">
            <SectionLabel>Dates</SectionLabel>
            <div className="text-xs text-(--tx-200-80)">Year Range</div>
            {/* ★ TWO PAIRS OF BOXES ON ONE ROW (Round 26, Q7): the range used while the Julian
                Calendar setting is off (up to 10000), and the one used while it is on (up to 11582
                — lib/calendar's caps). Two captioned families side by side, Date Format's pattern;
                each family and each box takes an equal share of the row, never below the room its
                longest year needs in the device's font (YearBox's sizer says how — a fixed width
                cannot hold four on every font). Where the floors do not fit one row the row wraps,
                each pair whole (flex-wrap; items-end keeps the boxes on one line if the captions
                ever wrap). Only the pair for the setting as it stands is in effect
                (lib/dateConfig's yearRangeInEffect); the other is still typed into and saved, and
                changing it changes no date. */}
            {/* ★ EVERY YEAR BOX NAMES ITSELF (aria-label), for the same reason the four
                switches above do: their only context is the "Year Range" caption above the row,
                its pair's caption, and a "→" between them, none of which a screen reader attaches
                to an input — so without a name they announce as bare, indistinguishable edit
                boxes. Each name carries its pair ("Earliest Year, Julian Off").
                "Earliest"/"Latest" rather than "Minimum"/"Maximum" to match the guide's own
                framing of the range (GuidePage "Dates — Year Range").
                Purely additive: no visible label is added, so the row's geometry is untouched.
                ⚠ These names are also the TEST HANDLE for the four boxes. Do not remove them
                expecting the suite to catch it by other means: the boxes carry no other stable
                identity, and the previous handle — data-drag-focus — is a GENERAL press-drag
                opt-in (src/lib/pointerGestures.ts), so any third control in the panel adopting it
                would have broken every year-range test at once.
                ⚠ THE TEXT IN THESE BOXES IS NOT PANEL STATE. It lives in App
                (components/useYearRangeMirrors, one per pair) and arrives as the `yearRangeOff`
                and `yearRangeOn` props, together with the four refs, precisely so a half-typed
                year survives closing and reopening the panel — which it would not if this
                component owned it and remounted per open.
                The committed years come straight from their stores, as everywhere else in the
                panel: the Julian-off pair is the settings store's minY/maxY, the Julian-on pair
                store/julianRange's. */}
            {/* ★ WHAT ESCAPE DOES IN A YEAR BOX, and why it is written this awkwardly (round 14 —
                it did neither of these things before, and the intent had always been to).
                THROW THE EDIT AWAY: put the committed year back in the box. The revert used to be
                a plain setValue followed by the blur() below, and the two landed in ONE React
                batch — so onBlur's commit still closed over the PRE-revert text and committed the
                very value Escape was discarding. (Only unparseable text appeared to revert, via
                the commit's own cannot-parse branch, which is presumably why it went unnoticed.)
                flushSync lands the revert BEFORE the blur, so the commit that follows re-reads
                the restored year and is a no-op. currentTarget is captured first because it is
                only valid during dispatch.
                AND KEEP THE PANEL OPEN: Escape also closes the top open layer — this panel
                (components/overlayStack) — but that rule stands aside while a text box has the
                keyboard, which is what leaves this press to the box.
                Escape still BLURS, deliberately. It keeps the pair the author wrote (Enter = keep
                it and let go, Escape = discard it and let go), it drops the numeric keyboard on a
                phone, and it leaves a second Escape free to close the panel — a dismissal ladder,
                rather than an input that swallows Escape forever. */}
            <div className="flex flex-wrap items-end gap-2">
              <YearPair
                caption="Julian Off"
                mirrors={yearRangeOff}
                min={minY}
                max={maxY}
                minRef={minYearRef}
                maxRef={maxYearRef}
                dormant={useJulian ? NOT_IN_EFFECT.julianOn : undefined}
              />
              <YearPair
                caption="Julian On"
                mirrors={yearRangeOn}
                min={julianMinY}
                max={julianMaxY}
                minRef={julianMinYearRef}
                maxRef={julianMaxYearRef}
                dormant={useJulian ? undefined : NOT_IN_EFFECT.julianOff}
              />
            </div>
            {/* ★ THE ORDER OF THIS SECTION (round-12) — Year Range, then the two LEAP rows, then
                the JULIAN pair last. Julian Chance is not in effect unless the switch is ON *and*
                the range straddles 1582, so under any ordinary modern range it is an idle control;
                it used to sit third, ABOVE two live ones. Two pairings constrain any
                future reshuffle: Jan/Feb Chance is a sub-case of Leap Year Chance and must sit
                directly under it, and the Julian switch is the thing that explains why Julian
                Chance goes out of effect, so it must stay directly above it. Move the Julian pair, never one
                half of it.
                The three chance rows (this one, Jan/Feb under it, and Julian Chance at the foot of
                the section) are pickers, so they are trays (THE PICKER RULE, Display above) —
                round-9 converted them from the flat gap-separated buttons they shipped as. The
                conversion costs no height: these rows already captioned ABOVE their control, and
                the tray's ~2px seams are tighter than the ~6px gaps they replace, so every label
                gained room. Each row's state sits on the GROUP instead of on every button, so the
                housing changes as one piece; the caption stays lit, as it always did.
                ★ ALL THREE ARE NOT IN EFFECT EXACTLY WHEN lib/dateConfig SAYS — the same three
                questions (leapChanceApplies, janFebChanceApplies, julianChanceApplies) the settings
                in effect are built from, asked of the Year Range in use — so what the panel draws
                as idle is what the generator, the resets, and the Best keys leave out. Outlined,
                never locked (round 26): the value is kept and can be changed, and comes back into
                effect with a range it can apply to.
                Leap Year Chance: not in effect when the range in use has no leap year, or is a
                single leap year (every date is then in a leap year, whatever it says). */}
            <div className="text-xs text-(--tx-200-80) pt-1">Leap Year Chance</div>
            <PillGroup
              label="Leap Year Chance"
              dormant={
                !janFebChanceApplies(range.minY, range.maxY, useJulian)
                  ? NOT_IN_EFFECT.noLeapYear
                  : !leapChanceApplies(range.minY, range.maxY, useJulian)
                    ? NOT_IN_EFFECT.onlyLeapYears
                    : undefined
              }
            >
              <PillTray value={leapChance} onChange={setLeapChance} options={LEAP_CHANCE_OPTIONS} />
            </PillGroup>
            {/* Jan/Feb Chance: the listed % is the exact probability a leap-year date lands on
                Jan/Feb (Random = natural ~17%). Not in effect when the range in use has no leap
                year — before round 26 it stayed lit there, doing nothing, while a change to it
                still restarted a run. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Jan/Feb Chance on Leap Years</div>
            <PillGroup
              label="Jan/Feb Chance on Leap Years"
              dormant={
                janFebChanceApplies(range.minY, range.maxY, useJulian)
                  ? undefined
                  : NOT_IN_EFFECT.noLeapYear
              }
            >
              <PillTray value={janFebChance} onChange={setJanFebChance} options={CHANCE_OPTIONS} />
            </PillGroup>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-(--tx-200-80)">Julian Calendar (pre-Oct 15, 1582)</span>
              <button
                type="button"
                aria-label="Julian Calendar (pre-Oct 15, 1582)"
                onClick={() => setUseJulian((v) => !v)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${useJulian ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}`}
              >
                {useJulian ? 'On' : 'Off'}
              </button>
            </div>
            {/* Julian Chance: not in effect unless the switch directly above is ON *and* the year
                range in use straddles 1582 (= mixed Julian+Gregorian: minY<=1582<=maxY; year 1582
                itself spans both calendars) — and never in Deduction, whose puzzles do not read it
                (App leaves it out of Deduction's settings in effect). The selected value stays
                selected, and changeable. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Julian Chance</div>
            <PillGroup
              label="Julian Chance"
              dormant={
                !useJulian
                  ? NOT_IN_EFFECT.julianOff
                  : !julianChanceApplies(range.minY, range.maxY, useJulian)
                    ? NOT_IN_EFFECT.no1582
                    : mode === 'deduction'
                      ? NOT_IN_EFFECT.deduction
                      : undefined
              }
            >
              <PillTray value={julianChance} onChange={setJulianChance} options={CHANCE_OPTIONS} />
            </PillGroup>
          </div>
          <div className="space-y-2 pt-3 border-t border-(--bd-500-20)">
            <SectionLabel>Stats</SectionLabel>
            <div className="flex items-center justify-between">
              <span className="text-xs text-(--tx-200-80)">Save Stats</span>
              <button
                type="button"
                aria-label="Save Stats"
                onClick={toggleSaveStats}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${saveStats ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}`}
              >
                {saveStats ? 'On' : 'Off'}
              </button>
            </div>
            {/* AMNESIC — "does it last", directly under "does it count". A PICKER by THE PICKER RULE
                above (three values, exactly one of them): caption above, one tray, the group named
                by the caption VERBATIM. See changeAmnesic for why this one row's value is held for
                the session rather than as a ⚙ setting, and store/amnesic for what each value
                clears and keeps.
                ⚠ THE LOCK. With Save Stats off nothing is being recorded at all, so "does it last"
                has no subject and the tray dims — the app's established "dimmed means disabled",
                stated once, as PillGroup's `disabled`, like every other picker: the housing greys
                as one piece and the caption stays lit.
                ⚠ THE VALUE IS PRESERVED WHILE LOCKED, like Julian Chance's selection — turning
                Save Stats back on restores an amnesic preset to being amnesic. Locking it is what
                stops the change: one made from behind the dim would throw away the session and the
                run in progress with it, for a setting the user was told did not apply. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Amnesic</div>
            <PillGroup label="Amnesic" disabled={!saveStats}>
              <PillTray value={amnesic} onChange={changeAmnesic} options={AMNESIC_OPTIONS} />
            </PillGroup>
          </div>
        </div>
        {/* ── THE PINNED FOOT — the information lines, and nothing else (Round 26, the owner's
            call: the five buttons moved up to head the Per-preset section, so the foot that once
            took ~217 of a 390×844 phone's 760px panel is three short lines). Contact; then
            Storage used, with Changelog at the right; then Last Updated, with Check for updates at
            the right. It stays pinned because each line is something to SEE at any scroll
            position — the Changelog dot above all, the second stage of the update breadcrumb the
            gear's dot starts, and Storage used, which the owner asked to be always visible
            (Round 24).
            The panel's bottom boundary. elev-shadow-up is UNCONDITIONAL: its strength is the
            --shade the edge hook writes onto this element (0 when the list is scrolled to the end,
            ramping to full over the last --shade-ramp of travel), so there is no class to toggle and
            nothing left to animate.
            data-drag-stay: Storage used and Changelog open popups, and Check for updates must keep
            the panel up to show its answer — a press-drag from the ⚙ that releases on any of them
            must not close the panel.
            Every TEXT LINK here — Contact, Storage used, Check for updates, Changelog — carries
            rounded-md px-1 -mx-1: the padding gives the press-drag ring breathing room around the
            text and the radius rounds its corners (vs a square outline hugging the glyphs); the
            negative margin cancels the padding so the text keeps its exact flow position (see
            FOOTER_META_ROW_CLASS, which owns the ring-clearance derivation).
            The lines sit space-y-0.5 apart; FOOTER_META_ROW_CLASS's row gap is the same 0.125rem,
            so a row that ever has to break (a window narrower than any phone's) adds a line at
            exactly the spacing of the others. tests/browser/settingsFoot pins both: one line per
            row at every phone size, and equal gaps between the lines at every size.
            ⚠ .popover-sticky-footer HAS NO CSS RULE ANYWHERE — round 13 removed it, and
            tests/guideScroll.dom separately asserts it is ABSENT from the stylesheet. It reads as
            dead markup and is not: it is this footer's only stable identity, and the tests query
            it. Do not delete it. */}
        <div
          ref={popoverFooterRef}
          data-drag-stay
          className="popover-sticky-footer elev-shadow-up pt-3 px-4 border-t border-(--bd-500-20) text-[0.6875rem] text-(--tx-300-60) space-y-0.5"
        >
          <div>
            Contact:{' '}
            <a
              href="mailto:dayoftheweekcalculation@gmail.com"
              className="underline break-all select-text rounded-md px-1 -mx-1"
            >
              dayoftheweekcalculation@gmail.com
            </a>
          </div>
          {/* HOW FULL THE DEVICE'S ROOM FOR THE APP IS (store/storageUsage) — always shown, and a
              tap opens the breakdown (components/StorageUsagePopup, App's). The figure is the
              store's own text for it — one decimal place, by the one rule the popup's title and
              rows use (percentText) — drawn the way they draw theirs (StoragePercent, which gives
              a screen reader words for the one figure written with a sign), in tabular figures, so
              the line keeps its width as the digits change. A dash on a device whose limit could
              not be measured — there is no honest percentage without one. From the warning line up
              it wears the warning colour (index.css's .storage-warn), with the words for it for a
              screen reader — colour alone says nothing to one.
              It shares its line with Changelog, which FOOTER_META_ROW_CLASS anchors at the right. */}
          <div className={FOOTER_META_ROW_CLASS}>
            <button
              type="button"
              onClick={openStorageUsage}
              className={`select-none rounded-md px-1 -mx-1 underline tabular-nums ${storageWarning ? 'storage-warn' : ''}`}
            >
              Storage used:{' '}
              {storageFigure === null ? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">not measured yet</span>
                </>
              ) : (
                <StoragePercent written={storageFigure} />
              )}
              {storageWarning && <span className="sr-only">, almost full</span>}
            </button>
            {/* Changelog wears the INLINE UpdateDot until its first tap after a build change — the
                second stage of the breadcrumb the gear's dot starts. ⚠ Since 2026-08-10 that dot
                appears only when the changelog actually GAINED something, so an internal deploy
                lights the gear and leaves this one dark.
                ⚠ ITS BOX IS ITS TEXT (Round 26): the dot HANGS past the end of the word, out of flow
                (UpdateDot's `trailing`, index.css), so the link's right edge — the edge the line
                anchors at the right — is the word's, level with Check for updates' below it, and
                lighting the dot cannot shift the line. It used to keep a slot in flow for the dot,
                which stood the word ~6px left of the line below.
                Round 8 rebuilt that marker: a text link reserves no room for the gear's corner
                badge, so the round-6 shared recipe put the dot on top of the word. The link is an
                inline-flex row now — the text in its own span, with the underline ON that span,
                and the marker hanging from it out of flow, where no underline reaches. Being
                aria-hidden, the marker needs the sr-only word beside it to reach a screen reader,
                which is also the only update signal left once the gear's dot has been retired.
                ⚠ That word carries its own COMMA rather than the gear's "(update)" parenthetical:
                the name-from-content algorithm trims each child's text before joining them, so a
                leading space is dropped and the two would run together ("Changelog(update)"). A
                printing separator is the only one that survives the join. */}
            <button
              type="button"
              onClick={openChangelog}
              className="inline-flex items-center select-none rounded-md px-1 -mx-1"
            >
              <span className="underline relative">
                Changelog
                <UpdateDot placement="trailing" lit={changelogDot} />
              </span>
              {changelogDot && <span className="sr-only">, update</span>}
            </button>
          </div>
          {/* THE BUILD STAMP, with Check for updates at the line's right end — the stamp says
              which copy you have, the button asks whether there is a newer one. The stamp is the
              widest of the four items and the only one whose width changes (a different date, a
              different Date Format); it grows from the left edge it is anchored to. */}
          <div className={FOOTER_META_ROW_CLASS}>
            <span>
              Last Updated:{' '}
              {(() => {
                // A dev server was never deployed, so it has no date to show (src/deployStamp).
                if (!BUILD_IS_DEPLOYED) return 'development build'
                const d = DEPLOY_TS
                const yy = d.getFullYear()
                const mo = d.getMonth() + 1
                const da = d.getDate()
                const numFmt = numericFormatOf(dateFormat)
                const datePart = fmt(yy, mo, da, numFmt)
                const timePart = d.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
                return `${datePart} ${timePart}`
              })()}
            </span>
            {/* Check for a newer deployed version and apply it if there is one (round 11 — it
                used to reload unconditionally). The state machine behind it is App's
                (components/useUpdateCheck, called there and never here — it contains a
                useSettingsCloseEffect, which would never fire from a component that unmounts on
                close); this is only its button. Styled like the Contact email link above (inherits
                the footer's text-(--tx-300-60)) so it matches the surrounding footer text on every
                theme, with three deliberate departures:
                  • THE HIDDEN STRUT. The button is a one-cell grid holding the resting label twice
                    — an aria-hidden copy that only reserves width, and the live label stacked on
                    it. So the button is always exactly as wide as "Check for updates" (the longest
                    of the four by construction — lib/updateCheck pins it): its width never changes
                    with its state, so whether this line fits is decided once, by the resting label,
                    and a status label can never be the thing that breaks it. justify-items-END
                    puts each shorter status label against the line's right edge, under Changelog's,
                    so the right-hand column stays one column (Round 26; while this button sat
                    between the stamp and Changelog the labels were centred, the owner's call of
                    2026-08-02 for that middle position). The resting label is the widest, so it
                    fills the cell exactly and the alignment cannot move it.
                  • UNDERLINE ONLY AT REST. The other three labels are STATUS, not actions; wearing
                    the interaction signal while not being the interaction is the round-3
                    block-hover mistake. The button still IS pressable during a result — a tap
                    starts another check — but it is not offering the same thing, so it does not
                    claim to.
                  • DISABLED while checking, so the state the label reports is the state the control
                    is in. The NATIVE disabled attribute, deliberately — the suite pins `.disabled`
                    and a swap to aria-disabled fails there on purpose. No aria-live: a tap leaves
                    focus on the button, where the accessible name changing is announced anyway, and
                    a live region inside a control double-announces on some screen readers — an
                    unverifiable trade for no gain. */}
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={updateCheck === 'checking'}
              className="select-none rounded-md px-1 -mx-1 grid justify-items-end"
            >
              <span
                aria-hidden="true"
                className="col-start-1 row-start-1 invisible whitespace-nowrap"
              >
                {UPDATE_CHECK_LABEL.idle}
              </span>
              <span
                className={`col-start-1 row-start-1 whitespace-nowrap ${updateCheck === 'idle' ? ' underline' : ''}`}
              >
                {UPDATE_CHECK_LABEL[updateCheck]}
              </span>
            </button>
          </div>
        </div>
      </div>
      {saveDefaultsJsx}
      {manageDefaultsJsx}
      {changelogJsx}
      {presetsJsx}
      {/* The three reset-style confirmations (round 21) — one shape, one component. Every popup
          names what the action does and whether it is per-preset or app-wide; the owner delegated
          the wording to Claude, matched to the Clear popup's and How to Play's voice. */}
      <ConfirmModal
        open={fullResetConfirmOpen}
        onCancel={closeFullResetConfirm}
        onConfirm={confirmFullReset}
        title="Full Reset this preset?"
        body="Wipes this preset's stats and all-time bests, and returns every ⚙ setting and each mode's setup to your saved defaults — the launch defaults for anything you haven't saved. The saved defaults themselves are kept, and no other preset is touched. Your shared Lookup history is cleared too."
        confirmLabel="Full Reset"
        id="full-reset"
      />
      <ConfirmModal
        open={resetSettingsConfirmOpen}
        onCancel={closeResetSettingsConfirm}
        onConfirm={confirmResetSettings}
        title="Reset Settings for this preset?"
        body="Restores this preset's ⚙ settings — Display, Dates, Stats (Amnesic included), and Default Mode — plus Flash speed, the MoX run length, and both Blitz timers, to your saved defaults, or the launch defaults if you've saved none. Your stats and all-time bests are untouched — unless this changes Amnesic, which does exactly what changing it yourself does — and you stay on the page you're on."
        confirmLabel="Reset Settings"
        id="reset-settings-confirm"
      />
      {/* Confirm labels above deliberately REPEAT the action verb ("Full Reset" / "Reset
          Settings"), so screen-reader users hear the same words on the trigger and on the
          confirm. The popups those buttons open portal OUT of this component's card, so
          a name query scoped to the ⚙ panel never sees the popup's button and vice versa. */}
      <ConfirmModal
        open={clearConfirmOpen}
        onCancel={closeClearConfirm}
        onConfirm={confirmClearDefaults}
        title="Clear your saved defaults?"
        body="This only forgets the snapshot — your current settings stay as they are, and the launch defaults take over. Saved defaults are per-preset, so no other preset is affected."
        confirmLabel="Clear"
        id="clear-defaults"
      />
    </>
  )
}
