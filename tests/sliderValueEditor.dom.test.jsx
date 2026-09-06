// @vitest-environment jsdom
//
// SliderValueEditor — the tap-to-type value readout beside every timer slider (Round-2).
//
// Direct component tests: tap swaps the readout button for a focused text input; the permissive
// onChange regex; blur/Enter commit through the parse → convert → snap → clamp pipeline
// (lib/sliderValue, pure math locked in tests/sliderValue.test.js); Escape reverts WITHOUT
// committing and stops propagation (the popup/settings Escape contract); disabled follows the
// slider's lock; and the Q4 round-8 zero-shift geometry — the invisible widest-string strut is
// the ONLY in-flow child of the cell, both live controls sit on top of it out of flow, and
// .svalue-input's outward inset exactly matches its own chrome so the input's CONTENT box lands
// on the strut. jsdom cannot lay out, so the pixels are an on-device check per the standing
// lesson; what is pinned here is the class contract plus the .svalue-input rule's own algebra,
// read straight out of src/index.css.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import SliderValueEditor from '../src/components/SliderValueEditor.jsx'

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
)
const SVALUE_RULE = /\.svalue-input\{([^}]*)\}/.exec(CSS)?.[1] ?? ''

// The three production configs (main.tsx call sites), minus the app-side onCommit wiring.
const flashProps = {
  value: 2000,
  min: 100,
  max: 5000,
  snap: 100,
  inputMode: 'decimal',
  label: 'Flash speed',
  format: (v) => (v / 1000).toFixed(1) + 's',
  toText: (v) => String(v / 1000),
  fromText: (n) => n * 1000,
  widest: '2m 55s', // the widest-possible strut string (six of the seven sites pass SLIDER_READOUT_WIDEST)
}
const roundProps = {
  value: 60,
  min: 10,
  max: 300,
  snap: 5,
  inputMode: 'numeric',
  label: 'Blitz round timer',
  format: (v) => v + 's',
  toText: String,
  widest: '2m 55s',
}
const perQProps = {
  value: 10,
  min: 1,
  max: 30,
  snap: 0.5,
  inputMode: 'decimal',
  label: 'Blitz question timer',
  format: (v) => v + 's',
  toText: String,
  widest: '2m 55s',
}

// The one non-timer site: the defaults manager's AoX run-length row, which types a plain count
// and struts its own "1000" — the widest string any editor mounts, and the site the round-7
// geometry broke (its content box was ~10px under the strut, so a 3rd digit lost the leading one).
const aoxProps = {
  value: 12,
  min: 2,
  max: 1000,
  snap: 1,
  inputMode: 'numeric',
  label: 'MoX Run Length',
  editLabel: 'MoX Run Length',
  format: String,
  toText: String,
  widest: '1000',
}

const readout = (label) => screen.getByRole('button', { name: `Edit ${label}` })
const field = (label) => screen.getByRole('textbox', { name: `${label} (seconds)` })
const openEditor = (label) => act(() => fireEvent.click(readout(label)))

afterEach(cleanup)

describe('SliderValueEditor', () => {
  it('renders the formatted readout; tapping swaps in a focused input seeded unit-less', () => {
    render(<SliderValueEditor {...flashProps} onCommit={vi.fn()} />)
    expect(readout('Flash speed')).toHaveTextContent('2.0s')
    openEditor('Flash speed')
    const input = field('Flash speed')
    expect(input.value).toBe('2') // toText seed: seconds, no unit
    expect(document.activeElement).toBe(input) // auto-focused so the keyboard is live at once
  })

  it('Flash: typing "2.5" and Enter commits 2500ms (×1000 conversion) and returns to display mode', () => {
    const onCommit = vi.fn()
    render(<SliderValueEditor {...flashProps} onCommit={onCommit} />)
    openEditor('Flash speed')
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2.5' } }))
    act(() => fireEvent.keyDown(field('Flash speed'), { key: 'Enter' }))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2500)
    expect(readout('Flash speed')).toBeInTheDocument() // input unmounted, readout is back
  })

  it('Flash: a comma-locale "2,5" commits 2500ms too, never a silent 10× value', () => {
    const onCommit = vi.fn()
    render(<SliderValueEditor {...flashProps} onCommit={onCommit} />)
    openEditor('Flash speed')
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2,5' } }))
    act(() => fireEvent.keyDown(field('Flash speed'), { key: 'Enter' }))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2500)
  })

  it('per-round: blur commits with the snap-to-5 grid', () => {
    const onCommit = vi.fn()
    render(<SliderValueEditor {...roundProps} onCommit={onCommit} />)
    openEditor('Blitz round timer')
    act(() => fireEvent.change(field('Blitz round timer'), { target: { value: '63' } }))
    act(() => fireEvent.blur(field('Blitz round timer')))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(65)
  })

  it('per-question: an over-max value clamps to 30 on commit', () => {
    const onCommit = vi.fn()
    render(<SliderValueEditor {...perQProps} onCommit={onCommit} />)
    openEditor('Blitz question timer')
    act(() => fireEvent.change(field('Blitz question timer'), { target: { value: '999' } }))
    act(() => fireEvent.keyDown(field('Blitz question timer'), { key: 'Enter' }))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(30)
  })

  it('the onChange regex is permissive-but-numeric: decimal allows ONE dot or comma, numeric allows none', () => {
    render(<SliderValueEditor {...flashProps} onCommit={vi.fn()} />)
    openEditor('Flash speed')
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2.5' } }))
    expect(field('Flash speed').value).toBe('2.5')
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2.5.1' } }))
    expect(field('Flash speed').value).toBe('2.5') // second dot rejected outright
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2.5,1' } }))
    expect(field('Flash speed').value).toBe('2.5') // ONE separator total — dot+comma rejected too
    act(() => fireEvent.change(field('Flash speed'), { target: { value: 'abc' } }))
    expect(field('Flash speed').value).toBe('2.5') // letters rejected outright
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '2,5' } }))
    expect(field('Flash speed').value).toBe('2,5') // comma-locale keypads only offer ','
    cleanup()
    render(<SliderValueEditor {...roundProps} onCommit={vi.fn()} />)
    openEditor('Blitz round timer')
    act(() => fireEvent.change(field('Blitz round timer'), { target: { value: '60.5' } }))
    expect(field('Blitz round timer').value).toBe('60') // numeric mode: no dot at all
  })

  it('an emptied field reverts on blur — no commit, the readout shows the untouched value', () => {
    const onCommit = vi.fn()
    render(<SliderValueEditor {...roundProps} onCommit={onCommit} />)
    openEditor('Blitz round timer')
    act(() => fireEvent.change(field('Blitz round timer'), { target: { value: '' } }))
    act(() => fireEvent.blur(field('Blitz round timer')))
    expect(onCommit).not.toHaveBeenCalled()
    expect(readout('Blitz round timer')).toHaveTextContent('60s')
  })

  it('Escape reverts without committing AND stops propagation (the popup dismiss contract)', () => {
    const onCommit = vi.fn()
    const docKeydown = vi.fn()
    document.addEventListener('keydown', docKeydown)
    try {
      render(<SliderValueEditor {...perQProps} onCommit={onCommit} />)
      openEditor('Blitz question timer')
      act(() => fireEvent.change(field('Blitz question timer'), { target: { value: '25' } }))
      act(() => fireEvent.keyDown(field('Blitz question timer'), { key: 'Escape' }))
      expect(onCommit).not.toHaveBeenCalled()
      expect(readout('Blitz question timer')).toHaveTextContent('10s') // reverted
      // The same native press must never reach the document-level settings/popup Escape
      // handlers — the input unmounts on revert, so their input-has-focus skip can't save it.
      expect(docKeydown).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', docKeydown)
    }
  })

  it('disabled mirrors the slider lock: the readout is inert, and a lock mid-edit drops the edit', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<SliderValueEditor {...flashProps} disabled onCommit={onCommit} />)
    expect(readout('Flash speed')).toHaveAttribute('aria-disabled', 'true')
    act(() => fireEvent.click(readout('Flash speed')))
    expect(screen.queryByRole('textbox')).toBeNull() // tap does nothing while locked
    // Unlock, start editing, then lock mid-edit (a round starts) — the edit is dropped, never
    // late-committed against the frozen slider.
    rerender(<SliderValueEditor {...flashProps} onCommit={onCommit} />)
    openEditor('Flash speed')
    act(() => fireEvent.change(field('Flash speed'), { target: { value: '4' } }))
    rerender(<SliderValueEditor {...flashProps} disabled onCommit={onCommit} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('only the invisible widest-string strut is in flow — both live controls sit on top of it', () => {
    render(<SliderValueEditor {...flashProps} onCommit={vi.fn()} />)
    // The strut is always mounted, invisible, hidden from the a11y tree, block-level (so the cell
    // takes ITS height, not an inherited line box) and single-line — it alone holds the cell at
    // the widest POSSIBLE readout width in the live font.
    const strut = screen.getByText('2m 55s')
    expect(strut).toHaveClass('block', 'invisible', 'whitespace-nowrap', 'tabular-nums', 'text-xs')
    expect(strut).toHaveAttribute('aria-hidden', 'true')
    const cell = strut.parentElement
    expect(cell).toHaveClass('relative', 'inline-block', 'shrink-0')
    // The display button overlays the strut and must never wrap at the "2m 55s" space (the
    // Round-4 iOS bug: SF Pro outgrew the hand-measured width and the readout broke lines).
    expect(readout('Flash speed')).toHaveClass('absolute', 'inset-0', 'whitespace-nowrap')
    openEditor('Flash speed')
    // The strut stays mounted through the swap, and the input takes its geometry from
    // .svalue-input (position:absolute) — so neither control can size the cell in either state.
    expect(screen.getByText('2m 55s')).toBe(strut)
    expect(field('Flash speed')).toHaveClass('svalue-input')
    expect(cell.children).toHaveLength(2)
  })

  it('the edit box carries NO in-flow sizing left over from the grid cell it used to be', () => {
    render(<SliderValueEditor {...flashProps} onCommit={vi.fn()} />)
    openEditor('Flash speed')
    const input = field('Flash speed')
    // Round-7's cell was an inline-grid whose input was an in-flow item: it needed w-full to fill
    // the track, min-w-0 + size={1} to stop its intrinsic sizes blowing the track open, and -my-px
    // to CANCEL the border it added to the track's height. Out of flow, every one of those is not
    // just unnecessary but actively wrong — w-full in particular over-constrains left/right and
    // kills the inset that makes the content box match the strut.
    for (const dead of ['col-start-1', 'row-start-1', 'w-full', 'min-w-0', '-my-px', 'rounded-md'])
      expect(input.className.split(' ')).not.toContain(dead)
    expect(input).not.toHaveAttribute('size')
    // surface-tray (stgl-bg + sbtn-bd) is the interactive-control surface every editable box
    // shares — never the container .panel this input once borrowed. It supplies the COLOURS only;
    // .svalue-input owns width, border and radius.
    expect(input).toHaveClass('surface-tray')
    expect(input.className).not.toContain('panel')
  })

  it('.svalue-input insets outward by exactly its own chrome, so the content box lands on the strut', () => {
    // The MoX Run Length site is the proof case: widest "1000", and under round-7's w-full +
    // border-box the content box was ~10px NARROWER than that strut, so typing a 4th digit
    // scrolled the leading one out of view. The rendered pixels are on-device truth; the algebra
    // is not, and it is what fixes the bug — so it is pinned here straight from the stylesheet.
    expect(SVALUE_RULE).not.toBe('')
    // Out of flow: it cannot contribute to the cell's size in either axis, at any value.
    expect(SVALUE_RULE).toContain('position:absolute')
    expect(SVALUE_RULE).toContain('inset:0')
    // Inline axis: padding-inline IN by (pad), border by (bd), margin-inline OUT by (pad + bd).
    // With left:0/right:0 and width:auto the positioning equation then solves to
    // content width == cell width == strut width. Exactly, at every widest string.
    expect(SVALUE_RULE).toContain('padding-inline:var(--svalue-pad)')
    expect(SVALUE_RULE).toContain('border-width:var(--svalue-bd)')
    expect(SVALUE_RULE).toContain('margin-inline:calc((var(--svalue-pad) + var(--svalue-bd)) * -1)')
    // Block axis: no padding, so the outward inset is the border alone.
    expect(SVALUE_RULE).toContain('margin-block:calc(var(--svalue-bd) * -1)')
    expect(SVALUE_RULE).not.toContain('padding-block')
    // The colour must keep coming from .surface-tray: the `border` SHORTHAND would reset
    // border-color to currentcolor and leave the result depending on rule order.
    expect(SVALUE_RULE).not.toMatch(/(^|;)border:/)
    // Native form-field treatment off (Q4 round-8 Part B) — the box declares its own chrome.
    expect(SVALUE_RULE).toContain('appearance:none')
    // And the class really is what the widest-strut site mounts.
    render(<SliderValueEditor {...aoxProps} onCommit={vi.fn()} />)
    expect(screen.getByText('1000')).toHaveClass('invisible')
    act(() => fireEvent.click(readout('MoX Run Length')))
    expect(screen.getByRole('textbox', { name: 'MoX Run Length' })).toHaveClass('svalue-input')
  })
})
