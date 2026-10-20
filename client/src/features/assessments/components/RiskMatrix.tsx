// Section 3's Risk Assessment Matrix in Review (GN-12 AC6), laid out as Marsh's template
// (Shopping Mall Sample 2, p. 4): the lead-in, then Likelihood against Consequences, each
// cell its priority in Marsh's colours. Fixed: the same matrix gives each OFI its
// priority. Used by ReviewWorkspace at the top of Section 3.
import { RAM, RAM_CONSEQUENCES, RAM_LEAD_IN } from '../reportFigures'

export function RiskMatrix() {
  return (
    <section className="rv-ram" aria-labelledby="rv-ram-title">
      {RAM_LEAD_IN.map((p) => (
        <p key={p.slice(0, 20)}>{p}</p>
      ))}
      <h3 id="rv-ram-title">Risk Assessment Matrix (RAM)</h3>
      <div className="rv-maturity-scroll">
        <table className="rv-ram-table" aria-labelledby="rv-ram-title">
          <thead>
            <tr>
              <td className="rv-ram-band" />
              <th scope="colgroup" colSpan={RAM_CONSEQUENCES.length} className="rv-ram-band">
                Consequences
              </th>
            </tr>
            <tr>
              <th scope="col" className="rv-ram-band">
                Likelihood
              </th>
              {RAM_CONSEQUENCES.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RAM.map(({ likelihood, priorities }) => (
              <tr key={likelihood}>
                <th scope="row">{likelihood}</th>
                {priorities.map((p, i) => (
                  <td key={RAM_CONSEQUENCES[i]} className={`rv-ram-p${p}`}>
                    Priority {p}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
