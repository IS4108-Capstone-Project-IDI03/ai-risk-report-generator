// The written summary on the Insights tab (CP-29): a few statements the model
// drafted from the engineer's observations and the figures counted from them,
// each citing the sources listed under them. The gateway returns it only once
// every statement was checked, so nothing here is streamed. It is the tab's one
// AI-written block and says so; it is never part of a report. Called by
// screens/InsightsTab. Calls SummarySources.
import { useState } from 'react'
import {
  Button,
  Callout,
  ConfidenceIndicator,
  IconAction,
  Panel,
  useIsPhone,
} from '../../../design-system'
import { Tip } from '../../help/Tip'
import { formatDayYearTime } from '../../assessments/format'
import type { InsightSummary } from '../api'
import { plural } from '../formatClient'
import type { WriteFailure } from '../useClientInsights'
import { SummarySources } from './SummarySources'

// Sources listed before Show all: a summary can cite a dozen observations. Three on a phone,
// where each source takes the full width.
const FEW = 6
const FEW_PHONE = 3

const clock = (at: Date) =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

export function InsightSummaryCard({
  summary,
  canSummarise,
  writing,
  failure,
  onWrite,
}: {
  summary: InsightSummary | null
  // Whether there is an observation to write from.
  canSummarise: boolean
  writing: boolean
  failure: WriteFailure | null
  onWrite: () => void
}) {
  // The source a citation number was chosen for.
  const [cited, setCited] = useState<number | null>(null)
  const [allSources, setAllSources] = useState(false)
  const written = summary && !writing
  const few = useIsPhone() ? FEW_PHONE : FEW
  // Choosing a citation lists every source, so the one it names is in view.
  const cite = (n: number) => {
    setCited(cited === n ? null : n)
    if (n > few) setAllSources(true)
  }

  return (
    <Panel
      className="ci-summary"
      data-walk="insights.summary"
      title="Summary"
      help={<Tip id="client.insights-summary" />}
      actions={
        written && (
          <>
            <ConfidenceIndicator level={summary.confidence} />
            <IconAction
              icon="rotate-ccw"
              label="Write the summary again"
              tooltip="Write again"
              onClick={onWrite}
            />
          </>
        )
      }
      note={
        written &&
        `Written by AI on ${formatDayYearTime(new Date(summary.writtenAt))} from ` +
          `${plural(summary.basis.observations, 'observation')}, ` +
          `${plural(summary.basis.ofis, 'accepted OFI')} and ` +
          `${plural(summary.basis.ratings, 'rating')}. It isn't added to any report.`
      }
    >
      {failure && !writing && (
        <Callout
          tone="danger"
          title={`Summary stopped at ${clock(failure.at)}`}
          actions={
            <Button size="sm" variant="secondary" onClick={onWrite}>
              {'Write again'}
            </Button>
          }
        >
          {failure.message}
        </Callout>
      )}

      {writing && (
        <div className="ci-writing" role="status">
          <span className="ci-writing-line">
            <span className="ci-pulse" aria-hidden="true" />
            {'Writing the summary…'}
          </span>
          <span className="ci-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      {!summary && !writing && !failure && (
        <div className="ci-unwritten">
          <p>
            {canSummarise
              ? "No summary yet. AI can write one from your observations, accepted OFIs and ratings. It isn't added to any report."
              : 'A summary can be written once a site has an observation with a note or a transcript.'}
          </p>
          {canSummarise && (
            <Button variant="primary" pill onClick={onWrite}>
              {'Write summary'}
            </Button>
          )}
        </div>
      )}

      {written && (
        <div className="ci-summary-body">
          <div className="ci-statements">
            {summary.outOfDate && (
              <Callout
                tone="warning"
                title="Out of date"
                actions={
                  <Button size="sm" variant="secondary" onClick={onWrite}>
                    {'Write again'}
                  </Button>
                }
              >
                {'Observations or figures changed since this was written.'}
              </Callout>
            )}
            {/* Two newspaper columns on a wide panel, so the statements don't leave half the card empty. */}
            <div className="ci-statement-cols">
              {summary.statements.map((statement, i) => (
                <p key={i} className="ci-statement">
                  {statement.text}
                  {statement.citations.map((n) => {
                    const source = summary.sources.find((s) => s.n === n)
                    return (
                      <button
                        key={n}
                        type="button"
                        className="ci-cite"
                        aria-label={`Source ${n}${source ? `: ${source.title}` : ''}`}
                        aria-pressed={cited === n}
                        onClick={() => cite(n)}
                      >
                        {n}
                      </button>
                    )
                  })}
                </p>
              ))}
              {summary.missing && (
                <p className="ci-missing">
                  <strong>{'Evidence missing: '}</strong>
                  {summary.missing}
                </p>
              )}
            </div>
          </div>
          <SummarySources
            sources={summary.sources}
            few={few}
            cited={cited}
            showAll={allSources}
            onShowAll={() => setAllSources(true)}
          />
        </div>
      )}
    </Panel>
  )
}
