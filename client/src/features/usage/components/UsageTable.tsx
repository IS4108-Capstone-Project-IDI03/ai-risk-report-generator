// Tokens, search units and audio minutes per feature (EV-04, AC6).
// A dash means the feature does not bill in that unit. Used by screens/UsageCosts.tsx.
import type { UsageRow } from '../api'
import { formatCount, formatMinutes, rowLabel } from '../format'
import { DataTable } from './DataTable'

export function UsageTable({ rows }: { rows: UsageRow[] }) {
  return (
    <DataTable
      caption="Usage by feature"
      rows={rows}
      columns={[
        { header: 'Feature', cell: (r) => rowLabel('feature', r.key) },
        { header: 'Input tokens', numeric: true, cell: (r) => formatCount(r.inputTokens) },
        { header: 'Output tokens', numeric: true, cell: (r) => formatCount(r.outputTokens) },
        { header: 'Cache-read tokens', numeric: true, cell: (r) => formatCount(r.cacheReadTokens) },
        { header: 'Search units', numeric: true, cell: (r) => formatCount(r.searchUnits) },
        { header: 'Audio minutes', numeric: true, cell: (r) => formatMinutes(r.audioSeconds) },
      ]}
    />
  )
}
