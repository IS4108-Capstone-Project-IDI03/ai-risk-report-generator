// The overview's table (EV-04): every assessment or engineer with its cost,
// including those past the chart's bar limit. Choosing an assessment opens it;
// choosing an engineer narrows the overview to their assessments. The Chatbot
// and Unassigned rows have nothing to open. Used by screens/ReportUsageOverview.tsx.
import { Button } from '../../../design-system'
import { formatDay } from '../../assessments/format'
import type { GroupBy, OverviewGroup } from '../api'
import { formatCount, formatMoney } from '../format'
import { CostCalculationTable } from './CostCalculationTable'
import { DataTable, type DataColumn, type RowExpansion } from './DataTable'
import { TokensCell } from './TokensCell'

const lastUsed: DataColumn<OverviewGroup> = {
  header: 'Last used',
  cell: (g) => formatDay(new Date(g.lastActivityAt)),
}
const counts: DataColumn<OverviewGroup>[] = [
  { header: 'Calls', numeric: true, cell: (g) => g.calls.toLocaleString('en-US') },
  { header: 'Without cost', numeric: true, cell: (g) => formatCount(g.callsWithoutCost) },
  { header: 'Tokens', numeric: true, cell: (g) => <TokensCell tokens={g.totalTokens} /> },
  { header: 'Total cost', numeric: true, cell: (g) => formatMoney(g.estimatedCostUsd) },
]
// Each row opens to show how its total cost is calculated.
const calculation: RowExpansion<OverviewGroup> = {
  label: (g) => `Show cost calculation for ${g.label}`,
  content: (g) => <CostCalculationTable name={g.label} check={g} />,
}

export function OverviewTable({
  groupBy,
  groups,
  showEngineer,
  onOpen,
  onChooseEngineer,
}: {
  groupBy: GroupBy
  groups: OverviewGroup[]
  // A risk engineer sees only their own assessments, so no engineer column.
  showEngineer: boolean
  onOpen: (group: OverviewGroup) => void
  onChooseEngineer: (group: OverviewGroup) => void
}) {
  if (groupBy === 'engineer')
    return (
      <DataTable
        caption="Engineers and their cost"
        rows={groups}
        expand={calculation}
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
      expand={calculation}
      columns={[
        {
          header: 'Assessment',
          cell: (g) =>
            g.reference ? (
              <Button variant="link" size="sm" onClick={() => onOpen(g)}>
                {g.reference}
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
