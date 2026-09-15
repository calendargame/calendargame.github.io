// @vitest-environment jsdom
//
// components/ConfirmModal — the ONE shape every reset-style confirmation wears since Q7 (round 21):
// Full Reset, Reset Settings, each casual mode's Reset Stats, Clear Saved Defaults, and the
// "Enable and Reset Stats?" desync case. This file tests the component in isolation — mounted with
// its own #root, driven by a user — so the five modal-contract terms it owns are provable without
// standing up a whole settings panel. The terms as they play out INSIDE the app (every close route,
// the LIFO Back stack, the status-bar scrim) are covered by the settings + mode suites, which
// reach this component through their real call sites.
//
// ★ SINCE Q2 THE CARD HAS EXACTLY ONE BUTTON — the confirm. The Cancel button went app-wide on the
// owner's rule that tapping outside or pressing Escape already says the same thing, so what used to
// be "Cancel does the cancelling" is now three claims: the count is one, the scrim tap and Escape
// still reach onCancel, and the Tab trap's one-control branch is what this markup actually hits.
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

  // ★ Q2: ONE BUTTON ON THE CARD. The Cancel button is gone app-wide (the owner: "you can just tap
  // outside or press esc so it's just a noise button") — so this asserts the COUNT, not merely the
  // absence of a caption. A card that grew any second control would fail here, which is the claim
  // the trap case below then rests on (trapModalTab's one-control branch).
  it('carries exactly ONE button — the confirm — and no Cancel (Q2)', () => {
    const { onConfirm } = mount({ confirmLabel: 'Reset' })
    const dialog = screen.getByRole('dialog')
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons.map((b) => b.textContent.trim())).toEqual(['Reset'])
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(buttons[0])
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('the confirm button fires only onConfirm; a click on the card itself fires neither', () => {
    const { onCancel, onConfirm } = mount({ confirmLabel: 'Reset' })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
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

  // ⚠ VERIFIED AGAINST THE REAL MARKUP, NOT ASSUMED FROM THE HELPER'S CLAIM. modalContract says a
  // one-control card lands on its first === last branch (tests/modalContract proves that branch
  // against fabricated DOM); what is asserted here is that THIS card's markup actually reaches it —
  // the only button is the one `querySelectorAll('button,input')` finds, so Tab in either direction
  // is consumed and focus stays put instead of walking out to the page under the scrim.
  it('the scrim traps Tab on the single control — the press is consumed and focus stays on it', () => {
    mount({ confirmLabel: 'Reset' })
    const scrim = document.querySelector('[data-settings-modal]')
    const confirm = screen.getByRole('button', { name: 'Reset' })
    act(() => confirm.focus())
    const delivered = fireEvent.keyDown(scrim, { key: 'Tab' })
    expect(delivered).toBe(false) // preventDefault was called
    expect(document.activeElement).toBe(confirm)
    const deliveredBack = fireEvent.keyDown(scrim, { key: 'Tab', shiftKey: true })
    expect(deliveredBack).toBe(false)
    expect(document.activeElement).toBe(confirm)
  })

  // The two dismiss routes that replaced the Cancel button are asserted above (the scrim tap and
  // capture-phase Escape); this pins that they still land on onCancel with the button gone, i.e. that
  // removing it did not quietly take the cancel semantics with it.
  it('Escape and a scrim tap both still cancel with no Cancel button on the card', () => {
    const { onCancel, onConfirm } = mount()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    fireEvent.click(document.querySelector('[data-settings-modal]'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not fire either callback just by opening or closing', () => {
    const { view, base, onCancel, onConfirm } = mount()
    view.rerender(<ConfirmModal {...base} open={false} />)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
