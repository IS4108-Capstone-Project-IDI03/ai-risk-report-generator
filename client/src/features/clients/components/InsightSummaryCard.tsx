// The written summary on the Insights tab (CP-29): a few statements the model
// drafted from the engineer's observations and the figures counted from them,
// each citing the sources listed under it. The gateway returns it only once
// every statement was checked, so nothing here is streamed. It is the tab's one
// AI-written block and says so; it is never part of a report. Called by
// screens/InsightsTab.
import { Fragment, useState } from 'react'
import { Button, Callout, ConfidenceIndicator, IconButton } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { formatDayYearTime } from '../../assessments/format'
import type { InsightSummary } from '../api'
import { plural } from '../formatClient'
import type { WriteFailure } from '../useClientInsights'

// Sources listed before Show all: a summary can cite a dozen observations.
const FEW = 6

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
  const sources = summary?.sources ?? []
  const listed = allSources ? sources : sources.slice(0, FEW)
  // Choosing a citation lists every source, so the one it names is in view.
  const cite = (n: number) => {
    setCited(cited === n ? null : n)
    if (n > FEW) setAllSources(true)
  }

  return (
    <section className="cl-card ci-card" aria-labelledby="ci-summary" data-walk="insights.summary">
      <div className="ci-card-head ci-summary-head">
        <span className="ci-h-tip">
          <h2 id="ci-summary" className="ci-h">
            {'Summary'}
          </h2>
          <Tip id="client.insights-summary" />
        </span>
        {written && <ConfidenceIndicator level={summary.confidence} />}
        {written && (
          <IconButton
            icon="rotate-ccw"
            label="Write the summary again"
            tooltip="Write again"
            onClick={onWrite}
          />
        )}
      </div>

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
        <div className="ci-written">
          <p className="ci-sub">
            {`Written by AI on ${formatDayYearTime(new Date(summary.writtenAt))} from ` +
              `${plural(summary.basis.observations, 'observation')}, ` +
              `${plural(summary.basis.ofis, 'accepted OFI')} and ` +
              `${plural(summary.basis.ratings, 'rating')}. It isn't added to any report.`}
          </p>
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
          <div className="ci-sources-block">
            <h3 className="ci-label">{'Sources'}</h3>
            <ol className="ci-sources">
              {listed.map((source) => (
                <li key={source.n} data-on={cited === source.n || undefined}>
                  <span className="ci-source-n">{source.n}</span>
                  <span className="ci-source-text">
                    <span className="ci-source-title" dir="auto">
                      {source.title}
                    </span>
                    <span className="ci-sub">
                      {[
                        source.kind === 'figure' ? 'Figure' : 'Observation',
                        source.meta,
                        source.reference,
                      ]
                        .filter(Boolean)
                        .map((part, i) => (
                          // Each part stays whole ("RPT-2026-0005" never splits at its
                          // hyphen); the line may break between parts.
                          <Fragment key={i}>
                            {i > 0 && ' · '}
                            <span className="ci-part">{part}</span>
                          </Fragment>
                        ))}
                    </span>
                    <span className="ci-source-quote" dir="auto">
                      {source.quote}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {listed.length < sources.length && (
              <Button
                variant="link"
                size="sm"
                className="ds-press ci-link"
                onClick={() => setAllSources(true)}
              >
                {`Show all ${sources.length} sources`}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
