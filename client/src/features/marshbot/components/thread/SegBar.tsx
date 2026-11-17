// A bar of segments, one per thing counted (AS-06 canvas H1, S3): each segment takes a colour
// key from cards.css (green, amber, ink, red; none = grey). Past MAX_SEGMENTS it is one track
// filled to its share, since 3 px gaps stop fitting on a phone. Data, so it never animates.
// Used by TickCells, BarsCard and OutlineCard.

const MAX_SEGMENTS = 16

/** Returns a bar of `covered` of `total` in `tone`; `parts` colours each segment instead. */
export function SegBar({
  covered = 0,
  total = 0,
  tone = 'green',
  parts,
  label,
}: {
  covered?: number
  total?: number
  tone?: string
  parts?: (string | null)[]
  // What the bar says, for screen readers ("Fire Protection: 7 of 12").
  label?: string
}) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  if (!parts && total > MAX_SEGMENTS)
    return (
      <span className="mbt-segs" data-fill="" {...a11y}>
        <i data-tone={tone} style={{ width: `${(covered / total) * 100}%` }} />
      </span>
    )
  const segs = parts ?? Array.from({ length: total }, (_, i) => (i < covered ? tone : null))
  return (
    <span className="mbt-segs" {...a11y}>
      {segs.map((t, i) => (
        <i key={i} data-tone={t ?? undefined} />
      ))}
    </span>
  )
}
