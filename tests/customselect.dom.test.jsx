// @vitest-environment jsdom
//
// CustomSelect — the "active cursor" highlight behavior (the mode-selector popover).
//
// The grey active box (bg-black/10) is a pointer/keyboard cursor, NOT an open-state
// indicator: it must NOT appear just from opening (so it never shows on mobile, where there's
// no hover/arrow input), it appears on a real MOUSE hover or an arrow key, and the first arrow
// reveals it on the currently-selected option. The check mark (✓) marks the selection and is
// independent of the box. (Deliberate behavior change, 2026-06-01.)
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import CustomSelect from '../src/components/CustomSelect.jsx'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

// The active box is `bg-black/10` as its own class; inactive options get `active:bg-black/10`
// (a press-only pseudo). The leading space distinguishes the standalone token from the pseudo.
const hasBox = (btn) => btn.className.includes(' bg-black/10')
const options = () => screen.getAllByRole('option')

function openWith(value = 'b') {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  render(<CustomSelect value={value} onChange={() => {}} options={OPTIONS} ariaLabel="Test" />)
  const trigger = screen.getByRole('button', { name: 'Test' })
  fireEvent.click(trigger) // open the popover
  return trigger
}

describe('CustomSelect — active-cursor highlight', () => {
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('shows NO active box when the popover just opened (the mobile / no-input case)', () => {
    openWith('b')
    expect(options().some(hasBox)).toBe(false) // nothing highlighted on open
    // …but the selected option still carries its check mark.
    const selected = options().find((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected.textContent).toContain('✓')
    expect(selected.textContent).toContain('Beta')
  })

  it('the first ArrowDown reveals the box ON the selected option', () => {
    const trigger = openWith('b') // 'b' = Beta = index 1
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].getAttribute('aria-selected')).toBe('true')
    expect(boxed[0].textContent).toContain('Beta')
  })

  it('the first ArrowUp also reveals the box on the selected option', () => {
    const trigger = openWith('b')
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].textContent).toContain('Beta')
  })

  it('a second ArrowDown moves the box off the selected option', () => {
    const trigger = openWith('b')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // → Beta (selected)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // → Gamma
    const boxed = options().filter(hasBox)
    expect(boxed.length).toBe(1)
    expect(boxed[0].textContent).toContain('Gamma')
  })

  it('a MOUSE hover highlights an option, a TOUCH pointer does not', () => {
    openWith('b')
    const gamma = options().find((o) => o.textContent.includes('Gamma'))
    fireEvent.pointerEnter(gamma, { pointerType: 'touch' })
    expect(hasBox(gamma)).toBe(false) // touch → no box (mobile stays clean)
    fireEvent.pointerEnter(gamma, { pointerType: 'mouse' })
    expect(hasBox(gamma)).toBe(true) // mouse → box (desktop hover)
  })
})
