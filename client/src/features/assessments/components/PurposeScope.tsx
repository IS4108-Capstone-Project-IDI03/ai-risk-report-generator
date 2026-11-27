import { Callout, Icon } from '../../../design-system'

// Section 1 Purpose and Scope (GN-07 AC1): Marsh's standard wording, filled in by the
// gateway from the assessment's details on every read (summary.service.ts), so it is
// never out of date and costs no model call. Changing it means changing those details.
export function PurposeScope({
  text,
  error,
  page = false,
}: {
  // Paragraphs; an array is the list of visit activities.
  text: (string | string[])[] | null
  error: string | null
  // Review's look: one subsection of the report's page (review.css .rv-sub), where it came
  // from as a quiet line at its foot. The document editor keeps the card.
  page?: boolean
}) {
  if (error)
    return (
      <Callout tone="danger" title="Section 1 could not be loaded">
        {error}
      </Callout>
    )
  const body = !text ? (
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
  )
  if (page)
    return (
      <section className="rv-sub">
        <div className="rv-sub-body">{body}</div>
        <p className="rv-sub-note rv-sub-foot">
          <Icon name="info" size={14} />
          <span>
            Assembled from the assessment details. Edit them on the Overview tab to change it.
          </span>
        </p>
      </section>
    )
  return (
    <>
      <p className="rv-muted">
        Assembled from the assessment details. Edit them on the Overview tab to change it.
      </p>
      <div className="rv-subsection-note">{body}</div>
    </>
  )
}
