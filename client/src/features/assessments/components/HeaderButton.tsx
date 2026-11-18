// The one control on Generation's checkpoint header (GN-13): start drafting, go to Review or
// Observations, or, for an admin, the View only chip. Rendered by screens/DraftingSteps.tsx.
import { Button, ViewOnlyChip } from '../../../design-system'
import type { HeaderAction } from '../generation/words'

// The Observations tab's primary action is 14 px, weight 600, 40 px high, padding 0 16 px
// (observations.css, .ob-button--primary); MarshBot's replies are 600 too. The design system's
// Create pill is 15 px and 500, so these three are set to match it.
const SAME_AS_OBSERVATIONS = { fontSize: '14px', fontWeight: 600, padding: '0 16px' }

/** Returns the header's button (or chip) for `action`. */
export function HeaderButton({
  action,
  starting,
  onStart,
  onReview,
  onObservations,
}: {
  action: HeaderAction
  starting: boolean
  onStart: () => void
  onReview: () => void
  onObservations: () => void
}) {
  if (action.kind === 'view_only') return <ViewOnlyChip />
  if (action.kind === 'review' || action.kind === 'observations')
    return (
      <Button
        variant="create"
        iconRight="chevron-right"
        style={SAME_AS_OBSERVATIONS}
        onClick={action.kind === 'review' ? onReview : onObservations}
      >
        {action.kind === 'review' ? 'Open Review' : 'Open Observations'}
      </Button>
    )
  // Greyed while recordings are transcribed: the design system's blocked look and reason box.
  if (action.kind === 'greyed')
    return (
      <Button
        variant="create"
        iconLeft={action.icon}
        style={SAME_AS_OBSERVATIONS}
        disabledReason={{
          title: "Can't draft yet",
          text: 'Recordings are still being transcribed.',
        }}
      >
        {action.label}
      </Button>
    )
  return (
    <Button
      variant="create"
      iconLeft={action.icon}
      style={SAME_AS_OBSERVATIONS}
      loading={starting}
      onClick={onStart}
    >
      {action.label}
    </Button>
  )
}
