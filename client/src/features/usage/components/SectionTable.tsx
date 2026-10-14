// What drafting each report section cost, in report order (EV-04): the
// section's Claude calls and their searches, and how often it was drafted.
// Used by screens/AssessmentUsageDetail.tsx.
import type { SectionRow } from '../api'
import { formatCount, formatMoney } from '../format'
import { DataTable } from './DataTable'

export function SectionTable({ rows }: { rows: SectionRow[] }) {
  return (
    <DataTable
      caption="Drafting cost by report section"
      rows={rows.map((r) => ({ ...r, key: r.section ?? 'unspecified' }))}
      columns={[
        { header: 'Section', cell: (r) => r.title },
        { header: 'No.', numeric: true, cell: (r) => r.section ?? '' },
        { header: 'Drafts', numeric: true, cell: (r) => r.drafts.toLocaleString('en-US') },
        { header: 'Calls', numeric: true, cell: (r) => r.calls.toLocaleString('en-US') },
        { header: 'Without cost', numeric: true, cell: (r) => formatCount(r.callsWithoutCost) },
        { header: 'Cost', numeric: true, cell: (r) => formatMoney(r.estimatedCostUsd) },
      ]}
    />
  )
}
