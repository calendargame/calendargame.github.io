// tests/helpers/nameRooms — THE LAYOUT jsdom DOES NOT HAVE, for the cases about a preset name being
// too long for where it is shown (lib/presetNameWidth).
//
// jsdom lays nothing out and draws nothing: every element is 0 wide and a canvas measures nothing,
// so in a plain test no name is ever "cut". This gives the REAL app, mounted as it is, the two
// facts the real code asks a browser for:
//   • every cell a preset name is drawn in (`[data-preset-name-cell]`) is `widthPx` wide — one room;
//   • text is PX_PER_CHARACTER wide per character (an emoji is one character), in any font.
// So a name of up to widthPx / PX_PER_CHARACTER characters fits, and the next one does not. Nothing
// of the app is mocked: the cells, the reading of them, and the decision are the real ones.
import { act } from '@testing-library/react'
import { refreshNameRooms } from '../../src/lib/presetNameWidth.js'

export const PX_PER_CHARACTER = 5

/**
 * Lay the name cells out `widthPx` wide. Returns `resize(widthPx)` — the cells change width, as on a
 * rotation — and `restore()`, which every case that installs this must call (afterEach).
 */
export function installNameRooms(widthPx) {
  let width = widthPx
  const canvas = window.HTMLCanvasElement.prototype
  const getContext = canvas.getContext
  canvas.getContext = () => ({
    font: '',
    measureText: (text) => ({ width: [...text].length * PX_PER_CHARACTER }),
  })
  const element = window.Element.prototype
  const getBoundingClientRect = element.getBoundingClientRect
  element.getBoundingClientRect = function () {
    const rect = getBoundingClientRect.call(this)
    return this.matches('[data-preset-name-cell]') ? { ...rect, width } : rect
  }
  const read = () => act(() => refreshNameRooms())
  read()
  return {
    resize(next) {
      width = next
      read()
    },
    restore() {
      canvas.getContext = getContext
      element.getBoundingClientRect = getBoundingClientRect
      read() // back to "nothing can be measured", for the next case
    },
  }
}
