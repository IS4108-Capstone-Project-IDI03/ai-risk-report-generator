// The chatbot's cost (EV-04, CB-01) for the period chosen on the overview:
// totals, cost per day (Singapore days, oldest first) split by billed service,
// each person who asked, and the usage at the rates charged. A risk engineer
// sees only their own chat (the gateway scopes it). Opened from the overview's
// Chatbot row; shown by screens/UsageCosts.tsx. Calls GET /api/usage/chat.
import { Button, Callout, EmptyState } from '../../../design-system'
import { formatDay } from '../../assessments/format'
import { chatExportUrl, getChatUsage, type ChatGroup, type Range } from '../api'
import type { CostGroup } from '../chart'
import { CostSummary } from '../components/CostSummary'
import { DataTable } from '../components/DataTable'
import { RateTables } from '../components/RateTables'
import { StackedCostChart } from '../components/StackedCostChart'
import { DASH, formatCount, formatDayKey, formatMoney } from '../format'
import { RANGES } from '../options'
import { useLoad } from '../useLoad'

const counts = [
  { header: 'Calls', numeric: true, cell: (g: ChatGroup) => g.calls.toLocaleString('en-US') },
  {
    header: 'Without cost',
    numeric: true,
    cell: (g: ChatGroup) => formatCount(g.callsWithoutCost),
  },
  { header: 'Cost', numeric: true, cell: (g: ChatGroup) => formatMoney(g.estimatedCostUsd) },
]

export function ChatUsageDetail({ range, onBack }: { range: Range; onBack: () => void }) {
  const { data, error, loading, retry } = useLoad(range, (signal) => getChatUsage(range, signal))
  const shown = error ? null : data
  // One bar per day, oldest first, split by the services that billed it.
  const days: CostGroup[] = (shown?.byDay ?? []).map((d) => ({
    key: d.key,
    label: formatDayKey(d.key, false),
    estimatedCostUsd: d.estimatedCostUsd,
    lastActivityAt: d.lastActivityAt ?? '',
    segments: d.segments,
  }))
  const period = RANGES.find((r) => r.value === range)?.label ?? range

  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <Button variant="ghost" iconLeft="arrow-left" onClick={onBack}>
          All assessments
        </Button>
      </div>
      <header className="uc-detail-head uc-document-head">
        <h2>Chatbot</h2>
        <p>{period}</p>
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

      {shown && shown.totals.calls === 0 && (
        <EmptyState
          icon="inbox"
          title="No chat in this period"
          description="Costs appear here once someone asks the knowledge assistant a question. Try a longer period."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <CostSummary totals={shown.totals} />
          <section className="uc-section" aria-labelledby="uc-chat-days">
            <h2 id="uc-chat-days">Cost per day</h2>
            <StackedCostChart
              title="Cost per day, split by service"
              noun="days"
              groups={days}
              inOrder
            />
            <DataTable
              caption="Chat cost per day"
              rows={shown.byDay}
              columns={[{ header: 'Day', cell: (d) => formatDayKey(d.key) }, ...counts]}
            />
          </section>
          <section className="uc-section" aria-labelledby="uc-chat-people">
            <h2 id="uc-chat-people">Cost per person</h2>
            <DataTable
              caption="Chat cost per person"
              rows={shown.byUser}
              columns={[
                { header: 'Person', cell: (u) => u.name },
                {
                  header: 'Last used',
                  cell: (u) => (u.lastActivityAt ? formatDay(new Date(u.lastActivityAt)) : DASH),
                },
                ...counts,
              ]}
            />
          </section>
          <section className="uc-section" aria-labelledby="uc-chat-usage">
            <div className="uc-section-head">
              <h2 id="uc-chat-usage">Usage and rates</h2>
              <a className="uc-export" href={chatExportUrl(range)} download>
                Export rates CSV
              </a>
            </div>
            <p className="uc-section-note">
              Each quantity is shown at the rate it was charged when the call was made.
            </p>
            <RateTables rows={shown.rateRows} />
          </section>
        </>
      )}
    </div>
  )
}
