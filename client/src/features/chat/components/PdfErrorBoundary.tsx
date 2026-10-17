// Catches a crash inside the PDF tab (CB-02) and shows a note instead.
// Used by CitationPanel around PassagePdf. Without it, a pdf.js error (e.g. a browser
// missing a feature it needs) would unmount the whole app and leave a blank page.
import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }

/** The PDF tab's content, or a pointer to the original PDF if it crashed. */
export class PdfErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <p className="rv-viewer-note" role="alert">
        The page couldn't be shown here. Use "Open the original PDF" below.
      </p>
    )
  }
}
