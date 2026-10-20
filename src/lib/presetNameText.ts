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
//     on…", a row of the storage popup). Its first NAME_QUOTED_CHARACTERS — characters as a player
//     counts them, whatever each is made of — so the sentence stays a few lines long.
// Both are pure, cost the same for a name of a million characters as for one of a thousand (they
// look at its start and at nothing else), and never change what is stored.
//
// ★ AND BOTH CUT A NAME BEFORE ITS COPY NUMBER, NEVER THROUGH IT (Round 26). A copy is named after its
// original with " (2)" on the end (store/presets' copyName), so cutting a long name at its end cut
// away exactly the part that tells the copy from its original. Both keep the number (copyNumberOf)
// and cut what comes before it — and components/PresetSwitcher's PresetOptionLabel draws a name the
// same way where the SCREEN cuts it: "A rather long preset na… (2)".
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
// How much of a name is READ to find those characters, in units: this many for each of them.
// ★ A QUOTE IS COUNTED IN CHARACTERS, BUT WHAT IS READ TO COUNT THEM HAS TO END SOMEWHERE, because
// one character has no largest size (a letter can carry any number of accents). Reading only what
// a name slot draws (NAME_DRAWN_UNITS) was too little: a family emoji is 8 units and a couple with
// skin tones 15, so 81 of them were quoted as fewer than 80. This allows every one of the eighty
// to be twice the longest character Unicode itself recommends (those run to about 16 units), so
// eighty of ANY real character is eighty. Past it — characters far larger than any real one — the
// quote is the whole characters that were read, and it still ends in an ellipsis.
const UNITS_READ_PER_QUOTED_CHARACTER = 32

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

// ── A copy's number ───────────────────────────────────────────────────────────────────────────
// The longest copy number that is kept whole where a name is cut, in units (" (" and ")" included).
// A copy's number counts up from 2, so a real one is a few digits; a name the player typed to end
// in a number hundreds of digits long is no copy anyone made, and keeping all of it would defeat
// the very cut it rides on — so a number longer than this is cut with the rest of the name.
const COPY_NUMBER_KEPT_UNITS = 16

/**
 * Where `name`'s copy number starts — the " (<number>)" on its end that store/presets' copyName
 * writes and counts on from — or -1 for a name that does not end in one. A number is 1 or more,
 * with no leading 0. ★ Only the END of the name is read (the digits, back to their bracket), so a
 * pasted book costs what a word does.
 */
export function copyNumberAt(name: string): number {
  const close = name.length - 1
  if (name[close] !== ')') return -1
  let open = close - 1
  while (open >= 0 && name[open] >= '0' && name[open] <= '9') open--
  const hasDigits = open < close - 1
  return hasDigits && name[open] === '(' && name[open - 1] === ' ' && name[open + 1] !== '0'
    ? open - 1
    : -1
}

/** The copy number a cut keeps on the end of `name` (" (2)"), or '' — see COPY_NUMBER_KEPT_UNITS. */
export function copyNumberOf(name: string): string {
  const at = copyNumberAt(name)
  return at >= 0 && name.length - at <= COPY_NUMBER_KEPT_UNITS ? name.slice(at) : ''
}

/** Is the whole of `name` drawn where a name is shown — i.e. is it within NAME_DRAWN_UNITS? */
export const isDrawnWhole = (name: string): boolean => name.length <= NAME_DRAWN_UNITS

/**
 * `name` as a name slot draws it: all of it, or its start, an ellipsis, and its copy number
 * (NAME_DRAWN_UNITS; copyNumberOf). The start is read from `name` itself, never a copy of it cut
 * off before the number: a name this long reaches the number only far past what is read.
 */
export function nameAsDrawn(name: string): string {
  if (isDrawnWhole(name)) return name
  const number = copyNumberOf(name)
  return wholeCharactersWithin(name, NAME_DRAWN_UNITS - number.length).join('') + ELLIPSIS + number
}

/**
 * `name` as a sentence quotes it: all of it, or its first characters, an ellipsis, and its copy
 * number (copyNumberOf) — NAME_QUOTED_CHARACTERS characters in all, the number's included (each of
 * its characters is one unit).
 */
export function nameAsQuoted(name: string): string {
  // A character is at least one unit, so a name of no more units than the limit is within it.
  if (name.length <= NAME_QUOTED_CHARACTERS) return name
  const read = NAME_QUOTED_CHARACTERS * UNITS_READ_PER_QUOTED_CHARACTER
  const characters = wholeCharactersWithin(name, read)
  if (name.length <= read && characters.length <= NAME_QUOTED_CHARACTERS) return name
  const number = copyNumberOf(name)
  return characters.slice(0, NAME_QUOTED_CHARACTERS - number.length).join('') + ELLIPSIS + number
}

// ── A quoted name, as the pieces it is drawn in ───────────────────────────────────────────────
// A character with more combining marks than this is STACKED: it is drawn in a box of its own
// that clips it to its line (components/QuotedName). Marks pile up one above the other, and a
// handful is as many as any writing system puts on one letter — two in Vietnamese, three or four
// with Hebrew or Arabic pointing, a few more in the tallest Tibetan stack — and text like that is
// meant to be drawn as it is, so it is left alone. More than this is a pile, not a letter.
const MARKS_IN_AN_ORDINARY_CHARACTER = 8
const COMBINING_MARK = /\p{M}/gu
const isStacked = (character: string): boolean =>
  // (A character of no more units than the limit cannot hold more marks than it.)
  character.length > MARKS_IN_AN_ORDINARY_CHARACTER &&
  (character.match(COMBINING_MARK)?.length ?? 0) > MARKS_IN_AN_ORDINARY_CHARACTER

/**
 * nameAsQuoted(name), in the pieces components/QuotedName draws: runs of ordinary text, and each
 * STACKED character by itself. Joined back together they are exactly nameAsQuoted(name). A name
 * with no stacked character in it — every ordinary name — is one piece.
 */
export function quotedNameParts(name: string): { text: string; stacked: boolean }[] {
  const parts: { text: string; stacked: boolean }[] = []
  for (const character of charactersOf(nameAsQuoted(name))) {
    const stacked = isStacked(character)
    const last = parts.at(-1)
    if (last && !stacked && !last.stacked) last.text += character
    else parts.push({ text: character, stacked })
  }
  return parts
}
