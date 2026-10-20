// GN-12 follow-up: Section 3's Risk Assessment Matrix (AC6), Section 4's Rating Legend and
// coloured ratings (AC7), and the Client and Occupancy Peer Group scores in RQR Score
// Benchmarking (AC8). The gateway is a stubbed fetch where one is needed.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RiskQuality } from './api'
import { RiskMatrix } from './components/RiskMatrix'
import { RiskQualityFigures } from './components/RiskQualityFigures'
import { riskQualitySeries } from './reportCharts'
import { RAM, RAM_CONSEQUENCES } from './reportFigures'

const CATEGORIES = [
  'External Exposure',
  'Fire Protection',
  'Occupancy Hazards',
  'Construction',
  'Water Supply',
  'Surveillance',
  'Management Programs',
]
const BASIS = {
  weights: [],
  legend: ['A: 85 to 100', 'B: 70 to 84', 'C: 51 to 69', 'D: 36 to 50', 'E: 0 to 35'],
  rulesVersion: 'rqr-provisional-equal-v1',
}
const RATED: RiskQuality = {
  categories: CATEGORIES.map((category) => ({ category, current: 8, potential: 10 })),
  result: {
    current: { score: 75.7, rating: 'B', band: 'B: 70 to 84' },
    potential: { score: 97, rating: 'A', band: 'A: 85 to 100' },
    basis: BASIS,
  },
  benchmarks: { client: 80, peerGroup: null },
  updatedAt: '2026-10-20T00:00:00.000Z',
}

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

describe('Risk Assessment Matrix (AC6)', () => {
  it("lays out Marsh's matrix, each cell the configured priority in its colour", () => {
    render(<RiskMatrix />)
    const table = screen.getByRole('table', { name: 'Risk Assessment Matrix (RAM)' })
    const rows = within(table).getAllByRole('row').slice(2)
    expect(rows.map((r) => r.textContent)).toEqual([
      'Almost CertainPriority 2Priority 2Priority 1Priority 1Priority 1',
      'LikelyPriority 3Priority 2Priority 2Priority 1Priority 1',
      'PossiblePriority 4Priority 3Priority 2Priority 1Priority 1',
      'UnlikelyPriority 4Priority 4Priority 3Priority 2Priority 1',
      'Very RarePriority 4Priority 4Priority 3Priority 2Priority 2',
    ])
    expect(within(rows[0]).getAllByRole('cell')[2]).toHaveClass('rv-ram-p1')
    expect(screen.getByText(/indicative Risk Assessment Matrix \(RAM\)/)).toBeInTheDocument()
  })

  it("matches the matrix that sets each OFI's priority (rag-service ofi.json)", async () => {
    // The two copies must agree, or the matrix would contradict the OFIs below it.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    // Tests run from client/; the config sits in rag-service beside it.
    const ofi = JSON.parse(
      readFileSync(
        resolve(process.cwd(), '../microservices/rag-service/app/generation/ofi.json'),
        'utf8',
      ),
    ) as {
      likelihood: string[]
      consequence: string[]
      ram: Record<string, Record<string, string>>
    }
    expect(RAM.map((r) => r.likelihood)).toEqual(ofi.likelihood)
    expect(RAM_CONSEQUENCES).toEqual(ofi.consequence)
    for (const { likelihood, priorities } of RAM)
      expect(priorities.map((p) => `Priority ${p}`)).toEqual(
        ofi.consequence.map((c) => ofi.ram[likelihood][c]),
      )
  })
})

describe('Rating Legend and coloured ratings (AC7)', () => {
  it('shows the legend beside the scores, and colours each rating by its band', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify(RATED), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    render(<RiskQualityFigures reference="RPT-1" canEdit={false} />)

    const legend = await screen.findByRole('list', { name: 'Rating Legend' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(BASIS.legend)
    expect(within(legend).getByText('B: 70 to 84')).toHaveClass('rv-band-b')
    const rating = screen.getByRole('rowheader', { name: 'Location Risk Quality Rating' })
    const [current, potential] = within(rating.closest('tr')!).getAllByRole('cell')
    expect(current).toHaveClass('rv-band-b')
    expect(potential).toHaveClass('rv-band-a')
    // The legend left the table: no "Rating Legend" column any more.
    expect(screen.queryByRole('columnheader', { name: 'Rating Legend' })).not.toBeInTheDocument()
  })
})

describe('Client and Occupancy Peer Group scores (AC8)', () => {
  it('benchmarks the Location Score against each score entered, and no other', () => {
    expect(riskQualitySeries(RATED)!.benchmarks).toEqual([
      { label: 'Location Score', value: 75.7 },
      { label: 'Client Score', value: 80 },
    ])
  })

  it('saves both scores with the category scores', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify(RATED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    render(<RiskQualityFigures reference="RPT-1" canEdit />)

    const peer = await screen.findByLabelText('Occupancy Peer Group Score')
    expect(screen.getByLabelText('Client Score')).toHaveValue(80)
    fireEvent.change(peer, { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save scores' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ benchmarks: { client: 80, peerGroup: 70 } })
  })
})
