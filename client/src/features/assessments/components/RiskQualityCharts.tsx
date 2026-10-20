// Section 4's charts (GN-12): Marsh's score benchmarking, the current score as a share of
// the potential, and the category summary. Drawn from the figures RiskQualityFigures.tsx
// holds, so saving a score redraws them at once (AC2). Loaded lazily (chart library).
// Data: ../reportCharts.ts. Marsh's "Client Score" bar is left out until its source is known.
import type { RiskQuality } from '../api'
import { riskQualitySeries, SERIES } from '../reportCharts'
import { DonutChart, GroupedBarChart, ValueBarChart } from './ReportChart'

const CURRENT = { label: 'Current Score', color: SERIES[0] }
const POTENTIAL = { label: 'Potential Score', color: SERIES[5] }

export function RiskQualityCharts({ figures }: { figures: RiskQuality }) {
  const series = riskQualitySeries(figures)
  if (!series)
    return (
      <p className="rv-chart-empty">
        Enter all fourteen scores to see the charts. They are drawn from the scores above.
      </p>
    )
  const { share } = series
  return (
    <section className="rv-charts" aria-label="Risk quality charts">
      <div className="rv-charts-grid">
        <ValueBarChart
          title="RQR Score Benchmarking"
          bars={[{ label: 'Location Score', value: share.current }]}
          head={['', 'Score']}
          max={100}
        />
        <DonutChart
          title="Current Risk Quality Score Versus % Potential"
          head={['', 'Score', 'Share of potential']}
          slices={[
            { ...CURRENT, value: share.current, note: `${share.currentPct}%` },
            // The gap to the potential. Marsh's legend calls it "Potential Score", but
            // its value is the gap, so the label says so.
            { ...POTENTIAL, label: 'Gap to Potential', value: share.gap, note: `${share.gapPct}%` },
          ]}
        />
      </div>
      <GroupedBarChart
        title="Risk Quality Rating Category Summary"
        series={[CURRENT, POTENTIAL]}
        groups={series.categories.map((c) => ({
          label: c.category,
          values: [c.current, c.potential],
        }))}
        max={10}
      />
    </section>
  )
}
