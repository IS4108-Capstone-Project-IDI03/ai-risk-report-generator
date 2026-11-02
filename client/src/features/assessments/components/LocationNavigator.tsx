// The location navigator (CP-22, built on CP-16's locations): Block → Level →
// Area. Picking one filters the list, so a big site needs no long scroll. A
// panel beside the list on a laptop, a button opening a sheet on a phone. Rendered by screens/Observations.tsx.
import { useState } from 'react'
import { Dialog, Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { NavigatorFoot } from './NavigatorFoot'
import { NavAction as Action, NavRow as Row } from './NavRow'
import type { NavLocation, Place, useObservationsView } from '../useObservationsView'

type View = ReturnType<typeof useObservationsView>
type Props = { v: AssessmentWorkflow; view: View; onPick: (place: Place) => void }

// Returns the panel, or on a phone the button and its sheet.
export function LocationNavigator({ v, view }: Omit<Props, 'onPick'>) {
  const [open, setOpen] = useState(false)
  if (!v.phone)
    return (
      <nav className="ob-card ob-nav" aria-label="Locations">
        <Tree v={v} view={view} onPick={view.pick} />
        <NavigatorFoot v={v} />
      </nav>
    )
  return (
    <>
      <button
        type="button"
        className="ob-nav-button"
        aria-label={'Location: ' + view.title + '. Change'}
        onClick={() => setOpen(true)}
      >
        <Icon name="map-pin" size={18} color="var(--marsh-navy)" />
        <span>{view.title}</span>
        <Icon name="chevron-down" size={16} color="var(--text-secondary)" />
      </button>
      <Dialog
        className="ds-dialog-sheet"
        open={open}
        title="Locations"
        width={440}
        onClose={() => setOpen(false)}
      >
        <nav aria-label="Locations">
          <Tree
            v={v}
            view={view}
            onPick={(place) => {
              view.pick(place)
              setOpen(false)
            }}
          />
        </nav>
        <NavigatorFoot v={v} />
      </Dialog>
    </>
  )
}

// All locations, then each building with its levels and locations.
function Tree({ v, view, onPick }: Props) {
  // Levels fold on their own; buildings remember their fold for the visit.
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const is = (place: Place) => JSON.stringify(place) === JSON.stringify(view.place)
  return (
    <>
      <ul className="ob-nav-tree">
        <li>
          <Row
            all
            selected={is({ kind: 'all' })}
            label="All locations"
            onPick={() => onPick({ kind: 'all' })}
          />
        </li>
        {view.tree.map((g) => (
          <li key={g.key}>
            <Row
              selected={is({ kind: 'group', group: g.key })}
              label={g.title}
              fold={{ open: g.open, toggle: g.toggle }}
              onPick={() => onPick({ kind: 'group', group: g.key })}
            />
            {g.open && (
              <ul>
                {g.levels.map((level) => {
                  const key = g.key + '/' + level.key
                  const locations = (depth: number) => (
                    <Locations
                      v={v}
                      items={level.locations}
                      depth={depth}
                      is={is}
                      onPick={onPick}
                    />
                  )
                  // Locations with no level (the whole building, or elsewhere)
                  // sit straight under their building.
                  if (!level.title) return <li key={key}>{locations(1)}</li>
                  return (
                    <li key={key}>
                      <Row
                        selected={is({ kind: 'level', group: g.key, level: level.key })}
                        label={level.title}
                        depth={1}
                        fold={{
                          open: !folded[key],
                          toggle: () => setFolded({ ...folded, [key]: !folded[key] }),
                        }}
                        onPick={() => onPick({ kind: 'level', group: g.key, level: level.key })}
                      />
                      {!folded[key] && locations(2)}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

// Each location, with its own actions: add an observation there, edit it, or
// remove it while nothing is saved there.
function Locations({
  v,
  items,
  depth,
  is,
  onPick,
}: {
  v: AssessmentWorkflow
  items: NavLocation[]
  depth: number
  is: (place: Place) => boolean
  onPick: (place: Place) => void
}) {
  return (
    <ul>
      {items.map((l) => (
        <li key={l.id}>
          <Row
            selected={is({ kind: 'location', id: l.id })}
            label={l.name}
            depth={depth}
            onPick={() => onPick({ kind: 'location', id: l.id })}
            actions={
              v.obsShowDeleted ? null : (
                <>
                  {!!l.addObservation && (
                    <Action
                      icon="plus"
                      color="var(--marsh-navy)"
                      label={'Add observation at ' + l.label}
                      onClick={l.addObservation}
                    />
                  )}
                  {!!l.edit && (
                    <Action
                      icon="pencil"
                      color="var(--ink-600)"
                      label={'Edit ' + l.label}
                      onClick={l.edit}
                    />
                  )}
                  {!!l.remove && (
                    <Action
                      icon="trash-2"
                      color="var(--red-600)"
                      label={'Remove ' + l.label}
                      onClick={l.remove}
                    />
                  )}
                </>
              )
            }
          />
        </li>
      ))}
    </ul>
  )
}
