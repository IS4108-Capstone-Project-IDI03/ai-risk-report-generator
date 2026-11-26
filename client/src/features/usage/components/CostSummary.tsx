// Totals: estimated cost, number of calls, and any calls with no cost (EV-04, AC1, AC7), as a row
// of the shared FigureTiles. "Estimated" marks a total that uses an estimated price.
// Used by the overview, the ingestion tab and both detail pages.
import { Badge, FigureTile } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { formatMoney } from '../format'
import type { Totals } from '../api'

export function CostSummary({ totals }: { totals: Totals }) {
  return (
    <section className="uc-totals-tiles" aria-label="Totals" data-walk="usage.totals">
      <FigureTile
        label="Total estimated cost"
        help={<Tip id="usage.total-cost" />}
        icon="coins"
        value={formatMoney(totals.estimatedCostUsd)}
        note={
          <span className="uc-fig-note">
            {'US dollars'}
            {totals.estimatedCalls > 0 && <Badge tone="warning">Estimated</Badge>}
          </span>
        }
      />
      <FigureTile label="AI calls" icon="sparkles" value={totals.calls.toLocaleString('en-US')} />
      {totals.callsWithoutCost > 0 && (
        <FigureTile
          label="Calls without cost"
          icon="circle-dashed"
          tone="warn"
          value={totals.callsWithoutCost.toLocaleString('en-US')}
          note="Not in the total"
        />
      )}
    </section>
  )
}
