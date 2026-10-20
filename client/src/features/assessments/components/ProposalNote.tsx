// The note above a figures form while it holds the model's proposed figures (GN-03
// addendum, AC13): who proposed them, that nothing is computed until confirmed, and why
// each figure was proposed. Used by RiskQualityFigures and LossEstimateFigures.
import { Badge } from '../../../design-system'
import type { FigureProposal, ProposedWhy } from '../api'

export function ProposalNote({
  proposal,
  reasons,
}: {
  proposal: FigureProposal<object>
  // Each still-proposed figure's label (e.g. "Fire Protection, current") and why.
  reasons: [string, ProposedWhy][]
}) {
  return (
    <div className="rv-proposal-note">
      <p>
        <Badge tone="ai" icon="sparkles">
          AI proposal
        </Badge>{' '}
        Figures marked in violet were proposed by {proposal.provenance.model} from the observations
        and drafted sections. Check each one: nothing is computed until you confirm.
        {/* The eval found proposals run below Marsh's figures (docs/DECISIONS.md, 20 Oct). */}{' '}
        Proposals tend to score low: compare each with your own judgement.
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
