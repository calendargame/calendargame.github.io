// @vitest-environment jsdom
//
// presetSwitcher.dom — THE PRESET SWITCHER CONTROL (components/PresetSwitcher).
//
// ★ WHAT THIS FILE IS FOR, and what it deliberately leaves to its neighbours. It covers the control
// ITSELF: that it reads the registry, that picking an option is a real switch, and that the two
// things this control does differently from the mode selector are actually there — the amnesic
// marker and the fixed-width name cell. It does NOT re-test CustomSelect's popover behaviour
// (tests/customselect owns that) and it does NOT re-test what a switch does to saved data
// (tests/presets.dom and tests/presetSwitch.dom own that, the second one with a real <App/>
// mounted, which is the only place the remount hazard is visible at all).
//
// ⚠⚠ WHAT NO CASE IN HERE CAN PROVE — SAY IT OUT LOUD RATHER THAN IMPLY OTHERWISE. jsdom has no
// layout engine: it does not lay out flex boxes, it does not resolve `em`, it does not truncate
// text and it cannot report a width. So every geometric claim this control makes — that the trigger
// fits the space the wordmark vacates, that a long name truncates with an ellipsis instead of
// pushing the bar wider, that the "A" markers line up as a column — is UNVERIFIED HERE and can only
// be confirmed on the owner's iPhone. What these cases pin is the STRUCTURE those results depend
// on: that every option's name cell carries the same fixed width, that the width is the exported
// constant rather than a literal somebody can drift, that the name (not the cell) carries
// `truncate`, and that the marker carries `ml-auto`. If a future edit breaks the geometry it will
// almost certainly break one of those first, which is the most a jsdom suite can honestly offer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import PresetSwitcher, { PRESET_NAME_COL } from '../src/components/PresetSwitcher.jsx'
import { usePresets, makePresetRegistryDefaults, MAX_PRESET_NAME } from '../src/store/presets.js'
import { createPreset, renamePreset, setPresetAmnesic } from '../src/store/presetControl.js'

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
describe('the amnesic marker', () => {
  it('marks only the amnesic presets, and marks them with a WORD, not a bare letter', () => {
    let p2
    act(() => {
      p2 = createPreset('Guest')
      setPresetAmnesic(p2.id, true)
    })
    mount()
    openMenu()
    // ★ THE ACCESSIBLE NAME IS THE POINT. A bare "A" is a glyph a screen reader reads as the
    // indefinite article; the row has to NAME the state. Exactly one row does.
    const marked = screen.getAllByRole('option', { name: /amnesic/ })
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent).toContain('Guest')
    // …and the visible letter is hidden FROM that name, so the word is not announced twice.
    const letter = within(marked[0]).getByText('A')
    expect(letter.getAttribute('aria-hidden')).toBe('true')
    // The other preset carries neither.
    const plain = screen.getByRole('option', { name: /Preset 1/ })
    expect(plain.textContent).not.toContain('amnesic')
    expect(within(plain).queryByText('A')).toBeNull()
  })

  it('carries a PRINTING separator, so the name cannot run into the preset name', () => {
    // The name-from-content algorithm trims each child's text before joining, so a leading space is
    // dropped: ", amnesic" is what survives the join, " amnesic" is not. The ⚙ footer's changelog
    // dot learned this the hard way ("Changelog(update)").
    act(() => {
      const p = createPreset('Guest')
      setPresetAmnesic(p.id, true)
    })
    mount()
    openMenu()
    expect(screen.getByRole('option', { name: /Guest, amnesic/ })).toBeTruthy()
  })

  it('is aligned to the right of the name cell, and never gives way before the name does', () => {
    // ⚠ CLASSES, NOT GEOMETRY — jsdom lays out nothing. ml-auto is what eats the cell's leftover
    // space (so every marker sits on the same edge and they read as a column); shrink-0 is what
    // makes the NAME the thing that truncates when a name is too long, never the marker.
    act(() => {
      const p = createPreset('Guest')
      setPresetAmnesic(p.id, true)
    })
    mount()
    openMenu()
    const letter = within(screen.getByRole('option', { name: /amnesic/ })).getByText('A')
    expect(letter.className).toContain('ml-auto')
    expect(letter.className).toContain('shrink-0')
    // No colour token on it: the dropdown panel hardcodes a dark text colour on a light frosted
    // ground in every theme, while the trigger wears the theme's own. A themed class here would be
    // invisible on the panel in the three dark themes, so the dim is opacity and the glyph inherits.
    expect(letter.className).not.toMatch(/text-\(/)
    expect(letter.className).toContain('opacity-70')
  })

  it('appears in the trigger too when the preset you are ON is amnesic', () => {
    act(() => {
      setPresetAmnesic(1, true)
    })
    mount()
    // Same label element serves the trigger and the rows, so the bar shows the state at a glance.
    expect(triggerLabel()).toContain('amnesic')
    // …and it reaches the trigger's ACCESSIBLE NAME, which is the half that matters here: the
    // marker's whole requirement is that it be a word a screen reader says, and the trigger used to
    // wear an aria-label that replaced its content — announcing "Preset" and dropping the preset,
    // the ", amnesic" and everything else. The name is composed from the setting plus the selected
    // option's own text (components/CustomSelect), so this is the marker arriving through it.
    expect(screen.getByRole('button', { name: 'Preset, Preset 1, amnesic' })).toBe(trigger())
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the control must not size itself to its longest option', () => {
  it('gives every option the SAME fixed-width name cell, short name or long', () => {
    act(() => {
      createPreset('W'.repeat(MAX_PRESET_NAME)) // the widest name the store will accept
      createPreset('Hi')
    })
    mount()
    openMenu()
    // Every row, and every one of the trigger's stacked cells, is exactly PRESET_NAME_COL wide.
    // That is the whole mechanism: the trigger's shrink-to-fit width is then the same number
    // whatever the names are, so a player-typed name can never widen the top bar.
    const cells = [...options().map(optionWrapper), ...triggerWrappers()].map(nameCell)
    expect(cells).toHaveLength(6) // 3 presets, each rendered once in the menu and once in the stack
    for (const cell of cells) expect(cell.style.width).toBe(PRESET_NAME_COL)
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

  it('the store caps what can be typed, so the ellipsis stays a safety net', () => {
    // The two halves of one measurement: MAX_PRESET_NAME bounds CHARACTERS, PRESET_NAME_COL bounds
    // PIXELS. A character cap cannot bound pixels in a proportional font, which is why both exist —
    // and this is the case that fails if the cap is ever raised past what the cell was sized for.
    let p2
    act(() => {
      p2 = createPreset('x'.repeat(80))
    })
    expect(p2.name).toHaveLength(MAX_PRESET_NAME)
    mount()
    openMenu()
    for (const opt of options())
      expect(nameCell(optionWrapper(opt)).textContent.length).toBeLessThanOrEqual(MAX_PRESET_NAME)
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
