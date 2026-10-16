import * as React from 'react'
import { useLayoutEffect, useRef } from 'react'
import { useRemoteEpoch } from '../store/syncedDoc.js'

// useSettingsCloseEffect — "run fn once when the ⚙ Settings popover CLOSES, iff these values
// changed while it was open".
//
// It lived in modes/modeHooks until round 11, because the five mode screens were its only
// callers. They are not any more: App itself uses it to end the Check-for-updates interaction on
// close. So it moved OUT of src/modes/, which exists to hold what belongs to a mode SCREEN — App
// reaching down into that directory would have inverted the layering the phase-1 split created,
// and this hook was never mode-specific in the first place. It sits beside overlayStack, the
// app's other cross-cutting overlay-lifecycle module, and nothing here knows what a mode is.
//
// Snapshots `deps` when the popover OPENS and runs fn ONCE on close iff they changed (a
// change-then-revert is a no-op). The ⚙ settings only change while the popover is open, so this
// batches their side-effects — a date regen, a run/round reset, an aborted update check — to a
// single apply on close instead of one per keystroke, and never resets the solve timer
// mid-adjustment. fn runs through a ref so the latest closure (current run/round state) fires, and
// is handed the values as they stood when the popover opened (`before`, index for index with
// `deps`) for the caller whose reaction depends on WHICH of them moved.
// (Values that change OUTSIDE the popover must keep modeHooks' useChangeEffect — they would never
// see an open→close transition coincide with their change.)
//
// ★ THE THIRD CASE: ANOTHER WINDOW CHANGED A SETTING (design-q1-q2.md v4, 6.2). A setting changed in
// another window (a tab, the installed app, the other site: they share one copy of the data) reaches
// this one through the windows-in-sync door (store/syncedDoc), which bumps `remoteEpoch` in the same
// turn as the store patch. With the panel CLOSED, that change runs fn in the very commit it lands in
// — exactly the reaction the same change made here gets when this panel closes. With the panel OPEN,
// the change shows in the panel and is applied at its close like any other. A change made HERE with
// the panel closed (Blitz's sliders, MoX's run length on its own page) is not a third case: it is
// taken into the snapshot as it happens, so it never fires fn later on another window's behalf.
//
// Both effects below are LAYOUT effects (round 8, and they must stay together): the close-fired
// reset/regen has to commit in the SAME paint as the popover close — as passive effects they ran a
// frame later, so the closing popover uncovered the still-green grid for one frame before the reset
// landed. Same-kind effects run in declaration order, so the fnRef updater stays ahead of the
// close-watcher below.
export function useSettingsCloseEffect(
  settingsOpen: boolean,
  deps: React.DependencyList,
  fn: (before: React.DependencyList) => void,
) {
  const fnRef = useRef(fn)
  useLayoutEffect(() => {
    fnRef.current = fn
  })
  const remote = useRemoteEpoch(settingsEpoch)
  const snapRef = useRef(deps)
  const wasOpenRef = useRef(settingsOpen)
  const remoteRef = useRef(remote)
  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = settingsOpen
    const fromElsewhere = remote !== remoteRef.current
    remoteRef.current = remote
    if (settingsOpen) {
      if (!wasOpen) snapRef.current = deps // opened → snapshot the current values
      return
    }
    // closed just now, or another window's change landed while closed → fire once iff anything
    // changed; a change made here while closed is only taken into the snapshot
    const before = snapRef.current
    snapRef.current = deps
    if ((wasOpen || fromElsewhere) && deps.some((d, i) => d !== before[i])) fnRef.current(before)
  }, [settingsOpen, remote, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
}

// The docs whose remote change is a SETTING's: ⚙ settings, the mode setup, and the Julian-on range.
const settingsEpoch = (s: ReturnType<typeof useRemoteEpoch.getState>) =>
  s.settings + s.modePrefs + s.julianRange
