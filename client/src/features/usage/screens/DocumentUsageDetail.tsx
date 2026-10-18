// One knowledge document's ingestion cost (EV-04), all time: its details,
// totals, cost per stage split by the service that billed it, and its usage
// at the rates charged, with the time per call. Opened from the Ingestion tab;
// shown by screens/UsageCosts.tsx. Calls GET /api/usage/ingestion/:key.
import { Button, Callout } from '../../../design-system'
import { formatDay } from '../../assessments/format'
import { getDocumentUsage, type DocumentUsage } from '../api'
import type { CostGroup } from '../chart'
import { CostSummary } from '../components/CostSummary'
import { RateTables } from '../components/RateTables'
import { StackedCostChart } from '../components/StackedCostChart'
import { FEATURE_LABELS, statusLabel } from '../format'
import { useLoad } from '../useLoad'

export function DocumentUsageDetail({
  document,
  onBack,
}: {
  document: DocumentUsage
  onBack: () => void
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
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <Button variant="ghost" iconLeft="arrow-left" onClick={onBack}>
          All documents
        </Button>
      </div>
      <header className="uc-detail-head uc-document-head">
        <h2>{document.title}</h2>
        <p>{about.join(' · ')}</p>
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
          <span role="alert">Usage could not be loaded. Check your connection and try again.</span>
        </Callout>
      )}

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
            <h2 id="uc-doc-usage">Usage and rates</h2>
            <p className="uc-section-note">
              Each quantity is shown at the rate it was charged when the call was made. Time per
              call is an average: these calls are recorded as totals per stage.
            </p>
            <RateTables rows={shown.rateRows} showTime />
          </section>
        </>
      )}
    </div>
  )
}
