import * as React from 'react'
import { useLayoutEffect, useRef } from 'react'

// useSettingsCloseEffect — "run fn once when the ⚙ Settings popover CLOSES, iff these values
// changed while it was open".
//
// It lived in modes/modeHooks until round 11 (Q7), because the five mode screens were its only
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
// mid-adjustment. fn runs through a ref so the latest closure (current run/round state) fires.
// (Values that change OUTSIDE the popover must keep modeHooks' useChangeEffect — they would never
// see an open→close transition coincide with their change.)
//
// Both effects below are LAYOUT effects (round-8 Q9, and they must stay together): the close-fired
// reset/regen has to commit in the SAME paint as the popover close — as passive effects they ran a
// frame later, so the closing popover uncovered the still-green grid for one frame before the reset
// landed. Same-kind effects run in declaration order, so the fnRef updater stays ahead of the
// close-watcher below.
export function useSettingsCloseEffect(
  settingsOpen: boolean,
  deps: React.DependencyList,
  fn: () => void,
) {
  const fnRef = useRef(fn)
  useLayoutEffect(() => {
    fnRef.current = fn
  })
  const snapRef = useRef(deps)
  const wasOpenRef = useRef(settingsOpen)
  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = settingsOpen
    if (settingsOpen && !wasOpen) {
      snapRef.current = deps
      return
    } // opened → snapshot the current values
    if (!settingsOpen && wasOpen) {
      // closed → fire once iff anything changed
      const changed = deps.some((d, i) => d !== snapRef.current[i])
      snapRef.current = deps
      if (changed) fnRef.current()
    }
  }, [settingsOpen, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
}
