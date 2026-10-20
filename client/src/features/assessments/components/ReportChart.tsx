// The three chart forms in Marsh's report (GN-12): a donut, a bar chart (vertical or
// horizontal) and a grouped bar. Used by OfiCharts.tsx and RiskQualityCharts.tsx.
// Each is a <figure> named by Marsh's title, with a visually hidden table of its values,
// so nothing is chart-only (docs/design-system.md, "Charts"). Recharts, as EV-04's
// StackedCostChart.tsx; colours are the --chart-* tokens only.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useId } from 'react'
import { NAVY } from '../reportCharts'

const HEIGHT = 240
// The grouped bar's turned labels sit inside its height, so it is taller.
const GROUPED_HEIGHT = 320
const MAX_BAR_PX = 24
const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 }
const VALUE_LABEL = { fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }

// A vertical bar's label, broken onto lines of about 9 characters (a bar's slot in a
// half-width chart is about 70px), so long names
// ("Occupancy Peer Group Score") sit under their own bar instead of running together.
function WrappedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const lines: string[] = []
  for (const word of String(payload?.value ?? '').split(' ')) {
    const last = lines.length - 1
    if (last >= 0 && (lines[last] + ' ' + word).length <= 9) lines[last] += ' ' + word
    else lines.push(word)
  }
  return (
    <text
      x={x}
      y={(y ?? 0) + 12}
      textAnchor="middle"
      fill={AXIS_TICK.fill}
      fontSize={AXIS_TICK.fontSize}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? 14 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

export type Slice = { label: string; value: number; color: string; note?: string }

function Frame({
  title,
  head,
  rows,
  children,
}: {
  title: string
  head: string[]
  rows: (string | number)[][]
  children: React.ReactNode
}) {
  // The caption names both the figure and its table, so the title is written once.
  const captionId = useId()
  return (
    <figure className="rv-chart" aria-labelledby={captionId}>
      <figcaption id={captionId} className="rv-chart-title">
        {title}
      </figcaption>
      {/* The plot is decoration for a screen reader; the table below carries the values. */}
      <div aria-hidden="true">{children}</div>
      <table className="rv-sr-only" aria-labelledby={captionId}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...values]) => (
            <tr key={String(label)}>
              <th scope="row">{label}</th>
              {values.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// `value` follows the label in mono (a donut's count, as Marsh prints it on the slice).
function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="rv-chart-legend">
      {items.map((s) => (
        <li key={s.label}>
          <span className="rv-chart-swatch" style={{ background: s.color }} />
          {s.label}
          {s.value && <span className="rv-chart-value">{s.value}</span>}
        </li>
      ))}
    </ul>
  )
}

// A donut of parts of a whole. Every value is in the legend and the table, zeros too;
// only non-zero parts are drawn. `note` adds a second column (e.g. "98%"). Values sit in
// the legend, not on the ring, where a narrow column would clip them.
export function DonutChart({
  title,
  slices,
  head,
}: {
  title: string
  slices: Slice[]
  head: string[]
}) {
  const drawn = slices.filter((s) => s.value > 0)
  return (
    <Frame
      title={title}
      head={head}
      rows={slices.map((s) => [s.label, s.value, ...(s.note ? [s.note] : [])])}
    >
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <PieChart>
          <Pie
            data={drawn}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="85%"
            // The gap between parts; a single whole ring has none, or it shows a seam.
            stroke="var(--surface-card)"
            strokeWidth={drawn.length > 1 ? 2 : 0}
            isAnimationActive={false}
          >
            {drawn.map((s) => (
              <Cell key={s.label} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <Legend
        items={slices.map((s) => ({
          ...s,
          value: s.note ? `${s.value}, ${s.note}` : String(s.value),
        }))}
      />
    </Frame>
  )
}

// One bar per value, its count at the bar's end. Horizontal for long labels (effort).
export function ValueBarChart({
  title,
  bars,
  head,
  horizontal = false,
  max,
}: {
  title: string
  // A bar's own colour, where bars compare different things (RQR Score Benchmarking).
  bars: { label: string; value: number; color?: string }[]
  head: string[]
  horizontal?: boolean
  // A fixed axis top (100 for a score); counts let the axis fit them.
  max?: number
}) {
  const domain: [number, number | 'auto'] = [0, max ?? 'auto']
  return (
    <Frame title={title} head={head} rows={bars.map((b) => [b.label, b.value])}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart
          data={bars}
          layout={horizontal ? 'vertical' : 'horizontal'}
          maxBarSize={MAX_BAR_PX}
          margin={{ top: 16, right: 24, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            horizontal={!horizontal}
            vertical={horizontal}
            stroke="var(--chart-grid)"
          />
          {horizontal ? (
            <>
              <XAxis type="number" domain={domain} allowDecimals={false} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={140}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                tick={AXIS_TICK}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                tick={<WrappedTick />}
                height={64}
              />
              <YAxis
                domain={domain}
                allowDecimals={max !== undefined}
                tickLine={false}
                axisLine={false}
                width={40}
                tick={AXIS_TICK}
              />
            </>
          )}
          <Bar
            dataKey="value"
            fill={NAVY}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {bars.map((b) => (
              <Cell key={b.label} fill={b.color ?? NAVY} />
            ))}
            <LabelList
              dataKey="value"
              position={horizontal ? 'right' : 'top'}
              style={VALUE_LABEL}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  )
}

// Two bars per group, side by side (Section 4's current and potential score).
export function GroupedBarChart({
  title,
  groups,
  series,
  max,
}: {
  title: string
  groups: { label: string; values: number[] }[]
  series: { label: string; color: string }[]
  max: number
}) {
  const data = groups.map((g) => ({
    label: g.label,
    ...Object.fromEntries(series.map((s, i) => [s.label, g.values[i]])),
  }))
  return (
    <Frame
      title={title}
      head={['', ...series.map((s) => s.label)]}
      rows={groups.map((g) => [g.label, ...g.values])}
    >
      <ResponsiveContainer width="100%" height={GROUPED_HEIGHT}>
        <BarChart
          data={data}
          maxBarSize={MAX_BAR_PX}
          // A turned label reaches left of its group; leave the first one room.
          margin={{ top: 16, right: 8, left: 24 }}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
            tick={AXIS_TICK}
            // Seven category names don't fit side by side in a column: turn them, as
            // StackedCostChart does for many bars.
            angle={-35}
            textAnchor="end"
            height={96}
          />
          <YAxis domain={[0, max]} tickLine={false} axisLine={false} width={32} tick={AXIS_TICK} />
          {series.map((s) => (
            <Bar
              key={s.label}
              dataKey={s.label}
              fill={s.color}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              <LabelList dataKey={s.label} position="top" style={VALUE_LABEL} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={series} />
    </Frame>
  )
}
