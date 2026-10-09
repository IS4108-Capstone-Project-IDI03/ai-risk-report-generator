// How fast each feature ran (EV-04, AC5): average, median (p50), 95th
// percentile (p95) and slowest. Used by screens/UsageCosts.tsx.
import type { UsageRow } from '../api'
import { formatDuration, rowLabel } from '../format'
import { DataTable } from './DataTable'

export function LatencyTable({ rows }: { rows: UsageRow[] }) {
  return (
    <DataTable
      caption="Speed by feature"
      rows={rows}
      columns={[
        { header: 'Feature', cell: (r) => rowLabel('feature', r.key) },
        { header: 'Calls', numeric: true, cell: (r) => r.calls.toLocaleString('en-US') },
        { header: 'Average', numeric: true, cell: (r) => formatDuration(r.latency.avgMs) },
        { header: 'Median (p50)', numeric: true, cell: (r) => formatDuration(r.latency.p50Ms) },
        {
          header: '95th percentile (p95)',
          numeric: true,
          cell: (r) => formatDuration(r.latency.p95Ms),
        },
        { header: 'Slowest', numeric: true, cell: (r) => formatDuration(r.latency.maxMs) },
      ]}
    />
  )
}
