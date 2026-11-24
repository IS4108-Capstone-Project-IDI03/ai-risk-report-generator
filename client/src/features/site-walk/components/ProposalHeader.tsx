// The top of the proposal review (CP-22 round 1, revamped round 3, v2 in CP-24): the
// Observations sub-screen bar with the round Back, the centred name and its rename
// pencil, the Proposal badge above it, the save state under it, and on the right whether it is
// ready, a help (?) and Create all (greyed out with its reason while something is missing).
// Used by screens/Review.tsx.
import { Button, Icon, IconAction } from '../../../design-system'
import { ObservationBadge } from '../../assessments/components/ObservationBadge'
import { ScreenHeader } from '../../assessments/components/ScreenHeader'
import type { Proposal } from '../api'
import { createProblem, incompleteCount, incompleteWords } from '../proposal'
import type { SaveState } from '../useProposal'
import { ProposalHelp } from './ProposalHelp'

// The save state under the name: a grey double tick, never the green ready tick.
function SaveStatus({ state, onSave }: { state: SaveState; onSave: () => void }) {
  if (state === 'failed')
    return (
      <button type="button" className="swr-retry" onClick={onSave}>
        <Icon name="circle-alert" size={15} color="var(--red-600)" />
        Not saved. Retry
      </button>
    )
  return state === 'saved' ? (
    <>
      <Icon name="check-check" size={15} />
      Saved
    </>
  ) : (
    <>
      <Icon name="loader" size={15} className="ob-spin" />
      Saving…
    </>
  )
}

// Ready or not, beside Create all. Not ready is a button that opens the first
// observation still missing something, so the count leads straight to the fix.
function ReadyState({ proposal, onFix }: { proposal: Proposal; onFix: () => void }) {
  const left = incompleteCount(proposal)
  if (!proposal.observations.length)
    return (
      <span id="swr-state" className="swr-state">
        No observations
      </span>
    )
  if (left)
    return (
      <button
        id="swr-state"
        type="button"
        className="swr-state"
        data-tone="red"
        aria-label={`Not ready: ${left} ${left === 1 ? 'observation needs' : 'observations need'} details. Open the first`}
        onClick={onFix}
      >
        <Icon name="circle-alert" size={16} />
        {incompleteWords(proposal)}
      </button>
    )
  return (
    <span id="swr-state" className="swr-state" data-tone="green">
      <Icon name="circle-check" size={16} />
      Ready to add
    </span>
  )
}

// Shows the review's navigation, name, save state, readiness and Create all.
export function ProposalHeader({
  back,
  name,
  proposal,
  saveState,
  creating,
  onSave,
  onRename,
  onFix,
  onCreate,
  readOnly = false,
}: {
  back: { label: string; onClick: () => void }
  name: string
  proposal: Proposal | null
  saveState: SaveState
  creating: boolean
  onSave: () => void
  onRename: () => void
  onFix: () => void
  onCreate: () => void
  // Someone else's proposal (RV-11 AC2): the name and the words only, nothing to press.
  readOnly?: boolean
}) {
  // Not-sure rows (isNotSure) never block it: only an empty field or no observation does.
  const blocked = !proposal || !proposal.observations.length || incompleteCount(proposal) > 0
  return (
    <ScreenHeader
      title={name}
      back={back.label}
      onBack={back.onClick}
      // Never mistaken for the real Observations tab (round 6).
      badge={<ObservationBadge kind="proposal" />}
      titleAction={
        !readOnly && (
          <IconAction
            icon="pencil"
            label="Rename proposal"
            tooltip="Rename proposal"
            onClick={onRename}
          />
        )
      }
      detail={
        proposal &&
        !readOnly && (
          <span className="swr-saved" role="status" data-state={saveState}>
            <SaveStatus state={saveState} onSave={onSave} />
          </span>
        )
      }
      actions={
        proposal &&
        !readOnly && (
          <>
            {!creating && <ReadyState proposal={proposal} onFix={onFix} />}
            <ProposalHelp />
            {/* Greyed out, not disabled, while something is missing: hovering says why (v2). */}
            <Button
              variant="create"
              data-walk="site-walk.create"
              loading={creating}
              disabledReason={
                blocked && !creating
                  ? { title: "Can't create yet", text: createProblem(proposal) ?? '' }
                  : undefined
              }
              onClick={onCreate}
            >
              {creating ? 'Creating…' : 'Create all'}
            </Button>
          </>
        )
      }
    />
  )
}
