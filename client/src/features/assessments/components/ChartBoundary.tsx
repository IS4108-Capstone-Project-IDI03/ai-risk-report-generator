// Loads a section's charts lazily (GN-12) and keeps a failure to the charts alone: a
// chart chunk that can't be fetched (a redeploy, a dropped connection) would otherwise
// unmount the whole Review workspace. Used by ReviewWorkspace and RiskQualityFigures.
import { Component, Suspense, type ReactNode } from 'react'

export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed)
      return (
        <p className="rv-chart-empty" role="alert">
          The charts couldn't be loaded. Reload the page to try again; the figures above are
          unaffected.
        </p>
      )
    return <Suspense fallback={null}>{this.props.children}</Suspense>
  }
}
