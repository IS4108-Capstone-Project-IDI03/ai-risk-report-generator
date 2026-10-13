// Section 6 Management Programs as Marsh's template lays it out (GN-11, pp. 18-19):
// Table 1, each program's maturity rank and comment, the rank coloured as in Table 2,
// the fixed maturity scale. Used by Generation's draft view and Review's draft editor,
// which pass each row's comment: plain text, or a finding with its review decisions.
import { Badge } from '../../../design-system'
import { MANAGEMENT_PROGRAMS, MATURITY_SCALE } from '../reviewDisplay'

type MaturityEntry = {
  // One of the five ranks, or null when the row's text names none.
  rank: string | null
  comment: React.ReactNode
}

export function MaturityTable({
  entries,
  unplaced = [],
}: {
  entries: Map<string, MaturityEntry>
  // Rows naming none of the programs, or a second row for one (maturityEntries).
  unplaced?: React.ReactNode[]
}) {
  return (
    <div className="rv-maturity">
      <p className="rv-muted">
        Our site visit, interviews and review of information provided leads us to the following
        maturity assessment of Management Programs in place to manage the risks at the location.
      </p>
      <div className="rv-maturity-scroll">
        <table className="rv-maturity-table" aria-label="Management Programs">
          <thead>
            <tr>
              <th scope="col">Program Category</th>
              <th scope="col">Maturity</th>
              <th scope="col">Comments</th>
            </tr>
          </thead>
          <tbody>
            {MANAGEMENT_PROGRAMS.map((program) => {
              const entry = entries.get(program)
              return (
                <tr key={program}>
                  <th scope="row">{program}</th>
                  {!entry ? (
                    <>
                      <td />
                      <td className="rv-muted">Not assessed: no evidence captured</td>
                    </>
                  ) : (
                    <>
                      <td
                        className={entry.rank ? `rv-rank rv-rank-${entry.rank.toLowerCase()}` : ''}
                      >
                        {entry.rank ?? (
                          <Badge tone="moderate" icon="triangle-alert">
                            Not a maturity rank
                          </Badge>
                        )}
                      </td>
                      <td>{entry.comment}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {unplaced.length > 0 && (
        <section aria-label="Rows not matched to a program" className="rv-maturity-unplaced">
          <p className="rv-label">Rows not matched to a program</p>
          <p className="rv-muted">
            These rows don't start with one of the programs above. Edit or reject each one.
          </p>
          {unplaced.map((node, i) => (
            <div key={i}>{node}</div>
          ))}
        </section>
      )}
      <p className="rv-muted">
        In assessing the maturity of the Management Programs the following maturity scale was
        applied:
      </p>
      <div className="rv-maturity-scroll">
        <table className="rv-maturity-table" aria-label="Maturity scale">
          <thead>
            <tr>
              <th scope="col">Maturity Rank</th>
              <th scope="col">Definition</th>
            </tr>
          </thead>
          <tbody>
            {MATURITY_SCALE.map(({ rank, definition }) => (
              <tr key={rank}>
                <th scope="row" className={`rv-rank rv-rank-${rank.toLowerCase()}`}>
                  {rank}
                </th>
                <td>{definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
