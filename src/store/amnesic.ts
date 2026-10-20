import { usePresets, PRESET_STORE_KEYS } from './presets.js'
import { useSettings, amnesicOf, usePresetAmnesics, refreshPresetAmnesics } from './settings.js'
import type { AmnesicMode } from './amnesicMode.js'

// store/amnesic.ts — AMNESIC PRESETS: what was played on a preset since its Amnesic was switched on is
// forgotten when the app CLOSES (design-amnesic-close.md; the owner's rules, 2026-10-19).
//
// ★ WHILE YOU PLAY, AMNESIC CHANGES NOTHING. Every answer, round, and Best goes into the one saved pool and
// syncs to every other window like any other; the strip shows it; toggling the pill never changes a number
// on screen. Nothing is ever stored separately - there is no session copy of anything.
// ★ AT THE APP'S CLOSE (every window of it closed; a reload is not a close), per preset, going by that
// preset's value at the close, for what was played on it since it was last switched on from Off (or since
// the app opened, whichever is later):
//   Off         everything is kept;
//   Stats Only  those answers' stats are forgotten (score, accuracy, streak, best streak, and solve times),
//               and any new Bests are kept;
//   Full        those, and the Bests set in that time - the previous holders come back exactly.
// What was played before the switch-on is never touched. Stats Only and Full differ only in MoX and Blitz,
// the modes with Bests. Lookup is never affected, on any value.
//
// HOW (each part in its own file):
//   • THE ANCHOR - when play first changes a mode's stats or a Best record inside an Amnesic window, its
//     version keeps the slice as it stood just before: store/syncCounts and store/syncRecords, carried by
//     every merge with the content it describes.
//   • THE WINDOW - `<session>:<switch-on>`: the app session (store/amnesicClose's counter, one session for
//     every window open together) and the preset's switch-on counter (store/settings' `amnesicOn`, moved on
//     by a change away from Off - store/presetControl's setPresetAmnesic).
//   • THE CLOSE AND THE FORGET - store/amnesicClose: Web Locks tell a cold open after a close from a reload
//     or a window joining others, and the opener puts every anchored slice of the session that ended back,
//     before anything is drawn.
//   • THE ONE THING THE PILL CHANGES ON SCREEN - the dashed outline round what will be forgotten
//     (components/StatPanel).
//
// ── THE VALUE ────────────────────────────────────────────────────────────────────────────────
// ★ IT IS A FIELD OF THE PRESET'S SETTINGS DOC (store/settings' `amnesic`; design-q1-q2.md v4, 9): the last
// value chosen stays across a real close and reopen, saved defaults carry it, and another window's change of
// it reaches this one like any setting's. Below, its readers.
// ⚠ An older build on this origin knows nothing of this value (it drops the field on its own save - the
// merge reads that as its stale copy). It reads its own flag on the preset registry, which this build
// carries and never reads (store/presets), and keeps an amnesic preset's play in its own session copy, as it
// always did.

/** One preset's Amnesic value (store/settings' amnesicOf: the active one's store, any other's doc). */
export const amnesicModeOf = (presetId: number): AmnesicMode => amnesicOf(presetId)

/** The Amnesic value of the preset the app is on. */
export const activeAmnesicMode = (): AmnesicMode => useSettings.getState().amnesic

/** …as a subscription — what the ⚙ pill and the dashed outline on the screens render from. */
export const useActiveAmnesicMode = (): AmnesicMode => useSettings((s) => s.amnesic)

/**
 * …and for ANY preset, as a subscription - what a list of presets says after each name
 * (components/PresetSwitcher, components/PresetManager): the active preset's from the store, any other's
 * as store/settings holds every listed preset's own (usePresetAmnesics).
 */
export const useAmnesicModeOf = (presetId: number): AmnesicMode => {
  const activeId = usePresets((s) => s.activeId)
  const active = useSettings((s) => s.amnesic)
  const stored = usePresetAmnesics((s) => s.modes[presetId])
  return presetId === activeId ? active : (stored ?? 'off')
}
// (another window's save of a preset's settings or saved defaults: the browser's own notice, which the
// windows-in-sync door handles for the active preset's docs alone)
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (
      e.key !== null &&
      !e.key.startsWith(PRESET_STORE_KEYS.settings) &&
      !e.key.startsWith(PRESET_STORE_KEYS.userDefaults)
    )
      return
    refreshPresetAmnesics()
  })
