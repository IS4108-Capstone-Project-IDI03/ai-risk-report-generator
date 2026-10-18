// The Ingestion tab's table (EV-04): every knowledge document with what reading
// it cost, including those past the chart's bar limit. A document refused
// after labelling, or labelled before calls named it, shows as not saved.
// Used by screens/IngestionUsageTab.tsx.
import { formatDay } from '../../assessments/format'
import type { DocumentUsage } from '../api'
import { DASH, formatCount, formatDuration, formatMoney, statusLabel } from '../format'
import { DataTable } from './DataTable'

export function DocumentTable({ documents }: { documents: DocumentUsage[] }) {
  return (
    <DataTable
      caption="Documents and their cost"
      rows={documents}
      columns={[
        { header: 'Document', cell: (d) => d.title },
        { header: 'Status', cell: (d) => statusLabel(d.status) },
        {
          header: 'Uploaded',
          cell: (d) => (d.uploadedAt ? formatDay(new Date(d.uploadedAt)) : DASH),
        },
        { header: 'Pages', numeric: true, cell: (d) => (d.pages ?? DASH).toLocaleString() },
        { header: 'Calls', numeric: true, cell: (d) => d.calls.toLocaleString('en-US') },
        { header: 'Without cost', numeric: true, cell: (d) => formatCount(d.callsWithoutCost) },
        { header: 'Time per call', numeric: true, cell: (d) => formatDuration(d.avgMsPerCall) },
        { header: 'Total cost', numeric: true, cell: (d) => formatMoney(d.estimatedCostUsd) },
        {
          header: 'Cost per page',
          numeric: true,
          cell: (d) => (d.usdPerPage === null ? DASH : formatMoney(d.usdPerPage)),
        },
      ]}
    />
  )
}
