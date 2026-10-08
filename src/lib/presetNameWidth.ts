import { PRESET_NAME_COL, PRESET_NAME_CELL_SELECTOR } from '../components/PresetSwitcher.jsx'

// lib/presetNameWidth.ts — THE LIVE, PIXEL-WIDTH CAP on a preset name AS IT IS TYPED (round
// 20), replacing the fixed MAX_PRESET_NAME=12 character cap that used to be the only thing
// stopping a keystroke in the rename field (components/PresetManager).
//
// ★★ THE RULE, the owner's: a name may be as long as the room it is SHOWN in, "so that nothing
// ever gets cut off" — and the room is "the available space after the checkmark with the space that
// the pill fills", a row of the preset list at the top-bar control's width. The rename field lives
// in a ⚙ popup with plenty of its own width — NOT the constraint. The constraint is every OTHER
// place the name is drawn: the preset control in the fixed top bar, a row of the list it opens,
// and the ⚙ menu's "Open in" control and its list. So every keystroke measures the CANDIDATE text's
// real rendered pixel width against EACH of those places as it is laid out right now, in that
// place's own font, and refuses (or shortens, for a paste-shaped change bigger than one
// keystroke) whatever would not fit the narrowest — the same shape as a native `maxLength`
// refusing a keystroke, just width-based instead of count-based. What exactly is refused, and
// what is never touched, is capCandidateToNameRoom's own note at the foot of this file.
//   ⚠ IT USED TO MEASURE THE TOP-BAR BUTTON ALONE, and that was the defect: a list row had less
//   room than the button (and larger text), so a name the button showed whole was cut short with
//   "…" in the list under it. The list is exactly the button's width and its rows are the
//   ordinary dropdown rows (the ✓ column, their own padding, larger text), so a row is the
//   narrowest place a name is shown and is what governs — measured, not assumed: every place is
//   asked, each in its own font.
//
// ★ WHY THIS FILE, AND WHY THE SPLIT INSIDE IT. Two things live here that would otherwise have to
// live inside components/PresetManager, and both are worth pulling out for the same reason
// lib/statFit and lib/sliderValue already are: the DECISION is pure and trivially testable, the
// MEASUREMENT is not (it needs a live canvas and live DOM elements, neither of which jsdom
// provides — its `HTMLCanvasElement.getContext('2d')` returns `null` rather than implementing
// anything, verified empirically rather than assumed, see the test file, and tests/setup/dom.js
// silences the "not implemented" warning that call logs). `measureTextWidthPx` below degrades to a
// 0-width measurement whenever that happens, so every candidate "fits" in a plain jsdom test unless
// a test deliberately fakes the canvas back in. Keeping the pure predicate
// (`fitsWithinWidth`) separate from the impure measurement (`measureTextWidthPx`,
// `readNameRooms`) is what lets the DECISION be tested directly with fabricated numbers, while
// a thinner integration test proves only that PresetManager's wiring calls the right functions.
//
// ── THE CROSS-COMPONENT WIDTH READ ────────────────────────────────────────────────────────────
//
// ★★ THIS IS THE HARD PART, AND IT IS SOLVED BY FOLLOWING AN EXISTING HOUSE PATTERN RATHER THAN
// INVENTING ONE. The rename field (mounted inside a ⚙ popup) and the places a name is drawn (the
// fixed top bar, the ⚙ menu) are SIBLINGS somewhere far up the tree, not parent and child, so React
// props and context have no clean path between them — the same shape of problem this app has
// already solved by reaching across the DOM directly where its own tree does not offer a path:
// the game's `document.querySelectorAll('[data-key="..."]')` shortcuts, `[data-answer-grid="true"]`.
// `readNameRooms` below is the same idiom: `PRESET_NAME_CELL_SELECTOR`
// (components/PresetSwitcher) names a stable `data-*` hook on the one cell every preset list draws
// a name in — the element whose ACTUAL rendered width is the number that matters — and this
// function reads every one of them fresh, at the moment it is needed, with no ref-forwarding chain
// and no store of its own to keep in sync.
//   ★ ONE HOOK, SO THE PLACES AGREE BY CONSTRUCTION. Nothing here lists the places. A place that
//   draws a preset's name draws it with components/PresetSwitcher's PresetOptionLabel, and that is
//   what puts it in this measurement; one that is ever added is measured from the first render.
//   ★ A CLOSED LIST IS MEASURED TOO. components/CustomSelect keeps a hidden copy of each preset
//   list laid out at its trigger's width (its row gauge), drawn by the same row code as the open
//   list — so the room in a row is a real, live number whether or not the list is open.
//
// ⚠ THE FALLBACK, for when not one cell can be measured — which cannot happen in the app (the top
// bar is always mounted) and is coded defensively anyway, because this suite mounts PresetManager
// on its own in several places with no top bar at all.
//   CHOSEN: refuse to grow the cap past a SAFE MINIMUM, rather than fall back to the old
//   character-count behaviour. The character count doesn't answer "how many pixels" — the whole
//   reason this file exists — and falling back to it could let a name back in that the (missing)
//   switcher might not actually be able to show, which is the exact failure this mechanism exists
//   to prevent. The minimum below is the switcher's own documented FLOOR (PRESET_NAME_COL,
//   components/PresetSwitcher) converted to a pixel estimate at a conservative root font size, so
//   the fallback promises no more than the switcher is guaranteed to render at minimum — never a
//   number invented independently of the control it is standing in for.
const FALLBACK_ROOT_PX = 15.6 // index.css's fluid clamp at its narrowest common case (360×800)
// Parsed FROM PRESET_NAME_COL rather than re-typed as a literal, so this can never silently drift
// from the floor it is standing in for if that constant is ever tuned.
const FALLBACK_EM = parseFloat(PRESET_NAME_COL)
const FALLBACK_BUDGET_PX = FALLBACK_EM * 0.875 * FALLBACK_ROOT_PX // PRESET_NAME_COL (4.5em) at text-sm (0.875rem) ≈ 61px — see PresetSwitcher for why 4.5, not 6
const FALLBACK_FONT = `${(0.875 * FALLBACK_ROOT_PX).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`

export interface NameRoom {
  /** The room a name has in one place it is drawn, as rendered on screen RIGHT NOW — not an estimate. */
  widthPx: number
  /** That place's own computed font, read straight off the live element via getComputedStyle, so a
   *  candidate is measured in the SAME font it will actually be shown in rather than a guess at it. */
  font: string
}

/**
 * Read every place a preset name is drawn right now: each name cell's live rendered width and
 * font, narrowed to ONE entry per font — the narrowest cell set in it, since a name that fits that
 * one fits every wider cell in the same font. Cells that report a non-positive width are skipped
 * (jsdom's zero-everywhere layout always does — see the test file for how that path is exercised),
 * so the result is empty when nothing can be measured and the caller falls back to
 * FALLBACK_BUDGET_PX / FALLBACK_FONT rather than trusting a number that cannot be real.
 */
export function readNameRooms(): NameRoom[] {
  let cells: Iterable<Element>
  try {
    cells = document.querySelectorAll(PRESET_NAME_CELL_SELECTOR)
  } catch {
    return []
  }
  const narrowestByFont = new Map<string, number>()
  for (const cell of cells) {
    const { width } = cell.getBoundingClientRect()
    if (!(width > 0)) continue
    const font = getComputedStyle(cell).font
    narrowestByFont.set(font, Math.min(width, narrowestByFont.get(font) ?? Infinity))
  }
  return Array.from(narrowestByFont, ([font, widthPx]) => ({ font, widthPx }))
}

// A shared, lazily-created canvas — one per module load, not one per keystroke. jsdom does not
// implement canvas at all: `getContext('2d')` there returns `null` rather than throwing (verified
// — see tests/presetNameWidth.dom.test.js's own probe case), which the plain null-check below
// already handles. The try/catch is for a REAL browser that has canvas disabled outright (some
// locked-down configurations throw on the property access itself, the same shape store/presets'
// presetScopedStorage already guards against for localStorage) — a case this suite cannot
// reproduce but code should not assume away.
let sharedCanvas: HTMLCanvasElement | null = null
const get2dContext = (): CanvasRenderingContext2D | null => {
  try {
    if (!sharedCanvas) sharedCanvas = document.createElement('canvas')
    return sharedCanvas.getContext('2d')
  } catch {
    return null
  }
}

/**
 * The real rendered pixel width of `text` set in `font` (a CSS font shorthand, as returned by
 * `getComputedStyle(...).font`). 0 wherever canvas is unavailable (this suite's jsdom, or a
 * browser that has disabled it) — the same "measure nothing, refuse nothing" degradation
 * lib/statFit's fitScale already uses for a 0-width measurement.
 */
export const measureTextWidthPx = (text: string, font: string): number => {
  const ctx = get2dContext()
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

// ── THE PURE DECISION ─────────────────────────────────────────────────────────────────────────
//
// "Does this candidate fit in this budget" — kept apart from both measurement functions above
// specifically so it can be unit-tested with FABRICATED widths, independent of canvas or the DOM.
export const fitsWithinWidth = (measuredWidthPx: number, budgetPx: number): boolean =>
  measuredWidthPx <= budgetPx

// Does `text` fit EVERY room, measured in each room's own font? The narrowest place governs, and
// which one that is depends on the text (the fonts differ), so all of them are asked.
const fitsEveryRoom = (text: string, rooms: readonly NameRoom[]): boolean =>
  rooms.every((room) => fitsWithinWidth(measureTextWidthPx(text, room.font), room.widthPx))

// ── WHAT ONE CHARACTER IS ─────────────────────────────────────────────────────────────────────
//
// ★ EVERYTHING BELOW CUTS AND COMPARES TEXT BY THE CHARACTER A PLAYER SEES, NEVER BY THE UNIT A
// STRING IS COUNTED IN. They are not the same thing: an emoji is two units, a flag is two
// emoji-sized letters, a family is several people held together by invisible joiners, a skin tone
// or an accent rides behind the character it changes. Cutting by the unit kept the front half of
// one — and half an emoji has no picture, measures narrow, "fits", and was saved into the registry
// as a broken character. `Intl.Segmenter` is the platform's own answer to "where does one
// character end", so a name is taken apart into those and only ever put back together from whole
// ones. (A half that is ALREADY in a stored name, from a build that could make one, comes out as a
// character of its own and is left where it is: nothing here rewrites text the player did not
// touch.)
const characterSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const charactersOf = (text: string): string[] =>
  Array.from(characterSegmenter.segment(text), ({ segment }) => segment)

// ── WHAT THE EDIT WAS ─────────────────────────────────────────────────────────────────────────
//
// Every edit a text box can make is ONE REPLACEMENT: a stretch of the old text (possibly empty)
// gives way to a run of new characters (possibly empty). A typed letter replaces nothing with one
// character; a deletion replaces something with nothing; typing or pasting over a selection does
// both. So an edit is three lists of whole characters — the `head` and `tail` it left alone, and
// what was `inserted` between them — and `removed`, whether anything of the old text went.
//
// ★ THE TEXT ALONE CANNOT ALWAYS SAY WHICH REPLACEMENT IT WAS, AND THE FIELD CAN. With "Weekend" in
// the box, "My Weekend" is what both of these leave: "My " typed in front of it, and the whole
// name selected and "My Weekend" pasted over it. Read from the text, the second looks like the
// first — which is how a paste over everything was once refused whole for "adding to a full name".
// So the field hands over the stretch that was selected when the edit began (`replaced`, in the
// old text's own offsets), and that is the answer whenever it is a possible one.
//   ⚠ IT IS A CLAIM, AND IT IS CHECKED. A selection is where an edit USUALLY lands, not where it
//   must: a backspace takes the character before a bare cursor, a phone keyboard's correction or
//   prediction can rewrite a word the cursor is merely inside. So `replaced` is used only when the
//   new text really is the old text with exactly that stretch swapped out, between whole
//   characters. When it is not — or none was handed over — the edit is read from the two texts:
//   the most they share at the start, then the most they share at the end, the smallest change
//   that explains them.
export interface TextRange {
  start: number
  end: number
}
interface Edit {
  head: string[]
  inserted: string[]
  tail: string[]
  removed: boolean
}
// How many whole characters come before `offset` — or -1 where it falls inside one, or past the end.
const charactersBefore = (characters: readonly string[], offset: number): number => {
  let at = 0
  for (let count = 0; at <= offset; count++) {
    if (at === offset) return count
    if (count === characters.length) break
    at += characters[count].length
  }
  return -1
}
const asEdit = (previous: string, candidate: string, replaced: TextRange | null): Edit => {
  const before = charactersOf(previous)
  const after = charactersOf(candidate)
  const most = Math.min(before.length, after.length)
  let sharedStart = 0
  while (sharedStart < most && before[sharedStart] === after[sharedStart]) sharedStart++
  let sharedEnd = 0
  while (
    sharedEnd < most &&
    before[before.length - 1 - sharedEnd] === after[after.length - 1 - sharedEnd]
  ) {
    sharedEnd++
  }
  let head = sharedStart
  let tail = Math.min(sharedEnd, most - sharedStart)
  if (replaced) {
    const claimedHead = charactersBefore(before, replaced.start)
    const claimedEnd = charactersBefore(before, replaced.end)
    const claimedTail = before.length - claimedEnd
    if (
      claimedHead >= 0 &&
      claimedEnd >= claimedHead &&
      claimedHead <= sharedStart &&
      claimedTail <= sharedEnd &&
      claimedHead + claimedTail <= most
    ) {
      head = claimedHead
      tail = claimedTail
    }
  }
  return {
    head: after.slice(0, head),
    inserted: after.slice(head, after.length - tail),
    tail: after.slice(after.length - tail),
    removed: head + tail < before.length,
  }
}

export interface CandidateResult {
  /** What the field should show — `candidate` unchanged if it fit, and otherwise as much of the
   *  edit as fits (none of it, for a single keystroke). */
  text: string
  /** Whether anything had to be refused. The field hands it back as `full` on its next edit, and
   *  it drives the width-language note in PresetManager. */
  capped: boolean
  /** Where the cursor belongs in `text` when it is not what the box was showing — the box is being
   *  written back to, and a write leaves the cursor at the end unless it is put somewhere. After a
   *  shortened paste, just behind what was kept of it; after a refusal, what was selected before.
   *  `null` when `text` is the candidate and the cursor is already where the edit left it. */
  selection: TextRange | null
}

/**
 * The one call components/PresetManager's rename field makes on every edit: reads the live room in
 * every place a name is drawn (falling back to the safe minimum above when none can be measured),
 * measures the candidate against each, and returns what the field should actually show.
 *
 * ★★ THE RULE, IN ONE PLACE. An edit replaces a stretch of the name with a run of new characters
 * ("what the edit was", above), and:
 *   • THE TEXT OUTSIDE THAT STRETCH IS NEVER TOUCHED. An edit loses its own end, never the name's.
 *   • WHAT DOES NOT FIT COMES OFF THE END OF THE NEW RUN, a whole character at a time ("what one
 *     character is", above) — a paste keeps as much of its start as fits, where it was pasted, the
 *     shape a native `maxLength` gives one.
 *   • IF NONE OF THE NEW RUN FITS, THE EDIT DID NOT HAPPEN: the name is exactly what it was, and so
 *     is the selection. A single typed letter is the plain case — refused outright, wherever the
 *     cursor is. A letter typed over a selection that will not fit in its place is the other, and
 *     it does not delete the selection on its way out.
 *   • TAKING AWAY IS NEVER REFUSED. An edit that adds nothing is the player's own deletion and is
 *     kept as made, whatever it measures.
 * (It used to read the edit from the text alone and cut anything that was not a pure insertion to
 * its longest prefix that fit — so a wide letter typed over a narrow one dropped the LAST letter of
 * the name, and saved it that way.)
 *
 * ★ `previous` IS WHAT THE FIELD HELD BEFORE THIS EDIT, AND IT IS WHY A NAME THAT IS ALREADY TOO
 * LONG IS NEVER CUT FOR BEING TOUCHED. A stored name can be wider than today's room — it was made
 * on a wider screen, or under an older build's looser limit — and it is kept exactly as it is: the
 * places that draw it shorten it with "…" on screen (PresetOptionLabel's `truncate`), and nothing
 * rewrites what is stored. So in each place the limit is the room OR the width the name already
 * had there, whichever is larger: an edit may shorten an over-long name, or keep its width, and is
 * refused only for making it wider than both.
 *
 * ★ `full` IS THIS FUNCTION'S OWN LAST `capped`, HANDED BACK, AND IT IS WHY A REFUSED LETTER IS
 * NOT FOLLOWED BY A NARROWER ONE THAT SLIPS IN. Width decides what fits, and letters are not one
 * width: with room for "Weekend " and no room for the "M" after it, the "i" four letters later
 * does fit, and typing "Weekend Mornings" used to leave "Weekend i" in the box. So once something
 * has been refused the name is FULL, and every edit that only adds is refused whatever its width,
 * until an edit takes something away — a deletion, or a selection typed or pasted over, which is
 * measured as usual and, if it fits, is no longer full. The caller keeps the flag beside the
 * pending text and drops both together (a commit, a discard, the field losing the keyboard), so
 * there is nothing here to get stuck: this function remembers nothing between calls.
 *
 * ★ `replaced` IS THE STRETCH OF `previous` THAT WAS SELECTED WHEN THE EDIT BEGAN, or `null` when
 * the field cannot say. See "what the edit was".
 */
export function capCandidateToNameRoom(
  candidate: string,
  previous: string,
  full: boolean,
  replaced: TextRange | null,
): CandidateResult {
  const { head, inserted, tail, removed } = asEdit(previous, candidate, replaced)
  if (inserted.length === 0) return { text: candidate, capped: false, selection: null }
  const headLength = head.join('').length
  const refused: CandidateResult = {
    text: previous,
    capped: true,
    selection: { start: headLength, end: previous.length - tail.join('').length },
  }
  if (full && !removed) return refused
  const measured = readNameRooms()
  const rooms = (
    measured.length > 0 ? measured : [{ font: FALLBACK_FONT, widthPx: FALLBACK_BUDGET_PX }]
  ).map((room) => ({
    font: room.font,
    widthPx: Math.max(room.widthPx, measureTextWidthPx(previous, room.font)),
  }))
  const withKept = (kept: number) => [...head, ...inserted.slice(0, kept), ...tail].join('')
  let kept = inserted.length
  while (kept > 0 && !fitsEveryRoom(withKept(kept), rooms)) kept--
  if (kept === inserted.length) return { text: candidate, capped: false, selection: null }
  if (kept === 0) return refused
  const caret = headLength + inserted.slice(0, kept).join('').length
  return { text: withKept(kept), capped: true, selection: { start: caret, end: caret } }
}
