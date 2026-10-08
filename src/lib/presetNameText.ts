// lib/presetNameText.ts — HOW MUCH OF A PRESET NAME THE APP DRAWS, OUTSIDE THE BOX IT IS TYPED IN.
//
// A preset name has no length limit: the rename field (components/PresetManager) takes whatever is
// typed or pasted, a whole book included, and stores it as it is. Everything ELSE that shows a name
// shows it through one of the two functions below, so no name, however long, can cost a screen more
// than a few hundred characters of text to lay out, or push a popup's buttons out of reach.
//   • nameAsDrawn — for the places a name is SHOWN AS A NAME (the preset control, the rows of its
//     list, "Open in" and its rows) and for the names screen readers are given. The whole name, up
//     to NAME_DRAWN_UNITS; past that, its start and an ellipsis.
//   • nameAsQuoted — for a name quoted INSIDE A SENTENCE (a confirmation, the ⚙ menu's "You are
//     on…", a row of the storage popup). Its first NAME_QUOTED_CHARACTERS, so the sentence stays a
//     few lines long.
// Both are pure, cost the same for a name of a million characters as for one of a thousand (they
// look at its start and at nothing else), and never change what is stored.
//
// ★ BOTH CUT BETWEEN THE CHARACTERS A PLAYER SEES, NEVER BETWEEN THE UNITS A STRING IS COUNTED IN.
// An emoji is two units, a flag is two emoji-sized letters, a family is several people held together
// by invisible joiners, and an accent rides behind the letter it changes; half of one has no picture.
// `Intl.Segmenter` is the platform's own answer to "where does one character end".

/**
 * The most of a name a name slot draws, in the units a string is counted in.
 *
 * ★ WHY THERE IS A NUMBER AT ALL, AND WHY ITS VALUE DECIDES NOTHING ABOUT CORRECTNESS. A slot is one
 * line, clipped, with an ellipsis — but a browser still has to shape every character of a line
 * before it can clip it, in every slot, on every layout: a pasted book would stall each frame that
 * draws it. So a slot draws at most this much of a name. A name longer than this is therefore NOT
 * SHOWN IN FULL BY CONSTRUCTION — nameAsDrawn says so with an ellipsis, and lib/presetNameWidth
 * answers "does it fit" for it without measuring anything. A name this long or shorter is measured
 * exactly. No estimate of how wide characters are is involved either way.
 * The value only has to be more than any slot could ever show whole, so the cut is never what
 * shortens a name that would otherwise have fit: the widest slot the app lays out is a few hundred
 * pixels, and this many of even a hair-width character is wider than that.
 */
export const NAME_DRAWN_UNITS = 512
/** The most of a name a sentence quotes, in characters as a player sees them. */
export const NAME_QUOTED_CHARACTERS = 80

const ELLIPSIS = '…'
const characterSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// The whole characters at the start of `name` that end within its first `units` units.
//   ★ ONLY THAT START IS EVER READ, so the cost does not grow with the name. The cut is first moved
//   back off the middle of a code point (an emoji's two units). From there, where one character
//   ends depends on what comes before it and on the code point right after it, never on anything
//   further on — so the start of a name is divided exactly as the whole name would be, except for
//   its last character, which the cut may have landed inside. That one is dropped.
//   ⚠ ONE CHARACTER CAN BE LONGER THAN ANY LIMIT (a letter with a thousand accents stacked on it).
//   Then there is no whole character to keep, and the cut stays inside it — between code points.
function wholeCharactersWithin(name: string, units: number): string[] {
  if (name.length <= units) return charactersOf(name)
  const cutsAPair = name.charCodeAt(units - 1) >= 0xd800 && name.charCodeAt(units - 1) <= 0xdbff
  const start = name.slice(0, cutsAPair ? units - 1 : units)
  const characters = charactersOf(start)
  characters.pop()
  return characters.length > 0 ? characters : [start]
}
const charactersOf = (text: string): string[] =>
  Array.from(characterSegmenter.segment(text), ({ segment }) => segment)

/** Is the whole of `name` drawn where a name is shown — i.e. is it within NAME_DRAWN_UNITS? */
export const isDrawnWhole = (name: string): boolean => name.length <= NAME_DRAWN_UNITS

/** `name` as a name slot draws it: all of it, or its start and an ellipsis (NAME_DRAWN_UNITS). */
export const nameAsDrawn = (name: string): string =>
  isDrawnWhole(name) ? name : wholeCharactersWithin(name, NAME_DRAWN_UNITS).join('') + ELLIPSIS

/** `name` as a sentence quotes it: all of it, or its start and an ellipsis (NAME_QUOTED_CHARACTERS). */
export function nameAsQuoted(name: string): string {
  // A character is at least one unit, so a name of no more units than the limit is within it.
  if (name.length <= NAME_QUOTED_CHARACTERS) return name
  const characters = wholeCharactersWithin(name, NAME_DRAWN_UNITS)
  return isDrawnWhole(name) && characters.length <= NAME_QUOTED_CHARACTERS
    ? name
    : characters.slice(0, NAME_QUOTED_CHARACTERS).join('') + ELLIPSIS
}
