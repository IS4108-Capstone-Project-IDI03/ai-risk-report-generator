// Cost, calls and calls without cost per feature or per billed service
// (EV-04, AC1 and AC3). Used by screens/UsageCosts.tsx.
import type { UsageRow, UsageView } from '../api'
import { formatCount, formatMoney, rowLabel } from '../format'
import { DataTable } from './DataTable'

export function BreakdownTable({ view, rows }: { view: UsageView; rows: UsageRow[] }) {
  const first = view === 'feature' ? 'Feature' : 'Billed service'
  return (
    <DataTable
      caption={view === 'feature' ? 'Cost by feature' : 'Cost by billed service'}
      rows={rows}
      columns={[
        { header: first, cell: (r) => rowLabel(view, r.key) },
        { header: 'Estimated cost', numeric: true, cell: (r) => formatMoney(r.estimatedCostUsd) },
        { header: 'Calls', numeric: true, cell: (r) => r.calls.toLocaleString('en-US') },
        {
          header: 'Calls without cost',
          numeric: true,
          cell: (r) => formatCount(r.callsWithoutCost),
        },
      ]}
    />
  )
}
