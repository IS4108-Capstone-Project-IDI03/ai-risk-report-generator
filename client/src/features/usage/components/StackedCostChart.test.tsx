// The stacked cost chart (EV-04). jsdom draws no SVG layout, so these check what
// a screen reader gets (the chart's table), its controls and its legend.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CostGroup } from '../chart'
import { DEFAULT_BAR_LIMIT, StackedCostChart } from './StackedCostChart'

const group = (key: string, cost: number, at: string, segments: Record<string, number>) =>
  ({ key, label: key, estimatedCostUsd: cost, lastActivityAt: at, segments }) as CostGroup

const GROUPS = [
  group('RPT-A', 0.6, '2026-10-05T00:00:00Z', { anthropic: 0.5, 'gemini-vision': 0.1 }),
  group('RPT-B', 2, '2026-10-02T00:00:00Z', { anthropic: 2 }),
  group('RPT-C', 0.3, '2026-10-09T00:00:00Z', { 'openai-whisper': 0.3 }),
]

beforeEach(() =>
  // Recharts measures its container; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const chart = (groups = GROUPS) =>
  render(<StackedCostChart title="Cost by assessment" noun="assessments" groups={groups} />)
const tableRows = () =>
  within(screen.getByRole('table', { name: 'Cost by assessment' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getByRole('rowheader').textContent)

describe('StackedCostChart', () => {
  it('shows up to fifteen bars at first', () => {
    expect(DEFAULT_BAR_LIMIT).toBe(15)
  })

  it('lists its bars for screen readers, costliest first, with each part', () => {
    chart()
    expect(tableRows()).toEqual(['RPT-B', 'RPT-A', 'RPT-C'])
    const table = screen.getByRole('table', { name: 'Cost by assessment' })
    expect(
      within(table).getByRole('columnheader', { name: 'Anthropic (Claude)' }),
    ).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Total' })).toBeInTheDocument()
  })

  it('sorts by most recent use when asked', () => {
    chart()
    fireEvent.change(screen.getByLabelText('Sort bars by'), { target: { value: 'time' } })
    expect(tableRows()).toEqual(['RPT-C', 'RPT-A', 'RPT-B'])
  })

  it('shows as many bars as chosen, and says how many are left to the table', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) =>
      group(`RPT-${n}`, n, '2026-10-01T00:00:00Z', { anthropic: n }),
    )
    chart(six)
    expect(screen.getByText('Showing all 6 assessments')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Bars shown'), { target: { value: '5' } })
    expect(tableRows()).toEqual(['RPT-6', 'RPT-5', 'RPT-4', 'RPT-3', 'RPT-2'])
    expect(screen.getByText('Showing the top 5 of 6 assessments')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Bars shown'), { target: { value: 'all' } })
    expect(tableRows()).toHaveLength(6)
  })

  it('names each part in a legend, in stack order', () => {
    chart()
    const legend = screen.getByRole('list', { name: 'Parts of each bar' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Anthropic (Claude)', 'Gemini photo reading', 'OpenAI Whisper'])
  })

  it('needs no legend for a single part: the title says what it is', () => {
    chart([group('RPT-B', 2, '2026-10-02T00:00:00Z', { anthropic: 2 })])
    expect(screen.queryByRole('list', { name: 'Parts of each bar' })).not.toBeInTheDocument()
  })

  it('says so when there is nothing to draw', () => {
    chart([])
    expect(screen.getByText('No costs recorded in this period.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
