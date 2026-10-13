// A vertical stacked bar chart of AI cost (EV-04): one bar per assessment,
// engineer or document, split into the billed services or features that make
// up its cost. Shown by the usage screens; data shaping is in ../chart.ts.
// Every bar is also a row of the chart's own table, for screen readers, and
// the screen lists every group in a table below, so no value is chart-only.
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Select } from '../../../design-system'
import { toStackedSeries, type ChartSort, type CostGroup, type Series } from '../chart'
import { formatMoney } from '../format'

// How many bars show before the reader asks for more; the rest stay in the table.
export const DEFAULT_BAR_LIMIT = 15
const LIMITS = [5, 10, 15, 25, 50]
const ALL = 'all'

const CHART_HEIGHT = 280
// Never fill the slot: thin bars, the rest is air.
const MAX_BAR_PX = 24
// The surface-coloured gap between parts: a 2px stroke in the card colour.
const GAP_PX = 2

type Props = {
  // Names the chart and its table, e.g. "Cost by assessment".
  title: string
  // What one bar is, plural, for "Showing the top 15 of 60 assessments".
  noun: string
  groups: CostGroup[]
  // A bar was chosen: the screen narrows to it or opens it.
  onSelect?: (key: string) => void
}

export function StackedCostChart({ title, noun, groups, onSelect }: Props) {
  const [sort, setSort] = useState<ChartSort>('cost')
  const [limit, setLimit] = useState<number | typeof ALL>(DEFAULT_BAR_LIMIT)

  if (!groups.length) return <p className="uc-chart-empty">No costs recorded in this period.</p>

  const { bars, series, shown, total } = toStackedSeries(groups, {
    sort,
    limit: limit === ALL ? groups.length : limit,
  })
  const topSeries = series[series.length - 1]?.key

  return (
    <figure className="uc-chart" aria-label={title}>
      <div className="uc-chart-controls">
        <Select
          label="Sort bars by"
          size="sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as ChartSort)}
          options={[
            { value: 'cost', label: 'Highest cost' },
            { value: 'time', label: 'Most recent' },
          ]}
        />
        <Select
          label="Bars shown"
          size="sm"
          value={String(limit)}
          onChange={(e) => setLimit(e.target.value === ALL ? ALL : Number(e.target.value))}
          options={[
            ...LIMITS.map((n) => ({ value: String(n), label: String(n) })),
            { value: ALL, label: 'All' },
          ]}
        />
        <p className="uc-chart-note">
          {shown === total
            ? `Showing all ${total} ${noun}`
            : `Showing the ${sort === 'cost' ? 'top' : 'latest'} ${shown} of ${total} ${noun}`}
        </p>
      </div>

      <div className="uc-chart-plot">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={bars}
            maxBarSize={MAX_BAR_PX}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-axis)' }}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              interval={0}
              angle={bars.length > 8 ? -35 : 0}
              textAnchor={bars.length > 8 ? 'end' : 'middle'}
              height={bars.length > 8 ? 64 : 28}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
              tickFormatter={(v: number) => formatMoney(v)}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-hover)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <CostTooltip label={String(label)} series={series} values={payload[0].payload} />
                ) : null
              }
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="cost"
                fill={s.color}
                stroke="var(--surface-card)"
                strokeWidth={GAP_PX}
                // Rounded at the data end only; the top part of each stack.
                radius={s.key === topSeries ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
                cursor={onSelect ? 'pointer' : undefined}
                onClick={onSelect ? (bar) => onSelect(String(bar.payload.key)) : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {series.length > 1 && (
        <ul className="uc-chart-legend" aria-label="Parts of each bar">
          {series.map((s) => (
            <li key={s.key}>
              <span className="uc-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <table className="uc-sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{noun[0].toUpperCase() + noun.slice(1)}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              {series.map((s) => (
                <td key={s.key}>{formatMoney(Number(b[s.key] ?? 0))}</td>
              ))}
              <td>{formatMoney(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// One bar's parts: the value leads, the part follows, keyed by a short line
// in its colour. Text stays in text colours; only the key wears the series hue.
function CostTooltip({
  label,
  series,
  values,
}: {
  label: string
  series: Series[]
  values: Record<string, unknown>
}) {
  const total = Number(values.total ?? 0)
  const parts = series.filter((s) => Number(values[s.key] ?? 0) > 0).reverse()
  return (
    <div className="uc-tooltip">
      <p className="uc-tooltip-title">
        {label} <strong>{formatMoney(total)}</strong>
      </p>
      <ul>
        {parts.map((s) => {
          const usd = Number(values[s.key])
          return (
            <li key={s.key}>
              <span className="uc-tooltip-key" style={{ background: s.color }} aria-hidden="true" />
              <strong>{formatMoney(usd)}</strong>
              <span>{s.label}</span>
              <span className="uc-tooltip-share">
                {total ? `${Math.round((usd / total) * 100)}%` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
