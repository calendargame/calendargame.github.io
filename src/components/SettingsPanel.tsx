// ★ THE HOOKS ARE NAMED IMPORTS, AND THAT IS LOAD-BEARING — DO NOT "TIDY" IT BACK TO
// `import * as React` + `const { useEffect, … } = React`. That form defeats the react-hooks /
// React-Compiler ESLint rules' detection: they resolve hooks through the import, so a namespace
// binding makes the WHOLE FILE invisible to them. (This file inherited the bad form from main.tsx,
// which carried it until round 16's B5 — main.tsx now uses named imports too, and the two
// set-state-in-effect violations that had been hiding behind it were fixed rather than suppressed.
// LookupCard.tsx and MethodBreakdown.tsx are the last two files still calling their hooks as
// React.useX, and are still invisible to the rules — see the escalation with round 16. modeHooks
// and useSettingsCloseEffect also write `import * as React`, but ONLY for React.DependencyList in a
// type position; their hooks are named imports, so the rules do see them.)
// Verified by probe in round 14 — swapping this one line back takes `eslint` on this file from
// reporting a genuine react-hooks/set-state-in-effect error (in the Full Reset safety net, see
// ~line 545) to clean. Nothing about the code changes; only whether anything is looking at it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { rangeHasLeapYear } from '../lib/calendar.js'
import { fmt, numericFormatOf } from '../lib/format.js'
import { blockMinus, blockMinusBI } from '../lib/modeFormat.js'
import { sharedFitScale } from '../lib/statFit.js'
import { UPDATE_CHECK_LABEL } from '../lib/updateCheck.js'
import type { UpdateCheckState } from '../lib/updateCheck.js'
import { SectionLabel } from './primitives.jsx'
import { PillTray } from './PillTray.jsx'
import { PillGroup } from './PillGroup.jsx'
import { UpdateDot } from './UpdateDot.jsx'
import DefaultsCard from './DefaultsCard.jsx'
import PresetManager from './PresetManager.jsx'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import { useBackButton } from './useBackButton.js'
import {
  MODAL_CARD_CLASS,
  MODAL_CARD_SHADOW,
  MODAL_SCRIM_CLASS,
  trapModalTab,
  useModalEscape,
} from './modalContract.js'
import {
  WRITTEN_FORMATS,
  NUMERIC_FORMATS,
  INPUT_STYLES,
  DOT_ORIENTATIONS,
  DARK_THEMES,
  LIGHT_THEMES,
  CHANCE_OPTIONS,
  LEAP_CHANCE_OPTIONS,
} from './settingsOptions.js'
import {
  RESET_BTN_CLASS,
  FOOTER_RESET_BTN_CLASS,
  NOT_OFFERED_BTN_CLASS,
  FOOTER_META_ROW_CLASS,
  FOOTER_DEFAULTS_ROW_CLASS,
  NUM_INPUT_CLASS,
} from './controlClasses.js'
import { DEPLOY_TS } from '../deployStamp.js'
import { APP_VERSION } from '../appVersion.js'
import { CHANGELOG } from '../changelog.js'
import { useSettings, SETTINGS_DEFAULTS } from '../store/settings.js'
import type { SettingsValues } from '../store/settings.js'
import { useModePrefs } from '../store/modePrefs.js'
import { useUserDefaults, effectivePrefDefaults, normalizeAoxN } from '../store/userDefaults.js'
import type { PrefDefaults } from '../store/userDefaults.js'
import { usePresets } from '../store/presets.js'
import { selectAmnesic } from '../store/amnesic.js'
import { setPresetAmnesic } from '../store/presetControl.js'
import type { YearRangeMirrors } from './useYearRangeMirrors.js'

// ============================================================
// SettingsPanel — the ⚙ popover card and its five modals.
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
//     layout effect and the footer fit's below both deliberately have NO dependency array, because
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
// WHAT STAYS IN App AND ARRIVES AS PROPS: the panel's open state and every write to it, the
// click-outside / Escape / drag-dismiss listeners (two of the click-outside's three refs live in
// the BAR), the gear-dot retire effect, the four at-defaults booleans the GEAR renders while the
// panel is closed, resetSettings/fullReset (which reach App's whole world), and the Year Range text
// mirrors (whose lifetime must outlive this component's — see useYearRangeMirrors).
//
// WHAT IT READS STRAIGHT FROM THE STORES: the fifteen settings values and their setters, and the
// saved-defaults snapshot. Individually selected, never as one object selector, so the panel
// re-renders only for the value that changed.
// ============================================================

export type SettingsPanelProps = {
  /** App's popover ref. App creates it because TWO document-level listeners it owns read it: the
   *  click-outside handler (including its blur-before-close) and the drag-dismiss listener. */
  cardRef: RefObject<HTMLDivElement | null>
  /** Live state diverges from the effective defaults, in EITHER store. Computed in App because the
   *  GEAR renders it while the panel is closed; passing it is what stops the gear's violet bar and
   *  the two footer dims from drifting apart. */
  settingsModified: boolean
  /** The whole app is at launch state. Thirteen terms, six of which App owns and five of which are
   *  reported UP from the mode screens — the panel gets the answer, never the inputs. */
  isFullyReset: boolean
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
  /** The Year Range boxes' text mirrors — App state, because a half-typed year survives a close. */
  yearRange: YearRangeMirrors
  minYearRef: RefObject<HTMLInputElement | null>
  maxYearRef: RefObject<HTMLInputElement | null>
  /** The update-check state machine's label-state and its trigger. THE LABEL IS THE STATE. */
  updateCheck: UpdateCheckState
  onCheckUpdates: () => void
  /** The Changelog link's dot. App owns the flag because it is set by the build-change detection
   *  AND the newest-entry comparison together (src/changelog, CHANGELOG_SEEN_KEY); the panel is its
   *  only reader and its only retirer. */
  changelogDot: boolean
  onRetireChangelogDot: () => void
}

export function SettingsPanel({
  cardRef,
  settingsModified,
  isFullyReset,
  onResetSettings,
  onFullReset,
  mode,
  activeTheme,
  defPrefs,
  yearRange,
  minYearRef,
  maxYearRef,
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
  const useJulian = useSettings((s) => s.useJulian)
  const setUseJulian = useSettings((s) => s.setUseJulian)
  const saveStats = useSettings((s) => s.saveStats)
  const setSaveStats = useSettings((s) => s.setSaveStats)
  const dateFormat = useSettings((s) => s.dateFormat)
  const setDateFormat = useSettings((s) => s.setDateFormat)
  const randomFormat = useSettings((s) => s.randomFormat)
  const setRandomFormat = useSettings((s) => s.setRandomFormat)
  const inputStyle = useSettings((s) => s.inputStyle)
  const setInputStyle = useSettings((s) => s.setInputStyle)
  const dotOrientation = useSettings((s) => s.dotOrientation)
  const setDotOrientation = useSettings((s) => s.setDotOrientation)
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
  // COUNT"; amnesic answers "does it LAST". They are ORTHOGONAL, not exclusive — in an amnesic
  // preset you may still want Save Stats off for throwaway questions so even the session's count
  // does not move. A three-way picker (Saved / Amnesic / Off) was proposed and the owner correctly
  // killed it: it would have made two independent facts look like one choice among three.
  //
  // ⚠ NOT A ⚙ SETTING, despite living in the ⚙ panel. The value belongs to the PRESET (store/presets'
  // `Preset.amnesic`), so it is read from the registry and written through store/presetControl —
  // which pairs the write with the storage work it implies. The reasons are argued in full at the
  // top of store/amnesic; the one that matters here is that a settings value can be overwritten
  // wholesale by Reset Settings, with no rehydration and no screen remount, and this flag decides
  // WHICH STORAGE AREA the stats are read from. Two consequences to know when reading the panel:
  // it is not in the Save Defaults snapshot, and it never lights the gear's "modified" bar — a
  // preset's amnesia is not one of the values "reset to my defaults" is talking about.
  const activePresetId = usePresets((s) => s.activeId)
  const amnesic = usePresets(selectAmnesic)
  // The active preset's NAME, for the Presets section's one line of prose at the head of the panel.
  // A selector rather than `activePreset()` from store/presetControl: this has to RE-RENDER when the
  // name changes (the manage modal below can rename it while the panel is open), and a plain
  // getState() read would not. The `?? ''` covers the one frame a caller could read between an
  // applyRegistry and its own next line — store/presets' normalizeRegistry guarantees activeId names
  // a listed preset on every load, so it is a type obligation rather than a state the app reaches.
  const activePresetName = usePresets((s) => s.presets.find((p) => p.id === s.activeId)?.name ?? '')
  // ⚠ NO CONFIRMATION DIALOG, deliberately, and the owner cut one that had been drafted ("I say
  // neither, just leave it for htp"). A dialog would exist to stop somebody forgetting the state
  // they were in — and people build a whole preset around being amnesic or not, so that is not the
  // problem they have. The How-to-Play section carries the explanation instead.
  // The teardown, the zero start and the discard all belong to setPresetAmnesic; this is a tap.
  const toggleAmnesic = () => setPresetAmnesic(activePresetId, !amnesic)
  // The saved-defaults snapshot. A store value, so it is read here directly — but the EFFECTIVE
  // defaults derived from it (defPrefs) arrive as a prop, because their memo identity is load
  // bearing up in App.
  const savedDefaults = useUserDefaults((s) => s.saved)
  const saveUserDefaults = useUserDefaults((s) => s.saveDefaults)
  const clearUserDefaults = useUserDefaults((s) => s.clearDefaults)

  // Full Reset state: armed=true means the user tapped once and the next tap fires.
  // Auto-disarms after a short timer, when the panel closes (which now UNMOUNTS this component, so
  // the state and its timer go with it — see the unmount cleanup below), or when the user taps any
  // other interactive control. Implemented as a per-tap state machine rather than a dialog so the
  // destructive nature is communicated by the in-place label and color change without a modal
  // interruption.
  const [fullResetArmed, setFullResetArmed] = useState(false)
  const fullResetBtnRef = useRef<HTMLButtonElement | null>(null)
  const fullResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Save Defaults (Q7) confirmation popup state. pendSettings snapshots the full 15-value panel at
  // OPEN (the popup doesn't edit panel values); pendPrefs seeds the four editable mode-screen rows
  // from the live modePrefs store at open, and pendSeed keeps that seed for the shared card's
  // dirty-row comparison (Q5 round-6). Edits touch ONLY this pending snapshot — Cancel/scrim/Back
  // discard it; Save commits it (aoxN normalized). Closing the panel discards it by unmounting.
  const [saveDefaultsOpen, setSaveDefaultsOpen] = useState(false)
  const saveDefaultsCardRef = useRef<HTMLDivElement | null>(null) // the dialog card — focused on open (the modal a11y contract below)
  // A ref, and it is safe to re-create it per panel open: it is written by openSaveDefaults and
  // read only at commit, and the popup cannot outlive the panel that opened it.
  const pendSettingsRef = useRef<SettingsValues | null>(null)
  const [pendPrefs, setPendPrefs] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  const [pendSeed, setPendSeed] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  // Defaults manager (Q12 → editable, Q5 round-6) popup state — the footer link's window onto the
  // saved (or, with nothing saved, factory) defaults, on the SAME shared card as the Save popup.
  // managePrefs is its pending snapshot, seeded from the EFFECTIVE defaults (defPrefs) at open; the
  // seed itself needs no copy — defPrefs cannot change while the modal is up (this modal owns the
  // only editor). Cancel/scrim/Back discard edits.
  const [manageDefaultsOpen, setManageDefaultsOpen] = useState(false)
  const manageDefaultsCardRef = useRef<HTMLDivElement | null>(null) // its dialog card — same focus-on-open contract
  const [managePrefs, setManagePrefs] = useState<PrefDefaults>(() => effectivePrefDefaults(null))
  // Clear-saved-defaults confirm popup (Q5 round-6): the footer's Clear link asks before it forgets
  // the snapshot — a small modal in the established recipe (Cancel + a red-tier Clear), full
  // scrim/focus/Escape/Back parity with the other settings modals.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const clearConfirmCardRef = useRef<HTMLDivElement | null>(null) // its dialog card — same focus-on-open contract
  // Changelog popup (Q6) — the plain-words what-changed list (src/changelog), opened from the
  // footer's Changelog link. Its two dot flags live up in App with the build-stamp detection that
  // lights them; this popup only READS the link's and asks App to retire it.
  const [changelogOpen, setChangelogOpen] = useState(false)
  const changelogCardRef = useRef<HTMLDivElement | null>(null) // its dialog card — same focus-on-open contract
  // The preset manager (sub-group 4C) — the FIFTH user of the modal contract, opened from the
  // Presets section at the head of the panel. Its state is one boolean here and everything else is
  // components/PresetManager's: the card holds its own pending rename and its own delete
  // confirmation, because both die with the modal and neither is anything the panel can answer.
  // ⚠ IT CARRIES NO PENDING SNAPSHOT, unlike the two DefaultsCard modals, and that is the design
  // rather than an omission: every act inside it — create, rename, reorder, delete — is committed
  // to the registry the moment it happens, so there is nothing for Cancel to discard and the card's
  // one dismiss control is a plain Close. Deleting is the only irreversible one, and it is the one
  // with a confirmation.
  const [presetsOpen, setPresetsOpen] = useState(false)

  // Scroll-state tracking for the two inner scroll regions this component owns — the popover's
  // scroll wrapper and the changelog popup's list — both on the shared useScrollEdgeState
  // (components/scrollRegion; the Q5 round-7 extraction of what were per-region copies of one
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
  // ★ AND IT IS DECLARED BEFORE THE FOOTER FIT BELOW, deliberately: the first painted frame's
  // fade/shadow answer is measured against the pre-fit footer height and corrected asynchronously.
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
  // Footer-button caption auto-fit (Round-2) — the StatPanel value-fit pattern applied to the
  // Save Defaults / Reset Settings / Full Reset trio: on a narrow phone the three flex-1 buttons
  // can get too tight for their captions, so ONE shared font-size (never per-button — unequal
  // caption sizes across a matched row read as a glitch) shrinks all three together. Naturals come
  // from hidden STATIC twins of the widest caption set ("Save Defaults" / "Reset Settings" /
  // "Full Reset"), never the live captions — the Full Reset → "Confirm?" swap would otherwise
  // shrink the measurement and jiggle the whole row's size while arming. The math is lib/statFit's
  // sharedFitScale (min ratio, capped at 1) off the trio's resting text-xs — the popover's control
  // tier (Round-3 font normalization), so the fit CEILINGS there and shrinks below 12px only when a
  // narrow screen forces it; an 11px floor keeps the captions legible over cosmetic fit, and
  // overflow-hidden on the buttons (below) contains the extreme remainder. In jsdom every width is
  // 0 → scale 1 → no-op (the statFit convention).
  const footerFitRef = useRef<HTMLDivElement | null>(null)
  const fitFooterBtns = () => {
    const row = footerFitRef.current
    if (!row) return
    const labels = Array.from(row.querySelectorAll<HTMLElement>('[data-fitlabel]'))
    const twins = Array.from(row.querySelectorAll<HTMLElement>('[data-fittwin]'))
    if (labels.length === 0 || twins.length === 0) return
    const naturals = twins.map((t) => t.scrollWidth)
    // ⚠ These two stay integer-valued measures on purpose — round 10's sub-pixel sweep (--bar-h,
    // GuidePage's panel heights) deliberately skipped them. scrollWidth is the only platform read
    // of a clamped span's NATURAL width; a rect would report the clamped width, a different number
    // rather than a sharper one. clientWidth EXCLUDES border and scrollbar where rect.width
    // includes both, so swapping it would change which box is being fitted — a semantic change,
    // not a precision one. Both feed a font-size ratio, where a rounded pixel is imperceptible
    // anyway.
    const avails = labels.map((l) => {
      const btn = l.parentElement
      if (!btn) return 0
      const cs = getComputedStyle(btn)
      return (
        btn.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      )
    })
    const scale = sharedFitScale(naturals, avails)
    // Base font off a STATIC twin, never a live caption: the captions carry the inline fontSize the
    // PREVIOUS pass set, so reading them would compound the shrink on every re-run of the dep-less
    // effect (12·s, 12·s², … → pinned at the floor). Same feedback loop StatPanel guards against by
    // resetting before measuring (StatPanel.tsx fitAll); here the twin — same text classes, never
    // inline-sized — is the clean base.
    const base = parseFloat(getComputedStyle(twins[0]).fontSize) || 0
    const px = scale < 1 && base > 0 ? Math.max(11, base * scale) + 'px' : ''
    // Apply the fitted size to the BUTTON, not the caption span: the caption inherits it, so the
    // button's line-box strut shrinks WITH the text and the label stays vertically centered.
    // (Sizing the inline span alone left it baseline-aligned inside the button's un-shrunk
    // resting-size strut — measured ~0.6px low on-device, the owner's 2026-07-13 catch.)
    labels.forEach((l) => {
      const b = l.parentElement
      if (b) b.style.fontSize = px
    })
  }
  // Dep-less like StatPanel's: cheap (3 spans), and this component only exists while the panel is
  // open, so there is no closed state to bail out of. It re-reads on EVERY render pass on purpose —
  // do not give it a dependency array and do not memoise this component out of a pass.
  useLayoutEffect(() => {
    fitFooterBtns()
  })
  // A web-font swap changes the natural widths, so document.fonts.ready refits too. Deps are []
  // rather than the old [settingsOpen]: mount IS the open now.
  useEffect(() => {
    const row = footerFitRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitFooterBtns())
    ro.observe(row)
    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready)
      document.fonts.ready.then(() => {
        if (!cancelled) fitFooterBtns()
      })
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [])

  // Escape and Android Back — the two dismiss paths — are registered together below, beside the
  // useBackButton calls, on the shared modal contract (components/modalContract). They used to be
  // four hand-written capture-phase effects in a row right here; the argument for the capture phase,
  // for stopPropagation, and for the text-entry guard now lives once, in that file.
  //
  // The popup's modal a11y contract, part 1 of 2 (part 2 = the Tab trap on the scrim, below): on
  // open, move focus INTO the dialog — the card is tabIndex={-1} with role="dialog" +
  // aria-modal="true", so screen readers announce a modal and keyboard context starts inside it.
  // Without this, focus stays on the Save Defaults button UNDER the scrim, and keyboard/AT input
  // keeps operating the live settings panel while commitSaveDefaults would still save the snapshot
  // captured at open — a silent divergence between what's on screen and what Save persists.
  useEffect(() => {
    if (saveDefaultsOpen) saveDefaultsCardRef.current?.focus()
  }, [saveDefaultsOpen])
  useEffect(() => {
    if (manageDefaultsOpen) manageDefaultsCardRef.current?.focus()
  }, [manageDefaultsOpen]) // same contract for the defaults manager (Q12/Q5)
  useEffect(() => {
    if (clearConfirmOpen) clearConfirmCardRef.current?.focus()
  }, [clearConfirmOpen]) // and the Clear confirm (Q5)
  useEffect(() => {
    if (changelogOpen) changelogCardRef.current?.focus()
  }, [changelogOpen]) // and the Changelog popup (Q6)
  // ⚠ THE PRESET MANAGER IS THE ONE MODAL WITH NO focus-on-open EFFECT HERE, AND IT IS NOT SKIPPING
  // THE TERM — it OWNS it. That card has two views (the list, and the delete confirmation), each
  // rendering its own dialog element, so "focus the card when it opens" is really "focus the card
  // whenever the card is replaced", and the second half is a fact only the card knows. Splitting it
  // — the open here, the swap there — would leave a term with two owners and one of them blind to
  // the case that matters. So components/PresetManager holds its own ref and focuses itself, which
  // is also why it takes no cardRef prop where the other four do.

  // Save Defaults (Q7): open the confirmation popup, seeding the pending snapshot from the LIVE
  // stores (panel captured whole; the four mode-screen prefs become editable rows). The seed is
  // kept alongside the pending copy for the shared card's dirty-row highlight.
  const openSaveDefaults = () => {
    // The same short-circuit the other two footer buttons carry — all three are equally inert while
    // dimmed. Without it, a keyboard user could open this popup with nothing to save. It can sit
    // INSIDE this function because the function IS the press and nothing else calls it; that is
    // exactly what is not true of App's resetSettings, whose guard had to go on the button.
    if (!settingsModified) return
    const s = useSettings.getState()
    pendSettingsRef.current = Object.fromEntries(
      Object.keys(SETTINGS_DEFAULTS).map((k) => [k, s[k as keyof SettingsValues]]),
    ) as SettingsValues
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
  // The defaults manager (Q5 round-6): seed the pending copy from the EFFECTIVE defaults — the
  // saved snapshot when one exists, the factory values otherwise (aoxN normalized so the readout
  // starts on its committed form). defPrefs itself doubles as the seed prop.
  const openManageDefaults = () => {
    setManagePrefs({ ...defPrefs, aoxN: normalizeAoxN(defPrefs.aoxN) })
    setManageDefaultsOpen(true)
  }
  const closeManageDefaults = useCallback(() => setManageDefaultsOpen(false), [])
  const closeClearConfirm = useCallback(() => setClearConfirmOpen(false), [])
  const closeChangelog = useCallback(() => setChangelogOpen(false), [])
  const closePresets = useCallback(() => setPresetsOpen(false), [])
  // Opening the changelog retires the link's dot — the breadcrumb's last stop. First tap only in
  // effect: once the flag is cleared the guard never re-fires (nothing re-marks it until the next
  // build change). The flag itself is App's, so the retire is a callback up.
  const openChangelog = () => {
    setChangelogOpen(true)
    if (changelogDot) onRetireChangelogDot()
  }
  // Save commits the EDITED pending snapshot (never the live stores — they stay untouched); from
  // here on Reset Settings / Full Reset / the gear indicator mean THESE values by "default".
  const commitSaveDefaults = () => {
    if (pendSettingsRef.current)
      saveUserDefaults({
        settings: pendSettingsRef.current,
        prefs: { ...pendPrefs, aoxN: normalizeAoxN(pendPrefs.aoxN) },
      })
    setSaveDefaultsOpen(false)
  }
  // The manager's Save (Q5 round-6) writes ONLY the four shown values into the snapshot: the 15
  // ⚙-panel values pass through AS-SAVED, byte-identical (never re-captured from the live store —
  // the owner's rule: this popup edits exactly what it shows). With nothing saved yet it CREATES
  // the snapshot — the factory ⚙ values plus these edits, the natural flow from the factory view
  // (the footer's Clear link appears with it).
  const commitManageDefaults = () => {
    saveUserDefaults({
      settings: savedDefaults ? savedDefaults.settings : SETTINGS_DEFAULTS,
      prefs: { ...managePrefs, aoxN: normalizeAoxN(managePrefs.aoxN) },
    })
    setManageDefaultsOpen(false)
  }
  // The Clear confirm's destructive half (Q5 round-6): forget the snapshot — live settings stay
  // untouched, factory semantics take over everywhere (the effective* helpers).
  const confirmClearDefaults = () => {
    clearUserDefaults()
    setClearConfirmOpen(false)
  }
  // Two-tap-to-confirm wrapper around App's fullReset. Tap 1 arms (label flips to "Confirm?",
  // button gets a ring). Tap 2 within the arm window fires the reset and disarms. Auto-disarm via
  // timer (3s), the any-other-press listener below, and — since the panel became a component that
  // unmounts on close — simply by this state ceasing to exist when the panel closes.
  const armFullReset = () => {
    // ⚠ THIS SHORT-CIRCUIT IS NOW THE ONLY THING MAKING THE DIMMED BUTTON INERT — for a mouse tap,
    // a keyboard press and an assistive-technology activation alike. It was written in round 14 as
    // defense in depth behind a pointer-events-none className, and B7 (round 15) removed that
    // className: a pointer-events:none element is never hit-tested, so the not-allowed cursor could
    // not paint through it (controlClasses' NOT_OFFERED_BTN_CLASS tells the other half of the
    // story). Nothing replaced it as a tap blocker, deliberately — the announcement (aria-disabled)
    // and the drawing (the dim + cursor) are what the user is TOLD, and this line is what is TRUE.
    // Do not delete it as redundant; there is no longer anything for it to be redundant with.
    if (isFullyReset) return
    if (fullResetArmed) {
      if (fullResetTimerRef.current) {
        clearTimeout(fullResetTimerRef.current)
        fullResetTimerRef.current = null
      }
      setFullResetArmed(false)
      onFullReset()
      return
    }
    setFullResetArmed(true)
    if (fullResetTimerRef.current) clearTimeout(fullResetTimerRef.current)
    fullResetTimerRef.current = setTimeout(() => {
      setFullResetArmed(false)
      fullResetTimerRef.current = null
    }, 3000)
  }
  const disarmFullReset = () => {
    if (fullResetTimerRef.current) {
      clearTimeout(fullResetTimerRef.current)
      fullResetTimerRef.current = null
    }
    setFullResetArmed(false)
  }
  // Site-wide disarm listener (capture phase) — disarms when the user mousedowns/touches any
  // element outside the Full Reset button itself. Capture phase fires before the target's own
  // onClick, so the user's intent (e.g., toggling Random Format, switching modes, tapping a date
  // answer) still proceeds normally; we just consume the pending arm. Scope is the entire document
  // (not just the panel) so taps anywhere outside the button reliably disarm. Both ends of
  // fullResetBtnRef — the binding in the footer and this reader — live in this file, and must.
  useEffect(() => {
    if (!fullResetArmed) return
    const h = (e: MouseEvent | TouchEvent) => {
      if (fullResetBtnRef.current && fullResetBtnRef.current.contains(e.target as Node | null))
        return
      disarmFullReset()
    }
    document.addEventListener('mousedown', h, true)
    document.addEventListener('touchstart', h, true)
    return () => {
      document.removeEventListener('mousedown', h, true)
      document.removeEventListener('touchstart', h, true)
    }
  }, [fullResetArmed])
  // Cleanup the Full Reset arm timer on unmount — which is now also every panel close, so this is
  // what replaces the old "disarm when settings closes" effect: the armed flag cannot survive a
  // close because it ceases to exist, and this stops its timer from outliving it.
  useEffect(
    () => () => {
      if (fullResetTimerRef.current) clearTimeout(fullResetTimerRef.current)
    },
    [],
  )
  // Safety net: if the app flips to fully-reset while the Full Reset button is ARMED, drop the arm.
  // It is reachable, despite the note this inherited calling it defensive: arm the button by tap,
  // then reach Reset Settings by KEYBOARD and press Enter. The site-wide disarm listener above only
  // watches mousedown/touchstart, so no press ever cancels the arm, and if the rest of the app was
  // already fresh then settings returning to default is the thirteenth term falling into place.
  // What it prevents is cosmetic but real: the button would sit at "Confirm?" on a control that is
  // simultaneously dimmed, announced unavailable and refused by armFullReset's own first line (B7
  // took its pointer-events-none away in round 15, so that guard is now the whole of its inertness)
  // — a promise the UI is in no position to keep.
  //
  // ★ WHY IT ADJUSTS STATE DURING RENDER RATHER THAN IN AN EFFECT. The moved-in version was a
  // useEffect calling disarmFullReset(). That is a setState synchronously inside an effect body —
  // react-hooks/set-state-in-effect, a real error, and it was invisible for as long as this file
  // pulled its hooks off a `React` namespace binding (that form defeats the rule's detection; see
  // the import at the top of this file). Named imports made the file analyzable and the error
  // surfaced on code that had merely MOVED, which is the extraction doing its job. The fix is
  // React's documented replacement for "adjust some state when a prop changes": compare against the
  // previous prop during render and update immediately. React discards the in-progress render
  // instead of committing it, so the committed DOM is the same minus one wasted frame.
  //
  // The 3s arm timer is deliberately NOT cleared here (clearTimeout during render would be an
  // impure side effect, and the compiler is right to reject that shape). It is inert: its callback
  // sets armed false, which it already is, and pressFullReset clears any pending timer before
  // arming again — so it can neither disarm a later arm nor null out a later timer's handle.
  const [seenFullyReset, setSeenFullyReset] = useState(isFullyReset)
  if (seenFullyReset !== isFullyReset) {
    setSeenFullyReset(isFullyReset)
    if (isFullyReset && fullResetArmed) setFullResetArmed(false)
  }
  // Android hardware Back closes these overlays instead of quitting the app (Q1). App registers
  // 'settings' itself, BEFORE this component exists; the stack is chronological, and a modal cannot
  // open before the panel that hosts its link, so Back still closes the modal first (LIFO).
  useBackButton(saveDefaultsOpen, closeSaveDefaults, 'save-defaults')
  useBackButton(manageDefaultsOpen, closeManageDefaults, 'manage-defaults') // the defaults manager (Q12/Q5)
  useBackButton(clearConfirmOpen, closeClearConfirm, 'clear-defaults') // and the Clear confirm (Q5)
  useBackButton(changelogOpen, closeChangelog, 'changelog') // and the Changelog popup (Q6)
  // …and the preset manager (4C). ⚠ ONE Back ENTRY FOR BOTH OF ITS VIEWS, deliberately: Back
  // dismisses the whole card, delete confirmation and all. The alternative — a second entry for the
  // confirmation, so Back stepped back to the list — is the nested-modal machinery
  // components/PresetManager exists to avoid, and it would buy a step backwards out of a question
  // whose Cancel button is already on screen.
  useBackButton(presetsOpen, closePresets, 'presets')
  // …and Escape, the contract's other dismiss. The two popups that CONTAIN a text box guard against
  // it (the N field and the tap-to-type readouts own their own Escape — it discards the edit, and a
  // second press, with nothing focused, reaches the modal); the two that are buttons-only do not.
  useModalEscape(saveDefaultsOpen, closeSaveDefaults, true)
  useModalEscape(manageDefaultsOpen, closeManageDefaults, true)
  useModalEscape(clearConfirmOpen, closeClearConfirm, false)
  useModalEscape(changelogOpen, closeChangelog, false)
  // The preset manager CONTAINS text boxes (one per row, each the rename field), so it takes the
  // guard: the first Escape belongs to the field that has the keyboard — it discards that rename —
  // and a second, with nothing focused, reaches here and dismisses the card. Exactly the ladder the
  // two DefaultsCard modals above already use.
  useModalEscape(presetsOpen, closePresets, true)

  // Modal a11y contract, part 2 of 2 (part 1 = the focus-on-open effects above) is trapModalTab,
  // imported from the shared contract and put on each scrim's onKeyDown below. It is shared by all
  // FIVE modals in the app now — these four and the run breakdown — which is why it no longer lives
  // in this component; see components/modalContract for what it does and why.

  // Save Defaults confirmation popup (Q7). PORTALED to #root — deliberately OUTSIDE the popover
  // card (the ⚙ trigger's aria-controls menu), so its DOM is invisible to the press-drag controller
  // (a drag-release on popup content can never drag-dismiss the panel) and it escapes the card's
  // overflow/max-height context (a true centered modal — scrim + the popover's own card/shadow
  // language). data-settings-modal marks the whole tree (scrim included) "inside" for App's
  // settings click-outside handler (the same marker as the manager, Clear confirm, and Changelog
  // popups below — one guard covers all five modals); the scrim itself cancels the POPUP only
  // (target===currentTarget, so card clicks never do), and Escape + Android Back + any settings
  // close also cancel (the effects above, plus this whole component unmounting). The card itself is
  // the shared DefaultsCard (Q5 round-6 — the one place the four rows, their recipes, and the
  // dirty-row accent live; see its header comment): row labels are Title Case (the ⚙ panel's label
  // tier, Q6) with every paired aria-label mirroring its visible text exactly — no case drift to
  // maintain, WCAG label-in-name safe. Edits touch ONLY the pending snapshot: the three sliders
  // mirror the mode screens' (same ranges/steps/--rng-fill, and the same tap-to-type
  // SliderValueEditor readouts — the popup seeds from the LIVE prefs, so its ranges must stay a
  // superset of every committable value) and the N field shares the AoX input's validation trio
  // (Q18 — one idiom, one clamp): digits only while typing (the pending snapshot never holds junk),
  // and blur and Enter normalize-commit with the shared normalizeAoxN clamp (2–1000, fallback 10).
  // ESCAPE DISCARDS THE FIELD'S EDIT (round 15, B6 — both this field and the AoX screen's own moved
  // off normalize-commit together, so Escape means one thing app-wide). Cancel is still the discard
  // for the WHOLE popup; Escape on the field is the smaller undo, and a second Escape — with the
  // field no longer focused — reaches the popup's capture-phase handler and cancels it.
  const saveDefaultsJsx =
    saveDefaultsOpen &&
    createPortal(
      <div
        data-settings-modal
        role="presentation"
        className={MODAL_SCRIM_CLASS}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSaveDefaultsOpen(false)
        }}
        onKeyDown={trapModalTab}
      >
        <DefaultsCard
          cardRef={saveDefaultsCardRef}
          titleId="save-defaults-title"
          title="Save current settings as your defaults?"
          subline="Also saved from the mode screens:"
          prefs={pendPrefs}
          seed={pendSeed}
          setPrefs={setPendPrefs}
          onClose={closeSaveDefaults}
          onSave={commitSaveDefaults}
        />
      </div>,
      document.getElementById('root')!,
    )
  // The defaults manager popup (Q12, made editable in Q5 round-6): the footer link's window onto
  // the defaults — the same portal / scrim recipes and the same modal contract as the Save popup
  // (focus-on-open, capture Escape with the text-entry guard, close with settings, Android Back,
  // the shared trapModalTab + data-settings-modal marker), rendering the SAME shared DefaultsCard
  // in manage mode. It seeds from the EFFECTIVE defaults (defPrefs — forward-merged, so a legacy
  // snapshot missing a field shows factory, never undefined) and rests read-only (one full-width
  // Close); edit any row and it goes dirty — Cancel + Save, the restricted-write note, the
  // accent-tier value highlights (see DefaultsCard). Title, subline, and footnote adapt to whether
  // a snapshot exists: with none saved the card is the clearly-labelled FACTORY view, and Save from
  // there CREATES the snapshot.
  const manageDefaultsJsx =
    manageDefaultsOpen &&
    createPortal(
      <div
        data-settings-modal
        role="presentation"
        className={MODAL_SCRIM_CLASS}
        onClick={(e) => {
          if (e.target === e.currentTarget) setManageDefaultsOpen(false)
        }}
        onKeyDown={trapModalTab}
      >
        <DefaultsCard
          cardRef={manageDefaultsCardRef}
          titleId="manage-defaults-title"
          manage
          title={savedDefaults ? 'Your saved defaults' : 'Default settings'}
          subline={
            savedDefaults
              ? undefined
              : "These are the factory defaults — you haven't saved your own."
          }
          note={
            savedDefaults
              ? 'Every ⚙ menu setting is also part of the snapshot, captured as it was when you saved.'
              : undefined
          }
          prefs={managePrefs}
          seed={defPrefs}
          setPrefs={setManagePrefs}
          onClose={closeManageDefaults}
          onSave={commitManageDefaults}
        />
      </div>,
      document.getElementById('root')!,
    )
  // Clear-saved-defaults confirm popup (Q5 round-6): the same portal / scrim / card recipes and the
  // same modal contract (focus-on-open, capture Escape, close with settings, Android Back, the
  // shared trapModalTab + data-settings-modal marker). Two buttons — Cancel in the shared dismiss
  // recipe, Clear in the danger tier (RESET_BTN_CLASS, the rose fill every destructive control
  // wears) — a real confirm modal because a link that flips its own text to confirm reads strangely
  // (the owner's call over a two-tap arm).
  const clearConfirmJsx =
    clearConfirmOpen &&
    createPortal(
      <div
        data-settings-modal
        role="presentation"
        className={MODAL_SCRIM_CLASS}
        onClick={(e) => {
          if (e.target === e.currentTarget) setClearConfirmOpen(false)
        }}
        onKeyDown={trapModalTab}
      >
        <div
          ref={clearConfirmCardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-defaults-title"
          style={MODAL_CARD_SHADOW}
          className="card rounded-2xl p-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden"
        >
          <div id="clear-defaults-title" className="text-sm font-semibold text-(--tx-50)">
            Clear your saved defaults?
          </div>
          <div className="text-xs text-(--tx-200-80)">
            This only forgets the snapshot — your current settings stay as they are, and the launch
            defaults take over.
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={closeClearConfirm}
              className="flex-1 px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmClearDefaults}
              className={`flex-1 ${RESET_BTN_CLASS}`}
            >
              Clear
            </button>
          </div>
        </div>
      </div>,
      document.getElementById('root')!,
    )
  // Changelog popup (Q6): the plain-words what-changed list (src/changelog, newest day first),
  // opened from the footer's Changelog link — the same portal / scrim / card recipes and the same
  // modal contract as the popups above (focus-on-open, capture Escape, close with settings, Android
  // Back, the shared trapModalTab + data-settings-modal marker; the one control is a full-width
  // Close, input-free like the Clear confirm). CHANGELOG renders AS-IS: round-8 Q8 dropped the
  // render-time slice and moved the ten-day cap to the data itself (see the charter in
  // src/changelog), so what the module holds is exactly what a visitor downloads and exactly what
  // draws here — no entry ships only to be refused. The list sits inside its own scroll region on
  // the shared settings recipe (Q5 round-7, components/scrollRegion): the card owns py-4 only while
  // the title, scroll region, and Close row each carry px-4, so the scroller's 1rem right padding
  // is the text-free lane the iOS scrollbar paints in; SCROLL_REGION_CLASS + scrollFadeClass (fed
  // by the changelogScrollRef edge listener up with the popover's) add the edge fades, and max-h
  // keeps a long history scrolling within the card without growing it off-screen. Entry dates
  // render through the footer's Last-Updated recipe (fmt + numericFormatOf) so they follow the
  // user's Date Format setting; the bullet list is the guide's UL idiom (list-disc + the
  // --mut-color marker). The card is heading row → list → Close and NOTHING else — the heading row
  // gained the app's version on its right on 2026-08-10 (the note at the row explains the markup and
  // why the id moved onto a span), and it is still one row: round-8 Q8 added a
  // one-line "Shows the last ten days with updates." notice between the scroller and Close, and the
  // owner removed it (round-9) on the rule that this popup answers WHAT CHANGED, while how the app
  // keeps its history is documentation — so the ten-day cap is explained in How to Play (the
  // Updates section) and nowhere else. Don't re-add it here. The one-control card is also what
  // keeps the single-button Tab trap above valid, with Close as first===last.
  const changelogJsx =
    changelogOpen &&
    createPortal(
      <div
        data-settings-modal
        role="presentation"
        className={MODAL_SCRIM_CLASS}
        onClick={(e) => {
          if (e.target === e.currentTarget) setChangelogOpen(false)
        }}
        onKeyDown={trapModalTab}
      >
        <div
          ref={changelogCardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="changelog-title"
          style={MODAL_CARD_SHADOW}
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
          <div className="px-4 pt-1">
            <button
              type="button"
              onClick={closeChangelog}
              className="w-full px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.getElementById('root')!,
    )

  // The preset manager (4C): the same portal / scrim recipes and the same modal contract as the
  // four above (focus-on-open — owned by the card itself, see the note beside the other four —
  // capture Escape with the text-entry guard, close with settings, Android Back, the shared
  // trapModalTab + data-settings-modal marker). The card is components/PresetManager, which holds
  // the whole surface: the list, the rename fields, the reorder pair, and the delete confirmation
  // it swaps itself into rather than stacking a second dialog on top of.
  const presetsJsx =
    presetsOpen &&
    createPortal(
      <div
        data-settings-modal
        role="presentation"
        className={MODAL_SCRIM_CLASS}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPresetsOpen(false)
        }}
        onKeyDown={trapModalTab}
      >
        <PresetManager onClose={closePresets} />
      </div>,
      document.getElementById('root')!,
    )

  return (
    <>
      {/* ★ THE CARD IS THE FIRST CHILD OF THIS FRAGMENT AND HAS NO WRAPPER. It renders at the bar's
          slot, and it is `absolute left-4 right-4 top-full` against the bar's `relative` inner
          wrapper — an extra div here would become the containing block and detach the panel.
          Elevation + bottom cushion (Calendar Game, refined 2026-06-09): this popover is a FLOATING
          OVERLAY (it pops over the dimmed page), so it uses the app's even, all-around overlay
          shadow — the SAME visual language as the dropdown menus (CustomSelect) — NOT the
          directional `elev-shadow-down` (that one is the scroll-BOUNDARY cue for fixed
          bars/headers/footers, the wrong language for a free-floating panel). It's OFFSET-FREE
          (`0 0 8px`, vs the dropdowns' downward-offset shadow) so the shadow extends EQUALLY on all
          four sides — the panel is inset against the screen edge on every side and must read as
          symmetric. It's SUBTLE (12% black, the app's overlay-shadow color) because the opaque fill
          + 1px card border + dimmed backdrop already separate it (the shadow only adds a gentle
          lift); and SMALL (8px blur) so it stays clearly contained inside the 1rem gap (vs the
          dropdowns' 28px blur, which would overflow the cushion and clip at the screen edge).
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
          Press-drag contract (Q5 rework, lib/pointerGestures): the CARD is the ⚙ trigger's menu —
          id="settings-popover" pairs it via the gear's aria-controls (the id IS the pairing; the
          card deliberately carries no [data-select-group], so a drag that STARTS inside it still
          scrolls natively instead of drag-selecting); the whole card is in drag scope, footer rows
          included. data-drag-dismiss opts it into close-on-drag-pick (App's drag-dismiss listener →
          the apply-on-close pass); the data-drag-stay regions (BOTH footer rows — the theme block
          was the third until round-8 dropped it, so a drag-pick on a theme pill now dismisses like
          the date-format pills) opt back out: Full Reset needs its Confirm? tap, Reset Settings
          should show controls snapping to defaults, and Save Defaults opens its confirmation popup
          (which portals OUT of this card, so a drag-release on popup content can never drag-dismiss
          the panel). The Year Range inputs are data-drag-focus (release = focus for typing, panel
          stays open). The inner scroll wrapper is data-drag-scroll — the controller's auto-scroll
          target + edge-band geometry.
          Scroll recipe (Q5 round-7): the wrapper wears SCROLL_REGION_CLASS + scrollFadeClass
          (components/scrollRegion) — this popover IS the reference treatment (card py-4 only, the
          px-4 scrollbar lane inside the scroller, edge fades) every other scroll region now
          shares. */}
      <div
        ref={cardRef}
        id="settings-popover"
        data-drag-dismiss
        style={MODAL_CARD_SHADOW}
        className="absolute left-4 right-4 top-full mt-2 z-50 rounded-2xl card py-4 space-y-4 flex flex-col max-h-[calc(100dvh_-_var(--bar-h)_-_0.5rem_-_1rem_-_env(safe-area-inset-bottom))]"
      >
        <div
          ref={popoverInnerScrollRef}
          data-drag-scroll
          className={`${SCROLL_REGION_CLASS} flex-1 min-h-0 space-y-4 ${scrollFadeClass(popoverScrolledFromTop, popoverAtBottom)}`}
        >
          {/* SETTINGS regrouped into 3 categories (Q2): Display (how it's shown + how you answer +
              theme), Dates (which dates get generated), Stats. Each category is a SectionLabel
              header; the former per-setting headings are now muted sub-labels (the Leap-Year
              header+sub-label pattern). Every control + its behaviour is unchanged — purely a
              regroup. */}
          {/* ── PRESETS — THE PANEL'S FIRST SECTION, AND FIRST IS THE ARGUMENT ─────────────────
              A preset is not a setting; it is the CONTAINER every setting below belongs to. Put it
              at the head of the panel and the rest of the card reads as "these are <name>'s" —
              which is the owner's one-line rule ("only the current preset, ALL settings apply to
              that preset only including defaults and all that") expressed as layout rather than as
              a sentence somebody has to find. Put it anywhere else and the panel opens on fifteen
              settings with nothing saying whose they are.
              ⚠ IT IS WHY Display NOW WEARS `pt-3 border-t` — that section was the panel's first and
              so was the one section with no divider above it; the rule is that the divider separates
              sections, not that Display never has one.
              ⚠ IT COSTS THE PANEL ~70px OF SCROLL, which is the honest trade and not an oversight:
              this section is read once and acted on rarely, and it pushes the Date Format tray
              further down a card that already scrolls. Nothing cheaper was available — a footer
              link (beside View saved defaults) would have been ~0px, and it would have filed "which
              copy of the app am I in" under the same heading as the app's contact email.
              ⚠ THE LINE OF PROSE IS NOT DUPLICATION OF THE GUIDE. How to Play explains what a
              preset IS; this says which one you are in and what the three buttons at the foot of
              THIS card will reach — a question asked by someone whose finger is already over Full
              Reset. The guide is where they would find out afterwards.
              THE BUTTON is a full-width `surface-toggle` — the Cancel/Close recipe at the panel's
              own control tier (text-xs, py-1.5), not btn-solid: opening a manager is neither
              constructive nor destructive, and violet in this panel means "this saves something"
              (Save Defaults). It is deliberately NOT drawn as a switch row — THE PICKER RULE below
              reserves label-left/one-button-right for on/off settings, and a modal opener wearing
              that shape would read as a setting that is currently "Manage Presets". */}
          <div className="space-y-2">
            <SectionLabel>Presets</SectionLabel>
            <div className="text-xs text-(--tx-200-80)">
              You are on <b>{activePresetName}</b>. Everything in this menu, and both Reset buttons
              at the foot of it, belong to that preset alone — no other preset is touched.
            </div>
            {/* ⚠⚠ data-drag-stay, AND IT IS NOT DECORATION — IT IS WHAT MAKES THIS BUTTON WORK AT
                ALL FROM THE GESTURE THE OWNER USES MOST. The ⚙ card is data-drag-dismiss, so a
                press-drag that starts on the gear and releases on a control inside it clicks the
                control AND closes the panel (lib/pointerGestures: `menu.hasAttribute
                ('data-drag-dismiss') && !member.closest('[data-drag-stay]')`). That is right for a
                setting — release on a theme pill and the panel gets out of the way — and it is
                catastrophic for a MODAL OPENER: the panel closing unmounts this component, and the
                modal it just opened goes with it, so the gesture would look like a button that does
                nothing. The ⚙ footer already carries this attribute for exactly this reason (its
                Save Defaults, View/Clear saved defaults and Changelog links all open modals); this
                is the first modal opener OUTSIDE that footer, so it has to say it for itself.
                ⚠ ON THE BUTTON, NOT ON THE SECTION. `closest` walks up from the release target, so
                either would work — but the section's other two children are a heading and a line of
                prose, neither of which is a gesture target, so marking them would be claiming an
                opt-out for elements that can never use one. */}
            <button
              type="button"
              data-drag-stay
              onClick={() => setPresetsOpen(true)}
              className="w-full px-3 py-1.5 rounded-xl text-xs font-medium border surface-toggle text-(--tx-100-80)"
            >
              Manage Presets
            </button>
          </div>
          <div className="space-y-2 pt-3 border-t border-(--bd-500-20)">
            <SectionLabel>Display</SectionLabel>
            <div className="text-xs text-(--tx-200-80)">Date Format</div>
            {/* ★ EVERY SWITCH NAMES ITS SETTING (aria-label), on all four of them — this one, Use
                System Settings, the Julian Calendar toggle and Save Stats. Their visible content is
                the STATE ("On"/"Off"), which is the same two words on all four, so without a name a
                screen reader hears four identical buttons and nothing can address one of them
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
                three chance rows) — so the panel is now trays and switches, nothing else.
                Caption hierarchy (already correct, don't disturb it): the setting NAME is a
                left-aligned sentence-case sub-label; FAMILY captions are centred uppercase
                SectionLabels. Name → optional family captions → tray(s).
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
                below states its lock ONCE, as PillGroup's `disabled`: the dim, aria-disabled, the
                onChange guard and the tab stops all follow from it. */}
            <PillGroup label="Date Format" disabled={randomFormat} className="flex gap-2">
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
                so: one tray, no captions. Locks/dims in Deduction (answers aren't weekdays; the
                value is preserved), like Julian/Leap-Year Chance when they don't apply — the lock
                sits on the GROUP, so the housing greys as one piece. The condition is
                `==='deduction'` EXACTLY, and it is LIVE: every other mode leaves Input unlocked. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Input</div>
            <PillGroup label="Input" disabled={mode === 'deduction'}>
              <PillTray value={inputStyle} onChange={setInputStyle} options={INPUT_STYLES} />
            </PillGroup>
            {/* Dot Layout — Columns / Rows: which way the 7-dot layout is TURNED (lib/dotLayout,
                the one array both the real input and How-to-Play's diagram derive from). One tray,
                no families, directly under Input because it is the same subject: Input chooses
                whether you answer with dots, this chooses how those dots sit.
                ⚠ NOT CALLED "ROTATE", and that is a naming decision rather than taste: this app
                already uses that word for "turn your device" (the portrait-lock screen,
                components/RotateOverlay). The labels describe the picture instead — the two weekday
                triples run down the side COLUMNS, or along the top and bottom ROWS.
                ★ SAME LOCK AS INPUT, `mode === 'deduction'` EXACTLY, and shared on purpose: the two
                describe one thing, the weekday dot input, which Deduction does not have. A live
                picker sitting directly beneath a dead one — both about dots — would read as a bug
                in the lock.
                ⚠ THE ONE CONSEQUENCE, written down so it is not later reported as one: the title-bar
                mark follows this setting in EVERY mode (main.tsx, components/W5Logo), so in Deduction
                the mark's orientation is frozen rather than irrelevant. Frozen is the honest word —
                nothing about it changes on the way into Deduction; it simply cannot be changed
                while you are there, exactly like the answer layout above it. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Dot Layout</div>
            <PillGroup label="Dot Layout" disabled={mode === 'deduction'}>
              <PillTray
                value={dotOrientation}
                onChange={setDotOrientation}
                options={DOT_ORIENTATIONS}
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
                Captions stay CENTERED in both states (left-aligned SectionLabels are reserved for
                the DISPLAY / DATES / STATS headers and would out-rank the "Theme" sub-label above),
                and neither row is marked "in use" — the OS owns that, and a marker would imply the
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
            <div className="flex items-center gap-2">
              {/* ★ BOTH YEAR BOXES NAME THEMSELVES (aria-label), for the same reason the four
                  switches above do: their only context is the "Year Range" caption above the row
                  and a "→" between them, neither of which a screen reader attaches to either input
                  — so without a name they announce as two bare, indistinguishable edit boxes.
                  "Earliest"/"Latest" rather than "Minimum"/"Maximum" to match the guide's own
                  framing of the range ("Defaults to 1-10000 AD", GuidePage "Dates — Year Range").
                  Purely additive: no visible label is added, so the row's geometry is untouched.
                  ⚠ These names are also the TEST HANDLE for the two boxes. Do not remove them
                  expecting the suite to catch it by other means: the boxes carry no other stable
                  identity, and the previous handle — data-drag-focus — is a GENERAL press-drag
                  opt-in (src/lib/pointerGestures.ts), so any third control in the panel adopting it
                  would have broken every year-range test at once.
                  ⚠ THE TEXT IN THESE BOXES IS NOT PANEL STATE. It lives in App
                  (components/useYearRangeMirrors) and arrives as the `yearRange` prop, together
                  with the two refs, precisely so a half-typed year survives closing and reopening
                  the panel — which it would not if this component owned it and remounted per open.
                  The committed years (minY/maxY) come straight from the store, as everywhere else
                  in the panel. */}
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
                  AND KEEP THE PANEL OPEN: the panel's Escape handler (App's, a document keydown in
                  the BUBBLE phase) decides "is this press mine?" by asking what has focus — and
                  blur() has already run by then, so it saw an empty answer and closed the panel out
                  from under the edit. stopPropagation says plainly that this input consumed the
                  press. It works because that listener is on DOCUMENT and BUBBLES: React 19
                  attaches its own listener at the root container, so stopping the native event
                  there means document never sees it. The four MODAL Escape handlers are
                  capture-phase and still fire first, which is correct — they carve text inputs out
                  themselves.
                  Escape still BLURS, deliberately. It keeps the pair the author wrote (Enter = keep
                  it and let go, Escape = discard it and let go), it drops the numeric keyboard on a
                  phone, and it leaves a second Escape free to close the panel — a dismissal ladder,
                  rather than an input that swallows Escape forever. */}
              <input
                ref={minYearRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Earliest Year"
                data-drag-focus
                value={yearRange.min.value}
                onChange={(e) => {
                  if (e.target.value === '' || /^\d*$/.test(e.target.value))
                    yearRange.min.setValue(e.target.value)
                }}
                onBlur={yearRange.min.commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    yearRange.min.commit()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    const el = e.currentTarget
                    e.stopPropagation()
                    flushSync(() => yearRange.min.setValue(String(minY)))
                    el.blur()
                  }
                  blockMinus(e)
                }}
                onBeforeInput={blockMinusBI}
                className={`${NUM_INPUT_CLASS} py-1.5 w-16`}
              />
              <span className="text-(--tx-300-60) text-sm shrink-0">→</span>
              <input
                ref={maxYearRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Latest Year"
                data-drag-focus
                value={yearRange.max.value}
                onChange={(e) => {
                  if (e.target.value === '' || /^\d*$/.test(e.target.value))
                    yearRange.max.setValue(e.target.value)
                }}
                onBlur={yearRange.max.commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    yearRange.max.commit()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    const el = e.currentTarget
                    e.stopPropagation()
                    flushSync(() => yearRange.max.setValue(String(maxY)))
                    el.blur()
                  }
                  blockMinus(e)
                }}
                onBeforeInput={blockMinusBI}
                className={`${NUM_INPUT_CLASS} py-1.5 w-16`}
              />
            </div>
            {/* ★ THE ORDER OF THIS SECTION (round-12) — Year Range, then the two LEAP rows, then
                the JULIAN pair last. Julian Chance is locked unless the switch is ON *and* the
                range straddles 1582, so under any ordinary modern range it is a greyed-out dead
                control; it used to sit third, ABOVE two live ones. Two pairings constrain any
                future reshuffle: Jan/Feb Chance is a sub-case of Leap Year Chance and must sit
                directly under it, and the Julian switch is the thing that explains why Julian
                Chance greys out, so it must stay directly above it. Move the Julian pair, never one
                half of it.
                The three chance rows (this one, Jan/Feb under it, and Julian Chance at the foot of
                the section) are pickers, so they are trays (THE PICKER RULE, Display above) —
                round-9 converted them from the flat gap-separated buttons they shipped as. The
                conversion costs no height: these rows already captioned ABOVE their control, and
                the tray's ~2px seams are tighter than the ~6px gaps they replace, so every label
                gained room. Each row's LOCK now sits on the GROUP instead of on every button, so
                the housing greys as one piece; the caption stays lit, as it always did. Each lock
                is written straight into `disabled` because one boolean is now all a lock takes —
                the IIFEs the two locked rows (Leap Year Chance, Julian Chance) used to need existed
                only to hand the same derived boolean to a dim class as well.
                Leap Year Chance: locked when the active range/calendar has no leap years; the
                selected value is preserved + restored when a leap year becomes reachable again. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Leap Year Chance</div>
            <PillGroup label="Leap Year Chance" disabled={!rangeHasLeapYear(minY, maxY, useJulian)}>
              <PillTray value={leapChance} onChange={setLeapChance} options={LEAP_CHANCE_OPTIONS} />
            </PillGroup>
            {/* Jan/Feb Chance: the listed % is the exact probability a leap-year date lands on
                Jan/Feb (Random = natural ~17%). Stays unlocked even when leap years aren't
                currently reachable, so it is the one chance row with no lock branch at all. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Jan/Feb Chance on Leap Years</div>
            <PillGroup label="Jan/Feb Chance on Leap Years">
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
            {/* Julian Chance: locked unless the switch directly above is ON *and* the active year
                range straddles 1582 (= mixed Julian+Gregorian: minY<=1582<=maxY). Year 1582 itself
                spans both calendars. When locked the selected value stays visually selected, so
                it's restored when the range becomes mixed again. */}
            <div className="text-xs text-(--tx-200-80) pt-1">Julian Chance</div>
            <PillGroup
              label="Julian Chance"
              disabled={!(useJulian && minY <= 1582 && maxY >= 1582)}
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
            {/* AMNESIC — "does it last", directly under "does it count". A SWITCH by THE PICKER
                RULE above: label left, one On/Off button right, aria-label the row's label
                VERBATIM. See toggleAmnesic for why this one row's value is a property of the
                PRESET rather than a ⚙ setting, and store/amnesic for what it clears and keeps.
                ⚠ THE LOCK, AND WHY IT IS DRAWN ON THE ROW RATHER THAN ON THE BUTTON. With Save
                Stats off nothing is being recorded at all, so "does it last" has no subject and
                the row dims — the app's established "dimmed means disabled". The dim goes on the
                ROW so the label greys with its control, which is PillGroup's rule (a lock fades
                one housing and CSS opacity covers every descendant, so the whole thing greys as
                ONE piece); putting opacity-60 on both row and button would multiply to 0.36.
                That is also why this is not NOT_OFFERED_BTN_CLASS: that token bundles the dim
                with the cursor for a button that carries its own dim, and this one's dim is
                inherited. The other two thirds of controlClasses' three-statement convention are
                unchanged and both live on the button — aria-disabled ANNOUNCES it and the
                handler guard is what actually makes it inert. No pointer-events-none, for round
                15's reason: it would stop the not-allowed cursor from ever painting and would
                leave a keyboard user pressing a silent control.
                ⚠ THE VALUE IS PRESERVED WHILE LOCKED, like Julian Chance's selection — turning
                Save Stats back on restores an amnesic preset to being amnesic. Locking it is what
                stops the flip: a toggle from behind the dim would throw away the session and the
                run in progress with it, for a setting the user was told did not apply. */}
            <div className={`flex items-center justify-between ${saveStats ? '' : 'opacity-60'}`}>
              <span className="text-xs text-(--tx-200-80)">Amnesic</span>
              <button
                type="button"
                aria-label="Amnesic"
                aria-disabled={!saveStats || undefined}
                onClick={() => {
                  if (saveStats) toggleAmnesic()
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${amnesic ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${saveStats ? '' : ' cursor-not-allowed'}`}
              >
                {amnesic ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </div>
        {/* The panel's bottom boundary. elev-shadow-up is UNCONDITIONAL: its strength is the
            --shade the edge hook writes onto this element (0 when the list is scrolled to the end,
            ramping to full over the last --fade-h of travel), so there is no class to toggle and
            nothing left to animate.
            ⚠ .popover-sticky-footer HAS NO CSS RULE ANYWHERE — round 13 removed it, and
            tests/guideScroll.dom separately asserts it is ABSENT from the stylesheet. It reads as
            dead markup and is not: it is this footer's only stable identity, and two tests query
            it. Do not delete it. */}
        <div
          ref={popoverFooterRef}
          data-drag-stay
          className="popover-sticky-footer elev-shadow-up pt-4 px-4 border-t border-(--bd-500-20)"
        >
          <div ref={footerFitRef} className="flex gap-2">
            {/* The invisible STATIC caption twins the auto-fit measures (fitFooterBtns above) — the
                full resting set, so the live Full Reset → "Confirm?" swap never changes the fit.
                absolute keeps them out of the flex row; same text classes as the buttons. */}
            <span
              data-fittwin
              aria-hidden="true"
              className="absolute invisible whitespace-nowrap text-xs font-medium"
            >
              Save Defaults
            </span>
            <span
              data-fittwin
              aria-hidden="true"
              className="absolute invisible whitespace-nowrap text-xs font-medium"
            >
              Reset Settings
            </span>
            <span
              data-fittwin
              aria-hidden="true"
              className="absolute invisible whitespace-nowrap text-xs font-medium"
            >
              Full Reset
            </span>
            {/* ★ HOW THESE THREE SAY "NOT RIGHT NOW" — one convention, stated three ways, and B7
                (round 15) is the round that finished it. Each is
                  (a) DRAWN unavailable — NOT_OFFERED_BTN_CLASS (controlClasses);
                  (b) ANNOUNCED unavailable — aria-disabled, so a screen reader stops calling it an
                      ordinary button while it does nothing;
                  (c) INERT — the handler guard inside each onClick, which round 14 added and which
                      is the only one of the three that is actually the BEHAVIOUR.
                Belt and braces on purpose: (a) and (b) are what the user is told, (c) is what is
                true. Delete any one of them and the other two start lying.
                ⚠ AND (b) DOES ONE MORE JOB, off this file: lib/pointerGestures reads aria-disabled
                to decide these are not gesture targets, so a press-drag from the ⚙ gear neither
                rings one under the finger nor synthesizes a click on it. That job used to belong to
                the pointer-events-none this round removed — see NOT_OFFERED_BTN_CLASS. So the
                attribute is load-bearing twice over; it is not decoration you can drop for a
                `title` or a tooltip.
                ⚠ aria-disabled AND NOT `disabled`, decided on evidence and not on taste:
                  • It is already this app's convention — PillGroup, PillTray, SliderValueEditor and
                    MethodBreakdown's Show Codes all withhold with aria-disabled, and index.css
                    names `.btn-solid[aria-disabled="true"]` FIRST in its unavailable rule. The one
                    real `disabled` is Check for updates, which is a different thing: momentarily
                    busy, not conditionally meaningless.
                  • A real `disabled` DROPS FOCUS when it is applied to the focused element. These
                    three go dim as a RESULT of being pressed — press Reset Settings and it dims
                    itself — so a keyboard user would be thrown back to <body> by their own
                    successful action. aria-disabled leaves focus where it is and re-announces.
                  • It keeps them discoverable. `disabled` removes them from the tab order outright,
                    which trades "reachable but silent" for "not there at all"; the complaint B7
                    fixes is the silence, not the reachability.
                  • And it keeps the guards TESTABLE: jsdom refuses to dispatch activation on a real
                    `disabled` button, so the net could no longer ask what pressing a dimmed button
                    does — the exact question round 14's guards exist to answer.
                Save Defaults (Q7) is constructive → btn-solid purple (the Begin-button language),
                keeping rose exclusively for the two destructive neighbors. It dims when live state
                already equals the saved defaults (factory when none saved) — nothing new to save.
                Each caption sits in a data-fitlabel span (whitespace-nowrap so it MEASURES at full
                width instead of wrapping; overflow-hidden on the button contains the pre-fit
                paint). */}
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
            <button
              type="button"
              onClick={onResetSettings}
              aria-disabled={!settingsModified || undefined}
              className={`flex-1 ${FOOTER_RESET_BTN_CLASS} overflow-hidden ${!settingsModified ? NOT_OFFERED_BTN_CLASS : ''}`}
            >
              <span data-fitlabel className="whitespace-nowrap">
                Reset Settings
              </span>
            </button>
            {/* Full Reset additionally carries the ARMED ring and is the element App's document-level
                capture-phase disarm listener resolves through fullResetBtnRef. aria-disabled changes
                neither: it is an ATTRIBUTE, so the ref still points at the same node, the node is
                still focusable, and no focus moves when it flips. A real `disabled` would have moved
                focus out from under that listener the moment a reset completed. */}
            <button
              ref={fullResetBtnRef}
              type="button"
              onClick={armFullReset}
              aria-disabled={isFullyReset || undefined}
              className={`flex-1 ${FOOTER_RESET_BTN_CLASS} overflow-hidden ${fullResetArmed ? 'ring-2 ring-rose-200 ' : ''}${isFullyReset ? NOT_OFFERED_BTN_CLASS : ''}`}
            >
              <span data-fitlabel className="whitespace-nowrap">
                {fullResetArmed ? 'Confirm?' : 'Full Reset'}
              </span>
            </button>
          </div>
          {/* Every footer text link — the four buttons (View / Clear saved defaults, Check for
              updates, Changelog) and the Contact address below — carries rounded-md px-1 -mx-1: the
              padding gives the press-drag ring breathing room around the text and the radius rounds
              its corners (vs a square outline hugging the glyphs); the negative margin cancels the
              padding so the text keeps its exact flow position. The recipe spans BOTH footer blocks
              now, which is why it is stated here, at the first link, rather than inside one of
              them. */}
          {/* ── THE SAVED-DEFAULTS PAIR — the pinned block's SECOND ROW (Q7 + Q12 + Q5 round-6;
              moved up here this round, owner's call). It sat below the divider as the metadata
              block's first row from Round-2 until now, and the DIVIDER MOVED DOWN WITH IT: this
              block reads [three buttons + two links] and the next one starts at Contact. The two
              links are otherwise untouched — same order (View LEFT of Clear, matching the button
              trio's left→right escalation), same modals, and they still inherit a data-drag-stay,
              from the pinned footer now instead of the metadata block, so a drag-release on either
              still acts with the panel staying open (each opens its modal over it).
              View saved defaults is ALWAYS visible — with nothing saved it opens the defaults
              manager on its clearly-labelled FACTORY view (there is always something to see, and to
              edit, now that the popup is the editable manager — manageDefaultsJsx, declared above).
              Clear saved defaults still appears only while a snapshot exists — with nothing saved
              there is nothing to clear — and is the ONLY way back to factory semantics (the Save
              Defaults popup's duplicate link was removed in Round-4: one action, one home); it
              opens a small CONFIRM modal (Cancel + a red-tier Clear, above) rather than firing
              immediately. The row is always reachable, unlike the button directly above it: Save
              Defaults dims and locks exactly when live == saved, and these never hide behind that.
              Below them the footer decays into contact info and metadata, which is why the divider
              now falls where it does.

              ★ WHY THE TWO CENTRES ARE THIRDS AND NOT HALVES. The three buttons above are flex-1
              siblings, so their centres sit at 1/6, 1/2 and 5/6 of the row. The midpoint of the
              first pair is 1/3 and of the second pair is 2/3 — so a link at each of those lands
              exactly in a GAP between two buttons, and the two rows interlock like a brick course.
              A generic space-around would have put them at 1/4 and 3/4, under the buttons rather
              than between them; that is the thing this deliberately is not, so the thirds are
              implemented as thirds and not approximated by a distribution keyword.
              HOW: three equal columns and NO gap (a gap would push both centres off the thirds —
              see FOOTER_DEFAULTS_ROW_CLASS), View placed across columns 1-2 and Clear across 2-3,
              each centred within its own span. The centre of [0, 2/3] is 1/3 and the centre of
              [1/3, 1] is 2/3. The two spans therefore OVERLAP in the middle column, and that is
              what the rule costs rather than a slip to be tidied away: two boxes cannot both be
              centred on the thirds AND tile the row. It also buys the better failure — each link
              may grow to 2/3 of the row before the grid wraps it, where non-overlapping 1/3-wide
              tracks would wrap both of these captions on any phone. The -mx-1 above is symmetric,
              so centring the margin box centres the visible text with it.
              Both links carry row-start-1 so they share the one row: with only Clear's column
              stated explicitly, auto-placement would have found column 2 already behind the cursor
              (View having just taken columns 1-2) and dropped Clear onto a second line.
              ⚠ WHEN ONLY VIEW IS PRESENT it spans all three columns instead, so it centres on the
              WHOLE row rather than sitting at 1/3 with nothing opposite it.
              ⚠ THE THIRDS ARE TIGHT ON A NARROW PHONE and jsdom cannot say how tight. Centre to
              centre is exactly one third of the row; at the panel's width on a 390pt iPhone that is
              ~97px, against two captions whose half-widths already sum to about the same — so the
              labels come near to touching, and the press-drag rings (4px past each caption) can
              overlap while the text still does not. No implementation of "centres on the thirds"
              avoids that: it is a property of the rule, not of this code. Only the owner's device
              settles whether it reads as interlocked or as crowded. */}
          <div className={`${FOOTER_DEFAULTS_ROW_CLASS} pt-3`}>
            <button
              type="button"
              onClick={openManageDefaults}
              className={`underline select-none rounded-md px-1 -mx-1 row-start-1 col-start-1 justify-self-center ${savedDefaults !== null ? 'col-end-3' : 'col-end-4'}`}
            >
              View saved defaults
            </button>
            {savedDefaults !== null && (
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                className="underline select-none rounded-md px-1 -mx-1 row-start-1 col-start-2 col-end-4 justify-self-center"
              >
                Clear saved defaults
              </button>
            )}
          </div>
        </div>
        <div
          data-drag-stay
          className="pt-3 px-4 border-t border-(--bd-500-20) text-[11px] text-(--tx-300-60) space-y-0.5"
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
          {/* ── THE APP-METADATA ROW, now the last thing in the panel and SPREAD ACROSS IT (owner's
              call, this round — it was left-packed behind a gap-3 until the saved-defaults pair
              moved out of this block and took the "same kind of row" argument with it; see
              FOOTER_META_ROW_CLASS, which still owns the ring-clearance derivation).
              The stamp ANCHORS LEFT, Changelog ANCHORS RIGHT, and Check for updates sits exactly
              halfway between the two facing edges — all three out of one justify-between, because
              every link's px-1 is cancelled by an equal -mx-1 and so the flex margin boxes ARE the
              text boxes: spreading them equally spreads the visible gaps equally. gap-3 stays as
              the FLOOR under those two gaps (the ~4px ring clearance), never as their size.
              ⚠ NEITHER END MOVES WHEN ITS CONTENT CHANGES, which is what makes the middle stable:
              Changelog is anchored as a WHOLE ELEMENT — its text plus the update-dot slot, which
              UpdateDot reserves lit or unlit alike (index.css), so lighting the dot cannot shift
              the row — and Check for updates is width-locked by the hidden strut described below,
              so none of its four labels can move its neighbours either. The only thing here that
              legitimately changes width is the stamp itself, and it grows from the left edge it is
              anchored to. */}
          <div className={FOOTER_META_ROW_CLASS}>
            <span>
              Last Updated:{' '}
              {(() => {
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
            {/* Check for a newer deployed version and apply it if there is one (Q7, round 11 — it
                used to reload unconditionally). The state machine behind it is App's
                (components/useUpdateCheck, called there and never here — it contains a
                useSettingsCloseEffect, which would never fire from a component that unmounts on
                close); this is only its button. Styled like the Contact email link above (inherits
                the footer's text-(--tx-300-60)) so it matches the surrounding footer text on every
                theme, with three deliberate departures:
                  • THE HIDDEN STRUT. The button is a one-cell grid holding the resting label twice
                    — an aria-hidden copy that only reserves width, and the live label stacked on
                    it. So the button is always exactly as wide as "Check for updates" (the longest
                    of the four by construction — lib/updateCheck pins it) and the Changelog link
                    beside it can never shift when the label changes. justify-items-CENTER splits
                    the slack evenly, so each shorter label sits centred in the gap between the Last
                    Updated stamp and Changelog rather than hugging one edge (owner's call
                    2026-08-02, overriding an earlier justify-items-start that anchored them left).
                    The resting label is the widest, so it fills the cell exactly and centring
                    cannot move it — only the three status labels shift, which is the whole point.
                    Note that THIS centring is inside the button's own fixed cell and is a separate
                    question from where the button sits in the row: the row's justify-between is
                    what places the button (halfway between the stamp and Changelog, and a wider
                    date does move it there — as a whole, still halfway), while the strut is what
                    guarantees the label inside can never be the thing that moves anything.
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
              className="select-none rounded-md px-1 -mx-1 grid justify-items-center"
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
            {/* Changelog (Q6), RIGHT of Check for updates — the two update-flavored links live
                together, force-the-latest then read-what-changed — and LAST in the row, which is
                now also the row's right ANCHOR (see the row's own comment): justify-between pins
                this element's trailing edge to the panel's, and "this element" means the text plus
                the dot slot, not the word alone. Same footer-link recipe as the other three;
                wears the INLINE UpdateDot until its first tap after a build change — the
                second stage of the breadcrumb the gear's dot starts. ⚠ Since 2026-08-10 that dot
                appears only when the changelog actually GAINED something, so an internal deploy
                lights the gear and leaves this one dark.
                Round-8 Q7 rebuilt that marker: a text link reserves no room for the gear's corner
                badge, so the round-6 shared recipe put the dot on top of the word. The link is an
                inline-flex row now — the text in its own span, the marker its sibling — and the
                underline moved ONTO that span so the rule can never paint across the gap. The
                marker's slot is reserved lit or not (index.css), so lighting up shifts nothing;
                being aria-hidden, it needs the sr-only word beside it to reach a screen reader,
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
              <span className="underline">Changelog</span>
              {changelogDot && <span className="sr-only">, update</span>}
              <UpdateDot placement="inline" lit={changelogDot} />
            </button>
          </div>
        </div>
      </div>
      {saveDefaultsJsx}
      {manageDefaultsJsx}
      {clearConfirmJsx}
      {changelogJsx}
      {presetsJsx}
    </>
  )
}
