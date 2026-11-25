// The Assessments list while the first read is under way: five grey rows that pulse, so no
// made-up sample assessment shows for a moment before the real ones. Used by screens/Dashboard.
// Styled in ../assessment-list.css (.at-skel).

/** Returns the placeholder rows, announced to a screen reader as one "Loading assessments". */
export function WorkSkeleton() {
  return (
    <div className="at-skel" role="status" aria-label="Loading assessments">
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
