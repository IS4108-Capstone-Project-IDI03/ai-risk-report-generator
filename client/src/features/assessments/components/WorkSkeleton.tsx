// The Assessments list while the first read is under way: five grey rows that pulse, so the
// list never shows anything but real assessments. Used by screens/Dashboard
// and, while an assessment opened by URL waits for the list, components/WorkspaceState.
// Styled in ../assessment-list.css (.at-skel).

/** Returns the placeholder rows, announced to a screen reader as one `label`. */
export function WorkSkeleton({ label = 'Loading assessments' }: { label?: string }) {
  return (
    <div className="at-skel" role="status" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="at-skel-row" aria-hidden="true">
          <span className="at-skel-tile" />
          <span className="at-skel-bar" style={{ width: 120 + ((i * 37) % 80) }} />
          <span className="at-skel-bar at-skel-end" />
        </div>
      ))}
    </div>
  )
}
