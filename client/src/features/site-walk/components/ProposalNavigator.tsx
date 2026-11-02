// The proposal's navigator (CP-22 round 1, round 5): the location tree in a
// panel beside the list on a laptop, a button opening it in a sheet on a phone,
// with the Observations tab's own foot (Add location, All photos, All
// handwritten pages, Deleted observations): its panel, rows and foot
// (assessments/components/NavRow.tsx, NavigatorFoot.tsx).
// Used by screens/Review.tsx.
import { useState } from 'react'
import { Dialog, Icon } from '../../../design-system'
import { NavFoot } from '../../assessments/components/NavigatorFoot'
import type { Proposal } from '../api'
import { ProposalTree, type LocationActions } from './ProposalTree'

// Shows the proposal’s location tree beside the list or in a phone sheet.
export function ProposalNavigator({
  proposal,
  selected,
  title,
  phone,
  onPick,
  onAdd,
  onPhotos,
  onScans,
  onDeleted,
  actions,
}: {
  proposal: Proposal
  selected: string
  // The selected entry's name, for the phone button.
  title: string
  phone: boolean
  onPick: (ref: string) => void
  onAdd: () => void
  // The proposal's own photos, pages and deleted observations.
  onPhotos: () => void
  onScans: () => void
  onDeleted: () => void
  actions: LocationActions
}) {
  const [open, setOpen] = useState(false)
  // The sheet closes first on a phone, so what opens is not under it.
  const close = (go: () => void) => () => {
    setOpen(false)
    go()
  }
  const foot = (
    <NavFoot
      onAddLocation={close(onAdd)}
      onPhotos={close(onPhotos)}
      onScans={close(onScans)}
      deletedCount={proposal.removed?.length ?? 0}
      onDeleted={close(onDeleted)}
    />
  )
  if (!phone)
    return (
      <nav className="ob-card ob-nav" aria-label="Locations">
        <ProposalTree proposal={proposal} selected={selected} onPick={onPick} actions={actions} />
        {foot}
      </nav>
    )
  return (
    <>
      <button
        type="button"
        className="ob-nav-button"
        aria-label={'Location: ' + title + '. Change'}
        onClick={() => setOpen(true)}
      >
        <Icon name="map-pin" size={18} color="var(--marsh-navy)" />
        <span>{title}</span>
        <Icon name="chevron-down" size={16} color="var(--text-secondary)" />
      </button>
      <Dialog
        // swr-sheet: the proposal's violet Add location in the sheet too.
        className="ds-dialog-sheet swr-sheet"
        open={open}
        title="Locations"
        width={440}
        onClose={() => setOpen(false)}
      >
        <nav aria-label="Locations">
          <ProposalTree
            proposal={proposal}
            selected={selected}
            onPick={(ref) => {
              onPick(ref)
              setOpen(false)
            }}
            actions={{
              rename: (ref) => (setOpen(false), actions.rename(ref)),
              useExisting: (ref) => (setOpen(false), actions.useExisting(ref)),
              remove: (ref) => (setOpen(false), actions.remove(ref)),
            }}
          />
        </nav>
        {foot}
      </Dialog>
    </>
  )
}
