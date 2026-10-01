import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureError } from './observability/sentry'

interface ErrorBoundaryProps {
  children?: ReactNode
}
interface ErrorBoundaryState {
  hasError: boolean
}

// Top-level safety net. Catches any error thrown while React renders the app and shows a
// recover card instead of a blank screen. (Covers render errors; async / event-handler errors
// are a separate concern for later.) Inline styles so the fallback still renders even if the
// app's CSS / Tailwind failed to load.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Record it for debugging — never swallow it silently.
    console.error('Calendar Game crashed:', error, info)
    // Report it so real-world crashes on devices we can't test surface. A no-op until the SDK
    // loads, which main.tsx does behind import.meta.env.PROD — so dev/tests never report.
    captureError(error, { boundary: 'app', componentStack: info.componentStack })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#0d1117',
          color: '#f5f3ff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">
            😵
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.8, margin: '0 0 20px', lineHeight: 1.5 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '10px 22px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

interface ModeErrorBoundaryProps {
  children?: ReactNode
  active?: boolean
  mode?: string
  // Called once when this mode's screen crashes — for anything the screen kept that would come back
  // at its next mount and crash it again (a casual mode's parked history, a timed mode's parked
  // round, Lookup's screen, the guide's place; src/main.tsx).
  onCrash?: () => void
}

// Per-mode safety net. Each always-mounted mode component is wrapped in one of these so a
// crash in a single mode is ISOLATED — the bar, the mode switcher, and the other modes keep
// working instead of the whole app dropping to the full-screen ErrorBoundary above. Two design
// points:
//   • `active`: the in-flow fallback only renders when THIS mode is the visible one. A crash in
//     a hidden (display:none) always-mounted mode renders nothing, so it can't paint an error
//     card on top of the mode you're actually using.
//   • keyed by the mode's reset key in App: Full Reset bumps that key, remounting this boundary
//     fresh (clearing the error) along with the mode component — so Full Reset also recovers a
//     crashed mode, on top of the explicit Reload button.
//   • `onCrash`: the Reload button only recovers a mode whose crash does not come back with the
//     page, so whatever the screen kept for its next mount is dropped the moment the crash is caught.
// Uses the app's own theme classes (a logic crash doesn't take out the already-loaded CSS).
export class ModeErrorBoundary extends Component<ModeErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ModeErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Calendar Game: the "${this.props.mode}" mode crashed:`, error, info)
    // Report it WITH the mode name as context — so a crash report says which mode broke.
    captureError(error, {
      boundary: 'mode',
      mode: this.props.mode,
      componentStack: info.componentStack,
    })
    this.props.onCrash?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (!this.props.active) return null
    return (
      <div className="mt-5 rounded-2xl card p-6 text-center space-y-3">
        <div className="text-3xl" aria-hidden="true">
          😵
        </div>
        <div className="text-sm font-medium text-(--tx-100-90)">
          This mode hit an unexpected error.
        </div>
        <div className="text-xs text-(--tx-300-70) leading-relaxed">
          Switch to another mode from the menu above, use Full Reset in&nbsp;⚙, or reload the page.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl btn-solid border border-transparent text-sm font-medium"
        >
          Reload
        </button>
      </div>
    )
  }
}
