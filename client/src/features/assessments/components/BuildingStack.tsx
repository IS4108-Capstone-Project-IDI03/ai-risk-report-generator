// The Observations tab's Buildings view (CP-61): each building drawn as a
// stack of its levels, lowest at the bottom, every location a cell coloured
// by its worst observation, then the locations elsewhere on site. Choosing a
// cell lists its observations beside the stacks (in a sheet where there is
// no room), with Add observation here. The same values are offered as a
// table. Rendered by screens/Observations.tsx; the shapes and wording are in
// ../buildingStack.ts, the locations and filters in useAssessmentWorkflow.tsx.
import { useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import {
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconAction,
  IconRegistry,
  TableFooter,
} from '../../../design-system'
import {
  buildingStack,
  cellLine,
  cellSummary,
  cellWhere,
  stackKey,
  type StackCell,
} from '../buildingStack'
import { ELSEWHERE } from '../locations'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useCompact } from '../useCompact'
import { CategoryMark, SeverityMark } from './ObservationMarks'
import '../building-stack.css'

type Location = AssessmentWorkflow['obsStack'][number]
type Cell = StackCell<Location>

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Returns the stacks card and, beside it or in a sheet, the chosen location's observations. */
export function BuildingStack({
  v,
  pane,
  toolbar,
  chosen,
  onChoose,
  onUnplaced,
}: {
  v: AssessmentWorkflow
  // The fitted layout's ref (useFitPane), as the list's.
  pane: Ref<HTMLDivElement>
  // The tab's search, filters and Add observation, which apply here too.
  toolbar: ReactNode
  // The chosen location's id.
  chosen: string | null
  onChoose: (id: string | null) => void
  // Opens the observations with no location, which no cell holds, in the list.
  onUnplaced: () => void
}) {
  const [table, setTable] = useState(false)
  const keyId = useId()
  // Room for the panel beside the stacks; else a chosen location opens over them.
  const side = !useCompact(1099)
  const stack = buildingStack(v.obsStack)
  const cell = stack.cells.find((c) => c.location.id === chosen) ?? null
  const gaps = stack.cells.filter((c) => c.tone === 'empty')
  const cellProps = (c: Cell) => ({
    cell: c,
    on: c.location.id === chosen,
    onChoose,
  })
  // A building is as wide as its busiest floor needs, up to four locations across: its level's
  // name, then 84 px a cell (building-stack.css), so two buildings of three fit a laptop.
  const columns = stack.buildings
    .map((b) => {
      const across = Math.min(b.span, 4)
      return `minmax(${80 + across * 90}px, ${Math.max(across, 2)}fr)`
    })
    .join(' ')
  const unplaced = v.obsUnplacedCount
  return (
    <>
      <div ref={pane} className="ob-layout bs-layout" data-fit="">
        <div className="ob-card bs-card">
          {toolbar}
          {stack.cells.length === 0 ? (
            <div className="ob-empty">
              <EmptyState
                icon="building-2"
                title="No locations yet"
                description="Add the site's buildings, levels and locations to see them here."
                action={
                  v.obsAddLocation && (
                    <button
                      type="button"
                      className="ob-button ob-button--tinted ob-button--small"
                      onClick={v.obsAddLocation}
                    >
                      {'Add location'}
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <>
              <div className="bs-key">
                <span className="bs-key-title" id={keyId}>
                  {'Worst severity at each location'}
                </span>
                <ul aria-labelledby={keyId}>
                  {stackKey(stack.cells).map((k) => (
                    <li key={k.tone}>
                      <span className="bs-swatch" data-tone={k.tone} aria-hidden="true" />
                      {k.label}
                      <b>{k.count}</b>
                    </li>
                  ))}
                </ul>
              </div>
              {stack.buildings.length > 0 && (
                <div className="bs-scroll">
                  <div className="bs-site" style={{ gridTemplateColumns: columns }}>
                    {stack.buildings.map((b, column) => (
                      <section
                        key={b.key}
                        className="bs-building"
                        aria-label={b.title}
                        style={{ '--bs-col': column + 1 } as CSSProperties}
                      >
                        <header className="bs-head" style={{ gridRow: b.headRow }}>
                          <Icon name="building-2" size={16} color="var(--marsh-navy)" />
                          <h3>{b.title}</h3>
                          <span>{plural(b.shown, 'observation')}</span>
                        </header>
                        {b.floors.map((f, i) => (
                          <div
                            key={f.kind + f.title}
                            className="bs-floor"
                            data-kind={f.kind}
                            data-top={i === 0 || undefined}
                            data-bottom={i === b.floors.length - 1 || undefined}
                            style={{ gridRow: f.row }}
                          >
                            <span className="bs-level">{f.title}</span>
                            <div className="bs-cells">
                              {f.cells.map((c) => (
                                <StackCellButton key={c.location.id} {...cellProps(c)} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                </div>
              )}
              {stack.elsewhere.length > 0 && (
                <section className="bs-else" aria-label={ELSEWHERE}>
                  <header className="bs-head">
                    <Icon name="map-pin" size={16} color="var(--marsh-navy)" />
                    <h3>{ELSEWHERE}</h3>
                    <span>
                      {plural(
                        stack.elsewhere.reduce((n, c) => n + c.shown, 0),
                        'observation',
                      )}
                    </span>
                  </header>
                  <div className="bs-ground">
                    <div className="bs-cells">
                      {stack.elsewhere.map((c) => (
                        <StackCellButton key={c.location.id} {...cellProps(c)} />
                      ))}
                    </div>
                  </div>
                </section>
              )}
              <div className="bs-under">
                {unplaced > 0 && (
                  <button type="button" className="bs-link" onClick={onUnplaced}>
                    {`${plural(unplaced, 'observation')} ${unplaced === 1 ? 'has' : 'have'} no location recorded`}
                  </button>
                )}
                <span className="bs-under-end">
                  {v.obsAddLocation && (
                    <Button variant="pill-ink" size="sm" iconLeft="plus" onClick={v.obsAddLocation}>
                      {'Add location'}
                    </Button>
                  )}
                  <Button
                    variant="pill"
                    size="sm"
                    iconLeft="table"
                    aria-expanded={table}
                    onClick={() => setTable(!table)}
                  >
                    {table ? 'Hide table' : 'Show as table'}
                  </Button>
                </span>
              </div>
              {table && <StackTable cells={stack.cells} filtered={v.obsFiltering} />}
              <TableFooter>
                {[
                  plural(stack.cells.length, 'location'),
                  `${gaps.length} with nothing recorded`,
                  v.obsFiltering
                    ? `${v.obsShownCount} of ${plural(v.obsTotal, 'observation')}`
                    : plural(v.obsTotal, 'observation'),
                ].join(' · ')}
              </TableFooter>
            </>
          )}
        </div>
        {side && stack.cells.length > 0 && (
          <aside
            className="ob-card bs-panel"
            aria-label={cell ? cell.location.label : 'Locations with nothing recorded'}
          >
            {cell ? (
              <>
                <div className="bs-panel-head">
                  <div>
                    <p className="bs-panel-where">{cellWhere(cell)}</p>
                    <h3>{cell.location.name}</h3>
                  </div>
                  <IconAction icon="x" label="Close" shaded onClick={() => onChoose(null)} />
                </div>
                <ChosenLocation v={v} cell={cell} />
              </>
            ) : (
              <NothingRecorded gaps={gaps} onChoose={onChoose} />
            )}
          </aside>
        )}
      </div>
      {!side && cell && (
        <Dialog
          className={v.phone ? 'ds-dialog-sheet' : undefined}
          title={cell.location.name}
          description={cellWhere(cell)}
          width={440}
          onClose={() => onChoose(null)}
        >
          <div className="bs-sheet">
            <ChosenLocation v={v} cell={cell} />
          </div>
        </Dialog>
      )}
    </>
  )
}

// One location: its name, how many observations the filters show there and the
// worst of them, as a colour, a symbol and words. Pressing it again lets go.
function StackCellButton({
  cell,
  on,
  onChoose,
}: {
  cell: Cell
  on: boolean
  onChoose: (id: string | null) => void
}) {
  const l = cell.location
  const mark = IconRegistry.severity[cell.worst as keyof typeof IconRegistry.severity]
  return (
    <button
      type="button"
      className="bs-cell"
      data-tone={cell.tone}
      // Back from capture, focus returns to the location it was opened at.
      data-landing={l.landing || undefined}
      aria-pressed={on}
      aria-label={`${l.label}: ${cellSummary(cell)}`}
      title={l.label}
      onClick={() => onChoose(on ? null : l.id)}
    >
      <span className="bs-cell-name">{l.name}</span>
      <span className="bs-cell-line">
        {mark && cell.shown > 0 && <Icon name={mark.icon} size={13} />}
        <span>{cellLine(cell)}</span>
      </span>
    </button>
  )
}

// The chosen location: what it holds, Add observation here, then each
// observation the filters show there, which opens its own page.
function ChosenLocation({ v, cell }: { v: AssessmentWorkflow; cell: Cell }) {
  const l = cell.location
  return (
    <>
      <p className="bs-panel-count">{cellSummary(cell)}</p>
      {l.addObservation && (
        <div className="bs-panel-add">
          <Button variant="primary" pill fullWidth iconLeft="plus" onClick={l.addObservation}>
            {'Add observation here'}
          </Button>
        </div>
      )}
      {l.items.length > 0 && (
        <ul className="bs-obs-list" aria-label={'Observations at ' + l.label}>
          {l.items.map((o) => (
            <li key={o.key}>
              <button type="button" className="bs-obs" onClick={() => v.openObs(o.key)}>
                <CategoryMark cats={o.cats} />
                <span className="bs-obs-text">{o.text}</span>
                <SeverityMark sev={o.sev} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// Before a location is chosen: those with nothing recorded, which is what
// the engineer has still to cover. Each can be chosen, to add one there.
function NothingRecorded({
  gaps,
  onChoose,
}: {
  gaps: Cell[]
  onChoose: (id: string | null) => void
}) {
  return (
    <>
      <div className="bs-panel-head">
        <div>
          <h3>{gaps.length ? 'Nothing recorded yet' : 'Every location covered'}</h3>
          <p className="bs-panel-count">
            {gaps.length
              ? `${plural(gaps.length, 'location')} ${gaps.length === 1 ? 'has' : 'have'} no observation, so choose one to add its first.`
              : 'Each location has at least 1 observation, so choose one to see what was found there.'}
          </p>
        </div>
      </div>
      {gaps.length > 0 && (
        <ul className="bs-gap-list">
          {gaps.map((cell) => (
            <li key={cell.location.id} className="bs-gap">
              <button
                type="button"
                className="bs-gap-pick"
                onClick={() => onChoose(cell.location.id)}
              >
                <span>{cell.location.name}</span>
                <span>{cellWhere(cell)}</span>
              </button>
              {cell.location.addObservation && (
                <IconAction
                  icon="plus"
                  shaded
                  label={'Add observation at ' + cell.location.label}
                  tooltip="Add observation"
                  onClick={cell.location.addObservation}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// The same values as a table, in CP-16's order, for anyone who reads them
// better that way.
function StackTable({ cells, filtered }: { cells: Cell[]; filtered: boolean }) {
  return (
    <div className="bs-table-wrap">
      <table className="bs-table">
        <caption className="ob-sr">{'Observations at each location'}</caption>
        <thead>
          <tr>
            <th scope="col">{'Location'}</th>
            <th scope="col">{'Observations'}</th>
            <th scope="col">{'Worst severity'}</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => (
            <tr key={cell.location.id}>
              <th scope="row">
                <span>{cell.location.name}</span>
                <span className="bs-table-where">{cellWhere(cell)}</span>
              </th>
              <td>{filtered && cell.total ? `${cell.shown} of ${cell.total}` : cell.total}</td>
              <td>
                {cell.shown ? (
                  <SeverityMark sev={cell.worst} />
                ) : (
                  <span className="ob-none">{'–'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
