// Totals card: estimated cost, number of calls, and any calls with no cost
// (EV-04, AC1, AC7). "Estimated" marks a total that uses an estimated price.
// Used by the overview, the ingestion tab and both detail pages.
import { Badge, Card, MetricStat } from '../../../design-system'
import { formatMoney } from '../format'
import type { Totals } from '../api'

export function CostSummary({ totals }: { totals: Totals }) {
  return (
    <Card
      title="Totals"
      actions={totals.estimatedCalls > 0 ? <Badge tone="warning">Estimated</Badge> : undefined}
    >
      <div className="uc-metrics">
        <MetricStat
          size="lg"
          label="Total estimated cost"
          value={formatMoney(totals.estimatedCostUsd)}
          note="US dollars"
        />
        <MetricStat size="lg" label="AI calls" value={totals.calls.toLocaleString('en-US')} />
        {totals.callsWithoutCost > 0 && (
          <MetricStat
            size="lg"
            label="Calls without cost"
            value={totals.callsWithoutCost.toLocaleString('en-US')}
            note="Not in the total"
          />
        )}
      </div>
    </Card>
  )
}
