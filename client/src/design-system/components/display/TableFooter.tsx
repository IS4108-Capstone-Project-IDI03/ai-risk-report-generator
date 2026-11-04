// Table footer line (CP-23, v2 section 2): "5 assessments · 3 reports late".
// Called by the Assessments, Clients and client tables.
export type TableFooterProps = {
  // The count part, e.g. "5 assessments".
  children: string
  // The late part, e.g. "3 reports late"; shown as a red underlined button.
  late?: string
  onLateClick?: () => void
}

/** Returns the footer line; the late part is a button that filters to the late rows. */
export function TableFooter({ children, late, onLateClick }: TableFooterProps) {
  return (
    <div className="ds-table-footer ds-on-grey" aria-live="polite">
      <span>{children}</span>
      {late ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="ds-table-footer-late" onClick={onLateClick}>
            {late}
          </button>
        </>
      ) : null}
    </div>
  )
}
