// How one row's cost is made up (EV-04): each billed part as quantity × rate =
// cost, at the rates stored with each call when it was made, then the total.
// Shown when a row of the overview or document table is expanded.
import type { CostCheck, CostLine } from '../api'
import { DASH, formatMoney, formatQuantity, formatRate, SERVICE_LABELS } from '../format'

// A line with no rate to show: a call with no cost, or one saved before rates were kept.
const hasNoRate = (line: CostLine) =>
  line.part === 'not priced' || line.part === 'rates not recorded'

function RateCell({ line }: { line: CostLine }) {
  if (hasNoRate(line)) return <span className="uc-note">{line.note}</span>
  return (
    <>
      {formatRate(line.usdPer, line.per, line.unit)}
      {line.note && <span className="uc-note">{line.note}</span>}
    </>
  )
}

export function CostCalculationTable({ name, check }: { name: string; check: CostCheck }) {
  const { costLines } = check
  if (!costLines.length) return <p className="uc-calc-empty">No priced calls in this period.</p>
  const total = costLines.reduce((t, l) => t + l.costUsd, 0)
  return (
    <table className="uc-table uc-calc">
      <caption>{`Cost calculation for ${name}`}</caption>
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col" data-numeric>
            Quantity
          </th>
          <th scope="col" data-numeric>
            Rate
          </th>
          <th scope="col" data-numeric>
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {costLines.map((l) => (
          <tr key={[l.service, l.model, l.part, l.usdPer].join('|')}>
            <th scope="row">
              {SERVICE_LABELS[l.service] ?? l.service} · {l.model} — {l.part}
            </th>
            <td data-numeric>{formatQuantity(l.quantity, l.unit)}</td>
            <td data-numeric>
              <RateCell line={l} />
            </td>
            <td data-numeric>{l.part === 'not priced' ? DASH : formatMoney(l.costUsd)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>
            Total
          </th>
          <td data-numeric>{formatMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
