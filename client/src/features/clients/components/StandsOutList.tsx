// "What stands out" on the Insights tab (CP-29): the gateway's findings as rows built like the
// ranked list beside it (a 32 px tile in the finding's tone, the sentence, one grey line, its
// share or change, and one round action at the end that brings the block showing it into view).
// Called by screens/InsightsTab; the findings are worded and counted by the gateway.
import { IconAction, IconTile } from '../../../design-system'
import { CAT_ICON } from '../../assessments/categories'
import type { InsightFinding } from '../api'

const FINDING_ICON: Record<InsightFinding['kind'], string> = {
  category: 'layers',
  worse: 'trending-up',
  improved: 'trending-down',
  severe: 'triangle-alert',
}

// What each finding's action says: where it takes the engineer.
const SHOW: Record<InsightFinding['kind'], string> = {
  category: 'Show in the grid',
  severe: 'Show its findings',
  worse: 'Show the change',
  improved: 'Show the change',
}

export function StandsOutList({
  findings,
  onShow,
}: {
  findings: InsightFinding[]
  onShow: (finding: InsightFinding) => void
}) {
  return (
    <ul className="ci-list">
      {findings.map((finding) => (
        <li key={finding.kind} className="ci-item">
          {/* A neutral finding takes the ink tile; the others their state's colour. */}
          <IconTile
            icon={(finding.category && CAT_ICON[finding.category]) || FINDING_ICON[finding.kind]}
            tone={finding.tone === 'neutral' ? 'ink' : finding.tone}
          />
          <div className="ci-item-text">
            <h3 className="ci-item-title">{finding.title}</h3>
            <span className="ci-item-sub">{finding.detail}</span>
            {finding.share && (
              <span
                className="ci-meter"
                role="img"
                aria-label={`${finding.share.count} of ${finding.share.total} observations`}
              >
                <span style={{ width: `${(finding.share.count / finding.share.total) * 100}%` }} />
              </span>
            )}
            {finding.change && (
              <span className="ci-move">
                <span>{finding.change.from}</span>
                <span aria-hidden="true">{'→'}</span>
                <span className="cl-sr">{'to'}</span>
                <strong>{finding.change.to}</strong>
                {finding.change.period && (
                  <span className="ci-item-sub">{finding.change.period}</span>
                )}
              </span>
            )}
          </div>
          <IconAction
            icon="arrow-down"
            label={SHOW[finding.kind]}
            onClick={() => onShow(finding)}
          />
        </li>
      ))}
    </ul>
  )
}
