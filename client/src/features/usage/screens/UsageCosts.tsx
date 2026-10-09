// The Usage and costs screen (EV-04). Shown by features/assessments/AssessmentApp.tsx.
// Calls getUsageSummary on every report change; each section is its own component.
import { useEffect, useState } from 'react'
import { Callout, EmptyState, Tabs } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { exportUrl, getUsageSummary, type UsageSummary, type UsageView } from '../api'
import { BreakdownTable } from '../components/BreakdownTable'
import { CostSummary } from '../components/CostSummary'
import { EstimateNotice } from '../components/EstimateNotice'
import { LatencyTable } from '../components/LatencyTable'
import { ReportSelect } from '../components/ReportSelect'
import { UsageTable } from '../components/UsageTable'
import '../usage.css'

// The message for a failed load. 403 means the report is not the user's.
function errorMessage(error: unknown): string {
  if (error instanceof GatewayError && error.status === 403)
    return 'You do not have access to usage for that report. Choose another report.'
  return 'Usage could not be loaded. Check your connection and try again.'
}

export function UsageCosts({ isAdmin }: { isAdmin: boolean }) {
  const [reportId, setReportId] = useState('')
  const [view, setView] = useState<UsageView>('feature')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)

  // Reload whenever the report changes; a stale answer is dropped (abort),
  // otherwise a slow reply could overwrite the newer report's numbers.
  useEffect(() => {
    const controller = new AbortController()
    getUsageSummary(reportId, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return
        setSummary(data)
        setLoading(false)
      },
      (e: unknown) => {
        if (controller.signal.aborted) return
        setError(errorMessage(e))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [reportId, retry])

  // Start a reload from an event (not the effect) so state is not set inside an effect.
  const reload = () => {
    setLoading(true)
    setError(null)
  }

  const shown = error ? null : summary
  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <ReportSelect
          reports={summary?.reports ?? []}
          value={reportId}
          isAdmin={isAdmin}
          onChange={(id) => {
            reload()
            setReportId(id)
          }}
        />
        {shown && shown.totals.calls > 0 && (
          <a className="uc-export" href={exportUrl(shown.scope.reportId ?? '', view)} download>
            Export CSV
          </a>
        )}
      </div>

      {loading && !shown && <p role="status">Loading usage…</p>}
      {error && (
        <Callout
          tone="danger"
          title="Usage not shown"
          actions={
            <button
              type="button"
              className="uc-link"
              onClick={() => {
                reload()
                setRetry((n) => n + 1)
              }}
            >
              Try again
            </button>
          }
        >
          <span role="alert">{error}</span>
        </Callout>
      )}

      {shown && shown.totals.calls === 0 && (
        <EmptyState
          icon="inbox"
          title="No AI calls recorded yet"
          description="Costs, usage and speed appear here once the app has drafted, searched, transcribed or labelled something."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <CostSummary totals={shown.totals} />
          <EstimateNotice summary={shown} />
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
            <h2 id="uc-usage">Usage</h2>
            <UsageTable rows={shown.byFeature} />
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
