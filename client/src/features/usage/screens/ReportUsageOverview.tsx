// Report generation cost across assessments or engineers (EV-04): totals, a
// stacked bar per group split by billed service or feature, and the full table
// below it. A knowledge admin can compare engineers and narrow to one; a risk
// engineer sees only their own assessments (the gateway enforces it).
// Shown by screens/UsageCosts.tsx; calls GET /api/usage/overview.
import { useState } from 'react'
import { Button, Callout, EmptyState, Input, Select } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  getUsageOverview,
  overviewExportUrl,
  type GroupBy,
  type OverviewGroup,
  type OverviewQuery,
  type Range,
  type UsageView,
} from '../api'
import { CostSummary } from '../components/CostSummary'
import { OverviewTable } from '../components/OverviewTable'
import { StackedCostChart } from '../components/StackedCostChart'
import { DEFAULT_RANGE, RANGES, SPLITS } from '../options'
import { useLoad } from '../useLoad'

// Has the reader's search in its reference, client or site.
const matches = (g: OverviewGroup, search: string) =>
  !search ||
  [g.reference, g.client, g.siteName, g.label].some((t) =>
    t?.toLowerCase().includes(search.toLowerCase()),
  )

export function ReportUsageOverview({
  isAdmin,
  onOpen,
  onOpenChat,
}: {
  isAdmin: boolean
  onOpen: (assessment: OverviewGroup) => void
  // The chatbot's page, for the period on screen.
  onOpenChat: (range: Range) => void
}) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const [split, setSplit] = useState<UsageView>('service')
  const [groupBy, setGroupBy] = useState<GroupBy>('assessment')
  const [engineer, setEngineer] = useState('')
  const [search, setSearch] = useState('')
  // Every engineer seen so far, so the filter still lists them all while narrowed to one.
  const [engineers, setEngineers] = useState<Map<string, string>>(new Map())

  const query: OverviewQuery = { groupBy, split, range, ...(engineer ? { engineer } : {}) }
  const { data, error, loading, retry } = useLoad(JSON.stringify(query), async (signal) => {
    const answer = await getUsageOverview(query, signal)
    setEngineers((known) => {
      const next = new Map(known)
      for (const g of answer.groups)
        if (g.engineerId && g.engineerName) next.set(g.engineerId, g.engineerName)
      return next
    })
    return answer
  })

  const chooseEngineer = (id: string) => {
    setEngineer(id)
    setGroupBy('assessment')
  }
  const shown = error ? null : data
  const noun = groupBy === 'engineer' ? 'engineers' : 'assessments'

  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <div className="uc-filters">
          <Select
            label="Period"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            options={RANGES}
          />
          {isAdmin && (
            <Select
              label="Group by"
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as GroupBy)
                setEngineer('')
              }}
              options={[
                { value: 'assessment', label: 'Assessment' },
                { value: 'engineer', label: 'Engineer' },
              ]}
            />
          )}
          <Select
            label="Split each bar by"
            value={split}
            onChange={(e) => setSplit(e.target.value as UsageView)}
            options={SPLITS}
          />
        </div>
        {shown && shown.totals.calls > 0 && (
          <a className="uc-export" href={overviewExportUrl(query)} download>
            Export CSV
          </a>
        )}
      </div>

      {isAdmin && engineer && (
        <div className="uc-scope">
          <p>Assessments of {engineers.get(engineer) ?? 'this engineer'}</p>
          <Button variant="link" onClick={() => setEngineer('')}>
            Show every engineer
          </Button>
        </div>
      )}

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
              ? 'You do not have access to that usage.'
              : 'Usage could not be loaded. Check your connection and try again.'}
          </span>
        </Callout>
      )}

      {shown && shown.totals.calls === 0 && (
        <EmptyState
          icon="inbox"
          title="No AI calls in this period"
          description="Costs appear here once the app has drafted, searched, transcribed, read a photo or answered a chat question. Try a longer period."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <CostSummary totals={shown.totals} />
          <section className="uc-section" aria-labelledby="uc-chart-heading">
            <h2 id="uc-chart-heading">
              {groupBy === 'engineer' ? 'Cost by engineer' : 'Cost by assessment'}
            </h2>
            <StackedCostChart
              title={groupBy === 'engineer' ? 'Cost by engineer' : 'Cost by assessment'}
              noun={noun}
              groups={shown.groups}
              onSelect={(key) => {
                const group = shown.groups.find((g) => g.key === key)
                if (!group) return
                if (groupBy === 'engineer' && group.engineerId) chooseEngineer(group.engineerId)
                if (groupBy === 'assessment' && group.reference) onOpen(group)
                if (groupBy === 'assessment' && group.key === 'chat') onOpenChat(range)
              }}
            />
          </section>
          <section className="uc-section" aria-labelledby="uc-table-heading">
            <h2 id="uc-table-heading">{groupBy === 'engineer' ? 'Engineers' : 'Assessments'}</h2>
            {groupBy === 'assessment' && (
              <div className="uc-filters">
                <Input
                  label="Find an assessment"
                  iconLeft="search"
                  value={search}
                  placeholder="Reference, client or site"
                  onChange={(e) => setSearch(e.target.value)}
                />
                {isAdmin && (
                  <Select
                    label="Engineer"
                    value={engineer}
                    onChange={(e) => setEngineer(e.target.value)}
                    options={[
                      { value: '', label: 'All engineers' },
                      ...[...engineers].map(([id, name]) => ({ value: id, label: name })),
                    ]}
                  />
                )}
              </div>
            )}
            <OverviewTable
              groupBy={groupBy}
              groups={shown.groups.filter((g) => groupBy === 'engineer' || matches(g, search))}
              showEngineer={isAdmin}
              onOpen={onOpen}
              onOpenChat={() => onOpenChat(range)}
              onChooseEngineer={(g) => g.engineerId && chooseEngineer(g.engineerId)}
            />
          </section>
        </>
      )}
    </div>
  )
}
