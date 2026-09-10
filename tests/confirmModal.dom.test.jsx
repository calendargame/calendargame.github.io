// @vitest-environment jsdom
//
// components/ConfirmModal — the ONE shape every reset-style confirmation wears since Q7 (round 21):
// Full Reset, Reset Settings, each casual mode's Reset Stats, Clear Saved Defaults, and the
// "Enable and Reset Stats?" desync case. This file tests the component in isolation — mounted with
// its own #root, driven by a user — so the five modal-contract terms it owns are provable without
// standing up a whole settings panel. The terms as they play out INSIDE the app (every close route,
// the LIFO Back stack, the status-bar scrim) are covered by the settings + mode suites, which
// reach this component through their real call sites.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import ConfirmModal from '../src/components/ConfirmModal.jsx'

function mount(props) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  const base = {
    open: true,
    onCancel,
    onConfirm,
    title: 'Reset this thing?',
    body: 'It wipes the thing. This preset only.',
    backButtonId: 'test-confirm',
  }
  const view = render(<ConfirmModal {...base} {...props} />)
  return { view, onCancel, onConfirm, base }
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('ConfirmModal', () => {
  it('renders nothing while closed and a labelled dialog while open', () => {
    const { view, base } = mount({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[data-settings-modal]')).toBeNull()
    view.rerender(<ConfirmModal {...base} open={true} />)
    const dialog = screen.getByRole('dialog', { name: 'Reset this thing?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('It wipes the thing. This preset only.')).toBeInTheDocument()
  })

  it('carries [data-settings-modal] on the scrim, which portals to #root', () => {
    mount()
    const scrim = document.querySelector('[data-settings-modal]')
    expect(scrim).not.toBeNull()
    expect(scrim.parentElement).toBe(document.getElementById('root'))
    // The dialog is the scrim's child.
    expect(scrim.querySelector('[role="dialog"]')).toBe(screen.getByRole('dialog'))
  })

  it('moves focus into the dialog card on open', () => {
    mount()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('Cancel calls onCancel and not onConfirm; the confirm button is the reverse', () => {
    const { onCancel, onConfirm } = mount({ confirmLabel: 'Reset' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirmLabel defaults to "Reset" and is overridable', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    cleanup()
    document.getElementById('root')?.remove()
    mount({ confirmLabel: 'Clear' })
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('a tap on the scrim itself cancels; a tap on the card does not', () => {
    const { onCancel } = mount()
    fireEvent.click(screen.getByRole('dialog')) // the card — must NOT cancel
    expect(onCancel).not.toHaveBeenCalled()
    const scrim = document.querySelector('[data-settings-modal]')
    fireEvent.click(scrim) // target === currentTarget → cancel
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape (capture phase) cancels, and stops the press from propagating to the page', () => {
    const { onCancel } = mount()
    const bubbled = vi.fn()
    document.addEventListener('keydown', bubbled)
    try {
      act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    } finally {
      document.removeEventListener('keydown', bubbled)
    }
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(bubbled).not.toHaveBeenCalled() // the capture handler consumed it
  })

  it('the scrim traps Tab — off the last control it wraps to the first, and the press is consumed', () => {
    mount({ confirmLabel: 'Reset' })
    const scrim = document.querySelector('[data-settings-modal]')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Reset' })
    act(() => confirm.focus())
    const delivered = fireEvent.keyDown(scrim, { key: 'Tab' })
    expect(delivered).toBe(false) // preventDefault was called
    expect(document.activeElement).toBe(cancel)
    // …and Shift+Tab off the first wraps back to the last.
    act(() => cancel.focus())
    fireEvent.keyDown(scrim, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('does not fire either callback just by opening or closing', () => {
    const { view, base, onCancel, onConfirm } = mount()
    view.rerender(<ConfirmModal {...base} open={false} />)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
