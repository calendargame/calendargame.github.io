import { create } from 'zustand'

// lib/unaskedSwap.ts — A QUESTION THIS WINDOW DID NOT ASK TO CHANGE (design-q1-q2.md v4, 6.4).
//
// Windows stay in sync (store/syncedDoc): a setting changed in another window does here what the same
// change does when this ⚙ panel closes — a waiting question drawn again, a round reset — and, once the
// saved progress is merged too, a mode's stats changed elsewhere rebuild its screen. Each of those
// replaces the question on screen WITHOUT this window's input, perhaps under a finger already on an
// answer. A press made for the question that went must never be credited to the one that came, and
// must never vanish without a word. So, for every such swap:
//   1. THE ANSWER GRIDS REMOUNT (`useSwapEpoch` is part of every grid's React key): a press latched
//      before the swap meets a grid that is gone, and lib/pointerGestures presses nothing for it —
//      exactly as after a reset;
//   2. FOR SWAP_GUARD_MS AFTER IT, NO ANSWER IS TAKEN — a tap, a long hold, a key 0-9 (each one ends
//      as a click on a grid button, and the guard below takes the click before the screen sees it);
//   3. AND EITHER WAY THE PRESS IS ANSWERED BY A CUE: `.press-void`, a neutral inset ring on the
//      pressed button for VOID_MS (index.css) — not red or green, so it can never read as a verdict;
//      no sound; nothing moves. The button is the one under the finger at release (or the key's), in
//      the grid now on screen — the one the player is looking at.
// WHICH SWAPS ARE UNASKED is said where they happen: a reaction to another window's change runs inside
// `unasked()` (components/useSettingsCloseEffect's third case, modes/modeHooks' timing switch), and the
// engine notes a swap made inside it (engine/useGameEngine); a screen rebuilt on another window's
// stats notes its own (store/syncedDoc's adopt).
// ⚠ SWAP_GUARD_MS IS A NUMBER CHOSEN, NOT MEASURED (the design's weakest point 9): long enough to
// cover a press begun as the old question was read, short enough that a player answering the new one
// at once is not held up.

export const SWAP_GUARD_MS = 300
export const VOID_MS = 350
// (the ring's fade after it: index.css's .press-void-fade, which Reduce Motion makes none)
const FADE_MS = 150

/** The count of unasked swaps (part of every answer grid's key), and when the last one was. */
export const useSwapEpoch = create<{ epoch: number; at: number }>()(() => ({
  epoch: 0,
  at: -Infinity,
}))

let depth = 0
/** Run `fn` as a reaction this window did not ask for: a question it replaces is an unasked swap. */
export function unasked<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
  }
}
/** Is the code running now a reaction this window did not ask for? */
export const inUnasked = (): boolean => depth > 0

/** A question was replaced without this window's input: remount the grids, and guard the answers. */
export function noteUnaskedSwap(): void {
  useSwapEpoch.setState((s) => ({ epoch: s.epoch + 1, at: performance.now() }))
}

/** Is an answer pressed now one the guard takes (the question changed under it a moment ago)? */
export const answersGuarded = (): boolean =>
  performance.now() - useSwapEpoch.getState().at < SWAP_GUARD_MS

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
/** The cue for a press that did not count: the ring on `button`, for VOID_MS, then its fade. */
export function voidPress(button: Element): void {
  clearTimeout(timers.get(button))
  button.classList.remove('press-void-fade')
  button.classList.add('press-void')
  timers.set(
    button,
    setTimeout(() => {
      button.classList.remove('press-void')
      button.classList.add('press-void-fade')
      timers.set(
        button,
        setTimeout(() => button.classList.remove('press-void-fade'), FADE_MS),
      )
    }, VOID_MS),
  )
}

/** The answer button `el` is, or is inside — null for anything else. */
export const answerButtonOf = (el: Element | null): HTMLElement | null => {
  const button = el?.closest('button')
  return button && button.closest('[data-answer-grid="true"]') ? (button as HTMLElement) : null
}

/**
 * Take every answer pressed while the guard is up — before the screen's own handler sees it — and
 * answer it with the cue. Installed once per page (App's boot effect). Returns the removal.
 */
export function installAnswerGuard(): () => void {
  const onClick = (e: MouseEvent) => {
    if (!answersGuarded()) return
    const button = answerButtonOf(e.target as Element | null)
    if (!button) return
    e.preventDefault()
    e.stopImmediatePropagation()
    voidPress(button)
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
