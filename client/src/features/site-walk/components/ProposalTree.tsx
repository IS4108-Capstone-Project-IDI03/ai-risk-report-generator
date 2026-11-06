// The proposal's locations as the Observations tab's tree (CP-22 round 1),
// with the same rows (assessments/components/NavRow.tsx): All locations, No
// location yet (when any observation has none), then each building with its
// levels and locations. A red mark shows where something still needs details.
// A new location, one the walk adds, has Rename, Use an existing location and
// Delete on hover; the assessment's own locations are plain rows.
// Used by ProposalNavigator.tsx.
import { useState } from 'react'
import { Icon } from '../../../design-system'
import { NavAction, NavRow } from '../../assessments/components/NavRow'
import type { Proposal } from '../api'
import { ALL, groupProposal, lacksValue, NEEDS_LOCATION, observationsAt } from '../proposal'

// Something here still needs details: the red of the list's Needs marks.
const flag = (on: boolean) =>
  on && (
    <span className="ob-nav-flag">
      <Icon name="circle-alert" size={15} />
      <span className="ob-sr">, needs details</span>
    </span>
  )

export type LocationActions = {
  rename: (ref: string) => void
  useExisting: (ref: string) => void
  remove: (ref: string) => void
}

// Groups proposed locations and exposes actions for new places.
export function ProposalTree({
  proposal,
  selected,
  onPick,
  actions,
}: {
  proposal: Proposal
  selected: string
  onPick: (ref: string) => void
  // Left out for someone reading another engineer's walk (RV-11 AC2).
  actions?: LocationActions
}) {
  // Buildings and levels fold; each remembers its fold for the visit.
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setFolded((f) => ({ ...f, [key]: !f[key] }))
  const { needsLocation, groups } = groupProposal(proposal)
  return (
    <ul className="ob-nav-tree">
      <li>
        <NavRow all selected={selected === ALL} label="All locations" onPick={() => onPick(ALL)} />
      </li>
      {needsLocation && (
        <li>
          <NavRow
            selected={selected === NEEDS_LOCATION}
            label="No location yet"
            badge={flag(true)}
            onPick={() => onPick(NEEDS_LOCATION)}
          />
        </li>
      )}
      {groups.map((g) => (
        <li key={g.key}>
          <NavRow
            selected={false}
            label={g.title}
            fold={{ open: !folded[g.key], toggle: () => toggle(g.key) }}
            onPick={() => toggle(g.key)}
          />
          {!folded[g.key] && (
            <ul>
              {g.levels.map((level) => {
                const key = g.key + '/' + (level.title ?? '')
                const rows = (depth: number) => (
                  <ul>
                    {level.locations.map((l) => (
                      <li key={l.ref}>
                        <NavRow
                          selected={selected === l.ref}
                          label={l.name}
                          badge={flag(observationsAt(proposal, l.ref).some(lacksValue))}
                          depth={depth}
                          onPick={() => onPick(l.ref)}
                          actions={
                            l.existingId || !actions ? null : (
                              <>
                                <NavAction
                                  icon="link"
                                  color="var(--marsh-navy)"
                                  label={'Use an existing location for ' + l.name}
                                  tooltip="Use an existing location"
                                  onClick={() => actions.useExisting(l.ref)}
                                />
                                <NavAction
                                  icon="pencil"
                                  color="var(--ink-600)"
                                  label={'Rename ' + l.name}
                                  tooltip="Rename location"
                                  onClick={() => actions.rename(l.ref)}
                                />
                                <NavAction
                                  icon="trash-2"
                                  color="var(--red-600)"
                                  label={'Delete ' + l.name}
                                  tooltip="Delete location"
                                  onClick={() => actions.remove(l.ref)}
                                />
                              </>
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )
                // Locations with no level sit straight under their building.
                if (!level.title) return <li key={key}>{rows(1)}</li>
                return (
                  <li key={key}>
                    <NavRow
                      selected={false}
                      label={level.title}
                      depth={1}
                      fold={{ open: !folded[key], toggle: () => toggle(key) }}
                      onPick={() => toggle(key)}
                    />
                    {!folded[key] && rows(2)}
                  </li>
                )
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
