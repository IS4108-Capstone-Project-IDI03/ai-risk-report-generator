// Section 3's graphical summary (GN-12): Marsh's four OFI count charts, drawn from the
// accepted OFIs ReviewWorkspace already holds, so accepting one redraws them at once
// (AC2). Loaded lazily by ReviewWorkspace (it brings the chart library). Data: ../reportCharts.ts.
import { ofiCounts, PRIORITY_COLOURS, STATUS_COLOURS, type Count } from '../reportCharts'
import type { AcceptedOfi } from '../api'
import { DonutChart, ValueBarChart } from './ReportChart'

// Each value in its colour in Marsh's chart.
const slices = (counts: Count[], colours: Record<string, string>) =>
  counts.map((c) => ({ ...c, color: colours[c.label] }))

export function OfiCharts({ accepted }: { accepted: AcceptedOfi[] }) {
  if (!accepted.length)
    return <p className="rv-chart-empty">No accepted OFIs yet: accept an OFI to see the charts.</p>
  const counts = ofiCounts(accepted)
  return (
    <section className="rv-charts" aria-label="Graphical summary of the OFIs">
      <p>A graphical summary of the current opportunities for improvement is shown below.</p>
      <div className="rv-charts-grid">
        <DonutChart
          title="OFI Count by Status"
          slices={slices(counts.status, STATUS_COLOURS)}
          head={['Status', 'OFIs']}
        />
        <ValueBarChart
          title="OFI Count by Category (Not Including Completed)"
          bars={counts.category}
          head={['Category', 'OFIs']}
          // Marsh's is vertical; horizontal keeps the long names from overlapping here.
          horizontal
        />
        <DonutChart
          title="OFI Count by Priority (Not Including Completed)"
          slices={slices(counts.priority, PRIORITY_COLOURS)}
          head={['Priority', 'OFIs']}
        />
        <ValueBarChart
          title="OFI Count by Effort of Implementation (Not Including Completed)"
          bars={counts.effort}
          head={['Effort', 'OFIs']}
          horizontal
        />
      </div>
    </section>
  )
}
