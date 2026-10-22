// @vitest-environment jsdom
//
// presetNameInk.dom — the second half of the one judge of an empty preset name (store/presets'
// normalizePresetName): a name the Unicode rule calls visible is DRAWN, in the page's font, and a
// name that puts no pixel on the canvas is empty (lib/presetNameInk).
//
// jsdom has no canvas (tests/setup/dom.js makes its getContext answer null), so the app's own
// answer here is the Unicode rule alone — the first case proves that. The rest hand the module a
// canvas that "draws" by a rule this file chooses (BLANK characters, spaces, and what Unicode calls
// invisible draw nothing; everything else draws something), which is what lets the WIRING be
// proved: every door a name comes in by asks the same judge, the device's answer wins over the
// rule's only where the device can give one, and a font that is not ready means no answer. What a
// real device draws is the browser lane's (tests/browser/presetNames.browser.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The characters the fake canvas draws as nothing, beyond spaces and what Unicode calls invisible:
// the object replacement character and the interlinear annotation marks, which no table does.
const BLANK = /^[\s\u200B\u2800\u3164\uFFFC\uFFF9-\uFFFB]*$/u
const OBJECT = '\uFFFC'

// Every text the fake canvas was asked to draw, in order — and those that were NAMES, leaving out the
// calibration (lib/presetNameInk's canvasIsTrue: a known letter and a space, drawn once per font
// before the canvas is believed).
let drawn
const CALIBRATION = ['H', ' ']
const named = () => drawn.filter((text) => !CALIBRATION.includes(text))
// How the fake canvas reads back: 'true' (what was drawn), 'noise' (every pixel faintly inked, as a
// fingerprinting defence may make it), or 'blank' (nothing, whatever was drawn).
let readback
// What document.fonts.check answers.
let fontReady

// A 2D context that "draws" by this file's rule, for a canvas of the size it is given.
function fakeContext(canvas) {
  let ink = false
  return {
    canvas,
    font: '',
    fillStyle: '',
    measureText: (text) => ({
      width: 10 * text.length,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 10 * text.length,
      actualBoundingBoxAscent: 20,
      actualBoundingBoxDescent: 5,
    }),
    fillText(text) {
      drawn.push(text)
      ink = !BLANK.test(text)
    },
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4)
      if (readback === 'noise') data.fill(1)
      else if (readback === 'true' && ink) data[data.length - 1] = 1 // one faint pixel is enough
      return { data }
    },
  }
}

// A fresh copy of the stores and of lib/presetNameInk (which keeps its canvas and its last answer
// for the life of the module), with or without the fake canvas.
async function load({ canvas = true } = {}) {
  vi.resetModules()
  if (canvas)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return fakeContext(this)
    })
  localStorage.clear()
  const presets = await import('../src/store/presets.js')
  const control = await import('../src/store/presetControl.js')
  return { ...presets, ...control }
}

beforeEach(() => {
  drawn = []
  readback = 'true'
  fontReady = true
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { check: () => fontReady },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete document.fonts
})

describe('a name that draws nothing is an empty name', () => {
  it('with no canvas (this suite, and Node), the Unicode rule alone answers, and such a name is kept', async () => {
    const { normalizePresetName } = await load({ canvas: false })
    expect(document.createElement('canvas').getContext('2d')).toBeNull()
    expect(normalizePresetName(OBJECT, 3)).toBe(OBJECT)
    // …and what Unicode itself says draws nothing is empty, canvas or not.
    expect(normalizePresetName('\u2800\u3164', 3)).toBe('Preset 3')
  })

  it('a name the device draws as nothing is empty at every door: a rename, a new preset, the note, and a stored list', async () => {
    const { normalizePresetName, normalizeRegistry, renamePreset, createPreset, activePreset } =
      await load()
    for (const name of [OBJECT, '\uFFFC\uFFF9\uFFFA\uFFFB', ' \uFFFC\u200B\uFFFC ']) {
      expect(normalizePresetName(name, 3), name).toBe('Preset 3')
      renamePreset(1, 'Mornings')
      expect(renamePreset(1, name)).toBe('renamed')
      expect(activePreset().name).toBe('Mornings') // a blank rename keeps the name it had
      expect(normalizeRegistry({ presets: [{ id: 2, name }], activeId: 2 }).presets[0].name).toBe(
        'Preset 2',
      )
    }
    const made = createPreset(OBJECT)
    expect(made.name).toBe(`Preset ${made.id}`)
  })

  it('a name with anything the device draws is kept exactly — a character it has no picture for is drawn as a box, which is ink', async () => {
    const { normalizePresetName } = await load()
    // (The fake draws everything but BLANK, as a device draws its empty box for a character no
    // font has: so an unassigned code point here stands for exactly that.)
    for (const name of ['a\uFFFC', '\uFFFCb', '\u{E0000}\uFFFC\u{50000}', '\uFFFC\u2800x'])
      expect(normalizePresetName(name, 3), name).toBe(name)
  })

  it('the name is drawn as it is written, in order — a piece at a time, the first inked piece ending it', async () => {
    const { normalizePresetName } = await load()
    // A short name is one drawing of the whole of it, invisible characters and all: what a
    // character draws can depend on what stands next to it.
    normalizePresetName('\u200B \uFFFC\uFFFC\u2800\uFFFC', 3)
    expect(named()).toEqual(['\u200B \uFFFC\uFFFC\u2800\uFFFC'])
    // A book of one ordinary phrase, many times over: its first piece answers.
    drawn = []
    const book = 'practice '.repeat(100_000).trim()
    expect(normalizePresetName(book, 3)).toBe(book)
    expect(named()).toEqual([book.slice(0, 64)])
    // A book of one blank character: every piece is the same, so it is drawn once.
    drawn = []
    expect(normalizePresetName(OBJECT.repeat(6_400), 3)).toBe('Preset 3')
    expect(named()).toEqual([OBJECT.repeat(64)])
    // A piece with nothing in it that Unicode calls visible is not drawn at all; the ink at the
    // end of the name is still found.
    drawn = []
    const late = `${OBJECT}${' '.repeat(200)}z`
    expect(normalizePresetName(late, 3)).toBe(late)
    expect(named()).toEqual([`${OBJECT}${' '.repeat(63)}`, `${' '.repeat(9)}z`])
    // A piece never ends between an emoji's two units.
    drawn = []
    normalizePresetName(`${OBJECT.repeat(63)}\u{1F600}`, 3)
    expect(named()).toEqual([`${OBJECT.repeat(63)}\u{1F600}`])
  })

  it('a book of many different blank pieces is given up on — the name is kept, as where nothing can be drawn', async () => {
    const { normalizePresetName } = await load()
    const pieces = Array.from({ length: 40 }, (_, i) =>
      '\uFFFC'.repeat(i + 1).concat('\uFFF9'.repeat(63 - i)),
    )
    const name = pieces.join('')
    expect(normalizePresetName(name, 3)).toBe(name)
    expect(named()).toHaveLength(32)
  })

  it('a font that is not ready to draw gives no answer — the name is kept — and the next question asks again', async () => {
    const { normalizePresetName } = await load()
    fontReady = false
    expect(normalizePresetName(OBJECT, 3)).toBe(OBJECT)
    expect(named()).toEqual([])
    fontReady = true
    expect(normalizePresetName(OBJECT, 3)).toBe('Preset 3')
    expect(named()).toEqual([OBJECT])
  })

  // ★ A CANVAS THAT DOES NOT READ BACK WHAT WAS DRAWN (the Round 26 review): fingerprinting defences
  // change what a canvas reads back. Before it is believed, a letter must read as ink and a space as
  // none; where either reads wrong, no name is judged by it, and the Unicode rule alone answers.
  it('a canvas that reads noise everywhere is not believed: a name it would never call blank is judged by the Unicode rule', async () => {
    readback = 'noise'
    const { normalizePresetName } = await load()
    expect(normalizePresetName(OBJECT, 3)).toBe(OBJECT)
    expect(normalizePresetName('Mornings', 3)).toBe('Mornings')
    expect(normalizePresetName('⠀ㅤ', 3)).toBe('Preset 3') // (the Unicode rule's own blank)
    expect(named()).toEqual([]) // no name was drawn
  })
  it('a canvas that reads back nothing is not believed either: every custom name is kept', async () => {
    readback = 'blank'
    const { normalizePresetName, renamePreset, activePreset } = await load()
    expect(normalizePresetName('Mornings', 3)).toBe('Mornings')
    expect(renamePreset(1, 'Weekend')).toBe('renamed')
    expect(activePreset().name).toBe('Weekend')
    expect(named()).toEqual([])
  })
  it('a canvas that tells the truth is calibrated once, then believed for every name in that font', async () => {
    const { normalizePresetName } = await load()
    expect(normalizePresetName(OBJECT, 3)).toBe('Preset 3')
    expect(normalizePresetName('Mornings', 3)).toBe('Mornings')
    expect(drawn).toEqual([...CALIBRATION, OBJECT, 'Mornings'])
  })

  it('reading a stored name the device draws as nothing writes nothing', async () => {
    const { usePresets, activePreset } = await load()
    const saved = JSON.stringify({
      state: {
        presets: [{ id: 1, name: OBJECT, amnesic: false }],
        activeId: 1,
        nextId: 2,
        openInPreset: 'last',
      },
      version: 1,
    })
    localStorage.setItem('cg-presets-v1', saved)
    await usePresets.persist.rehydrate()
    expect(activePreset().name).toBe('Preset 1')
    expect(localStorage.getItem('cg-presets-v1')).toBe(saved)
  })
})
