import { useSyncExternalStore } from 'react'
import { isDrawnWhole } from './presetNameText.js'
import { shortStockName, stockNumber } from '../store/presets.js'

// lib/presetNameWidth.ts — DOES A PRESET NAME FIT WHERE IT IS SHOWN, RIGHT NOW?
//
// ★★ THE RULE, the owner's: a name may be ANY length, and nothing the player types is ever refused
// or altered. Where a name does not fit it is shown with an ellipsis, and the app answers that in
// two ways, both decided here:
//   • the note under the rename field (components/PresetManager) appears at the exact character
//     where the text being typed stops fitting in the narrowest place a name is shown, and goes the
//     moment it fits again (isCutSomewhere);
//   • a stock name ("Preset 3") that would be cut is drawn in a short form instead — "P3", or the
//     bare number "3" where even that would be cut (stockNameForm — components/PresetSwitcher
//     draws it and states the rule).
// Both are PURE FUNCTIONS OF THE TEXT AND THE ROOMS: nothing is remembered between calls, so
// neither can be left on, or off, by the order things happened in.
//
// ── THE ROOMS ─────────────────────────────────────────────────────────────────────────────────
//
// A ROOM is the width a name has in one place it is drawn, with that place's own font. The places
// are the preset control in the top bar, a row of the list it opens, and the ⚙ menu's "Open in"
// control and a row of its list. The rename field itself is not one of them: it shows the whole
// stored name, scrolling sideways.
//   ★ ONE HOOK, SO THE PLACES AGREE BY CONSTRUCTION. Nothing here lists the places. Every one of
//   them draws a name with components/PresetSwitcher's PresetOptionLabel, whose cell wears
//   `data-preset-name-cell` (PRESET_NAME_CELL_SELECTOR) — the element whose ACTUAL rendered width
//   is the number that matters. Drawing a name there is what puts a place in the measurement.
//   ★ A CLOSED LIST IS MEASURED TOO. components/CustomSelect keeps a hidden copy of each preset
//   list laid out at its trigger's width (its row gauge), drawn by the same row code as the open
//   list — so the room in a row is a real, live number whether or not the list is open. A row is
//   where a name has the least room, so it is usually what decides.
//   ★ THE ROOMS ARE KEPT CURRENT, AND ANYTHING DRAWN FROM THEM FOLLOWS (useNameRooms). They are
//   read again whenever a name cell is mounted, removed, or changes size (each cell hands itself
//   to watchNameCell, and one ResizeObserver watches them all — a rotation, a window resize, and a
//   list opening all arrive that way), when the window changes size (a cell can keep its width
//   while its font changes, and the font is part of a room), and when a font finishes loading (the
//   same text is then a different width in the same room). A reading that matches the last one
//   changes nothing.
//   ⚠ NO PLACE, NO VERDICT — BUT A PLACE WITH NO ROOM IS A PLACE. Where no cell is laid out at all
//   (this suite's jsdom, which has no layout; never the app, whose top bar is always mounted)
//   every name "fits": there is nowhere it is being cut. A cell that IS laid out and has been
//   squeezed to no width is the opposite case — the place where a name is cut hardest — and is a
//   room of 0. (It used to be skipped as unmeasurable, so on the narrowest screens the verdict
//   turned to "fits" exactly where the list rows had no room at all.)
//
// ★ WHY THE SPLIT INSIDE THIS FILE. The DECISION is pure and tested with fabricated numbers
// (fitsWithinWidth, and the two functions built on it); the MEASUREMENT needs a live canvas and
// live elements, neither of which jsdom provides — `getContext('2d')` there returns null, and
// measureTextWidthPx then measures 0, so a test that wants real widths fakes both back in.

/** The DOM hook on the one cell every preset name is drawn in — see "the rooms", above. */
export const PRESET_NAME_CELL_SELECTOR = '[data-preset-name-cell]'

export interface NameRoom {
  /** The room a name has in one place it is drawn, as rendered on screen RIGHT NOW — not an estimate. */
  widthPx: number
  /** That place's own computed font, read straight off the live element via getComputedStyle, so a
   *  name is measured in the SAME font it is shown in rather than a guess at it. */
  font: string
}

/**
 * Read every place a preset name is drawn right now: each name cell's live rendered width and
 * font, narrowed to ONE entry per font — the narrowest cell set in it, since a name that fits that
 * one fits every wider cell in the same font. A cell with NO LAYOUT is skipped — it has no box at
 * all (a hidden subtree; and every element in jsdom), which is what `getClientRects()` being empty
 * says — so the result is empty when nothing is laid out. A cell that has a box of no width is
 * kept: that is a room of 0.
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
    if (cell.getClientRects().length === 0) continue
    const { width } = cell.getBoundingClientRect()
    const font = getComputedStyle(cell).font
    narrowestByFont.set(font, Math.min(width, narrowestByFont.get(font) ?? Infinity))
  }
  return Array.from(narrowestByFont, ([font, widthPx]) => ({ font, widthPx }))
}

// ── The rooms, kept current ───────────────────────────────────────────────────────────────────
let rooms: readonly NameRoom[] = []
const listeners = new Set<() => void>()
const sameRooms = (a: readonly NameRoom[], b: readonly NameRoom[]): boolean =>
  a.length === b.length &&
  a.every((room, i) => room.font === b[i].font && room.widthPx === b[i].widthPx)

/**
 * Read the rooms again, now, and tell whoever draws from them if they changed. `fontsChanged`: tell
 * them even if no room did — the same room holds a different amount of text in a font that has
 * only just loaded.
 */
export function refreshNameRooms(fontsChanged = false): void {
  const next = readNameRooms()
  if (!fontsChanged && sameRooms(next, rooms)) return
  rooms = next
  listeners.forEach((listener) => listener())
}
// A cell mounting or leaving reads the rooms once the render that did it is on the page, however
// many cells that render touched — and before the browser paints it, so a stock name never shows
// one frame in the wrong form.
let readQueued = false
const refreshSoon = (): void => {
  if (readQueued) return
  readQueued = true
  queueMicrotask(() => {
    readQueued = false
    refreshNameRooms()
  })
}
const cellObserver =
  typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refreshNameRooms())
/**
 * A name cell's `ref`: the cell is watched for as long as it is mounted (React runs what this
 * returns when it goes, and so never calls it with nothing — the type of a ref still allows for it).
 */
export function watchNameCell(cell: Element | null): (() => void) | undefined {
  if (!cell) return undefined
  cellObserver?.observe(cell)
  refreshSoon()
  return () => {
    cellObserver?.unobserve(cell)
    refreshSoon()
  }
}
const onWindowResize = (): void => refreshNameRooms()
const onFontsLoaded = (): void => refreshNameRooms(true)
const subscribeToRooms = (listener: () => void): (() => void) => {
  if (listeners.size === 0) {
    window.addEventListener('resize', onWindowResize)
    document.fonts?.addEventListener('loadingdone', onFontsLoaded)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    window.removeEventListener('resize', onWindowResize)
    document.fonts?.removeEventListener('loadingdone', onFontsLoaded)
  }
}
const currentRooms = (): readonly NameRoom[] => rooms
/** The rooms as they are now; whatever is drawn from them is drawn again when they change. */
export const useNameRooms = (): readonly NameRoom[] =>
  useSyncExternalStore(subscribeToRooms, currentRooms)

// ── Measuring ─────────────────────────────────────────────────────────────────────────────────

// A shared, lazily-created canvas — one per module load, not one per keystroke. jsdom does not
// implement canvas at all: `getContext('2d')` there returns `null` rather than throwing, which the
// plain null-check below handles. The try/catch is for a REAL browser that has canvas disabled
// outright (some locked-down configurations throw on the property access itself).
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
 * browser that has disabled it) — "measure nothing, say nothing is cut".
 */
export const measureTextWidthPx = (text: string, font: string): number => {
  const ctx = get2dContext()
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

// ── The pure decisions ────────────────────────────────────────────────────────────────────────

/** Does a width fit a budget? The boundary is inclusive: text exactly as wide as its room fits. */
export const fitsWithinWidth = (measuredWidthPx: number, budgetPx: number): boolean =>
  measuredWidthPx <= budgetPx

// Is ALL of `text` shown in EVERY room, each in its own font? The narrowest place governs, and
// which one that is depends on the text (the fonts differ), so all of them are asked.
//   ★ A NAME TOO LONG TO BE DRAWN WHOLE IS NOT MEASURED AT ALL. A name slot draws only the start of
//   such a name (lib/presetNameText's NAME_DRAWN_UNITS), so it is not shown in full whatever it
//   would have measured — which is also what keeps this cheap for a pasted book: the answer for a
//   million characters is one comparison of a length, on every keystroke.
//   ★ WHAT IS MEASURED IS THE TEXT AS A NAME SLOT LAYS IT OUT: one line on which every run of
//   spaces, tabs, and line breaks is drawn as a single space. A canvas measures each of them, so
//   they are folded first — or two spaces in a row would count for a width the screen never gives
//   them.
const showsInFull = (text: string, rooms: readonly NameRoom[]): boolean => {
  if (!isDrawnWhole(text)) return false
  const laidOut = text.replace(/[ \t\n\r\f]+/g, ' ')
  return rooms.every((room) =>
    fitsWithinWidth(measureTextWidthPx(laidOut, room.font), room.widthPx),
  )
}

/**
 * Is a preset named `name` shown cut short in at least one place? What the note under the rename
 * field is drawn from. `name` is a name as it is STORED (store/presets' normalizePresetName): the
 * field asks about what its text would be saved as, not about the text itself.
 * ★ A STOCK NAME IS JUDGED BY ITS SHORTEST FORM. "Preset 3" that does not fit is drawn as "P3", and
 * where that does not fit either, as "3" (stockNameForm, below) — so it is cut only where even the
 * bare number is.
 */
export function isCutSomewhere(name: string, rooms: readonly NameRoom[]): boolean {
  if (showsInFull(name, rooms)) return false
  const number = stockNumber(name)
  return number === null || !showsInFull(number, rooms)
}

/**
 * How every stock name is drawn, everywhere a name is shown: in full ("Preset 3"), short ("P3"), or
 * as its bare number ("3"). components/PresetSwitcher's ★★ "drawn short" block states the rule.
 */
export type StockForm = 'full' | 'short' | 'number'

// The last question stockNameForm was asked, and its answer: every name cell on the page asks the
// same one in the same render.
let lastStock: { presets: unknown; rooms: unknown; form: StockForm } | null = null
/**
 * The form ALL the stock names among `presets` are drawn in — one answer for the whole app:
 *   • 'full'   when every stock name, written in full, is shown whole in every room;
 *   • 'short'  when one is not, but every one's "P3" form is;
 *   • 'number' when even one of those is not. Where a bare number does not fit either, it is cut
 *              like any other name (the ellipsis) — the owner's "no reason to optimize past that".
 * ★ IT MEASURES THE FULL NAMES AND THE "P3" FORMS, WHATEVER IS ON SCREEN, and a room's width does
 * not depend on the text in it (a name cell fills the space its control gives it). So drawing a
 * shorter form cannot change the answer that chose it: no flicker, and the longer forms are back
 * the moment they fit.
 */
export function stockNameForm(
  presets: readonly { name: string }[],
  rooms: readonly NameRoom[],
): StockForm {
  if (lastStock?.presets !== presets || lastStock.rooms !== rooms) {
    const stock = presets.filter((p) => stockNumber(p.name) !== null)
    const form: StockForm = stock.every((p) => showsInFull(p.name, rooms))
      ? 'full'
      : stock.every((p) => showsInFull(shortStockName(p.name)!, rooms))
        ? 'short'
        : 'number'
    lastStock = { presets, rooms, form }
  }
  return lastStock.form
}
