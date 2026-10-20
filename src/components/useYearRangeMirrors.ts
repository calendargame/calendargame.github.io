import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// components/useYearRangeMirrors.ts — ONE PAIR of the ⚙ panel's Year Range TEXT BOXES, as state.
// (Since Round 26 there are two pairs — the range used while the Julian Calendar setting is off, and
// the one used while it is on (store/julianRange) — so App calls this once per pair, each with its
// own cap: 10000 and 11582, lib/calendar's yearMaxFor.)
//
// The boxes are not the setting. minY/maxY in the settings store are the setting; these are
// transient string mirrors that deliberately DISAGREE with the store between a keystroke and its
// commit, so that a half-typed "19" is not read as the year 19. The two strings, the two commits
// and the two store→text sync effects are one unit, and this module is that unit.
//
// ★ WHY IT IS CALLED BY App AND NOT BY THE PANEL. Two reasons now, and they point the same way.
// FIRST, LIFETIME: the panel is conditionally rendered — it unmounts on close and remounts on open.
// State it owned would be re-initialised from the store on every open, and today a half-typed year
// SURVIVES closing and reopening the panel, which is pinned behaviour
// (tests/settingsPanel.yearRange.dom, "PINS TODAY: a half-typed year survives closing and reopening
// the panel"). Owning the pair up in App is what keeps that true.
// SECOND, AUDIENCE (round 15): the panel is no longer the only reader. App's settingsAtDefaults
// compares both strings, and the ⚙ gear draws the answer while the panel is CLOSED — the owner's
// call that a typed-but-uncommitted year counts as "changed" for all four offers. A hook the panel
// owned could not answer a question asked while the panel does not exist.
// ⚠ App therefore re-renders on every keystroke in a year box. It always did — these two useStates
// have been App's since before the extraction, and setMinInputVal has always re-rendered App —
// so reading the values in App's own render costs nothing extra. Nothing here memoises the change
// away, and nothing should try to: the whole point is that the gear reacts to the keystroke.
//
// ★ WHY THE TWO REFS ARE PARAMETERS RATHER THAN PART OF THE RETURN. They are the same shape as
// settingsPopoverRef: created by App, attached by the panel, read by App-side code — here the two
// focus guards below, which are the ONLY readers and which live in this file, so the ref is never
// split from its reader. Returning them instead is what the first draft did, and the React
// Compiler's react-hooks/refs rule rejected it at the CALL site: once a ref flows out of a hook
// inside an object, the compiler treats that whole object as a ref, so `yearRange.min.value` reads
// as a ref access during render. That is the rule working correctly — a hook handing back a
// structure it cannot prove is render-safe — so the fix is the shape, not a suppression.
//
// ★ DO NOT HAND-MEMOISE THE RETURN. A plain object literal built fresh on every call looks like it
// would churn identity and defeat the compiled panel's memo cache — it does not. This hook IS
// compiled (verified in the shipped bundle, round 14: it opens `let o = _c(34)` and the tail reads
// `o[31] !== w || o[32] !== T ? (D = {min: w, max: T, resetTo: E}) : D = o[33]`, with commitMin /
// commitMax cached on their real inputs and resetTo pinned to a memo_cache_sentinel). The compiler
// already does exactly what a useCallback/useMemo pass would, and it does it without the deps
// arrays that would then need hand-maintenance. Adding them here would be duplicated, less
// accurate work — and it is what re-opened the refs-rule problem above the first time.
export type YearMirror = {
  /** The live text in the box — NOT the committed year. */
  value: string
  setValue: (v: string) => void
  /** Parse, clamp against the OTHER field's committed value, write the store, normalise the text. */
  commit: () => void
}

export type YearRangeMirrors = {
  min: YearMirror
  max: YearMirror
  /**
   * Force both boxes to show the given years. Reset Settings' delegate — and it must stay
   * UNCONDITIONAL: the sync effects below fire only when minY/maxY actually CHANGE, so a Reset
   * while the committed range is already at its default would leave dirty text in the boxes if this
   * relied on them instead.
   */
  resetTo: (minY: number, maxY: number) => void
}

export function useYearRangeMirrors(
  minY: number,
  maxY: number,
  setMinY: (v: number) => void,
  setMaxY: (v: number) => void,
  minInputRef: RefObject<HTMLInputElement | null>,
  maxInputRef: RefObject<HTMLInputElement | null>,
  // The highest year this pair takes.
  cap: number,
): YearRangeMirrors {
  // ★ SEEDED FROM THE STORE, and round 15 is the round that had to do it. These two used to
  // initialise to the FACTORY literals '1' / '10000' rather than to the persisted minY/maxY, so a
  // user whose saved range is, say, 1900–2100 had mirrors reading "1"/"10000" for exactly one
  // commit — until the store→text effects below ran on mount. That was pre-existing defect D8, and
  // round 14 left it alone on a MOUNT argument: nothing outside the panel read these strings, and
  // the panel cannot be on screen that early, so the wrong value was never rendered.
  //
  // The note that stood here spelled out the exact condition that would retire the argument —
  // "it breaks the moment anything renders these strings outside the panel … seed these from
  // minY/maxY here first, a lazy initialiser is all it takes" — and round 15's first change is
  // precisely that: App's settingsAtDefaults now compares both strings, and the ⚙ gear renders the
  // result while the panel is CLOSED. On a boot with a saved range the old literals would have
  // disagreed with the store for one render and lit the gear's violet bar on a launch state that is
  // at its defaults. So the seed is no longer a tidiness fix; it is what makes change 1 correct.
  //
  // Lazy on purpose: the initialiser is read once, so this costs one String() at mount rather than
  // one per render, and it CANNOT drift from the effects below — both spell String(minY).
  const [minInputVal, setMinInputVal] = useState(() => String(minY))
  const [maxInputVal, setMaxInputVal] = useState(() => String(maxY))
  // ★ WHETHER THE PLAYER HAS TYPED in a box since its text last showed the setting (Round 26, windows in
  // sync). A box the player only focused holds nothing of theirs: its blur must not write it back, and
  // a change from another window must reach it - else a tap on the box, a change of the range in
  // another window, and a tap away would put the old year back over the other window's choice. Only
  // typed text is protected from the store, and only typed text is committed.
  // (refs: nothing is drawn from them - a commit and the two sync effects read them)
  const minTyped = useRef(false)
  const maxTyped = useRef(false)
  function applyMinValue(val: number) {
    if (val !== minY) setMinY(val)
  }
  function applyMaxValue(val: number) {
    if (val !== maxY) setMaxY(val)
  }
  const commitMin = () => {
    const typed = minTyped.current
    minTyped.current = false
    if (!typed) {
      setMinInputVal(String(minY))
      return
    }
    const p = parseInt(minInputVal)
    if (isNaN(p)) {
      setMinInputVal(String(minY))
      return
    }
    const v = Math.max(1, Math.min(maxY, p))
    applyMinValue(v)
    setMinInputVal(String(v))
  }
  const commitMax = () => {
    const typed = maxTyped.current
    maxTyped.current = false
    if (!typed) {
      setMaxInputVal(String(maxY))
      return
    }
    const p = parseInt(maxInputVal)
    if (isNaN(p)) {
      setMaxInputVal(String(maxY))
      return
    }
    const v = Math.max(minY, Math.min(cap, p))
    applyMaxValue(v)
    setMaxInputVal(String(v))
  }
  // Store → text. FOCUS-GUARDED: a store write from anywhere else must not overwrite what the user
  // is currently typing - and only that: a focused box holding nothing typed follows the store like any
  // other (another window's change). The guard is why these two effects and the two refs belong together.
  //
  // The ref is IN the dependency array, which it was not when these lines lived in App: there the
  // ref came from a local useRef and exhaustive-deps knew it was stable, here it arrives as a
  // parameter and cannot be assumed. Listing it is the honest fix and costs nothing — a ref object
  // keeps its identity for the life of the component, so this still re-runs on a minY change only.
  useEffect(() => {
    if (minTyped.current && document.activeElement === minInputRef.current) return
    minTyped.current = false
    setMinInputVal(String(minY))
  }, [minY, minInputRef])
  useEffect(() => {
    if (maxTyped.current && document.activeElement === maxInputRef.current) return
    maxTyped.current = false
    setMaxInputVal(String(maxY))
  }, [maxY, maxInputRef])
  return {
    min: {
      value: minInputVal,
      setValue: (v) => {
        setMinInputVal(v)
        minTyped.current = true
      },
      commit: commitMin,
    },
    max: {
      value: maxInputVal,
      setValue: (v) => {
        setMaxInputVal(v)
        maxTyped.current = true
      },
      commit: commitMax,
    },
    resetTo: (min, max) => {
      setMinInputVal(String(min))
      setMaxInputVal(String(max))
      minTyped.current = false
      maxTyped.current = false
    },
  }
}
