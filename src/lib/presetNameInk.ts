// lib/presetNameInk.ts — DOES A NAME DRAW ANYTHING, ON THIS DEVICE?
//
// ★ THE SECOND HALF OF ONE JUDGE. store/presets' normalizePresetName decides whether a name is
// empty, and it asks two questions in turn: first the Unicode rule (is any character in it one
// that Unicode says is drawn at all?), then — only for a name that passes — THIS one: drawn in the
// app's own font, on this device, does it put a single pixel on the screen? A name that draws
// nothing is an empty name, exactly like one made of spaces. Every place that asks whether a name
// is empty asks normalizePresetName, so this is never called from anywhere else.
//
// WHY THE UNICODE RULE IS NOT ENOUGH ALONE. Unicode can say a character is never drawn (a space, a
// zero-width joiner), but not that one IS: the object replacement character (U+FFFC), the
// interlinear annotation marks, a private-use character, or a code point nothing is assigned to
// yet is drawn as whatever the device's fonts make of it — often nothing. Only the device knows,
// so the device is asked, by drawing.
//
// ★ HOW IT IS ASKED. The name is drawn AS IT IS WRITTEN — its own characters, in its own order — in
// the font the page's text is set in, on a small canvas that is never put in the page, and the
// pixels are read back. Any pixel that is not fully transparent is ink.
//   • IN ITS OWN ORDER, BECAUSE A CHARACTER CAN DRAW DIFFERENTLY BESIDE ANOTHER. Measured in the
//     browser lane: WebKit draws the object replacement character as NOTHING on its own and as a
//     BOX the moment anything stands next to it — two of them, or one after a space. So a name is
//     never judged by its characters one at a time; only drawing the name says what the name shows.
//   • A NAME CAN BE A PASTED BOOK, so it is drawn in PIECES of PIECE_UNITS, in order, and the
//     first piece with ink ends the question — an ordinary name is answered by its first piece.
//     A piece with nothing in it the Unicode rule calls visible cannot be ink and is not drawn,
//     and a piece already drawn blank is not drawn again (a book of one blank character is one
//     drawing). Where a cut between two pieces separates characters that draw differently
//     together, it can only find MORE ink than the whole name has, never less — the safe way.
//   • A CHARACTER WITH NO PICTURE IN ANY FONT IS INK. A device draws such a character as an empty
//     box (or a box holding its number), and a box is something to see — so a name of them is
//     kept. Only a device that draws a name as NOTHING makes it empty there.
//
// ★ WHEN IT CANNOT ANSWER, IT SAYS SO (null), AND THE UNICODE RULE'S ANSWER STANDS: the name is
// kept. That is the safe direction — a blank name kept is a blank row, and a real name thrown away
// is the player's text lost. It cannot answer:
//   • where there is no canvas to draw on — the test suite's jsdom, and Node. (A browser that
//     refuses a canvas its 2D context, or throws, is the same case.)
//   • ⚠ WHILE THE PAGE'S FONT IS NOT READY TO DRAW. The question is about the app's own font, and a
//     font still loading draws a stand-in — whose answer could be different. So before every
//     piece, `document.fonts.check` is asked whether that font can draw that text NOW; if it says
//     not yet, there is no answer. The app's font today is the device's own system interface font
//     (index.css names none of its own, so the stylesheet's default stack is what every name is
//     drawn in), which is never downloaded and is always ready: the check says yes the first time
//     it is asked, at the very first load (the browser lane holds that, in Chromium and WebKit). It
//     is there so that a font this app may one day download can never make a name be judged
//     against the wrong letters.
//   • FOR A BOOK OF MANY DIFFERENT BLANK PIECES — past MOST_PIECES drawings with no ink — the
//     question is given up rather than allowed to cost a frame its time.
//
// ⚠ NOTHING IS WRITTEN, AND NOTHING IS REMEMBERED BUT THE LAST QUESTION. The same name is asked
// about on every render of the rename box's note, so the last answer is kept beside its question
// (only a real answer — "not yet" is asked again next time).

// The size a name is drawn at. Big enough that the thinnest stroke covers whole pixels; small
// enough that a piece is a small canvas.
const DRAW_PX = 32
// Clear space round what is drawn, so a stroke that starts left of its own origin or rises above
// the font's own height is still on the canvas.
const PAD_PX = 4
// How much of a name is drawn at once, in the units a string is counted in.
const PIECE_UNITS = 64
// The most pieces drawn for one name before the question is given up (above).
const MOST_PIECES = 32

// A canvas of its own, never put in the page — created once, on the first question. (Not an
// OffscreenCanvas: Safari has one, but the WebKit the browser lane runs does not, and a canvas
// element that is never attached is exactly as offscreen.) jsdom has none at all: getContext
// returns null there (tests/setup/dom.js silences the "not implemented" line it logs), which is
// the "no canvas" answer. The try is for a browser with canvas switched off, which can throw.
let context: CanvasRenderingContext2D | null | undefined
const drawingContext = (): CanvasRenderingContext2D | null => {
  if (context !== undefined) return context
  try {
    context =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  } catch {
    context = null
  }
  return context
}

// The font names are drawn in: the page's own text font, as the stylesheet sets it on the root.
// Read at each question rather than once, because it is not settled until the stylesheet is.
const pageFont = (): string | null => {
  try {
    const family = getComputedStyle(document.documentElement).fontFamily
    return family ? `${DRAW_PX}px ${family}` : null
  } catch {
    return null
  }
}

// Does this piece of a name put a pixel on the canvas? null when that cannot be known now.
function pieceHasInk(ctx: CanvasRenderingContext2D, font: string, text: string) {
  try {
    if (document.fonts && !document.fonts.check(font, text)) return null
    ctx.font = font
    const m = ctx.measureText(text)
    const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft))
    const up = Math.ceil(Math.max(DRAW_PX, m.actualBoundingBoxAscent))
    const width = left + Math.ceil(Math.max(m.width, m.actualBoundingBoxRight, 1)) + 2 * PAD_PX
    const height = up + Math.ceil(Math.max(DRAW_PX / 2, m.actualBoundingBoxDescent)) + 2 * PAD_PX
    // Giving the canvas its size also clears it and resets the context, the font included.
    ctx.canvas.width = width
    ctx.canvas.height = height
    ctx.font = font
    ctx.fillStyle = '#000'
    ctx.fillText(text, PAD_PX + left, PAD_PX + up)
    const pixels = ctx.getImageData(0, 0, width, height).data
    for (let alpha = 3; alpha < pixels.length; alpha += 4) if (pixels[alpha] !== 0) return true
    return false
  } catch {
    return null
  }
}

// The name's pieces, in order: PIECE_UNITS each, never cutting an emoji's two units apart.
function* piecesOf(name: string): Generator<string> {
  for (let start = 0; start < name.length; ) {
    let end = Math.min(start + PIECE_UNITS, name.length)
    const unit = name.charCodeAt(end - 1)
    if (end < name.length && unit >= 0xd800 && unit <= 0xdbff) end++
    yield name.slice(start, end)
    start = end
  }
}

let last: { name: string; inked: boolean } | null = null

/**
 * Does `name` put any ink on the screen, drawn in the app's font on this device? true or false —
 * or null when that cannot be known here and now (no canvas, the font not ready to draw, or too
 * many blank pieces to draw). `visible` is the Unicode rule (store/presets): a piece it finds
 * nothing visible in is not drawn.
 */
export function nameHasInk(name: string, visible: (text: string) => boolean): boolean | null {
  if (last?.name === name) return last.inked
  const ctx = drawingContext()
  const font = ctx && pageFont()
  if (!ctx || !font) return null
  const blank = new Set<string>()
  for (const piece of piecesOf(name)) {
    if (blank.has(piece) || !visible(piece)) continue
    if (blank.size === MOST_PIECES) return null
    const inked = pieceHasInk(ctx, font, piece)
    if (inked !== false) return remember(name, inked)
    blank.add(piece)
  }
  return remember(name, false)
}

const remember = (name: string, inked: boolean | null): boolean | null => {
  if (inked !== null) last = { name, inked }
  return inked
}
