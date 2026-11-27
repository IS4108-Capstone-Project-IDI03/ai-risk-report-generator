// One assessment's AI cost (EV-04 AC2): totals, each feature split by the
// service that billed it, what drafting each report section cost, and the
// cost per feature or billed service, usage at the rates charged, and speed. Opened from the
// overview; shown by screens/UsageCosts.tsx. Calls GET /api/usage/summary.
import { useState, type ReactNode } from 'react'
import { EmptyState, Tabs } from '../../../design-system'
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
import { ExportLink } from '../components/ExportLink'
import { LOAD_FAILED, LoadError } from '../components/LoadError'
import { LatencyTable } from '../components/LatencyTable'
import { RateTables, RatesTip } from '../components/RateTables'
import { SectionTable } from '../components/SectionTable'
import { StackedCostChart } from '../components/StackedCostChart'
import { UsageHeader } from '../components/UsageHeader'
import { FEATURE_LABELS } from '../format'
import { useLoad } from '../useLoad'

export function AssessmentUsageDetail({
  assessment,
  onBack,
  bell,
}: {
  assessment: OverviewGroup
  onBack: () => void
  bell?: ReactNode
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

  const helper = [place, assessment.engineerName].filter(Boolean).join(' · ')

  return (
    <>
      <UsageHeader
        title={reportId}
        helper={helper || undefined}
        eyebrow="Usage and Costs"
        back={{ label: 'All assessments', onClick: onBack }}
        bell={bell}
        action={
          shown && shown.totals.calls > 0 ? (
            <ExportLink href={exportUrl(reportId, view)}>Export CSV</ExportLink>
          ) : undefined
        }
      />
      <div className="uc" aria-busy={loading}>
        {loading && !shown && (
          <p role="status" className="uc-status">
            Loading usage…
          </p>
        )}
        {error !== null && (
          <LoadError
            retry={retry}
            message={
              error instanceof GatewayError && error.status === 403
                ? 'You do not have access to usage for that assessment.'
                : LOAD_FAILED
            }
          />
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
                <div className="uc-section-title">
                  <h2 id="uc-usage">Usage and rates</h2>
                  <RatesTip />
                </div>
                <ExportLink href={ratesExportUrl(reportId)}>Export rates CSV</ExportLink>
              </div>
              <RateTables rows={shown.rateRows} />
            </section>
            <section className="uc-section" aria-labelledby="uc-speed">
              <h2 id="uc-speed">Speed</h2>
              <LatencyTable rows={shown.byFeature} />
            </section>
          </>
        )}
      </div>
    </>
  )
}
