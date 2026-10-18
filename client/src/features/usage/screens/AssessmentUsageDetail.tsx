// One assessment's AI cost (EV-04 AC2): totals, each feature split by the
// service that billed it, what drafting each report section cost, and the
// cost per feature or billed service, usage at the rates charged, and speed. Opened from the
// overview; shown by screens/UsageCosts.tsx. Calls GET /api/usage/summary.
import { useState } from 'react'
import { Button, Callout, EmptyState, Tabs } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  exportUrl,
  getUsageSummary,
  ratesExportUrl,
  type OverviewGroup,
  type UsageView,
} from '../api'
import type { CostGroup } from '../chart'
import { BreakdownTable } from '../components/BreakdownTable'
import { CostSummary } from '../components/CostSummary'
import { LatencyTable } from '../components/LatencyTable'
import { RateTables } from '../components/RateTables'
import { SectionTable } from '../components/SectionTable'
import { StackedCostChart } from '../components/StackedCostChart'
import { FEATURE_LABELS } from '../format'
import { useLoad } from '../useLoad'

export function AssessmentUsageDetail({
  assessment,
  onBack,
}: {
  assessment: OverviewGroup
  onBack: () => void
}) {
  const reportId = assessment.reference!
  const [view, setView] = useState<UsageView>('feature')
  const { data, error, loading, retry } = useLoad(reportId, (signal) =>
    getUsageSummary(reportId, signal),
  )
  const shown = error ? null : data
  // One bar per feature, split by the services that billed it.
  const features: CostGroup[] = (shown?.byFeatureService ?? []).map((f) => ({
    key: f.feature,
    label: FEATURE_LABELS[f.feature] ?? f.feature,
    estimatedCostUsd: f.estimatedCostUsd,
    lastActivityAt: '',
    segments: f.segments,
  }))
  const place = [assessment.client, assessment.siteName].filter(Boolean).join(' · ')

  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <Button variant="ghost" iconLeft="arrow-left" onClick={onBack}>
          All assessments
        </Button>
        {shown && shown.totals.calls > 0 && (
          <a className="uc-export" href={exportUrl(reportId, view)} download>
            Export CSV
          </a>
        )}
      </div>
      <header className="uc-detail-head">
        <h2>{reportId}</h2>
        {(place || assessment.engineerName) && (
          <p>
            {place}
            {place && assessment.engineerName ? ' · ' : ''}
            {assessment.engineerName}
          </p>
        )}
      </header>

      {loading && !shown && <p role="status">Loading usage…</p>}
      {error !== null && (
        <Callout
          tone="danger"
          title="Usage not shown"
          actions={
            <button type="button" className="uc-link" onClick={retry}>
              Try again
            </button>
          }
        >
          <span role="alert">
            {error instanceof GatewayError && error.status === 403
              ? 'You do not have access to usage for that assessment.'
              : 'Usage could not be loaded. Check your connection and try again.'}
          </span>
        </Callout>
      )}

      {shown && shown.totals.calls === 0 && (
        <EmptyState
          icon="inbox"
          title="No AI calls recorded for this assessment yet"
          description="Costs appear here once it has been drafted, transcribed or had a photo read."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <CostSummary totals={shown.totals} />
          <section className="uc-section" aria-labelledby="uc-features">
            <h2 id="uc-features">Cost by feature</h2>
            <StackedCostChart
              title="Cost by feature, split by service"
              noun="features"
              groups={features}
              controls={false}
            />
          </section>
          {shown.bySection.length > 0 && (
            <section className="uc-section" aria-labelledby="uc-sections">
              <h2 id="uc-sections">Drafting by report section</h2>
              <SectionTable rows={shown.bySection} />
            </section>
          )}
          <section className="uc-section" aria-labelledby="uc-breakdown">
            <h2 id="uc-breakdown">Cost breakdown</h2>
            <Tabs
              value={view}
              onChange={(v) => setView(v as UsageView)}
              items={[
                { value: 'feature', label: 'By feature' },
                { value: 'service', label: 'By billed service' },
              ]}
            />
            <BreakdownTable
              view={view}
              rows={view === 'feature' ? shown.byFeature : shown.byService}
            />
          </section>
          <section className="uc-section" aria-labelledby="uc-usage">
            <div className="uc-section-head">
              <h2 id="uc-usage">Usage and rates</h2>
              <a className="uc-export" href={ratesExportUrl(reportId)} download>
                Export rates CSV
              </a>
            </div>
            <p className="uc-section-note">
              Each quantity is shown at the rate it was charged when the call was made.
            </p>
            <RateTables rows={shown.rateRows} />
          </section>
          <section className="uc-section" aria-labelledby="uc-speed">
            <h2 id="uc-speed">Speed</h2>
            <LatencyTable rows={shown.byFeature} />
          </section>
        </>
      )}
    </div>
  )
}
