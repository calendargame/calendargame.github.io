// @vitest-environment jsdom
//
// Smoke test for the DOM characterization harness (Stage C, Step 6, sub-step 0a).
//
// Proves the new jsdom + Testing Library toolchain works end to end: a React component
// mounts, queries find it, and the jest-dom matchers (registered by tests/setup/dom.js via
// setupFiles) are available — all WITHOUT importing the app yet. Making <App/> importable
// is sub-step 0b; the real per-mode characterization tests come after that. If this passes
// alongside the existing 88 pure-logic tests, the harness itself is sound.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('DOM test harness', () => {
  it('mounts a React component and exposes jest-dom matchers', () => {
    render(<button type="button">harness ok</button>)
    expect(screen.getByRole('button', { name: 'harness ok' })).toBeInTheDocument()
  })

  it('provides the jsdom globals the app needs at load time', () => {
    // These are the stubs from tests/setup/dom.js — confirm they're present so a later
    // `import App` won't throw on module-scope matchMedia / first-render ResizeObserver.
    expect(typeof window.matchMedia).toBe('function')
    expect(typeof window.ResizeObserver).toBe('function')
    expect(typeof window.requestAnimationFrame).toBe('function')
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
  })
})
