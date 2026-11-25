// The note above a figures form while it holds the model's proposed figures (GN-03
// addendum, AC13): that they were proposed, that nothing is computed until confirmed, and why
// each figure was proposed. Used by RiskQualityFigures and LossEstimateFigures.
import { Badge } from '../../../design-system'
import type { ProposedWhy } from '../api'

export function ProposalNote({
  reasons,
  walk,
}: {
  // Each still-proposed figure's label (e.g. "Fire Protection, current") and why.
  reasons: [string, ProposedWhy][]
  // The walkthrough tag (F-12), as data-walk.
  walk?: string
}) {
  return (
    <div className="rv-proposal-note" data-walk={walk}>
      <p>
        <Badge tone="ai" icon="sparkles">
          AI proposal
        </Badge>{' '}
        Figures in violet were proposed from the observations and drafted sections. Check each one,
        as nothing is calculated until you confirm it.
      </p>
      {reasons.length > 0 && (
        <details>
          <summary>Why these figures</summary>
          <ul>
            {reasons.map(([label, why]) => (
              <li key={label}>
                <strong>{label}:</strong> {why.reason}
                {why.citations.length > 0 &&
                  ` (${why.citations.length} source${why.citations.length === 1 ? '' : 's'})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
