// The small marks an observation is read by on the Observations tab and its
// page (CP-22): its category as a coloured icon, its severity as a symbol, and
// where it stands as one mark. Used by ObservationRow.tsx and ObservationPage.tsx.
import { Icon, IconRegistry, RowMark } from '../../../design-system'
import { CAT_ICON } from '../categories'

// Each COPE category's colour, set in observations.css.
// Token colours, not the .ob variables, so menus drawn outside .ob get them too.
export const CAT_TINT: Record<string, string> = {
  Construction: 'var(--chart-orange-dark)',
  Occupancy: 'var(--ink-600)',
  Protection: 'var(--chart-magenta-dark)',
  Exposure: 'var(--chart-aqua-dark)',
}

// One tile split between its categories (Jesper, 31 Oct): whole for one,
// halves for two, thirds for three, quadrants for four, each part with its
// category's icon in that category's colour. A dashed tag when it has none,
// which reads as "not tagged yet".
export function CategoryMark({ cats }: { cats: string[] }) {
  if (!cats.length)
    return (
      <span className="ob-cat" data-none="">
        <Icon name="tag" size={15} color="var(--text-muted)" />
      </span>
    )
  return (
    <span className="ob-cat" data-count={cats.length}>
      {cats.map((cat) => (
        <span key={cat} className="ob-cat-part" style={{ ['--ob-tint' as string]: CAT_TINT[cat] }}>
          <Icon name={CAT_ICON[cat]} size={cats.length === 1 ? 18 : cats.length === 2 ? 15 : 13} />
        </span>
      ))}
    </span>
  )
}

// The severity's own symbol and colour, with its name beside it where there is
// room (always readable by a screen reader).
export function SeverityMark({ sev }: { sev: string }) {
  // No severity yet (CP-24): a dash, which a screen reader hears as "No severity".
  if (!sev)
    return (
      <span className="ob-sev ob-none" role="img" aria-label="No severity">
        {'–'}
      </span>
    )
  const mark = IconRegistry.severity[sev as keyof typeof IconRegistry.severity]
  const label = sev.charAt(0).toUpperCase() + sev.slice(1)
  return (
    <span className="ob-sev" style={{ color: mark?.color }}>
      <Icon name={mark?.icon ?? 'info'} size={16} />
      {/* Visually hidden on a phone, still read by screen readers. */}
      <span className="ob-sev-label">{label}</span>
    </span>
  )
}

// Where the observation stands, as the design system's one row mark (RowMark): a green tick
// when complete, a spinner while transcribing or reading, an amber triangle when there is
// something to check, a red alert on a failure. The words are kept for screen readers.
export function StatusMark({ status }: { status: string }) {
  const kind = status.endsWith('failed')
    ? 'failed'
    : status === 'To check'
      ? 'unsure'
      : status === 'Complete'
        ? 'done'
        : 'working'
  return (
    <span className="ob-status">
      <RowMark kind={kind} label={status} />
    </span>
  )
}
