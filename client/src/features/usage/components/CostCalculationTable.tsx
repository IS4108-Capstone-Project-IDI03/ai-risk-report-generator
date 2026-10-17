// How one row's cost is made up (EV-04): each billed part as quantity × rate =
// cost, then the calculated total beside the recorded one. Shown when a row of
// the overview or document table is expanded.
import { Badge } from '../../../design-system'
import type { CostCheck, CostLine } from '../api'
import { DASH, formatMoney, formatQuantity, formatRate, SERVICE_LABELS } from '../format'

// Rounding leaves sub-cent dust; a real difference is a price changed since.
const PRICE_CHANGED_USD = 0.000001

function RateCell({ line }: { line: CostLine }) {
  // A call stored without a cost has no rate, only the reason.
  if (line.part === 'not priced') return <span className="uc-note">{line.note}</span>
  return (
    <>
      {formatRate(line.usdPer, line.per, line.unit)}
      {line.note && <span className="uc-note">{line.note}</span>}
    </>
  )
}

export function CostCalculationTable({ name, check }: { name: string; check: CostCheck }) {
  const { costLines, reconciliation } = check
  if (!costLines.length) return <p className="uc-calc-empty">No priced calls in this period.</p>
  const changed = Math.abs(reconciliation.differenceUsd) > PRICE_CHANGED_USD
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
            Calculated
          </th>
          <td data-numeric>{formatMoney(reconciliation.calculatedUsd)}</td>
        </tr>
        <tr>
          <th scope="row" colSpan={3}>
            Recorded
          </th>
          <td data-numeric>{formatMoney(reconciliation.recordedUsd)}</td>
        </tr>
        <tr>
          <th scope="row" colSpan={3}>
            Difference
            {changed && (
              <Badge tone="neutral" style={{ marginLeft: 8 }}>
                Prices changed since recording
              </Badge>
            )}
          </th>
          <td data-numeric>{formatMoney(reconciliation.differenceUsd)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
