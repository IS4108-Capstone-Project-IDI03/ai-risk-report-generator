// Totals card: estimated cost and number of calls (EV-04, AC1).
// Used by screens/UsageCosts.tsx.
import { Badge, Card, MetricStat } from '../../../design-system'
import { formatMoney } from '../format'
import type { UsageSummary } from '../api'

export function CostSummary({ totals }: { totals: UsageSummary['totals'] }) {
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
      </div>
    </Card>
  )
}
