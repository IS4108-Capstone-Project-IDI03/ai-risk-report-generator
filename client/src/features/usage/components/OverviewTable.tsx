// The overview's table (EV-04): every assessment or engineer with its cost,
// including those past the chart's bar limit. Choosing an assessment opens it;
// choosing an engineer narrows the overview to their assessments; choosing the
// Chatbot opens the chat's own page. The Unassigned row has nothing to open. Used by screens/ReportUsageOverview.tsx.
import { Button } from '../../../design-system'
import { formatDay } from '../../assessments/format'
import type { GroupBy, OverviewGroup } from '../api'
import { formatCount, formatMoney } from '../format'
import { DataTable, type DataColumn } from './DataTable'

// The overview's group for chat, which has no assessment.
const CHAT_GROUP = 'chat'

const lastUsed: DataColumn<OverviewGroup> = {
  header: 'Last used',
  cell: (g) => formatDay(new Date(g.lastActivityAt)),
}
const counts: DataColumn<OverviewGroup>[] = [
  { header: 'Calls', numeric: true, cell: (g) => g.calls.toLocaleString('en-US') },
  { header: 'Without cost', numeric: true, cell: (g) => formatCount(g.callsWithoutCost) },
  { header: 'Total cost', numeric: true, cell: (g) => formatMoney(g.estimatedCostUsd) },
]

export function OverviewTable({
  groupBy,
  groups,
  showEngineer,
  onOpen,
  onOpenChat,
  onChooseEngineer,
}: {
  groupBy: GroupBy
  groups: OverviewGroup[]
  // A risk engineer sees only their own assessments, so no engineer column.
  showEngineer: boolean
  onOpen: (group: OverviewGroup) => void
  onOpenChat: () => void
  onChooseEngineer: (group: OverviewGroup) => void
}) {
  if (groupBy === 'engineer')
    return (
      <DataTable
        caption="Engineers and their cost"
        rows={groups}
        columns={[
          {
            header: 'Engineer',
            cell: (g) =>
              g.engineerId ? (
                <Button variant="link" size="sm" onClick={() => onChooseEngineer(g)}>
                  {g.label}
                </Button>
              ) : (
                g.label
              ),
          },
          lastUsed,
          ...counts,
        ]}
      />
    )

  return (
    <DataTable
      caption="Assessments and their cost"
      rows={groups}
      columns={[
        {
          header: 'Assessment',
          cell: (g) =>
            g.reference ? (
              <Button variant="link" size="sm" onClick={() => onOpen(g)}>
                {g.reference}
              </Button>
            ) : g.key === CHAT_GROUP ? (
              <Button variant="link" size="sm" onClick={onOpenChat}>
                {g.label}
              </Button>
            ) : (
              g.label
            ),
        },
        { header: 'Client', cell: (g) => g.client ?? '' },
        { header: 'Site', cell: (g) => g.siteName ?? '' },
        ...(showEngineer
          ? [{ header: 'Engineer', cell: (g: OverviewGroup) => g.engineerName ?? '' }]
          : []),
        lastUsed,
        ...counts,
      ]}
    />
  )
}
