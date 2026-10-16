// lib/textFit.ts — TEXT SIZED TO ITS ROOM IN THE DEVICE'S OWN FONT: the one engine behind the date
// on the card (lib/dateLineFit) and Lookup's history rows (components/LookupCard).
//
// ★ WHY ANYTHING IS MEASURED. The app names no font of its own (index.css), so every device sets its
// text in its own system font — Segoe UI on Windows, San Francisco on an iPhone, Roboto on most
// Androids, DejaVu Sans on a Linux desktop, a font of its owner's choosing on some phones — and the
// same words are a different width in each (DejaVu Sans sets "September 10, 10000" 22% wider than
// Segoe UI). A layout that holds a long line in a narrow room by a constant ("the card's width over
// 10.97em") is right only for the fonts it was measured in. So where a line must fit and could not
// at its full size, the device is asked how wide the text is.
//
// ★ WHAT IT DOES. A caller registers a ROOM (an element whose content width is the space its text
// has) and a FIT (given that width, measure, and set the size). The fit is run:
//   • when the room is first laid out, and whenever its width changes (one ResizeObserver watches
//     every room — a rotation, a resize, a mode shown after being hidden all arrive that way);
//   • for EVERY room, whenever the font may have changed: a hidden SENTINEL — a fixed line of
//     glyphs, in both weights, at the root size — is watched by the same observer, and its size
//     changes whenever a font finishes loading, the root size changes (index.css's html font-size
//     follows the window), or anything else changes how the page's letters are set;
//   • and when the caller says what it holds has changed (refitTextRoom).
// ResizeObserver calls back after layout and BEFORE paint, so a fitted size is the size the first
// frame is drawn at: no frame shows text at a size it does not fit, whatever Reduce Motion says.
// Nothing is measured per frame, or per change of the text shown.
//   ⚠ A FIT MUST NOT CHANGE ITS ROOM'S SIZE — only the size of text inside a box whose size does
//   not depend on it (each caller pins its line heights in rem). A room resized from its own
//   callback is a ResizeObserver loop, which the browser reports as an error.
//
// ★ RULERS. A fit measures in a RULER: a hidden element under <body> (aria-hidden, invisible, in a
// box of no size — it takes no room and adds no scroll) that wears the measured text's own classes.
// It inherits only what <html> and <body> set; the real text inherits from its ancestors too.
// Nothing between them sets anything that changes how text is set (spacing, font features) — if
// something ever does, the browser lane's fit tests, which measure the real text in its real room
// in three fonts, are what fail.
//
// ⚠ jsdom lays nothing out (its window has no width): no ruler or sentinel is ever made there, no
// fit ever runs, and the DOM suite sees the stylesheet's sizes.

const rooms = new Map<Element, (room: number) => void>()
const widths = new Map<Element, number>()
const digitCache = new Map<string, string>()
let sentinel: HTMLElement | null = null

/** A hidden ruler wearing `className`: one row per text, each laid out at its natural width. */
export function makeRuler(className = ''): HTMLElement {
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  const inner = document.createElement('div')
  inner.className = className
  inner.style.cssText =
    'display:flex;flex-direction:column;align-items:flex-start;width:max-content'
  box.append(inner)
  document.body.append(box)
  return inner
}
/** Put one row per text in a ruler (rows may also be built by the caller). */
export function setRows(ruler: HTMLElement, texts: readonly string[]): void {
  ruler.replaceChildren(
    ...texts.map((text) => {
      const row = document.createElement('div')
      row.textContent = text
      return row
    }),
  )
}
/** The widest row in a ruler, as laid out now. */
export const widestRow = (ruler: HTMLElement): number =>
  Math.max(0, ...[...ruler.children].map((row) => row.getBoundingClientRect().width))

const DIGITS = '0123456789'
/**
 * The widest digit in the font a ruler is set in (a font's digits need not be one width). Read once
 * per font and type — the ruler's classes and weight — and read again after any font change.
 */
export function widestDigit(ruler: HTMLElement): string {
  const key = `${ruler.className}|${getComputedStyle(ruler).fontWeight}`
  const known = digitCache.get(key)
  if (known) return known
  const keep = [...ruler.childNodes]
  const size = ruler.style.fontSize
  ruler.style.fontSize = ''
  setRows(ruler, [...DIGITS])
  const each = [...ruler.children].map((row) => row.getBoundingClientRect().width)
  const digit = DIGITS[each.indexOf(Math.max(...each))]
  ruler.replaceChildren(...keep)
  ruler.style.fontSize = size
  digitCache.set(key, digit)
  return digit
}

/**
 * The largest scale, at most 1, at which `widestAt(scale)` fits `room` — read again at each new
 * scale rather than trusted to be linear, so a font whose letters change with the size (San
 * Francisco's text and display cuts) is answered exactly. Each round shrinks by at least a tenth of
 * a percent, so the answer always fits; a font that scales evenly settles in two reads.
 */
export function largestFit(room: number, widestAt: (scale: number) => number): number {
  let scale = 1
  for (let round = 0; round < 12; round++) {
    const widest = widestAt(scale)
    if (widest <= room) return scale
    scale *= Math.min(room / widest, 0.999)
  }
  return scale
}

const observer =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        let fontChanged = false
        const resized: Element[] = []
        for (const entry of entries) {
          if (entry.target === sentinel) fontChanged = true
          else if (rooms.has(entry.target)) {
            widths.set(entry.target, entry.contentRect.width)
            resized.push(entry.target)
          }
        }
        if (fontChanged) digitCache.clear()
        for (const room of fontChanged ? rooms.keys() : resized) run(room)
      })

function run(room: Element): void {
  const width = widths.get(room) ?? 0
  if (width > 0) rooms.get(room)?.(width)
}

/**
 * Watch `room` and run `fit` with its content width whenever it or the font changes; returns what
 * stops it (a layout effect's cleanup).
 */
export function watchTextRoom(
  room: HTMLElement | null,
  fit: (width: number) => void,
): (() => void) | undefined {
  if (!room || !observer) return undefined
  // The sentinel is made with the first room, on a page that is laid out (never in jsdom, whose
  // window has no width). Made HERE, not in the observer's callback: an element first watched from
  // inside a callback, shallower than the one that called back, would be left for the next frame,
  // and the browser reports that as a ResizeObserver loop error.
  if (!sentinel && document.documentElement.clientWidth > 0) {
    sentinel = makeRuler()
    setRows(sentinel, [GLYPHS, GLYPHS])
    ;(sentinel.lastElementChild as HTMLElement).style.fontWeight = '700'
    observer.observe(sentinel)
  }
  rooms.set(room, fit)
  observer.observe(room)
  return () => {
    observer.unobserve(room)
    rooms.delete(room)
    widths.delete(room)
  }
}
/** What `room` holds has changed: fit it again now, at the width it already has. */
export const refitTextRoom = (room: Element): void => run(room)

const GLYPHS = '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ,.:/-_·—'
