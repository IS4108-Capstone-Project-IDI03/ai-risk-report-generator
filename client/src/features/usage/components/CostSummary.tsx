// Totals card: estimated cost, number of calls, and any calls with no cost
// (EV-04, AC1, AC7). "Estimated" marks a total that uses an estimated price.
// Used by the overview, the ingestion tab and both detail pages.
import { Badge } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { formatMoney } from '../format'
import type { Totals } from '../api'

function Figure({ label, value, note }: { label: React.ReactNode; value: string; note?: string }) {
  return (
    <div className="uc-fig">
      <span className="uc-fig-label">{label}</span>
      <span className="uc-fig-value">{value}</span>
      {note && <span className="uc-fig-note">{note}</span>}
    </div>
  )
}

export function CostSummary({ totals }: { totals: Totals }) {
  return (
    <section className="uc-card uc-totals-card" aria-label="Totals" data-walk="usage.totals">
      {totals.estimatedCalls > 0 && (
        <span className="uc-estimated">
          <Badge tone="warning">Estimated</Badge>
        </span>
      )}
      <Figure
        // A fragment, not a wrapper: the label stays one text element (usage.css puts the tip beside it).
        label={
          <>
            {'Total estimated cost'}
            <Tip id="usage.total-cost" />
          </>
        }
        value={formatMoney(totals.estimatedCostUsd)}
        note="US dollars"
      />
      <Figure label="AI calls" value={totals.calls.toLocaleString('en-US')} />
      {totals.callsWithoutCost > 0 && (
        <Figure
          label="Calls without cost"
          value={totals.callsWithoutCost.toLocaleString('en-US')}
          note="Not in the total"
        />
      )}
    </section>
  )
}
