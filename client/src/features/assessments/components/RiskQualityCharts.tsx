// Section 4's charts (GN-12): Marsh's score benchmarking, the current score as a share of
// the potential, and the category summary. Drawn from the figures RiskQualityFigures.tsx
// holds, so saving a score redraws them at once (AC2). Loaded lazily (chart library).
// Data: ../reportCharts.ts. Client and Occupancy Peer Group bars appear once the engineer
// enters them (GN-12 AC8).
import type { RiskQuality } from '../api'
import { NAVY, riskQualitySeries, SKY, TEAL } from '../reportCharts'
import { DonutChart, GroupedBarChart, ValueBarChart } from './ReportChart'

// Marsh's: current navy, potential sky (template p. 10).
const CURRENT = { label: 'Current Score', color: NAVY }
const POTENTIAL = { label: 'Potential Score', color: SKY }
// One colour per bar, as Marsh's chart has, kept by name so a bar keeps its colour
// whichever others are entered.
const BENCHMARK_COLOURS: Record<string, string> = {
  'Location Score': NAVY,
  'Client Score': SKY,
  'Occupancy Peer Group Score': TEAL,
}

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
          bars={series.benchmarks.map((b) => ({ ...b, color: BENCHMARK_COLOURS[b.label] }))}
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
