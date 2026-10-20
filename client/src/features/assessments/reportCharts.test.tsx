// Sections 3 and 4's charts (GN-12): the counts in Marsh's order and the risk quality
// series (pure functions), then the chart components drawn from them.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptedOfi, RiskQuality } from './api'
import { OfiCharts } from './components/OfiCharts'
import { RiskQualityFigures } from './components/RiskQualityFigures'
import { RiskQualityCharts } from './components/RiskQualityCharts'
import { ofiCounts, riskQualitySeries } from './reportCharts'

const ofi = (fields: Partial<AcceptedOfi>) =>
  ({
    status: 'New',
    category: 'Management Programs',
    priority: 'Priority 2',
    effort: 'Minor Procedural',
    ...fields,
  }) as AcceptedOfi

describe('ofiCounts', () => {
  it("counts accepted OFIs per value in Marsh's order, keeping zeros", () => {
    const counts = ofiCounts([
      ofi({}),
      ofi({ category: 'Physical Protection', priority: 'Priority 1', effort: 'Minor Capital' }),
      ofi({}),
    ])
    expect(counts.category).toEqual([
      { label: 'Physical Protection', value: 1 },
      { label: 'Management Programs', value: 2 },
      { label: 'Other', value: 0 },
    ])
    expect(counts.priority.map((p) => p.value)).toEqual([1, 2, 0, 0])
    expect(counts.effort).toEqual([
      { label: 'Minor Procedural', value: 2 },
      { label: 'Moderate Procedural', value: 0 },
      { label: 'Major Procedural', value: 0 },
      { label: 'Minor Capital', value: 1 },
      { label: 'Moderate Capital', value: 0 },
      { label: 'Major Capital', value: 0 },
    ])
    expect(counts.status.find((s) => s.label === 'New')?.value).toBe(3)
    expect(counts.status).toHaveLength(8)
  })

  it('leaves completed OFIs out of every chart but status', () => {
    const counts = ofiCounts([ofi({}), ofi({ status: 'Completed' })])
    expect(counts.status.find((s) => s.label === 'Completed')?.value).toBe(1)
    expect(counts.category.reduce((n, c) => n + c.value, 0)).toBe(1)
    expect(counts.priority.reduce((n, c) => n + c.value, 0)).toBe(1)
  })

  it('counts nothing when no OFI is accepted', () => {
    const counts = ofiCounts([])
    expect(counts.status.every((s) => s.value === 0)).toBe(true)
  })
})

const rated = (score: number, rating: string) => ({ score, rating, band: '' })
const figures = (current: number | null): RiskQuality => ({
  categories: [
    { category: 'External Exposure', current: 9, potential: 9 },
    { category: 'Management Programs', current, potential: 8 },
  ],
  result: {
    current: current === null ? null : rated(84.3, 'B'),
    potential: rated(85.7, 'A'),
    basis: { weights: [], legend: [], rulesVersion: '' },
  },
  updatedAt: null,
})

describe('riskQualitySeries', () => {
  it('gives the location score, its share of the potential and each category', () => {
    const series = riskQualitySeries(figures(7))!
    // 84.3 / 85.7 = 98%; the gap 1.4 is the other 2%.
    expect(series.share).toEqual({ current: 84.3, currentPct: 98, gap: 1.4, gapPct: 2 })
    expect(series.categories).toEqual([
      { category: 'External Exposure', current: 9, potential: 9 },
      { category: 'Management Programs', current: 7, potential: 8 },
    ])
  })

  it('never divides by a potential score of 0', () => {
    const zero = figures(0)
    zero.result.current = rated(0, 'E')
    zero.result.potential = rated(0, 'E')
    expect(riskQualitySeries(zero)!.share).toEqual({
      current: 0,
      currentPct: 100,
      gap: 0,
      gapPct: 0,
    })
  })

  it('is null while any score is missing', () => {
    expect(riskQualitySeries(figures(null))).toBeNull()
  })
})

// The components: each chart names itself and lists its values in a table (AC5),
// and a note stands in when the data is missing (AC4).
describe('the chart components', () => {
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

  it("draws Section 3's four charts, each with a table of its values", () => {
    render(<OfiCharts accepted={[ofi({}), ofi({ category: 'Physical Protection' })]} />)
    for (const title of [
      'OFI Count by Status',
      'OFI Count by Category (Not Including Completed)',
      'OFI Count by Priority (Not Including Completed)',
      'OFI Count by Effort of Implementation (Not Including Completed)',
    ])
      expect(screen.getByRole('figure', { name: title })).toBeInTheDocument()
    const category = screen.getByRole('table', {
      name: 'OFI Count by Category (Not Including Completed)',
    })
    expect(within(category).getByRole('row', { name: 'Physical Protection 1' })).toBeInTheDocument()
    expect(within(category).getByRole('row', { name: 'Other 0' })).toBeInTheDocument()
  })

  it('says what is missing when no OFI is accepted', () => {
    render(<OfiCharts accepted={[]} />)
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.getByText(/No accepted OFIs yet/)).toBeInTheDocument()
  })

  it("draws Section 4's three charts from the scores", () => {
    render(<RiskQualityCharts figures={figures(7)} />)
    const share = screen.getByRole('table', {
      name: 'Current Risk Quality Score Versus % Potential',
    })
    expect(within(share).getByRole('row', { name: 'Current Score 84.3 98%' })).toBeInTheDocument()
    expect(within(share).getByRole('row', { name: 'Gap to Potential 1.4 2%' })).toBeInTheDocument()
    const summary = screen.getByRole('table', { name: 'Risk Quality Rating Category Summary' })
    expect(
      within(summary).getByRole('row', { name: 'Management Programs 7 8' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'RQR Score Benchmarking' })).toHaveTextContent(
      'Location Score84.3',
    )
  })

  it('says what is missing until all fourteen scores are entered', () => {
    render(<RiskQualityCharts figures={figures(null)} />)
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.getByText(/Enter all fourteen scores/)).toBeInTheDocument()
  })

  it("redraws Section 4's charts when the scores are saved (AC2)", async () => {
    const names = ['External Exposure', 'Management Programs']
    const blank = figures(null)
    blank.result.potential = null
    // The gateway: GET answers the blank scores, PUT the saved ones with their result.
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.method === 'PUT' ? figures(7) : blank
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    render(<RiskQualityFigures reference="RPT-1" canEdit />)
    expect(await screen.findByText(/Enter all fourteen scores/)).toBeInTheDocument()

    for (const category of names)
      for (const side of ['current', 'potential'])
        fireEvent.change(screen.getByLabelText(`${category} ${side} score`), {
          target: { value: '8' },
        })
    fireEvent.click(screen.getByRole('button', { name: 'Save scores' }))

    const summary = await screen.findByRole('table', {
      name: 'Risk Quality Rating Category Summary',
    })
    expect(
      within(summary).getByRole('row', { name: 'Management Programs 7 8' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Enter all fourteen scores/)).not.toBeInTheDocument()
  })
})
