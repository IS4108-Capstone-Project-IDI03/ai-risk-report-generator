// Generation's shape while the drafting state loads (GN-13), so nothing jumps when it arrives.
// Rendered by screens/DraftingSteps.tsx; styled by drafting-steps.css.

/** Returns the grey header and two step placeholders, marked busy for screen readers. */
export function LoadingSteps() {
  return (
    <div className="gx" aria-busy="true">
      <div className="gx-skeleton gx-skeleton-header">
        <span className="gx-sr">Loading the drafting progress…</span>
      </div>
      <div className="gx-steps">
        <div className="gx-skeleton gx-skeleton-step" />
        <div className="gx-skeleton gx-skeleton-step" />
      </div>
    </div>
  )
}
