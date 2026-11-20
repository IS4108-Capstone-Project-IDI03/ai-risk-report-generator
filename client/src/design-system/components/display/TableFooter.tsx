// Table footer line (CP-23, v2 section 2): "5 assessments · 3 reports late". CP-24 adds a tone:
// "27 observations · 4 to check", the count in amber.
// Called by the Assessments, Clients and client tables and the Observations tab.
export type TableFooterProps = {
  // The count part, e.g. "5 assessments".
  children: string
  // The late part, e.g. "3 reports late"; shown as an underlined button.
  late?: string
  onLateClick?: () => void
  // The link's colour: red (late, an error; the default) or amber (not sure, "to check").
  tone?: 'danger' | 'warn'
}

/** Returns the footer line; the late part is a button that filters to the late rows. */
export function TableFooter({ children, late, onLateClick, tone = 'danger' }: TableFooterProps) {
  return (
    <div className="ds-table-footer ds-on-grey" aria-live="polite" data-tone={tone}>
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
