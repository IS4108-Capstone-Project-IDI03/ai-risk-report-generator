// The Review page's side-by-side passages (IN-07): the stored document on
// the left, the new one on the right, one row per pair. Differing passages
// are marked; by default only they show, and runs of matching ones fold into
// "N matching passages". Below 1080px the columns become Stored / New tabs (the CSS
// hides the other column). Used by screens/ReviewDocument.tsx.
import { useMemo, useState } from 'react'
import { Icon, IconRegistry, Switch, Tabs } from '../../../design-system'
import type { ComparisonRow, Passage } from '../api'

type Pane = 'stored' | 'new'
// A run of rows to show, or a run of matching rows that can fold.
type Segment = { rows: ComparisonRow[]; start: number; foldable: boolean }

// Groups consecutive matching rows into foldable runs, and each differing row
// on its own; `start` is the run's first row number, its identity.
function segments(rows: ComparisonRow[]): Segment[] {
  const out: Segment[] = []
  rows.forEach((row, at) => {
    const last = out[out.length - 1]
    if (!row.differs && last?.foldable) last.rows.push(row)
    else out.push({ rows: [row], start: at, foldable: !row.differs })
  })
  return out
}

function pages(p: Passage) {
  if (p.pageStart === null) return null
  return p.pageEnd !== null && p.pageEnd !== p.pageStart
    ? `Pages ${p.pageStart}–${p.pageEnd}`
    : `Page ${p.pageStart}`
}

function Cell({ passage, differs, col }: { passage: Passage | null; differs: boolean; col: Pane }) {
  const empty = col === 'stored' ? 'Not in the stored document' : 'Not in the new document'
  return (
    // Only a passage that is there gets the differing mark; the empty side stays plain.
    <td data-col={col} className={differs && passage ? 'kb-cmp-cell is-diff' : 'kb-cmp-cell'}>
      {passage ? (
        <>
          {differs && <span className="kb-sr">Differs. </span>}
          <p>{passage.text}</p>
          {pages(passage) && <small>{pages(passage)}</small>}
        </>
      ) : (
        <span className="kb-cmp-empty">{empty}</span>
      )}
    </td>
  )
}

const RowPair = ({ row }: { row: ComparisonRow }) => (
  <tr>
    <Cell passage={row.stored} differs={row.differs} col="stored" />
    <Cell passage={row.new} differs={row.differs} col="new" />
  </tr>
)

/** Returns the comparison table for aligned rows of stored and new passages. */
export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const [differencesOnly, setDifferencesOnly] = useState(true)
  const [unfolded, setUnfolded] = useState<number[]>([])
  const [pane, setPane] = useState<Pane>('new')
  const runs = useMemo(() => segments(rows), [rows])
  const same = rows.every((row) => !row.differs)
  const toggle = (start: number) =>
    setUnfolded((open) =>
      open.includes(start) ? open.filter((s) => s !== start) : [...open, start],
    )

  return (
    <section className="kb-step-panel kb-cmp" data-pane={pane} aria-labelledby="kb-cmp-title">
      <div className="kb-cmp-head">
        <h3 id="kb-cmp-title">Passages</h3>
        <div className="kb-cmp-tools">
          <Switch
            label="Differences only"
            checked={differencesOnly}
            onChange={setDifferencesOnly}
          />
        </div>
      </div>
      <div className="kb-cmp-body">
        <div className="kb-cmp-tabs">
          <Tabs
            items={[
              { value: 'stored', label: 'Stored' },
              { value: 'new', label: 'New' },
            ]}
            value={pane}
            onChange={(value) => setPane(value as Pane)}
          />
        </div>
        {/* Without this, an exact copy shows only a folded run and no verdict. */}
        {same && <p className="kb-cmp-same">Every passage matches. Nothing differs.</p>}
        <table className="kb-cmp-table">
          <caption className="kb-sr">
            Passages of the stored and the new document, side by side
          </caption>
          <thead>
            <tr>
              <th scope="col" data-col="stored">
                Stored
              </th>
              <th scope="col" data-col="new">
                New
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              // Without folding, every row shows as it is.
              if (!differencesOnly || !run.foldable) {
                return run.rows.map((row, i) => <RowPair key={run.start + i} row={row} />)
              }
              const open = unfolded.includes(run.start)
              return [
                <tr key={`fold-${run.start}`}>
                  <td colSpan={2} className="kb-cmp-fold-cell">
                    <button
                      type="button"
                      className="kb-cmp-fold"
                      aria-expanded={open}
                      onClick={() => toggle(run.start)}
                    >
                      <Icon
                        name={open ? IconRegistry.action.expand : IconRegistry.action.forward}
                        size={14}
                      />
                      {run.rows.length} matching {run.rows.length === 1 ? 'passage' : 'passages'}
                    </button>
                  </td>
                </tr>,
                ...(open
                  ? run.rows.map((row, i) => <RowPair key={`${run.start}-${i}`} row={row} />)
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
