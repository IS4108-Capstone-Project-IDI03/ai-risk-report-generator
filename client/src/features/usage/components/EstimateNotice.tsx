// Explains what the total leaves out or guesses (EV-04, AC7): estimated
// prices, calls with no cost, and the pricing bases used.
import { Badge, Callout } from '../../../design-system'
import type { UsageSummary } from '../api'

export function EstimateNotice({ summary }: { summary: UsageSummary }) {
  const { totals, pricingBases } = summary
  const noCost = totals.callsWithoutCost
  if (totals.estimatedCalls === 0 && noCost === 0 && pricingBases.length === 0) return null
  return (
    <Callout
      tone={totals.estimatedCalls > 0 || noCost > 0 ? 'warning' : 'info'}
      title="How these costs are worked out"
    >
      {totals.estimatedCalls > 0 && (
        <p>
          <strong>Estimated:</strong> {totals.estimatedCalls} of {totals.calls} calls use an
          estimated price, so the total is approximate.
        </p>
      )}
      {noCost > 0 && (
        <p>
          {noCost} {noCost === 1 ? 'call has' : 'calls have'} no cost and{' '}
          {noCost === 1 ? 'is' : 'are'} not included in the total.
        </p>
      )}
      {pricingBases.length > 0 && (
        <ul className="uc-bases" aria-label="Pricing bases">
          {pricingBases.map((b) => (
            <li key={b.basis}>
              {b.basis} ({b.calls} {b.calls === 1 ? 'call' : 'calls'}){' '}
              {b.isEstimate && <Badge tone="warning">estimate</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Callout>
  )
}
