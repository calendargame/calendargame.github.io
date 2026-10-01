// @vitest-environment jsdom
//
// BootOverlay's trace — the STATIC contract (Round 3, owner call: the erase/redraw flow sweep is
// parked behind BOOT_TRACE_ANIMATED=false in main.tsx; a backlog item revisits it). These pins prove
// the rAF driver is INERT and the trace renders as a plain fully-drawn crisp stroke: no rAF
// scheduled, no blur-mask machinery rendered, no mask attribute on the visible path, no inline
// dash styles written. Plus the shared DIM contract of the glyph (matches the icon master — the
// trace line dimmer than the answer dots): stroke-opacity 0.7 on the trace, 0.3 on the off-path
// board dots, pinned for BootOverlay and W5Logo (index.html's #boot carries the same values
// inline — markup, not jsdom-mountable). The driver + mask code (lib/bootFlow math included) is
// RETAINED for restoration; tests/bootFlow.test.js keeps the math green while it's parked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { BootOverlay } from '../src/main.jsx'
import W5Logo from '../src/components/W5Logo.jsx'

let rafCbs

beforeEach(() => {
  rafCbs = new Map()
  let nextRafId = 1
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextRafId++
    rafCbs.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    rafCbs.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BootOverlay static trace (driver parked behind BOOT_TRACE_ANIMATED)', () => {
  it('schedules no rAF and renders the visible trace unmasked with no inline dash styles', () => {
    render(<BootOverlay updating />)
    // driver inert — nothing scheduled
    expect(rafCbs.size).toBe(0)
    // the blur-mask machinery isn't rendered at all
    expect(document.querySelector('.boot-flow')).toBeNull()
    expect(document.querySelector('.boot-overlay defs')).toBeNull()
    // the visible trace renders directly: no mask attribute, no inline dash styles
    const trace = document.querySelector('.boot-overlay svg path')
    expect(trace).not.toBeNull()
    expect(trace.hasAttribute('mask')).toBe(false)
    expect(trace.style.strokeDashoffset).toBe('')
    expect(trace.style.strokeDasharray).toBe('')
  })

  it('keeps the "Updating…" three-dot pulse markup intact (its animation is CSS, untouched)', () => {
    render(<BootOverlay updating />)
    expect(document.querySelectorAll('.boot-overlay .boot-d').length).toBe(3)
  })
})

describe('trace dim (0.7) — identical across the glyph renderings', () => {
  it('BootOverlay: trace stroke-opacity 0.7, off-path board-dot group stays 0.3', () => {
    render(<BootOverlay updating />)
    const trace = document.querySelector('.boot-overlay svg path')
    expect(trace.getAttribute('stroke-opacity')).toBe('0.7')
    const dots = document.querySelector('.boot-overlay svg g')
    expect(dots.getAttribute('opacity')).toBe('0.3')
  })

  it('W5Logo: trace stroke-opacity 0.7, off-path board-dot group stays 0.3', () => {
    const { container } = render(<W5Logo />)
    const trace = container.querySelector('path')
    expect(trace.getAttribute('stroke-opacity')).toBe('0.7')
    const dots = container.querySelector('g')
    expect(dots.getAttribute('opacity')).toBe('0.3')
  })
})
