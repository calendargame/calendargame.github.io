// @vitest-environment jsdom
//
// presetSwitcher.dom — THE PRESET SWITCHER CONTROL (components/PresetSwitcher).
//
// ★ WHAT THIS FILE IS FOR, and what it deliberately leaves to its neighbours. It covers the control
// ITSELF: that it reads the registry, that picking an option is a real switch, and that the two
// things this control does differently from the mode selector are actually there — what it says of
// an amnesic preset, and the name cell that does not size itself to its longest option. It does NOT re-test CustomSelect's popover behaviour
// (tests/customselect owns that) and it does NOT re-test what a switch does to saved data
// (tests/presets.dom and tests/presetSwitch.dom own that, the second one with a real <App/>
// mounted, which is the only place the remount hazard is visible at all).
//
// ⚠⚠ WHAT NO CASE IN HERE CAN PROVE — SAY IT OUT LOUD RATHER THAN IMPLY OTHERWISE. jsdom has no
// layout engine: it does not lay out flex boxes, it does not resolve `em`, it does not truncate
// text and it cannot report a width. So every geometric claim this control makes — that the trigger
// fits the space the wordmark vacates, that a long name truncates with an ellipsis instead of
// pushing the bar wider — is UNVERIFIED HERE and can only be confirmed on the owner's iPhone. What these cases pin is the STRUCTURE those results depend
// on: that every option's name cell carries the same fixed width, that the width is the exported
// constant rather than a literal somebody can drift, and that the name (not the cell) carries
// `truncate`. If a future edit breaks the geometry it will
// almost certainly break one of those first, which is the most a jsdom suite can honestly offer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import PresetSwitcher, { PRESET_NAME_COL } from '../src/components/PresetSwitcher.jsx'
import { usePresets, makePresetRegistryDefaults } from '../src/store/presets.js'
import {
  PRESET_NAME_CELL_SELECTOR,
  refreshNameRooms,
  useNameRooms,
} from '../src/lib/presetNameWidth.js'
import { NAME_DRAWN_UNITS } from '../src/lib/presetNameText.js'
import { createPreset, renamePreset, setPresetAmnesic } from '../src/store/presetControl.js'
import { installNameRooms, PX_PER_CHARACTER } from './helpers/nameRooms.js'

// A device that has never been played on and has never seen presets: nothing saved, one preset.
// (The same shape tests/presets.dom starts from — setState MERGES, so applyRegistry survives it.)
const resetRegistry = () =>
  act(() => {
    usePresets.setState(makePresetRegistryDefaults())
  })

// Every case mounts through this. wrapperRef is a REQUIRED prop (components/PresetSwitcher argues
// why it may not be optional: it is what feeds the ⚙ click-outside exclusion in src/main.tsx, and a
// call site that could silently omit it is the bug the requirement exists to prevent), so the
// fixture supplies one the way App does rather than fifteen copies of a literal. Nothing in this
// file reads it back — the ref's effect is App's, and tests/topBar.dom is where it is pinned.
const mount = () => render(<PresetSwitcher wrapperRef={createRef()} />)

const trigger = () => screen.getByRole('button', { name: /^Preset,/ })
const options = () => screen.getAllByRole('option')
const openMenu = () => fireEvent.click(trigger())
const activeId = () => usePresets.getState().activeId

// What the trigger is SHOWING. CustomSelect stacks every option's label in one grid cell and hides
// all but the selected one with `invisible`, so the visible label is the one span without it.
// ⚠ This reads a class as a visibility signal because jsdom paints nothing; it is the same fact the
// component states, not an independent measurement of it.
const triggerLabel = () => {
  const cells = [...trigger().querySelectorAll(':scope > span > span')]
  return cells.find((c) => !c.className.includes('invisible'))?.textContent
}

// CustomSelect wraps whatever `label` a caller passed in a span of its own. In an option ROW that
// wrapper is the second child (the first is the row's reserved ✓ column, which carries a width
// style of its own — hence the positional read rather than a `[style]` query); in the TRIGGER every
// option gets one stacked in the same grid cell. `nameCell` then steps into the wrapper to reach
// this control's own fixed-width cell, the element the whole "must not size itself to its longest
// option" rule hangs off.
const optionWrapper = (opt) => opt.children[1]
// The rows of the hidden copy of the list CustomSelect keeps laid out while it is closed (its row
// gauge) — the same row structure as an option, so optionWrapper reads them too.
const gaugeRows = () => [...document.querySelector('[data-select-row-gauge]').children]
const triggerWrappers = () => [...trigger().querySelectorAll(':scope > span > span')]
const nameCell = (wrapper) => wrapper.firstElementChild

beforeEach(() => {
  localStorage.clear()
  resetRegistry()
  const root = document.createElement('div')
  root.id = 'root' // CustomSelect portals its panel here
  document.body.appendChild(root)
})

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  localStorage.clear()
  resetRegistry()
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the preset switcher reads the registry', () => {
  it('lists every preset in the registry order and shows the active one', () => {
    act(() => {
      createPreset('Timed')
      createPreset('Guest')
    })
    mount()
    expect(triggerLabel()).toBe('Preset 1') // the default registry's only preset, and the active one
    openMenu()
    // ORDER IS THE ARRAY ORDER (store/presets rejected a separate `order` field on sight), so the
    // menu must read back in creation order and nothing here may sort it.
    expect(options().map((o) => o.textContent.replace('✓', '').trim())).toEqual([
      'Preset 1',
      'Timed',
      'Guest',
    ])
  })

  it('follows a rename and a new preset without being told', () => {
    mount()
    act(() => {
      renamePreset(1, 'Mornings')
    })
    expect(triggerLabel()).toBe('Mornings')
    act(() => {
      createPreset('Timed')
    })
    openMenu()
    expect(options()).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('choosing an option switches preset', () => {
  it('moves the active preset, and the trigger follows', () => {
    let p2
    act(() => {
      p2 = createPreset('Timed')
    })
    mount()
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: /Timed/ }))
    expect(activeId()).toBe(p2.id)
    expect(triggerLabel()).toBe('Timed')
    // The menu closed on the choice — CustomSelect's behaviour, restated here because a switcher
    // that switched but stayed open would be a different bug with the same passing store test.
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('re-choosing the preset you are already on is a no-op, and still closes the menu', () => {
    act(() => {
      createPreset('Timed')
    })
    mount()
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: /Preset 1/ }))
    // switchPreset returns false for the active id and does nothing at all — no registry write, no
    // rehydration, and (up in src/main.tsx) no screen remount. The control does not guard this
    // itself, so this case is what says the guard downstream is really there.
    expect(activeId()).toBe(1)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('an amnesic preset in the list: nothing drawn, and a word spoken', () => {
  const guestOn = (mode) =>
    act(() => {
      const p = createPreset('Guest')
      setPresetAmnesic(p.id, mode)
    })

  // ★ THE LETTER IS GONE. A preset's row used to carry an "A" after its name, in a column of its
  // own that every amnesic preset's name had to give room to. What is temporary is marked on the
  // page now (the dashed outline — tests/sessionOnlyOutline.dom), so a row is its name and nothing
  // else, whatever the preset's Amnesic value.
  for (const mode of ['off', 'stats', 'full'])
    it(`${mode}: the row DRAWS the name and nothing beside it — no letter, no marker column`, () => {
      guestOn(mode)
      mount()
      openMenu()
      const row = screen.getByRole('option', { name: /Guest/ })
      const cell = row.querySelector('[data-preset-name-cell]')
      // Everything in the cell a sighted player can see is the one name element.
      const drawn = [...cell.children].filter((el) => !el.className.includes('sr-only'))
      expect(drawn).toHaveLength(1)
      expect(drawn[0].textContent).toBe('Guest')
      expect(drawn[0].className).toContain('truncate') // …and it has the whole cell to truncate in
      expect(within(row).queryByText('A')).toBeNull()
      expect(row.querySelector('.ml-auto')).toBeNull() // the marker's right-aligned slot is gone
    })

  // ★ THE ACCESSIBLE NAME IS THE POINT, and a screen-reader user has to be able to tell the two
  // kinds apart: ", amnesic" is kept as it has always been said, and Stats Only adds what it is.
  it('speaks ", amnesic" for Full and ", amnesic, stats only" for Stats Only — and nothing for Off', () => {
    act(() => {
      setPresetAmnesic(createPreset('Guest').id, 'full')
      setPresetAmnesic(createPreset('Practice').id, 'stats')
      createPreset('Timed')
    })
    mount()
    openMenu()
    expect(screen.getByRole('option', { name: 'Guest, amnesic' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Practice, amnesic, stats only' })).toBeTruthy()
    const plain = screen.getByRole('option', { name: 'Timed' })
    expect(plain.textContent).not.toContain('amnesic')
    // Exactly those two rows say it.
    expect(screen.getAllByRole('option', { name: /amnesic/ })).toHaveLength(2)
  })

  it('says the name and the words as ONE phrase — nothing for a screen reader to join', () => {
    // A name assembled from two elements is joined differently by different engines: Chromium put
    // a space between the name and a ", amnesic" tail ("Guest , amnesic"), and a join that trims
    // each piece runs them together ("Guestamnesic"). So one sr-only element holds the whole
    // phrase — in ONE text node — and the visible name beside it is hidden from a screen reader
    // instead of being said twice.
    for (const [mode, phrase] of [
      ['full', 'Guest, amnesic'],
      ['stats', 'Guest, amnesic, stats only'],
    ]) {
      resetRegistry()
      guestOn(mode)
      const view = mount()
      openMenu()
      const row = screen.getByRole('option', { name: phrase })
      const spoken = within(row).getByText(phrase)
      expect(spoken.className).toContain('sr-only')
      expect(spoken.childNodes).toHaveLength(1)
      expect(within(row).getByText('Guest').getAttribute('aria-hidden')).toBe('true')
      view.unmount()
    }
    // A preset that is not amnesic has nothing hidden and nothing added: its name is its text.
    resetRegistry()
    mount()
    openMenu()
    const plain = screen.getByRole('option', { name: /Preset 1/ })
    expect(within(plain).getByText('Preset 1').getAttribute('aria-hidden')).toBeNull()
  })

  it('reaches the trigger too when the preset you are ON is amnesic — its name, never a drawn mark', () => {
    act(() => {
      setPresetAmnesic(1, 'stats')
    })
    mount()
    // The same label element serves the trigger and the rows. The trigger used to wear an
    // aria-label that replaced its content — announcing "Preset" and dropping the preset, the
    // "amnesic" and everything else; its name is composed from the setting plus the selected
    // option's own text (components/CustomSelect), so this is the phrase arriving through it.
    expect(screen.getByRole('button', { name: 'Preset, Preset 1, amnesic, stats only' })).toBe(
      trigger(),
    )
    act(() => {
      setPresetAmnesic(1, 'full')
    })
    expect(screen.getByRole('button', { name: 'Preset, Preset 1, amnesic' })).toBe(trigger())
    // …and with it back on Off the trigger is the plain name again, live.
    act(() => {
      setPresetAmnesic(1, 'off')
    })
    expect(screen.getByRole('button', { name: 'Preset, Preset 1' })).toBe(trigger())
    expect(triggerLabel()).toBe('Preset 1')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the control must not size itself to its longest option', () => {
  it('floors the name cell in the TRIGGER, and never in a list row', () => {
    // Round 20: the cell used to be exactly PRESET_NAME_COL wide (a `width` style); now it is
    // AT LEAST that wide (a `minWidth` style), and the actual width — how much wider — is jsdom's
    // to not know, since it has no layout engine (main.tsx's budget block and
    // components/PresetSwitcher's own comments are where that arithmetic lives now). What this
    // environment CAN still pin: `width` is gone (the mechanism that made the cell rigid), and
    // `minWidth` is the exported constant on every one of the trigger's stacked cells.
    // ★ AND NOT IN A LIST ROW — the open list's, or the hidden gauge's that stands in for it while
    // it is closed. A row is exactly as wide as the trigger and its label cell already fills it, so
    // a floor there holds nothing open; in a row with less room than the floor it would push the
    // name past the row's edge, and the gauge would report room the row does not have — whether a
    // name is cut is read from that cell.
    act(() => {
      createPreset('W'.repeat(60)) // far wider than any cell
      createPreset('Hi')
    })
    mount()
    openMenu()
    const inTrigger = triggerWrappers().map(nameCell)
    const inList = options().map(optionWrapper).map(nameCell)
    const inGauge = gaugeRows().map(optionWrapper).map(nameCell)
    expect(inTrigger).toHaveLength(3) // 3 presets, each rendered once in the stack…
    expect(inList).toHaveLength(3) // …once in the menu…
    expect(inGauge).toHaveLength(3) // …and once in the menu's hidden gauge
    for (const cell of [...inTrigger, ...inList, ...inGauge]) expect(cell.style.width).toBe('')
    for (const cell of inTrigger) expect(cell.style.minWidth).toBe(PRESET_NAME_COL)
    for (const cell of [...inList, ...inGauge]) expect(cell.style.minWidth).toBe('')
  })

  it('marks every cell with the DOM hook lib/presetNameWidth reads across the component boundary', () => {
    // data-preset-name-cell is what lib/presetNameWidth's PRESET_NAME_CELL_SELECTOR and its
    // readNameRooms agree on — proven here against the REAL rendered
    // control, not a hand-built stand-in (tests/presetNameWidth.dom owns the fabricated-DOM cases
    // for the measurement itself). EVERY place this control draws a name is found by it: the
    // trigger's stacked cells, and the rows of the list — which are there to be measured while the
    // list is CLOSED (the hidden gauge), the state it is in whenever a name is being typed.
    act(() => {
      createPreset('Timed')
    })
    mount()
    const closed = [...document.querySelectorAll(PRESET_NAME_CELL_SELECTOR)]
    expect(closed).toEqual([
      ...triggerWrappers().map(nameCell),
      ...gaugeRows().map(optionWrapper).map(nameCell),
    ])
    expect(closed).toHaveLength(4) // 2 presets × (the trigger + a row of the closed list)
    // Open, the list's real rows are found as well.
    openMenu()
    const found = [...document.querySelectorAll(PRESET_NAME_CELL_SELECTOR)]
    for (const cell of options().map(optionWrapper).map(nameCell)) expect(found).toContain(cell)
    expect(found).toHaveLength(6)
  })

  it('every name cell hands itself to the room watcher as it mounts, and takes itself back out', async () => {
    // Nothing here asks for a reading: the cells arriving is what causes one, and the cells going
    // is what causes the next. (jsdom gives no element a width, so the cells are given one.)
    const element = window.Element.prototype
    const original = element.getBoundingClientRect
    element.getBoundingClientRect = function () {
      return this.matches(PRESET_NAME_CELL_SELECTOR) ? { width: 77 } : original.call(this)
    }
    let rooms = null
    function Reader() {
      rooms = useNameRooms()
      return null
    }
    try {
      render(<Reader />)
      expect(rooms).toEqual([])
      const switcher = mount()
      await act(() => Promise.resolve()) // the read a mounting cell queues behind its render
      expect(rooms.map((room) => room.widthPx)).toEqual([77])
      switcher.unmount()
      await act(() => Promise.resolve())
      expect(rooms).toEqual([])
    } finally {
      element.getBoundingClientRect = original
      act(() => refreshNameRooms())
    }
  })

  it('puts `truncate` on the NAME rather than on the cell', () => {
    // A flex container's own text-overflow never fires — the ellipsis rule applies to a block box's
    // inline content, and this cell's children are flex items. On the cell it would clip with no
    // "…"; on the name it shortens properly. jsdom cannot show either, so the class is the evidence.
    act(() => {
      createPreset('Timed')
    })
    mount()
    openMenu()
    for (const opt of options()) {
      const cell = nameCell(optionWrapper(opt))
      expect(cell.className).not.toContain('truncate')
      expect(cell.firstElementChild.className).toContain('truncate')
    }
  })

  it('a name of any length is drawn on one line, in full up to what a slot could ever show', () => {
    // Nothing limits a name (store/presets), so the control has to cope with any: the text it is
    // handed is the WHOLE name for anything a slot could show — the ellipsis is CSS's, on the
    // `truncate` span — and the same in the trigger, the list, and the hidden gauge.
    const name = 'A name much longer than the control: ' + 'x'.repeat(200)
    act(() => {
      createPreset(name)
    })
    mount()
    openMenu()
    const drawn = [
      ...triggerWrappers(),
      ...options().map(optionWrapper),
      ...gaugeRows().map(optionWrapper),
    ]
      .map(nameCell)
      .map((cell) => cell.firstElementChild.textContent)
      .filter((text) => text !== 'Preset 1')
    expect(drawn).toEqual([name, name, name])
  })

  it('a pasted book is drawn as its start and an ellipsis — never handed to the page whole', () => {
    // A browser has to shape every character of a line before it can clip it, in every cell that
    // draws it; a book in each would stall every frame (lib/presetNameText).
    const book = 'All work and no play. '.repeat(50_000) // 1,100,000 characters
    act(() => {
      createPreset(book)
    })
    expect(usePresets.getState().presets[1].name).toBe(book.trim()) // stored whole
    mount()
    openMenu()
    const cells = document.querySelectorAll(PRESET_NAME_CELL_SELECTOR)
    expect(cells).toHaveLength(6)
    for (const cell of cells)
      expect(cell.textContent.length).toBeLessThanOrEqual(NAME_DRAWN_UNITS + 1)
    const shown = nameCell(optionWrapper(options()[1])).textContent
    expect(shown.endsWith('…')).toBe(true)
    expect(book.startsWith(shown.slice(0, -1))).toBe(true)
    // …and nowhere else on the page either: the accessible names come from the same text.
    expect(document.body.textContent).not.toContain(book.slice(0, NAME_DRAWN_UNITS + 2))
  })

  it('an amnesic preset with a very long name is spoken from the same bounded text', () => {
    const book = 'All work and no play. '.repeat(50_000)
    let preset
    act(() => {
      preset = createPreset(book)
      setPresetAmnesic(preset.id, 'full')
    })
    mount()
    openMenu()
    const spoken = options()[1].querySelector('.sr-only').textContent
    expect(spoken.endsWith('…, amnesic')).toBe(true)
    expect(spoken.length).toBeLessThanOrEqual(NAME_DRAWN_UNITS + 1 + ', amnesic'.length)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The owner's rule: where a default name ("Preset 1") would be cut short it is drawn "P1", and it
// is "Preset 1" again the moment there is room. Drawn only — nothing stored changes. jsdom has no
// widths, so the name cells are given one (tests/helpers/nameRooms): text is 5px a character.
describe('a stock name that would be cut is drawn short', () => {
  let cells = null
  const layOut = (characters) => {
    cells = installNameRooms(characters * PX_PER_CHARACTER)
  }
  afterEach(() => {
    cells?.restore()
    cells = null
  })
  // What each place DRAWS (the text a screen reader is not given instead), in registry order.
  const drawnIn = (wrappers) => wrappers.map((w) => nameCell(w).firstElementChild.textContent)
  const everywhere = () => ({
    button: drawnIn(triggerWrappers()),
    list: drawnIn(options().map(optionWrapper)),
    gauge: drawnIn(gaugeRows().map(optionWrapper)),
  })
  const allThree = (names) => ({ button: names, list: names, gauge: names })
  const storedNames = () =>
    JSON.parse(localStorage.getItem('cg-presets-v1')).state.presets.map((p) => p.name)

  it('with room for the names, they are drawn in full', () => {
    act(() => {
      createPreset()
    })
    mount()
    openMenu()
    layOut(8) // "Preset 1" exactly
    expect(everywhere()).toEqual(allThree(['Preset 1', 'Preset 2']))
  })

  it('one character short of the room, EVERY stock name is short in EVERY place', () => {
    act(() => {
      createPreset()
      createPreset('Weekend')
    })
    mount()
    openMenu()
    layOut(7)
    // The button, the open list, and the hidden copy of the list all agree; a name that is not a
    // stock name is left as it is (and shortened by the ellipsis where it has to be).
    expect(everywhere()).toEqual(allThree(['P1', 'P2', 'Weekend']))
    // Nothing stored was touched.
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual([
      'Preset 1',
      'Preset 2',
      'Weekend',
    ])
    expect(storedNames()).toEqual(['Preset 1', 'Preset 2', 'Weekend'])
  })

  it('all or none: one stock name that does not fit shortens the ones that would have', () => {
    // "Preset 10" is nine characters; "Preset 1" is eight and fits — and a list that read
    // "Preset 1" above "P10" would be two spellings of one thing.
    act(() => {
      createPreset()
      renamePreset(2, 'Preset 10')
    })
    mount()
    openMenu()
    layOut(8)
    expect(everywhere()).toEqual(allThree(['P1', 'P10']))
    cells.resize(9 * PX_PER_CHARACTER)
    expect(everywhere()).toEqual(allThree(['Preset 1', 'Preset 10']))
  })

  it('follows the room both ways, as often as it changes, with nothing remembered', () => {
    mount()
    openMenu()
    layOut(7)
    expect(everywhere()).toEqual(allThree(['P1']))
    for (let turn = 0; turn < 3; turn++) {
      cells.resize(8 * PX_PER_CHARACTER) // a wider screen: the full name is back by itself
      expect(everywhere()).toEqual(allThree(['Preset 1']))
      cells.resize(7 * PX_PER_CHARACTER)
      expect(everywhere()).toEqual(allThree(['P1']))
    }
  })

  it('is decided from the FULL names, so drawing the short ones cannot change the answer', () => {
    // Were it decided from what is on screen, "P1" would fit, the full name would come back, would
    // not fit, and so on for ever. A second reading of the same rooms changes nothing.
    mount()
    openMenu()
    layOut(7)
    expect(everywhere()).toEqual(allThree(['P1']))
    cells.resize(7 * PX_PER_CHARACTER)
    cells.resize(7 * PX_PER_CHARACTER)
    expect(everywhere()).toEqual(allThree(['P1']))
  })

  it('a name the player typed that reads like a default is a stock name; anything else is not', () => {
    act(() => {
      renamePreset(1, 'Preset 42')
      createPreset('Preset 042')
      createPreset('preset 4')
      createPreset('Presets 5')
      createPreset('My Preset 6')
      createPreset('Preset 7b')
      createPreset('Preset')
    })
    mount()
    openMenu()
    layOut(3)
    expect(everywhere().list).toEqual([
      'P42',
      'Preset 042',
      'preset 4',
      'Presets 5',
      'My Preset 6',
      'Preset 7b',
      'Preset',
    ])
  })

  it('a screen reader still hears the stored name — the short form is not read', () => {
    act(() => {
      setPresetAmnesic(createPreset().id, 'full')
    })
    mount()
    openMenu()
    layOut(7)
    // The option's name is the sr-only text; the drawn "P1" is hidden from a screen reader.
    const [first, second] = options()
    expect(nameCell(optionWrapper(first)).firstElementChild.getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(first.querySelector('.sr-only').textContent).toBe('Preset 1')
    expect(second.querySelector('.sr-only').textContent).toBe('Preset 2, amnesic')
    // (The row you are on has its ✓ in front of its name.)
    expect(screen.getByRole('option', { name: /^✓ ?Preset 1$/ })).toBe(first)
    expect(screen.getByRole('option', { name: 'Preset 2, amnesic' })).toBe(second)
    // …and the closed control says where you are in the same words.
    expect(screen.getByRole('button', { name: 'Preset, Preset 1' })).toBe(trigger())
    // With room, nothing is hidden and nothing is added: the name is simply the text.
    cells.resize(8 * PX_PER_CHARACTER)
    expect(
      nameCell(optionWrapper(options()[0])).firstElementChild.hasAttribute('aria-hidden'),
    ).toBe(false)
    expect(options()[0].querySelector('.sr-only')).toBeNull()
  })

  it('"P1" typed as a name beside a stock "Preset 1" drawn short: two rows read alike, as two "Weekend"s do', () => {
    act(() => {
      createPreset('P1')
    })
    mount()
    openMenu()
    layOut(7)
    expect(everywhere().list).toEqual(['P1', 'P1'])
    // They are still two presets, told apart by a screen reader and chosen separately.
    expect(options().map((o) => o.querySelector('.sr-only')?.textContent ?? null)).toEqual([
      'Preset 1',
      null,
    ])
    fireEvent.click(options()[1])
    expect(activeId()).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('it is the mode selector, gesture and keyboard included', () => {
  it('carries the press-drag marker the pointer controller keys off', () => {
    mount()
    // ★ THE OWNER'S HARD REQUIREMENT. `pressDrag` is what puts data-select-trigger on the trigger
    // and pairs it (via aria-controls, once open) with the portaled listbox, so a press can drag
    // straight into the menu and release on an option. Losing this attribute is losing the gesture
    // — and the gesture is the part of the site he singled out as the most convenient.
    expect(trigger().hasAttribute('data-select-trigger')).toBe(true)
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox')
  })

  it('opens on POINTERDOWN, not only on click — the press half of the press-drag', () => {
    act(() => {
      createPreset('Timed')
    })
    mount()
    fireEvent.pointerDown(trigger(), { isPrimary: true, pointerType: 'touch' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(options()).toHaveLength(2)
  })

  it('navigates and selects from the keyboard exactly as the mode selector does', () => {
    let p2
    act(() => {
      p2 = createPreset('Timed')
    })
    mount()
    openMenu()
    // The first ArrowDown steps ONE option from the selected one (owner's call, 2026-06-06), then
    // Enter takes it. Same component, same rules — this case exists so a future "improvement" to
    // one control cannot silently diverge the two.
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(activeId()).toBe(p2.id)
  })

  it('Escape closes without switching, and returns focus to the trigger', () => {
    act(() => {
      createPreset('Timed')
    })
    mount()
    openMenu()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(activeId()).toBe(1)
    expect(document.activeElement).toBe(trigger())
  })
})
