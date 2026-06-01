// @vitest-environment jsdom
//
// App-mount verification (Stage C, Step 6, sub-step 0b).
//
// Proves the real <App/> can be imported and mounted by the harness:
//   - importing main.jsx does NOT auto-mount (the guarded mount sees no #root at import
//     time), so there's exactly one App tree — the one Testing Library renders;
//   - App renders its chrome (the header) and the default launch mode (Classic, with the
//     7 weekday answer buttons + the New/Reveal/Override controls) without throwing.
//
// This is the foundation the per-mode characterization tests build on (Classic first).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'

// CustomSelect portals its dropdown panel into #root, so the harness must provide one.
// App's own tree is mounted by Testing Library into its default container (not #root), so
// no second copy is created.
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

describe('App mounts in the harness (sub-step 0b)', () => {
  beforeEach(() => {
    // The settings store is a module singleton persisted to localStorage — reset both so
    // each test starts from the documented defaults regardless of order.
    localStorage.clear()
    useSettings.getState().resetSettings()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('renders the header and the default Classic mode, mounted exactly once', () => {
    mountApp()

    // Chrome: the title heading.
    expect(screen.getByRole('heading', { name: 'Calendar Game' })).toBeInTheDocument()

    // Classic is the launch mode → the 7 weekday answer buttons are present, exactly once
    // (one App tree, no accidental auto-mount duplicate).
    expect(screen.getByRole('button', { name: 'Sunday' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saturday' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Wednesday' })).toHaveLength(1)

    // Classic game controls (non-timer mode → "New", plus Reveal/Override).
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Override' })).toBeInTheDocument()
  })

  it('shows the stats strip with the launch Score of 0/0', () => {
    mountApp()
    // Query by role so the always-mounted-but-display:none AoX panel (which has its own
    // "Score" cell) is excluded — getByRole ignores accessibility-hidden subtrees. The
    // Score cell is a button (it doubles as the hide-scoring toggle); its accessible name
    // is "Score 0/0". Scope to it so the Streak cell's identical "0/0" doesn't collide.
    const scoreCell = screen.getByRole('button', { name: /^Score/ })
    expect(within(scoreCell).getByText('0/0')).toBeInTheDocument()
  })
})
