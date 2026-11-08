// A small mark on an observation (CP-22 round 6, Sprint 4 fixes AC1-AC2): a
// footprints circle on one saved from a site walk (icon only, named by a
// tooltip and a screen-reader label), and a "Proposal" / "Proposed observation"
// badge on a proposal's screens (violet, the app's AI colour). Used by ObservationRow.tsx, screens/ObservationPage.tsx
// and the site walk proposal screens (features/site-walk).
import { Icon, Tooltip } from '../../../design-system'

export function ObservationBadge({
  kind,
  label,
}: {
  kind: 'walk' | 'proposal'
  // Defaults: "From site walk", or "Proposal".
  label?: string
}) {
  const proposal = kind === 'proposal'
  if (!proposal)
    return (
      <Tooltip label={label ?? 'From site walk'}>
        <span className="ob-badge" data-kind={kind}>
          <Icon name="footprints" size={12} />
          <span className="ob-sr">{label ?? 'From site walk'}</span>
        </span>
      </Tooltip>
    )
  return (
    <span className="ob-badge" data-kind={kind}>
      <Icon name="sparkles" size={13} />
      {label ?? 'Proposal'}
    </span>
  )
}
