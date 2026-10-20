// Proposed figures in Review (GN-03 addendum, AC13, AC14): the model's figures pre-fill
// the form marked as AI proposals, nothing is computed from them, editing one drops its
// marking, and Confirm figures saves them as the engineer's. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LossEstimates, RiskQuality } from './api'
import { LossEstimateFigures } from './components/LossEstimateFigures'
import { RiskQualityFigures } from './components/RiskQualityFigures'

const CATEGORIES = [
  'External Exposure',
  'Fire Protection',
  'Occupancy Hazards',
  'Construction',
  'Water Supply',
  'Surveillance',
  'Management Programs',
]
const BASIS = { weights: [], legend: [], rulesVersion: 'rqr-provisional-equal-v1' }
const BLANK: RiskQuality = {
  categories: CATEGORIES.map((category) => ({ category, current: null, potential: null })),
  result: { current: null, potential: null, basis: BASIS },
  updatedAt: null,
}
const PROPOSED: RiskQuality = {
  ...BLANK,
  proposal: {
    categories: CATEGORIES.map((category) => ({
      category,
      current: 8,
      potential: 9,
      reason: `${category} reason`,
      citations: ['O:a'],
    })),
    provenance: { model: 'claude-test', prompt_version: 'gn03-prop-v1', generated_at: '' },
    proposedAt: '2026-10-20T00:00:00.000Z',
  },
}

// Answers GET with `first`, POST /propose with PROPOSED, and PUT with the figures sent
// (Section 4's with a computed result).
function gateway(first: RiskQuality | LossEstimates) {
  const calls: { method: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, body })
    const answer =
      method === 'POST'
        ? PROPOSED
        : method === 'PUT' && !body.categories
          ? { ...first, proposal: null, inputs: body }
          : method === 'PUT'
            ? {
                ...BLANK,
                proposal: null,
                categories: body.categories,
                result: {
                  current: { score: 80, rating: 'B', band: '' },
                  potential: { score: 90, rating: 'A', band: '' },
                  basis: BASIS,
                },
              }
            : first
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const marked = (label: string) => screen.getByLabelText(label).closest('.rv-proposed') !== null
const scoreRow = () =>
  screen.getByRole('rowheader', { name: 'Location Risk Quality Score' }).closest('tr')!

describe('Section 4 proposed scores', () => {
  it('proposes on request and pre-fills the scores as AI proposals, computing nothing (AC13)', async () => {
    const calls = gateway(BLANK)
    render(<RiskQualityFigures reference="RPT-1" canEdit />)

    fireEvent.click(await screen.findByRole('button', { name: 'Propose figures' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Fire Protection current score')).toHaveValue(8),
    )
    expect(calls.some((c) => c.method === 'POST')).toBe(true)
    expect(marked('Fire Protection current score')).toBe(true)
    expect(screen.getByText(/proposed by claude-test/)).toBeInTheDocument()
    // The rating waits for the engineer's confirmation.
    expect(scoreRow()).toHaveTextContent('Not entered')
    expect(screen.getByRole('button', { name: 'Confirm figures' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Propose figures' })).not.toBeInTheDocument()
  })

  it("drops a figure's AI marking once the engineer edits it, and confirms all (AC14)", async () => {
    const calls = gateway(PROPOSED)
    render(<RiskQualityFigures reference="RPT-1" canEdit />)
    const fire = await screen.findByLabelText('Fire Protection current score')

    fireEvent.change(fire, { target: { value: '7' } })
    expect(marked('Fire Protection current score')).toBe(false)
    expect(marked('Construction current score')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm figures' }))
    await waitFor(() => expect(scoreRow()).toHaveTextContent('80.0'))
    const put = calls.find((c) => c.method === 'PUT')!.body as {
      categories: { category: string; current: number }[]
    }
    expect(put.categories.find((c) => c.category === 'Fire Protection')!.current).toBe(7)
    expect(put.categories.find((c) => c.category === 'Construction')!.current).toBe(8)
    // Confirmed: no proposal left to mark.
    expect(marked('Construction current score')).toBe(false)
    expect(screen.getByRole('button', { name: 'Save scores' })).toBeInTheDocument()
  })

  it('offers no proposal to anyone but the assigned engineer', async () => {
    gateway(BLANK)
    render(<RiskQualityFigures reference="RPT-1" canEdit={false} />)
    await screen.findByRole('table', { name: 'Risk quality scores' })
    expect(screen.queryByRole('button', { name: 'Propose figures' })).not.toBeInTheDocument()
  })
})

const LOSS: LossEstimates = {
  inputs: {
    currency: 'SGD',
    dateOfValues: '2026-01-01',
    indemnityMonths: 24,
    pd: [{ key: 'pd-b', item: 'Buildings', value: 1_000_000 }],
    te: [{ key: 'te-bi', item: 'Business Interruption', value: 120_000 }],
    levels: [],
  },
  result: { values: { pd: null, te: null, tiv: null }, levels: [], rulesVersion: 'le-v1' },
  updatedAt: null,
  proposal: {
    levels: [
      {
        level: 'II',
        damage: [{ item: 'L27 to L29', percent: 100, reason: 'Open stairs.', citations: ['O:a'] }],
        te: [
          {
            item: 'Business Interruption',
            months: 8,
            percent: 11,
            reason: 'Three floors out.',
            citations: ['O:a'],
          },
        ],
      },
    ],
    provenance: { model: 'claude-test', prompt_version: 'gn03-prop-v1', generated_at: '' },
    proposedAt: '2026-10-20T00:00:00.000Z',
  },
}

describe('Section 5 proposed figures', () => {
  it("pre-fills each level's areas, % and months as proposals, but never a value (AC12, AC13)", async () => {
    const calls = gateway(LOSS)
    render(<LossEstimateFigures reference="RPT-1" canEdit />)

    const damage = await screen.findByLabelText('L27 to L29 % damage')
    expect(damage).toHaveValue(100)
    expect(marked('L27 to L29 % damage')).toBe(true)
    expect(screen.getByLabelText('Level II damage value 1')).toHaveValue(null)
    const level2 = screen.getByRole('table', { name: 'Level II Business Interruption' })
    expect(within(level2).getByLabelText('Business Interruption outage months')).toHaveValue(8)

    // Renaming the area keeps its % marked (marks follow the row, not its name)...
    fireEvent.change(screen.getByLabelText('Level II damage item 1'), {
      target: { value: 'L27-L29' },
    })
    expect(marked('L27-L29 % damage')).toBe(true)
    // ...until the engineer edits the % itself.
    fireEvent.change(screen.getByLabelText('L27-L29 % damage'), { target: { value: '90' } })
    expect(marked('L27-L29 % damage')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm figures' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!.body as LossEstimates['inputs']
    const ii = put.levels.find((l) => l.level === 'II')!
    expect(ii.damageRows).toEqual([
      expect.objectContaining({ item: 'L27-L29', value: null, percent: 90 }),
    ])
    expect(ii.te).toEqual([{ key: 'te-bi', months: 8, percent: 11 }])
  })
})
