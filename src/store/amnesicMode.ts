// store/amnesicMode.ts — the three values of the Amnesic setting, and the ONE reader of every stored
// spelling of it.
//
// THE THREE VALUES (the ⚙ pill's Off / Stats Only / Full) say what happens, at the app's close, to what
// was played on the preset since its Amnesic was switched on (store/amnesic says it in full):
//   'off'   — everything is kept.
//   'stats' — STATS ONLY: those answers' stats are forgotten; any new Best is kept.
//   'full'  — those, and the Bests they set: the previous holders come back.
// While playing, none of them changes anything. Which value a preset has right now is its settings'
// (store/settings). This file is only the value and its spellings, and imports nothing, so every store
// can read it.

export type AmnesicMode = 'off' | 'stats' | 'full'

/** The pill's order, least amnesic first. */
export const AMNESIC_MODES: readonly AmnesicMode[] = ['off', 'stats', 'full']

export const isAmnesicMode = (v: unknown): v is AmnesicMode =>
  v === 'off' || v === 'stats' || v === 'full'

// What a preset list SAYS after an amnesic preset's name, for a screen reader — nothing for a preset
// on Off. (Nothing is drawn in a list; components/PresetSwitcher argues both halves, and
// components/PresetManager's rows say the same words.) ", amnesic" is what has always been said, and
// the two kinds are told apart by the words that follow it.
export const AMNESIC_SPOKEN: Record<AmnesicMode, string | null> = {
  off: null,
  stats: 'amnesic, stats only',
  full: 'amnesic',
}

// ── How the value is spelled where it is SAVED ────────────────────────────────────────────────
//
// ★ TWO FIELDS, AND THE OLDER ONE IS KEPT ON PURPOSE. Until this setting became three-way it was a
// boolean called `amnesic`. Live and staging share one browser origin, so a build from before the
// change can read anything this one saves — and what such a build does with a value it does not
// recognise in `amnesic` is treat the preset as NOT amnesic: it would keep, for good, the play of a
// preset saved as one that forgets. So the boolean keeps its name and its meaning ("some kind of
// amnesic"), and the kind rides beside it in a field an older build never reads:
//
//     amnesic: boolean          true for Stats Only and for Full — what an older build acts on
//     amnesicMode: AmnesicMode  which of the three — what this build acts on
//
// To an older build a Stats Only default is therefore a plain Amnesic one, which is the safe
// direction: it keeps nothing of the session at all. When an older build saves the snapshot again it
// writes its boolean and drops `amnesicMode`, and the reader below turns that back into Off or Full.
export type StoredAmnesic = { amnesic: boolean; amnesicMode?: AmnesicMode }

/** The saved spelling of a value. */
export const storedAmnesic = (mode: AmnesicMode): Required<StoredAmnesic> => ({
  amnesic: mode !== 'off',
  amnesicMode: mode,
})

/**
 * ★ THE ONE READER OF A SAVED-DEFAULTS SNAPSHOT'S VALUE — the active preset's in store/userDefaults, any
 * other preset's read straight off its key (store/settings' storedAmnesicDefault). (The settings field
 * itself is one of the three values, screened by store/settings.) Pure, total, and keyed on the SHAPE it finds rather than on a version
 * number, because an older build can rewrite any of these at any time:
 *   • no `amnesicMode` — an older build's copy, where the boolean is all there is: true → 'full',
 *     false or absent → 'off' (a snapshot from before the setting existed has neither field, and
 *     that preset was never amnesic);
 *   • a known `amnesicMode` — that value, unless the boolean beside it says amnesic while the mode
 *     says off, which no build writes; then the more amnesic reading wins.
 * ⚠ ANYTHING IT DOES NOT RECOGNISE READS AS 'full' — a mode a newer build added, a boolean that is
 * not one. The two wrong answers are not equal: reading "off" for a preset that was meant to forget
 * keeps that play in the preset's record for good, which cannot be undone; reading "full" for one
 * that was meant to remember shows the dashed outline and the pill on Full before anything is
 * forgotten, and is put right with one tap. So every doubt resolves toward forgetting.
 */
export function readAmnesicMode(stored: unknown): AmnesicMode {
  if (!stored || typeof stored !== 'object') return 'off'
  const { amnesic, amnesicMode } = stored as { amnesic?: unknown; amnesicMode?: unknown }
  const flag: AmnesicMode =
    amnesic === undefined || amnesic === null || amnesic === false ? 'off' : 'full'
  if (amnesicMode === undefined) return flag
  if (!isAmnesicMode(amnesicMode)) return 'full'
  return amnesicMode === 'off' ? flag : amnesicMode
}
