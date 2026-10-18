// The chatbot's cost (EV-04, CB-01) by calendar month or year, Singapore time:
// a stepper (‹ October 2026 ›), totals compared with the period before once
// the period has ended, cost per day or month split by billed service, each
// person who asked, and the usage at the rates charged. A risk engineer sees
// only their own chat (the gateway scopes it). Opens on this month from the
// overview's Chatbot row; shown by screens/UsageCosts.tsx. Calls GET /api/usage/chat.
import { useState } from 'react'
import { Button, Callout, EmptyState, Tabs } from '../../../design-system'
import { formatDay } from '../../assessments/format'
import {
  chatExportUrl,
  getChatUsage,
  type ChatGroup,
  type ChatPeriod,
  type ChatUsage,
} from '../api'
import type { CostGroup } from '../chart'
import { CostSummary } from '../components/CostSummary'
import { DataTable } from '../components/DataTable'
import { PeriodStepper } from '../components/PeriodStepper'
import { RateTables } from '../components/RateTables'
import { StackedCostChart } from '../components/StackedCostChart'
import {
  DASH,
  formatCount,
  formatDayKey,
  formatMoney,
  formatMonthKey,
  formatPeriod,
} from '../format'
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

// This month in Singapore, as YYYY-MM: chat days and months are Singapore's.
const thisMonth = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7)

// The month or year `step` periods away (-1 is the one before).
function stepped({ period, at }: ChatPeriod, step: number): ChatPeriod {
  if (period === 'year') return { period, at: String(Number(at) + step) }
  const [year, month] = at.split('-').map(Number)
  return { period, at: new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7) }
}

// A finished period beside the one before: "Up 18% vs September 2026 ($3.56)".
// A period still under way is not compared, as its total is not yet whole.
function Comparison({ usage }: { usage: ChatUsage }) {
  const { scope, totals, previous } = usage
  if (!scope.complete) return null
  const before = formatPeriod(scope.period, previous.at)
  const now = totals.estimatedCostUsd
  const then = previous.estimatedCostUsd
  if (then === 0) return <p className="uc-compare">No chat cost in {before}</p>
  const change = Math.round((Math.abs(now - then) / then) * 100)
  if (change === 0) return <p className="uc-compare">Same as {before}</p>
  const up = now > then
  return (
    <p className="uc-compare">
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      <span className="uc-sr-only">{up ? 'Up' : 'Down'}</span> {change}% vs {before} (
      {formatMoney(then)})
    </p>
  )
}

export function ChatUsageDetail({ onBack }: { onBack: () => void }) {
  const [chosen, setChosen] = useState<ChatPeriod>(() => ({ period: 'month', at: thisMonth() }))
  const current: ChatPeriod =
    chosen.period === 'year'
      ? { period: 'year', at: thisMonth().slice(0, 4) }
      : { period: 'month', at: thisMonth() }
  const { data, error, loading, retry } = useLoad(JSON.stringify(chosen), (signal) =>
    getChatUsage(chosen, signal),
  )
  const shown = error ? null : data
  const byMonth = chosen.period === 'year'
  // One bar per day or month, oldest first, split by the services that billed it.
  const bars: CostGroup[] = (shown?.buckets ?? []).map((b) => ({
    key: b.key,
    label: byMonth ? formatMonthKey(b.key, false) : formatDayKey(b.key, false),
    estimatedCostUsd: b.estimatedCostUsd,
    lastActivityAt: b.lastActivityAt ?? '',
    segments: b.segments,
  }))
  // A year opens on its last month that has begun; a month on its own year.
  const switchTo = (period: string) =>
    setChosen(
      period === 'year'
        ? { period: 'year', at: chosen.at.slice(0, 4) }
        : {
            period: 'month',
            at: chosen.at === thisMonth().slice(0, 4) ? thisMonth() : `${chosen.at}-12`,
          },
    )

  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <Button variant="ghost" iconLeft="arrow-left" onClick={onBack}>
          All assessments
        </Button>
        {shown && shown.totals.calls > 0 && (
          <a className="uc-export" href={chatExportUrl(chosen)} download>
            Export rates CSV
          </a>
        )}
      </div>
      <header className="uc-detail-head uc-document-head">
        <h2>Chatbot</h2>
        <p>The knowledge assistant&rsquo;s cost by calendar month or year, Singapore time.</p>
      </header>
      <div className="uc-period">
        <Tabs
          value={chosen.period}
          onChange={switchTo}
          items={[
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
        />
        <PeriodStepper
          unit={chosen.period}
          label={formatPeriod(chosen.period, chosen.at)}
          isCurrent={chosen.at >= current.at}
          onPrevious={() => setChosen(stepped(chosen, -1))}
          onNext={() => setChosen(stepped(chosen, 1))}
          onCurrent={() => setChosen(current)}
        />
      </div>

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
          title={`No chat in ${formatPeriod(chosen.period, chosen.at)}`}
          description="Costs appear here once someone asks the knowledge assistant a question. Try an earlier period."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <div className="uc-totals">
            <CostSummary totals={shown.totals} />
            <Comparison usage={shown} />
          </div>
          <section className="uc-section" aria-labelledby="uc-chat-time">
            <h2 id="uc-chat-time">{byMonth ? 'Cost per month' : 'Cost per day'}</h2>
            <StackedCostChart
              title={
                byMonth ? 'Cost per month, split by service' : 'Cost per day, split by service'
              }
              noun={byMonth ? 'months' : 'days'}
              groups={bars}
              inOrder
            />
            <DataTable
              caption={byMonth ? 'Chat cost per month' : 'Chat cost per day'}
              rows={shown.buckets}
              columns={[
                {
                  header: byMonth ? 'Month' : 'Day',
                  cell: (b) => (byMonth ? formatMonthKey(b.key) : formatDayKey(b.key)),
                },
                ...counts,
              ]}
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
            <h2 id="uc-chat-usage">Usage and rates</h2>
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
