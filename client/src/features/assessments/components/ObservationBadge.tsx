// A small status badge on an observation (CP-22 round 6): "From site walk" on
// one saved from a site walk proposal, and "Proposal" / "Proposed observation"
// on a proposal's screens (violet, the app's AI colour), so neither reads as a
// plain observation. Used by ObservationRow.tsx, screens/ObservationPage.tsx
// and the site walk proposal screens (features/site-walk).
import { Icon } from '../../../design-system'

export function ObservationBadge({
  kind,
  label,
}: {
  kind: 'walk' | 'proposal'
  // Defaults: "From site walk", or "Proposal".
  label?: string
}) {
  const proposal = kind === 'proposal'
  return (
    <span className="ob-badge" data-kind={kind}>
      <Icon name={proposal ? 'sparkles' : 'footprints'} size={13} />
      {label ?? (proposal ? 'Proposal' : 'From site walk')}
    </span>
  )
}
