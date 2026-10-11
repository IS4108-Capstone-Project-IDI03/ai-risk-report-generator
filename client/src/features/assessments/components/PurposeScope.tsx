import { Callout } from '../../../design-system'

// Section 1 Purpose and Scope (GN-07 AC1): Marsh's standard wording, filled in by the
// gateway from the assessment's details on every read (summary.service.ts), so it is
// never out of date and costs no model call. Changing it means changing those details.
export function PurposeScope({
  text,
  error,
}: {
  // Paragraphs; an array is the list of visit activities.
  text: (string | string[])[] | null
  error: string | null
}) {
  if (error)
    return (
      <Callout tone="danger" title="Section 1 could not be loaded">
        {error}
      </Callout>
    )
  return (
    <>
      <p className="rv-muted">
        Assembled from the assessment details. Edit them on the Overview tab to change it.
      </p>
      <div className="rv-subsection-note">
        {!text ? (
          <p className="rv-statement">Loading…</p>
        ) : (
          text.map((block, i) =>
            Array.isArray(block) ? (
              <ul key={i} style={{ margin: '10px 0 0', paddingLeft: '20px' }}>
                {block.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i} className="rv-statement" style={i ? { marginTop: '10px' } : undefined}>
                {block}
              </p>
            ),
          )
        )}
      </div>
    </>
  )
}
