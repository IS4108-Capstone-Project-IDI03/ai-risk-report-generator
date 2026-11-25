// One knowledge document's cost to read in (EV-04), all time: its details,
// totals, cost per stage split by the service that billed it, and its usage
// at the rates charged, with the time per call. Opened from the Documents tab;
// shown by screens/UsageCosts.tsx. Calls GET /api/usage/ingestion/:key.
import type { ReactNode } from 'react'
import { formatDay } from '../../assessments/format'
import { documentExportUrl, getDocumentUsage, type DocumentUsage } from '../api'
import type { CostGroup } from '../chart'
import { CostSummary } from '../components/CostSummary'
import { ExportLink } from '../components/ExportLink'
import { LOAD_FAILED, LoadError } from '../components/LoadError'
import { RateTables, RatesTip } from '../components/RateTables'
import { StackedCostChart } from '../components/StackedCostChart'
import { UsageHeader } from '../components/UsageHeader'
import { FEATURE_LABELS, statusLabel } from '../format'
import { useLoad } from '../useLoad'

export function DocumentUsageDetail({
  document,
  onBack,
  bell,
}: {
  document: DocumentUsage
  onBack: () => void
  bell?: ReactNode
}) {
  const { data, error, loading, retry } = useLoad(document.key, (signal) =>
    getDocumentUsage(document.key, signal),
  )
  const shown = error ? null : data
  // One bar per stage, split by the services that billed it.
  const stages: CostGroup[] = (shown?.byFeatureService ?? []).map((f) => ({
    key: f.feature,
    label: FEATURE_LABELS[f.feature] ?? f.feature,
    estimatedCostUsd: f.estimatedCostUsd,
    lastActivityAt: '',
    segments: f.segments,
  }))
  const about = [
    document.fileName,
    statusLabel(document.status),
    document.pages ? `${document.pages.toLocaleString('en-US')} pages` : null,
    document.uploadedAt ? `Uploaded ${formatDay(new Date(document.uploadedAt))}` : null,
  ].filter(Boolean)

  return (
    <>
      <UsageHeader
        title={document.title}
        helper={about.join(' · ')}
        eyebrow="Usage and Costs"
        back={{ label: 'All documents', onClick: onBack }}
        bell={bell}
        action={
          shown ? (
            <ExportLink href={documentExportUrl(document.key)}>Export CSV</ExportLink>
          ) : undefined
        }
      />
      <div className="uc" aria-busy={loading}>
        {loading && !shown && (
          <p role="status" className="uc-status">
            Loading usage…
          </p>
        )}
        {error !== null && <LoadError retry={retry} message={LOAD_FAILED} />}

        {shown && (
          <>
            <CostSummary totals={shown.totals} />
            <section className="uc-section" aria-labelledby="uc-stages">
              <h2 id="uc-stages">Cost by stage</h2>
              <StackedCostChart
                title="Cost by stage, split by service"
                noun="stages"
                groups={stages}
                controls={false}
              />
            </section>
            <section className="uc-section" aria-labelledby="uc-doc-usage">
              <div className="uc-section-title">
                <h2 id="uc-doc-usage">Usage and rates</h2>
                <RatesTip extra="Time per call is an average, because these calls are recorded as totals per stage." />
              </div>
              <RateTables rows={shown.rateRows} showTime />
            </section>
          </>
        )}
      </div>
    </>
  )
}
